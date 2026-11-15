import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  defaultSettings,
  type Settings,
  type Phase,
  type RoomView,
  type Message,
  type Card,
  type Result,
} from "@spyfall/shared";
import wordBank from "../../../data/words.fr.json";
export type Word = (typeof wordBank)[number];
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
    };
    this.rooms.set(code, room);
    return this.join(code, nickname, socketId, userId);
  }
  join(code: string, nickname: string, socketId: string, userId?: string) {
    const room = this.get(code);
    check(room.phase === "lobby", "La partie a déjà commencé.");
    check(
      room.players.filter((p) => !p.left).length < 12,
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
    room.settings = settings;
    room.players.forEach((p) => (p.ready = false));
  }
  start(room: Room, player: Player) {
    this.host(room, player);
    check(room.phase === "lobby", "Une manche est déjà en cours.");
    const players = room.players.filter((p) => p.socketId && !p.left);
    check(players.length >= 3, "Il faut au moins 3 joueurs connectés.");
    check(
      room.players.filter((p) => !p.left).every((p) => p.socketId),
      "Attendez la reconnexion ou retirez les joueurs absents.",
    );
    check(
      players.every((p) => p.ready),
      "Tous les joueurs doivent être prêts.",
    );
    check(
      room.settings.mode !== "double" || players.length >= 6,
      "Le mode double espion exige au moins 6 joueurs.",
    );
    let words = wordBank.filter(
      (w) =>
        w.enabled &&
        room.settings.categories.includes(
          w.category as Settings["categories"][number],
        ) &&
        (room.settings.difficulty === "all" ||
          w.difficulty === room.settings.difficulty),
    );
    check(words.length > 0, "Aucun mot ne correspond aux paramètres.");
    const unseen = words.filter((w) => !room.usedWords.has(w.id));
    if (unseen.length) words = unseen;
    const word = words[this.choose(words.length)];
    room.usedWords.add(word.id);
    const roles = new Map<string, "spy" | "innocent">(
      players.map((p) => [p.id, "innocent"]),
    );
    const pool = [...players];
    for (let i = 0; i < (room.settings.mode === "double" ? 2 : 1); i++) {
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
    };
    room.phase = "reveal";
    room.messages = [];
  }
  card(room: Room, player: Player): Card | null {
    const r = room.round;
    if (!r || room.phase === "lobby" || !r.roles.has(player.id)) return null;
    const role = r.roles.get(player.id)!;
    return {
      roundIndex: r.index,
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
    if (normalize(word) === normalize(r.word.label)) {
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
      room.players.find((p) => p.id === playerId)!.score += points;
      return { playerId, role, points };
    });
    r.result = {
      word: r.word.label,
      category: r.word.category,
      winner,
      reason,
      roles,
    };
  }
  rematch(room: Room, player: Player) {
    this.host(room, player);
    check(room.phase === "results", "La manche n’est pas terminée.");
    room.phase = "lobby";
    room.players = room.players.filter((p) => !p.left);
    room.players.forEach((p) => (p.ready = false));
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
        room.players.find((p) => p.socketId && !p.left)?.id ??
        room.hostPlayerId;
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
      result: room.phase === "results" ? (r?.result ?? null) : null,
    };
  }
}
export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
