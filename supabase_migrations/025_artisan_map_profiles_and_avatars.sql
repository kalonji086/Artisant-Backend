begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artisan-avatars',
  'artisan-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Artisans read own avatar" on storage.objects;
create policy "Artisans read own avatar"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'artisan-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  );

drop policy if exists "Artisans upload own avatar" on storage.objects;
create policy "Artisans upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artisan-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  );

drop policy if exists "Artisans update own avatar" on storage.objects;
create policy "Artisans update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'artisan-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  )
  with check (
    bucket_id = 'artisan-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  );

drop policy if exists "Artisans delete own avatar" on storage.objects;
create policy "Artisans delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'artisan-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan')
  );

drop function if exists public.nearby_artisans(double precision, double precision, int, text);

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
  left join public.profile_details details on details.user_id = p.id
  cross join lateral (
    select public.haversine_m(lat, lng, ul.latitude, ul.longitude) as dist
  ) distance
  where p.role = 'artisan'
    and coalesce(p.is_available, true)
    and distance.dist <= radius_meters
    and (profession_filter is null or p.profession ilike profession_filter)
    and exists (
      select 1 from public.profiles viewer
      where viewer.id = auth.uid() and viewer.role = 'client'
    )
  order by distance.dist
  limit 50;
$$;

revoke all on function public.nearby_artisans(double precision, double precision, int, text) from public, anon;
grant execute on function public.nearby_artisans(double precision, double precision, int, text) to authenticated;

drop policy if exists nearby_artisan_profile_updates_read on realtime.messages;
create policy nearby_artisan_profile_updates_read
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and realtime.topic() = 'nearby_artisan_profiles');

create or replace function public.broadcast_artisan_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;

  if exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'artisan'
  ) then
    perform realtime.send(
      payload => '{}'::jsonb,
      event => 'artisan_profile_changed',
      topic => 'nearby_artisan_profiles',
      private => true
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists artisan_profile_details_realtime_broadcast on public.profile_details;
create trigger artisan_profile_details_realtime_broadcast
  after insert or update or delete on public.profile_details
  for each row execute function public.broadcast_artisan_profile_changes();

commit;

notify pgrst, 'reload schema';
