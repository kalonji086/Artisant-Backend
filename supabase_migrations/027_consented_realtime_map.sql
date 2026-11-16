begin;

create table if not exists public.artisan_map_preferences (
  artisan_id uuid primary key references public.profiles(id) on delete cascade,
  visible boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.artisan_map_preferences enable row level security;
revoke all on public.artisan_map_preferences from anon, authenticated;

alter table public.quotes
  add column if not exists share_location_with_artisan boolean not null default false;

create or replace function public.get_my_artisan_map_visibility()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visible boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan'
  ) then
    raise exception 'Cette option est réservée aux artisans' using errcode = '42501';
  end if;
  select visible into v_visible
  from public.artisan_map_preferences
  where artisan_id = auth.uid();

  return coalesce(v_visible, false);
end;
$$;

create or replace function public.set_my_artisan_map_visibility(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan'
  ) then
    raise exception 'Cette option est réservée aux artisans' using errcode = '42501';
  end if;
  if p_visible is null then
    raise exception 'La visibilité doit être activée ou désactivée' using errcode = '22023';
  end if;

  insert into public.artisan_map_preferences (artisan_id, visible, updated_at)
  values (auth.uid(), p_visible, now())
  on conflict (artisan_id) do update
    set visible = excluded.visible,
        updated_at = now();

  perform realtime.send(
    payload => '{}'::jsonb,
    event => 'artisan_location_changed',
    topic => 'nearby_artisan_locations',
    private => true
  );
end;
$$;

create or replace function public.set_quote_location_sharing(
  p_quote_id uuid,
  p_share_location boolean
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if p_share_location is null then
    raise exception 'Le consentement de partage est requis' using errcode = '22023';
  end if;

  select * into v_quote
  from public.quotes q
  where q.id = p_quote_id and q.client_id = auth.uid()
  for update;

  if not found then
    raise exception 'Demande introuvable' using errcode = 'P0002';
  end if;

  if p_share_location and (
    v_quote.artisan_id is null
    or v_quote.status not in ('assigned', 'pending', 'accepted')
  ) then
    raise exception 'Le partage est disponible après attribution de la demande' using errcode = '22023';
  end if;

  update public.quotes q
  set share_location_with_artisan = p_share_location,
      updated_at = now()
  where q.id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

drop function if exists public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric
);

