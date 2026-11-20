import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Eye,
  EyeOff,
  Gamepad2,
  Gavel,
  HelpCircle,
  Layers,
  LogOut,
  Play,
  Radio,
  RotateCcw,
  Shield,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import {
  battleCriteria,
  bluffQuestions,
  partyGames,
  type PartyGame,
  type PartyView,
  type PartySession,
  type PartyAck,
  type PartyAction,
  type CharacterCard,
  type BattleCriterion,
  type BluffQuestion,
} from "@spyfall/shared";
import "./party.css";
const games = [
  {
    id: "spyfall",
    name: "Spyfall",
    tag: "DÉDUCTION",
    pitch: "Un mot pour tout le monde. Sauf pour l’espion.",
    detail:
      "Posez les bonnes questions, gardez votre couverture et démasquez l’intrus.",
    players: "3–12 joueurs",
    time: "5–10 min",
    icon: Shield,
  },
  {
    id: "wavelength",
    name: "Wavelength",
    tag: "INTUITION",
    pitch: "Vous pensez être sur la même longueur d’onde ?",
    detail:
      "Un indice, deux extrêmes. À vous de trouver la position secrète sur le cadran.",
    players: "2–8 joueurs",
    time: "10–15 min",
    icon: Radio,
  },
  {
    id: "auction",
    name: "La Grande Enchère",
    tag: "DRAFT & DÉBAT",
    pitch: "Cinq personnages. Un budget. Beaucoup trop d’ego.",
    detail:
      "Misez, composez votre équipe et défendez-la : qui gagne vraiment la bagarre ?",
    players: "2–8 joueurs",
    time: "15–25 min",
    icon: Gavel,
  },
  {
    id: "bluff",
    name: "Prends ou laisse",
    tag: "BLUFF SANS MENSONGE",
    pitch: "Deux questions. Une carte. Tu la prends ?",
    detail: "Les réponses sont vraies. Votre intuition fera-t-elle le reste ?",
    players: "2–8 joueurs",
    time: "10–15 min",
    icon: Eye,
  },
] as const;
const rules: Record<PartyGame, string[]> = {
  wavelength: [
    "À tour de rôle, un guide voit une cible secrète entre deux extrêmes et donne un indice.",
    "Les autres placent chacun leur curseur. Les estimations restent secrètes jusqu’à la révélation.",
    "Jusqu’à 4 points par estimation ; le guide gagne la moyenne arrondie des points. Chacun est guide deux fois.",
  ],
  auction: [
    "Chaque joueur commence avec 100 crédits. À votre tour, vous tirez un personnage et ouvrez automatiquement à 10.",
    "Les autres surenchérissent ou passent définitivement pour cette carte. La dernière mise remporte le personnage. On réserve 10 crédits par place encore à remplir.",
    "Quand chacun a 5 personnages, débattez puis votez selon le thème choisi. À partir de 3 joueurs, on ne peut pas voter pour soi. Les égalités sont partagées. Les statistiques sont indicatives, le vote décide.",
  ],
  bluff: [
    "Un joueur voit une carte personnage et sa valeur secrète de 1 à 10 points. Le joueur suivant ne voit que son dos.",
    "Le destinataire choisit deux questions distinctes. Le détenteur révèle les réponses calculées à partir de la carte : impossible de mentir.",
    "Le destinataire prend la carte ou la laisse au détenteur. Celui qui la reçoit gagne sa valeur. Chacun détient une carte deux fois ; le plus grand total gagne.",
  ],
};
const names: Record<PartyGame, string> = {
  wavelength: "Wavelength",
  auction: "La Grande Enchère",
  bluff: "Prends ou laisse",
};
const sessionKey = "projectx-party-session";
function readSession(): PartySession | null {
  try {
    const value = JSON.parse(localStorage.getItem(sessionKey) ?? "null");
    return value &&
      typeof value.code === "string" &&
      typeof value.playerId === "string" &&
      typeof value.token === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
function remember(session: PartySession | null) {
  try {
    if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
    else localStorage.removeItem(sessionKey);
  } catch {
    /* The live session still works without storage. */
  }
}
function Illustration({ game }: { game: string }) {
  return (
    <div className={`party-art art-${game}`} aria-hidden="true">
      {game === "wavelength" ? (
        <>
          <div className="art-dial">
            <i />
            <b />
          </div>
          <span className="art-word art-left">FROID</span>
          <span className="art-word art-right">CHAUD</span>
        </>
      ) : game === "spyfall" ? (
        <>
          <div className="art-agent agent-one">
            <Eye size={32} />
          </div>
          <div className="art-agent agent-two">
            <HelpCircle size={32} />
          </div>
          <div className="art-agent agent-three">
            <Eye size={32} />
          </div>
        </>
      ) : (
        <>
          <div className="art-card card-one">
            {game === "auction" ? <Zap /> : "?"}
          </div>
          <div className="art-card card-two">
            {game === "auction" ? <Crown /> : <Eye />}
          </div>
          <div className="art-card card-three">
            {game === "auction" ? <Shield /> : "?"}
          </div>
          <span className="art-chip">
            {game === "auction" ? "100 CRÉDITS" : "PRENDRE OU LAISSER"}
          </span>
        </>
      )}
    </div>
  );
}
function RuleList({ game }: { game: PartyGame }) {
  return (
    <ol className="party-rules">
      {rules[game].map((rule) => (
        <li key={rule}>{rule}</li>
      ))}
    </ol>
  );
}
function Button({
  children,
  secondary = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return (
    <button
      className={`party-button ${secondary ? "party-secondary" : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
function Character({
  card,
  hidden = false,
}: {
  card?: CharacterCard;
  hidden?: boolean;
}) {
  if (!card || hidden)
    return (
      <div className="character-card character-back">
        <Layers size={42} />
        <strong>PROJECT X</strong>
        <span>Une carte. Deux possibilités.</span>
      </div>
    );
  return (
    <article className={`character-card origin-${card.origin}`}>
      <div className="character-top">
        <span>
          {card.origin === "anime"
            ? "ANIMÉ / MANGA"
            : card.origin === "game"
              ? "JEU VIDÉO"
              : card.origin === "comics"
                ? "COMICS"
                : "CINÉMA"}
        </span>
        <Sparkles size={18} />
      </div>
      <div className="character-symbol" aria-hidden="true">
        {card.name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")}
      </div>
      <h3>{card.name}</h3>
      <p>{card.universe}</p>
      <div className="character-stats">
        <span>
          <Zap size={15} />
          Force <b>{card.power}/10</b>
        </span>
        <span>
          <Sparkles size={15} />
          Intelligence <b>{card.intelligence}/10</b>
        </span>
        <span>
          <Trophy size={15} />
          Valeur <b>{card.value} pts</b>
        </span>
      </div>
    </article>
  );
}
const point = (value: number, radius = 156) => {
  const a = Math.PI - (value * Math.PI) / 100;
  return [200 + Math.cos(a) * radius, 195 - Math.sin(a) * radius];
};
function Dial({
  target,
  value,
  poles,
}: {
  target?: number;
  value?: number;
  poles: [string, string];
}) {
  const arc = (low: number, high: number) => {
    const a = point(Math.max(0, low)),
      b = point(Math.min(100, high));
    return `M ${a.join(" ")} A 156 156 0 0 1 ${b.join(" ")}`;
  };
  const needle = value === undefined ? undefined : point(value, 135);
  return (
    <div className="wave-dial">
      <svg
        viewBox="0 0 400 230"
        role="img"
        aria-label={`Cadran de ${poles[0]} à ${poles[1]}${target !== undefined ? `, cible ${target}` : ", cible secrète"}${value !== undefined ? `, estimation ${value}` : ""}`}
      >
        <path
          d="M 44 195 A 156 156 0 0 1 356 195"
          fill="none"
          stroke="var(--party-panel-2)"
          strokeWidth="54"
        />
        {target !== undefined && (
          <>
            <path
              d={arc(target - 18, target + 18)}
              className="dial-band band-two"
            />
            <path
              d={arc(target - 10, target + 10)}
              className="dial-band band-three"
            />
            <path
              d={arc(target - 4, target + 4)}
              className="dial-band band-four"
            />
          </>
        )}
        {[0, 25, 50, 75, 100].map((n) => {
          const p = point(n, 190);
          return (
            <text
              key={n}
              x={p[0]}
              y={p[1] + 5}
              textAnchor="middle"
              className="dial-tick"
            >
              {n}
            </text>
          );
        })}
        {needle && (
          <>
            <line
              x1="200"
              y1="195"
              x2={needle[0]}
              y2={needle[1]}
              stroke="#fff"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="200" cy="195" r="11" fill="#fff" />
          </>
        )}
        {target === undefined && value === undefined && (
          <text x="200" y="145" textAnchor="middle" className="dial-question">
            ?
          </text>
        )}
      </svg>
      <div className="wave-poles">
        <strong>{poles[0]}</strong>
        <span>↔</span>
        <strong>{poles[1]}</strong>
      </div>
    </div>
  );
}
type Act = (action: PartyAction) => Promise<boolean>;
function WaveRound({
  room,
  me,
  act,
  busy,
}: {
  room: PartyView;
  me: string;
  act: Act;
  busy: boolean;
}) {
  const wave = room.wave!;
  const [clue, setClue] = useState("");
  const [guess, setGuess] = useState(50);
  const guide = wave.speakerId === me;
  const result = room.phase === "wave-result" || room.phase === "finished";
  const already = wave.submitted.includes(me);
  return (
    <section className="party-play-panel">
      <span className="party-eyebrow">
        {result
          ? "LE VERDICT DU CADRAN"
          : guide
            ? "VOUS ÊTES LE GUIDE"
            : "À VOUS DE CAPTER L’INDICE"}
      </span>
      <h2>
        {result
          ? `La cible était à ${wave.target}`
          : room.phase === "clue"
            ? guide
              ? "Trouvez le bon indice."
              : "Le guide cherche son indice…"
            : `« ${wave.clue} »`}
      </h2>
      <p className="party-muted">
        {room.players.find((p) => p.id === wave.speakerId)?.name} est le guide
        de cette manche.
      </p>
      <Dial
        target={wave.target}
        value={
          room.phase === "guess" && !guide
            ? (wave.myGuess ?? guess)
            : result
              ? wave.myGuess
              : undefined
        }
        poles={wave.poles}
      />
      {room.phase === "clue" && guide && (
        <form
          className="party-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ type: "clue", text: clue });
          }}
        >
          <label htmlFor="wave-clue">
            Votre indice pour cette position secrète ({wave.target}/100)
          </label>
          <input
            id="wave-clue"
            value={clue}
            minLength={2}
            maxLength={100}
            onChange={(e) => setClue(e.target.value)}
            placeholder="Un exemple qui se situe à cet endroit…"
            required
            disabled={busy}
          />
          <Button disabled={busy}>Envoyer l’indice</Button>
        </form>
      )}
      {room.phase === "guess" && !guide && (
        <div className="wave-estimate">
          <label htmlFor="wave-guess">
            Votre estimation <b>{wave.myGuess ?? guess}/100</b>
          </label>
          <input
            type="range"
            id="wave-guess"
            min={0}
            max={100}
            value={wave.myGuess ?? guess}
            disabled={busy || already}
            onChange={(e) => setGuess(Number(e.target.value))}
          />
          <Button
            disabled={busy || already}
            onClick={() => void act({ type: "guess", value: guess })}
          >
            {already ? (
              <>
                <Check size={18} /> Estimation validée
              </>
            ) : (
              "Valider mon estimation"
            )}
          </Button>
        </div>
      )}
      {room.phase === "guess" && (
        <p className="party-muted">
          {wave.submitted.length}/{room.players.length - 1} estimations validées
          {guide ? " · Votre cible reste secrète." : ""}
        </p>
      )}
      {result && (
        <div className="wave-results">
          {room.players.map((p) => (
            <div key={p.id}>
              <span>
                {p.name}
                {p.id === wave.speakerId
                  ? " · guide"
                  : ` · ${wave.guesses?.[p.id]}/100`}
              </span>
              <strong>+{wave.earned?.[p.id] ?? 0} pts</strong>
            </div>
          ))}
        </div>
      )}
      <div className="wave-legend">
        <span>Centre : 4 pts</span>
        <span>Proche : 3 pts</span>
        <span>Autour : 2 pts</span>
        <span>Au-delà : 0 pt</span>
      </div>
    </section>
  );
}
function Teams({
  room,
  me,
  act,
  busy,
}: {
  room: PartyView;
  me: string;
  act: Act;
  busy: boolean;
}) {
  const voted = room.auction?.voted.includes(me);
  return (
    <div className="party-teams">
      {room.players.map((p) => (
        <article className="party-team" key={p.id}>
          <div className="party-team-heading">
            <h3>
              {p.name}
              {p.id === me ? " · vous" : ""}
            </h3>
            <span>
              {p.team.length}/5 · {p.credits} crédits
            </span>
          </div>
          <ul>
            {p.team.map((c) => (
              <li key={c.id}>
                <b>{c.name}</b>
                <span>{c.universe}</span>
                <small>
                  Force {c.power} · Intelligence {c.intelligence}
                </small>
              </li>
            ))}
          </ul>
          {!p.team.length && (
            <p className="party-muted">Le recrutement commence bientôt.</p>
          )}
          {room.phase === "vote" &&
            (p.id !== me || room.players.length === 2) && (
              <Button
                secondary
                disabled={busy || voted}
                onClick={() => void act({ type: "vote", playerId: p.id })}
              >
                {voted ? "Vote enregistré" : `Voter pour ${p.name}`}
              </Button>
            )}
          {room.phase === "auction-result" && (
            <div className="team-score">
              {room.auction?.winners?.includes(p.id) && <Trophy size={18} />}
              {p.score} vote{p.score > 1 ? "s" : ""}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
function AuctionRound({
  room,
  me,
  act,
  busy,
}: {
  room: PartyView;
  me: string;
  act: Act;
  busy: boolean;
}) {
  const a = room.auction!;
  const player = room.players.find((p) => p.id === me)!;
  const max = player.credits - 10 * (4 - player.team.length);
  const [bid, setBid] = useState(a.highBid + 1);
  useEffect(() => setBid(a.highBid + 1), [a.card.id, a.highBid]);
  const leader = a.highBidderId === me;
  const passed = a.passed.includes(me);
  const canBid =
    !busy && player.team.length < 5 && !leader && !passed && max > a.highBid;
  return (
    <>
      <section className="party-play-panel auction-panel">
        <span className="party-eyebrow">
          {room.phase === "bidding"
            ? "LES ENCHÈRES SONT OUVERTES"
            : room.phase === "vote"
              ? "À VOUS DE TRANCHER"
              : "LE VOTE A PARLÉ"}
        </span>
        <h2>
          {room.phase === "bidding"
            ? "Il manque quelqu’un à votre équipe ?"
            : battleCriteria[room.criterion]}
        </h2>
        {room.phase === "bidding" ? (
          <>
            <p className="party-muted">
              {room.players.find((p) => p.id === a.drawerId)?.name} a tiré cette
              carte et ouvert à 10 crédits.
            </p>
            <div className="auction-table">
              <Character card={a.card} />
              <div className="auction-controls">
                <span className="party-eyebrow">MEILLEURE OFFRE</span>
                <div className="auction-price">
                  {a.highBid}
                  <small>crédits</small>
                </div>
                <p>
                  {room.players.find((p) => p.id === a.highBidderId)?.name} mène
                  l’enchère.
                </p>
                <p className="party-muted">
                  Votre réserve : {player.credits} crédits · Mise maximale :{" "}
                  {Math.max(0, max)}
                  {player.team.length >= 5 ? " · Équipe complète" : ""}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act({ type: "bid", amount: bid });
                  }}
                >
                  <label htmlFor="auction-bid">Votre mise</label>
                  <input
                    id="auction-bid"
                    type="number"
                    min={a.highBid + 1}
                    max={Math.max(a.highBid + 1, max)}
                    step={1}
                    value={bid}
                    disabled={!canBid}
                    onChange={(e) => setBid(Number(e.target.value))}
                  />
                  <Button disabled={!canBid || bid <= a.highBid || bid > max}>
                    Surenchérir
                  </Button>
                </form>
                <Button
                  secondary
                  disabled={busy || leader || passed || player.team.length >= 5}
                  onClick={() => void act({ type: "pass" })}
                >
                  {leader
                    ? "Vous tenez la meilleure offre"
                    : passed
                      ? "Vous avez passé"
                      : "Je passe pour cette carte"}
                </Button>
                <small>
                  Passer est définitif pour cette carte. Dix crédits restent
                  réservés pour chaque futur personnage.
                </small>
              </div>
            </div>
            {a.lastSale && (
              <div className="party-sale">
                <Check size={18} /> Dernière vente : {a.lastSale.name} pour{" "}
                {a.lastSale.buyer}, à {a.lastSale.price} crédits.
              </div>
            )}
          </>
        ) : (
          <p className="party-muted">
            {room.phase === "vote"
              ? `${a.voted.length}/${room.players.length} votes. Défendez vos équipes à l’oral, puis votez ${room.players.length === 2 ? "pour l’équipe qui mérite de gagner" : "pour une autre équipe"}. Les choix restent secrets jusqu’au résultat.`
              : `${room.players
                  .filter((p) => a.winners?.includes(p.id))
                  .map((p) => p.name)
                  .join(
                    " et ",
                  )} remporte${a.winners?.length === 1 ? "" : "nt"} le vote${(a.winners?.length ?? 0) > 1 ? " — égalité partagée" : ""}.`}
          </p>
        )}
      </section>
      <Teams room={room} me={me} act={act} busy={busy} />
    </>
  );
}
function BluffRound({
  room,
  me,
  act,
  busy,
}: {
  room: PartyView;
  me: string;
  act: Act;
  busy: boolean;
}) {
  const bluff = room.bluff!;
  const [visible, setVisible] = useState(false);
  const holder = bluff.holderId === me,
    receiver = bluff.receiverId === me;
  const revealed = room.phase === "bluff-result" || room.phase === "finished";
  const pendingQuestion = bluff.questions.some((q) => q.answer === undefined);
  const holderName = room.players.find((p) => p.id === bluff.holderId)?.name;
  const receiverName = room.players.find(
    (p) => p.id === bluff.receiverId,
  )?.name;
  return (
    <section className="party-play-panel">
      <span className="party-eyebrow">
        {revealed
          ? "CARTE SUR TABLE"
          : holder
            ? "VOUS AVEZ LA CARTE"
            : receiver
              ? "À VOUS DE DÉCIDER"
              : "OBSERVEZ LE DUEL"}
      </span>
      <h2>
        {revealed
          ? `${room.players.find((p) => p.id === bluff.recipientId)?.name} gagne ${bluff.card?.value} points.`
          : `${holderName} face à ${receiverName}`}
      </h2>
      <p className="party-muted">
        {revealed
          ? `${receiverName} a ${bluff.choice === "take" ? "pris la carte" : `laissé la carte à ${holderName}`}.`
          : "La carte reste secrète. Les deux réponses sont obligatoirement vraies."}
      </p>
      <div className="bluff-table">
        <div className="bluff-card-area">
          <Character
            card={bluff.card}
            hidden={!revealed && (!holder || !visible)}
          />
          {holder && !revealed && (
            <Button secondary onClick={() => setVisible(!visible)}>
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              {visible ? "Masquer ma carte" : "Voir ma carte secrète"}
            </Button>
          )}
        </div>
        <div className="bluff-questions">
          <h3>
            Les deux questions <span>{bluff.questions.length}/2</span>
          </h3>
          {bluff.questions.length === 0 && (
            <p className="party-muted">
              {receiver
                ? "Choisissez une question ci-dessous."
                : `${receiverName} choisit sa première question.`}
            </p>
          )}
          {bluff.questions.map((q, i) => (
            <div className="bluff-answer" key={q.key}>
              <span>QUESTION {i + 1}</span>
              <p>{bluffQuestions[q.key]}</p>
              <b>
                {q.answer === undefined
                  ? "En attente de la réponse…"
                  : q.answer
                    ? "Oui"
                    : "Non"}
              </b>
            </div>
          ))}
          {room.phase === "questions" && receiver && !pendingQuestion && (
            <div className="bluff-question-options">
              {(Object.entries(bluffQuestions) as [BluffQuestion, string][])
                .filter(([key]) => !bluff.questions.some((q) => q.key === key))
                .map(([key, text]) => (
                  <Button
                    key={key}
                    secondary
                    disabled={busy}
                    onClick={() => void act({ type: "ask", question: key })}
                  >
                    {text}
                  </Button>
                ))}
            </div>
          )}
          {room.phase === "questions" && holder && pendingQuestion && (
            <>
              <Button
                disabled={busy}
                onClick={() => void act({ type: "answer" })}
              >
                Révéler ma réponse vraie
              </Button>
              <small>
                La réponse est calculée à partir de votre carte, sans
                possibilité de la modifier.
              </small>
            </>
          )}
          {room.phase === "decision" && receiver && (
            <div className="bluff-choice">
              <p>Vous avez vos deux réponses. À vous de jouer.</p>
              <Button
                disabled={busy}
                onClick={() => void act({ type: "choose", choice: "take" })}
              >
                Je prends la carte
              </Button>
              <Button
                secondary
                disabled={busy}
                onClick={() => void act({ type: "choose", choice: "leave" })}
              >
                Je la laisse à {holderName}
              </Button>
            </div>
          )}
          {room.phase === "decision" && !receiver && (
            <p>{receiverName} réfléchit : prendre ou laisser ?</p>
          )}
        </div>
      </div>
    </section>
  );
}
export function PartyHub() {
  const [socket] = useState(() =>
    io("/party", { autoConnect: false, forceNew: true }),
  );
  const [session, setSession] = useState<PartySession | null>(readSession);
  const sessionRef = useRef(session);
  const [room, setRoom] = useState<PartyView | null>(null);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [restoring, setRestoring] = useState(!!session);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<PartyGame>("wavelength");
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("spyfall-nickname") ?? "";
    } catch {
      return "";
    }
  });
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get("party") ?? "",
  );
  const [joinMode, setJoinMode] = useState(
    new URLSearchParams(location.search).has("party"),
  );
  const clearSession = () => {
    sessionRef.current = null;
    setSession(null);
    remember(null);
    setRoom(null);
    setRestoring(false);
  };
  useEffect(() => {
    const onConnect = () => {
      setOnline(true);
      if (!sessionRef.current) {
        setRestoring(false);
        return;
      }
      setRestoring(true);
      socket
        .timeout(8000)
        .emit(
          "party:resume",
          sessionRef.current,
          (err: Error | null, ack: PartyAck) => {
            setRestoring(false);
            if (err) {
              setError(
                "La reprise du salon a expiré. Rechargez la page pour réessayer.",
              );
              return;
            }
            if (!ack.ok) {
              clearSession();
              setError(ack.error);
            }
          },
        );
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", () => setOnline(false));
    socket.on("connect_error", () => {
      setOnline(false);
      setError(
        "Le serveur de jeu est indisponible. Nouvelle tentative en cours…",
      );
    });
    socket.on("party:state", (value: PartyView) => {
      setRoom(value);
      setRestoring(false);
      setError("");
    });
    socket.on("party:expired", () => {
      clearSession();
      setError("Ce salon a expiré. Vous pouvez en créer un nouveau.");
    });
    socket.on("party:replaced", () => {
      clearSession();
      setError("Votre session est maintenant ouverte dans un autre onglet.");
      socket.io.reconnection(false);
    });
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const send = async (
    event: string,
    payload: unknown = {},
  ): Promise<boolean> => {
    if (inFlight.current) return false;
    setError("");
    if (!socket.connected) {
      setError("Connexion perdue. Attendez la reconnexion.");
      return false;
    }
    setPending(true);
    inFlight.current = true;
    return new Promise((resolve) =>
      socket
        .timeout(8000)
        .emit(event, payload, (err: Error | null, ack: PartyAck) => {
          setPending(false);
          inFlight.current = false;
          if (err || !ack) {
            setError(
              "Le serveur n’a pas répondu. Vérifiez la connexion avant de réessayer.",
            );
            resolve(false);
            return;
          }
          if (!ack.ok) {
            setError(ack.error);
            resolve(false);
            return;
          }
          if (ack.session) {
            sessionRef.current = ack.session;
            setSession(ack.session);
            remember(ack.session);
          }
          resolve(true);
        }),
    );
  };
  const act: Act = (action) => send("party:action", action);
  const enter = async (e: FormEvent) => {
    e.preventDefault();
    if (joinMode && code.trim() && /^[A-Z0-9]{8}$/i.test(code.trim())) {
      location.href = `/?game=spyfall&salon=${encodeURIComponent(code.trim().toUpperCase())}`;
      return;
    }
    if (
      await send(
        joinMode ? "party:join" : "party:create",
        joinMode
          ? { name, code: code.trim().toUpperCase() }
          : { name, game: selected },
      )
    ) {
      try {
        localStorage.setItem("spyfall-nickname", name);
      } catch {
        /* Optional preference. */
      }
    }
  };
  const selectGame = (id: PartyGame) => {
    setSelected(id);
    setJoinMode(false);
    document
      .getElementById("party-config")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const leave = async () => {
    if (
      window.confirm(
        room?.phase === "lobby"
          ? "Quitter ce salon ?"
          : "Quitter remet la partie en cours à zéro pour tous. Continuer ?",
      ) &&
      (await send("party:leave"))
    ) {
      clearSession();
      history.replaceState(null, "", "/");
    }
  };
  const copyInvite = async () => {
    const link = `${location.origin}/?party=${room!.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Lien d’invitation copié.");
    } catch {
      setNotice(`Invitation : ${link}`);
    }
  };
  const me = room?.players.find((p) => p.id === session?.playerId);
  const host = room?.hostId === me?.id;
  const busy = pending || !online || restoring;
  const paused = !!room?.players.some((p) => !p.connected);
  const gameInfo = games.find((g) => g.id === (room?.game ?? selected))!;
  const completed =
    room?.phase === "finished" || room?.phase === "auction-result";
  const ranked = [...(room?.players ?? [])].sort((a, b) => b.score - a.score);
  return (
    <div className="party-app">
      <header className="party-header">
        <a
          className="party-brand"
          href="/"
          onClick={
            room
              ? (e) => {
                  e.preventDefault();
                  if (!pending) void leave();
                }
              : undefined
          }
        >
          <span className="party-logo">
            PX<span>✳</span>
          </span>
          <span>
            PROJECT X<small>LE CLUB DE JEU</small>
          </span>
        </a>
        <div className="party-header-right">
          <span className={`party-connection ${online ? "is-online" : ""}`}>
            {online ? "Prêt à jouer" : "Connexion…"}
          </span>
          {room ? (
            <button
              className="party-text-button"
              disabled={pending}
              onClick={() => void leave()}
            >
              <LogOut size={17} />
              Quitter la table
            </button>
          ) : (
            <a className="party-nav-link" href="#party-games">
              Les jeux
            </a>
          )}
        </div>
      </header>
      {error && (
        <div className="party-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="party-notice" role="status">
          {notice}
        </div>
      )}
      {restoring && !room ? (
        <main className="party-loading">
          <Radio size={40} />
          <h1>On retrouve votre table…</h1>
          <p>Reconnexion à votre salon en cours.</p>
          <Button
            secondary
            onClick={() => {
              clearSession();
              socket.disconnect().connect();
            }}
          >
            Revenir au hub
          </Button>
        </main>
      ) : !room ? (
        <main>
          <section className="party-hero">
            <div className="party-hero-copy">
              <span className="party-eyebrow">
                <span className="party-mini-star">✳</span> VOTRE PROCHAINE
                SOIRÉE COMMENCE ICI
              </span>
              <h1>
                Les mêmes potes.
                <br />
                <em>D’autres façons</em>
                <br />
                de jouer.
              </h1>
              <p>
                Un seul endroit pour se démasquer, se comprendre, miser gros et
                faire douter les autres. Choisissez votre jeu. Rassemblez votre
                bande.
              </p>
              <div className="party-hero-actions">
                <a className="party-button" href="#party-games">
                  <Gamepad2 size={19} />
                  Choisir un jeu
                </a>
                <button
                  className="party-text-button"
                  onClick={() => {
                    setJoinMode(true);
                    document
                      .getElementById("party-config")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  J’ai un code de salon
                </button>
              </div>
              <div className="party-hero-facts">
                <span>
                  <Users size={16} /> Entre amis, à distance
                </span>
                <span>
                  <Zap size={16} /> Gratuit, sans compte
                </span>
              </div>
            </div>
            <div className="party-hero-visual" aria-hidden="true">
              <span className="hero-orbit orbit-one" />
              <span className="hero-orbit orbit-two" />
              <div className="hero-ticket ticket-back">
                <Shield size={40} />
                <span>
                  FAIS LE
                  <br />
                  BON CHOIX.
                </span>
              </div>
              <div className="hero-ticket ticket-front">
                <span className="ticket-label">SOIRÉE PROJECT X</span>
                <div className="ticket-face">✳</div>
                <strong>
                  On joue
                  <br />à quoi ?
                </strong>
                <span className="ticket-bottom">
                  LES RÈGLES CHANGENT.
                  <br />
                  LA BANDE RESTE.
                </span>
              </div>
              <span className="hero-sticker">
                <Users size={20} /> TOUJOURS
                <br />
                MIEUX ENSEMBLE
              </span>
            </div>
          </section>
          <section id="party-games" className="party-games-section">
            <div className="party-section-heading">
              <div>
                <span className="party-eyebrow">
                  QUATRE JEUX, UNE SEULE BANDE
                </span>
                <h2>À chaque humeur, sa partie.</h2>
              </div>
              <span className="party-muted">Les débats commencent ici.</span>
            </div>
            <div className="party-game-grid">
              {games.map((g) => {
                const Icon = g.icon;
                return (
                  <article
                    className={`party-game game-${g.id} ${selected === g.id ? "is-selected" : ""}`}
                    key={g.id}
                  >
                    <Illustration game={g.id} />
                    <div className="party-game-content">
                      <div className="party-game-label">
                        <span>
                          <Icon size={15} />
                          {g.tag}
                        </span>
                        <span>{g.players}</span>
                      </div>
                      <h3>{g.name}</h3>
                      <p className="party-game-pitch">{g.pitch}</p>
                      <p className="party-game-detail">{g.detail}</p>
                      <div className="party-game-bottom">
                        <span>{g.time}</span>
                        {g.id === "spyfall" ? (
                          <a
                            className="party-button party-secondary"
                            href="/?game=spyfall"
                          >
                            Jouer à Spyfall
                          </a>
                        ) : (
                          <Button secondary onClick={() => selectGame(g.id)}>
                            {selected === g.id && !joinMode ? (
                              <Check size={17} />
                            ) : (
                              <Play size={15} />
                            )}
                            Choisir ce jeu
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          <section id="party-config" className="party-config">
            <div className="party-config-intro">
              <span className="party-eyebrow">UNE TABLE, VOTRE BANDE</span>
              <h2>
                {joinMode
                  ? "On vous attend déjà ?"
                  : `On lance ${names[selected]} ?`}
              </h2>
              {joinMode ? (
                <p>
                  Entrez le code reçu. Vous rejoindrez le jeu choisi par l’hôte.
                  Les codes Spyfall fonctionnent aussi.
                </p>
              ) : (
                <RuleList game={selected} />
              )}
            </div>
            <form onSubmit={(e) => void enter(e)} className="party-setup-form">
              <div className="party-tabs">
                <button
                  type="button"
                  aria-pressed={!joinMode}
                  onClick={() => setJoinMode(false)}
                >
                  Créer une table
                </button>
                <button
                  type="button"
                  aria-pressed={joinMode}
                  onClick={() => setJoinMode(true)}
                >
                  Rejoindre
                </button>
              </div>
              <label htmlFor="party-name">Votre pseudo</label>
              <input
                id="party-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={24}
                placeholder="Comment on vous appelle ?"
                required
                disabled={busy}
              />
              {joinMode ? (
                <>
                  <label htmlFor="party-code">Code du salon</label>
                  <input
                    id="party-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    minLength={4}
                    maxLength={8}
                    placeholder="Ex. H12ABC"
                    required
                    disabled={busy}
                  />
                </>
              ) : (
                <>
                  <label htmlFor="party-game-choice">Le jeu de la soirée</label>
                  <select
                    id="party-game-choice"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value as PartyGame)}
                    disabled={busy}
                  >
                    {partyGames.map((id) => (
                      <option value={id} key={id}>
                        {names[id]}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Button disabled={busy}>
                {pending
                  ? "Un instant…"
                  : joinMode
                    ? "Rejoindre la table"
                    : "Créer ma table"}
              </Button>
              <small>
                Invitez ensuite vos amis avec le code ou le lien du salon.
              </small>
            </form>
          </section>
          <section className="party-how">
            <span>
              <b>Choisissez votre jeu</b>
              <small>Une humeur, une envie, un duel.</small>
            </span>
            <span>
              <b>Invitez la bande</b>
              <small>Un lien ou un code, et c’est parti.</small>
            </span>
            <span>
              <b>Faites chauffer le vocal</b>
              <small>Le meilleur de la partie, c’est vous.</small>
            </span>
          </section>
        </main>
      ) : me ? (
        <main className={`party-room game-${room.game}`}>
          <div className="party-room-heading">
            <div>
              <span className="party-eyebrow">
                VOTRE TABLE ·{" "}
                {room.phase === "lobby"
                  ? "ON RASSEMBLE LA BANDE"
                  : completed
                    ? "PARTIE TERMINÉE"
                    : `MANCHE ${room.round} / ${room.totalRounds}`}
              </span>
              <h1>{names[room.game]}</h1>
            </div>
            <button
              className="party-room-code"
              onClick={() => void copyInvite()}
              title="Copier le lien d’invitation"
            >
              <small>CODE DU SALON</small>
              <strong>
                {room.code}
                <Copy size={18} />
              </strong>
            </button>
          </div>
          {room.message && (
            <p className="party-notice-inline" role="status">
              {room.message}
            </p>
          )}
          {paused && (
            <div className="party-alert" role="status">
              En attente de reconnexion. L’hôte peut retirer un joueur absent ;
              une partie en cours sera remise à zéro.
            </div>
          )}
          <div className="party-room-layout">
            <div className="party-room-main">
              {room.phase === "lobby" ? (
                <section className="party-play-panel party-lobby">
                  <gameInfo.icon size={38} />
                  <h2>Installez-vous, on va commencer.</h2>
                  <p className="party-muted">
                    Partagez le code {room.code}. Il faut de 2 à 8 joueurs
                    connectés.
                  </p>
                  <RuleList game={room.game} />
                  <div className="party-lobby-settings">
                    <label htmlFor="room-game">Jeu de la table</label>
                    <select
                      id="room-game"
                      value={room.game}
                      disabled={!host || busy}
                      onChange={(e) =>
                        void act({
                          type: "game",
                          game: e.target.value as PartyGame,
                        })
                      }
                    >
                      {partyGames.map((id) => (
                        <option key={id} value={id}>
                          {names[id]}
                        </option>
                      ))}
                    </select>
                    {room.game === "auction" && (
                      <>
                        <label htmlFor="room-criterion">Le débat final</label>
                        <select
                          id="room-criterion"
                          value={room.criterion}
                          disabled={!host || busy}
                          onChange={(e) =>
                            void act({
                              type: "criterion",
                              criterion: e.target.value as BattleCriterion,
                            })
                          }
                        >
                          {Object.entries(battleCriteria).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  {host ? (
                    <Button
                      disabled={busy || paused || room.players.length < 2}
                      onClick={() => void act({ type: "start" })}
                    >
                      <Play size={18} />
                      Lancer la partie
                    </Button>
                  ) : (
                    <p>L’hôte lancera la partie quand tout le monde sera là.</p>
                  )}
                  {room.players.length < 2 && (
                    <small>Encore une personne et vous pouvez jouer.</small>
                  )}
                  <Button secondary onClick={() => void copyInvite()}>
                    <Copy size={16} />
                    Inviter les amis
                  </Button>
                </section>
              ) : (
                <>
                  {completed && (
                    <section className="party-final">
                      <Trophy size={34} />
                      <span className="party-eyebrow">
                        {ranked.filter((p) => p.score === ranked[0].score)
                          .length > 1
                          ? "VICTOIRE PARTAGÉE"
                          : "BIEN JOUÉ"}
                      </span>
                      <h2>
                        {ranked
                          .filter((p) => p.score === ranked[0].score)
                          .map((p) => p.name)
                          .join(" & ")}
                      </h2>
                      <p>
                        {ranked[0].score}{" "}
                        {room.game === "auction" ? "vote(s)" : "points"} · La
                        revanche vous attend au salon.
                      </p>
                    </section>
                  )}
                  {room.game === "wavelength" && room.wave && (
                    <WaveRound
                      key={room.round}
                      room={room}
                      me={me.id}
                      act={act}
                      busy={busy || paused}
                    />
                  )}
                  {room.game === "auction" && room.auction && (
                    <AuctionRound
                      room={room}
                      me={me.id}
                      act={act}
                      busy={busy || paused}
                    />
                  )}
                  {room.game === "bluff" && room.bluff && (
                    <BluffRound
                      key={room.round}
                      room={room}
                      me={me.id}
                      act={act}
                      busy={busy || paused}
                    />
                  )}
                  {(room.phase === "wave-result" ||
                    room.phase === "bluff-result") &&
                    (host ? (
                      <Button
                        disabled={busy || paused}
                        onClick={() => void act({ type: "next" })}
                      >
                        {room.round >= room.totalRounds
                          ? "Voir le classement final"
                          : "Manche suivante"}
                      </Button>
                    ) : (
                      <p className="party-muted">
                        L’hôte passe à la suite quand vous êtes prêts.
                      </p>
                    ))}
                  {host && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() => {
                        if (
                          completed ||
                          window.confirm(
                            "Revenir au salon et remettre les scores à zéro ?",
                          )
                        )
                          void act({ type: "reset" });
                      }}
                    >
                      <RotateCcw size={17} />
                      {completed
                        ? "Rejouer ou changer de jeu"
                        : "Revenir au salon"}
                    </Button>
                  )}
                </>
              )}
            </div>
            <aside className="party-player-panel">
              <div className="party-player-panel-title">
                <h2>La bande</h2>
                <span>{room.players.length}/8</span>
              </div>
              {ranked.map((p) => (
                <div className="party-player" key={p.id}>
                  <span className="party-avatar">
                    {p.name[0].toUpperCase()}
                  </span>
                  <div>
                    <strong>
                      {p.name}
                      {p.id === me.id ? " (vous)" : ""}
                      {p.id === room.hostId && (
                        <Crown size={14} aria-label="Hôte" />
                      )}
                    </strong>
                    <small>
                      {!p.connected
                        ? "Déconnecté"
                        : p.id === room.hostId
                          ? "Hôte de la table"
                          : "À la table"}
                    </small>
                  </div>
                  <span className="party-player-score">
                    {room.game === "auction"
                      ? `${p.team.length}/5`
                      : `${p.score} pts`}
                  </span>
                  {host && !p.connected && (
                    <button
                      className="party-text-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Retirer ${p.name} ? La partie en cours sera remise à zéro.`,
                          )
                        )
                          void act({ type: "remove", playerId: p.id });
                      }}
                    >
                      Retirer
                    </button>
                  )}
                </div>
              ))}
              <div className="party-table-tip">
                <MessageBubble />{" "}
                <p>
                  Gardez votre vocal ouvert. Les meilleurs indices et les pires
                  arguments se partagent à voix haute.
                </p>
              </div>
              <details>
                <summary>Relire les règles</summary>
                <RuleList game={room.game} />
              </details>
            </aside>
          </div>
        </main>
      ) : (
        <main className="party-loading">
          <h1>Reconnexion au salon…</h1>
        </main>
      )}
      <footer className="party-footer">
        <span>
          PROJECT X <span className="party-mini-star">✳</span> Les règles
          changent. La bande reste.
        </span>
        <span>Fait pour jouer ensemble.</span>
      </footer>
    </div>
  );
}
function MessageBubble() {
  return <Users size={20} aria-hidden="true" />;
}
export function SpyfallFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="spyfall-hub-return">
        <a href="/">
          <ArrowLeft size={16} />
          Tous les jeux · Project X
        </a>
        <span>Vous jouez à Spyfall</span>
      </div>
      {children}
    </>
  );
}
