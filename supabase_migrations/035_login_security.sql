begin;

create table if not exists public.auth_login_throttles (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  escalation_level integer not null default 0 check (escalation_level between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_login_security_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  masked_identifier text not null,
  ip_address inet,
  platform text,
  device_model text,
  failed_attempts integer not null,
  lock_hours integer not null,
  locked_until timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

create index if not exists auth_login_throttles_updated_at_idx
  on public.auth_login_throttles (updated_at);
create index if not exists auth_login_security_events_created_at_idx
  on public.auth_login_security_events (created_at desc);
create index if not exists auth_login_security_events_user_resolved_idx
  on public.auth_login_security_events (user_id, resolved_at);

alter table public.auth_login_throttles enable row level security;
alter table public.auth_login_security_events enable row level security;

drop policy if exists auth_login_security_events_admin_read
  on public.auth_login_security_events;
create policy auth_login_security_events_admin_read
  on public.auth_login_security_events
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.auth_login_security_events to authenticated;
grant all on public.auth_login_throttles, public.auth_login_security_events to service_role;

create or replace function public.find_auth_user_for_login(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

create or replace function public.check_auth_login_lock(
  p_bucket_hash text,
  p_user_id uuid,
  p_masked_identifier text,
  p_ip text,
  p_platform text,
  p_device_model text
)
returns table (
  is_locked boolean,
  retry_after_seconds integer,
  lock_hours integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_throttle public.auth_login_throttles;
  v_level integer;
  v_hours integer;
begin
  if p_bucket_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login bucket' using errcode = '22023';
  end if;

  select * into v_throttle
  from public.auth_login_throttles
  where bucket_hash = p_bucket_hash
  for update;

  if not found or v_throttle.locked_until is null or v_throttle.locked_until <= now() then
    return query select false, 0, 0, null::timestamptz;
    return;
  end if;

  v_level := least(v_throttle.escalation_level + 1, 5);
  v_hours := (1 << v_level);
  update public.auth_login_throttles
  set escalation_level = v_level,
      locked_until = now() + make_interval(hours => v_hours),
      updated_at = now()
  where bucket_hash = p_bucket_hash
  returning * into v_throttle;

  if p_user_id is not null then
    insert into public.auth_login_security_events (
      user_id, masked_identifier, ip_address, platform, device_model,
      failed_attempts, lock_hours, locked_until
    )
    values (
      p_user_id, left(p_masked_identifier, 254), nullif(p_ip, '')::inet,
      left(nullif(p_platform, ''), 80), left(nullif(p_device_model, ''), 120),
      v_throttle.failed_attempts, v_hours, v_throttle.locked_until
    );
  end if;

  return query select
    true,
    greatest(0, ceil(extract(epoch from (v_throttle.locked_until - now())))::integer),
    v_hours,
    v_throttle.locked_until;
end;
$$;

create or replace function public.record_auth_login_failure(
  p_bucket_hash text,
  p_user_id uuid,
  p_masked_identifier text,
  p_ip text,
  p_platform text,
  p_device_model text
)
returns table (
  failed_attempts integer,
  lock_hours integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_throttle public.auth_login_throttles;
  v_hours integer := 0;
  v_level integer;
begin
  if p_bucket_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login bucket' using errcode = '22023';
  end if;

  insert into public.auth_login_throttles (bucket_hash, failed_attempts)
  values (p_bucket_hash, 1)
  on conflict (bucket_hash) do update
    set failed_attempts = public.auth_login_throttles.failed_attempts + 1,
        updated_at = now()
  returning * into v_throttle;

  delete from public.auth_login_throttles
  where updated_at < now() - interval '30 days';
  delete from public.auth_login_security_events
  where resolved_at is not null
    and created_at < now() - interval '90 days';

  if v_throttle.failed_attempts >= 3 then
    if v_throttle.locked_until is null then
      v_level := 0;
      v_hours := 1;
    else
      v_level := least(v_throttle.escalation_level + 1, 5);
      v_hours := (1 << v_level);
    end if;

    update public.auth_login_throttles
    set escalation_level = v_level,
        locked_until = now() + make_interval(hours => v_hours),
        updated_at = now()
    where bucket_hash = p_bucket_hash
    returning * into v_throttle;

    if p_user_id is not null then
      insert into public.auth_login_security_events (
        user_id, masked_identifier, ip_address, platform, device_model,
        failed_attempts, lock_hours, locked_until
      )
      values (
        p_user_id, left(p_masked_identifier, 254), nullif(p_ip, '')::inet,
        left(nullif(p_platform, ''), 80), left(nullif(p_device_model, ''), 120),
        v_throttle.failed_attempts, v_hours, v_throttle.locked_until
      );
    end if;
  end if;

  return query select
    v_throttle.failed_attempts,
    v_hours,
    v_throttle.locked_until;
end;
$$;

create or replace function public.clear_auth_login_lock(p_bucket_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.auth_login_throttles
  where bucket_hash = p_bucket_hash;
$$;

revoke all on function public.find_auth_user_for_login(text) from public, anon, authenticated;
revoke all on function public.check_auth_login_lock(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_auth_login_failure(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.clear_auth_login_lock(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_for_login(text) to service_role;
grant execute on function public.check_auth_login_lock(text, uuid, text, text, text, text) to service_role;
grant execute on function public.record_auth_login_failure(text, uuid, text, text, text, text) to service_role;
grant execute on function public.clear_auth_login_lock(text) to service_role;

create or replace function public.enforce_unique_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digits text;
begin
  if new.phone is null or btrim(new.phone) = '' then
    return new;
  end if;

  v_digits := regexp_replace(new.phone, '[^0-9]', '', 'g');
  if length(v_digits) < 6 or length(v_digits) > 15 then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_digits, 0));
  if exists (
    select 1
    from public.profiles p
    where p.id <> new.id
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_digits
  ) then
    raise exception 'Phone number unavailable' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_unique_phone on public.profiles;
create trigger profiles_enforce_unique_phone
  before insert or update of phone on public.profiles
  for each row execute function public.enforce_unique_profile_phone();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'auth_login_security_events'
  ) then
    alter publication supabase_realtime add table public.auth_login_security_events;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
