import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Engine, normalize } from "./engine";
import { packSchema, type PackRecord } from "@spyfall/shared";
function fixture(n = 3) {
  let now = 1000;
  const engine = new Engine(
    () => now,
    () => 0,
  );
  const { room, player: host } = engine.create("Alice", "s0");
  for (let i = 1; i < n; i++) engine.join(room.code, `Joueur ${i}`, `s${i}`);
  const ready = () =>
    room.players.filter((p) => !p.spectator).forEach((p) => (p.ready = true));
  const start = () => {
    ready();
    engine.start(room, host);
  };
  const finish = () => engine.finish(room, "innocents", "Test des scores");
  return {
    engine,
    room,
    host,
    start,
    ready,
    finish,
    time: (ms: number) => {
      now += ms;
    },
  };
}
const pack = (labels = ["Soleil", "Lune"]): PackRecord => ({
  id: randomUUID(),
  ownerKey: "guest:test",
  revision: 1,
  status: "private",
  updatedAt: 0,
  pack: {
    version: 1,
    name: "Astres",
    description: "",
    words: labels.map((label) => ({
      label,
      category: "Astronomie",
      subcategory: "Espace",
      difficulty: "easy",
      variants: label === "Soleil" ? ["Sun"] : [],
    })),
  },
});
describe("V2 · catégories, options et anti-répétition", () => {
  it("démarre avec une seule catégorie et un nombre de manches modifié après confirmation des joueurs", () => {
    const f = fixture();
    f.ready();
    f.engine.settings(f.room, f.host, {
      ...f.room.settings,
      categories: ["Animés / mangas"],
      rounds: 3,
    });
    expect(f.room.players.every((player) => !player.ready)).toBe(true);
    expect(() => f.engine.start(f.room, f.host)).toThrow("prêts");
    f.ready();
    f.engine.start(f.room, f.host);
    expect(f.room.phase).toBe("reveal");
    expect(f.room.round!.word.category).toBe("Animés / mangas");
    expect(f.room.settings.rounds).toBe(3);
  });
  it("croise catégories, sous-catégories, difficulté et connaissances des seuls participants", () => {
    const f = fixture();
    f.room.settings = {
      ...f.room.settings,
      categories: ["Animés / mangas"],
      subcategories: ["Animés / mangas::Isekai"],
      difficulty: "medium",
    };
    expect(f.engine.pool(f.room).map((w) => w.label)).toEqual(["Inuyasha"]);
    f.engine.preferences(f.room, f.host, ["Films"], []);
    expect(f.engine.pool(f.room)).toHaveLength(0);
    f.engine.preferences(f.room, f.host, [], []);
    const spec = f.engine.join(
      f.room.code,
      "Spectateur",
      "spec",
      undefined,
      true,
    ).player;
    f.engine.preferences(f.room, spec, ["Musique"], []);
    expect(f.engine.pool(f.room)).toHaveLength(1);
    const view = f.engine.view(f.room);
    expect(view.availableWords).toBe(1);
    expect(JSON.stringify(view)).not.toContain("Inuyasha");
  });
  it("bloque l’épuisement et exige un reset ou un élargissement explicite", () => {
    const f = fixture();
    const p = pack(["Soleil"]);
    f.engine.attachPack(f.room, f.host, p);
    f.room.settings.includeOfficial = false;
    f.start();
    expect(f.room.round!.word.label).toBe("Soleil");
    f.finish();
    f.engine.rematch(f.room, f.host);
    f.ready();
    expect(() => f.engine.start(f.room, f.host)).toThrow("épuisé");
    expect(f.room.phase).toBe("lobby");
    f.engine.resetWords(f.room, f.host);
    f.start();
    expect(f.room.round!.word.label).toBe("Soleil");
  });
  it("ne répète pas un concept déjà tiré sous une variante", () => {
    const f = fixture();
    const p = pack(["Soleil"]);
    f.engine.attachPack(f.room, f.host, p);
    const q = pack(["Sun"]);
    q.pack.words[0].variants = [];
    f.engine.attachPack(f.room, f.host, q);
    f.room.settings.includeOfficial = false;
    f.start();
    f.finish();
    f.engine.rematch(f.room, f.host);
    expect(f.engine.view(f.room).remainingWords).toBe(0);
  });
  it("passe un mot une seule fois sans changer les rôles, et consomme le mot passé", () => {
    const f = fixture();
    f.room.settings.allowPass = true;
    f.start();
    const roles = [...f.room.round!.roles];
    const original = f.room.round!.word;
    f.engine.pass(f.room, f.host, 1);
    expect([...f.room.round!.roles]).toEqual(roles);
    expect(f.room.round!.word.label).not.toBe(original.label);
    expect(f.room.usedWords.has(normalize(original.label))).toBe(true);
    expect(f.engine.card(f.room, f.host)?.revision).toBe(1);
    expect(() => f.engine.pass(f.room, f.host, 1)).toThrow("seul passage");
  });
  it("refuse un passage non autorisé ou tardif", () => {
    const f = fixture();
    f.start();
    expect(() => f.engine.pass(f.room, f.host, 1)).toThrow("autorisé");
    f.room.settings.allowPass = true;
    f.engine.discussion(f.room);
    expect(() => f.engine.pass(f.room, f.host, 1)).toThrow("révélation");
  });
  it("accepte une variante explicite à la dernière chance et refuse une sous-chaîne", () => {
    const f = fixture();
    const p = pack(["Soleil"]);
    f.engine.attachPack(f.room, f.host, p);
    f.room.settings.includeOfficial = false;
    f.start();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    for (const voter of f.room.players)
      f.engine.vote(f.room, voter, f.host.id, 1);
    f.engine.guess(f.room, f.host, "SUN");
    expect(f.host.score).toBe(150);
    expect(f.room.round!.result!.winner).toBe("spies");
  });
  it("expose les choix seulement si les votes sont publics", () => {
    for (const anonymous of [true, false]) {
      const f = fixture();
      f.room.settings.anonymousVotes = anonymous;
      f.start();
      f.engine.discussion(f.room);
      f.engine.beginVote(f.room);
      f.engine.vote(f.room, f.host, f.host.id, 1);
      expect(f.engine.view(f.room).publicVotes).toHaveLength(anonymous ? 0 : 1);
    }
  });
  it("permet trois espions dès neuf joueurs et exige le nombre minimal", () => {
    const f = fixture(9);
    f.room.settings.mode = "custom";
    f.room.settings.spyCount = 3;
    f.start();
    expect(
      [...f.room.round!.roles.values()].filter((r) => r === "spy"),
    ).toHaveLength(3);
    const g = fixture(8);
    g.room.settings.mode = "custom";
    g.room.settings.spyCount = 3;
    expect(() => g.start()).toThrow("9 joueurs");
  });
  it("valide et fige des copies des packs sans publier leurs mots dans le salon", () => {
    const f = fixture();
    const p = pack();
    f.engine.attachPack(f.room, f.host, p);
    p.pack.words[0].label = "Modifié après attachement";
    expect(f.engine.pool(f.room).some((w) => w.label === "Soleil")).toBe(true);
    expect(JSON.stringify(f.engine.view(f.room))).not.toContain("Soleil");
    expect(
      packSchema.safeParse({
        ...p.pack,
        words: [p.pack.words[0], p.pack.words[0]],
      }).success,
    ).toBe(false);
  });
});
describe("V2 · spectateurs et tournois", () => {
  it("promeut les réservations lors d’un reset sans dépasser les douze participants", () => {
    const f = fixture(11);
    f.start();
    const spec = f.engine.join(
      f.room.code,
      "Spectateur",
      "spec",
      undefined,
      true,
    ).player;
    f.engine.participate(f.room, spec, true);
    f.finish();
    f.engine.resetTournament(f.room, f.host);
    expect(spec.spectator).toBe(false);
    expect(spec.queued).toBe(false);
    expect(() => f.engine.join(f.room.code, "En trop", "extra")).toThrow(
      "complet",
    );
  });

  it("laisse rejoindre en cours, sans carte ni vote ; réserve une place puis promeut au lobby", () => {
    const f = fixture();
    f.start();
    const { player: spec } = f.engine.join(
      f.room.code,
      "Observateur",
      "watch",
      undefined,
      true,
    );
    expect(f.engine.card(f.room, spec)).toBeNull();
    f.engine.discussion(f.room);
    f.engine.beginVote(f.room);
    expect(() => f.engine.vote(f.room, spec, f.host.id, 1)).toThrow(
      "pouvez pas voter",
    );
    f.engine.participate(f.room, spec, true);
    expect(spec.spectator).toBe(true);
    f.finish();
    f.engine.rematch(f.room, f.host);
    expect(spec.spectator).toBe(false);
    f.start();
    expect(f.engine.card(f.room, spec)).not.toBeNull();
  });
  it("respecte la capacité des participants et ne réserve pas treize places", () => {
    const f = fixture(12);
    f.start();
    const spec = f.engine.join(
      f.room.code,
      "Observateur",
      "watch",
      undefined,
      true,
    ).player;
    expect(() => f.engine.participate(f.room, spec, true)).toThrow("12 places");
    expect(f.engine.card(f.room, spec)).toBeNull();
  });
  it("calcule cinq manches une seule fois, garde l’historique et impose un reset pour relancer", () => {
    const f = fixture();
    f.room.settings = { ...f.room.settings, tournament: true, rounds: 5 };
    for (let i = 0; i < 5; i++) {
      f.start();
      f.finish();
      f.engine.finish(f.room, "innocents", "Double clic");
      if (i < 4) f.engine.rematch(f.room, f.host);
    }
    const view = f.engine.view(f.room);
    expect(view.completedRounds).toBe(5);
    expect(view.history).toHaveLength(5);
    expect(view.tournamentFinished).toBe(true);
    expect(view.standings.map((s) => s.score)).toEqual([500, 500, 0]);
    expect(view.standings[0].wins).toBe(5);
    f.engine.rematch(f.room, f.host);
    f.ready();
    expect(() => f.engine.start(f.room, f.host)).toThrow("terminée");
    f.engine.resetTournament(f.room, f.host);
    expect(f.engine.view(f.room).standings).toHaveLength(0);
    f.start();
    expect(f.room.round!.index).toBe(6);
  });
  it("fige les règles et connaissances pendant une série sans perdre les scores des joueurs partis", () => {
    const f = fixture(4);
    f.room.settings = { ...f.room.settings, rounds: 5, tournament: true };
    f.start();
    f.finish();
    f.engine.rematch(f.room, f.host);
    expect(() => f.engine.settings(f.room, f.host, f.room.settings)).toThrow(
      "fixes",
    );
    expect(() => f.engine.preferences(f.room, f.host, ["Films"], [])).toThrow(
      "fixes",
    );
    const departed = f.room.players[1];
    f.engine.leave(f.room, departed);
    expect(
      f.engine.view(f.room).standings.find((s) => s.playerId === departed.id)
        ?.score,
    ).toBe(100);
  });
});
describe("V2 · confidentialité OBS", () => {
  it("révèle les résultats et scores seulement après le délai, même après un retour au lobby", () => {
    const f = fixture();
    f.room.settings.streamDelay = 30;
    f.room.settings.streamPrivacy = false;
    const token = f.engine.streamLink(f.room, f.host);
    expect(f.engine.streamRoom(token)).toBe(f.room);
    f.start();
    const secret = f.room.round!.word.label;
    expect(JSON.stringify(f.engine.streamView(f.room))).not.toContain(secret);
    f.finish();
    expect(f.engine.streamView(f.room).result).toBeNull();
    expect(f.engine.streamView(f.room).players.map((p) => p.score)).toEqual([
      0, 0, 0,
    ]);
    f.engine.rematch(f.room, f.host);
    expect(f.engine.streamView(f.room).players.map((p) => p.score)).toEqual([
      0, 0, 0,
    ]);
    f.time(30000);
    expect(f.engine.streamView(f.room).players.map((p) => p.score)).toEqual([
      0, 100, 100,
    ]);
  });
  it("cache code, mot et rôles avec la confidentialité, et révoque l’ancien jeton", () => {
    const f = fixture();
    const first = f.engine.streamLink(f.room, f.host);
    f.engine.streamLink(f.room, f.host);
    expect(f.engine.streamRoom(first)).toBeUndefined();
    f.start();
    f.finish();
    f.time(15000);
    const view = f.engine.streamView(f.room);
    expect(view).not.toHaveProperty("roomCode");
    expect(view.result).toEqual({ winner: "innocents" });
    expect(JSON.stringify(view)).not.toContain(f.room.round!.word.label);
    f.room.settings.streamPrivacy = false;
    expect(f.engine.streamView(f.room).result?.word).toBe(
      f.room.round!.word.label,
    );
  });
});
