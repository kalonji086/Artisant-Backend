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

## Déploiement

Le dépôt de déploiement est `kalonji086/Artisant-Backend`, branche `main`.
La configuration Render se trouve dans `server/render.yaml`. Renseigner les
variables requises dans Render avec les valeurs du projet choisi; les clés
privées ne doivent jamais être ajoutées au dépôt GitHub.
