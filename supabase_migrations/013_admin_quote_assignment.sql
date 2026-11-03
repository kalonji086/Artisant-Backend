-- Migration 013: les demandes de devis passent par l'Admin, qui les assigne aux artisans
-- les plus proches du client (positions GPS suivies en temps réel).
-- N'utilise PAS PostGIS : distances calculées avec la formule de Haversine.

begin;

-- ============================================================
-- 1. Positions GPS (une ligne par utilisateur, mise à jour par le téléphone)
-- ============================================================
create table if not exists public.user_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now()
);

alter table public.user_locations enable row level security;

drop policy if exists "Position visible par son propriétaire" on public.user_locations;
drop policy if exists "Position visible par les admins" on public.user_locations;

-- Aucune politique d'écriture : seules les fonctions ci-dessous écrivent.

-- ============================================================
-- 2. Outils : admin, distance
-- ============================================================
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

create policy "Position visible par son propriétaire"
  on public.user_locations for select using (auth.uid() = user_id);
create policy "Position visible par les admins"
  on public.user_locations for select using (public.is_platform_admin());

-- Un utilisateur ne doit pas pouvoir se promouvoir admin en modifiant son propre profil.
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and auth.role() <> 'service_role'
     and not public.is_platform_admin() then
    raise exception 'Modification du rôle interdite' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_change on public.profiles;
create trigger profiles_prevent_role_change
  before update of role on public.profiles
  for each row execute function public.prevent_role_change();

-- ============================================================
-- 3. Devis : statuts, position du client, assignation
-- ============================================================
alter table public.quotes
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references public.profiles(id);

alter table public.quotes alter column artisan_id drop not null;

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.quotes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.quotes drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.quotes
  add constraint quotes_status_check
  check (status in ('unassigned', 'assigned', 'pending', 'accepted', 'rejected', 'completed'));

alter table public.quotes alter column status set default 'unassigned';

-- Les clients et artisans n'écrivent plus directement : tout passe par les fonctions.
drop policy if exists "Clients créent des devis" on public.quotes;
drop policy if exists "Artisans modifient leurs devis" on public.quotes;
drop policy if exists "Admins voient tous les devis" on public.quotes;
create policy "Admins voient tous les devis"
  on public.quotes for select using (public.is_platform_admin());

-- ============================================================
-- 4. Fonctions appelées par l'application mobile
-- ============================================================

