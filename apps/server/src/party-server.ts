import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { nicknameSchema, partyGames, type PartyAck } from "@spyfall/shared";
import { PartyEngine, PartyError, type TableRoom } from "./party-engine";
const game = z.enum(partyGames);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^H[A-F0-9]{5}$/, "Code de salon invalide.");
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("game"), game }).strict(),
  z
    .object({
      type: z.literal("criterion"),
      criterion: z.enum(["fight", "smart", "style"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("clue"),
      text: z
        .string()
        .trim()
        .min(2)
        .max(100)
        .refine(
          (v) => !/[<>]/.test(v) && [...v].every((c) => c.charCodeAt(0) >= 32),
          "Indice invalide.",
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal("guess"),
      value: z.number().int().min(0).max(100),
    })
    .strict(),
  z.object({ type: z.literal("next") }).strict(),
  z
    .object({
      type: z.literal("bid"),
      amount: z.number().int().min(10).max(100),
    })
    .strict(),
  z.object({ type: z.literal("pass") }).strict(),
  z.object({ type: z.literal("vote"), playerId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal("ask"),
      question: z.enum(["high", "even", "strong", "smart", "anime", "hero"]),
    })
    .strict(),
  z.object({ type: z.literal("answer") }).strict(),
  z
    .object({ type: z.literal("choose"), choice: z.enum(["take", "leave"]) })
    .strict(),
  z.object({ type: z.literal("reset") }).strict(),
  z.object({ type: z.literal("remove"), playerId: z.string().uuid() }).strict(),
]);
export function registerParty(io: Server, engine = new PartyEngine()) {
  const namespace = io.of("/party");
  const identity = (socket: Socket) => {
    const room = engine.rooms.get(socket.data.partyCode);
    const player = room?.players.find(
      (p) => p.id === socket.data.partyPlayerId && p.socketId === socket.id,
    );
    if (!room || !player)
      throw new PartyError("Rejoignez un salon pour jouer.");
    return { room, player };
  };
  const broadcast = (room: TableRoom) => {
    for (const p of room.players)
      if (p.socketId)
        namespace.sockets
          .get(p.socketId)
          ?.emit("party:state", engine.view(room, p.id));
  };
  namespace.on("connection", (socket) => {
    let requests = 0,
      windowAt = Date.now();
    const handle = (name: string, fn: (payload: unknown) => PartyAck) =>
      socket.on(name, (payload: unknown, ack?: (value: PartyAck) => void) => {
        if (typeof ack !== "function") return;
        try {
          if (Date.now() - windowAt > 5000) {
            requests = 0;
            windowAt = Date.now();
          }
          if (++requests > 30)
            throw new PartyError(
              "Trop d’actions. Patientez quelques secondes.",
            );
          ack(fn(payload));
        } catch (err) {
          ack({
            ok: false,
            error:
              err instanceof PartyError
                ? err.message
                : err instanceof z.ZodError
                  ? "Données invalides. Vérifiez les champs."
                  : "L’action a échoué. Réessayez.",
          });
        }
      });
    const available = () => {
      if (socket.data.partyPlayerId)
        throw new PartyError("Vous êtes déjà dans un salon.");
    };
    const bind = (room: TableRoom, playerId: string) => {
      socket.data.partyCode = room.code;
      socket.data.partyPlayerId = playerId;
      broadcast(room);
    };
    handle("party:create", (payload) => {
      available();
      const data = z
        .object({ name: nicknameSchema, game })
        .strict()
        .parse(payload);
      const { room, player, session } = engine.create(
        data.name,
        socket.id,
        data.game,
      );
      bind(room, player.id);
      return { ok: true, session };
    });
    handle("party:join", (payload) => {
      available();
      const data = z
        .object({ name: nicknameSchema, code })
        .strict()
        .parse(payload);
      const { room, player, session } = engine.join(
        data.code,
        data.name,
        socket.id,
      );
      bind(room, player.id);
      return { ok: true, session };
    });
    handle("party:resume", (payload) => {
      available();
      const session = z
        .object({
          code,
          playerId: z.string().uuid(),
          token: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(payload);
      const { room, player, previousSocketId } = engine.resume(
        session,
        socket.id,
      );
      if (previousSocketId && previousSocketId !== socket.id) {
        const previous = namespace.sockets.get(previousSocketId);
        previous?.emit("party:replaced");
        previous?.disconnect();
      }
      bind(room, player.id);
      return { ok: true, session };
    });
    handle("party:action", (payload) => {
      const { room, player } = identity(socket);
      engine.action(room, player, actionSchema.parse(payload));
      broadcast(room);
      return { ok: true };
    });
    handle("party:leave", (payload) => {
      z.object({}).strict().parse(payload);
      const { room, player } = identity(socket);
      engine.leave(room, player);
      delete socket.data.partyCode;
      delete socket.data.partyPlayerId;
      broadcast(room);
      return { ok: true };
    });
    socket.on("disconnect", () => {
      try {
        const { room, player } = identity(socket);
        engine.disconnect(room, player);
        broadcast(room);
      } catch {
        /* Already left or replaced. */
      }
    });
  });
  const timer = setInterval(() => {
    const before = new Map(
      [...engine.rooms].map(([code, room]) => [code, room.players.length]),
    );
    engine.tick();
    for (const room of engine.rooms.values())
      if (before.get(room.code) !== room.players.length) broadcast(room);
    for (const socket of namespace.sockets.values())
      if (socket.data.partyCode && !engine.rooms.has(socket.data.partyCode)) {
        delete socket.data.partyCode;
        delete socket.data.partyPlayerId;
        socket.emit("party:expired");
      }
  }, 1000);
  timer.unref();
  return { engine, close: () => clearInterval(timer) };
}
