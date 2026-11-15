# projectX — Spyfall Universe V2

Jeu de déduction en français pour **3 à 12 participants**, avec jusqu’à **50 spectateurs**, chat temps réel et vocal Discord externe. React/Vite/Tailwind, Fastify/Socket.IO, TypeScript et PostgreSQL/Prisma facultatif.

La [comparaison détaillée V1 → V2](docs/COMPARAISON_V2.md) reprend chaque exigence de l’annexe du PDF, les changements, les décisions et les limites. La V2 prolonge le code de la branche `spyfall/mvp` ; elle ne nécessite aucun service Sites et n’effectue aucun déploiement public.

## Lancer en invité, sans infrastructure

Prérequis : **Node.js 22.19+**, Corepack, pnpm 11.25.0.

```sh
corepack enable
pnpm install
pnpm db:generate
pnpm dev
```

Interface : <http://localhost:5173> ; API de santé : <http://localhost:3001/api/health>.

Ouvrir trois profils de navigateur distincts, choisir trois pseudos, créer un salon et partager son code/lien. Tous les participants doivent se déclarer prêts avant le lancement. Les onglets du même profil partagent la session et une seule connexion par identité est autorisée. Sans base de données, les comptes sont explicitement indisponibles et la bibliothèque privée fonctionne **en mémoire**.

Le serveur charge `.env` à la racine s’il existe. Vite relaie `/api` et `/socket.io` ; aucun secret de base de données ni banque de mots n’est embarqué dans le client.

## PostgreSQL : installation neuve

```sh
docker compose -f infra/docker-compose.yml up -d --wait
cp .env.example .env
```

Décommenter dans `.env` :

```dotenv
DATABASE_URL=postgresql://spyfall:spyfall_local@localhost:5432/spyfall
```

Puis :

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Les migrations initialisent le schéma V1 puis ajoutent les champs et la bibliothèque V2. Le seed charge les 300 mots officiels avec leurs sous-catégories, difficultés et variantes.

### Mettre à jour une base V1 existante

La V1 utilisait `db:push`, sans historique de migrations. Sauvegarder la base et vérifier qu’elle correspond bien au schéma V1 du commit `62ace0a` avant d’enregistrer cette baseline :

```sh
pnpm db:baseline
pnpm db:migrate
pnpm db:generate
pnpm db:seed
```

`db:baseline` marque uniquement le schéma initial comme déjà appliqué ; il ne doit être exécuté **qu’une fois sur une base V1 existante**, jamais sur une base vide. La migration V2 est additive : champs `Word.subcategory`, `Word.variants` et table `LibraryItem`. `db:push` reste disponible pour des bases de développement jetables ; les déploiements utilisent les migrations versionnées.

## Jeu, filtres et règles avancées

- Créer/rejoindre un salon privé par code cryptographique de huit caractères ou lien. L’hôte peut expulser au lobby ; le rôle d’hôte est transféré automatiquement en cas de départ/déconnexion.
- Durée de discussion : 3/5/7/10 min. Un, deux ou trois espions nécessitent respectivement 3, 6 ou 9 participants. Les espions ne se connaissent pas.
- Six catégories officielles, sous-catégories activables individuellement, trois difficultés. Chaque participant déclare ses univers connus : le serveur croise ces connaissances avec les règles du salon. Aucune case de connaissances = aucune restriction individuelle. Le compteur indique le nombre de mots compatibles et inédits, y compris pendant la préparation des réglages.
- Les règles choisies sont visibles de tous avant le lancement. Une modification remet les statuts prêts à zéro.
- Révélation : 15 s ; discussion : durée choisie ; vote : 45 s ; tentative de l’espion identifié : 30 s. Les échéances et transitions sont imposées par le serveur. L’hôte peut avancer la révélation et la discussion.
- Un vote définitif par joueur actif et par bulletin, y compris pour soi-même. Égalité : second tour entre ex æquo ; seconde égalité ou aucun suffrage : victoire des espions. Accuser un innocent donne aussi la victoire aux espions. Les choix restent cachés en mode anonyme et sont affichés pendant le scrutin en mode public.
- Un espion identifié peut deviner le mot une seule fois. Casse, accents et ponctuation sont ignorés ; les variantes explicites sont acceptées, pas les sous-chaînes. Une mauvaise réponse élimine cet espion ; s’il en reste d’autres, un nouveau vote commence.
- Option « passage de mot » : une fois par manche, uniquement pendant la révélation et par l’hôte. Le mot change, **les rôles restent identiques**. Le mot écarté est consommé par l’anti-répétition.
- Aucun mot ni variante déjà tiré ne revient avant épuisement du vivier compatible. À épuisement, le serveur bloque le démarrage et l’interface propose de réinitialiser l’historique des mots ou d’élargir les filtres. Aucun recyclage automatique.
- Le chat est du texte brut : 300 caractères, 3 messages/5 s, HTML et contrôles invalides rejetés. Il ferme pendant révélation, vote et tentative. Vocal : lien d’invitation Discord facultatif, sans WebRTC.

