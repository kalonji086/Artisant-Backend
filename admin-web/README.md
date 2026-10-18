# ARTISANTS — Dashboard Admin Web

Application web d'administration de la plateforme **ARTISANTS** (Vite + React 19 + TypeScript + TailwindCSS v4).

## Prérequis

- Node.js ≥ 20
- Le backend `server/` accessible (API Express)
- Un compte Supabase avec le rôle `role = 'admin'` (voir plus bas)

## Démarrage

```bash
cd admin-web
cp .env.example .env   # puis renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_URL
npm install
npm run dev            # http://localhost:5173
```

Build de production :

```bash
npm run build          # tsc + vite build → dist/
npm run preview
```

## Créer un compte admin

1. Exécuter `supabase_migrations/001_admin_role.sql` dans le SQL Editor Supabase
   (autorise le rôle `admin` sur `profiles`).
2. Promouvoir un compte :

```sql
update public.profiles set role = 'admin' where id = '<uuid-utilisateur>';
```

3. Se connecter sur `/login` avec ce compte.

## Architecture

| Élément | Rôle |
|---|---|
| `src/context/AdminAuthContext` | Session Supabase + vérification du rôle admin |
| `src/lib/api.ts` | Client axios → `server/` (`/api/v1/admin/*`) avec jeton Bearer |
| `src/lib/supabase.ts` | Client Supabase (auth uniquement) |
| `src/pages/*` | Dashboard, Utilisateurs, Devis, Demandes employeur |
| `src/components/*` | Layout (sidebar/topbar), cartes KPI, graphiques, modales, tableaux |

Côté serveur : routes montées dans `server/src/api/admin.routes.ts` derrière
`authenticate` + `requireAdmin` (service-role Supabase).
