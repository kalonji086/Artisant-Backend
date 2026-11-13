begin;

create table if not exists public.user_app_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'default' check (theme in ('default', 'light', 'dark', 'system')),
  language text not null default 'default' check (language in ('default', 'fr', 'en')),
  accent text check (accent is null or accent ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default now()
);

alter table public.user_app_preferences enable row level security;

drop policy if exists "users_read_own_app_preferences" on public.user_app_preferences;
create policy "users_read_own_app_preferences" on public.user_app_preferences
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "users_insert_own_app_preferences" on public.user_app_preferences;
create policy "users_insert_own_app_preferences" on public.user_app_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "users_update_own_app_preferences" on public.user_app_preferences;
create policy "users_update_own_app_preferences" on public.user_app_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.user_app_preferences to authenticated;

revoke update on public.profiles from authenticated;
grant update (full_name, phone, profession, city, description, avatar_url, address, is_available, phone_public)
  on public.profiles to authenticated;

drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.trg_log_profile_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed_fields text[];
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    perform public.log_activity(auth.uid(), 'profile.role_changed', 'profile', new.id::text,
      jsonb_build_object('from', old.role, 'to', new.role, 'target_id', new.id));
    return new;
  end if;

  v_changed_fields := array_remove(array[
    case when new.full_name is distinct from old.full_name then 'full_name' end,
    case when new.phone is distinct from old.phone then 'phone' end,
    case when new.city is distinct from old.city then 'city' end,
    case when new.profession is distinct from old.profession then 'profession' end,
    case when new.description is distinct from old.description then 'description' end,
    case when new.avatar_url is distinct from old.avatar_url then 'avatar_url' end,
    case when new.address is distinct from old.address then 'address' end,
    case when new.is_available is distinct from old.is_available then 'is_available' end,
    case when new.phone_public is distinct from old.phone_public then 'phone_public' end
  ], null);

  if cardinality(v_changed_fields) > 0 then
    perform public.log_activity(auth.uid(), 'profile.updated', 'profile', new.id::text,
      jsonb_build_object('target_id', new.id, 'changed_fields', v_changed_fields));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_app_preferences'
  ) then
    alter publication supabase_realtime add table public.user_app_preferences;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
