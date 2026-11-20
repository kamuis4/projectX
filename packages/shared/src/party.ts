export const partyGames = ["wavelength", "auction", "bluff"] as const;
export type PartyGame = (typeof partyGames)[number];
export const battleCriteria = {
  fight: "L’équipe qui gagne la bagarre",
  smart: "L’équipe la plus intelligente",
  style: "L’équipe la plus stylée",
} as const;
export type BattleCriterion = keyof typeof battleCriteria;
export const bluffQuestions = {
  high: "La carte vaut-elle plus de 5 points ?",
  even: "La valeur de la carte est-elle paire ?",
  strong: "Le personnage a-t-il au moins 8 en force ?",
  smart: "Le personnage a-t-il au moins 8 en intelligence ?",
  anime: "Le personnage vient-il d’un animé ou manga ?",
  hero: "Le personnage est-il un héros ?",
} as const;
export type BluffQuestion = keyof typeof bluffQuestions;
export type CharacterCard = {
  id: string;
  name: string;
  universe: string;
  origin: "anime" | "cinema" | "game" | "comics";
  hero: boolean;
  power: number;
  intelligence: number;
  value: number;
};
export type PartySession = { code: string; playerId: string; token: string };
export type PartyPlayer = {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  credits: number;
  team: CharacterCard[];
};
export type WaveView = {
  speakerId: string;
  poles: [string, string];
  clue: string;
  target?: number;
  submitted: string[];
  myGuess?: number;
  guesses?: Record<string, number>;
  earned?: Record<string, number>;
};
export type AuctionView = {
  criterion: BattleCriterion;
  card: CharacterCard;
  drawerId: string;
  highBid: number;
  highBidderId: string;
  passed: string[];
  voted: string[];
  votes?: Record<string, string>;
  winners?: string[];
  lastSale?: { name: string; buyer: string; price: number };
};
export type BluffView = {
  holderId: string;
  receiverId: string;
  questions: { key: BluffQuestion; answer?: boolean }[];
  card?: CharacterCard;
  recipientId?: string;
  choice?: "take" | "leave";
};
export type PartyView = {
  code: string;
  game: PartyGame;
  hostId: string;
  phase:
    | "lobby"
    | "clue"
    | "guess"
    | "wave-result"
    | "bidding"
    | "vote"
    | "auction-result"
    | "questions"
    | "decision"
    | "bluff-result"
    | "finished";
  players: PartyPlayer[];
  round: number;
  totalRounds: number;
  criterion: BattleCriterion;
  wave?: WaveView;
  auction?: AuctionView;
  bluff?: BluffView;
  message: string;
};
export type PartyAck =
  { ok: true; session?: PartySession } | { ok: false; error: string };
export type PartyAction =
  | { type: "start" }
  | { type: "game"; game: PartyGame }
  | { type: "criterion"; criterion: BattleCriterion }
  | { type: "clue"; text: string }
  | { type: "guess"; value: number }
  | { type: "next" }
  | { type: "bid"; amount: number }
  | { type: "pass" }
  | { type: "vote"; playerId: string }
  | { type: "ask"; question: BluffQuestion }
  | { type: "answer" }
  | { type: "choose"; choice: "take" | "leave" }
  | { type: "reset" }
  | { type: "remove"; playerId: string };
