-- Âge saisi à l'inscription + bucket public "avatars" pour la photo de profil.

alter table public.profile_details
  add column if not exists age smallint check (age is null or (age between 18 and 120));

create or replace function public._safe_age(v text) returns smallint
language plpgsql immutable as $$
begin
  if v ~ '^\d{1,3}$' and v::int between 18 and 120 then
    return v::smallint;
  end if;
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
      user_id, email, birth_date, age, gender, country, years_experience, service_radius_km,
      terms_accepted_at, terms_version
    )
    values (
      new.id,
      new.email,
      public._safe_date(meta->>'birth_date'),
      public._safe_age(meta->>'age'),
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

-- Bucket public : les photos sont affichées aux clients.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