**Scores :** innocent gagnant +100 ; espion survivant après l’échec des votes +200 ; espion qui devine +150. Dans ce dernier cas, seul l’espion ayant deviné gagne des points. Un espion éliminé ne reçoit pas de points de survie. L’équipe gagnante est néanmoins comptée comme victorieuse pour ses deux espions dans les statistiques. Aucun bonus de participation.

### Spectateurs et reconnexion

Cocher « Rejoindre comme spectateur » permet d’entrer pendant une manche. Participants et spectateurs sont séparés dans l’interface. Un spectateur ne reçoit aucun rôle ni mot secret, ne vote pas et ne peut pas écrire pendant une manche. Il peut réserver une place pour la prochaine manche, sous réserve des douze places, ou devenir participant immédiatement au lobby. Les résultats terminés sont publics pour les spectateurs ordinaires.

L’identité invitée utilise un jeton de 256 bits, stocké localement dans le navigateur et haché côté serveur. Actualiser restaure identité, rôle, score et vote. Une déconnexion conserve la place et les votes pendant 60 s ; la minuterie de la manche continue. Après ce délai, le joueur est retiré. Moins de trois participants restants met fin à la manche en faveur des espions : règle de forfait héritée de la V1. L’hôte passe immédiatement à un joueur connecté disponible.

### Séries, tournois et presets

Choisir « manches libres », une série de 2 à 10 manches ou un tournoi de 5 à 10 manches. Le classement cumule les points ; le podium final et l’historique indiquent les gagnants, rôles et gains. Les joueurs partis restent au classement de la série. À égalité : score, victoires puis pseudo.

Les règles sont fixes après la première manche d’une série ; les connaissances d’un joueur sont fixes après sa première participation. L’hôte revient au lobby entre les manches ; les participants se redéclarent prêts. Après la dernière, un nouveau démarrage exige une remise à zéro explicite. « Relancer une série » remet scores, progression et historique du salon à zéro sans effacer les résultats du compte. Les identifiants des manches restent uniques et croissants.

L’hôte peut sauvegarder ses réglages dans un preset personnel, l’appliquer dans un autre salon et le supprimer. Les packs du preset doivent encore exister et être accessibles à son propriétaire ; ils sont attachés avant application. Sans PostgreSQL, presets et packs sont disponibles jusqu’au redémarrage du serveur, avec une identité de bibliothèque invitée distincte de la session de salon.

## Packs privés et communautaires

Ouvrir **Bibliothèque** dans l’en-tête :

1. Créer un pack, définir son nom et sa description, puis ajouter les mots, catégories, sous-catégories, difficultés et variantes.
2. Prévisualiser ou importer/exporter en JSON. L’import charge l’éditeur ; il ne publie rien automatiquement. Le serveur valide également chaque sauvegarde.
3. Enregistrer le pack privé puis, dans les règles du salon, l’attacher depuis la bibliothèque. L’attachement sélectionne le pack et ses catégories ; on peut ensuite le décocher ou exclure la banque officielle. Les copies déjà attachées sont figées par révision.
4. Pour une publication communautaire, choisir « Proposer à la communauté ». Le pack reste en attente, absent du catalogue commun, jusqu’à décision d’un modérateur.

