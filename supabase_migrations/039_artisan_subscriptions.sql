begin;

alter table public.artisan_projects
  add column if not exists status text not null default 'published';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'artisan_projects_status_check'
      and conrelid = 'public.artisan_projects'::regclass
  ) then
    alter table public.artisan_projects
      add constraint artisan_projects_status_check check (status in ('draft', 'published'));
  end if;
end;
$$;

create table if not exists public.artisan_subscription_plans (
  tier text primary key check (tier in ('free', 'pro', 'premium', 'enterprise')),
  display_name text not null,
  monthly_price_usd numeric(8, 2) not null check (monthly_price_usd >= 0),
  monthly_publication_limit integer check (monthly_publication_limit is null or monthly_publication_limit > 0),
  google_play_product_id text unique,
  features jsonb not null default '[]'::jsonb
);

insert into public.artisan_subscription_plans (
  tier, display_name, monthly_price_usd, monthly_publication_limit, google_play_product_id, features
) values
  ('free', 'Gratuit', 0, 1, null, '["1 publication par mois"]'::jsonb),
  ('pro', 'Pro', 19, 10, 'artisants_pro_monthly', '["10 publications par mois"]'::jsonb),
  ('premium', 'Premium', 30, null, 'artisants_premium_monthly', '["Publications illimitées"]'::jsonb),
  ('enterprise', 'Entreprise', 100, null, 'artisants_enterprise_monthly', '["Publications illimitées", "Support 24/7"]'::jsonb)
on conflict (tier) do update
set display_name = excluded.display_name,
    monthly_price_usd = excluded.monthly_price_usd,
    monthly_publication_limit = excluded.monthly_publication_limit,
    google_play_product_id = excluded.google_play_product_id,
    features = excluded.features;

create table if not exists public.artisan_subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null references public.artisan_subscription_plans(tier),
  provider text not null check (provider = 'google_play'),
  product_id text not null,
  purchase_token text not null unique,
  status text not null check (status in ('active', 'grace_period', 'canceled', 'on_hold', 'paused', 'expired')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.artisan_google_play_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  obfuscated_account_id text not null unique
);

alter table public.artisan_google_play_accounts enable row level security;
revoke all on public.artisan_google_play_accounts from public, anon, authenticated;
grant all on public.artisan_google_play_accounts to service_role;

alter table public.artisan_subscriptions enable row level security;
drop policy if exists "Artisans lisent leur abonnement" on public.artisan_subscriptions;
create policy "Artisans lisent leur abonnement"
  on public.artisan_subscriptions for select to authenticated using (auth.uid() = user_id);
revoke all on public.artisan_subscriptions from public, anon, authenticated;
grant select on public.artisan_subscriptions to authenticated;
grant all on public.artisan_subscriptions to service_role;

create table if not exists public.artisan_publication_usage (
  artisan_id uuid not null references public.profiles(id) on delete cascade,
  period_start timestamptz not null,
  publications_used integer not null default 0 check (publications_used >= 0),
  primary key (artisan_id, period_start)
);

alter table public.artisan_publication_usage enable row level security;
drop policy if exists "Artisans lisent leur consommation" on public.artisan_publication_usage;
create policy "Artisans lisent leur consommation"
  on public.artisan_publication_usage for select to authenticated using (auth.uid() = artisan_id);
revoke all on public.artisan_publication_usage from public, anon, authenticated;
grant select on public.artisan_publication_usage to authenticated;
grant all on public.artisan_publication_usage to service_role;

alter table public.artisan_subscription_plans enable row level security;
drop policy if exists "Offres d'abonnement visibles par tous" on public.artisan_subscription_plans;
create policy "Offres d'abonnement visibles par tous"
  on public.artisan_subscription_plans for select to anon, authenticated using (true);
grant select on public.artisan_subscription_plans to anon, authenticated;
grant all on public.artisan_subscription_plans to service_role;

drop policy if exists "Réalisations visibles par tous" on public.artisan_projects;
create policy "Réalisations publiées visibles par tous"
  on public.artisan_projects for select to anon, authenticated
  using (status = 'published' or auth.uid() = artisan_id);

drop policy if exists "Artisans créent leurs réalisations" on public.artisan_projects;
drop policy if exists "Artisans modifient leurs réalisations" on public.artisan_projects;
revoke insert, update on public.artisan_projects from authenticated;
grant select, delete on public.artisan_projects to authenticated;
grant all on public.artisan_projects to service_role;

drop policy if exists "Photos des réalisations visibles par tous" on public.artisan_project_media;
create policy "Photos des réalisations publiées visibles par tous"
  on public.artisan_project_media for select to anon, authenticated
  using (
    exists (
      select 1 from public.artisan_projects p
      where p.id = project_id
        and (p.status = 'published' or p.artisan_id = auth.uid())
    )
  );

drop policy if exists "Commentaires visibles par tous" on public.artisan_project_comments;
create policy "Commentaires des réalisations publiées visibles par tous"
  on public.artisan_project_comments for select to anon, authenticated
  using (
    exists (
      select 1 from public.artisan_projects p
      where p.id = project_id and p.status = 'published'
    )
  );

