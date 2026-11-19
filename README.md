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
Les notifications système Android nécessitent aussi les identifiants FCM v1
configurés pour le projet Expo/EAS, ainsi qu’une nouvelle compilation Android
après toute modification de la configuration native.
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
La migration `030_guest_help_requests.sql` crée la table dédiée aux demandes
envoyées depuis le Centre d’aide sans connexion.
La migration `031_artisan_business_verification.sql` ajoute les demandes
uniques de vérification « Entreprise » ou « Sous-traitance », le stockage privé
des justificatifs, la revue Admin dans « Demandes employeur » et la diffusion
du statut vérifié sur la carte. Appliquer cette migration avant de déployer le
backend, l’Admin et l’application mobile. Une nouvelle compilation native de
l’application est nécessaire pour inclure le sélecteur de documents.
La migration `032_business_workspace.sql` dépend de la migration 031 et ajoute
l’espace entreprise : demandes et candidatures, projets et messagerie,
recherche/favoris d’artisans, contrats, suivi informatif des paiements, rapports
et invitations d’employés. Appliquer les migrations 031 puis 032 avant de
déployer le backend et l’application mobile. La migration
`033_in_app_business_contract_signatures.sql` ajoute la signature de contrats
dans ARTISANTS; l’appliquer après 032 et avant de déployer le backend ou
l’application mobile. Chaque signataire saisit le nom complet attendu et
confirme explicitement son accord. ARTISANTS conserve le compte, le nom, le
consentement et l’heure de signature; le PDF original n’est pas modifié. Cette
signature intégrée ne constitue pas une signature électronique qualifiée et
aucune clause juridique n’est générée. Les paiements ne sont ni encaissés ni
détenus par ARTISANTS.
La migration `034_business_module_access.sql` dépend de la migration 033.
Elle ajoute l’attribution granulaire des modules entreprise par l’Admin, leur
application dans les routes et politiques d’accès, ainsi que la révocation du
statut sans retirer le rôle artisan. Appliquer la migration 034 avant de
déployer le backend, l’Admin et l’application mobile. Les changements de droits
sont propagés au profil et au menu de l’application en temps réel.
La migration `035_login_security.sql` ajoute une temporisation progressive des
échecs de connexion, les alertes Admin en temps réel et le contrôle de
l’unicité des téléphones. À partir de trois échecs, l’alerte est consultable
dans le Centre de sécurité Admin (`/securite`), avec historique, blocage ou
déblocage du compte et clôture de l’alerte. L’Admin peut aussi retirer un
appareil des notifications push; cette action ne déconnecte pas ses sessions.
La liste des appareils utilise `push_devices` (migration 021); la migration
`037_push_device_revocations.sql` conserve les révocations même si l’application
réinscrit automatiquement le jeton. Appliquer 035 après 034 et 037 après 036,
avant de déployer le backend et l’Admin. Définir de préférence
`AUTH_ATTEMPT_HASH_SECRET` avec une clé aléatoire dédiée; à défaut, le backend
utilise la clé de service Supabase pour hacher les identifiants de limitation.
Le backend utilise `SUPABASE_ANON_KEY` pour relayer la connexion à Supabase Auth;
si elle n’est pas définie, il réutilise la clé publique `VITE_SUPABASE_ANON_KEY`
déjà configurée pour l’Admin web dans Render.
L’application exige 10 caractères pour un nouveau mot de passe; configurer
aussi la longueur minimale et la protection des mots de passe compromis dans
les paramètres Supabase Auth. Conserver les limites de débit natives de Supabase
Auth : la clé publique utilisée par l’application permet aussi des requêtes
directes au service Auth, en dehors du parcours de l’application.
Les e-mails et numéros déjà associés sont refusés avec une réponse générique,
sans indiquer le champ concerné. Le mot de passe est contrôlé localement pour
sa robustesse, mais n’est jamais comparé aux mots de passe d’autres comptes.

Les nouveaux contrats n’utilisent pas Yousign et ne nécessitent aucune clé
Yousign. Conserver `YOUSIGN_API_KEY`, `YOUSIGN_ENV` et
`YOUSIGN_WEBHOOK_SECRET` uniquement si des demandes Yousign antérieures sont
encore en cours; déclarer alors
`https://<domaine-api>/api/v1/webhooks/yousign` comme webhook avec le même
secret HMAC. Pour les employés,
`BREVO_API_KEY` doit être configurée pour envoyer les liens de connexion aux
comptes existants. Autoriser `artisant://business-invite` dans les URL de
redirection Supabase Auth; définir `BUSINESS_INVITE_REDIRECT_URL` uniquement si
une autre URL de retour est utilisée. Ne jamais placer ces secrets dans
l’application mobile ou dans le dépôt.

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
