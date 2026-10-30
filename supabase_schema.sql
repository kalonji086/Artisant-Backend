-- 1. Installer PostGIS hors du schéma exposé par la Data API.
-- Sur un projet existant, IF NOT EXISTS ne déplace pas une extension déjà installée.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- 2. Table des Profils (Étendu)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone,
  full_name text,
  phone text,
  role text check (role in ('client', 'artisan')),
  avatar_url text,
  location geography(point), -- Stockage des coordonnées GPS
  address text,
  description text,
  is_available boolean default true,
  rating decimal default 5.0,
  expo_push_token text
);

-- Index pour la recherche géographique
create index profiles_location_idx on public.profiles using gist(location);

-- Index sur les colonnes fréquemment filtrées (profils)
create index profiles_role_idx on public.profiles(role);
create index profiles_is_available_idx on public.profiles(is_available);
create index profiles_role_available_idx on public.profiles(role, is_available);
create index profiles_created_at_idx on public.profiles(created_at desc);

-- Index sur les catégories
create index categories_name_idx on public.categories(name);

-- Index sur les services artisans
create index artisan_services_artisan_id_idx on public.artisan_services(artisan_id);
create index artisan_services_category_id_idx on public.artisan_services(category_id);

-- Index sur les devis
create index quotes_client_id_idx on public.quotes(client_id);
create index quotes_artisan_id_idx on public.quotes(artisan_id);
create index quotes_status_idx on public.quotes(status);

