-- Tables requises par la file de demandes employeur du dashboard admin.
-- À exécuter dans le SQL Editor Supabase du projet ARTISANTS.

begin;

create table if not exists public.employer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_name text not null,
  company_email text not null,
  company_phone text,
  company_address text,
  company_website text,
  contact_person text not null,
  contact_position text,
  contact_email text not null,
  contact_phone text,
  industry text not null,
  company_size text check (company_size in ('micro', 'small', 'medium', 'large', 'enterprise')),
  years_in_business integer,
  hiring_needs text,
  expected_hires integer,
  job_types text[] check (job_types <@ array['full_time', 'part_time', 'contract', 'internship', 'remote']),
  hear_about_us text,
  additional_notes text,
  status text check (status in ('pending', 'approved', 'rejected')) default 'pending',
  admin_notes text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.employer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  request_id uuid references public.employer_requests(id),
  company_name text not null,
  company_email text not null,
  company_phone text,
  company_address text,
  company_website text,
  contact_person text not null,
  contact_position text,
  contact_email text not null,
  contact_phone text,
  industry text not null,
  company_size text,
  years_in_business integer,
  is_active boolean default true,
  subscription_tier text check (subscription_tier in ('free', 'basic', 'premium')) default 'free',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists employer_requests_user_id_idx
  on public.employer_requests(user_id);
create index if not exists employer_requests_status_idx
  on public.employer_requests(status);
create index if not exists employer_requests_created_at_idx
  on public.employer_requests(created_at desc);
create index if not exists employer_profiles_is_active_idx
  on public.employer_profiles(is_active);

alter table public.employer_requests enable row level security;
alter table public.employer_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employer_requests'
      and policyname = 'Utilisateurs voient leurs propres demandes'
  ) then
    create policy "Utilisateurs voient leurs propres demandes"
      on public.employer_requests for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employer_requests'
      and policyname = 'Utilisateurs créent leurs propres demandes'
  ) then
    create policy "Utilisateurs créent leurs propres demandes"
      on public.employer_requests for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employer_requests'
      and policyname = 'Admins voient toutes les demandes'
  ) then
    create policy "Admins voient toutes les demandes"
      on public.employer_requests for select
      using (exists (
        select 1 from public.profiles where id = auth.uid() and role = 'admin'
      ));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employer_requests'
      and policyname = 'Admins peuvent mettre à jour les demandes'
  ) then
    create policy "Admins peuvent mettre à jour les demandes"
      on public.employer_requests for update
      using (exists (
        select 1 from public.profiles where id = auth.uid() and role = 'admin'
      ));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employer_profiles'
      and policyname = 'Profils employeurs visibles par tous'
  ) then
    create policy "Profils employeurs visibles par tous"
      on public.employer_profiles for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employer_profiles'
      and policyname = 'Employeurs gèrent leur propre profil'
  ) then
    create policy "Employeurs gèrent leur propre profil"
      on public.employer_profiles for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

grant select, insert, update on public.employer_requests to authenticated;
grant select on public.employer_profiles to anon, authenticated;
grant insert, update, delete on public.employer_profiles to authenticated;
grant all on public.employer_requests, public.employer_profiles to service_role;

commit;

notify pgrst, 'reload schema';
