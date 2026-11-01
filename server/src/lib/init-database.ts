import { logger } from './logger';

export interface TableCheck {
  name: string;
  description: string;
}

export const REQUIRED_TABLES: TableCheck[] = [
  { name: 'profiles', description: 'Profils utilisateurs' },
  { name: 'categories', description: 'Catégories de services' },
  { name: 'services', description: 'Services/Métiers disponibles' },
  { name: 'quotes', description: 'Devis (demandes de service)' },
  { name: 'employer_requests', description: 'Demandes d\'accès employeur' },
  { name: 'artisan_services', description: 'Services proposés par les artisans' },
  { name: 'platform_settings', description: 'Paramètres de la plateforme (admin)' },
];

export const SETUP_INSTRUCTIONS = `
═══════════════════════════════════════════════════════════════════════════════
📋 INSTRUCTIONS : CONFIGURATION DE LA BASE DE DONNÉES SUPABASE
═══════════════════════════════════════════════════════════════════════════════

Pour créer les tables manquantes, exécutez les commandes suivantes dans Supabase :

1. Ouvrez https://app.supabase.com/project/_/sql
2. Copiez-collez ce script SQL complet :

═══════════════════════════════════════════════════════════════════════════════
-- CRÉER LES TABLES REQUISES POUR ARTISANTS

-- Mise à jour de la contrainte de rôle sur profiles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('client', 'artisan', 'admin'));

-- Catégories de services
CREATE TABLE IF NOT EXISTS public.categories (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Services/Métiers disponibles
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

-- Devis (demandes de service)
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

-- Demandes d'accès employeur
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

-- Services proposés par les artisans
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

-- Paramètres de la plateforme (admin)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id bigserial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb,
  description text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone DEFAULT now()
);

═══════════════════════════════════════════════════════════════════════════════

3. Cliquez sur "RUN" (bouton bleu en haut à droite)
4. Vous devriez voir "executed successfully" ✓

═══════════════════════════════════════════════════════════════════════════════
`;

export async function logDatabaseSetupInstructions(): Promise<void> {
  logger.info(SETUP_INSTRUCTIONS);
}

export async function initializeDatabase(): Promise<void> {
  try {
    logger.info('🔍 Vérification de la configuration de la base de données...');
    logger.warn('⚠️  Le serveur a besoin que les tables Supabase soient créées manuellement.');
    logger.warn('Voir les instructions ci-dessous ou consultez le fichier SETUP.md');
    await logDatabaseSetupInstructions();
  } catch (err) {
    logger.error('Erreur lors de l\'initialisation de la base de données:', err);
  }
}
