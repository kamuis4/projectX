# projectX — Spyfall Universe

Jeu web de déduction en français pour **3 à 12 joueurs**, réalisé à partir du cahier des charges Spyfall Universe (15 novembre 2026). Un mot pour les innocents, une catégorie pour les espions. Ce dépôt fournit un client React et un véritable serveur multijoueur Socket.IO.

## Démarrer sans infrastructure

Prérequis : **Node.js 22.19+**, Corepack et pnpm 11.25.0. Depuis la racine du dépôt :

```sh
corepack enable
pnpm install
pnpm db:generate
pnpm dev
```

- Interface : <http://localhost:5173>
- Serveur : <http://localhost:3001/api/health>
- Aucun compte ni base de données n’est nécessaire pour jouer en invité.
- Ouvrir trois **profils de navigateur distincts** (ou des navigateurs différents), choisir trois pseudos, créer un salon et partager son code/lien. Tous les joueurs doivent se déclarer prêts. Les onglets d’un même profil partagent la session ; un nouvel onglet remplace la connexion précédente.
- Les comptes sont explicitement indisponibles tant que `DATABASE_URL` n’est pas configuré. Les boutons de jeu restent fonctionnels.

Le serveur charge automatiquement le fichier `.env` à la racine s’il existe. Vite relaie `/api` et `/socket.io` vers le serveur ; aucun secret ni URL de base de données ne va dans le client.

## Activer les comptes et la sauvegarde PostgreSQL

```sh
docker compose -f infra/docker-compose.yml up -d --wait
cp .env.example .env
```

Décommenter cette ligne dans `.env` :

```dotenv
DATABASE_URL=postgresql://spyfall:spyfall_local@localhost:5432/spyfall
```

Puis :