-- Enregistre la position GPS de l'utilisateur connecté.
create or replace function public.set_my_location(lat double precision, lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  insert into public.user_locations (user_id, latitude, longitude, updated_at)
  values (auth.uid(), lat, lng, now())
  on conflict (user_id) do update
    set latitude = excluded.latitude,
        longitude = excluded.longitude,
        updated_at = now();
end;
$$;

-- Artisans disponibles autour d'un point, du plus proche au plus éloigné.
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
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.profession, p.description, p.city, p.avatar_url,
         p.rating::numeric,
         d.dist
  from public.profiles p
  join public.user_locations ul on ul.user_id = p.id
  cross join lateral (
    select public.haversine_m(lat, lng, ul.latitude, ul.longitude) as dist
  ) d
  where p.role = 'artisan'
    and coalesce(p.is_available, true)
    and d.dist <= radius_meters
    and (profession_filter is null or p.profession ilike profession_filter)
  order by d.dist
  limit 50;
$$;

-- Le client envoie une demande : elle n'est PAS adressée à un artisan, l'Admin la traitera.
create or replace function public.create_quote_request(
  p_description text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision := p_latitude;
  v_lng double precision := p_longitude;
  v_quote public.quotes;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'client') then
    raise exception 'Seuls les clients peuvent demander un devis' using errcode = '42501';
  end if;
  if p_description is null or length(trim(p_description)) = 0 or length(p_description) > 1000 then
    raise exception 'Description requise (1000 caractères max)' using errcode = '22023';
  end if;

  if v_lat is null or v_lng is null then
    select ul.latitude, ul.longitude into v_lat, v_lng
    from public.user_locations ul where ul.user_id = auth.uid();
  end if;

  insert into public.quotes (client_id, description, status, latitude, longitude)
  values (auth.uid(), trim(p_description), 'unassigned', v_lat, v_lng)
  returning * into v_quote;

  return v_quote;
end;
$$;

-- L'artisan répond à un devis qui lui est assigné.
create or replace function public.artisan_respond_to_quote(
  p_quote_id uuid,
  p_action text,
  p_price numeric default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or v_quote.artisan_id is distinct from auth.uid() then
    raise exception 'Devis introuvable' using errcode = '42501';
  end if;

  if p_action = 'accept' and v_quote.status in ('assigned', 'pending') then
    update public.quotes set status = 'accepted', price = coalesce(p_price, price)
    where id = p_quote_id returning * into v_quote;
  elsif p_action = 'reject' and v_quote.status in ('assigned', 'pending') then
    -- Le devis retourne chez l'Admin pour être réassigné.
    update public.quotes
    set status = 'unassigned', artisan_id = null, assigned_at = null, assigned_by = null
    where id = p_quote_id returning * into v_quote;
  elsif p_action = 'complete' and v_quote.status = 'accepted' then
    update public.quotes set status = 'completed', price = coalesce(p_price, price)
    where id = p_quote_id returning * into v_quote;
  else
    raise exception 'Action impossible pour le statut actuel (%)', v_quote.status using errcode = '22023';
  end if;

  return v_quote;
end;
$$;

-- ============================================================
-- 5. Fonctions réservées à l'Admin
-- ============================================================
create or replace function public.admin_assign_quote(p_quote_id uuid, p_artisan_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_artisan_id and role = 'artisan') then
    raise exception 'Artisan introuvable' using errcode = '22023';
  end if;

  update public.quotes
  set artisan_id = p_artisan_id,
      status = 'assigned',
      assigned_at = now(),
      assigned_by = auth.uid()
  where id = p_quote_id and status in ('unassigned', 'assigned', 'pending')
  returning * into v_quote;

  if not found then
    raise exception 'Devis introuvable ou déjà accepté/terminé' using errcode = '22023';
  end if;
  return v_quote;
end;
$$;

-- Artisans proposés pour un devis, du plus proche au plus éloigné du client.
create or replace function public.admin_suggest_artisans(p_quote_id uuid, p_limit int default 10)
returns table (
  id uuid,
  full_name text,
  phone text,
  profession text,
  city text,
  rating numeric,
  is_available boolean,
  open_quotes bigint,
  distance_m double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  q_lat double precision;
  q_lng double precision;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;

  select q.latitude, q.longitude into q_lat, q_lng from public.quotes q where q.id = p_quote_id;
  if not found then
    raise exception 'Devis introuvable' using errcode = '22023';
  end if;

  return query
  select p.id, p.full_name, p.phone, p.profession, p.city, p.rating::numeric,
         coalesce(p.is_available, true),
         (select count(*) from public.quotes oq
           where oq.artisan_id = p.id and oq.status in ('assigned', 'pending', 'accepted')),
         case when ul.latitude is null or q_lat is null then null
              else public.haversine_m(q_lat, q_lng, ul.latitude, ul.longitude) end
  from public.profiles p
  left join public.user_locations ul on ul.user_id = p.id
  where p.role = 'artisan' and coalesce(p.is_available, true)
  order by 9 asc nulls last, p.full_name
  limit greatest(1, least(p_limit, 50));
end;
$$;

-- Devis non assignés proposés pour un artisan, du plus proche au plus éloigné.
create or replace function public.admin_suggest_quotes(p_artisan_id uuid, p_limit int default 10)
returns table (
  id uuid,
  client_name text,
  description text,
  status text,
  created_at timestamptz,
  distance_m double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  a_lat double precision;
  a_lng double precision;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;

  select ul.latitude, ul.longitude into a_lat, a_lng
  from public.user_locations ul where ul.user_id = p_artisan_id;

  return query
  select q.id, c.full_name, q.description, q.status, q.created_at,
         case when a_lat is null or q.latitude is null then null
              else public.haversine_m(a_lat, a_lng, q.latitude, q.longitude) end
  from public.quotes q
  left join public.profiles c on c.id = q.client_id
  where q.status = 'unassigned'
  order by 6 asc nulls last, q.created_at
  limit greatest(1, least(p_limit, 50));
end;
$$;

-- ============================================================
-- 6. Droits d'exécution et temps réel
-- ============================================================
revoke all on function public.set_my_location(double precision, double precision) from public, anon;
revoke all on function public.nearby_artisans(double precision, double precision, int, text) from public, anon;
revoke all on function public.create_quote_request(text, double precision, double precision) from public, anon;
revoke all on function public.artisan_respond_to_quote(uuid, text, numeric) from public, anon;
revoke all on function public.admin_assign_quote(uuid, uuid) from public, anon;
revoke all on function public.admin_suggest_artisans(uuid, int) from public, anon;
revoke all on function public.admin_suggest_quotes(uuid, int) from public, anon;

grant execute on function public.set_my_location(double precision, double precision) to authenticated;
grant execute on function public.nearby_artisans(double precision, double precision, int, text) to authenticated;
grant execute on function public.create_quote_request(text, double precision, double precision) to authenticated;
grant execute on function public.artisan_respond_to_quote(uuid, text, numeric) to authenticated;
grant execute on function public.admin_assign_quote(uuid, uuid) to authenticated;
grant execute on function public.admin_suggest_artisans(uuid, int) to authenticated;
grant execute on function public.admin_suggest_quotes(uuid, int) to authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array['user_locations', 'quotes', 'profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end
$$;

commit;

notify pgrst, 'reload schema';
