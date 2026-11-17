begin;

alter table public.profiles
  add column if not exists business_type text
    check (business_type in ('enterprise', 'subcontractor'));

create table if not exists public.artisan_business_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  business_type text not null check (business_type in ('enterprise', 'subcontractor')),
  company_name text not null check (char_length(btrim(company_name)) between 2 and 160),
  country text not null check (char_length(btrim(country)) between 2 and 100),
  registration_number text not null check (char_length(btrim(registration_number)) between 2 and 100),
  tax_number text not null check (char_length(btrim(tax_number)) between 2 and 100),
  company_address text not null check (char_length(btrim(company_address)) between 5 and 250),
  contact_person text not null check (char_length(btrim(contact_person)) between 2 and 120),
  contact_email text not null check (char_length(contact_email) between 3 and 254),
  contact_phone text not null check (char_length(btrim(contact_phone)) between 6 and 40),
  documents jsonb not null check (
    jsonb_typeof(documents) = 'object'
    and documents ?& array['registration', 'tax', 'representative_id', 'authorization']
    and jsonb_typeof(documents->'registration') = 'string'
    and char_length(documents->>'registration') > 0
    and jsonb_typeof(documents->'tax') = 'string'
    and char_length(documents->>'tax') > 0
    and jsonb_typeof(documents->'representative_id') = 'string'
    and char_length(documents->>'representative_id') > 0
    and jsonb_typeof(documents->'authorization') = 'string'
    and char_length(documents->>'authorization') > 0
  ),
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artisan_business_verifications_status_created_idx
  on public.artisan_business_verifications (status, created_at desc);

alter table public.artisan_business_verifications enable row level security;
revoke all on public.artisan_business_verifications from anon, authenticated;
grant select on public.artisan_business_verifications to authenticated;
grant all on public.artisan_business_verifications to service_role;

drop policy if exists artisan_business_verification_read on public.artisan_business_verifications;
create policy artisan_business_verification_read
  on public.artisan_business_verifications for select to authenticated
  using (auth.uid() = user_id or public.is_platform_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artisan-business-proofs',
  'artisan-business-proofs',
  false,
  15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists artisan_business_proofs_read on storage.objects;
create policy artisan_business_proofs_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'artisan-business-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_platform_admin()
    )
  );

drop policy if exists artisan_business_proofs_insert on storage.objects;
create policy artisan_business_proofs_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artisan-business-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  );

drop policy if exists artisan_business_proofs_delete_unsubmitted on storage.objects;
create policy artisan_business_proofs_delete_unsubmitted
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'artisan-business-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
    and not exists (
      select 1
      from public.artisan_business_verifications v
      where v.user_id = auth.uid()
    )
  );

create or replace function public.review_artisan_business_verification(
  p_request_id uuid,
  p_status text,
  p_review_note text,
  p_admin_id uuid
)
returns public.artisan_business_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.artisan_business_verifications;
begin
  if not exists (select 1 from public.profiles p where p.id = p_admin_id and p.role = 'admin') then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'in_review', 'approved', 'rejected') then
    raise exception 'Statut de vérification invalide' using errcode = '22023';
  end if;
  if p_status = 'rejected' and nullif(btrim(p_review_note), '') is null then
    raise exception 'Une raison est obligatoire pour rejeter la demande' using errcode = '22023';
  end if;

  select * into v_request
  from public.artisan_business_verifications
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Demande de vérification introuvable' using errcode = 'P0002';
  end if;

  update public.artisan_business_verifications
  set status = p_status,
      review_note = nullif(btrim(p_review_note), ''),
      reviewed_by = p_admin_id,
      reviewed_at = case when p_status in ('approved', 'rejected') then now() else null end,
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  update public.profiles
  set business_type = case when p_status = 'approved' then v_request.business_type else null end
  where id = v_request.user_id and role = 'artisan';

  return v_request;
end;
$$;

revoke all on function public.review_artisan_business_verification(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.review_artisan_business_verification(uuid, text, text, uuid) to service_role;

drop function if exists public.nearby_artisans(double precision, double precision, integer, text);
create function public.nearby_artisans(
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
  longitude double precision,
  business_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.profession, p.description, p.city, p.avatar_url,
         p.phone, p.address, details.country, details.years_experience, details.service_radius_km,
         coalesce(p.rating, 0)::numeric,
         distance.dist, ul.latitude, ul.longitude, p.business_type
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
revoke all on function public.nearby_artisans(double precision, double precision, integer, text) from public, anon;
grant execute on function public.nearby_artisans(double precision, double precision, integer, text) to authenticated;

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
  longitude double precision,
  business_type text
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
    select 1 from public.user_locations own_location
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
           ul.longitude,
           p.business_type
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
           ul.longitude,
           null::text
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
revoke all on function public.artisan_map_entries(double precision, double precision, integer, text) from public, anon;
grant execute on function public.artisan_map_entries(double precision, double precision, integer, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'artisan_business_verifications'
  ) then
    alter publication supabase_realtime add table public.artisan_business_verifications;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