```sh
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

`db:push` convient à l’initialisation de cette V1. Pour une base de production existante, préparer et relire des migrations versionnées avant de modifier le schéma.

Inscription et connexion facultatives, mots de passe Argon2id, cookies HttpOnly/SameSite=Strict (Secure en production), déconnexion, consultation des statistiques récentes et suppression de compte. Les comptes sont associés aux joueurs **au moment de créer ou rejoindre** un salon : se connecter en cours de partie ne rattache pas rétroactivement une session invitée.

Les résultats terminés, rôles et scores sont enregistrés dans une transaction, avec une clé unique par manche/joueur et une opération idempotente par manche. Une erreur de sauvegarde est journalisée et retentée tant que le salon conserve ces résultats. Le score en cours de session est toujours calculé côté serveur.

## Parcours de jeu

1. L’hôte crée un salon privé ; les amis rejoignent par code aléatoire de huit caractères (40 bits) ou lien.
2. L’hôte règle les catégories, la difficulté, la durée (3/5/7/10 min), le mode et un éventuel lien d’invitation Discord.
3. Tous se déclarent prêts ; démarrage à partir de 3 joueurs connectés (6 pour le double espion). Modifier les paramètres remet les statuts prêts à zéro.
4. Révélation pendant 15 s. Chaque joueur affiche/masque sa carte personnelle ; seuls les innocents reçoivent le mot. L’hôte peut avancer cette phase.
5. Discussion au chat ou sur Discord. Le serveur fixe l’échéance. L’hôte peut avancer au vote.
6. Vote définitif, y compris pour soi-même, pendant 45 s maximum. Un vote par joueur actif et par bulletin. Égalité : second tour restreint aux ex æquo ; seconde égalité ou absence de suffrage : victoire des espions. L’accusation d’un innocent donne aussi la victoire aux espions.
7. Un espion identifié dispose de 30 s et d’une seule proposition ; le chat est suspendu. Accents, ponctuation et casse sont ignorés, mais aucune correspondance partielle n’est acceptée. En double espion, une mauvaise réponse élimine cet espion puis lance un nouveau vote pour chercher l’autre. Les espions ne reçoivent pas l’identité de leur partenaire.
8. Résultats : mot, rôles, gains et scores cumulés du salon. L’hôte retourne au lobby pour une revanche ; les identités et scores sont conservés.

**Scores :** innocent gagnant +100 ; espion survivant après l’échec des votes +200 ; espion ayant retrouvé le mot +150. Si un espion devine le mot, seul ce joueur gagne les 150 points ; son partenaire ne reçoit pas de bonus. Un espion déjà éliminé ne gagne pas de points de survie. Aucun bonus de participation.

### Connexion et départs

La session invitée contient un jeton aléatoire de 256 bits ; le serveur n’en conserve que le SHA-256. Actualiser restaure l’identité, le rôle, le vote et le score. Le jeton reste dans le stockage local du navigateur : ne pas le partager. Une seule connexion active par identité.

L’hôte est transféré immédiatement au premier joueur connecté disponible. Un joueur déconnecté conserve son vote et sa place pendant **60 s**. La minuterie de vote de 45 s continue de courir pendant cette fenêtre : elle n’est pas prolongée par une déconnexion. Une tentative d’espion arrivée à échéance est une mauvaise réponse. Après 60 s, le joueur est retiré ; les votes déjà reçus restent enregistrés. Une manche avec moins de 3 participants restants s’arrête en faveur des espions ; c’est une règle de forfait de cette implémentation. Les joueurs partis n’ont pas la possibilité de rejoindre sous une nouvelle identité en cours de manche. L’expulsion est réservée à l’hôte, dans le lobby.

## Vérifier

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Tests unitaires : contraintes de joueurs, autorisations, confidentialité des cartes et de l’état public, minuteurs, double espion, égalités, votes uniques, scores idempotents, reconnexion, transfert d’hôte, nettoyage, validation du chat et cohérence de la banque de mots.

Tests d’intégration **sur de vraies connexions Socket.IO** : parcours à 3, 6 et 12 clients, création/rejoindre/chat/vote/résultats/revanche, restauration de session, usurpation refusée, spam et démarrages simultanés. Ce ne sont pas des tests de navigateur.

Test PostgreSQL (base de test uniquement ; les comptes de test ont un e-mail UUID et sont nettoyés) :

```sh
TEST_DATABASE_URL=postgresql://spyfall:spyfall_local@localhost:5432/spyfall pnpm test
```

Il vérifie inscription, Argon2id, cookies, connexion, association du compte au salon, sauvegarde des résultats et suppression du compte. Il est ignoré sans cette variable. La CI prépare PostgreSQL et exécute l’ensemble.

### Recette manuelle dans les navigateurs

- Trois profils distincts : créer/rejoindre le même salon, prêts, démarrage et cartes ; vérifier que deux innocents partagent un mot et que l’espion n’a que la catégorie.
- Recharger pendant la discussion et pendant le vote : identité/rôle inchangés et vote non répétable.
- Chat instantané, HTML refusé, quatrième message en moins de 5 s refusé ; chat indisponible pendant vote/dernière chance.
- Provoquer une égalité, une dernière chance et une victoire des innocents ; vérifier le tableau de scores puis rejouer.
- À six profils, tester les deux espions successivement. Fermer le profil hôte : transfert immédiat ; revenir avant/après 60 s.
- Vérifier au clavier et à **360 px** : formulaires, paramètres, carte, vote et chat. Tester le lien Discord sur une vraie invitation.

La compilation et les tests réseau ne remplacent pas cette recette visuelle multi-navigateurs. Aucune validation visuelle automatisée n’est revendiquée dans cette livraison.

## Exécuter le build

```sh
pnpm build
CLIENT_ORIGIN=http://localhost:3001 pnpm start
```

Le serveur sert le build React depuis `apps/web/dist` sur <http://localhost:3001>. Installer aussi les dépendances de développement sur le serveur : le processus Node utilise `tsx` pour exécuter TypeScript. Pour une installation neuve : `pnpm install --frozen-lockfile`, `pnpm db:generate`, puis les commandes ci-dessus.

Pour une instance publique : définir `NODE_ENV=production`, `CLIENT_ORIGIN=https://votre-domaine.example`, `PORT`, et éventuellement `DATABASE_URL`. Placer Node derrière un reverse proxy HTTPS qui relaie les WebSockets (`/socket.io`). N’activer `TRUST_PROXY=true` que si le réseau empêche un accès direct au serveur et que le proxy est maîtrisé. L’origine est restreinte à une valeur ; aucun CORS `*`.

