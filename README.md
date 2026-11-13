# ARTISANTS — Backend, Admin et base de données

Le backend Express, le dashboard Admin et les migrations Supabase sont versionnés
ensemble sur la branche `main`. Le backend sert le dashboard sur `/admin/`.

## Configuration locale

Utiliser Node.js 22 ou une version plus récente pour le backend.

1. Ouvrir le fichier `.env.local` à la racine et remplacer tous les exemples par
   les valeurs de **ton projet Supabase de développement**.
2. Utiliser une clé `service_role` uniquement pour `SUPABASE_SERVICE_ROLE_KEY`.
   Pour `VITE_SUPABASE_ANON_KEY`, utiliser la clé publique `anon` ou
   `publishable` du même projet. Ne jamais mettre une clé privée dans une
   variable `VITE_`.
3. Renseigner un secret aléatoire pour `SUPABASE_WEBHOOK_SECRET` et ajouter
   l'origine du dashboard à `CORS_ORIGINS`.

`.env.local` est ignoré par Git. Ne pas y copier de secrets de production.

## Installation et lancement

Depuis la racine du dépôt :

```powershell
npm --prefix server ci
npm --prefix admin-web ci
npm --prefix server run dev
```

Dans un second terminal :

```powershell
npm --prefix admin-web run dev
```

L'API répond sur `http://localhost:3000/api/v1`, le dashboard de développement
sur `http://localhost:5173/admin/`, et le dashboard compilé est servi par
l'API sur `http://localhost:3000/admin/`.

## Vérifications et build

```powershell
npm --prefix server run build
npm --prefix admin-web run build
```

Le build Admin est généré dans `server/public/admin` et inclus dans le service
backend. Le pipeline GitHub Actions vérifie les builds du serveur et du
dashboard.

## Base de données

Appliquer les scripts de `supabase_migrations/` dans l'ordre numérique dans le
SQL Editor du projet Supabase avant de déployer le code qui en dépend.
`supabase_schema.sql` décrit le schéma principal.
Avant de déployer le verrouillage des connexions et la vérification des identifiants
d'inscription, appliquer aussi `supabase_migrations/037_auth_login_security.sql`
dans le SQL Editor Supabase. Trois échecs de mot de passe verrouillent le compte
pendant une heure; une nouvelle tentative pendant ce verrouillage porte le délai
à cinq heures.

## Abonnements artisan

Appliquer les migrations `038_artisan_portfolio_feed.sql` puis
`039_artisan_subscriptions.sql` dans le SQL Editor Supabase. Dans Google Play
Console, créer trois abonnements mensuels actifs, dans le même groupe, avec les
identifiants `artisants_pro_monthly`, `artisants_premium_monthly` et
`artisants_enterprise_monthly` (19, 30 et 100 $ US/mois). L’offre gratuite est
gérée par la base de données : 1 publication par mois; Pro permet 10 publications,
Premium et Entreprise sont illimités. Entreprise inclut le support 24/7.

Activer l’API Google Play Android Developer, donner au compte de service l’accès
à l’application, puis configurer `GOOGLE_PLAY_PACKAGE_NAME`,
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_RTDN_AUDIENCE` et
`GOOGLE_PLAY_RTDN_EMAIL` dans l’environnement du serveur (voir
`server/.env.example`). Configurer les notifications RTDN de Google Play vers
`/api/v1/subscriptions/google-play/notifications` avec un push Pub/Sub authentifié
OIDC et la même audience et adresse de service. Tester les achats avec une
version publiée sur une piste de test et un compte testeur Google Play.

L’application utilise `expo-iap`; les achats ne fonctionnent pas dans Expo Go.
Après l’ajout du module natif, reconstruire et redistribuer l’application Android
avec EAS avant de tester les achats.

## Créer le compte administrateur principal

Exécuter d'abord `supabase_migrations/001_admin_role.sql` dans le SQL Editor
du projet Supabase cible. Pour créer l'administrateur du projet de développement,
lancer depuis la racine :

```powershell
npm --prefix server run admin:create
```

Le script lit `.env.local`, demande l'email et le nom, puis saisit le mot de
passe sans l'afficher dans le terminal. Il crée le compte Auth s'il n'existe pas;
sinon il attribue le rôle admin au compte confirmé existant. Ne lancez pas ce
script avec les identifiants de production par défaut.

Pour cibler la production sans remplacer les identifiants locaux, créer
`.env.production.local` à la racine avec `SUPABASE_URL` et
`SUPABASE_SERVICE_ROLE_KEY` du projet de production, puis lancer :

```powershell
npm --prefix server run admin:create -- --env-file .env.production.local
```

Les fichiers `.env.*.local` sont ignorés par Git. Ne jamais publier ni partager
la clé `service_role`.

## Déploiement

Le dépôt de déploiement est `kalonji086/Artisant-Backend`, branche `main`.
La configuration Render se trouve dans `server/render.yaml`. Renseigner les
variables requises dans Render avec les valeurs du projet choisi; les clés
privées ne doivent jamais être ajoutées au dépôt GitHub.

## Surveillance de l'API

Le workflow `.github/workflows/monitor-api.yml` vérifie l'endpoint de santé de
production toutes les cinq minutes (GitHub Actions peut retarder une exécution
planifiée). Il envoie un e-mail via Brevo à `togethertechsupport@gmail.com`
lorsque l'API devient indisponible, puis à son retour. L'état est mémorisé dans
le cache Actions pour éviter les alertes répétées pendant une même panne.

Dans **Settings → Secrets and variables → Actions** du dépôt GitHub, ajouter le
secret `BREVO_API_KEY` et la variable `BREVO_SENDER_EMAIL` avec une adresse
d'expéditeur vérifiée dans Brevo. La variable `MONITOR_URL` est facultative; par
défaut, le workflow surveille
`https://artisant-backend.onrender.com/api/v1/health`. Le workflow a besoin des
permissions Actions par défaut en lecture du dépôt. Il peut aussi être lancé
manuellement depuis l'onglet **Actions**.
