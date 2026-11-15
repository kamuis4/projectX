import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createServer } from "./server";
import { Engine } from "./engine";
import type { Ack, Card, RoomView } from "@spyfall/shared";
let server: Awaited<ReturnType<typeof createServer>>;
let url: string;
const sockets: Socket[] = [];
async function client() {
  const socket = connect(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  return socket;
}
function command(
  socket: Socket,
  name: string,
  data: unknown = {},
): Promise<Ack> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(3000)
      .emit(name, data, (err: Error | null, ack: Ack) =>
        err ? reject(err) : resolve(ack),
      ),
  );
}
function event<T>(
  socket: Socket,
  name: string,
  predicate: (value: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve) => {
    const handler = (value: T) => {
      if (predicate(value)) {
        socket.off(name, handler);
        resolve(value);
      }
    };
    socket.on(name, handler);
  });
}
beforeAll(async () => {
  server = await createServer({
    engine: new Engine(
      () => Date.now(),
      () => 0,
    ),
    databaseUrl: "",
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.app.close();
});
describe("Socket.IO : parcours multijoueur réel", () => {
  it("refuse les créations concurrentes sur une même connexion", async () => {
    const c = await client();
    const before = server.engine.rooms.size;
    const results = await Promise.all([
      command(c, "room:create", { nickname: "Alice" }),
      command(c, "room:create", { nickname: "Alice" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(server.engine.rooms.size).toBe(before + 1);
  });

  for (const count of [3, 6, 12])
    it(`${count} joueurs : créer, rejoindre, discuter, voter, résultats et revanche`, async () => {
      const clients = await Promise.all(
        Array.from({ length: count }, () => client()),
      );
      const created = await command(clients[0], "room:create", {
        nickname: "Alice",
      });
      expect(created.ok).toBe(true);
      if (!created.ok || !created.session) throw Error("session");
      const session = created.session;
      const sessions = [session];
      for (let i = 1; i < count; i++) {
        const joined = await command(clients[i], "room:join", {
          nickname: `Ami ${i}`,
          code: session.code,
        });
        if (!joined.ok || !joined.session) throw Error("join");
        sessions.push(joined.session);
      }
      await Promise.all(
        clients.map((c) => command(c, "room:ready", { ready: true })),
      );
      const cards = clients.map((c) => event<Card>(c, "game:private-card"));
      const publicState = event<RoomView>(clients[1], "room:state");
      expect((await command(clients[0], "game:start")).ok).toBe(true);
      const privateCards = await Promise.all(cards);
      const state = await publicState;
      expect(privateCards[0].role).toBe("spy");
      expect(privateCards[0]).not.toHaveProperty("word");
      expect(privateCards[1].word).toBeTruthy();
      expect(JSON.stringify(state)).not.toContain(privateCards[1].word);
      expect(state.players).toHaveLength(count);
      expect((await command(clients[0], "game:discussion")).ok).toBe(true);
      const message = event<{ body: string }>(clients[1], "chat:message");
      expect(
        (await command(clients[0], "chat:send", { body: "Est-ce connu ?" })).ok,
      ).toBe(true);
      expect((await message).body).toBe("Est-ce connu ?");
      expect((await command(clients[0], "game:vote")).ok).toBe(true);
      expect(
        (
          await command(clients[0], "vote:cast", {
            targetPlayerId: session.playerId,
            ballotIndex: 1,
            roundIndex: 2,
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await command(clients[1], "chat:send", {
            body: "Interdit pendant le vote",
          })
        ).ok,
      ).toBe(false);
      for (const c of clients)
        expect(
          (
            await command(c, "vote:cast", {
              targetPlayerId: session.playerId,
              ballotIndex: 1,
              roundIndex: 1,
            })
          ).ok,
        ).toBe(true);
      const result = event<RoomView>(
        clients[1],
        "room:state",
        (s) => s.phase === "results",
      );
      expect(
        (
          await command(clients[0], "spy:guess", {
            word: "réponse volontairement incorrecte",
            roundIndex: 1,
          })
        ).ok,
      ).toBe(true);
      const final = await result;
      expect(final.phase).toBe("results");
      expect(final.result?.word).toBe(privateCards[1].word);
      expect(final.result?.roles.filter((r) => r.points === 100)).toHaveLength(
        count - 1,
      );
      expect(
        (
          await command(clients[0], "spy:guess", {
            word: privateCards[1].word,
            roundIndex: 1,
          })
        ).ok,
      ).toBe(false);
      const rematch = event<RoomView>(
        clients[1],
        "room:state",
        (s) => s.phase === "lobby",
      );
      expect((await command(clients[0], "game:rematch")).ok).toBe(true);
      expect((await rematch).players).toHaveLength(count);
      await Promise.all(clients.map((c) => command(c, "room:leave")));
    });
  it("restaure une identité et son rôle après actualisation et bloque la prise d’identité", async () => {
    const a = await client(),
      b = await client(),
      c = await client();
    const ack = await command(a, "room:create", { nickname: "Alice" });
    if (!ack.ok || !ack.session) throw Error("session");
    const session = ack.session;
    await command(b, "room:join", { nickname: "Bob", code: session.code });
    await command(c, "room:join", { nickname: "Camille", code: session.code });
    for (const s of [a, b, c]) await command(s, "room:ready", { ready: true });
    const card = event<Card>(a, "game:private-card");
    await command(a, "game:start");
    const original = await card;
    a.disconnect();
    const replacement = await client();
    const restored = event<Card>(replacement, "game:private-card");
    expect(
      (
        await command(replacement, "room:resume", {
          token: session.token,
          code: session.code,
        })
      ).ok,
    ).toBe(true);
    expect(await restored).toEqual(original);
    const evil = await client();
    expect(
      (
        await command(evil, "room:resume", {
          code: session.code,
          token: "f".repeat(64),
        })
      ).ok,
    ).toBe(false);
    expect((await command(evil, "game:start")).ok).toBe(false);
  });
  it("valide les messages et limite le débit", async () => {
    const c = await client();
    await command(c, "room:create", { nickname: "Bavard" });
    expect(
      (await command(c, "chat:send", { body: "<img src=x onerror=alert(1)>" }))
        .ok,
    ).toBe(false);
    for (let i = 0; i < 3; i++)
      expect((await command(c, "chat:send", { body: `Bonjour ${i}` })).ok).toBe(
        true,
      );
    expect((await command(c, "chat:send", { body: "Spam" })).ok).toBe(false);
  });
  it("refuse deux démarrages concurrents et ne distribue pas un autre rôle", async () => {
    const clients = await Promise.all([client(), client(), client()]);
    const ack = await command(clients[0], "room:create", { nickname: "Hôte" });
    if (!ack.ok || !ack.session) throw Error("session");
    for (let i = 1; i < 3; i++)
      await command(clients[i], "room:join", {
        nickname: `Autre ${i}`,
        code: ack.session.code,
      });
    for (const c of clients) await command(c, "room:ready", { ready: true });
    const results = await Promise.all([
      command(clients[0], "game:start"),
      command(clients[0], "game:start"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(server.engine.get(ack.session.code).round?.index).toBe(1);
  });
  it("annonce les comptes désactivés et vérifie l’origine des requêtes", async () => {
    const health = await server.app.inject("/api/health");
    expect(health.json()).toEqual({ ok: true, accountsEnabled: false });
    const auth = await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "a@b.fr", password: "password123" },
    });
    expect(auth.statusCode).toBe(503);
    const cross = await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://evil.example" },
      payload: {},
    });
    expect(cross.statusCode).toBe(403);
  });
});