| Variable            | Défaut                  | Rôle                                                |
| ------------------- | ----------------------- | --------------------------------------------------- |
| `PORT`              | `3001`                  | Port HTTP/Socket.IO                                 |
| `CLIENT_ORIGIN`     | `http://localhost:5173` | Origine autorisée, avec protocole et port           |
| `DATABASE_URL`      | absente                 | Comptes et résultats PostgreSQL, facultatifs        |
| `NODE_ENV`          | développement           | Cookies Secure si `production`                      |
| `TRUST_PROXY`       | `false`                 | À activer uniquement derrière un proxy de confiance |
| `TEST_DATABASE_URL` | absente                 | Active le test d’intégration PostgreSQL             |

## Architecture et confidentialité

- `apps/web` : React, Vite, Tailwind CSS, interface française responsive. Aucun mot de la banque n’est embarqué dans le bundle.
- `apps/server/src/engine.ts` : moteur testable, phases, rôles, votes, minuterie et scores.
- `apps/server/src/server.ts` : Fastify, Socket.IO, validation, autorisations, comptes et sauvegarde transactionnelle.
- `packages/shared` : types publics, événements et schémas Zod. Toutes les commandes reçoivent un accusé explicite.
- `data/words.fr.json` : 300 entrées éditoriales, 50 par catégorie, sans doublons normalisés, trois difficultés. Les mots sont tirés côté serveur avec un générateur cryptographique ; pas de répétition dans le salon tant que la sélection n’est pas épuisée.
- `prisma` : schéma PostgreSQL et seed idempotent ; `infra` : Docker Compose local.

L’état public est construit avec une liste de champs autorisés. Il ne contient jamais la banque, le mot ni les rôles de tous les joueurs avant les résultats. Les cartes privées vont uniquement à la socket de leur propriétaire. Le serveur utilise des échéances absolues ; le client corrige son horloge à partir de l’heure serveur.

Chat : texte brut rendu par React, 300 caractères, HTML et contrôles invalides rejetés, 3 messages/5 s ; plafond général de 40 commandes/socket/10 s. Les requêtes HTTP et les tentatives d’authentification sont aussi limitées. Payloads de 16 Ko maximum.

Données : messages limités aux 100 derniers en mémoire, non archivés. Salons inactifs purgés après une heure, identités invitées supprimées avec le salon. Sessions de compte : 7 jours. Résultats PostgreSQL : 30 jours, purge horaire. La suppression de compte retire l’e-mail, le mot de passe et les sessions ; les résultats pseudonymisés restent jusqu’à leur expiration. Les statistiques couvrent les 100 dernières manches conservées.

## Limites avant ouverture publique

- **Serveur unique, salons en mémoire.** Un redémarrage perd les salons actifs, les sessions invitées et leurs scores de salon. PostgreSQL conserve les comptes et les résultats terminés, pas la restauration d’une manche active. Redis et une stratégie de reprise sont nécessaires avant plusieurs instances.
- La banque contient 300 propositions structurées et contrôlées automatiquement pour les doublons ; elle exige encore une **relecture humaine** des libellés, difficultés et ambiguïtés avant lancement public.
- Recette visuelle et tests E2E dans des navigateurs réels à effectuer ; les tests fournis couvrent le moteur, HTTP, PostgreSQL et les sockets.
- Pas de signalement/modération des messages ni d’administration, de récupération de mot de passe, de vérification d’e-mail ou d’export des données. Prévoir ces outils et les mentions RGPD adaptées à l’exploitant avant ouverture publique.
- Pas de Redis, monitoring de production, sauvegardes PostgreSQL automatisées ou déploiement public configuré. Les identifiants Docker sont exclusivement locaux.
- Les modes infiltré/chaos/tournoi, succès, catégories communautaires et filtres personnels restent hors V1. Aucun vocal hébergé : Discord externe uniquement.