create or replace function private.publish_artisan_project(
  p_artisan_id uuid,
  p_project_id uuid
)
returns public.artisan_projects
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_project public.artisan_projects;
  v_tier text := 'free';
  v_period_start timestamptz;
  v_limit integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_artisan_id::text, 0));

  if not exists (
    select 1 from public.profiles
    where id = p_artisan_id and role = 'artisan'
  ) then
    raise exception using errcode = '42501', message = 'ARTISAN_REQUIRED';
  end if;

  select * into v_project
  from public.artisan_projects
  where id = p_project_id and artisan_id = p_artisan_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;

  if v_project.status = 'published' then
    return v_project;
  end if;

  if not exists (
    select 1 from public.artisan_project_media where project_id = p_project_id
  ) then
    raise exception using errcode = 'P0001', message = 'PROJECT_MEDIA_REQUIRED';
  end if;

  select tier, current_period_start
  into v_tier, v_period_start
  from public.artisan_subscriptions
  where user_id = p_artisan_id
    and status in ('active', 'grace_period', 'canceled')
    and current_period_end > now();

  if not found then
    v_tier := 'free';
    v_period_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  end if;

  select monthly_publication_limit
  into v_limit
  from public.artisan_subscription_plans
  where tier = v_tier;

  insert into public.artisan_publication_usage (artisan_id, period_start)
  values (p_artisan_id, v_period_start)
  on conflict (artisan_id, period_start) do nothing;

  select publications_used into v_used
  from public.artisan_publication_usage
  where artisan_id = p_artisan_id and period_start = v_period_start
  for update;

  if v_limit is not null and v_used >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'PUBLICATION_QUOTA_REACHED',
      detail = jsonb_build_object(
        'tier', v_tier,
        'limit', v_limit,
        'used', v_used,
        'period_start', v_period_start
      )::text;
  end if;

  update public.artisan_publication_usage
  set publications_used = publications_used + 1
  where artisan_id = p_artisan_id and period_start = v_period_start;

  update public.artisan_projects
  set status = 'published', updated_at = now()
  where id = p_project_id
  returning * into v_project;

  return v_project;
end;
$$;

revoke all on function private.publish_artisan_project(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_artisan_project_draft(
  p_title text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles where id = v_user_id and role = 'artisan'
  ) then
    raise exception using errcode = '42501', message = 'ARTISAN_REQUIRED';
  end if;

  insert into public.artisan_projects (artisan_id, title, description, status)
  values (v_user_id, trim(p_title), trim(p_description), 'draft')
  returning id into v_project_id;

  return v_project_id;
end;
$$;

create or replace function public.publish_artisan_project(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.artisan_projects;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  v_project := private.publish_artisan_project(v_user_id, p_project_id);
  return v_project.id;
end;
$$;

create or replace function public.publish_artisan_project_for_user(
  p_artisan_id uuid,
  p_project_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_project public.artisan_projects;
begin
  v_project := private.publish_artisan_project(p_artisan_id, p_project_id);
  return v_project.id;
end;
$$;

create or replace function private.artisan_subscription_summary(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tier text := 'free';
  v_status text := 'free';
  v_period_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_period_end timestamptz;
  v_plan public.artisan_subscription_plans;
  v_used integer := 0;
begin
  select tier, status, current_period_start, current_period_end
  into v_tier, v_status, v_period_start, v_period_end
  from public.artisan_subscriptions
  where user_id = p_user_id;

  if not found or v_status not in ('active', 'grace_period', 'canceled') or v_period_end <= now() then
    v_tier := 'free';
    v_period_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
    if v_period_end is not null and v_period_end <= now()
       and v_status in ('active', 'grace_period', 'canceled') then
      v_status := 'expired';
    end if;
    v_period_end := null;
    if v_status is null or v_status not in ('expired', 'on_hold', 'paused') then
      v_status := 'free';
    end if;
  end if;

  select * into v_plan
  from public.artisan_subscription_plans
  where tier = v_tier;

  select publications_used into v_used
  from public.artisan_publication_usage
  where artisan_id = p_user_id and period_start = v_period_start;

  return jsonb_build_object(
    'tier', v_plan.tier,
    'display_name', v_plan.display_name,
    'monthly_price_usd', v_plan.monthly_price_usd,
    'monthly_publication_limit', v_plan.monthly_publication_limit,
    'publications_used', coalesce(v_used, 0),
    'period_start', v_period_start,
    'current_period_end', v_period_end,
    'status', v_status,
    'features', v_plan.features
  );
end;
$$;

create or replace function public.get_artisan_subscription_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles where id = v_user_id and role = 'artisan'
  ) then
    raise exception using errcode = '42501', message = 'ARTISAN_REQUIRED';
  end if;

  return private.artisan_subscription_summary(v_user_id);
end;
$$;

create or replace function public.get_artisan_subscription_summary_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles where id = p_user_id and role = 'artisan'
  ) then
    raise exception using errcode = '42501', message = 'ARTISAN_REQUIRED';
  end if;

  return private.artisan_subscription_summary(p_user_id);
end;
$$;

revoke all on function private.artisan_subscription_summary(uuid) from public, anon, authenticated;
revoke all on function public.get_artisan_subscription_summary_for_user(uuid) from public, anon, authenticated;
revoke all on function public.create_artisan_project_draft(text, text) from public, anon;
revoke all on function public.publish_artisan_project(uuid) from public, anon;
revoke all on function public.publish_artisan_project_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_artisan_subscription_summary() from public, anon;
grant execute on function public.create_artisan_project_draft(text, text) to authenticated;
grant execute on function public.publish_artisan_project(uuid) to authenticated;
grant execute on function public.publish_artisan_project_for_user(uuid, uuid) to service_role;
grant execute on function public.get_artisan_subscription_summary() to authenticated;
grant execute on function public.get_artisan_subscription_summary_for_user(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