Format JSON version 1, maximum 1000 mots et 500 Ko par requête :

```json
{
  "version": 1,
  "name": "Astronomie",
  "description": "Les astres familiers",
  "words": [
    {
      "label": "Soleil",
      "category": "Astronomie",
      "subcategory": "Étoiles",
      "difficulty": "easy",
      "variants": ["Sun"]
    }
  ]
}
```

Les difficultés sont `easy`, `medium`, `hard`. Champs inconnus, HTML, mots vides, doublons et variantes ambiguës sont refusés. Jusqu’à 50 éléments de bibliothèque par propriétaire, dix packs attachés par salon. Les catégories personnalisées ne modifient pas les catégories officielles.

### Modération

Activer PostgreSQL et définir `ADMIN_EMAILS` dans `.env`, avec les adresses des comptes de modération séparées par des virgules. Redémarrer le serveur, puis se connecter avec un de ces comptes. La bibliothèque affiche la file de modération avec le contenu à relire, puis les actions Valider/Refuser. Une adresse envoyée par le client ne confère aucun droit.

La décision porte sur la révision affichée : une édition intervenue entre relecture et validation fait échouer l’approbation. Une modification d’un pack public le retire du catalogue et le remet en attente. Les propriétaires peuvent supprimer leurs packs ; les copies déjà attachées aux salons ne sont pas remplacées silencieusement. Aucun pack public proposé n’est automatiquement validé en mode invité sans base.

## Mode streamer / OBS

L’hôte règle le délai (0–120 s, 15 s par défaut) et la confidentialité, enregistre, puis copie un nouveau lien OBS. Ajouter ce lien comme source navigateur dans OBS ou l’ouvrir dans un navigateur.

- Vue minimale : minuterie synchronisée, manche, joueurs, scores et nombre de votes reçus ; pas de chat, carte personnelle ni commandes de jeu.
- Connexion en lecture seule avec un jeton de 256 bits distinct d’une session de joueur. Un nouveau lien révoque le précédent. Le jeton est placé dans le fragment `#overlay=…`, qui n’est pas envoyé au serveur lors de la navigation HTTP.
- Résultats et gains restent côté serveur jusqu’à l’échéance du délai, même si l’hôte revient au lobby. Les mots/rôles ne sont jamais affichés pendant une manche active.
- Confidentialité activée par défaut : le code, le mot et les rôles restent masqués, y compris après le délai. Si elle est désactivée, le code est visible et le mot/les rôles peuvent apparaître aux résultats après le délai. Les noms de joueurs et leurs scores restent visibles.
- Pour prendre une place dans une partie, utiliser l’entrée spectateur normale : le lien OBS ne permet pas de participer.

## Comptes et confidentialité

Comptes facultatifs : Argon2id, cookies HttpOnly/SameSite=Strict (Secure en production), déconnexion et suppression. L’espace compte montre les points, victoires, rôles et résultats des 100 dernières manches conservées. L’association du compte au joueur a lieu en créant/rejoignant le salon, sans rattachement rétroactif d’une ancienne session invitée.

Résultats et scores sont persistés dans une transaction et une seule fois par manche/joueur. Les erreurs de sauvegarde sont journalisées et retentées tant que le salon conserve le résultat courant. Les secrets sont calculés côté serveur, les cartes envoyées seulement à leur propriétaire ; l’état public contient des champs explicitement autorisés.

Messages : 100 derniers en mémoire, aucun archivage. Salons inactifs : une heure. Sessions de compte : sept jours. Résultats PostgreSQL : 30 jours, purge horaire. Bibliothèque invitée : cookie de 30 jours ; éléments supprimés après 30 jours sans modification. Bibliothèque de compte : jusqu’à suppression de l’élément ou du compte. La suppression du compte retire son e-mail, mot de passe, sessions et bibliothèque ; les résultats pseudonymisés expirent selon la conservation normale.

## Vérifier

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Avec une base de test initialisée par les migrations :

```sh
TEST_DATABASE_URL=postgresql://spyfall:spyfall_local@localhost:5432/spyfall pnpm test
```

