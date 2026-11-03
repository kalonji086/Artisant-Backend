-- Migration 012: métier des artisans + recherche d'artisans proches (GPS du téléphone)

begin;

alter table public.profiles
  add column if not exists profession text,
  add column if not exists city text;

-- Le trigger d'inscription reprend aussi le métier et la ville saisis dans le formulaire.
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

  return new;
end;
$$;

-- Enregistre la position GPS de l'utilisateur connecté.
-- plpgsql : les types/fonctions PostGIS sont résolus à l'exécution via le search_path
-- de la fonction, quel que soit le schéma (public ou extensions) où PostGIS est installé.
create or replace function public.set_my_location(lat double precision, lng double precision)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  update public.profiles
  set location = st_setsrid(st_makepoint(lng, lat), 4326)::geography,
      updated_at = now()
  where id = auth.uid();
end;
$$;

-- Artisans disponibles triés du plus proche au plus éloigné.
create or replace function public.nearby_artisans(
  lat double precision,
  lng double precision,
  radius_meters int default 50000,
  profession_filter text default null
)
returns table (
  id uuid,
  full_name text,
  profession text,
  description text,
  city text,
  avatar_url text,
  rating numeric,
  distance_m double precision
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return query
  select p.id, p.full_name, p.profession, p.description, p.city, p.avatar_url,
         p.rating::numeric,
         st_distance(p.location, st_setsrid(st_makepoint(lng, lat), 4326)::geography)
  from public.profiles p
  where p.role = 'artisan'
    and p.is_available = true
    and p.location is not null
    and st_dwithin(p.location, st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_meters)
    and (profession_filter is null or p.profession ilike profession_filter)
  order by 8
  limit 50;
end;
$$;
grant execute on function public.set_my_location(double precision, double precision) to authenticated;
grant execute on function public.nearby_artisans(double precision, double precision, int, text) to authenticated;

commit;

notify pgrst, 'reload schema';
