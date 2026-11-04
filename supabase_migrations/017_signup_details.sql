-- Migration 017 : inscription en étapes (artisan) + consentement légal + détails visibles dans l'Admin
-- Les données sensibles (email, date de naissance...) sont dans une table à part :
-- `profiles` reste lisible par tous les utilisateurs (carte des artisans), pas `profile_details`.

begin;

create table if not exists public.profile_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  birth_date date,
  gender text,
  country text,
  years_experience int,
  service_radius_km int,
  terms_accepted_at timestamptz,
  terms_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_details enable row level security;

drop policy if exists "Owner reads own details" on public.profile_details;
create policy "Owner reads own details" on public.profile_details
  for select using (auth.uid() = user_id);

drop policy if exists "Admins read details" on public.profile_details;
create policy "Admins read details" on public.profile_details
  for select using (public.is_platform_admin());

grant select on public.profile_details to authenticated;
grant all on public.profile_details to service_role;

-- Conversions tolérantes : une valeur mal formée ne doit jamais empêcher l'inscription.
create or replace function public._safe_date(v text) returns date
language plpgsql immutable as $$
begin
  return nullif(v, '')::date;
exception when others then
  return null;
end;
$$;

create or replace function public._safe_int(v text) returns int
language plpgsql immutable as $$
begin
  return nullif(v, '')::int;
exception when others then
  return null;
end;
$$;

create or replace function public._safe_ts(v text) returns timestamptz
language plpgsql immutable as $$
begin
  return nullif(v, '')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role text := meta->>'role';
begin
  insert into public.profiles (id, full_name, role, phone, description, address, profession, city)
  values (
    new.id,
    coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
    case when requested_role in ('client', 'artisan') then requested_role else 'client' end,
    meta->>'phone',
    meta->>'description',
    meta->>'address',
    meta->>'profession',
    meta->>'city'
  )
  on conflict (id) do nothing;

  begin
    insert into public.profile_details (
      user_id, email, birth_date, gender, country, years_experience, service_radius_km,
      terms_accepted_at, terms_version
    )
    values (
      new.id,
      new.email,
      public._safe_date(meta->>'birth_date'),
      meta->>'gender',
      meta->>'country',
      public._safe_int(meta->>'years_experience'),
      public._safe_int(meta->>'service_radius_km'),
      public._safe_ts(meta->>'terms_accepted_at'),
      meta->>'terms_version'
    )
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'profile_details non créé pour %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Rattrapage : emails des comptes existants
insert into public.profile_details (user_id, email)
select u.id, u.email
from auth.users u
join public.profiles p on p.id = u.id
on conflict (user_id) do update set email = coalesce(public.profile_details.email, excluded.email);

-- Realtime : le module Utilisateurs de l'Admin se met à jour en direct
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'profile_details'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