Sans cette variable, les deux tests PostgreSQL sont ignorés. Ils créent des comptes avec adresses UUID et nettoient leurs données. Le reste vérifie le moteur et de vraies connexions Socket.IO à 3/6/12 clients, le parcours V1, les filtres, variantes, passages, votes, spectateurs, tournois, presets, packs, autorisations, modération des révisions et délai OBS. La CI prépare PostgreSQL avec les migrations et exécute les contrôles.

### Recette manuelle avant ouverture publique

Utiliser trois profils distincts : créer/rejoindre, préparer les filtres, vérifier les compteurs et les cartes, discuter, voter, tenter une variante, consulter les résultats et rejouer. Tester aussi un spectateur, sa réservation et sa reconnexion, le mode trois espions à neuf participants, un tournoi complet puis son reset. Importer un pack privé, l’utiliser dans un salon, le soumettre, le modérer avec un autre compte, puis modifier sa révision et vérifier le retrait du catalogue. Ouvrir le lien OBS dans une quatrième fenêtre et vérifier délai, confidentialité et révocation.

Vérifier au clavier et à **360 px**, ainsi que dans une vraie source navigateur OBS. Les tests réseau et le build ne constituent pas des tests visuels de navigateur : cette recette reste à effectuer dans l’environnement cible.

## Exécuter le build et configurer l’hébergement

```sh
pnpm build
CLIENT_ORIGIN=http://localhost:3001 pnpm start
```

Le serveur sert le build React depuis `apps/web/dist` sur <http://localhost:3001>. Installer également les dépendances de développement sur l’hôte : le serveur utilise `tsx`. Une instance publique nécessite un reverse proxy HTTPS/WSS relayant `/socket.io`, une origine autorisée exacte et des cookies Secure. Aucun hébergement n’est configuré automatiquement.

| Variable            | Défaut                  | Rôle                                                                  |
| ------------------- | ----------------------- | --------------------------------------------------------------------- |
| `PORT`              | `3001`                  | Port HTTP et Socket.IO                                                |
| `CLIENT_ORIGIN`     | `http://localhost:5173` | Origine autorisée avec protocole/port                                 |
| `DATABASE_URL`      | absente                 | Comptes, résultats, bibliothèque PostgreSQL                           |
| `ADMIN_EMAILS`      | vide                    | Comptes autorisés à modérer les packs                                 |
| `NODE_ENV`          | développement           | `production` active les cookies Secure                                |
| `TRUST_PROXY`       | `false`                 | Seulement derrière un proxy de confiance sans accès direct au serveur |
| `TEST_DATABASE_URL` | absente                 | Active les tests PostgreSQL                                           |

## Structure et limites

- `apps/server/src/engine.ts` : moteur, phases, secrets, tirage, filtres, scores, spectateurs, séries et projection OBS.
- `apps/server/src/server.ts` : Fastify, Socket.IO, comptes et sauvegarde des résultats.
- `apps/server/src/library.ts` : bibliothèque, presets, contrôle de propriété et modération par révision.
- `apps/web/src/main.tsx` : parcours de jeu ; `v2.tsx` : réglages, bibliothèque, connaissances, classements et overlay.
- `packages/shared` : types publics et schémas Zod ; `data` : banque de mots ; `prisma` : schéma, migrations et seed.

Les salons actifs et les liens OBS restent **en mémoire, sur une seule instance** : un redémarrage les perd. PostgreSQL conserve comptes, bibliothèque et résultats terminés, sans restaurer une manche active. Prévoir Redis, reprise, sauvegardes et monitoring avant montée en charge. Sans base, la bibliothèque disparaît aussi au redémarrage.

La banque de 300 mots, ses sous-catégories et ses variantes demandent une relecture éditoriale humaine avant ouverture publique. La recette visuelle multi-navigateurs et OBS n’est pas automatisée dans cette livraison. Le signalement/modération du chat, récupération de mot de passe, vérification d’e-mail, export RGPD de compte, modes infiltré/chaos et création de succès restent hors des fonctionnalités livrées. Adapter les mentions légales à l’exploitant ; les identifiants Docker sont uniquement locaux.
