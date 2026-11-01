-- Migration 009: Fix RLS policies for profiles table
-- Purpose: Allow service_role to insert profiles while keeping data secure for public users

begin;

-- Désactiver temporairement RLS pour corriger les politiques
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques conflictuelles
DROP POLICY IF EXISTS "Service role can access all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public users see non-admin profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profils visibles par tous" ON public.profiles;

-- Politique 1: Service role a un accès complet (bypass RLS)
CREATE POLICY "allow_service_role"
  ON public.profiles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Politique 2: Utilisateurs authentifiés voient leurs propres profils
CREATE POLICY "users_see_own_profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Politique 3: Utilisateurs publics/authentifiés voient les profils non-admin
CREATE POLICY "users_see_public_profiles"
  ON public.profiles
  FOR SELECT
  USING (role IS DISTINCT FROM 'admin');

commit;

notify pgrst, 'reload schema';
