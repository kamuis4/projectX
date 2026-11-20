import { randomBytes, randomInt, randomUUID, createHash } from "node:crypto";
import {
  type PartyAction,
  type PartyGame,
  type PartyView,
  type PartySession,
  type CharacterCard,
  type BattleCriterion,
  type BluffQuestion,
  type WaveView,
  type AuctionView,
  type BluffView,
} from "@spyfall/shared";
import { characterDeck, wavePoles } from "./party-content";
export class PartyError extends Error {}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PartyError(message);
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type TablePlayer = {
  id: string;
  name: string;
  tokenHash: string;
  socketId: string | null;
  disconnectedAt: number | null;
  score: number;
  credits: number;
  team: CharacterCard[];
};
export type TableRoom = {
  code: string;
  hostId: string;
  game: PartyGame;
  phase: PartyView["phase"];
  players: TablePlayer[];
  round: number;
  totalRounds: number;
  criterion: BattleCriterion;
  updatedAt: number;
  message: string;
  deck: CharacterCard[];
  wave?: WaveView & { target: number; guesses: Record<string, number> };
  auction?: AuctionView & { votes: Record<string, string> };
  bluff?: BluffView & { card: CharacterCard };
  drawerIndex: number;
};
export class PartyEngine {
  rooms = new Map<string, TableRoom>();
  constructor(
    readonly now = Date.now,
    readonly choose = randomInt,
  ) {}
  create(name: string, socketId: string, game: PartyGame) {
    ensure(
      this.rooms.size < 500,
      "Tous les salons sont occupés. Réessayez plus tard.",
    );
    let code: string;
    do {
      code = `H${randomBytes(3).toString("hex").slice(0, 5).toUpperCase()}`;
    } while (this.rooms.has(code));
    const room: TableRoom = {
      code,
      hostId: "",
      game,
      phase: "lobby",
      players: [],
      round: 0,
      totalRounds: 0,
      criterion: "fight",
      updatedAt: this.now(),
      message: "",
      deck: [],
      drawerIndex: -1,
    };
    this.rooms.set(code, room);
    const joined = this.join(code, name, socketId);
    room.hostId = joined.player.id;
    return joined;
  }
  join(code: string, name: string, socketId: string) {
    const room = this.rooms.get(code);
    ensure(room, "Ce salon n’existe plus. Vérifiez le code.");
    ensure(
      room.phase === "lobby",
      "La partie est en cours. Attendez le retour au salon.",
    );
    ensure(
      room.players.length < 8,
      "Le salon est complet (8 joueurs maximum).",
    );
    ensure(
      !room.players.some(
        (p) => p.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"),
      ),
      "Ce pseudo est déjà utilisé dans le salon.",
    );
    const token = randomBytes(32).toString("hex");
    const player: TablePlayer = {
      id: randomUUID(),
      name,
      tokenHash: digest(token),
      socketId,
      disconnectedAt: null,
      score: 0,
      credits: 100,
      team: [],
    };
    room.players.push(player);
    room.updatedAt = this.now();
    return {
      room,
      player,
      session: { code, playerId: player.id, token } satisfies PartySession,
    };
  }
  resume(session: PartySession, socketId: string) {
    const room = this.rooms.get(session.code);
    const player = room?.players.find(
      (p) => p.id === session.playerId && p.tokenHash === digest(session.token),
    );
    ensure(room && player, "Le salon ou la session a expiré.");
    const previousSocketId = player.socketId;
    player.socketId = socketId;
    player.disconnectedAt = null;
    if (!room.players.find((p) => p.id === room.hostId)?.socketId)
      room.hostId = player.id;
    room.updatedAt = this.now();
    return { room, player, previousSocketId };
  }
  host(room: TableRoom, player: TablePlayer) {
    ensure(room.hostId === player.id, "Cette action est réservée à l’hôte.");
  }
  allConnected(room: TableRoom) {
    ensure(
      room.players.every((p) => p.socketId),
      "Attendez les joueurs déconnectés ou retirez-les du salon.",
    );
  }
  reset(room: TableRoom, message = "") {
    room.phase = "lobby";
    room.round = 0;
    room.totalRounds = 0;
    room.wave = undefined;
    room.auction = undefined;
    room.bluff = undefined;
    room.deck = [];
    room.drawerIndex = -1;
    room.message = message;
    room.players.forEach((p) => {
      p.score = 0;
      p.credits = 100;
      p.team = [];
    });
  }
  shuffle() {
    const pool = [...characterDeck],
      deck: CharacterCard[] = [];
    while (pool.length) deck.push(pool.splice(this.choose(pool.length), 1)[0]);
    return deck;
  }
  nextWave(room: TableRoom) {
    room.round++;
    room.wave = {
      speakerId: room.players[(room.round - 1) % room.players.length].id,
      poles: wavePoles[this.choose(wavePoles.length)],
      target: 10 + this.choose(81),
      clue: "",
      submitted: [],
      guesses: {},
    };
    room.phase = "clue";
  }
  maxBid(player: TablePlayer) {
    return player.credits - 10 * (4 - player.team.length);
  }
  nextAuction(room: TableRoom) {
    if (room.players.every((p) => p.team.length === 5)) {
      room.phase = "vote";
      return;
    }
    const lastSale = room.auction?.lastSale;
    do {
      room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
    } while (room.players[room.drawerIndex].team.length === 5);
    const drawer = room.players[room.drawerIndex];
    ensure(room.deck.length, "Le paquet de personnages est épuisé.");
    room.auction = {
      criterion: room.criterion,
      card: room.deck.pop()!,
      drawerId: drawer.id,
      highBid: 10,
      highBidderId: drawer.id,
      passed: [],
      voted: [],
      votes: {},
      lastSale,
    };
    room.round++;
    room.phase = "bidding";
    this.settleAuction(room);
  }
  settleAuction(room: TableRoom) {
    const auction = room.auction!;
    const canContest = room.players.some(
      (p) =>
        p.team.length < 5 &&
        p.id !== auction.highBidderId &&
        !auction.passed.includes(p.id) &&
        this.maxBid(p) > auction.highBid,
    );
    if (canContest) return;
    const buyer = room.players.find((p) => p.id === auction.highBidderId)!;
    buyer.credits -= auction.highBid;
    buyer.team.push(auction.card);
    auction.lastSale = {
      name: auction.card.name,
      buyer: buyer.name,
      price: auction.highBid,
    };
    this.nextAuction(room);
  }
  nextBluff(room: TableRoom) {
    room.round++;
    const i = (room.round - 1) % room.players.length;
    room.bluff = {
      holderId: room.players[i].id,
      receiverId: room.players[(i + 1) % room.players.length].id,
      questions: [],
      card: room.deck.pop()!,
    };
    room.phase = "questions";
  }
  truth(card: CharacterCard, question: BluffQuestion) {
    switch (question) {
      case "high":
        return card.value > 5;
      case "even":
        return card.value % 2 === 0;
      case "strong":
        return card.power >= 8;
      case "smart":
        return card.intelligence >= 8;
      case "anime":
        return card.origin === "anime";
      case "hero":
        return card.hero;
    }
  }
  action(room: TableRoom, player: TablePlayer, action: PartyAction) {
    // Every action authenticates against a current member, even for direct engine callers.
    ensure(
      room.players.includes(player) && !!player.socketId,
      "Session inactive.",
    );
    if (action.type === "reset") {
      this.host(room, player);
      this.reset(
        room,
        "Retour au salon : choisissez un jeu pour la prochaine partie.",
      );
    } else if (action.type === "remove") {
      this.host(room, player);
      const target = room.players.find((p) => p.id === action.playerId);
      ensure(
        target && !target.socketId,
        "Seuls les joueurs déconnectés peuvent être retirés.",
      );
      this.leave(room, target);
      return;
    } else if (action.type === "game" || action.type === "criterion") {
      this.host(room, player);
      ensure(
        room.phase === "lobby",
        "Revenez au salon avant de changer les règles.",
      );
      if (action.type === "game") room.game = action.game;
      else room.criterion = action.criterion;
    } else if (action.type === "start") {
      this.host(room, player);
      ensure(room.phase === "lobby", "Une partie est déjà en cours.");
      ensure(room.players.length >= 2, "Il faut au moins deux joueurs.");
      this.allConnected(room);
      room.message = "";
      room.deck = this.shuffle();
      room.totalRounds =
        room.game === "auction"
          ? room.players.length * 5
          : room.players.length * 2;
      if (room.game === "wavelength") this.nextWave(room);
      else if (room.game === "auction") this.nextAuction(room);
      else this.nextBluff(room);
    } else if (action.type === "next") {
      this.host(room, player);
      this.allConnected(room);
      ensure(
        room.phase === "wave-result" || room.phase === "bluff-result",
        "La manche n’est pas terminée.",
      );
      if (room.round >= room.totalRounds) room.phase = "finished";
      else if (room.game === "wavelength") this.nextWave(room);
      else this.nextBluff(room);
    } else {
      this.allConnected(room);
      if (action.type === "clue") {
        ensure(
          room.phase === "clue" && room.wave?.speakerId === player.id,
          "Seul le guide peut donner l’indice maintenant.",
        );
        room.wave.clue = action.text;
        room.phase = "guess";
      } else if (action.type === "guess") {
        ensure(
          room.phase === "guess" &&
            room.wave &&
            room.wave.speakerId !== player.id,
          "Ce n’est pas votre tour de deviner.",
        );
        const wave = room.wave;
        ensure(
          wave.guesses[player.id] === undefined,
          "Votre estimation est déjà validée.",
        );
        wave.guesses[player.id] = action.value;
        wave.submitted.push(player.id);
        if (wave.submitted.length === room.players.length - 1) {
          wave.earned = {};
          for (const [id, guess] of Object.entries(wave.guesses)) {
            const delta = Math.abs(guess - wave.target);
            const points =
              delta <= 4 ? 4 : delta <= 10 ? 3 : delta <= 18 ? 2 : 0;
            room.players.find((p) => p.id === id)!.score += points;
            wave.earned[id] = points;
          }
          const guidePoints = Math.round(
            Object.values(wave.earned).reduce((a, b) => a + b, 0) /
              (room.players.length - 1),
          );
          room.players.find((p) => p.id === wave.speakerId)!.score +=
            guidePoints;
          wave.earned[wave.speakerId] = guidePoints;
          room.phase = "wave-result";
        }
      } else if (action.type === "bid") {
        ensure(
          room.phase === "bidding" && room.auction,
          "Aucune enchère n’est ouverte.",
        );
        const auction = room.auction;
        ensure(player.team.length < 5, "Votre équipe est déjà complète.");
        ensure(
          auction.highBidderId !== player.id,
          "Vous êtes déjà le meilleur enchérisseur.",
        );
        ensure(
          !auction.passed.includes(player.id),
          "Vous avez passé pour cette carte.",
        );
        ensure(
          action.amount > auction.highBid &&
            action.amount <= this.maxBid(player),
          "Mise trop basse ou budget insuffisant : gardez 10 crédits pour chaque place restante.",
        );
        auction.highBid = action.amount;
        auction.highBidderId = player.id;
        this.settleAuction(room);
      } else if (action.type === "pass") {
        ensure(
          room.phase === "bidding" && room.auction,
          "Aucune enchère n’est ouverte.",
        );
        ensure(
          player.team.length < 5 &&
            room.auction.highBidderId !== player.id &&
            !room.auction.passed.includes(player.id),
          "Vous ne pouvez pas passer cette enchère.",
        );
        room.auction.passed.push(player.id);
        this.settleAuction(room);
      } else if (action.type === "vote") {
        ensure(
          room.phase === "vote" && room.auction,
          "Le vote n’est pas ouvert.",
        );
        ensure(
          (room.players.length === 2 || action.playerId !== player.id) &&
            room.players.some((p) => p.id === action.playerId),
          "Votez pour une autre équipe.",
        );
        ensure(
          !room.auction.votes[player.id],
          "Votre vote est déjà enregistré.",
        );
        room.auction.votes[player.id] = action.playerId;
        room.auction.voted.push(player.id);
        if (room.auction.voted.length === room.players.length) {
          const count = new Map(
            room.players.map((p) => [
              p.id,
              Object.values(room.auction!.votes).filter((id) => id === p.id)
                .length,
            ]),
          );
          const best = Math.max(...count.values());
          room.auction.winners = room.players
            .filter((p) => count.get(p.id) === best)
            .map((p) => p.id);
          room.players.forEach((p) => {
            p.score = count.get(p.id)!;
          });
          room.phase = "auction-result";
        }
      } else if (action.type === "ask") {
        ensure(
          room.phase === "questions" && room.bluff?.receiverId === player.id,
          "Seul le destinataire peut poser une question.",
        );
        const bluff = room.bluff;
        ensure(
          bluff.questions.length < 2 &&
            !bluff.questions.some((q) => q.answer === undefined),
          "Attendez la réponse avant la question suivante.",
        );
        ensure(
          !bluff.questions.some((q) => q.key === action.question),
          "Cette question a déjà été posée.",
        );
        bluff.questions.push({ key: action.question });
      } else if (action.type === "answer") {
        ensure(
          room.phase === "questions" && room.bluff?.holderId === player.id,
          "Seul le détenteur de la carte peut répondre.",
        );
        const question = room.bluff.questions.find(
          (q) => q.answer === undefined,
        );
        ensure(question, "Aucune question en attente.");
        question.answer = this.truth(room.bluff.card, question.key);
        if (room.bluff.questions.length === 2) room.phase = "decision";
      } else if (action.type === "choose") {
        ensure(
          room.phase === "decision" && room.bluff?.receiverId === player.id,
          "Vous pourrez choisir après les deux réponses.",
        );
        const bluff = room.bluff;
        bluff.choice = action.choice;
        bluff.recipientId =
          action.choice === "take" ? bluff.receiverId : bluff.holderId;
        room.players.find((p) => p.id === bluff.recipientId)!.score +=
          bluff.card.value;
        room.phase = "bluff-result";
      }
    }
    room.updatedAt = this.now();
  }
  disconnect(room: TableRoom, player: TablePlayer) {
    player.socketId = null;
    player.disconnectedAt = this.now();
    if (room.hostId === player.id)
      room.hostId = room.players.find((p) => p.socketId)?.id ?? player.id;
    room.updatedAt = this.now();
  }
  leave(room: TableRoom, player: TablePlayer) {
    room.players = room.players.filter((p) => p !== player);
    if (!room.players.length) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id)
      room.hostId = (
        room.players.find((p) => p.socketId) ?? room.players[0]
      ).id;
    if (room.phase !== "lobby")
      this.reset(
        room,
        `${player.name} a quitté la table. La partie a été remise à zéro.`,
      );
    room.updatedAt = this.now();
  }
  tick() {
    for (const room of this.rooms.values()) {
      for (const p of [...room.players])
        if (p.disconnectedAt !== null && this.now() - p.disconnectedAt >= 90000)
          this.leave(room, p);
      if (this.now() - room.updatedAt > 3600000) this.rooms.delete(room.code);
    }
  }
  view(room: TableRoom, playerId: string): PartyView {
    const wave = room.wave;
    const waveRevealed =
      room.phase === "wave-result" ||
      (room.game === "wavelength" && room.phase === "finished");
    const auctionRevealed = room.phase === "auction-result";
    const bluff = room.bluff;
    const bluffRevealed =
      room.phase === "bluff-result" ||
      (room.game === "bluff" && room.phase === "finished");
    return {
      code: room.code,
      hostId: room.hostId,
      game: room.game,
      phase: room.phase,
      round: room.round,
      totalRounds: room.totalRounds,
      criterion: room.criterion,
      message: room.message,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: !!p.socketId,
        score: p.score,
        credits: p.credits,
        team: p.team.map((c) => ({ ...c })),
      })),
      ...(wave
        ? {
            wave: {
              speakerId: wave.speakerId,
              poles: wave.poles,
              clue: wave.clue,
              submitted: [...wave.submitted],
              ...(wave.speakerId === playerId || waveRevealed
                ? { target: wave.target }
                : {}),
              ...(wave.guesses[playerId] !== undefined
                ? { myGuess: wave.guesses[playerId] }
                : {}),
              ...(waveRevealed
                ? { guesses: { ...wave.guesses }, earned: { ...wave.earned } }
                : {}),
            },
          }
        : {}),
      ...(room.auction
        ? {
            auction: {
              criterion: room.auction.criterion,
              card: { ...room.auction.card },
              drawerId: room.auction.drawerId,
              highBid: room.auction.highBid,
              highBidderId: room.auction.highBidderId,
              passed: [...room.auction.passed],
              voted: [...room.auction.voted],
              lastSale: room.auction.lastSale,
              ...(auctionRevealed
                ? {
                    votes: { ...room.auction.votes },
                    winners: room.auction.winners,
                  }
                : {}),
            },
          }
        : {}),
      ...(bluff
        ? {
            bluff: {
              holderId: bluff.holderId,
              receiverId: bluff.receiverId,
              questions: bluff.questions.map((q) => ({ ...q })),
              ...(bluff.holderId === playerId || bluffRevealed
                ? { card: { ...bluff.card } }
                : {}),
              ...(bluffRevealed
                ? { recipientId: bluff.recipientId, choice: bluff.choice }
                : {}),
            },
          }
        : {}),
    };
  }
}
