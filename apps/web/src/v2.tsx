import { useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { io, type Socket } from "socket.io-client";
import {
  categories,
  packSchema,
  spiesFor,
  type Ack,
  type Command,
  type Settings,
  type RoomView,
  type PlayerView,
  type Library,
  type WordPack,
  type StreamView,
  type PackSummary,
} from "@spyfall/shared";
const button = "btn secondary";
export type Send = (name: Command, payload?: unknown) => Promise<boolean>;
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "La requête a échoué.");
  return data as T;
}
function useLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState("");
  const refresh = async () => {
    try {
      setLibrary(await api<Library>("/api/library"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Bibliothèque indisponible.",
      );
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return { library, error, setError, refresh };
}
export function AdvancedSettings({
  room,
  value,
  onChange,
  host,
  pending,
  send,
  socket,
}: {
  room: RoomView;
  value: Settings;
  onChange: Dispatch<SetStateAction<Settings | null>>;
  host: boolean;
  pending: boolean;
  send: Send;
  socket: Socket;
}) {
  const { library, error, setError, refresh } = useLibrary();
  const [name, setName] = useState("");
  const [counts, setCounts] = useState({
    available: room.availableWords,
    remaining: room.remainingWords,
  });
  const locked =
    !host || pending || (room.settings.rounds > 1 && room.completedRounds > 0);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      socket
        .timeout(4000)
        .emit(
          "room:preview",
          JSON.parse(key),
          (err: Error | null, ack: Ack) => {
            if (!err && ack.ok && ack.counts) setCounts(ack.counts);
          },
        );
    }, 350);
    return () => clearTimeout(timer);
  }, [key, room.remainingWords, room.availableWords, socket]);
  const patch = (changes: Partial<Settings>) =>
    onChange({ ...value, ...changes });
  const toggle = (items: string[], item: string) =>
    items.includes(item) ? items.filter((v) => v !== item) : [...items, item];
  const availableCategories = [
    ...new Set([
      ...categories,
      ...room.packs.flatMap((pack) => pack.categories),
    ]),
  ];
  const savePreset = async () => {
    try {
      await api("/api/presets", "POST", { name, settings: value });
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sauvegarde impossible.");
    }
  };
  const attach = async (pack: PackSummary) => {
    await send("pack:attach", { packId: pack.id });
  };
  return (
    <div className="settings-body v2-settings">
      <div
        className={`word-count ${!counts.remaining ? "warning" : ""}`}
        role="status"
      >
        <strong>{counts.remaining} mots inédits</strong>
        <span>{counts.available} compatibles avec les filtres collectifs</span>
        {!counts.available && (
          <p>Élargissez les filtres ou les connaissances déclarées.</p>
        )}
        {counts.available > 0 && !counts.remaining && (
          <p>
            Vivier épuisé : réinitialisez l’historique ou élargissez la
            sélection.
          </p>
        )}
      </div>
      {host && room.availableWords > 0 && room.remainingWords === 0 && (
        <button
          className={button}
          disabled={pending}
          onClick={() => void send("words:reset")}
        >
          Réinitialiser l’historique des mots
        </button>
      )}
      <fieldset disabled={locked}>
        <legend>Règles de la partie</legend>
        <div className="v2-form-grid">
          <label>
            Espions
            <select
              value={spiesFor(value)}
              onChange={(e) => {
                const n = Number(e.target.value);
                patch({
                  mode: n === 1 ? "classic" : n === 2 ? "double" : "custom",
                  spyCount: n,
                });
              }}
            >
              <option value={1}>1 · minimum 3 joueurs</option>
              <option value={2}>2 · minimum 6 joueurs</option>
              <option value={3}>3 · minimum 9 joueurs</option>
            </select>
          </label>
          <label>
            Discussion
            <select
              value={value.duration}
              onChange={(e) =>
                patch({
                  duration: Number(e.target.value) as Settings["duration"],
                })
              }
            >
              {[3, 5, 7, 10].map((n) => (
                <option key={n} value={n}>
                  {n} minutes
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre de manches
            <select
              value={value.rounds}
              onChange={(e) => patch({ rounds: Number(e.target.value) })}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1)
                .filter((n) => !value.tournament || n >= 5)
                .map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Manches libres" : `${n} manches`}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Difficulté
            <select
              value={value.difficulty}
              onChange={(e) =>
                patch({ difficulty: e.target.value as Settings["difficulty"] })
              }
            >
              <option value="all">Toutes</option>
              <option value="easy">Facile</option>
              <option value="medium">Intermédiaire</option>
              <option value="hard">Difficile</option>
            </select>
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value.tournament}
            onChange={(e) =>
              patch({
                tournament: e.target.checked,
                rounds: e.target.checked
                  ? Math.max(5, value.rounds)
                  : value.rounds,
              })
            }
          />
          Tournoi avec podium final (5 à 10 manches)
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value.anonymousVotes}
            onChange={(e) => patch({ anonymousVotes: e.target.checked })}
          />
          Votes anonymes
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value.allowPass}
            onChange={(e) => patch({ allowPass: e.target.checked })}
          />
          L’hôte peut passer un mot pendant la révélation (une fois)
        </label>
      </fieldset>
      <fieldset disabled={locked}>
        <legend>Catégories retenues par le salon</legend>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value.includeOfficial}
            onChange={(e) => patch({ includeOfficial: e.target.checked })}
          />
          Inclure les 300 mots officiels
        </label>
        <div className="v2-check-grid">
          {availableCategories.map((category) => (
            <label className="checkbox-row" key={category}>
              <input
                type="checkbox"
                checked={value.categories.includes(category)}
                onChange={() =>
                  patch({ categories: toggle(value.categories, category) })
                }
              />
              {category}
            </label>
          ))}
        </div>
        <legend>Sous-catégories · aucune sélection = toutes</legend>
        <div className="v2-check-grid">
          {room.subcategoryOptions
            .filter((sub) => value.categories.includes(sub.category))
            .map((sub) => {
              const id = `${sub.category}::${sub.name}`;
              return (
                <label className="checkbox-row" key={id} title={sub.category}>
                  <input
                    type="checkbox"
                    checked={value.subcategories.includes(id)}
                    onChange={() =>
                      patch({ subcategories: toggle(value.subcategories, id) })
                    }
                  />
                  <span>
                    {sub.name} <small>({sub.count})</small>
                  </span>
                </label>
              );
            })}
        </div>
      </fieldset>
      <fieldset disabled={locked}>
        <legend>Packs attachés · instantanés propres au salon</legend>
        {room.packs.map((pack) => (
          <label key={pack.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={value.packIds.includes(pack.id)}
              onChange={() =>
                patch({ packIds: toggle(value.packIds, pack.id) })
              }
            />
            {pack.name} · {pack.wordCount} mots · v{pack.revision}
          </label>
        ))}
        {host && (
          <details>
            <summary>
              Ajouter un pack de ma bibliothèque ou du catalogue
            </summary>
            <div className="pack-picker">
              {[
                ...(library?.packs ?? []),
                ...(library?.catalog ?? []).filter(
                  (p) => !library?.packs.some((own) => own.id === p.id),
                ),
              ]
                .filter(
                  (p) => !room.packs.some((attached) => attached.id === p.id),
                )
                .map((pack) => (
                  <button
                    className={button}
                    key={pack.id}
                    onClick={() => void attach(pack)}
                  >
                    {pack.name} · {pack.wordCount} mots
                  </button>
                ))}
              {!library?.packs.length && !library?.catalog.length && (
                <p>Créez ou importez un pack depuis « Bibliothèque ».</p>
              )}
            </div>
          </details>
        )}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>Vocal et streaming</legend>
        <label>
          Invitation Discord facultative
          <input
            type="url"
            placeholder="https://discord.gg/…"
            value={value.discordUrl}
            onChange={(e) => patch({ discordUrl: e.target.value })}
          />
        </label>
        <label>
          Délai des révélations OBS (secondes)
          <input
            type="number"
            min={0}
            max={120}
            value={value.streamDelay}
            onChange={(e) => patch({ streamDelay: Number(e.target.value) })}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value.streamPrivacy}
            onChange={(e) => patch({ streamPrivacy: e.target.checked })}
          />
          Confidentialité OBS : masquer le code, le mot et les rôles, même aux
          résultats
        </label>
      </fieldset>
      {host && (
        <>
          <div className="v2-actions">
            <button
              className="btn primary"
              disabled={
                locked ||
                !value.categories.length ||
                JSON.stringify(value) === JSON.stringify(room.settings)
              }
              onClick={() => void send("room:settings:update", value)}
            >
              Enregistrer les règles
            </button>
            <button
              className={button}
              disabled={pending}
              onClick={() => void send("stream:create")}
            >
              Copier un nouveau lien OBS
            </button>
          </div>
          <small>
            Un nouveau lien OBS révoque le précédent. Sa connexion est
            uniquement en lecture.
          </small>
          <fieldset disabled={locked}>
            <legend>Mes presets réutilisables</legend>
            <label>
              Nom du preset
              <input
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Soirée anime"
              />
            </label>
            <button
              className={button}
              disabled={!name.trim()}
              onClick={() => void savePreset()}
            >
              Sauvegarder ces règles
            </button>
            <div className="preset-list">
              {library?.presets.map((preset) => (
                <div key={preset.id}>
                  <span>{preset.name}</span>
                  <button
                    className={button}
                    onClick={() =>
                      void (async () => {
                        for (const packId of preset.settings.packIds)
                          if (
                            !room.packs.some((p) => p.id === packId) &&
                            !(await send("pack:attach", { packId }))
                          )
                            return;
                        await send("room:settings:update", preset.settings);
                      })()
                    }
                  >
                    Appliquer
                  </button>
                  <button
                    aria-label={`Supprimer ${preset.name}`}
                    className="icon-button"
                    onClick={() =>
                      void api(`/api/library/${preset.id}`, "DELETE")
                        .then(refresh)
                        .catch((e) => setError(e.message))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {locked && host && room.completedRounds > 0 && (
        <p className="subtle">
          Les règles sont fixes pendant la série. Réinitialisez le classement
          pour les modifier.
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Preferences({
  room,
  me,
  send,
  pending,
}: {
  room: RoomView;
  me: PlayerView | undefined;
  send: Send;
  pending: boolean;
}) {
  const [known, setKnown] = useState<string[]>(me?.knownCategories ?? []);
  const [subs, setSubs] = useState<string[]>(me?.knownSubcategories ?? []);
  const key = JSON.stringify([me?.knownCategories, me?.knownSubcategories]);
  useEffect(() => {
    setKnown(me?.knownCategories ?? []);
    setSubs(me?.knownSubcategories ?? []);
  }, [key]);
  const change = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  const locked =
    pending ||
    (!me?.spectator &&
      (room.phase !== "lobby" ||
        (room.settings.rounds > 1 &&
          room.standings.some((s) => s.playerId === me?.id))));
  return (
    <details className="preferences">
      <summary>Mes univers connus</summary>
      <p>
        Le tirage utilise l’intersection des choix de tous les participants.
        Aucune case = aucune restriction.
      </p>
      <fieldset disabled={locked}>
        <legend>Catégories que je connais</legend>
        {[
          ...new Set([
            ...categories,
            ...room.packs.flatMap((p) => p.categories),
          ]),
        ].map((category) => (
          <label className="checkbox-row" key={category}>
            <input
              type="checkbox"
              checked={known.includes(category)}
              onChange={() => setKnown(change(known, category))}
            />
            {category}
          </label>
        ))}
        <legend>Sous-catégories que je connais</legend>
        {room.subcategoryOptions
          .filter((s) => !known.length || known.includes(s.category))
          .map((sub) => {
            const id = `${sub.category}::${sub.name}`;
            return (
              <label className="checkbox-row" key={id}>
                <input
                  type="checkbox"
                  checked={subs.includes(id)}
                  onChange={() => setSubs(change(subs, id))}
                />
                {sub.name}
              </label>
            );
          })}
        <button
          className={button}
          onClick={() =>
            void send("room:preferences", {
              categories: known,
              subcategories: subs,
            })
          }
        >
          Appliquer mes connaissances
        </button>
      </fieldset>
    </details>
  );
}
export function SpectatorControls({
  room,
  me,
  send,
  pending,
}: {
  room: RoomView;
  me: PlayerView | undefined;
  send: Send;
  pending: boolean;
}) {
  return (
    <div className="spectator-controls">
      <strong>
        {me?.spectator ? "Vous êtes spectateur" : "Vous participez à la partie"}
      </strong>
      {me?.spectator ? (
        <>
          <p>Aucun rôle, mot secret ou vote pendant la manche.</p>
          <button
            className={button}
            disabled={pending}
            onClick={() =>
              void send("room:participate", { queued: !me.queued })
            }
          >
            {me.queued
              ? "Annuler ma place réservée"
              : room.phase === "lobby"
                ? "Devenir participant"
                : "Rejoindre la prochaine manche"}
          </button>
          {me.queued && (
            <small>Votre place est réservée pour le prochain lobby.</small>
          )}
        </>
      ) : (
        room.phase === "lobby" && (
          <button
            className={button}
            disabled={pending}
            onClick={() => void send("room:participate", { queued: false })}
          >
            Devenir spectateur
          </button>
        )
      )}
    </div>
  );
}
export function SeriesPanel({
  room,
  host,
  send,
  pending,
}: {
  room: RoomView;
  host: boolean;
  send: Send;
  pending: boolean;
}) {
  return (
    <section className="series-panel panel">
      <div>
        <strong>
          {room.settings.tournament
            ? "Tournoi"
            : room.settings.rounds > 1
              ? "Série"
              : "Classement du salon"}
        </strong>
        <span>
          {room.completedRounds} manche{room.completedRounds > 1 ? "s" : ""}{" "}
          terminée{room.completedRounds > 1 ? "s" : ""}
          {room.settings.rounds > 1 ? ` / ${room.settings.rounds}` : ""}
        </span>
        {room.tournamentFinished && (
          <b className="purple">Série terminée · podium final</b>
        )}
      </div>
      {room.tournamentFinished && (
        <div className="podium">
          {room.standings.slice(0, 3).map((s, i) => (
            <article key={s.playerId}>
              <span>{["🥇", "🥈", "🥉"][i]}</span>
              <strong>{s.nickname}</strong>
              <b>{s.score} pts</b>
            </article>
          ))}
        </div>
      )}
      {room.standings.length > 0 && (
        <details open={room.tournamentFinished}>
          <summary>Classement et historique</summary>
          <div className="standings">
            {room.standings.map((s, i) => (
              <div key={s.playerId}>
                <strong>
                  {i + 1}. {s.nickname}
                </strong>
                <span>{s.score} pts</span>
                <small>
                  {s.wins}/{s.rounds} victoires · espion {s.spyRounds} fois
                </small>
              </div>
            ))}
          </div>
          {room.history.map((h) => (
            <details key={h.roundIndex}>
              <summary>
                Manche {h.roundIndex} ·{" "}
                {h.result.winner === "spies" ? "Espions" : "Innocents"} gagnants
              </summary>
              <p>
                {h.result.word} · {h.result.reason}
              </p>
              {h.result.roles.map((role) => (
                <p key={role.playerId}>
                  {h.names[role.playerId]} :{" "}
                  {role.role === "spy" ? "espion" : "innocent"} · +{role.points}
                </p>
              ))}
            </details>
          ))}
        </details>
      )}
      {host && ["lobby", "results"].includes(room.phase) && (
        <button
          className={button}
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                "Remettre les scores et l’historique du tournoi à zéro ? Les résultats de compte restent conservés.",
              )
            )
              void send("tournament:reset");
          }}
        >
          Relancer une série · scores à zéro
        </button>
      )}
    </section>
  );
}
const blank = (): WordPack => ({
  version: 1,
  name: "Mon pack",
  description: "",
  words: [
    {
      label: "",
      category: "Mon univers",
      subcategory: "Général",
      difficulty: "easy",
      variants: [],
    },
  ],
});
export function LibraryPanel() {
  const { library, error, setError, refresh } = useLibrary();
  const [draft, setDraft] = useState<WordPack>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const run = async (task: () => Promise<unknown>) => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await task();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };
  const word = (index: number, patch: Partial<WordPack["words"][number]>) =>
    setDraft({
      ...draft,
      words: draft.words.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    });
  const preview = (pack: WordPack) => setRaw(JSON.stringify(pack, null, 2));
  const exportPack = (pack: WordPack) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "spyfall-pack.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="library-content">
      <p>
        Vos packs privés restent dans votre bibliothèque. Une proposition
        publique doit être approuvée par un modérateur. Toute édition publique
        repasse en attente.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {info && <p role="status">{info}</p>}
      {raw && (
        <details className="pack-preview" open>
          <summary>Prévisualisation JSON du pack</summary>
          <pre tabIndex={0}>{raw}</pre>
        </details>
      )}
      <div className="library-columns">
        <div>
          <h3>Mes packs</h3>
          {library?.packs.map((pack) => (
            <article className="library-card" key={pack.id}>
              <strong>{pack.name}</strong>
              <small>
                {pack.wordCount} mots ·{" "}
                {
                  (
                    {
                      private: "privé",
                      pending: "en attente",
                      approved: "validé",
                      rejected: "refusé",
                    } as const
                  )[pack.status]
                }{" "}
                · v{pack.revision}
              </small>
              <div className="v2-actions">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    setDraft(pack.pack);
                    setEditing(pack.id);
                  }}
                >
                  Modifier
                </button>
                <button className={button} onClick={() => preview(pack.pack)}>
                  Prévisualiser
                </button>
                <button
                  className={button}
                  onClick={() => exportPack(pack.pack)}
                >
                  Exporter JSON
                </button>
                {["private", "rejected"].includes(pack.status) && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/api/packs/${pack.id}/submit`, "POST"),
                      )
                    }
                  >
                    Proposer à la communauté
                  </button>
                )}
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Supprimer ce pack ? Les instantanés déjà attachés à un salon restent utilisables.",
                      )
                    )
                      void run(() => api(`/api/library/${pack.id}`, "DELETE"));
                  }}
                >
                  Supprimer
                </button>
              </div>
            </article>
          ))}
          {!library?.packs.length && <p>Aucun pack créé pour le moment.</p>}
          <h3>Catalogue public validé</h3>
          {library?.catalog.map((pack) => (
            <article className="library-card" key={pack.id}>
              <strong>{pack.name}</strong>
              <small>
                {pack.wordCount} mots · {pack.categories.join(", ")}
              </small>
              <button
                className={button}
                onClick={() =>
                  void run(async () =>
                    preview(await api<WordPack>(`/api/packs/${pack.id}`)),
                  )
                }
              >
                Prévisualiser
              </button>
            </article>
          ))}
          {!library?.catalog.length && (
            <p>Le catalogue ne contient aucun pack public validé.</p>
          )}
          {library?.moderator && (
            <>
              <h3>File de modération</h3>
              {library.queue.map((pack) => (
                <article className="library-card" key={pack.id}>
                  <strong>
                    {pack.name} · v{pack.revision}
                  </strong>
                  <button className={button} onClick={() => preview(pack.pack)}>
                    Relire le contenu
                  </button>
                  <div className="v2-actions">
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/api/packs/${pack.id}/moderate`, "POST", {
                            status: "approved",
                          }),
                        )
                      }
                    >
                      Valider
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/api/packs/${pack.id}/moderate`, "POST", {
                            status: "rejected",
                          }),
                        )
                      }
                    >
                      Refuser
                    </button>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
        <div>
          <h3>{editing ? "Modifier un pack" : "Créer un pack"}</h3>
          <fieldset disabled={busy}>
            <label>
              Nom
              <input
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={500}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            <div className="word-editor">
              {draft.words.map((w, i) => (
                <div className="word-row" key={i}>
                  <strong>Mot {i + 1}</strong>
                  <label>
                    Libellé
                    <input
                      maxLength={100}
                      value={w.label}
                      onChange={(e) => word(i, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    Catégorie
                    <input
                      maxLength={100}
                      value={w.category}
                      onChange={(e) => word(i, { category: e.target.value })}
                    />
                  </label>
                  <label>
                    Sous-catégorie
                    <input
                      maxLength={100}
                      value={w.subcategory}
                      onChange={(e) => word(i, { subcategory: e.target.value })}
                    />
                  </label>
                  <label>
                    Difficulté
                    <select
                      value={w.difficulty}
                      onChange={(e) =>
                        word(i, {
                          difficulty: e.target.value as typeof w.difficulty,
                        })
                      }
                    >
                      <option value="easy">Facile</option>
                      <option value="medium">Intermédiaire</option>
                      <option value="hard">Difficile</option>
                    </select>
                  </label>
                  <label>
                    Variantes acceptées, séparées par |
                    <input
                      maxLength={1200}
                      value={w.variants.join(" | ")}
                      onChange={(e) =>
                        word(i, {
                          variants: e.target.value
                            ? e.target.value.split("|").map((v) => v.trim())
                            : [],
                        })
                      }
                    />
                  </label>
                  <button
                    className={button}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        words: draft.words.filter((_, n) => n !== i),
                      })
                    }
                  >
                    Retirer ce mot
                  </button>
                </div>
              ))}
            </div>
            <div className="v2-actions">
              <button
                className={button}
                disabled={draft.words.length >= 1000}
                onClick={() =>
                  setDraft({
                    ...draft,
                    words: [
                      ...draft.words,
                      {
                        label: "",
                        category: draft.words.at(-1)?.category ?? "Mon univers",
                        subcategory: "Général",
                        difficulty: "easy",
                        variants: [],
                      },
                    ],
                  })
                }
              >
                Ajouter un mot
              </button>
              <button
                className="btn primary"
                onClick={() =>
                  void run(async () => {
                    await api(
                      editing ? `/api/packs/${editing}` : "/api/packs",
                      editing ? "PUT" : "POST",
                      draft,
                    );
                    setInfo(
                      "Pack enregistré. Attachez-le à votre salon dans ses paramètres.",
                    );
                  })
                }
              >
                Enregistrer le pack privé
              </button>
              <button
                className={button}
                onClick={() => {
                  setEditing(null);
                  setDraft(blank());
                }}
              >
                Nouveau pack
              </button>
            </div>
          </fieldset>
          <details>
            <summary>Importer, prévisualiser ou exporter du JSON</summary>
            <p>
              Le format version 1 contient un nom, une description et des mots
              avec catégorie, sous-catégorie, difficulté et variantes.
            </p>
            <label>
              Choisir un fichier JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 512000) {
                      setError("Fichier limité à 500 Ko.");
                      return;
                    }
                    void file.text().then(setRaw);
                  }
                }}
              />
            </label>
            <label>
              Contenu JSON
              <textarea
                className="json-editor"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                maxLength={512000}
              />
            </label>
            <button
              className={button}
              onClick={() => {
                try {
                  const parsed = JSON.parse(raw);
                  {
                    const validated = packSchema.safeParse(parsed);
                    if (!validated.success) {
                      setError(
                        validated.error.issues[0]?.message ??
                          "Format invalide.",
                      );
                      return;
                    }
                    setDraft(validated.data);
                    setEditing(null);
                    setInfo(
                      "Import prévisualisé dans l’éditeur. Enregistrez pour l’utiliser.",
                    );
                  }
                } catch {
                  setError("JSON invalide.");
                }
              }}
            >
              Importer dans l’éditeur sans publier
            </button>
            <button className={button} onClick={() => preview(draft)}>
              Prévisualiser le brouillon JSON
            </button>
            <button className={button} onClick={() => exportPack(draft)}>
              Exporter le brouillon
            </button>
          </details>
        </div>
      </div>
    </div>
  );
}
export function StreamOverlay({ token }: { token: string }) {
  const [view, setView] = useState<StreamView | null>(null);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const socket = io({ autoConnect: false });
    let offset = 0;
    socket.on("connect", () => {
      socket
        .timeout(5000)
        .emit("stream:watch", { token }, (err: Error | null, ack: Ack) => {
          if (err || !ack.ok)
            setError(err ? "Connexion impossible." : !ack.ok ? ack.error : "");
          else setError("");
        });
    });
    socket.on("stream:state", (state: StreamView) => {
      offset = state.serverNow - Date.now();
      setView(state);
    });
    socket.on("stream:expired", () => {
      setView(null);
      setError("Lien révoqué ou salon expiré.");
    });
    socket.on("connect_error", () =>
      setError("Connexion au serveur impossible."),
    );
    socket.on("disconnect", () => setError("Overlay déconnecté."));
    socket.connect();
    const timer = setInterval(() => setClock(Date.now() + offset), 250);
    return () => {
      socket.disconnect();
      clearInterval(timer);
    };
  }, [token]);
  const seconds = view?.deadlineAt
    ? Math.max(0, Math.ceil((view.deadlineAt - clock) / 1000))
    : 0;
  return (
    <main className="stream-overlay">
      <header>
        <strong>SPYFALL UNIVERSE</strong>
        <span>VUE SPECTATEUR · OBS</span>
      </header>
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <div className="stream-status">
            <h1>
              Manche {view.roundIndex}
              {view.rounds > 1 ? ` / ${view.rounds}` : ""}
            </h1>
            <span>
              {
                (
                  {
                    lobby: "Salle d’attente",
                    reveal: "Distribution des cartes",
                    discussion: "Discussion",
                    voting: "Vote",
                    spy_guess: "Dernière chance",
                    results: "Résultats",
                  } as const
                )[view.phase]
              }
            </span>
            <strong>
              {view.deadlineAt
                ? `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`
                : "—"}
            </strong>
          </div>
          {view.roomCode && <p>Salon {view.roomCode}</p>}
          <div className="stream-players">
            {view.players.map((player, i) => (
              <div key={i}>
                <strong>{player.nickname}</strong>
                <span>{player.score} pts</span>
              </div>
            ))}
          </div>
          <p>
            {view.spectators} spectateur{view.spectators > 1 ? "s" : ""}
            {view.phase === "voting"
              ? ` · ${view.voteCount}/${view.voterCount} votes reçus`
              : ""}
          </p>
          {view.phase === "results" && !view.result && (
            <p>
              Révélation différée ·{" "}
              {Math.max(
                0,
                Math.ceil(((view.revealAt ?? clock) - clock) / 1000),
              )}{" "}
              s
            </p>
          )}
          {view.result && (
            <section>
              <h2>
                {view.result.winner === "spies"
                  ? "Victoire des espions"
                  : "Victoire des innocents"}
              </h2>
              {view.result.word && <p>Mot : {view.result.word}</p>}
              {view.result.roles?.map((role, i) => (
                <p key={i}>
                  {role.nickname} ·{" "}
                  {role.role === "spy" ? "espion" : "innocent"} · +{role.points}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
