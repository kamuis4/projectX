import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  defaultSettings,
  spiesFor,
  normalizeWord,
  type PackRecord,
  type PackSummary,
  type RoundHistory,
  type Standing,
  type StreamView,
  type Settings,
  type Phase,
  type RoomView,
  type Message,
  type Card,
  type Result,
} from "@spyfall/shared";
import wordBank from "../../../data/words.fr.json";
export type Word = {
  id: string;
  label: string;
  category: string;
  subcategory: string;
  difficulty: string;
  variants: string[];
  locale: string;
  enabled: boolean;
};
export type Player = {
  id: string;
  nickname: string;
  tokenHash: string;
  socketId: string | null;
  ready: boolean;
  score: number;
  left: boolean;
  disconnectedAt: number | null;
  userId?: string;
  spectator: boolean;
  queued: boolean;
  knownCategories: string[];
  knownSubcategories: string[];
};
type Round = {
  index: number;
  word: Word;
  roles: Map<string, "spy" | "innocent">;
  eliminated: Set<string>;
  votes: Map<string, string>;
  ballotIndex: number;
  runoff: boolean;
  candidates: string[];
  eligibleVoters: string[];
  guessPlayerId: string | null;
  scored: boolean;
  result: Result | null;
  deadlineAt: number;
  passed: boolean;
  revision: number;
  finishedAt: number | null;
  scoresBefore: Map<string, number>;
};
export type Room = {
  id: string;
  code: string;
  hostPlayerId: string;
  players: Player[];
  settings: Settings;
  phase: Phase;
  round: Round | null;
  messages: Message[];
  updatedAt: number;
  usedWords: Set<string>;
  packs: Map<string, PackRecord>;
  completedRounds: number;
  history: RoundHistory[];
  scoreboard: Map<string, Standing>;
  streamTokenHash: string | null;
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class GameError extends Error {}
const check: (condition: unknown, message: string) => asserts condition = (
  c,
  m,
) => {
  if (!c) throw new GameError(m);
};
export class Engine {
  rooms = new Map<string, Room>();
  constructor(
    readonly now = () => Date.now(),
    readonly choose = (max: number) => randomInt(max),
  ) {}
  create(nickname: string, socketId: string, userId?: string) {
    check(
      this.rooms.size < 1000,
      "Le serveur est complet. Réessayez plus tard.",
    );
    let code: string;
    do {
      code = Array.from(
        randomBytes(8),
        (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32],
      ).join("");
    } while (this.rooms.has(code));
    const room: Room = {
      id: randomUUID(),
      code,
      hostPlayerId: "",
      players: [],
      settings: structuredClone(defaultSettings),
      phase: "lobby",
      round: null,
      messages: [],
      updatedAt: this.now(),
      usedWords: new Set(),
      packs: new Map(),
      completedRounds: 0,
      history: [],
      scoreboard: new Map(),
      streamTokenHash: null,
    };
    this.rooms.set(code, room);
    return this.join(code, nickname, socketId, userId);
  }
  join(
    code: string,
    nickname: string,
    socketId: string,
    userId?: string,
    spectator = false,
  ) {
    const room = this.get(code);
    check(
      room.phase === "lobby" || spectator,
      "La partie a déjà commencé. Rejoignez comme spectateur.",
    );
    check(
      room.players.filter(
        (p) => !p.left && (spectator ? p.spectator : !p.spectator || p.queued),
      ).length < (spectator ? 50 : 12),
      "Le salon est complet.",
    );
    check(
      !room.players.some(
        (p) =>
          !p.left &&
          p.nickname.toLocaleLowerCase("fr") ===
            nickname.toLocaleLowerCase("fr"),
      ),
      "Ce pseudo est déjà utilisé dans le salon.",
    );
    const token = randomBytes(32).toString("hex");
    const player: Player = {
      id: randomUUID(),
      nickname,
      tokenHash: hash(token),
      socketId,
      ready: false,
      score: 0,
      left: false,
      disconnectedAt: null,
      userId,
      spectator,
      queued: false,
      knownCategories: [],
      knownSubcategories: [],
    };
    room.players.push(player);
    if (
      !room.players.some(
        (p) => p.id === room.hostPlayerId && p.socketId && !p.left,
      )
    )
      room.hostPlayerId = player.id;
    room.updatedAt = this.now();
    return { room, player, session: { token, playerId: player.id, code } };
  }
  get(code: string) {
    const room = this.rooms.get(code);
    check(room, "Salon introuvable ou expiré.");
    return room;
  }
  resume(code: string, token: string, socketId: string) {
    const room = this.get(code);
    const digest = hash(token);
    const player = room.players.find(
      (p) =>
        !p.left &&
        timingSafeEqual(Buffer.from(p.tokenHash), Buffer.from(digest)),
    );
    check(player, "Session expirée. Rejoignez à nouveau le salon.");
    player.socketId = socketId;
    player.disconnectedAt = null;
    room.updatedAt = this.now();
    return { room, player };
  }
  host(room: Room, player: Player) {
    check(
      room.hostPlayerId === player.id,
      "Cette action est réservée à l’hôte.",
    );
  }
  settings(room: Room, player: Player, settings: Settings) {
    this.host(room, player);
    check(
      room.phase === "lobby",
      "Les paramètres sont verrouillés pendant une manche.",
    );
    check(
      !settings.tournament || settings.rounds >= 5,
      "Un tournoi comporte 5 à 10 manches.",
    );
    check(
      !this.seriesActive(room),
      "Les règles restent fixes pendant une série. Réinitialisez le classement pour les modifier.",
    );
    check(
      settings.packIds.every((id) => room.packs.has(id)),
      "Attachez les packs avant de les sélectionner.",
    );
    room.settings = settings;
    room.players.forEach((p) => (p.ready = false));
  }
  start(room: Room, player: Player) {
    this.host(room, player);
    check(room.phase === "lobby", "Une manche est déjà en cours.");
    check(
      !this.tournamentFinished(room),
      "La série est terminée. Réinitialisez les scores pour recommencer.",
    );
    const players = room.players.filter(
      (p) => p.socketId && !p.left && !p.spectator,
    );
    check(players.length >= 3, "Il faut au moins 3 joueurs connectés.");
    check(
      room.players
        .filter((p) => !p.left && !p.spectator)
        .every((p) => p.socketId),
      "Attendez la reconnexion ou retirez les joueurs absents.",
    );
    check(
      players.every((p) => p.ready),
      "Tous les joueurs doivent être prêts.",
    );
    check(
      players.length >= spiesFor(room.settings) * 3,
      "Il faut au moins " +
        spiesFor(room.settings) * 3 +
        " joueurs pour ce nombre d’espions.",
    );
    const word = this.draw(room);
    const roles = new Map<string, "spy" | "innocent">(
      players.map((p) => [p.id, "innocent"]),
    );
    const pool = [...players];
    for (let i = 0; i < spiesFor(room.settings); i++) {
      const [spy] = pool.splice(this.choose(pool.length), 1);
      roles.set(spy.id, "spy");
    }
    room.round = {
      index: (room.round?.index ?? 0) + 1,
      word,
      roles,
      eliminated: new Set(),
      votes: new Map(),
      ballotIndex: 0,
      runoff: false,
      candidates: [],
      eligibleVoters: [],
      guessPlayerId: null,
      scored: false,
      result: null,
      deadlineAt: this.now() + 15000,
      passed: false,
      revision: 0,
      finishedAt: null,
      scoresBefore: new Map(room.players.map((p) => [p.id, p.score])),
    };
    room.phase = "reveal";
    room.messages = [];
  }
  card(room: Room, player: Player): Card | null {
    const r = room.round;
    if (
      !r ||
      player.spectator ||
      room.phase === "lobby" ||
      !r.roles.has(player.id)
    )
      return null;
    const role = r.roles.get(player.id)!;
    return {
      roundIndex: r.index,
      revision: r.revision,
      role,
      category: r.word.category,
      ...(role === "innocent" ? { word: r.word.label } : {}),
    };
  }
  discussion(room: Room, player?: Player) {
    if (player) this.host(room, player);
    check(room.phase === "reveal", "La révélation est terminée.");
    room.phase = "discussion";
    room.round!.deadlineAt = this.now() + room.settings.duration * 60000;
  }
  beginVote(room: Room, player?: Player) {
    if (player) this.host(room, player);
    check(room.phase === "discussion", "Le vote n’est pas disponible.");
    const r = room.round!;
    r.runoff = false;
    this.ballot(room);
  }
  ballot(room: Room, candidates?: string[]) {
    const r = room.round!;
    room.phase = "voting";
    r.ballotIndex++;
    r.votes.clear();
    r.guessPlayerId = null;
    r.eligibleVoters = [...r.roles.keys()].filter(
      (id) =>
        !r.eliminated.has(id) && !room.players.find((p) => p.id === id)!.left,
    );
    r.candidates = candidates ?? [...r.eligibleVoters];
    r.deadlineAt = this.now() + 45000;
    if (!r.candidates.length || !r.eligibleVoters.length)
      this.finish(room, "spies", "Aucun vote possible.");
  }
  vote(room: Room, player: Player, target: string, index: number) {
    const r = room.round;
    check(room.phase === "voting" && r, "Le vote est fermé.");
    check(index === r.ballotIndex, "Ce bulletin appartient à un ancien tour.");
    check(r.eligibleVoters.includes(player.id), "Vous ne pouvez pas voter.");
    check(r.candidates.includes(target), "Ce joueur ne peut pas être désigné.");
    check(!r.votes.has(player.id), "Vous avez déjà voté.");
    r.votes.set(player.id, target);
    if (r.votes.size === r.eligibleVoters.length) this.resolveVote(room);
  }
  resolveVote(room: Room) {
    const r = room.round!;
    const counts = new Map(r.candidates.map((id) => [id, 0]));
    for (const target of r.votes.values())
      counts.set(target, (counts.get(target) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const tied = [...counts].filter(([, n]) => n === max).map(([id]) => id);
    if (max === 0) {
      this.finish(room, "spies", "Aucun espion identifié : aucun suffrage.");
      return;
    }
    if (tied.length > 1) {
      if (!r.runoff) {
        r.runoff = true;
        this.ballot(room, tied);
      } else
        this.finish(
          room,
          "spies",
          "Égalité au second tour : les espions restent cachés.",
        );
      return;
    }
    const target = tied[0];
    if (r.roles.get(target) === "innocent") {
      this.finish(room, "spies", "Un innocent a été accusé.");
      return;
    }
    r.guessPlayerId = target;
    room.phase = "spy_guess";
    r.deadlineAt = this.now() + 30000;
  }
  guess(room: Room, player: Player, word: string) {
    check(
      room.phase === "spy_guess" && room.round?.guessPlayerId === player.id,
      "Ce n’est pas votre tentative.",
    );
    this.resolveGuess(room, word);
  }
  resolveGuess(room: Room, word: string) {
    const r = room.round!;
    if (
      [r.word.label, ...r.word.variants].some(
        (label) => normalize(word) === normalize(label),
      )
    ) {
      this.finish(
        room,
        "spies",
        "L’espion a retrouvé le mot secret.",
        r.guessPlayerId!,
      );
      return;
    }
    r.eliminated.add(r.guessPlayerId!);
    r.guessPlayerId = null;
    if (
      [...r.roles].some(([id, role]) => role === "spy" && !r.eliminated.has(id))
    ) {
      r.runoff = false;
      this.ballot(room);
    } else
      this.finish(room, "innocents", "Tous les espions ont été démasqués.");
  }
  finish(
    room: Room,
    winner: "spies" | "innocents",
    reason: string,
    guesser?: string,
  ) {
    const r = room.round!;
    if (r.scored) return;
    r.scored = true;
    r.finishedAt = this.now();
    room.completedRounds++;
    room.phase = "results";
    r.guessPlayerId = null;
    const roles = [...r.roles].map(([playerId, role]) => {
      const points =
        winner === "innocents"
          ? role === "innocent"
            ? 100
            : 0
          : role === "spy"
            ? guesser
              ? guesser === playerId
                ? 150
                : 0
              : !r.eliminated.has(playerId)
                ? 200
                : 0
            : 0;
      const player = room.players.find((p) => p.id === playerId)!;
      player.score += points;
      const standing = room.scoreboard.get(playerId) ?? {
        playerId,
        nickname: player.nickname,
        score: 0,
        wins: 0,
        rounds: 0,
        spyRounds: 0,
      };
      standing.score += points;
      standing.rounds++;
      standing.spyRounds += role === "spy" ? 1 : 0;
      standing.wins += (winner === "spies") === (role === "spy") ? 1 : 0;
      room.scoreboard.set(playerId, standing);
      return { playerId, role, points };
    });
    r.result = {
      word: r.word.label,
      category: r.word.category,
      winner,
      reason,
      roles,
    };
    room.history.push({
      roundIndex: r.index,
      finishedAt: r.finishedAt!,
      result: r.result,
      names: Object.fromEntries(room.players.map((p) => [p.id, p.nickname])),
    });
    room.history = room.history.slice(-100);
  }
  rematch(room: Room, player: Player) {
    this.host(room, player);
    check(room.phase === "results", "La manche n’est pas terminée.");
    this.enterLobby(room);
  }
  enterLobby(room: Room) {
    room.phase = "lobby";
    room.players = room.players.filter((p) => !p.left);
    let active = room.players.filter((p) => !p.spectator).length;
    for (const p of room.players) {
      p.ready = false;
      if (p.spectator && p.queued && active < 12) {
        p.spectator = false;
        p.queued = false;
        active++;
      }
    }
  }
  leave(room: Room, player: Player) {
    player.left = true;
    player.socketId = null;
    player.ready = false;
    this.transferHost(room);
    const r = room.round;
    if (
      r &&
      ["reveal", "discussion", "voting", "spy_guess"].includes(room.phase) &&
      r.roles.has(player.id)
    ) {
      // A departure never turns a player into a second identity in the same round.
      if (room.players.filter((p) => !p.left && r.roles.has(p.id)).length < 3)
        this.finish(
          room,
          "spies",
          "La manche s’arrête : moins de 3 joueurs restent dans le salon.",
        );
    }
    if (room.phase === "lobby")
      room.players = room.players.filter((p) => !p.left);
  }
  disconnect(room: Room, player: Player) {
    player.socketId = null;
    player.disconnectedAt = this.now();
    player.ready = false;
    this.transferHost(room);
  }
  transferHost(room: Room) {
    const host = room.players.find((p) => p.id === room.hostPlayerId);
    if (!host?.socketId || host.left)
      room.hostPlayerId =
        (
          room.players.find((p) => p.socketId && !p.left && !p.spectator) ??
          room.players.find((p) => p.socketId && !p.left)
        )?.id ?? room.hostPlayerId;
  }
  tick(room: Room) {
    const now = this.now();
    for (const p of room.players)
      if (
        !p.left &&
        !p.socketId &&
        p.disconnectedAt !== null &&
        now - p.disconnectedAt >= 60000
      )
        this.leave(room, p);
    if (room.round && now >= room.round.deadlineAt) {
      switch (room.phase) {
        case "reveal":
          this.discussion(room);
          break;
        case "discussion":
          this.beginVote(room);
          break;
        case "voting":
          this.resolveVote(room);
          break;
        case "spy_guess":
          this.resolveGuess(room, "");
          break;
      }
    }
    if (!room.players.some((p) => p.socketId) && now - room.updatedAt > 3600000)
      this.rooms.delete(room.code);
  }
  allWords(room: Room): Word[] {
    const words: Word[] = room.settings.includeOfficial ? [...wordBank] : [];
    for (const id of room.settings.packIds) {
      const record = room.packs.get(id);
      if (record)
        record.pack.words.forEach((word, index) =>
          words.push({
            ...word,
            id: `${id}:${record.revision}:${index}`,
            locale: "fr",
            enabled: true,
          }),
        );
    }
    // Identical labels in several packs represent one secret, not extra lottery entries.
    return [...new Map(words.map((w) => [normalize(w.label), w])).values()];
  }
  pool(room: Room): Word[] {
    return this.allWords(room).filter(
      (w) =>
        w.enabled &&
        room.settings.categories.includes(w.category) &&
        (!room.settings.subcategories.length ||
          room.settings.subcategories.includes(
            `${w.category}::${w.subcategory}`,
          )) &&
        (room.settings.difficulty === "all" ||
          w.difficulty === room.settings.difficulty) &&
        room.players
          .filter((p) => !p.left && !p.spectator)
          .every(
            (p) =>
              (!p.knownCategories.length ||
                p.knownCategories.includes(w.category)) &&
              (!p.knownSubcategories.length ||
                p.knownSubcategories.includes(
                  `${w.category}::${w.subcategory}`,
                )),
          ),
    );
  }
  subcategories(room: Room) {
    const counts = new Map<
      string,
      { category: string; name: string; count: number }
    >();
    for (const word of this.allWords(room)) {
      const key = `${word.category}::${word.subcategory}`;
      const current = counts.get(key) ?? {
        category: word.category,
        name: word.subcategory,
        count: 0,
      };
      current.count++;
      counts.set(key, current);
    }
    return [...counts.values()];
  }
  isUnseen(room: Room, word: Word) {
    return [word.label, ...word.variants].every(
      (label) => !room.usedWords.has(normalize(label)),
    );
  }
  draw(room: Room) {
    const words = this.pool(room);
    check(
      words.length,
      "Aucun mot compatible avec les filtres collectifs. Élargissez les catégories ou vos connaissances.",
    );
    const unseen = words.filter((w) => this.isUnseen(room, w));
    check(
      unseen.length,
      "Le vivier est épuisé. Réinitialisez l’historique ou élargissez les catégories.",
    );
    const word = unseen[this.choose(unseen.length)];
    for (const label of [word.label, ...word.variants])
      room.usedWords.add(normalize(label));
    return word;
  }
  resetWords(room: Room, player: Player) {
    this.host(room, player);
    check(room.phase === "lobby", "Réinitialisation disponible dans le lobby.");
    room.usedWords.clear();
  }
  preferences(
    room: Room,
    player: Player,
    categories: string[],
    subcategories: string[],
  ) {
    check(
      room.phase === "lobby" || player.spectator,
      "Les connaissances sont verrouillées pendant la manche.",
    );
    check(
      !this.seriesActive(room) ||
        player.spectator ||
        !room.scoreboard.has(player.id),
      "Les connaissances restent fixes pendant une série.",
    );
    player.knownCategories = categories;
    player.knownSubcategories = subcategories;
    room.players.forEach((p) => (p.ready = false));
  }
  participate(room: Room, player: Player, queued: boolean) {
    check(
      player.spectator || room.phase === "lobby",
      "Attendez le lobby pour devenir spectateur.",
    );
    if (!queued) {
      if (player.spectator) player.queued = false;
      else {
        player.spectator = true;
        player.ready = false;
      }
      return;
    }
    check(player.spectator, "Vous participez déjà.");
    check(
      room.players.filter(
        (p) => !p.left && (!p.spectator || p.queued) && p.id !== player.id,
      ).length < 12,
      "Les 12 places sont réservées.",
    );
    if (room.phase === "lobby") {
      player.spectator = false;
      player.queued = false;
      player.ready = false;
    } else player.queued = true;
  }
  pass(room: Room, player: Player, roundIndex: number) {
    this.host(room, player);
    check(room.settings.allowPass, "Le passage de mot n’est pas autorisé.");
    check(
      room.phase === "reveal" && room.round?.index === roundIndex,
      "Le mot peut être passé seulement pendant sa révélation.",
    );
    check(!room.round.passed, "Un seul passage par manche.");
    const word = this.draw(room);
    room.round.word = word;
    room.round.revision++;
    room.round.passed = true;
    room.round.deadlineAt = this.now() + 15000;
  }
  seriesActive(room: Room) {
    return room.settings.rounds > 1 && room.completedRounds > 0;
  }
  tournamentFinished(room: Room) {
    return (
      room.settings.rounds > 1 && room.completedRounds >= room.settings.rounds
    );
  }
  resetTournament(room: Room, player: Player) {
    this.host(room, player);
    check(
      ["lobby", "results"].includes(room.phase),
      "Attendez la fin de la manche.",
    );
    room.completedRounds = 0;
    room.history = [];
    room.scoreboard.clear();
    room.players.forEach((p) => {
      p.score = 0;
      p.ready = false;
    });
    this.enterLobby(room);
  }
  packSummary(record: PackRecord): PackSummary {
    return {
      id: record.id,
      name: record.pack.name,
      status: record.status,
      wordCount: record.pack.words.length,
      categories: [...new Set(record.pack.words.map((w) => w.category))],
      revision: record.revision,
    };
  }
  attachPack(room: Room, player: Player, record: PackRecord) {
    this.host(room, player);
    check(
      room.phase === "lobby" && !this.seriesActive(room),
      "Les packs sont verrouillés pendant une série.",
    );
    check(
      room.packs.size < 10 || room.packs.has(record.id),
      "Dix packs maximum par salon.",
    );
    room.packs.set(record.id, structuredClone(record));
    room.settings = {
      ...room.settings,
      packIds: [...new Set([...room.settings.packIds, record.id])],
      categories: [
        ...new Set([
          ...room.settings.categories,
          ...record.pack.words.map((w) => w.category),
        ]),
      ],
    };
    room.players.forEach((p) => (p.ready = false));
  }
  streamLink(room: Room, player: Player) {
    this.host(room, player);
    const token = randomBytes(32).toString("hex");
    room.streamTokenHash = hash(token);
    return token;
  }
  streamRoom(token: string) {
    const digest = hash(token);
    return [...this.rooms.values()].find(
      (room) => room.streamTokenHash === digest,
    );
  }
  streamView(room: Room): StreamView {
    const r = room.round;
    const revealAt =
      r?.finishedAt !== null && r?.finishedAt !== undefined
        ? r.finishedAt + room.settings.streamDelay * 1000
        : null;
    const ready = revealAt !== null && this.now() >= revealAt;
    const result =
      room.phase === "results" && ready && r?.result ? r.result : null;
    return {
      phase: room.phase,
      roundIndex: room.completedRounds + (room.phase === "results" ? 0 : 1),
      rounds: room.settings.rounds,
      serverNow: this.now(),
      deadlineAt: !["lobby", "results"].includes(room.phase)
        ? (r?.deadlineAt ?? null)
        : null,
      voteCount: room.phase === "voting" ? (r?.votes.size ?? 0) : 0,
      voterCount: room.phase === "voting" ? (r?.eligibleVoters.length ?? 0) : 0,
      players: room.players
        .filter((p) => !p.spectator && !p.left)
        .map((p) => ({
          nickname: p.nickname,
          score:
            p.score -
            room.history
              .filter(
                (h) =>
                  h.finishedAt + room.settings.streamDelay * 1000 > this.now(),
              )
              .reduce(
                (sum, h) =>
                  sum +
                  (h.result.roles.find((role) => role.playerId === p.id)
                    ?.points ?? 0),
                0,
              ),
        })),
      spectators: room.players.filter((p) => p.spectator && !p.left).length,
      ...(!room.settings.streamPrivacy ? { roomCode: room.code } : {}),
      revealAt: room.phase === "results" ? revealAt : null,
      result: result
        ? {
            winner: result.winner,
            ...(!room.settings.streamPrivacy
              ? {
                  word: result.word,
                  roles: result.roles.map((role) => ({
                    nickname:
                      room.players.find((p) => p.id === role.playerId)
                        ?.nickname ?? "Joueur parti",
                    role: role.role,
                    points: role.points,
                  })),
                }
              : {}),
          }
        : null,
    };
  }
  view(room: Room): RoomView {
    const r = room.round;
    return {
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      players: room.players
        .filter((p) => !p.left || room.phase !== "lobby")
        .map((p) => ({
          id: p.id,
          nickname: p.nickname,
          ready: p.ready,
          connected: !!p.socketId,
          score: p.score,
          spectator: p.spectator,
          queued: p.queued,
          knownCategories: p.knownCategories,
          knownSubcategories: p.knownSubcategories,
          eliminated:
            room.phase !== "lobby" && (r?.eliminated.has(p.id) ?? false),
        })),
      settings: room.settings,
      phase: room.phase,
      deadlineAt:
        r && !["lobby", "results"].includes(room.phase) ? r.deadlineAt : null,
      serverNow: this.now(),
      roundIndex: r?.index ?? 0,
      ballotIndex: r?.ballotIndex ?? 0,
      voteCount: room.phase === "voting" ? (r?.votes.size ?? 0) : 0,
      eligibleVoters: room.phase === "voting" ? (r?.eligibleVoters ?? []) : [],
      candidates: room.phase === "voting" ? (r?.candidates ?? []) : [],
      guessPlayerId:
        room.phase === "spy_guess" ? (r?.guessPlayerId ?? null) : null,
      messages: room.messages,
      availableWords: this.pool(room).length,
      remainingWords: this.pool(room).filter((w) => this.isUnseen(room, w))
        .length,
      subcategoryOptions: this.subcategories(room),
      categoryOptions: [...new Set(this.allWords(room).map((w) => w.category))],
      publicVotes:
        !room.settings.anonymousVotes && room.phase === "voting"
          ? [...r!.votes].map(([voterPlayerId, targetPlayerId]) => ({
              voterPlayerId,
              targetPlayerId,
            }))
          : [],
      completedRounds: room.completedRounds,
      tournamentFinished: this.tournamentFinished(room),
      history: room.history,
      standings: [...room.scoreboard.values()].sort(
        (a, b) =>
          b.score - a.score ||
          b.wins - a.wins ||
          a.nickname.localeCompare(b.nickname, "fr"),
      ),
      packs: [...room.packs.values()].map((pack) => this.packSummary(pack)),
      passed: r?.passed ?? false,

      result: room.phase === "results" ? (r?.result ?? null) : null,
    };
  }
}
export const normalize = normalizeWord;
