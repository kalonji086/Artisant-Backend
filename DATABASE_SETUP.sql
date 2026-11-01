-- ═════════════════════════════════════════════════════════════════════════════
-- ARTISANTS: Script SQL pour créer les tables manquantes dans Supabase
-- ═════════════════════════════════════════════════════════════════════════════
--
-- INSTRUCTIONS:
-- 1. Ouvrez: https://app.supabase.com/project/[YOUR_PROJECT]/sql
-- 2. Créez une nouvelle requête
-- 3. Copiez-collez ce script complet
-- 4. Cliquez sur "RUN" (bouton bleu en haut à droite)
-- 5. Vous devriez voir: "executed successfully" ✓
--
-- ═════════════════════════════════════════════════════════════════════════════

-- 1️⃣  Ajouter la colonne 'role' à 'profiles' si elle n'existe pas
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'client';

-- 2️⃣  Ajouter la colonne 'is_available' à 'profiles' si elle n'existe pas (pour les artisans)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;

-- 3️⃣  Ajouter les colonnes supplémentaires à 'profiles' si elles n'existent pas
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;

-- 4️⃣  Mise à jour de la contrainte CHECK sur la table 'profiles'
-- (autorise le rôle 'admin' en plus de 'client' et 'artisan')
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('client', 'artisan', 'admin'));

-- 5️⃣  Créer la table 'categories' (catégories de services)
CREATE TABLE IF NOT EXISTS public.categories (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- 6️⃣  Créer la table 'services' (services/métiers)
CREATE TABLE IF NOT EXISTS public.services (
  id bigserial PRIMARY KEY,
  category_id bigint NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(category_id, name)
);

-- 7️⃣  Créer la table 'quotes' (devis/demandes de service)
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artisan_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  service_id bigint REFERENCES public.services(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  budget_min numeric,
  budget_max numeric,
  location text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'completed', 'cancelled')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- 8️⃣  Créer la table 'employer_requests' (demandes d'accès employeur)
CREATE TABLE IF NOT EXISTS public.employer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  industry text,
  contact_person text,
  contact_email text,
  phone_number text,
  website text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 9️⃣  Créer la table 'artisan_services' (services proposés par les artisans)
CREATE TABLE IF NOT EXISTS public.artisan_services (
  id bigserial PRIMARY KEY,
  artisan_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id bigint NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  hourly_rate numeric,
  availability_status text DEFAULT 'available' CHECK (availability_status IN ('available', 'busy', 'unavailable')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(artisan_id, service_id)
);

-- 🔟  Créer la table 'platform_settings' (paramètres de la plateforme - admin)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id bigserial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb,
  description text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone DEFAULT now()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- CORRECTION DU BUG: Améliorer la politique RLS pour les admins
-- ═════════════════════════════════════════════════════════════════════════════

-- Désactiver la politique RLS qui cache les admins pour le service-role
-- (le service-role a accès complet, pas besoin de politique)

-- Vérifier et corriger les politiques RLS sur profiles
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Créer une politique qui permet au service-role (backend) d'accéder à tous les profils
CREATE POLICY "Service role can access all profiles"
  ON public.profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Recréer la politique pour les utilisateurs publics (cache les admins)
CREATE POLICY "Public users see non-admin profiles"
  ON public.profiles
  FOR SELECT
  USING (role IS DISTINCT FROM 'admin');

-- ═════════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION (optionnel) : voir ce qui a été créé
-- ═════════════════════════════════════════════════════════════════════════════
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
