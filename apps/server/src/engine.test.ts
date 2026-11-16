import { describe, it, expect } from "vitest";
import { Engine, normalize } from "./engine";
import { commands } from "@spyfall/shared";
import words from "../../../data/words.fr.json";
function setup(count = 3, double = false) {
  let time = 1000;
  const engine = new Engine(
    () => time,
    () => 0,
  );
  const first = engine.create("Alice", "socket-0");
  const { room } = first;
  for (let i = 1; i < count; i++)
    engine.join(room.code, `Joueur ${i}`, `socket-${i}`);
  room.settings.mode = double ? "double" : "classic";
  room.players.forEach((p) => (p.ready = true));
  return {
    engine,
    room,
    first,
    advance: (ms: number) => {
      time += ms;
      engine.tick(room);
    },
    start: () => engine.start(room, first.player),
  };
}
describe("Moteur autoritaire", () => {
  it("redonne le rôle d’hôte lorsque quelqu’un rejoint un salon vidé", () => {
    const f = setup();
    for (const p of [...f.room.players]) f.engine.leave(f.room, p);
    const next = f.engine.join(f.room.code, "Nouvel hôte", "next");
    expect(f.room.hostPlayerId).toBe(next.player.id);
  });

  it("limite le salon à 3–12 et exige que tous soient prêts", () => {
    const f = setup(2);
    expect(() => f.start()).toThrow("3 joueurs");
    f.engine.join(f.room.code, "Troisième", "third");
    expect(() => f.start()).toThrow("prêts");
    const big = setup(12);
    expect(() => big.engine.join(big.room.code, "En trop", "extra")).toThrow(
      "complet",
    );
  });
  it("n’autorise ni les changements de paramètres ni le démarrage par un autre joueur", () => {
    const f = setup();
    expect(() => f.engine.start(f.room, f.room.players[1])).toThrow("hôte");
    f.start();
    expect(() =>
      f.engine.settings(f.room, f.first.player, f.room.settings),
    ).toThrow("verrouillés");
    expect(() => f.start()).toThrow("déjà");
  });
  it("distribue un mot identique aux innocents sans exposer les secrets dans l’état public", () => {
    const f = setup(12);
    f.start();
    const cards = f.room.players.map((p) => f.engine.card(f.room, p)!);
    expect(cards.filter((c) => c.role === "spy")).toHaveLength(1);
    expect(
      new Set(cards.filter((c) => c.role === "innocent").map((c) => c.word))
        .size,
    ).toBe(1);
    expect(cards.find((c) => c.role === "spy")).not.toHaveProperty("word");
    const state = f.engine.view(f.room);
    expect(state).not.toHaveProperty("round");
    expect(JSON.stringify(state)).not.toContain(f.room.round!.word.label);
    expect(state.result).toBeNull();
  });
  it("restaure le rôle avec le jeton et refuse une usurpation", () => {
    const f = setup();
    f.start();
    const card = f.engine.card(f.room, f.first.player);
    f.engine.disconnect(f.room, f.first.player);
    expect(() => f.engine.resume(f.room.code, "0".repeat(64), "evil")).toThrow(
      "Session",
    );
    const resume = f.engine.resume(f.room.code, f.first.session.token, "new");
    expect(resume.player.id).toBe(f.first.player.id);
    expect(f.engine.card(f.room, resume.player)).toEqual(card);
    expect(resume.player.socketId).toBe("new");
  });
  it("applique les échéances serveur et deux tours sans vote", () => {
    const f = setup();
    f.start();
    f.advance(15000);
    expect(f.room.phase).toBe("discussion");
    f.advance(300000);
    expect(f.room.phase).toBe("voting");
    f.advance(45000);
    expect(f.room.phase).toBe("results");
    expect(f.room.round!.result!.winner).toBe("spies");
  });
  it("interdit un second vote et un bulletin d’un ancien tour", () => {
    const f = setup();
    f.start();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    const r = f.room.round!;
    f.engine.vote(f.room, f.first.player, f.first.player.id, r.ballotIndex);
    expect(() =>
      f.engine.vote(f.room, f.first.player, f.first.player.id, r.ballotIndex),
    ).toThrow("déjà");
    expect(() =>
      f.engine.vote(f.room, f.room.players[1], f.first.player.id, 0),
    ).toThrow("ancien");
  });
  it("départage une égalité puis donne la victoire aux espions si elle persiste", () => {
    const f = setup();
    f.start();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    for (const p of f.room.players) f.engine.vote(f.room, p, p.id, 1);
    expect(f.room.phase).toBe("voting");
    expect(f.room.round!.ballotIndex).toBe(2);
    for (const p of f.room.players) f.engine.vote(f.room, p, p.id, 2);
    expect(f.room.round!.result!.winner).toBe("spies");
  });
  it("attribue les scores une seule fois et rejoue sans dupliquer les joueurs", () => {
    const f = setup();
    f.start();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    const spy = f.room.players[0];
    for (const p of f.room.players) f.engine.vote(f.room, p, spy.id, 1);
    expect(f.room.phase).toBe("spy_guess");
    f.engine.guess(f.room, spy, "Mauvaise réponse");
    expect(f.room.round!.result!.winner).toBe("innocents");
    expect(f.room.players.map((p) => p.score)).toEqual([0, 100, 100]);
    f.engine.finish(f.room, "innocents", "replay");
    expect(f.room.players.map((p) => p.score)).toEqual([0, 100, 100]);
    f.engine.rematch(f.room, f.first.player);
    expect(f.room.players).toHaveLength(3);
    f.room.players.forEach((p) => (p.ready = true));
    f.start();
    expect(f.room.round!.index).toBe(2);
  });
  it("normalise la réponse sans accepter une sous-chaîne", () => {
    expect(normalize("Édith Piaf !")).toBe("edithpiaf");
    const f = setup();
    f.start();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    for (const p of f.room.players)
      f.engine.vote(f.room, p, f.first.player.id, 1);
    f.engine.guess(
      f.room,
      f.first.player,
      f.room.round!.word.label.toUpperCase(),
    );
    expect(f.first.player.score).toBe(150);
    expect(f.room.round!.result!.winner).toBe("spies");
  });
  it("enchaîne l’identification des deux espions sans divulguer leur identité", () => {
    const tooSmall = setup(5, true);
    expect(() => tooSmall.start()).toThrow("6 joueurs");
    const f = setup(6, true);
    f.start();
    expect(
      [...f.room.round!.roles.values()].filter((r) => r === "spy"),
    ).toHaveLength(2);
    expect(f.engine.card(f.room, f.first.player)).not.toHaveProperty("spies");
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    for (const p of f.room.players)
      f.engine.vote(f.room, p, f.first.player.id, 1);
    f.engine.guess(f.room, f.first.player, "incorrect");
    expect(f.room.phase).toBe("voting");
    expect(f.room.round!.candidates).not.toContain(f.first.player.id);
    for (const p of f.room.players.slice(1))
      f.engine.vote(f.room, p, f.room.players[1].id, 2);
    f.engine.guess(f.room, f.room.players[1], "incorrect");
    expect(f.room.round!.result!.winner).toBe("innocents");
    expect(f.room.players.map((p) => p.score)).toEqual([
      0, 0, 100, 100, 100, 100,
    ]);
  });
  it("conserve le vote pendant la reconnexion de 60 secondes et transfère l’hôte", () => {
    const f = setup(4);
    f.start();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    f.engine.vote(f.room, f.first.player, f.first.player.id, 1);
    f.engine.disconnect(f.room, f.first.player);
    expect(f.room.hostPlayerId).toBe(f.room.players[1].id);
    f.advance(30000);
    expect(f.room.round!.votes.get(f.first.player.id)).toBe(f.first.player.id);
    expect(f.first.player.left).toBe(false);
    f.engine.resume(f.room.code, f.first.session.token, "back");
    f.advance(30000);
    expect(f.first.player.left).toBe(false);
  });
  it("retire les sessions absentes après 60 s et purge un salon inactif", () => {
    const f = setup();
    for (const p of [...f.room.players]) f.engine.disconnect(f.room, p);
    f.advance(60000);
    expect(f.room.players).toHaveLength(0);
    f.advance(3600001);
    expect(f.engine.rooms.has(f.room.code)).toBe(false);
  });
  it("refuse le HTML, les commandes mal formées et les faux liens Discord", () => {
    expect(
      commands["chat:send"].safeParse({ body: "<script>alert(1)</script>" })
        .success,
    ).toBe(false);
    expect(commands["chat:send"].safeParse({ body: "Salut !" }).success).toBe(
      true,
    );
    expect(
      commands["room:settings:update"].safeParse({
        ...setup().room.settings,
        discordUrl: "https://discord.gg.evil.com/test",
      }).success,
    ).toBe(false);
  });
  it("contient 80 mots uniques par catégorie et couvre chaque difficulté", () => {
    expect(new Set(words.map((w) => w.id)).size).toBe(words.length);
    const labels = words.flatMap((w) => [
      ...new Set([w.label, ...w.variants].map(normalize)),
    ]);
    expect(new Set(labels).size).toBe(labels.length);
    for (const category of new Set(words.map((w) => w.category))) {
      const group = words.filter((w) => w.category === category);
      expect(group).toHaveLength(80);
      expect(new Set(group.map((w) => w.difficulty)).size).toBe(3);
    }
  });
});
