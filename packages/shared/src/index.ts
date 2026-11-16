import { z } from "zod";
export const categories = [
  "Animés / mangas",
  "Films",
  "Jeux vidéo",
  "Séries",
  "Musique",
  "Culture générale",
  "YouTube",
] as const;
export const nicknameSchema = z
  .string()
  .trim()
  .min(2, "Le pseudo doit contenir au moins 2 caractères.")
  .max(24)
  .regex(
    /^[\p{L}\p{N} _.-]+$/u,
    "Ce pseudo contient des caractères interdits.",
  );
export const safeLabel = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((v) => !/[<>]/.test(v), "Le HTML est interdit.");
export const settingsSchema = z
  .object({
    mode: z.enum(["classic", "double", "custom"]),
    duration: z.union([
      z.literal(3),
      z.literal(5),
      z.literal(7),
      z.literal(10),
    ]),
    categories: z.array(safeLabel).min(1).max(40),
    subcategories: z.array(safeLabel).max(100).default([]),
    spyCount: z.number().int().min(1).max(3).default(1),
    rounds: z.number().int().min(1).max(10).default(1),
    tournament: z.boolean().default(false),
    anonymousVotes: z.boolean().default(true),
    allowPass: z.boolean().default(false),
    includeOfficial: z.boolean().default(true),
    packIds: z.array(z.string().uuid()).max(10).default([]),
    streamDelay: z.number().int().min(0).max(120).default(15),
    streamPrivacy: z.boolean().default(true),
    difficulty: z.enum(["all", "easy", "medium", "hard"]),
    discordUrl: z.union([
      z.literal(""),
      z
        .string()
        .url()
        .max(200)
        .refine(
          (v) =>
            /^https:\/\/(discord\.gg\/|discord\.com\/invite\/)[\w-]+$/.test(v),
          "Lien d’invitation Discord invalide.",
        ),
    ]),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  mode: "classic",
  duration: 5,
  categories: [...categories],
  difficulty: "all",
  discordUrl: "",
  subcategories: [],
  spyCount: 1,
  rounds: 1,
  tournament: false,
  anonymousVotes: true,
  allowPass: false,
  includeOfficial: true,
  packIds: [],
  streamDelay: 15,
  streamPrivacy: true,
};
export type Phase =
  "lobby" | "reveal" | "discussion" | "voting" | "spy_guess" | "results";
export type PlayerView = {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  score: number;
  eliminated: boolean;
  spectator: boolean;
  queued: boolean;
  knownCategories: string[];
  knownSubcategories: string[];
};
export type Message = {
  id: string;
  playerId: string;
  nickname: string;
  body: string;
  createdAt: number;
};
export type Result = {
  word: string;
  category: string;
  winner: "spies" | "innocents";
  reason: string;
  roles: { playerId: string; role: "spy" | "innocent"; points: number }[];
};
export type RoomView = {
  code: string;
  hostPlayerId: string;
  players: PlayerView[];
  settings: Settings;
  phase: Phase;
  deadlineAt: number | null;
  serverNow: number;
  roundIndex: number;
  ballotIndex: number;
  voteCount: number;
  eligibleVoters: string[];
  candidates: string[];
  guessPlayerId: string | null;
  messages: Message[];
  result: Result | null;
  availableWords: number;
  remainingWords: number;
  subcategoryOptions: { category: string; name: string; count: number }[];
  categoryOptions: string[];
  publicVotes: { voterPlayerId: string; targetPlayerId: string }[];
  completedRounds: number;
  tournamentFinished: boolean;
  history: RoundHistory[];
  standings: Standing[];
  packs: PackSummary[];
  passed: boolean;
};
export type Card = {
  roundIndex: number;
  role: "spy" | "innocent";
  category: string;
  word?: string;
  revision: number;
};
export type Session = { token: string; playerId: string; code: string };
export type Ack =
  | {
      ok: true;
      session?: Session;
      streamToken?: string;
      counts?: { available: number; remaining: number };
    }
  | { ok: false; error: string };
export const commands = {
  "room:create": z.object({ nickname: nicknameSchema }),
  "room:join": z.object({
    nickname: nicknameSchema,
    spectator: z.boolean().default(false),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{8}$/),
  }),
  "room:resume": z.object({
    token: z.string().length(64),
    code: z.string().length(8),
  }),
  "stream:watch": z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
  "stream:create": z.object({}),
  "room:participate": z.object({ queued: z.boolean() }),
  "room:preferences": z.object({
    categories: z.array(safeLabel).max(40),
    subcategories: z.array(safeLabel).max(100),
  }),
  "words:reset": z.object({}),
  "game:pass": z.object({ roundIndex: z.number().int().min(1) }),
  "tournament:reset": z.object({}),
  "pack:attach": z.object({ packId: z.string().uuid() }),
  "room:leave": z.object({}),
  "room:ready": z.object({ ready: z.boolean() }),
  "room:kick": z.object({ playerId: z.string().uuid() }),
  "room:settings:update": settingsSchema,
  "room:preview": settingsSchema,
  "game:start": z.object({}),
  "game:card:request": z.object({}),
  "game:discussion": z.object({}),
  "game:vote": z.object({}),
  "chat:send": z.object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine(
        (v) =>
          !/[<>]/.test(v) &&
          ![...v].some(
            (c) =>
              c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
          ),
        "Le HTML et les caractères de contrôle sont interdits.",
      ),
  }),
  "vote:cast": z.object({
    targetPlayerId: z.string().uuid(),
    ballotIndex: z.number().int().min(1),
    roundIndex: z.number().int().min(1),
  }),
  "spy:guess": z.object({
    word: z.string().trim().min(1).max(100),
    roundIndex: z.number().int().min(1),
  }),
  "game:rematch": z.object({}),
};
export type Command = keyof typeof commands;