create function public.create_quote_request(
  p_description text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_category text default null,
  p_title text default null,
  p_urgency text default 'normal',
  p_address text default null,
  p_budget numeric default null,
  p_share_location boolean default false
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
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client') then
    raise exception 'Seuls les clients peuvent demander un devis' using errcode = '42501';
  end if;
  if p_category is null or length(trim(p_category)) = 0 or length(p_category) > 80 then
    raise exception 'Catégorie requise' using errcode = '22023';
  end if;
  if p_description is null or length(trim(p_description)) < 10 or length(p_description) > 1000 then
    raise exception 'Description requise (10 à 1000 caractères)' using errcode = '22023';
  end if;
  if p_title is not null and length(p_title) > 120 then
    raise exception 'Titre trop long' using errcode = '22023';
  end if;
  if p_address is not null and length(p_address) > 250 then
    raise exception 'Adresse trop longue' using errcode = '22023';
  end if;
  if p_budget is not null and p_budget < 0 then
    raise exception 'Budget invalide' using errcode = '22023';
  end if;
  if coalesce(p_urgency, 'normal') not in ('flexible', 'normal', 'urgent') then
    raise exception 'Urgence invalide' using errcode = '22023';
  end if;

  if v_lat is null or v_lng is null then
    select ul.latitude, ul.longitude into v_lat, v_lng
    from public.user_locations ul
    where ul.user_id = auth.uid();
  end if;

  if p_share_location and (v_lat is null or v_lng is null) then
    raise exception 'Position indisponible : autorisez la localisation avant de partager votre position' using errcode = '22023';
  end if;

  insert into public.quotes (
    client_id, description, status, latitude, longitude, category, title,
    urgency, address, budget, share_location_with_artisan
  )
  values (
    auth.uid(), trim(p_description), 'unassigned', v_lat, v_lng, trim(p_category),
    nullif(trim(coalesce(p_title, '')), ''), coalesce(p_urgency, 'normal'),
    nullif(trim(coalesce(p_address, '')), ''), p_budget, coalesce(p_share_location, false)
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

drop function if exists public.artisan_map_entries(double precision, double precision, integer, text);

create function public.artisan_map_entries(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer default 50000,
  p_profession_filter text default null
)
returns table (
  id uuid,
  entry_type text,
  full_name text,
  profession text,
  description text,
  city text,
  avatar_url text,
  phone text,
  address text,
  country text,
  years_experience integer,
  service_radius_km integer,
  rating numeric,
  distance_m double precision,
  latitude double precision,
  longitude double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles viewer where viewer.id = auth.uid() and viewer.role = 'artisan'
  ) then
    raise exception 'La carte partagée est réservée aux artisans' using errcode = '42501';
  end if;
  if p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90
    or p_longitude not between -180 and 180
    or p_radius_meters is null
    or p_radius_meters not between 1 and 50000 then
    raise exception 'Coordonnées ou rayon invalides' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.user_locations own_location
    where own_location.user_id = auth.uid()
      and own_location.updated_at > now() - interval '5 minutes'
      and public.haversine_m(p_latitude, p_longitude, own_location.latitude, own_location.longitude) <= 1000
  ) then
    raise exception 'Position actuelle indisponible. Actualisez la localisation avant d’ouvrir la carte.' using errcode = '22023';
  end if;

  return query
  with entries as (
    select p.id,
           'artisan'::text as entry_type,
           p.full_name,
           p.profession,
           p.description,
           p.city,
           p.avatar_url,
           null::text as phone,
           null::text as address,
           null::text as country,
           null::integer as years_experience,
           null::integer as service_radius_km,
           coalesce(p.rating, 0)::numeric as rating,
           public.haversine_m(p_latitude, p_longitude, ul.latitude, ul.longitude) as distance_m,
           ul.latitude,
           ul.longitude
    from public.profiles p
    join public.user_locations ul on ul.user_id = p.id
    join public.artisan_map_preferences pref on pref.artisan_id = p.id and pref.visible
    where p.role = 'artisan'
      and p.id <> auth.uid()
      and coalesce(p.is_available, true)
      and ul.updated_at > now() - interval '5 minutes'
      and (p_profession_filter is null or p.profession ilike p_profession_filter)
      and public.haversine_m(p_latitude, p_longitude, ul.latitude, ul.longitude) <= p_radius_meters

    union all

    select q.id,
           'client'::text,
           'Client'::text,
           'Demande active'::text,
           null::text,
           null::text,
           null::text,
           null::text,
           null::text,
           null::text,
           null::integer,
           null::integer,
           null::numeric,
           public.haversine_m(p_latitude, p_longitude, ul.latitude, ul.longitude),
           ul.latitude,
           ul.longitude
    from public.quotes q
    join public.user_locations ul on ul.user_id = q.client_id
    where q.artisan_id = auth.uid()
      and q.share_location_with_artisan
      and q.status in ('assigned', 'pending', 'accepted')
      and ul.updated_at > now() - interval '5 minutes'
      and (p_profession_filter is null or q.category ilike p_profession_filter)
      and public.haversine_m(p_latitude, p_longitude, ul.latitude, ul.longitude) <= p_radius_meters
  )
  select entries.* from entries
  order by entries.distance_m
  limit 100;
end;
$$;

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
  phone text,
  address text,
  country text,
  years_experience int,
  service_radius_km int,
  rating numeric,
  distance_m double precision,
  latitude double precision,
  longitude double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.profession, p.description, p.city, p.avatar_url,
         p.phone, p.address, details.country, details.years_experience, details.service_radius_km,
         coalesce(p.rating, 0)::numeric,
         distance.dist, ul.latitude, ul.longitude
  from public.profiles p
  join public.user_locations ul on ul.user_id = p.id
  join public.artisan_map_preferences pref on pref.artisan_id = p.id and pref.visible
  left join public.profile_details details on details.user_id = p.id
  cross join lateral (
    select public.haversine_m(lat, lng, ul.latitude, ul.longitude) as dist
  ) distance
  where p.role = 'artisan'
    and coalesce(p.is_available, true)
    and ul.updated_at > now() - interval '5 minutes'
    and lat between -90 and 90
    and lng between -180 and 180
    and radius_meters between 1 and 50000
    and distance.dist <= radius_meters
    and (profession_filter is null or p.profession ilike profession_filter)
    and exists (
      select 1
      from public.user_locations viewer_location
      where viewer_location.user_id = auth.uid()
        and viewer_location.updated_at > now() - interval '5 minutes'
        and public.haversine_m(lat, lng, viewer_location.latitude, viewer_location.longitude) <= 1000
    )
    and exists (
      select 1 from public.profiles viewer
      where viewer.id = auth.uid() and viewer.role = 'client'
    )
  order by distance.dist
  limit 50;
$$;

create or replace function public.broadcast_location_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_role text;
  v_artisan_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.latitude is not distinct from old.latitude
    and new.longitude is not distinct from old.longitude then
    return new;
  end if;

  perform realtime.send(
    payload => jsonb_build_object('user_id', new.user_id),
    event => 'user_location_changed',
    topic => 'user_location:' || new.user_id::text,
    private => true
  );

  select p.role into v_user_role
  from public.profiles p
  where p.id = new.user_id;

  if v_user_role = 'artisan' then
    perform realtime.send(
      payload => '{}'::jsonb,
      event => 'artisan_location_changed',
      topic => 'nearby_artisan_locations',
      private => true
    );
  elsif v_user_role = 'client' then
    for v_artisan_id in
      select distinct q.artisan_id
      from public.quotes q
      where q.client_id = new.user_id
        and q.artisan_id is not null
        and q.share_location_with_artisan
        and q.status in ('assigned', 'pending', 'accepted')
    loop
      perform realtime.send(
        payload => '{}'::jsonb,
        event => 'client_location_changed',
        topic => 'artisan_client_map:' || v_artisan_id::text,
        private => true
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.broadcast_quote_map_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.artisan_id is not null
    and old.artisan_id is distinct from new.artisan_id then
    perform realtime.send(
      payload => '{}'::jsonb,
      event => 'client_location_changed',
      topic => 'artisan_client_map:' || old.artisan_id::text,
      private => true
    );
  end if;

  if new.artisan_id is not null then
    perform realtime.send(
      payload => '{}'::jsonb,
      event => 'client_location_changed',
      topic => 'artisan_client_map:' || new.artisan_id::text,
      private => true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists quote_map_visibility_broadcast on public.quotes;
create trigger quote_map_visibility_broadcast
  after insert or update of artisan_id, status, share_location_with_artisan
  on public.quotes
  for each row execute function public.broadcast_quote_map_visibility();

drop policy if exists artisan_client_map_updates_read on realtime.messages;
create policy artisan_client_map_updates_read
  on realtime.messages for select to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() = 'artisan_client_map:' || (select auth.uid())::text
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'artisan'
    )
  );

revoke all on function public.get_my_artisan_map_visibility() from public, anon;
revoke all on function public.set_my_artisan_map_visibility(boolean) from public, anon;
revoke all on function public.set_quote_location_sharing(uuid, boolean) from public, anon;
revoke all on function public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric, boolean
) from public, anon;
revoke all on function public.artisan_map_entries(double precision, double precision, integer, text) from public, anon;

grant execute on function public.get_my_artisan_map_visibility() to authenticated;
grant execute on function public.set_my_artisan_map_visibility(boolean) to authenticated;
grant execute on function public.set_quote_location_sharing(uuid, boolean) to authenticated;
grant execute on function public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric, boolean
) to authenticated;
grant execute on function public.artisan_map_entries(double precision, double precision, integer, text) to authenticated;
grant execute on function public.nearby_artisans(double precision, double precision, integer, text) to authenticated;

commit;
