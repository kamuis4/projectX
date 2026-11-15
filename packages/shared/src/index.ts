import { z } from "zod";
export const categories = [
  "Animés / mangas",
  "Films",
  "Jeux vidéo",
  "Séries",
  "Musique",
  "Culture générale",
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
export const settingsSchema = z
  .object({
    mode: z.enum(["classic", "double"]),
    duration: z.union([
      z.literal(3),
      z.literal(5),
      z.literal(7),
      z.literal(10),
    ]),
    categories: z.array(z.enum(categories)).min(1).max(6),
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
};
export type Card = {
  roundIndex: number;
  role: "spy" | "innocent";
  category: string;
  word?: string;
};
export type Session = { token: string; playerId: string; code: string };
export type Ack =
  { ok: true; session?: Session } | { ok: false; error: string };
export const commands = {
  "room:create": z.object({ nickname: nicknameSchema }),
  "room:join": z.object({
    nickname: nicknameSchema,
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
  "room:leave": z.object({}),
  "room:ready": z.object({ ready: z.boolean() }),
  "room:kick": z.object({ playerId: z.string().uuid() }),
  "room:settings:update": settingsSchema,
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
