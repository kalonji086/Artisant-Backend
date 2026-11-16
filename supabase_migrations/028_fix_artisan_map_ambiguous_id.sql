create or replace function public.artisan_map_entries(
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
    select 1
    from public.profiles viewer
    where viewer.id = auth.uid() and viewer.role = 'artisan'
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
  select entries.*
  from entries
  order by entries.distance_m
  limit 100;
end;
$$;

revoke all on function public.artisan_map_entries(double precision, double precision, integer, text) from public, anon;
grant execute on function public.artisan_map_entries(double precision, double precision, integer, text) to authenticated;
