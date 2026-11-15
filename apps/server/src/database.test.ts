import { describe, it, expect, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { createServer } from "./server";
import { Engine } from "./engine";
import type { Ack } from "@spyfall/shared";
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "PostgreSQL : comptes et résultats persistants",
  () => {
    it("inscrit, connecte, sauvegarde les scores une fois et supprime le compte", async () => {
      const db = new PrismaClient({ datasourceUrl: databaseUrl });
      const engine = new Engine(
        () => Date.now(),
        () => 0,
      );
      const server = await createServer({ engine, databaseUrl });
      const sockets: Socket[] = [];
      const email = `test-${randomUUID()}@example.fr`;
      let roomId: string | undefined;
      const command = (
        socket: Socket,
        name: string,
        data: unknown = {},
      ): Promise<Ack> =>
        new Promise((resolve, reject) =>
          socket
            .timeout(3000)
            .emit(name, data, (err: Error | null, ack: Ack) =>
              err ? reject(err) : resolve(ack),
            ),
        );
      try {
        await server.app.listen({ host: "127.0.0.1", port: 0 });
        const address = server.app.server.address();
        const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        const registered = await server.app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: { email, password: "correct-horse-42", username: "Alice" },
        });
        expect(registered.statusCode).toBe(200);
        const cookie = String(registered.headers["set-cookie"]).split(";")[0];
        expect(String(registered.headers["set-cookie"])).toContain("HttpOnly");
        expect(String(registered.headers["set-cookie"])).toContain(
          "SameSite=Strict",
        );
        expect(registered.json().user).not.toHaveProperty("passwordHash");
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        expect(user.passwordHash).toMatch(/^\$argon2id\$/);
        const invalid = await server.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email, password: "incorrect-password" },
        });
        expect(invalid.statusCode).toBe(401);
        const login = await server.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email, password: "correct-horse-42" },
        });
        expect(login.statusCode).toBe(200);
        const me = await server.app.inject({
          url: "/api/auth/me",
          headers: { cookie },
        });
        expect(me.json().user.username).toBe("Alice");
        for (let i = 0; i < 3; i++) {
          const socket = io(url, {
            transports: ["websocket"],
            forceNew: true,
            extraHeaders: i === 0 ? { cookie } : undefined,
          });
          sockets.push(socket);
          await new Promise<void>((resolve, reject) => {
            socket.on("connect", resolve);
            socket.on("connect_error", reject);
          });
        }
        const created = await command(sockets[0], "room:create", {
          nickname: "Alice",
        });
        if (!created.ok || !created.session) throw Error("session");
        const { code } = created.session;
        const room = engine.get(code);
        roomId = room.id;
        expect(room.players[0].userId).toBe(user.id);
        await command(sockets[1], "room:join", { nickname: "Bob", code });
        await command(sockets[2], "room:join", { nickname: "Camille", code });
        for (const socket of sockets)
          await command(socket, "room:ready", { ready: true });
        await command(sockets[0], "game:start");
        await command(sockets[0], "game:discussion");
        await command(sockets[0], "game:vote");
        for (const socket of sockets)
          await command(socket, "vote:cast", {
            targetPlayerId: created.session.playerId,
            ballotIndex: 1,
            roundIndex: 1,
          });
        await command(sockets[0], "spy:guess", {
          word: room.round!.word.label,
          roundIndex: 1,
        });
        await vi.waitFor(
          async () => {
            const stats = await server.app.inject({
              url: "/api/stats",
              headers: { cookie },
            });
            expect(stats.json().points).toBe(150);
            expect(stats.json().rounds).toBe(1);
          },
          { timeout: 5000 },
        );
        await command(sockets[0], "game:card:request");
        await command(sockets[0], "game:card:request");
        expect(
          await db.score.count({ where: { roundId: `${room.id}:1` } }),
        ).toBe(3);
        const deleted = await server.app.inject({
          method: "DELETE",
          url: "/api/auth/me",
          headers: { cookie },
        });
        expect(deleted.statusCode).toBe(200);
        expect(await db.user.count({ where: { email } })).toBe(0);
        expect(
          await db.accountSession.count({ where: { userId: user.id } }),
        ).toBe(0);
        expect(room.players[0].userId).toBeUndefined();
        const loggedOut = await server.app.inject({
          url: "/api/auth/me",
          headers: { cookie },
        });
        expect(loggedOut.json().user).toBeNull();
      } finally {
        sockets.forEach((s) => s.disconnect());
        await server.app.close();
        await db.user.deleteMany({ where: { email } });
        if (roomId) await db.room.deleteMany({ where: { id: roomId } });
        await db.$disconnect();
      }
    });
  },
);
