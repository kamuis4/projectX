import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createServer } from "./server";
import type { PartyAck, PartySession, PartyView } from "@spyfall/shared";
let server: Awaited<ReturnType<typeof createServer>>, url: string;
const sockets: Socket[] = [];
const views = new Map<string, PartyView>();
async function client() {
  const socket = connect(`${url}/party`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  socket.on("party:state", (view: PartyView) => views.set(socket.id!, view));
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  return socket;
}
function command(
  socket: Socket,
  event: string,
  payload: unknown = {},
): Promise<PartyAck> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(3000)
      .emit(event, payload, (err: Error | null, ack: PartyAck) =>
        err ? reject(err) : resolve(ack),
      ),
  );
}
function session(ack: PartyAck): PartySession {
  expect(ack.ok).toBe(true);
  if (!ack.ok || !ack.session) throw Error("No session");
  return ack.session;
}
async function waitFor(
  socket: Socket,
  predicate: (view: PartyView) => boolean,
) {
  const current = views.get(socket.id!);
  if (current && predicate(current)) return current;
  return new Promise<PartyView>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("party:state", handler);
      reject(Error("No matching state"));
    }, 2000);
    const handler = (view: PartyView) => {
      if (predicate(view)) {
        clearTimeout(timer);
        socket.off("party:state", handler);
        resolve(view);
      }
    };
    socket.on("party:state", handler);
  });
}
beforeAll(async () => {
  server = await createServer({ databaseUrl: "" });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await server.app.close();
});
describe("Hub Socket.IO : isolation et parties réelles", () => {
  it("termine Wavelength, garde les cibles secrètes sur le réseau et change de jeu dans le même salon", async () => {
    const a = await client(),
      b = await client();
    const host = session(
      await command(a, "party:create", { name: "Alice", game: "wavelength" }),
    );
    const guest = session(
      await command(b, "party:join", { name: "Benoit", code: host.code }),
    );
    expect((await command(b, "party:action", { type: "start" })).ok).toBe(
      false,
    );
    expect((await command(a, "party:action", { type: "start" })).ok).toBe(true);
    for (let round = 1; round <= 4; round++) {
      const state = await waitFor(
        a,
        (v) => v.round === round && v.phase === "clue",
      );
      const guide = state.wave!.speakerId === host.playerId ? a : b,
        guesser = guide === a ? b : a;
      const secret = await waitFor(
        guide,
        (v) => v.round === round && v.phase === "clue",
      );
      const publicState = await waitFor(
        guesser,
        (v) => v.round === round && v.phase === "clue",
      );
      expect(publicState.wave!.target).toBeUndefined();
      expect(publicState.wave!.guesses).toBeUndefined();
      expect(
        (
          await command(guide, "party:action", {
            type: "clue",
            text: "Un bon exemple",
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await command(guesser, "party:action", {
            type: "guess",
            value: secret.wave!.target,
          })
        ).ok,
      ).toBe(true);
      const result = await waitFor(
        guesser,
        (v) => v.phase === "wave-result" && v.round === round,
      );
      expect(result.wave!.target).toBe(secret.wave!.target);
      expect((await command(a, "party:action", { type: "next" })).ok).toBe(
        true,
      );
    }
    const done = await waitFor(b, (v) => v.phase === "finished");
    expect(done.players.every((p) => p.score === 16)).toBe(true);
    await command(a, "party:action", { type: "reset" });
    await command(a, "party:action", { type: "game", game: "bluff" });
    const switched = await waitFor(b, (v) => v.game === "bluff");
    expect(switched.code).toBe(guest.code);
    expect(switched.players).toHaveLength(2);
  });
  it("applique le bluff sans révéler la carte dans les états des autres joueurs", async () => {
    const a = await client(),
      b = await client(),
      c = await client();
    const host = session(
      await command(a, "party:create", { name: "Alice", game: "bluff" }),
    );
    const guest = session(
      await command(b, "party:join", { name: "Benoit", code: host.code }),
    );
    await command(c, "party:join", { name: "Chloe", code: host.code });
    await command(a, "party:action", { type: "start" });
    const privateState = await waitFor(a, (v) => v.phase === "questions");
    const publicState = await waitFor(b, (v) => v.phase === "questions");
    expect(privateState.bluff!.card).toBeDefined();
    expect(publicState.bluff!.card).toBeUndefined();
    expect(
      (await waitFor(c, (v) => v.phase === "questions")).bluff!.card,
    ).toBeUndefined();
    expect(
      (await command(c, "party:action", { type: "ask", question: "high" })).ok,
    ).toBe(false);
    expect((await command(b, "party:action", { type: "answer" })).ok).toBe(
      false,
    );
    expect(
      (await command(b, "party:action", { type: "choose", choice: "take" })).ok,
    ).toBe(false);
    for (const question of ["high", "even"]) {
      expect(
        (await command(b, "party:action", { type: "ask", question })).ok,
      ).toBe(true);
      expect(
        (await command(a, "party:action", { type: "answer", answer: false }))
          .ok,
      ).toBe(false);
      expect((await command(a, "party:action", { type: "answer" })).ok).toBe(
        true,
      );
    }
    expect(
      (await command(b, "party:action", { type: "choose", choice: "take" })).ok,
    ).toBe(true);
    const revealed = await waitFor(c, (v) => v.phase === "bluff-result");
    expect(revealed.bluff!.card!.id).toBe(privateState.bluff!.card!.id);
    expect(revealed.players.find((p) => p.id === guest.playerId)!.score).toBe(
      privateState.bluff!.card!.value,
    );
    expect(JSON.stringify(revealed)).not.toContain("tokenHash");
  });
  it("rejette les commandes mal formées, isole les salons et reprend une session", async () => {
    const a = await client(),
      b = await client(),
      stranger = await client();
    const host = session(
      await command(a, "party:create", { name: "Alice", game: "auction" }),
    );
    await command(b, "party:join", { name: "Benoit", code: host.code });
    session(
      await command(stranger, "party:create", { name: "Chloe", game: "bluff" }),
    );
    expect(
      (await command(a, "party:create", { name: "Encore", game: "bluff" })).ok,
    ).toBe(false);
    expect(
      (await command(a, "party:action", { type: "bid", amount: -10 })).ok,
    ).toBe(false);
    expect(
      (await command(a, "party:action", { type: "guess", value: 101 })).ok,
    ).toBe(false);
    expect(
      (await command(a, "party:action", { type: "clue", text: "<script>" })).ok,
    ).toBe(false);
    const invalid = await client();
    expect(
      (
        await command(invalid, "party:resume", {
          ...host,
          token: "a".repeat(64),
        })
      ).ok,
    ).toBe(false);
    const resumed = await client();
    expect((await command(resumed, "party:resume", host)).ok).toBe(true);
    const state = await waitFor(resumed, (v) => v.code === host.code);
    expect(state.players.find((p) => p.id === host.playerId)!.connected).toBe(
      true,
    );
    expect((await command(resumed, "party:action", { type: "start" })).ok).toBe(
      true,
    );
    await waitFor(b, (v) => v.phase === "bidding");
    expect(views.get(stranger.id!)!.game).toBe("bluff");
    expect(views.get(stranger.id!)!.phase).toBe("lobby");
    expect((await command(resumed, "party:leave")).ok).toBe(true);
    const lobby = await waitFor(
      b,
      (v) => v.phase === "lobby" && v.players.length === 1,
    );
    expect(lobby.hostId).not.toBe(host.playerId);
  });
});
