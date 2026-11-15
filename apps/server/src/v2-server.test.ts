import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createServer } from "./server";
import { Engine } from "./engine";
import {
  defaultSettings,
  type Ack,
  type Card,
  type StreamView,
  type Library,
  type WordPack,
} from "@spyfall/shared";
let server: Awaited<ReturnType<typeof createServer>>, url: string, now: number;
let sockets: Socket[] = [];
const pack: WordPack = {
  version: 1,
  name: "Astres privés",
  description: "Pack de test",
  words: [
    {
      label: "Soleil",
      category: "Astronomie",
      subcategory: "Espace",
      difficulty: "easy",
      variants: ["Sun"],
    },
    {
      label: "Lune",
      category: "Astronomie",
      subcategory: "Espace",
      difficulty: "medium",
      variants: ["Moon"],
    },
  ],
};
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
function event<T>(
  socket: Socket,
  name: string,
  predicate: (value: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error("Événement absent : " + name));
    }, 4000);
    const handler = (value: T) => {
      if (predicate(value)) {
        clearTimeout(timer);
        socket.off(name, handler);
        resolve(value);
      }
    };
    socket.on(name, handler);
  });
}
async function client(cookie = "") {
  const socket = io(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: cookie ? { cookie } : undefined,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
async function libraryCookie() {
  const response = await server.app.inject("/api/library");
  expect(response.statusCode).toBe(200);
  return String(response.headers["set-cookie"]).split(";")[0];
}
async function room3(cookie = "") {
  const clients = await Promise.all([client(cookie), client(), client()]);
  const ack = await command(clients[0], "room:create", { nickname: "Alice" });
  if (!ack.ok || !ack.session) throw Error("session");
  for (let i = 1; i < 3; i++)
    await command(clients[i], "room:join", {
      nickname: `Joueur ${i}`,
      code: ack.session.code,
    });
  return {
    clients,
    session: ack.session,
    room: server.engine.get(ack.session.code),
  };
}
beforeEach(async () => {
  now = 1000;
  server = await createServer({
    databaseUrl: "",
    engine: new Engine(
      () => now,
      () => 0,
    ),
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterEach(async () => {
  sockets.forEach((s) => s.disconnect());
  sockets = [];
  await server.app.close();
});
describe("V2 · API bibliothèque et sockets", () => {
  it("isole les packs privés et en attente et utilise seulement un instantané autorisé", async () => {
    const owner = await libraryCookie(),
      stranger = await libraryCookie();
    const created = await server.app.inject({
      method: "POST",
      url: "/api/packs",
      headers: { cookie: owner },
      payload: pack,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(
      (
        await server.app.inject({
          url: `/api/packs/${id}`,
          headers: { cookie: stranger },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.app.inject({
          url: `/api/packs/${id}`,
          headers: { cookie: owner },
        })
      ).json(),
    ).toEqual(pack);
    const f = await room3(owner);
    expect(
      (await command(f.clients[1], "pack:attach", { packId: id })).ok,
    ).toBe(false);
    expect(
      (await command(f.clients[0], "pack:attach", { packId: id })).ok,
    ).toBe(true);
    await server.app.inject({
      method: "POST",
      url: `/api/packs/${id}/submit`,
      headers: { cookie: owner },
    });
    const publicLibrary = (
      await server.app.inject({
        url: "/api/library",
        headers: { cookie: stranger },
      })
    ).json<Library>();
    expect(publicLibrary.catalog).toHaveLength(0);
    expect(publicLibrary.queue).toHaveLength(0);
    expect(
      (
        await server.app.inject({
          method: "POST",
          url: `/api/packs/${id}/moderate`,
          headers: { cookie: owner },
          payload: { status: "approved", revision: 1 },
        })
      ).statusCode,
    ).toBe(403);
    const settings = {
      ...defaultSettings,
      categories: ["Astronomie"],
      includeOfficial: false,
      packIds: [id],
    };
    expect(
      (await command(f.clients[0], "room:settings:update", settings)).ok,
    ).toBe(true);
    const preview = await command(f.clients[0], "room:preview", {
      ...settings,
      difficulty: "hard",
    });
    expect(preview.ok && preview.counts?.available).toBe(0);
    expect(f.room.settings.difficulty).toBe("all");
    for (const c of f.clients) await command(c, "room:ready", { ready: true });
    const cards = f.clients.map((c) => event<Card>(c, "game:private-card"));
    await command(f.clients[0], "game:start");
    const dealt = await Promise.all(cards);
    expect(dealt[0]).not.toHaveProperty("word");
    expect(dealt[1].word).toBe("Soleil");
    expect(JSON.stringify(server.engine.view(f.room))).not.toContain("Soleil");
    const other = await client(stranger);
    const joined = await command(other, "room:join", {
      nickname: "Étranger",
      code: f.session.code,
      spectator: true,
    });
    expect(joined.ok).toBe(true);
    expect((await command(other, "pack:attach", { packId: id })).ok).toBe(
      false,
    );
  });
  it("restaure un spectateur, refuse carte et vote et le promeut à la prochaine manche", async () => {
    const f = await room3();
    for (const c of f.clients) await command(c, "room:ready", { ready: true });
    await command(f.clients[0], "game:start");
    const spec = await client();
    const received: Card[] = [];
    spec.on("game:private-card", (card) => received.push(card));
    const ack = await command(spec, "room:join", {
      nickname: "Observateur",
      code: f.session.code,
      spectator: true,
    });
    if (!ack.ok || !ack.session) throw Error("spectateur");
    await command(spec, "game:card:request");
    expect(received).toHaveLength(0);
    expect((await command(spec, "room:ready", { ready: true })).ok).toBe(false);
    await command(f.clients[0], "game:discussion");
    expect(
      (await command(spec, "chat:send", { body: "Aide extérieure" })).ok,
    ).toBe(false);
    await command(f.clients[0], "game:vote");
    expect(
      (
        await command(spec, "vote:cast", {
          targetPlayerId: f.session.playerId,
          roundIndex: 1,
          ballotIndex: 1,
        })
      ).ok,
    ).toBe(false);
    expect((await command(spec, "room:participate", { queued: true })).ok).toBe(
      true,
    );
    spec.disconnect();
    const restored = await client();
    const leaked: Card[] = [];
    restored.on("game:private-card", (c) => leaked.push(c));
    expect(
      (
        await command(restored, "room:resume", {
          token: ack.session.token,
          code: f.session.code,
        })
      ).ok,
    ).toBe(true);
    expect(leaked).toHaveLength(0);
    for (const c of f.clients)
      await command(c, "vote:cast", {
        targetPlayerId: f.session.playerId,
        ballotIndex: 1,
        roundIndex: 1,
      });
    await command(f.clients[0], "spy:guess", {
      word: "incorrect",
      roundIndex: 1,
    });
    await command(f.clients[0], "game:rematch");
    expect(
      f.room.players.find((p) => p.id === ack.session!.playerId)?.spectator,
    ).toBe(false);
    for (const c of [...f.clients, restored])
      await command(c, "room:ready", { ready: true });
    const newCard = event<Card>(restored, "game:private-card");
    await command(f.clients[0], "game:start");
    expect((await newCard).roundIndex).toBe(2);
  });
  it("retrouve et réutilise les presets dans un autre salon sans les partager aux autres visiteurs", async () => {
    const owner = await libraryCookie(),
      other = await libraryCookie();
    const settings = {
      ...defaultSettings,
      mode: "double",
      spyCount: 2,
      rounds: 6,
      tournament: true,
      anonymousVotes: false,
      allowPass: true,
      duration: 7,
    };
    const created = await server.app.inject({
      method: "POST",
      url: "/api/presets",
      headers: { cookie: owner },
      payload: { name: "Soirée tournoi", settings },
    });
    expect(created.statusCode).toBe(200);
    const owned = (
      await server.app.inject({
        url: "/api/library",
        headers: { cookie: owner },
      })
    ).json<Library>();
    expect(owned.presets[0].settings).toEqual(settings);
    expect(
      (
        await server.app.inject({
          url: "/api/library",
          headers: { cookie: other },
        })
      ).json<Library>().presets,
    ).toHaveLength(0);
    const host = await client(owner);
    await command(host, "room:create", { nickname: "Alice" });
    await command(host, "room:leave");
    const second = await command(host, "room:create", { nickname: "Alice" });
    if (!second.ok || !second.session) throw Error("session");
    expect(
      (await command(host, "room:settings:update", owned.presets[0].settings))
        .ok,
    ).toBe(true);
    expect(server.engine.get(second.session.code).settings.rounds).toBe(6);
  });
  it("valide les imports JSON, refuse HTML, doublons, variantes ambiguës et champs inconnus", async () => {
    const cookie = await libraryCookie();
    for (const invalid of [
      { ...pack, name: "<script>" },
      { ...pack, words: [pack.words[0], pack.words[0]] },
      { ...pack, words: [{ ...pack.words[0], variants: ["SOLEIL"] }] },
      { ...pack, approved: true },
    ]) {
      const res = await server.app.inject({
        method: "POST",
        url: "/api/packs",
        headers: { cookie },
        payload: invalid,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(
      (
        await server.app.inject({
          method: "PUT",
          url: "/api/packs/fake",
          headers: { cookie },
          payload: pack,
        })
      ).statusCode,
    ).toBe(400);
  });
});
describe("V2 · connexion OBS en lecture seule", () => {
  it("ne reçoit jamais carte ou état de salon et ne peut pas devenir joueur ou voter", async () => {
    const f = await room3();
    const ack = await command(f.clients[0], "stream:create");
    if (!ack.ok || !ack.streamToken) throw Error("lien");
    const observer = await client();
    const privateEvents: unknown[] = [];
    observer.on("room:state", (v) => privateEvents.push(v));
    observer.on("game:private-card", (v) => privateEvents.push(v));
    const stream = event<StreamView>(observer, "stream:state");
    expect(
      (await command(observer, "stream:watch", { token: ack.streamToken })).ok,
    ).toBe(true);
    const state = await stream;
    expect(state).not.toHaveProperty("roomCode");
    expect(state).not.toHaveProperty("messages");
    expect(
      (
        await command(observer, "room:join", {
          nickname: "Intrus",
          code: f.session.code,
        })
      ).ok,
    ).toBe(false);
    expect((await command(observer, "game:card:request")).ok).toBe(false);
    expect(
      (
        await command(observer, "vote:cast", {
          targetPlayerId: f.session.playerId,
          ballotIndex: 1,
          roundIndex: 1,
        })
      ).ok,
    ).toBe(false);
    expect(privateEvents).toHaveLength(0);
    const expired = event(observer, "stream:expired");
    await command(f.clients[0], "stream:create");
    await expired;
  });
  it("diffère réellement les résultats transmis par socket et cache les scores jusque-là", async () => {
    const f = await room3();
    await command(f.clients[0], "room:settings:update", {
      ...defaultSettings,
      streamDelay: 30,
      streamPrivacy: false,
    });
    const link = await command(f.clients[0], "stream:create");
    if (!link.ok) throw Error("lien");
    const observer = await client();
    await command(observer, "stream:watch", { token: link.streamToken });
    for (const c of f.clients) await command(c, "room:ready", { ready: true });
    await command(f.clients[0], "game:start");
    await command(f.clients[0], "game:discussion");
    await command(f.clients[0], "game:vote");
    for (const c of f.clients)
      await command(c, "vote:cast", {
        targetPlayerId: f.session.playerId,
        ballotIndex: 1,
        roundIndex: 1,
      });
    const waiting = event<StreamView>(
      observer,
      "stream:state",
      (v) => v.phase === "results",
    );
    await command(f.clients[0], "spy:guess", {
      word: "incorrect",
      roundIndex: 1,
    });
    const held = await waiting;
    expect(held.result).toBeNull();
    expect(held.players.map((p) => p.score)).toEqual([0, 0, 0]);
    const released = event<StreamView>(
      observer,
      "stream:state",
      (v) => !!v.result,
    );
    now += 30000;
    await command(f.clients[0], "game:card:request");
    expect((await released).result?.word).toBe(f.room.round!.word.label);
  });
});
