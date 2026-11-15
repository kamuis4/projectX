import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { Server, type Socket } from "socket.io";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  commands,
  nicknameSchema,
  type Command,
  type Ack,
} from "@spyfall/shared";
import { registerLibrary } from "./library";
import { Engine, GameError, hash, type Player, type Room } from "./engine";

export async function createServer(
  options: {
    engine?: Engine;
    databaseUrl?: string;
    origin?: string;
    logger?: boolean;
    moderators?: string[];
  } = {},
) {
  const engine = options.engine ?? new Engine();
  const origin =
    options.origin ?? process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16384,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  await app.register(cors, { origin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 100, timeWindow: 60000 });
  const dbUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const db = dbUrl ? new PrismaClient({ datasourceUrl: dbUrl }) : null;
  if (db) await db.$connect();
  const io = new Server(app.server, {
    cors: { origin, credentials: true },
    maxHttpBufferSize: 16384,
    allowRequest: (req, cb) =>
      cb(null, !req.headers.origin || req.headers.origin === origin),
  });
  const accountInput = z.object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(10).max(128),
    username: nicknameSchema.optional(),
  });
  const authUser = async (token?: string) => {
    if (!db || !token) return null;
    const session = await db.accountSession.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true },
    });
    return session && session.expiresAt > new Date() ? session.user : null;
  };
  const library = registerLibrary(
    app,
    db,
    authUser,
    options.moderators ??
      (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
  );
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: err.issues[0]?.message ?? "Données invalides." });
    if (err instanceof GameError)
      return reply.code(400).send({ error: err.message });
    const statusCode =
      err instanceof Error &&
      "statusCode" in err &&
      typeof err.statusCode === "number"
        ? err.statusCode
        : 500;
    if (statusCode === 429)
      return reply
        .code(429)
        .send({ error: "Trop de requêtes. Patientez une minute." });
    app.log.error({ err });
    return reply.code(statusCode).send({ error: "La requête a échoué." });
  });
  app.addHook("onRequest", async (req, reply) => {
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.headers.origin &&
      req.headers.origin !== origin
    )
      return reply.code(403).send({ error: "Origine non autorisée." });
  });
  app.get("/api/health", async () => ({ ok: true, accountsEnabled: !!db }));
  app.get("/api/auth/me", async (req) => {
    const user = await authUser(req.cookies.account);
    if (!user) return { user: null, accountsEnabled: !!db };
    return {
      user: { id: user.id, username: user.username, email: user.email },
      accountsEnabled: true,
    };
  });
  for (const action of ["register", "login"] as const)
    app.post(
      `/api/auth/${action}`,
      { config: { rateLimit: { max: 5, timeWindow: 60000 } } },
      async (req, reply) => {
        if (!db)
          return reply.code(503).send({
            error:
              "Les comptes nécessitent PostgreSQL. Le mode invité reste disponible.",
          });
        const parsed = accountInput.safeParse(req.body);
        if (!parsed.success)
          return reply.code(400).send({
            error:
              "Adresse e-mail valide et mot de passe de 10 à 128 caractères requis.",
          });
        const { email, password, username } = parsed.data;
        let user = await db.user.findUnique({ where: { email } });
        if (action === "register") {
          if (user)
            return reply
              .code(409)
              .send({ error: "Inscription impossible avec cette adresse." });
          if (!username)
            return reply.code(400).send({ error: "Un pseudo est requis." });
          try {
            user = await db.user.create({
              data: {
                email,
                username,
                passwordHash: await argon2.hash(password, {
                  type: argon2.argon2id,
                }),
              },
            });
          } catch {
            return reply
              .code(409)
              .send({ error: "Inscription impossible avec cette adresse." });
          }
        } else if (!user || !(await argon2.verify(user.passwordHash, password)))
          return reply.code(401).send({ error: "Identifiants incorrects." });
        const token = randomBytes(32).toString("hex");
        await db.accountSession.create({
          data: {
            tokenHash: hash(token),
            userId: user!.id,
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
        reply.setCookie("account", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: 604800,
        });
        return {
          user: { id: user!.id, username: user!.username, email: user!.email },
        };
      },
    );
  app.post("/api/auth/logout", async (req, reply) => {
    if (db && req.cookies.account)
      await db.accountSession.deleteMany({
        where: { tokenHash: hash(req.cookies.account) },
      });
    reply.clearCookie("account", { path: "/" });
    return { ok: true };
  });
  app.delete("/api/auth/me", async (req, reply) => {
    const user = await authUser(req.cookies.account);
    if (!db || !user)
      return reply.code(401).send({ error: "Connexion requise." });
    await library.store.removeOwner(`user:${user.id}`);
    await db.user.delete({ where: { id: user.id } });
    for (const room of engine.rooms.values())
      for (const p of room.players)
        if (p.userId === user.id) p.userId = undefined;
    reply.clearCookie("account", { path: "/" });
    return { ok: true };
  });
  app.get("/api/stats", async (req, reply) => {
    const user = await authUser(req.cookies.account);
    if (!db || !user)
      return reply.code(401).send({ error: "Connexion requise." });
    const players = await db.player.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const scores = await db.score.findMany({
      where: { playerId: { in: players.map((p) => p.id) } },
      include: {
        round: { select: { finishedAt: true, winner: true, roles: true } },
      },
      orderBy: { round: { finishedAt: "desc" } },
      take: 100,
    });
    return {
      rounds: scores.length,
      points: scores.reduce((n, s) => n + s.points, 0),
      wins: scores.filter(
        (s) =>
          (s.round.winner === "spies") ===
          s.round.roles.some(
            (r) => r.playerId === s.playerId && r.role === "spy",
          ),
      ).length,
      spyRounds: scores.filter((s) =>
        s.round.roles.some(
          (r) => r.playerId === s.playerId && r.role === "spy",
        ),
      ).length,
      history: scores.map((s) => ({
        role:
          s.round.roles.find((r) => r.playerId === s.playerId)?.role ??
          "innocent",
        winner: s.round.winner,
        points: s.points,
        reason: s.reason,
        finishedAt: s.round.finishedAt,
      })),
    };
  });
  const saved = new Set<string>();
  const pending = new Set<string>();
  const persist = async (room: Room) => {
    const r = room.round;
    if (!db || room.phase !== "results" || !r?.result) return;
    const id = `${room.id}:${r.index}`;
    if (saved.has(id) || pending.has(id)) return;
    pending.add(id);
    try {
      await db.$transaction(async (tx) => {
        await tx.room.upsert({
          where: { id: room.id },
          create: {
            id: room.id,
            code: room.code,
            hostPlayerId: room.hostPlayerId,
            settings: room.settings,
            phase: room.phase,
            expiresAt: new Date(Date.now() + 30 * 86400000),
          },
          update: { phase: room.phase },
        });
        for (const p of room.players)
          await tx.player.upsert({
            where: { id: p.id },
            create: {
              id: p.id,
              roomId: room.id,
              userId: p.userId,
              nickname: p.nickname,
              sessionTokenHash: p.tokenHash,
            },
            update: {},
          });
        const persistedWord = await tx.word.upsert({
          where: { label_locale: { label: r.word.label, locale: "fr" } },
          create: {
            id: r.word.id,
            label: r.word.label,
            categoryId: r.word.category,
            difficulty: r.word.difficulty,
            subcategory: r.word.subcategory,
            variants: r.word.variants,
            locale: "fr",
          },
          update: {},
        });
        await tx.round.upsert({
          where: { id },
          create: {
            id,
            roomId: room.id,
            index: r.index,
            wordId: persistedWord.id,
            phase: "results",
            finishedAt: new Date(),
            winner: r.result!.winner,
            roles: {
              create: r.result!.roles.map((role) => ({
                playerId: role.playerId,
                role: role.role,
              })),
            },
            scores: {
              create: r.result!.roles.map((role) => ({
                playerId: role.playerId,
                points: role.points,
                reason: r.result!.reason,
              })),
            },
          },
          update: {},
        });
      });
      saved.add(id);
    } catch (err) {
      app.log.error({ err }, "Échec de sauvegarde des résultats");
    } finally {
      pending.delete(id);
    }
  };
  const broadcast = (room: Room) => {
    room.updatedAt = Date.now();
    io.to(room.code).emit("room:state", engine.view(room));
    io.to(`stream:${room.id}`).emit("stream:state", engine.streamView(room));
    io.to(room.code).emit("game:phase", {
      phase: room.phase,
      deadlineAt: engine.view(room).deadlineAt,
    });
    for (const p of room.players) {
      if (p.socketId && !p.left && !p.spectator) {
        const card = engine.card(room, p);
        if (card) io.to(p.socketId).emit("game:private-card", card);
      }
    }
    if (room.phase === "results") {
      io.to(room.code).emit("game:result", room.round!.result);
      void persist(room);
    }
  };
  const identity = (socket: Socket) => {
    const code = socket.data.code as string | undefined;
    const id = socket.data.playerId as string | undefined;
    if (!code || !id) throw new GameError("Rejoignez un salon.");
    const room = engine.get(code);
    const player = room.players.find(
      (p) => p.id === id && !p.left && p.socketId === socket.id,
    );
    if (!player) throw new GameError("Session invalide.");
    return { room, player };
  };
  const attach = async (socket: Socket, room: Room, player: Player) => {
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    await socket.join(room.code);
  };
  io.on("connection", (socket) => {
    let times: number[] = [];
    let chats: number[] = [];
    for (const name of Object.keys(commands) as Command[])
      socket.on(name, async (payload: unknown, callback?: unknown) => {
        let acquired = false;
        const ack = (value: Ack) => {
          if (acquired) socket.data.entering = false;
          if (typeof callback === "function") callback(value);
        };
        try {
          const now = Date.now();
          times = times.filter((t) => now - t < 10000);
          if (times.length >= 40)
            throw new GameError("Trop d’actions. Patientez quelques secondes.");
          times.push(now);
          const parsed = commands[name].safeParse(payload);
          if (!parsed.success)
            throw new GameError(
              parsed.error.issues[0]?.message ?? "Commande invalide.",
            );
          if (name === "stream:watch") {
            if (socket.data.code || socket.data.streamId)
              throw new GameError("Utilisez une connexion dédiée à l’overlay.");
            const token = commands[name].parse(payload).token;
            const room = engine.streamRoom(token);
            if (!room)
              throw new GameError("Lien spectateur invalide ou expiré.");
            socket.data.streamId = room.id;
            socket.data.streamTokenHash = hash(token);
            await socket.join(`stream:${room.id}`);
            socket.emit("stream:state", engine.streamView(room));
            ack({ ok: true });
            return;
          }
          if (socket.data.streamId)
            throw new GameError("Cette connexion est en lecture seule.");
          if (
            name === "room:create" ||
            name === "room:join" ||
            name === "room:resume"
          ) {
            if (socket.data.code || socket.data.entering)
              throw new GameError(
                "Quittez votre salon actuel avant d’en rejoindre un autre.",
              );
            socket.data.entering = true;
            acquired = true;
            if (name === "room:resume") {
              const data = commands[name].parse(payload);
              const room = engine.get(data.code);
              const digest = hash(data.token);
              const old = room.players.find((p) => p.tokenHash === digest);
              const oldSocket = old?.socketId;
              const result = engine.resume(data.code, data.token, socket.id);
              if (oldSocket && oldSocket !== socket.id) {
                const previous = io.sockets.sockets.get(oldSocket);
                if (previous) {
                  previous.data.code = null;
                  previous.emit("session:replaced");
                  previous.disconnect(true);
                }
              }
              await attach(socket, result.room, result.player);
              ack({
                ok: true,
                session: {
                  code: room.code,
                  playerId: result.player.id,
                  token: data.token,
                },
              });
              broadcast(room);
              return;
            }
            const data =
              name === "room:create"
                ? commands["room:create"].parse(payload)
                : commands["room:join"].parse(payload);
            const user = await authUser(
              app.parseCookie(socket.handshake.headers.cookie ?? "").account,
            );
            if (!socket.connected)
              throw new GameError("Connexion interrompue.");
            const result =
              name === "room:create"
                ? engine.create(data.nickname, socket.id, user?.id)
                : engine.join(
                    commands["room:join"].parse(payload).code,
                    data.nickname,
                    socket.id,
                    user?.id,
                    commands["room:join"].parse(payload).spectator,
                  );
            await attach(socket, result.room, result.player);
            ack({ ok: true, session: result.session });
            io.to(result.room.code).emit("room:player:joined", {
              playerId: result.player.id,
            });
            broadcast(result.room);
            return;
          }
          const { room, player } = identity(socket);
          switch (name) {
            case "room:preview": {
              const settings = commands[name].parse(payload);
              if (!settings.packIds.every((id) => room.packs.has(id)))
                throw new GameError("Pack non attaché.");
              const preview = { ...room, settings };
              const pool = engine.pool(preview);
              ack({
                ok: true,
                counts: {
                  available: pool.length,
                  remaining: pool.filter((w) => engine.isUnseen(room, w))
                    .length,
                },
              });
              return;
            }
            case "room:preferences": {
              const data = commands[name].parse(payload);
              engine.preferences(
                room,
                player,
                data.categories,
                data.subcategories,
              );
              break;
            }
            case "room:participate":
              engine.participate(
                room,
                player,
                commands[name].parse(payload).queued,
              );
              break;
            case "words:reset":
              engine.resetWords(room, player);
              break;
            case "game:pass":
              engine.pass(
                room,
                player,
                commands[name].parse(payload).roundIndex,
              );
              break;
            case "tournament:reset":
              engine.resetTournament(room, player);
              break;
            case "pack:attach": {
              const who = await library.owner({
                cookies: app.parseCookie(socket.handshake.headers.cookie ?? ""),
              } as import("fastify").FastifyRequest);
              const record = await library.store.packFor(
                commands[name].parse(payload).packId,
                who.key,
              );
              engine.attachPack(room, player, record);
              break;
            }
            case "stream:create": {
              const token = engine.streamLink(room, player);
              for (const stream of io.sockets.sockets.values())
                if (stream.data.streamId === room.id) {
                  stream.emit("stream:expired");
                  stream.disconnect(true);
                }
              ack({ ok: true, streamToken: token });
              return;
            }

            case "room:leave":
              engine.leave(room, player);
              await socket.leave(room.code);
              socket.data.code = null;
              io.to(room.code).emit("room:player:left", {
                playerId: player.id,
              });
              break;
            case "room:ready":
              if (room.phase !== "lobby")
                throw new GameError("La manche a déjà commencé.");
              if (player.spectator)
                throw new GameError(
                  "Un spectateur ne peut pas se déclarer prêt.",
                );
              player.ready = commands[name].parse(payload).ready;
              break;
            case "room:kick": {
              engine.host(room, player);
              if (room.phase !== "lobby")
                throw new GameError(
                  "Expulsion disponible dans le salon uniquement.",
                );
              const target = room.players.find(
                (p) => p.id === commands[name].parse(payload).playerId,
              );
              if (!target || target.id === player.id)
                throw new GameError("Joueur invalide.");
              if (target.socketId) {
                const targetSocket = io.sockets.sockets.get(target.socketId);
                if (targetSocket) {
                  targetSocket.emit("room:kicked");
                  await targetSocket.leave(room.code);
                  targetSocket.data.code = null;
                }
              }
              engine.leave(room, target);
              break;
            }
            case "room:settings:update":
              engine.settings(room, player, commands[name].parse(payload));
              break;
            case "game:start":
              engine.start(room, player);
              break;
            case "game:card:request": {
              const card = engine.card(room, player);
              if (card) socket.emit("game:private-card", card);
              break;
            }
            case "game:discussion":
              engine.discussion(room, player);
              break;
            case "game:vote":
              engine.beginVote(room, player);
              break;
            case "vote:cast": {
              const data = commands[name].parse(payload);
              if (data.roundIndex !== room.round?.index)
                throw new GameError(
                  "Cette commande appartient à une autre manche.",
                );
              engine.vote(room, player, data.targetPlayerId, data.ballotIndex);
              break;
            }
            case "spy:guess":
              if (
                commands[name].parse(payload).roundIndex !== room.round?.index
              )
                throw new GameError(
                  "Cette commande appartient à une autre manche.",
                );
              engine.guess(room, player, commands[name].parse(payload).word);
              break;
            case "game:rematch":
              engine.rematch(room, player);
              break;
            case "chat:send": {
              if (!["lobby", "discussion", "results"].includes(room.phase))
                throw new GameError("Le chat est fermé pendant cette phase.");
              if (
                room.round?.eliminated.has(player.id) &&
                room.phase === "discussion"
              )
                throw new GameError("Vous êtes éliminé.");
              if (player.spectator && room.phase === "discussion")
                throw new GameError(
                  "Le chat des spectateurs est fermé pendant une manche.",
                );
              chats = chats.filter((t) => now - t < 5000);
              if (chats.length >= 3)
                throw new GameError(
                  "Trois messages maximum toutes les 5 secondes.",
                );
              chats.push(now);
              const message = {
                id: randomUUID(),
                playerId: player.id,
                nickname: player.nickname,
                body: commands[name].parse(payload).body,
                createdAt: now,
              };
              room.messages.push(message);
              room.messages = room.messages.slice(-100);
              io.to(room.code).emit("chat:message", message);
              break;
            }
          }
          ack({ ok: true });
          broadcast(room);
        } catch (err) {
          const message =
            err instanceof GameError
              ? err.message
              : "Une erreur est survenue. Réessayez.";
          if (!(err instanceof GameError)) app.log.error({ err });
          ack({ ok: false, error: message });
          socket.emit("error", { message });
        }
      });
    socket.on("disconnect", () => {
      try {
        const { room, player } = identity(socket);
        engine.disconnect(room, player);
        broadcast(room);
      } catch {
        /* The identity may already have left or moved to another socket. */
      }
    });
  });
  const tick = setInterval(() => {
    for (const room of engine.rooms.values()) {
      const before = JSON.stringify(engine.view(room), (key, value) =>
        key === "serverNow" ? undefined : value,
      );
      engine.tick(room);
      const after = JSON.stringify(engine.view(room), (key, value) =>
        key === "serverNow" ? undefined : value,
      );
      if (before !== after) broadcast(room);
      if (room.phase === "results") void persist(room);
      io.to(`stream:${room.id}`).emit("stream:state", engine.streamView(room));
      if (!engine.rooms.has(room.code))
        for (const stream of io.sockets.sockets.values())
          if (stream.data.streamId === room.id) {
            stream.emit("stream:expired");
            stream.disconnect(true);
          }
    }
  }, 500);
  tick.unref();
  const cleanup = setInterval(() => {
    void library.store.expireGuests().catch((err) => app.log.error({ err }));
    if (db)
      void db
        .$transaction([
          db.accountSession.deleteMany({
            where: { expiresAt: { lt: new Date() } },
          }),
          db.room.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        ])
        .catch((err) => app.log.error({ err }));
  }, 3600000);
  cleanup.unref();
  const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Route introuvable." })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    clearInterval(tick);
    clearInterval(cleanup);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await db?.$disconnect();
  });
  return { app, io, engine };
}
