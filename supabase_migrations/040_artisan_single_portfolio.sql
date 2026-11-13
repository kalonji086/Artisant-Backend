begin;

create table if not exists public.artisan_portfolio_claims (
  artisan_id uuid primary key references public.profiles(id) on delete cascade,
  project_id uuid unique references public.artisan_projects(id) on delete set null,
  claimed_at timestamptz not null default now()
);

alter table public.artisan_portfolio_claims enable row level security;
revoke all on public.artisan_portfolio_claims from public, anon, authenticated;
grant all on public.artisan_portfolio_claims to service_role;

insert into public.artisan_portfolio_claims (artisan_id, project_id, claimed_at)
select distinct on (artisan_id) artisan_id, id, created_at
from public.artisan_projects
where status = 'published'
order by artisan_id, created_at, id
on conflict (artisan_id) do nothing;

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
  v_claimed_project_id uuid;
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

  insert into public.artisan_portfolio_claims (artisan_id, project_id)
  values (p_artisan_id, p_project_id)
  on conflict (artisan_id) do nothing;

  select project_id into v_claimed_project_id
  from public.artisan_portfolio_claims
  where artisan_id = p_artisan_id;

  if v_claimed_project_id is distinct from p_project_id then
    raise exception using errcode = 'P0001', message = 'PORTFOLIO_ALREADY_CREATED';
  end if;

  update public.artisan_projects
  set status = 'published', updated_at = now()
  where id = p_project_id
  returning * into v_project;

  return v_project;
end;
$$;

create or replace function public.has_artisan_portfolio_claim()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.artisan_portfolio_claims
    where artisan_id = auth.uid()
  );
$$;

revoke all on function public.has_artisan_portfolio_claim() from public, anon;
grant execute on function public.has_artisan_portfolio_claim() to authenticated;

commit;

notify pgrst, 'reload schema';
