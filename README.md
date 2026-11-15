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
La migration `019_account_deletion_requests.sql` crée la file des demandes de
suppression visible dans l'administration. La récupération du mot de passe
mobile génère un code OTP de 8 chiffres avec Supabase Auth puis l'envoie via le
service Brevo existant du backend; aucun modèle SMTP Supabase n'est utilisé.
Le réglage « Email OTP length » de Supabase Auth doit être configuré sur 8.
La migration `020_app_preferences_and_notifications.sql` active les préférences
de compte synchronisées et les notifications mobiles temps réel.
La migration `021_push_notifications.sql` crée l’enregistrement privé des
appareils et migre les anciens jetons. Après son exécution, configurer dans
Supabase un Database Webhook `INSERT` sur `public.app_notifications`, vers
`https://artisant-backend.onrender.com/api/v1/webhooks/supabase`, avec l’en-tête
`x-webhook-secret` identique à `SUPABASE_WEBHOOK_SECRET` du serveur.
La migration `022_legal_realtime.sql` autorise l’écoute sécurisée des mises à
jour des documents légaux; l’application affiche directement les pages Web
publiques et les recharge lorsqu’un administrateur publie une modification.
La migration `023_app_notification_kind.sql` ajoute la colonne de type aux
notifications existantes et répare leur compatibilité avec l’application.
La migration `024_live_artisan_location_updates.sql` synchronise les distances
de la carte sans exposer les coordonnées GPS dans les événements Realtime.
La migration `025_artisan_map_profiles_and_avatars.sql` crée le stockage public
des photos (écriture réservée à l’artisan propriétaire), puis fournit aux seuls
clients les détails sélectionnés pour la fiche artisan. Elle envoie également
un signal Realtime sans données personnelles lorsqu’un de ces détails change.
Les photos sélectionnées avant la confirmation du compte sont téléversées lors
de la première connexion. Après l’application de cette migration, reconstruire
le binaire Android pour inclure le sélecteur de photos natif. L’écran Admin
« Utilisateurs » affiche les données du profil et les détails d’inscription;
les mots de passe et leur confirmation ne sont jamais transmis à l’Admin.
Sur mobile, les identifiants ne sont pas mémorisés et le formulaire de connexion
reste vide après déconnexion.
Pour Android, configurer les identifiants FCM v1 avec
`npx eas-cli@latest credentials --platform android`, puis reconstruire
l’application avec `npx eas-cli@latest build --platform android --profile production`.
Les notifications push nécessitent un nouveau binaire natif; elles ne fonctionnent
pas dans l’ancienne version installée.

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
