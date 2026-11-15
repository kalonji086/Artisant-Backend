begin;

create table if not exists public.push_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, expo_push_token)
);

alter table public.push_devices enable row level security;
drop policy if exists "Users manage own push devices" on public.push_devices;
create policy "Users manage own push devices" on public.push_devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.push_devices to authenticated;
grant all on public.push_devices to service_role;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'expo_push_token'
  ) then
    execute $migration$
      insert into public.push_devices (user_id, expo_push_token, platform)
      select id, expo_push_token, 'unknown'
      from public.profiles
      where expo_push_token is not null and length(trim(expo_push_token)) > 0
      on conflict (user_id, expo_push_token) do nothing
    $migration$;

    alter table public.profiles drop column expo_push_token;
  end if;
end
$$;

comment on table public.push_devices is
  'Jetons Expo Push des appareils; accessibles uniquement par leur propriétaire et le serveur.';

commit;

notify pgrst, 'reload schema';
