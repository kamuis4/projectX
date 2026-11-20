import { describe, expect, it } from "vitest";
import { PartyEngine, type TablePlayer } from "./party-engine";
import { characterDeck } from "./party-content";
import type { PartyGame } from "@spyfall/shared";
function fixture(game: PartyGame, n = 3) {
  let now = 1000;
  const engine = new PartyEngine(
    () => now,
    () => 0,
  );
  const created = engine.create("Alice", "socket0", game);
  const sessions = [created.session];
  for (let i = 1; i < n; i++)
    sessions.push(
      engine.join(created.room.code, `Joueur ${i}`, `socket${i}`).session,
    );
  const { room, player: host } = created;
  return {
    engine,
    room,
    host,
    sessions,
    start: () => engine.action(room, host, { type: "start" }),
    time: (ms: number) => {
      now += ms;
    },
  };
}
describe("Hub : salons et identité", () => {
  it("réserve lancement et règles à l’hôte, et bloque les arrivées en cours de partie", () => {
    const f = fixture("bluff");
    expect(() =>
      f.engine.action(f.room, f.room.players[1], { type: "start" }),
    ).toThrow("hôte");
    f.start();
    expect(() => f.engine.join(f.room.code, "Retardataire", "s9")).toThrow(
      "en cours",
    );
    expect(() =>
      f.engine.action(f.room, f.host, { type: "game", game: "auction" }),
    ).toThrow("Revenez");
    const view = JSON.stringify(f.engine.view(f.room, f.room.players[1].id));
    expect(view).not.toContain("tokenHash");
    expect(view).not.toContain(f.sessions[0].token);
  });
  it("reprend une identité sans accepter un faux jeton ou l’ancien socket", () => {
    const f = fixture("wavelength");
    expect(() =>
      f.engine.resume({ ...f.sessions[0], token: "a".repeat(64) }, "bad"),
    ).toThrow("expiré");
    const result = f.engine.resume(f.sessions[0], "new");
    expect(result.previousSocketId).toBe("socket0");
    expect(f.host.socketId).toBe("new");
    expect(f.engine.view(f.room, f.host.id).players[0].connected).toBe(true);
  });
  it("transfère l’hôte, suspend les actions et remet la partie à zéro après un départ", () => {
    const f = fixture("bluff");
    f.start();
    f.engine.disconnect(f.room, f.host);
    expect(f.room.hostId).toBe(f.room.players[1].id);
    expect(() =>
      f.engine.action(f.room, f.room.players[1], {
        type: "ask",
        question: "high",
      }),
    ).toThrow("déconnectés");
    f.engine.action(f.room, f.room.players[1], {
      type: "remove",
      playerId: f.host.id,
    });
    expect(f.room.phase).toBe("lobby");
    expect(f.room.players).toHaveLength(2);
    expect(() => f.engine.resume(f.sessions[0], "new")).toThrow("expiré");
  });
  it("retire les absents après 90 secondes et expire les salons inactifs", () => {
    const f = fixture("bluff", 2);
    f.engine.disconnect(f.room, f.host);
    f.time(89999);
    f.engine.tick();
    expect(f.room.players).toHaveLength(2);
    f.time(1);
    f.engine.tick();
    expect(f.room.players).toHaveLength(1);
    f.time(3600001);
    f.engine.tick();
    expect(f.engine.rooms.size).toBe(0);
  });
});
describe("Wavelength multijoueur", () => {
  it("cache la cible et les estimations avant révélation, compte les points et fait tourner le guide", () => {
    const f = fixture("wavelength");
    f.start();
    const guides = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const wave = f.room.wave!;
      const guide = f.room.players.find((p) => p.id === wave.speakerId)!;
      guides.set(guide.id, (guides.get(guide.id) ?? 0) + 1);
      const others = f.room.players.filter((p) => p !== guide);
      expect(f.engine.view(f.room, guide.id).wave?.target).toBe(wave.target);
      expect(f.engine.view(f.room, others[0].id).wave?.target).toBeUndefined();
      expect(() =>
        f.engine.action(f.room, others[0], {
          type: "clue",
          text: "Un chocolat chaud",
        }),
      ).toThrow("guide");
      f.engine.action(f.room, guide, {
        type: "clue",
        text: "Un chocolat chaud",
      });
      expect(() =>
        f.engine.action(f.room, guide, { type: "guess", value: 50 }),
      ).toThrow("deviner");
      f.engine.action(f.room, others[0], { type: "guess", value: wave.target });
      expect(f.engine.view(f.room, others[1].id).wave?.guesses).toBeUndefined();
      expect(f.engine.view(f.room, guide.id).wave?.guesses).toBeUndefined();
      expect(() =>
        f.engine.action(f.room, others[0], { type: "guess", value: 50 }),
      ).toThrow("déjà");
      f.engine.action(f.room, others[1], { type: "guess", value: wave.target });
      expect(f.room.phase).toBe("wave-result");
      expect(f.engine.view(f.room, others[0].id).wave?.target).toBe(
        wave.target,
      );
      expect(
        f.engine.view(f.room, others[0].id).wave?.earned?.[others[0].id],
      ).toBe(4);
      f.engine.action(f.room, f.host, { type: "next" });
    }
    expect(f.room.phase).toBe("finished");
    expect([...guides.values()]).toEqual([2, 2, 2]);
    expect(f.room.players.map((p) => p.score)).toEqual([24, 24, 24]);
  });
  it("attribue 4, 3, 2 et 0 points selon la distance à la cible", () => {
    const f = fixture("wavelength", 5);
    f.start();
    f.room.wave!.target = 50;
    f.engine.action(f.room, f.host, { type: "clue", text: "Un exemple" });
    [54, 60, 68, 69].forEach((guess, i) =>
      f.engine.action(f.room, f.room.players[i + 1], {
        type: "guess",
        value: guess,
      }),
    );
    expect(f.room.players.map((p) => p.score)).toEqual([2, 4, 3, 2, 0]);
  });
});
describe("Enchères : budgets, équipes et vote", () => {
  it("permet un verdict commun à deux plutôt qu’une égalité forcée", () => {
    const f = fixture("auction", 2);
    f.start();
    while (f.room.phase === "bidding") {
      const a = f.room.auction!;
      const p = f.room.players.find(
        (p) =>
          p.id !== a.highBidderId &&
          p.team.length < 5 &&
          !a.passed.includes(p.id),
      )!;
      f.engine.action(f.room, p, { type: "pass" });
    }
    for (const player of f.room.players)
      f.engine.action(f.room, player, { type: "vote", playerId: f.host.id });
    expect(f.room.auction!.winners).toEqual([f.host.id]);
    expect(f.host.score).toBe(2);
  });
  it("réserve les futurs achats et ne permet pas de revenir après avoir passé", () => {
    const f = fixture("auction");
    f.start();
    expect(f.room.auction!.highBid).toBe(10);
    expect(() =>
      f.engine.action(f.room, f.room.players[1], { type: "bid", amount: 61 }),
    ).toThrow("budget");
    f.engine.action(f.room, f.room.players[2], { type: "pass" });
    expect(() =>
      f.engine.action(f.room, f.room.players[2], { type: "bid", amount: 11 }),
    ).toThrow("passé");
    f.engine.action(f.room, f.room.players[1], { type: "bid", amount: 60 });
    expect(f.room.players[1].credits).toBe(40);
    expect(f.room.players[1].team).toHaveLength(1);
    expect(f.engine.maxBid(f.room.players[1])).toBe(10);
  });
  it.each([2, 3, 8])(
    "complète cinq personnages distincts par joueur à %i, puis révèle le vote final",
    (n) => {
      const f = fixture("auction", n);
      f.start();
      let steps = 0;
      while (f.room.phase === "bidding") {
        expect(steps++).toBeLessThan(500);
        const auction = f.room.auction!;
        const next = f.room.players.find(
          (p) =>
            p.team.length < 5 &&
            p.id !== auction.highBidderId &&
            !auction.passed.includes(p.id),
        );
        expect(next).toBeDefined();
        f.engine.action(f.room, next!, { type: "pass" });
      }
      expect(f.room.phase).toBe("vote");
      expect(
        f.room.players.every((p) => p.team.length === 5 && p.credits === 50),
      ).toBe(true);
      expect(
        new Set(f.room.players.flatMap((p) => p.team.map((c) => c.id))).size,
      ).toBe(n * 5);
      if (n > 2)
        expect(() =>
          f.engine.action(f.room, f.host, {
            type: "vote",
            playerId: f.host.id,
          }),
        ).toThrow("autre");
      f.room.players.forEach((p, i) => {
        if (i)
          expect(f.engine.view(f.room, p.id).auction?.votes).toBeUndefined();
        f.engine.action(f.room, p, {
          type: "vote",
          playerId: f.room.players[(i + 1) % n].id,
        });
      });
      expect(f.room.phase).toBe("auction-result");
      expect(f.room.auction!.winners).toHaveLength(n); // A circular vote is a shared tie.
      expect(f.room.players.every((p) => p.score === 1)).toBe(true);
    },
  );
});
describe("Bluff sans mensonge", () => {
  it("cache la carte, exige deux réponses vraies et crédite uniquement le destinataire choisi", () => {
    const f = fixture("bluff");
    f.start();
    const bluff = f.room.bluff!;
    const receiver = f.room.players[1];
    expect(f.engine.view(f.room, f.host.id).bluff?.card).toBeDefined();
    expect(f.engine.view(f.room, receiver.id).bluff?.card).toBeUndefined();
    expect(
      f.engine.view(f.room, f.room.players[2].id).bluff?.card,
    ).toBeUndefined();
    expect(() =>
      f.engine.action(f.room, receiver, { type: "choose", choice: "take" }),
    ).toThrow("deux réponses");
    expect(() =>
      f.engine.action(f.room, f.host, { type: "ask", question: "high" }),
    ).toThrow("destinataire");
    f.engine.action(f.room, receiver, { type: "ask", question: "high" });
    expect(() =>
      f.engine.action(f.room, receiver, { type: "ask", question: "even" }),
    ).toThrow("Attendez");
    f.engine.action(f.room, f.host, { type: "answer" });
    expect(bluff.questions[0].answer).toBe(bluff.card.value > 5);
    expect(() =>
      f.engine.action(f.room, receiver, { type: "ask", question: "high" }),
    ).toThrow("déjà");
    f.engine.action(f.room, receiver, { type: "ask", question: "even" });
    f.engine.action(f.room, f.host, { type: "answer" });
    expect(bluff.questions[1].answer).toBe(bluff.card.value % 2 === 0);
    expect(f.room.phase).toBe("decision");
    expect(() =>
      f.engine.action(f.room, receiver, { type: "ask", question: "anime" }),
    ).toThrow("destinataire");
    f.engine.action(f.room, receiver, { type: "choose", choice: "take" });
    expect(receiver.score).toBe(bluff.card.value);
    expect(f.host.score).toBe(0);
    expect(f.engine.view(f.room, receiver.id).bluff?.card?.id).toBe(
      bluff.card.id,
    );
    expect(() =>
      f.engine.action(f.room, receiver, { type: "choose", choice: "take" }),
    ).toThrow("deux réponses");
  });
  it("laisse la carte au détenteur et donne deux tours à chacun à plusieurs", () => {
    const f = fixture("bluff", 4);
    f.start();
    const holders = new Map<string, number>();
    const expected = new Map(f.room.players.map((p) => [p.id, 0]));
    for (let i = 0; i < 8; i++) {
      const b = f.room.bluff!;
      const holder = f.room.players.find(
        (p) => p.id === b.holderId,
      ) as TablePlayer;
      const receiver = f.room.players.find(
        (p) => p.id === b.receiverId,
      ) as TablePlayer;
      holders.set(holder.id, (holders.get(holder.id) ?? 0) + 1);
      for (const question of ["anime", "hero"] as const) {
        f.engine.action(f.room, receiver, { type: "ask", question });
        f.engine.action(f.room, holder, { type: "answer" });
      }
      f.engine.action(f.room, receiver, { type: "choose", choice: "leave" });
      expected.set(holder.id, expected.get(holder.id)! + b.card.value);
      f.engine.action(f.room, f.host, { type: "next" });
    }
    expect(f.room.phase).toBe("finished");
    expect([...holders.values()]).toEqual([2, 2, 2, 2]);
    f.room.players.forEach((p) => expect(p.score).toBe(expected.get(p.id)));
  });
  it("dispose d’un paquet suffisant, unique et avec des caractéristiques valides", () => {
    expect(characterDeck.length).toBeGreaterThanOrEqual(40);
    expect(new Set(characterDeck.map((c) => c.name)).size).toBe(
      characterDeck.length,
    );
    expect(
      characterDeck.every((c) =>
        [c.value, c.power, c.intelligence].every(
          (n) => Number.isInteger(n) && n >= 1 && n <= 10,
        ),
      ),
    ).toBe(true);
  });
});