export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export const packWordSchema = z
  .object({
    label: safeLabel,
    category: safeLabel,
    subcategory: safeLabel,
    difficulty: difficultySchema,
    variants: z.array(safeLabel).max(12).default([]),
  })
  .strict();
export const packSchema = z
  .object({
    version: z.literal(1),
    name: safeLabel,
    description: z
      .string()
      .trim()
      .max(500)
      .refine((v) => !/[<>]/.test(v)),
    words: z.array(packWordSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const forms = new Set<string>();
    for (const word of pack.words)
      for (const form of [word.label, ...word.variants]) {
        const key = normalizeWord(form);
        if (!key || forms.has(key))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Les mots et variantes doivent être non vides et uniques dans le pack.",
          });
        forms.add(key);
      }
  });
export type WordPack = z.infer<typeof packSchema>;
export type PackStatus = "private" | "pending" | "approved" | "rejected";
export type PackSummary = {
  id: string;
  name: string;
  status: PackStatus;
  wordCount: number;
  categories: string[];
  revision: number;
};
export type PackRecord = {
  id: string;
  ownerKey: string;
  pack: WordPack;
  status: PackStatus;
  revision: number;
  updatedAt: number;
};
export type Preset = { id: string; name: string; settings: Settings };
export type Library = {
  packs: (PackSummary & { pack: WordPack })[];
  catalog: PackSummary[];
  presets: Preset[];
  moderator: boolean;
  queue: (PackSummary & { pack: WordPack })[];
};
export type RoundHistory = {
  roundIndex: number;
  finishedAt: number;
  result: Result;
  names: Record<string, string>;
};
export type Standing = {
  playerId: string;
  nickname: string;
  score: number;
  wins: number;
  rounds: number;
  spyRounds: number;
};
export type StreamView = {
  phase: Phase;
  roundIndex: number;
  rounds: number;
  serverNow: number;
  deadlineAt: number | null;
  voteCount: number;
  voterCount: number;
  players: { nickname: string; score: number }[];
  spectators: number;
  roomCode?: string;
  revealAt: number | null;
  result: {
    winner: "spies" | "innocents";
    word?: string;
    roles?: { nickname: string; role: string; points: number }[];
  } | null;
};
export function spiesFor(settings: Settings) {
  return settings.mode === "double"
    ? 2
    : settings.mode === "custom"
      ? settings.spyCount
      : 1;
}
export function normalizeWord(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