-- 3. Table des Catégories
create table public.categories (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  icon text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 4. Services proposés par les artisans
create table public.artisan_services (
  id uuid default gen_random_uuid() primary key,
  artisan_id uuid references public.profiles(id) on delete cascade,
  category_id uuid references public.categories(id),
  service_name text not null,
  base_price decimal,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 5. Table des Devis (Quotes)
create table public.quotes (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references public.profiles(id),
  artisan_id uuid references public.profiles(id),
  service_id uuid references public.artisan_services(id),
  description text,
  status text check (status in ('pending', 'accepted', 'rejected', 'completed')) default 'pending',
  price decimal,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 6. Table du Portfolio Artisan
create table public.portfolio_items (
  id uuid default gen_random_uuid() primary key,
  artisan_id uuid references public.profiles(id) on delete cascade,
  image_url text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ============================================
-- ACTIVER RLS SUR TOUTES LES TABLES
-- ============================================

-- Tables du module principal
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.artisan_services enable row level security;
alter table public.quotes enable row level security;
alter table public.portfolio_items enable row level security;

-- Tables du module emploi (déjà activées mais rappel pour complétude)
alter table public.job_categories enable row level security;
alter table public.employer_requests enable row level security;
alter table public.employer_profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;

-- ============================================
-- POLITIQUES RLS GRANULAIRES
-- ============================================

-- Profils : lecture publique, modification propriétaire uniquement
create policy "Profils visibles par tous" on public.profiles for select using (true);
create policy "Utilisateurs modifient leur propre profil" on public.profiles for update using (auth.uid() = id);
create policy "Utilisateurs peuvent lire leur propre profil" on public.profiles for select using (auth.uid() = id);

-- Catégories : lecture publique, écriture admin uniquement
create policy "Catégories visibles par tous" on public.categories for select using (true);
create policy "Seuls les admins modifient les catégories" on public.categories for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Artisan services : lecture publique, modification propriétaire uniquement
create policy "Services artisanaux visibles par tous" on public.artisan_services for select using (true);
create policy "Artisans modifient leurs propres services" on public.artisan_services for all using (auth.uid() = artisan_id);

-- Devis : client et artisan voient leurs devis, seul l'artisan modifie le statut
create policy "Clients voient leurs devis" on public.quotes for select using (auth.uid() = client_id);
create policy "Artisans voient leurs devis" on public.quotes for select using (auth.uid() = artisan_id);
create policy "Clients créent des devis" on public.quotes for insert with check (auth.uid() = client_id);
create policy "Artisans modifient leurs devis" on public.quotes for update using (auth.uid() = artisan_id);

-- Portfolio : lecture publique, modification propriétaire uniquement
create policy "Portfolio visible par tous" on public.portfolio_items for select using (true);
create policy "Artisans gèrent leur portfolio" on public.portfolio_items for all using (auth.uid() = artisan_id);

-- Fonction de recherche d'artisans à proximité
create or replace function public.get_nearby_artisans(
  lat double precision,
  lng double precision,
  radius_meters int,
  category_name text default null
)
returns setof public.profiles as $$
begin
  return query
  select p.*
  from public.profiles p
  left join public.artisan_services s on s.artisan_id = p.id
  left join public.categories c on c.id = s.category_id
  where p.role = 'artisan'
    and p.is_available = true
    and st_dwithin(p.location, st_setSRID(st_point(lng, lat), 4326)::geography, radius_meters)
    and (category_name is null or c.name = category_name);
end;
$$ language plpgsql security definer;

-- ============================================
-- MODULE EMPLOI - TABLES
-- ============================================

-- 7. Catégories d'emploi
create table public.job_categories (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  description text,
  icon text,
  created_at timestamp with time zone default now()
);

-- 8. Demandes employeur (pour approbation admin)
create table public.employer_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  
  -- Étape 1: Informations entreprise
  company_name text not null,
  company_email text not null,
  company_phone text,
  company_address text,
  company_website text,
  
  -- Étape 2: Détails contact
  contact_person text not null,
  contact_position text,
  contact_email text not null,
  contact_phone text,
  
  -- Étape 3: Secteur d'activité
  industry text not null,
  company_size text check (company_size in ('micro', 'small', 'medium', 'large', 'enterprise')),
  years_in_business integer,
  
  -- Étape 4: Besoins en recrutement
  hiring_needs text,
  expected_hires integer,
  job_types text[] check (job_types <@ array['full_time', 'part_time', 'contract', 'internship', 'remote']),
  
  -- Étape 5: Autres informations
  hear_about_us text,
  additional_notes text,
  
  -- Statut et gestion admin
  status text check (status in ('pending', 'approved', 'rejected')) default 'pending',
  admin_notes text,
  approved_by uuid references auth.users(id),
  approved_at timestamp with time zone,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 9. Profils employeurs approuvés
create table public.employer_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade unique,
  request_id uuid references public.employer_requests(id),
  
  -- Données de l'entreprise
  company_name text not null,
  company_email text not null,
  company_phone text,
  company_address text,
  company_website text,
  
  -- Contact principal
  contact_person text not null,
  contact_position text,
  contact_email text not null,
  contact_phone text,
  
  -- Secteur
  industry text not null,
  company_size text,
  years_in_business integer,
  
  -- Statut
  is_active boolean default true,
  subscription_tier text check (subscription_tier in ('free', 'basic', 'premium')) default 'free',
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 10. Offres d'emploi
create table public.jobs (
  id uuid default gen_random_uuid() primary key,
  employer_id uuid references public.employer_profiles(id) on delete cascade,
  
  -- Informations de base
  title text not null,
  description text not null,
  
  -- Détails du poste
  job_type text check (job_type in ('full_time', 'part_time', 'contract', 'internship', 'remote')) not null,
  category_id uuid references public.job_categories(id),
  
  -- Localisation
  location text,
  is_remote boolean default false,
  
  -- Rémunération
  salary_min decimal,
  salary_max decimal,
  salary_currency text default 'EUR',
  salary_period text check (salary_period in ('hourly', 'daily', 'weekly', 'monthly', 'yearly')) default 'monthly',
  
  -- Exigences
  requirements text[],
  benefits text[],
  
  -- Process de candidature
  application_deadline timestamp with time zone,
  application_method text check (application_method in ('email', 'website', 'platform')) default 'platform',
  application_email text,
  application_url text,
  
  -- Statut
  status text check (status in ('draft', 'active', 'closed', 'archived')) default 'draft',
  
  -- Métadonnées
  views_count integer default 0,
  applications_count integer default 0,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  published_at timestamp with time zone
);

-- 11. Candidatures
create table public.job_applications (
  id uuid default gen_random_uuid() primary key,
  job_id uuid references public.jobs(id) on delete cascade,
  applicant_id uuid references auth.users(id) on delete cascade,
  
  -- Informations candidat
  full_name text not null,
  email text not null,
  phone text,
  
  -- Documents
  resume_url text,
  cover_letter text,
  
  -- Statut
  status text check (status in ('pending', 'reviewed', 'shortlisted', 'rejected', 'hired')) default 'pending',
  
  -- Notes
  employer_notes text,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ============================================
-- INDEXES
-- ============================================

-- Index pour employer_requests
create index employer_requests_user_id_idx on public.employer_requests(user_id);
create index employer_requests_status_idx on public.employer_requests(status);
create index employer_requests_created_at_idx on public.employer_requests(created_at desc);

-- Index pour employer_profiles
create index employer_profiles_user_id_idx on public.employer_profiles(user_id);
create index employer_profiles_is_active_idx on public.employer_profiles(is_active);

-- Index pour jobs
create index jobs_employer_id_idx on public.jobs(employer_id);
create index jobs_status_idx on public.jobs(status);
create index jobs_category_id_idx on public.jobs(category_id);
create index jobs_job_type_idx on public.jobs(job_type);
create index jobs_location_idx on public.jobs(location);
create index jobs_created_at_idx on public.jobs(created_at desc);

-- Index pour job_applications
create index job_applications_job_id_idx on public.job_applications(job_id);
create index job_applications_applicant_id_idx on public.job_applications(applicant_id);
create index job_applications_status_idx on public.job_applications(status);

-- ============================================
-- RLS POLICIES
-- ============================================

alter table public.job_categories enable row level security;
alter table public.employer_requests enable row level security;
alter table public.employer_profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;

-- Politiques pour job_categories (lecture publique)
create policy "Les catégories d'emploi sont visibles par tous" on public.job_categories for select using (true);

-- Politiques pour employer_requests
create policy "Les utilisateurs voient leurs propres demandes" on public.employer_requests for select using (auth.uid() = user_id);
create policy "Les utilisateurs créent leurs propres demandes" on public.employer_requests for insert with check (auth.uid() = user_id);
create policy "Les admins voient toutes les demandes" on public.employer_requests for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "Les admins peuvent mettre à jour les demandes" on public.employer_requests for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Politiques pour employer_profiles
create policy "Les profils employeurs sont visibles par tous" on public.employer_profiles for select using (true);
create policy "Les employeurs gèrent leur propre profil" on public.employer_profiles for all using (auth.uid() = user_id);

-- Politiques pour jobs
create policy "Les offres actives sont visibles par tous" on public.jobs for select using (status = 'active');
create policy "Les employeurs voient toutes leurs offres" on public.jobs for select using (
  auth.uid() in (select user_id from public.employer_profiles where id = employer_id)
);
create policy "Les employeurs créent des offres" on public.jobs for insert with check (
  auth.uid() in (select user_id from public.employer_profiles where id = employer_id)
);
create policy "Les employeurs mettent à jour leurs offres" on public.jobs for update using (
  auth.uid() in (select user_id from public.employer_profiles where id = employer_id)
);

-- Politiques pour job_applications
create policy "Les candidats voient leurs propres candidatures" on public.job_applications for select using (auth.uid() = applicant_id);
create policy "Les candidats créent des candidatures" on public.job_applications for insert with check (auth.uid() = applicant_id);
create policy "Les employeurs voient les candidatures pour leurs offres" on public.job_applications for select using (
  auth.uid() in (
    select user_id from public.employer_profiles ep
    join public.jobs j on j.employer_id = ep.id
    where j.id = job_applications.job_id
  )
);
create policy "Les employeurs mettent à jour les statuts des candidatures" on public.job_applications for update using (
  auth.uid() in (
    select user_id from public.employer_profiles ep
    join public.jobs j on j.employer_id = ep.id
    where j.id = job_applications.job_id
  )
);

-- ============================================
-- FONCTIONS UTILES
-- ============================================

-- Fonction pour vérifier si un utilisateur est employeur approuvé
create or replace function public.is_approved_employer(user_uuid uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.employer_profiles 
    where user_id = user_uuid and is_active = true
  );
end;
$$ language plpgsql security definer;

-- Fonction pour obtenir les statistiques employeur
create or replace function public.get_employer_stats(employer_uuid uuid)
returns table (
  total_jobs bigint,
  active_jobs bigint,
  total_applications bigint,
  pending_applications bigint
) as $$
begin
  return query
  select 
    count(j.id) as total_jobs,
    count(case when j.status = 'active' then 1 end) as active_jobs,
    count(ja.id) as total_applications,
    count(case when ja.status = 'pending' then 1 end) as pending_applications
  from public.employer_profiles ep
  left join public.jobs j on j.employer_id = ep.id
  left join public.job_applications ja on ja.job_id = j.id
  where ep.user_id = employer_uuid
  group by ep.id;
end;
$$ language plpgsql security definer;

-- Trigger pour mettre à jour updated_at
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Appliquer le trigger aux tables du module principal
create trigger update_profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

create trigger update_categories_updated_at before update on public.categories
  for each row execute function public.update_updated_at_column();

create trigger update_artisan_services_updated_at before update on public.artisan_services
  for each row execute function public.update_updated_at_column();

create trigger update_quotes_updated_at before update on public.quotes
  for each row execute function public.update_updated_at_column();

create trigger update_portfolio_items_updated_at before update on public.portfolio_items
  for each row execute function public.update_updated_at_column();

-- Appliquer le trigger aux tables du module emploi
create trigger update_employer_requests_updated_at before update on public.employer_requests
  for each row execute function public.update_updated_at_column();

create trigger update_employer_profiles_updated_at before update on public.employer_profiles
  for each row execute function public.update_updated_at_column();

create trigger update_jobs_updated_at before update on public.jobs
  for each row execute function public.update_updated_at_column();

create trigger update_job_applications_updated_at before update on public.job_applications
  for each row execute function public.update_updated_at_column();
