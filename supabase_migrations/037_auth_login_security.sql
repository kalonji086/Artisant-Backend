begin;

create table if not exists public.auth_login_lockouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 2),
  lock_level integer not null default 0 check (lock_level >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.auth_login_lockouts enable row level security;
revoke all on public.auth_login_lockouts from public, anon, authenticated;
grant all on public.auth_login_lockouts to service_role;

create or replace function public.prevent_duplicate_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
begin
  if normalized_phone = '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 0));

  if exists (
    select 1
    from public.profiles p
    where p.id is distinct from new.id
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  ) then
    raise exception 'Profile phone is not available' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_duplicate_phone on public.profiles;
create trigger profiles_prevent_duplicate_phone
before insert or update of phone on public.profiles
for each row execute function public.prevent_duplicate_profile_phone();

create or replace function public.get_auth_login_lockout(p_email text)
returns table (
  user_id uuid,
  failed_attempts integer,
  lock_level integer,
  locked_until timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id,
         coalesce(l.failed_attempts, 0),
         coalesce(l.lock_level, 0),
         l.locked_until
  from auth.users u
  left join public.auth_login_lockouts l on l.user_id = u.id
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

create or replace function public.record_auth_login_failure(p_email text)
returns table (
  user_id uuid,
  failed_attempts integer,
  lock_level integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_failures integer;
  v_lock_level integer;
  v_locked_until timestamptz;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    return;
  end if;

  insert into public.auth_login_lockouts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select l.failed_attempts, l.lock_level, l.locked_until
  into v_failures, v_lock_level, v_locked_until
  from public.auth_login_lockouts l
  where l.user_id = v_user_id
  for update;

  if v_locked_until > now() then
    if v_lock_level < 2 then
      v_lock_level := 2;
      v_locked_until := now() + interval '5 hours';
      update public.auth_login_lockouts l
      set lock_level = v_lock_level,
          locked_until = v_locked_until,
          updated_at = now()
      where l.user_id = v_user_id;
    end if;

    return query
      select v_user_id, v_failures, v_lock_level, v_locked_until;
    return;
  end if;

  v_failures := case when v_locked_until is not null then 0 else v_failures end + 1;
  if v_failures >= 3 then
    v_lock_level := least(v_lock_level + 1, 2);
    v_locked_until := now() + case when v_lock_level = 1 then interval '1 hour' else interval '5 hours' end;
    v_failures := 0;
  else
    v_locked_until := null;
  end if;

  update public.auth_login_lockouts l
  set failed_attempts = v_failures,
      lock_level = v_lock_level,
      locked_until = v_locked_until,
      updated_at = now()
  where l.user_id = v_user_id;

  return query
    select v_user_id, v_failures, v_lock_level, v_locked_until;
end;
$$;

create or replace function public.reset_auth_login_lockout(p_email text)
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from public.auth_login_lockouts l
  using auth.users u
  where l.user_id = u.id
    and lower(u.email) = lower(trim(p_email));
$$;

create or replace function public.check_signup_identifiers(p_email text, p_phone text)
returns table (email_unavailable boolean, phone_unavailable boolean)
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
           select 1
           from auth.users u
           where lower(u.email) = lower(trim(p_email))
         ),
         exists (
           select 1
           from public.profiles p
           where regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
             and regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') <> ''
         );
$$;

revoke all on function public.prevent_duplicate_profile_phone() from public, anon, authenticated;
revoke all on function public.get_auth_login_lockout(text) from public, anon, authenticated;
revoke all on function public.record_auth_login_failure(text) from public, anon, authenticated;
revoke all on function public.reset_auth_login_lockout(text) from public, anon, authenticated;
revoke all on function public.check_signup_identifiers(text, text) from public, anon, authenticated;

grant execute on function public.get_auth_login_lockout(text) to service_role;
grant execute on function public.record_auth_login_failure(text) to service_role;
grant execute on function public.reset_auth_login_lockout(text) to service_role;
grant execute on function public.check_signup_identifiers(text, text) to service_role;

commit;

notify pgrst, 'reload schema';
