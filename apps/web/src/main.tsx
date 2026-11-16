import React, {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Copy,
  Users,
  Clock,
  Shield,
  Eye,
  EyeOff,
  Send,
  LogOut,
  Crown,
  X,
  Volume2,
  Link as LinkIcon,
  Play,
  RotateCcw,
  Settings2,
  MessageCircle,
  BookOpen,
  Sparkles,
  UserRound,
  LoaderCircle,
  CheckCircle2,
  Target,
  Radio,
} from "lucide-react";
import {
  categories,
  spiesFor,
  type RoomView,
  type Session,
  type Card,
  type Settings,
  type Ack,
  type Command,
} from "@spyfall/shared";
import "./styles.css";
import {
  AdvancedSettings,
  Preferences,
  SpectatorControls,
  SeriesPanel,
  LibraryPanel,
  StreamOverlay,
} from "./v2";
const socket = io({ autoConnect: false, withCredentials: true });
const icons = [Sparkles, Play, Target, Radio, Volume2, BookOpen];
function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
}
function Button({
  children,
  onClick,
  disabled = false,
  kind = "primary",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`btn ${kind} ${className}`}
    >
      {children}
    </button>
  );
}
function App() {
  const [session, setSession] = useState<Session | null>(() =>
    read("spyfall-session"),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [shown, setShown] = useState(false);
  const [online, setOnline] = useState(false);
  const [restoring, setRestoring] = useState(!!session);
  const [nickname, setNickname] = useState(
    () => read<string>("spyfall-nickname") ?? "",
  );
  const [code, setCode] = useState(
    () =>
      new URLSearchParams(location.search).get("salon")?.toUpperCase() ?? "",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [modal, setModal] = useState<"rules" | "account" | "library" | null>(
    null,
  );
  const [account, setAccount] = useState<{
    username: string;
    email: string;
  } | null>(null);
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [accountMode, setAccountMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<{
    rounds: number;
    points: number;
    wins?: number;
    spyRounds?: number;
    history?: {
      points: number;
      role: string;
      winner: string;
      reason: string;
      finishedAt: string;
    }[];
  } | null>(null);
  const [spectator, setSpectator] = useState(false);
  const shownRevision = useRef("");
  const [chat, setChat] = useState("");
  const [guess, setGuess] = useState("");
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [voteTarget, setVoteTarget] = useState("");
  const [voted, setVoted] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const clear = (removeStored = true) => {
    setSession(null);
    sessionRef.current = null;
    if (removeStored) write("spyfall-session", null);
    setRoom(null);
    setCard(null);
    setShown(false);
    setRestoring(false);
  };
  useEffect(() => {
    const connect = () => {
      setOnline(true);
      setError("");
      const current = sessionRef.current;
      if (current) {
        setRestoring(true);
        socket
          .timeout(8000)
          .emit(
            "room:resume",
            { token: current.token, code: current.code },
            (err: Error | null, ack: Ack) => {
              setRestoring(false);
              if (err) {
                setError("La reconnexion a expiré. Réessayez.");
                return;
              }
              if (!ack.ok) {
                clear();
                setError(ack.error);
              }
            },
          );
      }
    };
    const state = (value: RoomView) => {
      offset.current = value.serverNow - Date.now();
      setRoom(value);
      setRestoring(false);
    };
    const privateCard = (value: Card) => {
      const revision = `${value.roundIndex}:${value.revision}`;
      if (shownRevision.current !== revision) setShown(false);
      shownRevision.current = revision;
      setCard(value);
    };
    const kicked = () => {
      clear();
      setError("L’hôte vous a retiré du salon.");
    };
    const replaced = () => {
      clear(false);
      setError("Cette session est ouverte dans un autre onglet.");
    };
    socket.on("connect", connect);
    socket.on("disconnect", () => setOnline(false));
    socket.on("connect_error", () => {
      setOnline(false);
      setError("Connexion au serveur impossible. Nouvelle tentative en cours…");
    });
    socket.on("room:state", state);
    socket.on("game:private-card", privateCard);
    socket.on("room:kicked", kicked);
    socket.on("session:replaced", replaced);
    void fetch("/api/library")
      .catch(() => {})
      .finally(() => socket.connect());
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setAccount(data.user);
        setAccountsEnabled(data.accountsEnabled);
      })
      .catch(() => {});
    const interval = setInterval(() => setClock(Date.now()), 250);
    return () => {
      clearInterval(interval);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
  const settingsKey = JSON.stringify(room?.settings);
  useEffect(() => {
    if (room?.phase === "lobby") {
      setCard(null);
      setShown(false);
    }
    setSettings(room?.settings ?? null);
  }, [settingsKey, room?.phase]);
  useEffect(() => {
    setVoteTarget("");
    setVoted(
      room
        ? !!read(
            `vote:${room.code}:${sessionRef.current?.playerId}:${room.roundIndex}:${room.ballotIndex}`,
          )
        : false,
    );
  }, [room?.ballotIndex, room?.roundIndex, room?.code]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [room?.messages.length]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
      if (event.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button:not([disabled]),.modal input:not([disabled]),.modal a[href]",
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal]);
  const send = async (
    name: Command,
    payload: unknown = {},
  ): Promise<boolean> => {
    setError("");
    if (!socket.connected) {
      setError("Connexion perdue. Attendez la reconnexion.");
      return false;
    }
    setPending(true);
    return new Promise((resolve) => {
      socket
        .timeout(8000)
        .emit(name, payload, (err: Error | null, ack: Ack) => {
          setPending(false);
          if (err) {
            setError(
              "Le serveur n’a pas répondu. La connexion sera rétablie automatiquement.",
            );
            resolve(false);
            return;
          }
          if (!ack.ok) {
            setError(ack.error);
            resolve(false);
            return;
          }
          if (ack.streamToken) {
            void navigator.clipboard
              .writeText(`${location.origin}/#overlay=${ack.streamToken}`)
              .then(() =>
                setNotice(
                  "Lien OBS copié. Il permet uniquement une vue en lecture.",
                ),
              )
              .catch(() =>
                setNotice(
                  `Lien OBS : ${location.origin}/#overlay=${ack.streamToken}`,
                ),
              );
          }
          if (ack.session) {
            write("spyfall-session", ack.session);
            setSession(ack.session);
            write("spyfall-nickname", nickname);
          }
          resolve(true);
        });
    });
  };
  const create = () => void send("room:create", { nickname: nickname.trim() });
  const join = (event: FormEvent) => {
    event.preventDefault();
    void send("room:join", {
      nickname: nickname.trim(),
      code: code.trim().toUpperCase(),
      spectator,
    });
  };
  const me = room?.players.find((p) => p.id === session?.playerId);
  const host = !!me && room?.hostPlayerId === me.id;
  const activePlayers = room?.players.filter((p) => !p.spectator) ?? [];
  const settingsChanged =
    !!settings &&
    !!room &&
    JSON.stringify(settings) !== JSON.stringify(room.settings);
  const saveSettings = async () => {
    if (settings && (await send("room:settings:update", settings))) {
      setNotice("Règles enregistrées. Chaque joueur doit se déclarer prêt.");
    }
  };
  const chatAllowed =
    !!room &&
    ["lobby", "discussion", "results"].includes(room.phase) &&
    !(me?.spectator && room.phase === "discussion");
  const seconds = room?.deadlineAt
    ? Math.max(0, Math.ceil((room.deadlineAt - clock - offset.current) / 1000))
    : 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?salon=${room!.code}`,
      );
      setNotice("Lien d’invitation copié.");
    } catch {
      setNotice(`Code du salon : ${room!.code}`);
    }
  };
  const accountSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${accountMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, username: nickname }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAccount(data.user);
      setNickname(data.user.username);
      setPassword("");
      setModal(null);
      setNotice("Vous êtes connecté.");
      socket.disconnect().connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setPending(false);
    }
  };
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccount(null);
    socket.disconnect().connect();
    setStats(null);
    setModal(null);
  };
  const phaseLabel = {
    lobby: "Salle d’attente",
    reveal: "Découvrez votre rôle",
    discussion: "Place aux questions",
    voting: "L’heure du vote",
    spy_guess: "Dernière chance",
    results: "Les masques tombent",
  };
  return (
    <div className="app">
      <header className="header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (room) e.preventDefault();
          }}
          aria-label="Spyfall Universe, accueil"
        >
          <span className="brand-mark">
            <Eye size={24} />
          </span>
          <span>
            SPYFALL<span className="brand-sub">UNIVERSE</span>
          </span>
        </a>
        <nav>
          <button
            className="nav-link library-link"
            onClick={() => setModal("library")}
          >
            Bibliothèque
          </button>
          <button
            className="nav-link rule-link"
            onClick={() => setModal("rules")}
          >
            Comment jouer <ArrowUpRight size={14} />
          </button>
          <span className={`connection ${online ? "connected" : ""}`}>
            <i />
            {online ? "Serveur en ligne" : "Connexion…"}
          </span>
          <button
            className="account-button"
            onClick={() => {
              setModal("account");
              if (account)
                void fetch("/api/stats")
                  .then((r) => r.json())
                  .then(setStats);
            }}
          >
            <UserRound size={17} />
            <span>{account?.username ?? "Mon compte"}</span>
          </button>
        </nav>
      </header>
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button aria-label="Fermer l’erreur" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast success" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {restoring && !room ? (
        <main className="restoring">
          <LoaderCircle className="spin" />
          <h1>Retour dans votre salon…</h1>
          <Button
            kind="secondary"
            onClick={() => {
              clear();
              socket.disconnect().connect();
            }}
          >
            Revenir à l’accueil
          </Button>
        </main>
      ) : !room ? (
        <main className="home">
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="live-dot" /> LE JEU OÙ LE DOUTE RASSEMBLE
              </div>
              <h1>
                Un mot.
                <br />
                Vos amis.
                <br />
                <span>Un imposteur.</span>
              </h1>
              <p>
                Tout le monde connaît le mot secret.
                <br />
                Sauf l’espion. Posez les bonnes questions,
                <br className="desktop-break" /> bluffez et démasquez-le.
              </p>
              <div className="hero-meta">
                <span>
                  <Users size={16} />3 à 12 joueurs
                </span>
                <span>
                  <Clock size={16} />3 à 10 min
                </span>
                <span>
                  <Shield size={16} />
                  Gratuit, sans compte
                </span>
              </div>
              <div className="hero-foot">
                <div className="mini-avatars">
                  <b>A</b>
                  <b>M</b>
                  <b>L</b>
                  <b>?</b>
                </div>
                <span>
                  Une soirée entre amis.
                  <br />
                  <strong>Une confiance toute relative.</strong>
                </span>
              </div>
            </div>
            <div className="play-panel">
              <div className="panel-top">
                <span className="small-label">VOTRE PROCHAINE MISSION</span>
                <span className="mission-number">01 /</span>
              </div>
              <h2>
                Entrez dans le jeu<span>.</span>
              </h2>
              <p>Vos talents de bluff suffisent. Aucun compte requis.</p>
              <label className="field-label" htmlFor="nickname">
                Votre pseudo
              </label>
              <div className="input-icon">
                <UserRound size={18} />
                <input
                  id="nickname"
                  maxLength={24}
                  placeholder="Comment vous appelle-t-on ?"
                  autoComplete="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
              <Button
                className="create-button"
                onClick={create}
                disabled={pending || !online || nickname.trim().length < 2}
              >
                Créer un salon privé <ArrowUpRight size={19} />
              </Button>
              <div className="divider">
                <span>ou rejoindre vos amis</span>
              </div>
              <form onSubmit={join}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={spectator}
                    onChange={(e) => setSpectator(e.target.checked)}
                  />
                  Rejoindre comme spectateur
                </label>
                <label className="field-label" htmlFor="code">
                  Code du salon
                </label>
                <div className="join-row">
                  <input
                    id="code"
                    className="code-input"
                    placeholder="EX. ABCD2345"
                    maxLength={8}
                    autoCapitalize="characters"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                  <Button
                    type="submit"
                    kind="secondary"
                    disabled={
                      pending ||
                      !online ||
                      code.length !== 8 ||
                      nickname.trim().length < 2
                    }
                  >
                    Rejoindre <ArrowRight size={17} />
                  </Button>
                </div>
              </form>
              <div className="panel-note">
                <Shield size={14} />
                Salons privés. Secrets bien gardés.
              </div>
            </div>
          </section>
          <section className="universes">
            <div className="section-heading">
              <div>
                <span className="small-label">
                  MÊMES AMIS, NOUVEAUX SOUPÇONS
                </span>
                <h2>À chaque univers, ses secrets.</h2>
              </div>
              <span className="subtle">
                6 catégories à explorer <ArrowUpRight size={15} />
              </span>
            </div>
            <div className="category-grid">
              {categories.map((category, i) => {
                const Icon = icons[i];
                return (
                  <div className={`category category-${i}`} key={category}>
                    <span className="category-number">0{i + 1}</span>
                    <Icon size={26} />
                    <strong>{category}</strong>
                    <span>
                      50 mots <ArrowUpRight size={14} />
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="how">
            <div>
              <span className="small-label">LA RÈGLE EST SIMPLE</span>
              <h2>Parlez. Doutez. Votez.</h2>
              <button className="text-button" onClick={() => setModal("rules")}>
                Toutes les règles <ArrowRight size={15} />
              </button>
            </div>
            {[
              [
                "01",
                "Recevez votre rôle",
                "Un mot pour les innocents. Une catégorie pour l’espion.",
              ],
              [
                "02",
                "Semez le doute",
                "Posez des questions sans révéler le mot. L’espion improvise.",
              ],
              [
                "03",
                "Faites votre choix",
                "Accusez l’espion. Mais attention : il peut encore deviner le mot.",
              ],
            ].map(([n, t, p]) => (
              <article key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{p}</p>
              </article>
            ))}
          </section>
        </main>
      ) : (
        <main className="room-page">
          <div className="room-topline">
            <div>
              <span className="eyebrow">
                SALON PRIVÉ <span className="purple">/</span> MANCHE{" "}
                {room.roundIndex || "—"}
              </span>
              <h1>
                {phaseLabel[room.phase]}
                <span className="purple">.</span>
              </h1>
            </div>
            <div className="room-code">
              <div>
                <span className="small-label">CODE DU SALON</span>
                <strong>{room.code}</strong>
              </div>
              <button
                aria-label="Copier le lien d’invitation"
                className="icon-button"
                onClick={() => void copy()}
              >
                <Copy size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Quitter le salon"
                onClick={() => {
                  if (
                    room.phase !== "lobby" &&
                    room.phase !== "results" &&
                    !window.confirm(
                      "Quitter la manche en cours ? Votre départ peut mettre fin à la manche.",
                    )
                  )
                    return;
                  void send("room:leave").then((ok) => {
                    if (ok) clear();
                  });
                }}
              >
                <LogOut size={19} />
              </button>
            </div>
          </div>
          {!online && (
            <div className="offline-banner" role="status">
              Connexion interrompue. Votre place est conservée pendant 60
              secondes.
            </div>
          )}
          <SeriesPanel room={room} host={host} send={send} pending={pending} />
          <div className="room-layout">
            <aside className="players-panel panel">
              <div className="panel-title">
                <h2>
                  <Users size={17} /> Les joueurs
                </h2>
                <span>{activePlayers.length}/12</span>
              </div>
              <div className="player-list">
                {activePlayers.map((player, i) => (
                  <div
                    className={`player ${player.eliminated ? "eliminated" : ""}`}
                    key={player.id}
                  >
                    <span className={`avatar avatar-${i % 4}`}>
                      {player.nickname.slice(0, 2).toUpperCase()}
                      <i className={player.connected ? "online" : "offline"} />
                    </span>
                    <div className="player-info">
                      <strong>
                        {player.nickname}
                        {player.id === me?.id && <small> vous</small>}
                      </strong>
                      <span>
                        {room.phase === "lobby"
                          ? player.connected
                            ? player.ready
                              ? "Prêt à jouer"
                              : "En préparation"
                            : "Reconnexion…"
                          : player.eliminated
                            ? "Éliminé"
                            : `${player.score} points`}
                      </span>
                    </div>
                    {player.id === room.hostPlayerId ? (
                      <Crown size={16} className="purple" />
                    ) : room.phase === "lobby" && player.ready ? (
                      <Check size={17} className="green" />
                    ) : null}
                    {host && room.phase === "lobby" && player.id !== me?.id && (
                      <button
                        className="kick"
                        aria-label={`Expulser ${player.nickname}`}
                        onClick={() =>
                          void send("room:kick", { playerId: player.id })
                        }
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="spectator-list">
                <h3>
                  Spectateurs ({room.players.filter((p) => p.spectator).length}
                  /50)
                </h3>
                {room.players
                  .filter((p) => p.spectator)
                  .map((p) => (
                    <div key={p.id}>
                      <span>
                        {p.nickname}
                        {p.id === me?.id ? " (vous)" : ""}
                      </span>
                      <small>
                        {p.queued
                          ? "Place réservée"
                          : p.connected
                            ? "En ligne"
                            : "Absent"}
                      </small>
                      {host && room.phase === "lobby" && p.id !== me?.id && (
                        <button
                          className="kick"
                          aria-label={`Expulser ${p.nickname}`}
                          onClick={() =>
                            void send("room:kick", { playerId: p.id })
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              <SpectatorControls
                room={room}
                me={me}
                send={send}
                pending={pending}
              />
              <Preferences room={room} me={me} send={send} pending={pending} />
              <div className="players-footer">
                {room.phase === "lobby" ? (
                  <>
                    <p>Invitez vos amis avec le code ou le lien.</p>
                    <Button kind="secondary" onClick={() => void copy()}>
                      <LinkIcon size={16} /> Inviter des amis
                    </Button>
                  </>
                ) : (
                  <p>
                    <Shield size={15} /> Gardez votre rôle secret.
                  </p>
                )}
                {room.settings.discordUrl && (
                  <a
                    className="discord-link"
                    href={room.settings.discordUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Volume2 size={16} /> Rejoindre le vocal Discord{" "}
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </aside>
            <section className="game-panel panel">
              {room.phase === "lobby" ? (
                <>
                  <div className="panel-title">
                    <h2>
                      <Settings2 size={17} /> Paramètres de la mission
                    </h2>
                    <span>
                      {host ? "VOUS ÊTES L’HÔTE" : "CHOISIS PAR L’HÔTE"}
                    </span>
                  </div>
                  {settings && (
                    <AdvancedSettings
                      room={room}
                      value={settings}
                      onChange={setSettings}
                      host={host}
                      pending={pending}
                      send={send}
                      socket={socket}
                    />
                  )}
                  <div className="launch">
                    <p>
                      {activePlayers.filter((p) => p.ready).length}/
                      {activePlayers.length} joueurs prêts{" "}
                      <span>· minimum {spiesFor(room.settings) * 3}</span>
                    </p>
                    <div>
                      {!me?.spectator && (
                        <Button
                          kind={me?.ready ? "secondary" : "primary"}
                          disabled={pending}
                          onClick={() =>
                            void send("room:ready", { ready: !me?.ready })
                          }
                        >
                          {me?.ready ? (
                            <>
                              <Check size={16} /> Je suis prêt
                            </>
                          ) : (
                            <>
                              Je suis prêt <Check size={16} />
                            </>
                          )}
                        </Button>
                      )}
                      {host && (
                        <Button
                          disabled={
                            pending ||
                            (settingsChanged
                              ? !settings?.categories.length
                              : room.tournamentFinished ||
                                room.remainingWords === 0 ||
                                activePlayers.length <
                                  spiesFor(room.settings) * 3 ||
                                !activePlayers.every(
                                  (p) => p.ready && p.connected,
                                ))
                          }
                          onClick={() =>
                            void (settingsChanged
                              ? saveSettings()
                              : send("game:start"))
                          }
                        >
                          {settingsChanged
                            ? "Appliquer les règles"
                            : "Lancer la partie"}{" "}
                          <Play size={16} />
                        </Button>
                      )}
                    </div>
                    {host && (
                      <small role="status">
                        {settingsChanged
                          ? "Appliquez les règles modifiées, puis chaque joueur doit se déclarer prêt. Une seule catégorie sélectionnée suffit."
                          : "Chaque joueur doit se déclarer prêt après une modification des règles."}
                      </small>
                    )}
                    {!host && (
                      <small>
                        L’hôte lancera la partie quand tout le monde sera prêt.
                      </small>
                    )}
                  </div>
                </>
              ) : room.phase === "results" ? (
                <>
                  <div className="results">
                    <div className="result-symbol">
                      <Shield size={35} />
                    </div>
                    <span className="eyebrow">
                      FIN DE LA MANCHE {room.roundIndex}
                    </span>
                    <h2>
                      {room.result?.winner === "innocents"
                        ? "Les innocents l’emportent !"
                        : "Les espions l’emportent !"}
                    </h2>
                    <p>{room.result?.reason}</p>
                    <div className="secret-word">
                      <span>LE MOT SECRET ÉTAIT</span>
                      <strong>{room.result?.word}</strong>
                      <small>{room.result?.category}</small>
                    </div>
                    <div className="score-table">
                      {room.result?.roles.map((role) => {
                        const player = room.players.find(
                          (p) => p.id === role.playerId,
                        );
                        return (
                          <div key={role.playerId}>
                            <strong>
                              {player?.nickname ?? "Joueur parti"}
                            </strong>
                            <span
                              className={role.role === "spy" ? "purple" : ""}
                            >
                              {role.role === "spy" ? "Espion" : "Innocent"}
                            </span>
                            <b>+{role.points}</b>
                            <small>{player?.score ?? 0} pts</small>
                          </div>
                        );
                      })}
                    </div>
                    {host ? (
                      <Button
                        disabled={pending}
                        onClick={() => void send("game:rematch")}
                      >
                        <RotateCcw size={17} /> Rejouer dans ce salon
                      </Button>
                    ) : (
                      <p>L’hôte peut lancer une nouvelle manche.</p>
                    )}
                  </div>
                </>
              ) : me?.spectator ? (
                <div className="active-game">
                  <Eye size={38} />
                  <h2>Vue spectateur</h2>
                  <p className="phase-help">
                    {phaseLabel[room.phase]} · {seconds} s<br />
                    Observez la partie sans carte ni vote.
                  </p>
                  <SpectatorControls
                    room={room}
                    me={me}
                    send={send}
                    pending={pending}
                  />
                </div>
              ) : (
                <>
                  <div className="panel-title">
                    <h2>
                      <span className="live-dot" />
                      {phaseLabel[room.phase]}
                    </h2>
                    <span className={`timer ${seconds < 15 ? "urgent" : ""}`}>
                      <Clock size={16} />
                      {Math.floor(seconds / 60)
                        .toString()
                        .padStart(2, "0")}
                      :{(seconds % 60).toString().padStart(2, "0")}
                    </span>
                  </div>
                  <div className="active-game">
                    {(room.phase === "reveal" ||
                      room.phase === "discussion") && (
                      <>
                        <span className="eyebrow">VOTRE CARTE PERSONNELLE</span>
                        <button
                          className={`role-card ${shown ? "revealed" : ""}`}
                          onClick={() => setShown(!shown)}
                          aria-label={
                            shown ? "Masquer ma carte" : "Afficher ma carte"
                          }
                        >
                          {shown && card ? (
                            <>
                              <span className="role-badge">
                                {card.role === "spy"
                                  ? "VOUS ÊTES L’ESPION"
                                  : "VOUS ÊTES INNOCENT"}
                              </span>
                              <span className="card-icon">
                                <Eye size={42} />
                              </span>
                              <strong>
                                {card.role === "spy"
                                  ? "À vous de bluffer."
                                  : card.word}
                              </strong>
                              <span>{card.category}</span>
                              <small>
                                {card.role === "spy"
                                  ? "Découvrez le mot sans vous faire repérer."
                                  : "Ne prononcez jamais le mot secret."}
                              </small>
                              <span className="card-action">
                                <EyeOff size={14} /> Masquer ma carte
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="card-decoration">?</span>
                              <Eye size={30} />
                              <strong>Un secret vous attend.</strong>
                              <span>Vous seul pouvez voir cette carte.</span>
                              <span className="card-action">
                                Révéler mon rôle <ArrowUpRight size={15} />
                              </span>
                            </>
                          )}
                        </button>
                        <p className="phase-help">
                          {room.phase === "reveal"
                            ? "Mémorisez votre carte. La discussion commencera automatiquement."
                            : "Posez une question à un autre joueur. Restez subtil : l’espion vous écoute."}
                        </p>
                        {host &&
                          room.phase === "reveal" &&
                          room.settings.allowPass &&
                          !room.passed && (
                            <Button
                              kind="secondary"
                              disabled={pending}
                              onClick={() =>
                                void send("game:pass", {
                                  roundIndex: room.roundIndex,
                                })
                              }
                            >
                              Passer ce mot · même distribution des rôles
                            </Button>
                          )}
                        {host && (
                          <Button
                            kind="secondary"
                            disabled={pending}
                            onClick={() =>
                              void send(
                                room.phase === "reveal"
                                  ? "game:discussion"
                                  : "game:vote",
                              )
                            }
                          >
                            {room.phase === "reveal"
                              ? "Commencer la discussion"
                              : "Passer au vote"}{" "}
                            <ArrowRight size={16} />
                          </Button>
                        )}
                      </>
                    )}
                    {room.phase === "voting" && (
                      <>
                        <div className="result-symbol">
                          <Target size={32} />
                        </div>
                        <h2>Qui cache son jeu ?</h2>
                        <p className="phase-help">
                          {room.ballotIndex > 1
                            ? "Nouveau tour : départagez les suspects."
                            : "Choisissez le joueur que vous soupçonnez."}
                          <br />
                          Votre choix est définitif après confirmation.
                        </p>
                        <div className="vote-grid">
                          {room.candidates.map((id) => (
                            <button
                              disabled={
                                voted ||
                                !room.eligibleVoters.includes(me?.id ?? "")
                              }
                              className={voteTarget === id ? "selected" : ""}
                              key={id}
                              onClick={() => setVoteTarget(id)}
                            >
                              <UserRound size={20} />
                              {room.players.find((p) => p.id === id)?.nickname}
                              {voteTarget === id && <Check size={15} />}
                            </button>
                          ))}
                        </div>
                        {room.eligibleVoters.includes(me?.id ?? "") ? (
                          <Button
                            disabled={!voteTarget || voted || pending}
                            onClick={() =>
                              void send("vote:cast", {
                                targetPlayerId: voteTarget,
                                ballotIndex: room.ballotIndex,
                                roundIndex: room.roundIndex,
                              }).then((ok) => {
                                if (ok) {
                                  setVoted(true);
                                  write(
                                    `vote:${room.code}:${sessionRef.current?.playerId}:${room.roundIndex}:${room.ballotIndex}`,
                                    true,
                                  );
                                }
                              })
                            }
                          >
                            {voted ? (
                              <>
                                <Check size={17} /> Vote enregistré
                              </>
                            ) : (
                              <>
                                Confirmer mon vote <ArrowRight size={16} />
                              </>
                            )}
                          </Button>
                        ) : (
                          <p>Vous assistez à ce vote en tant que spectateur.</p>
                        )}
                        {room.publicVotes.length > 0 && (
                          <div
                            className="public-votes"
                            aria-label="Votes publics"
                          >
                            {room.publicVotes.map((v) => (
                              <p key={v.voterPlayerId}>
                                {
                                  room.players.find(
                                    (p) => p.id === v.voterPlayerId,
                                  )?.nickname
                                }{" "}
                                →{" "}
                                {
                                  room.players.find(
                                    (p) => p.id === v.targetPlayerId,
                                  )?.nickname
                                }
                              </p>
                            ))}
                          </div>
                        )}
                        <span className="vote-progress">
                          {room.voteCount} / {room.eligibleVoters.length} votes
                          reçus
                        </span>
                      </>
                    )}
                    {room.phase === "spy_guess" && (
                      <>
                        <div className="result-symbol">
                          <Eye size={35} />
                        </div>
                        <h2>Un espion est démasqué.</h2>
                        {room.guessPlayerId === me?.id ? (
                          <>
                            <p className="phase-help">
                              Votre dernière chance : retrouvez le mot secret.
                            </p>
                            <form
                              className="guess-form"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void send("spy:guess", {
                                  word: guess,
                                  roundIndex: room.roundIndex,
                                }).then((ok) => {
                                  if (ok) setGuess("");
                                });
                              }}
                            >
                              <label className="sr-only" htmlFor="guess">
                                Votre proposition
                              </label>
                              <input
                                autoComplete="off"
                                id="guess"
                                maxLength={100}
                                placeholder="Quel était le mot ?"
                                value={guess}
                                onChange={(e) => setGuess(e.target.value)}
                              />
                              <Button
                                type="submit"
                                disabled={pending || !guess.trim()}
                              >
                                Tenter ma chance <ArrowRight size={16} />
                              </Button>
                            </form>
                          </>
                        ) : (
                          <p className="phase-help">
                            {
                              room.players.find(
                                (p) => p.id === room.guessPlayerId,
                              )?.nickname
                            }{" "}
                            a 30 secondes pour deviner le mot.
                            <br />
                            Le suspense continue…
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
            <aside className="chat-panel panel">
              <div className="panel-title">
                <h2>
                  <MessageCircle size={17} /> Le salon
                </h2>
                <span>EN DIRECT</span>
              </div>
              <div
                className="chat-messages"
                role="log"
                aria-label="Messages du salon"
                aria-live="polite"
              >
                {room.messages.length === 0 ? (
                  <div className="empty-chat">
                    <MessageCircle size={28} />
                    <strong>Tout commence ici.</strong>
                    <p>
                      Un bonjour, une question,
                      <br />
                      un premier soupçon.
                    </p>
                  </div>
                ) : (
                  room.messages.map((message) => (
                    <div
                      className={`chat-message ${message.playerId === me?.id ? "own" : ""}`}
                      key={message.id}
                    >
                      <div>
                        <strong>{message.nickname}</strong>
                        <time>
                          {new Date(message.createdAt).toLocaleTimeString(
                            "fr-FR",
                            { hour: "2-digit", minute: "2-digit" },
                          )}
                        </time>
                      </div>
                      <p>{message.body}</p>
                    </div>
                  ))
                )}
                <div ref={chatEnd} />
              </div>
              <form
                className="chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send("chat:send", { body: chat }).then((ok) => {
                    if (ok) setChat("");
                  });
                }}
              >
                <label className="sr-only" htmlFor="chat">
                  Message
                </label>
                <input
                  id="chat"
                  maxLength={300}
                  disabled={!chatAllowed}
                  placeholder={
                    chatAllowed ? "Écrivez un message…" : "Chat en pause…"
                  }
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                />
                <button
                  type="submit"
                  aria-label="Envoyer le message"
                  disabled={pending || !chat.trim() || !chatAllowed}
                >
                  <Send size={18} />
                </button>
              </form>
              <span className="chat-note">
                {room.phase === "voting"
                  ? "Gardez le silence. Faites votre choix."
                  : "Soyez subtil. Les espions lisent aussi."}
              </span>
            </aside>
          </div>
        </main>
      )}
      <footer>
        <span className="footer-brand">
          <Eye size={16} /> SPYFALL UNIVERSE
        </span>
        <span>Faites confiance à votre instinct. Pas à vos amis.</span>
        <button onClick={() => setModal("rules")}>
          Règles du jeu <ArrowUpRight size={13} />
        </button>
      </footer>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className={`modal ${modal === "library" ? "library-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              autoFocus
              onClick={() => setModal(null)}
              aria-label="Fermer"
            >
              <X size={20} />
            </button>
            {modal === "rules" ? (
              <>
                <span className="eyebrow">BRIEFING DE MISSION</span>
                <h2 id="modal-title">L’art du soupçon.</h2>
                <ol className="rules-list">
                  <li>
                    <strong>Recevez votre carte.</strong> Les innocents
                    partagent le même mot. L’espion ne connaît que la catégorie.
                  </li>
                  <li>
                    <strong>Posez des questions.</strong> Interrogez-vous à tour
                    de rôle, par chat ou sur votre vocal Discord. Ne dites pas
                    le mot !
                  </li>
                  <li>
                    <strong>Votez pour un suspect.</strong> Un vote par joueur
                    et par tour. Une égalité déclenche un second tour ; une
                    nouvelle égalité donne la victoire aux espions.
                  </li>
                  <li>
                    <strong>L’espion a une dernière chance.</strong> S’il est
                    identifié, il peut deviner le mot. En double espion, une
                    mauvaise réponse lance le vote pour le second espion.
                  </li>
                </ol>
                <div className="rules-points">
                  <span>
                    Innocent gagnant <b>+100</b>
                  </span>
                  <span>
                    Espion survivant <b>+200</b>
                  </span>
                  <span>
                    Espion qui devine <b>+150</b>
                  </span>
                </div>
                <p className="subtle">
                  3 à 12 joueurs · double espion dès 6 joueurs. Les espions ne
                  se connaissent pas. Chaque vote dure 45 s. Une déconnexion
                  laisse 60 s pour revenir. Le chat ferme pendant le vote et la
                  dernière chance.
                </p>
                <Button onClick={() => setModal(null)}>
                  Mission comprise <Check size={16} />
                </Button>
              </>
            ) : modal === "library" ? (
              <>
                <span className="eyebrow">VOS UNIVERS</span>
                <h2 id="modal-title">Bibliothèque de packs.</h2>
                <LibraryPanel />
              </>
            ) : account ? (
              <>
                <span className="eyebrow">VOTRE ESPACE</span>
                <h2 id="modal-title">{account.username}</h2>
                <p>{account.email}</p>
                {stats && (
                  <div className="rules-points">
                    <span>
                      Manches récentes <b>{stats.rounds ?? 0}</b>
                    </span>
                    <span>
                      Points <b>{stats.points ?? 0}</b>
                    </span>
                    <span>
                      Victoires{" "}
                      <b>
                        {stats.wins ?? 0} / {stats.rounds}
                      </b>
                    </span>
                    <span>
                      Manches comme espion <b>{stats.spyRounds ?? 0}</b>
                    </span>
                  </div>
                )}
                {stats?.history && (
                  <details className="account-history">
                    <summary>Mes dernières manches</summary>
                    {stats.history.map((entry, i) => (
                      <p key={i}>
                        {new Date(entry.finishedAt).toLocaleString("fr-FR")} ·{" "}
                        {entry.role === "spy" ? "Espion" : "Innocent"} · +
                        {entry.points} pts
                        <br />
                        {entry.reason}
                      </p>
                    ))}
                  </details>
                )}
                <p className="subtle">
                  Les résultats de compte sont conservés 30 jours. Les salons
                  actifs sont conservés en mémoire ; les messages ne sont pas
                  archivés.
                </p>
                <Button kind="secondary" onClick={() => void logout()}>
                  <LogOut size={16} /> Se déconnecter
                </Button>
                <button
                  className="delete-account"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Supprimer définitivement votre compte et vos sessions ?",
                      )
                    )
                      void fetch("/api/auth/me", { method: "DELETE" })
                        .then(async (r) => {
                          if (!r.ok) throw new Error();
                          setAccount(null);
                          setStats(null);
                          setModal(null);
                          setNotice("Compte supprimé.");
                        })
                        .catch(() =>
                          setError("La suppression a échoué. Réessayez."),
                        );
                  }}
                >
                  Supprimer mon compte
                </button>
              </>
            ) : (
              <>
                <span className="eyebrow">TOUJOURS FACULTATIF</span>
                <h2 id="modal-title">
                  {accountMode === "login"
                    ? "Heureux de vous revoir."
                    : "Gardez une trace du jeu."}
                </h2>
                {accountsEnabled ? (
                  <form className="auth-form" onSubmit={accountSubmit}>
                    {accountMode === "register" && (
                      <label>
                        Pseudo
                        <input
                          required
                          minLength={2}
                          maxLength={24}
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          autoComplete="nickname"
                        />
                      </label>
                    )}
                    <label>
                      E-mail
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                      />
                    </label>
                    <label>
                      Mot de passe
                      <input
                        type="password"
                        required
                        minLength={10}
                        maxLength={128}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={
                          accountMode === "login"
                            ? "current-password"
                            : "new-password"
                        }
                      />
                    </label>
                    <Button type="submit" disabled={pending}>
                      {accountMode === "login"
                        ? "Se connecter"
                        : "Créer mon compte"}{" "}
                      <ArrowRight size={16} />
                    </Button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setAccountMode(
                          accountMode === "login" ? "register" : "login",
                        )
                      }
                    >
                      {accountMode === "login"
                        ? "Créer un compte"
                        : "J’ai déjà un compte"}
                    </button>
                  </form>
                ) : (
                  <>
                    <p>
                      Les comptes ne sont pas activés sur ce serveur. Vous
                      pouvez jouer immédiatement en invité.
                    </p>
                    <Button onClick={() => setModal(null)}>
                      Jouer en invité <ArrowRight size={16} />
                    </Button>
                  </>
                )}
                <p className="subtle privacy">
                  Votre e-mail sert uniquement à votre compte. Aucun e-mail
                  marketing. Suppression possible depuis cet espace. Historique
                  conservé 30 jours, sessions de compte 7 jours ; salons
                  inactifs supprimés après une heure.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
const overlayToken =
  new URLSearchParams(location.hash.slice(1)).get("overlay") ??
  new URLSearchParams(location.search).get("overlay");
createRoot(document.getElementById("root")!).render(
  overlayToken ? <StreamOverlay token={overlayToken} /> : <App />,
);
