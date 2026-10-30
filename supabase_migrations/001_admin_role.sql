-- ====================================================================
-- MIGRATION 001 : Rôle 'admin' pour le Dashboard Admin Web
-- À exécuter dans le SQL Editor de Supabase AVANT d'utiliser admin-web.
-- ====================================================================

-- 1. Étendre la contrainte CHECK du rôle sur profiles
--    (le schéma initial n'autorisait que 'client' et 'artisan',
--     mais les politiques RLS utilisent déjà role = 'admin')
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('client', 'artisan', 'admin'));

-- 2. Promotion d'un compte existant en admin (remplacer l'UUID) :
-- update public.profiles set role = 'admin' where id = '<uuid-utilisateur>';
