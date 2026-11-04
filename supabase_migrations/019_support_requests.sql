-- Migration 019 : support (demandes d'aide et demandes de suppression de compte)
begin;

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('help', 'account_deletion')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  email text not null check (length(email) between 5 and 254 and email like '%_@_%'),
  full_name text check (full_name is null or length(full_name) <= 120),
  subject text check (subject is null or length(subject) <= 150),
  message text not null check (length(trim(message)) between 10 and 2000),
  admin_notes text check (admin_notes is null or length(admin_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_requests_status_created_idx
  on public.support_requests (status, created_at desc);

alter table public.support_requests enable row level security;

-- Formulaire public (page de connexion, sans compte) : seules des demandes ouvertes peuvent être créées.
drop policy if exists "Anyone submits support requests" on public.support_requests;
create policy "Anyone submits support requests" on public.support_requests
  for insert to anon, authenticated
  with check (status = 'open');

drop policy if exists "Admins read support requests" on public.support_requests;
create policy "Admins read support requests" on public.support_requests
  for select using (public.is_platform_admin());

drop policy if exists "Admins update support requests" on public.support_requests;
create policy "Admins update support requests" on public.support_requests
  for update using (public.is_platform_admin()) with check (public.is_platform_admin());

grant insert on public.support_requests to anon, authenticated;
grant select, update on public.support_requests to authenticated;
grant all on public.support_requests to service_role;

-- Realtime : la page Support de l'admin reçoit les nouvelles demandes en direct
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_requests'
  ) then
    alter publication supabase_realtime add table public.support_requests;
  end if;
end $$;

commit;
