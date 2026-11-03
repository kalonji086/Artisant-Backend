-- Migration 014 : marketing (campagnes programmées, modèles, désabonnements)
begin;

-- La table d'historique devient la table des campagnes
alter table public.admin_email_campaigns drop constraint if exists admin_email_campaigns_audience_check;
alter table public.admin_email_campaigns drop constraint if exists admin_email_campaigns_status_check;
alter table public.admin_email_campaigns drop constraint if exists admin_email_campaigns_schedule_type_check;
alter table public.admin_email_campaigns drop constraint if exists admin_email_campaigns_recurrence_check;

alter table public.admin_email_campaigns
  add column if not exists name text,
  add column if not exists html_content text,
  add column if not exists segment jsonb not null default '{}'::jsonb,
  add column if not exists schedule_type text not null default 'now',
  add column if not exists scheduled_at timestamptz,
  add column if not exists recurrence text,
  add column if not exists next_run_at timestamptz,
  add column if not exists last_run_at timestamptz,
  add column if not exists run_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.admin_email_campaigns
  add constraint admin_email_campaigns_status_check
  check (status in ('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled'));
alter table public.admin_email_campaigns
  add constraint admin_email_campaigns_schedule_type_check
  check (schedule_type in ('now', 'once', 'recurring'));
alter table public.admin_email_campaigns
  add constraint admin_email_campaigns_recurrence_check
  check (recurrence is null or recurrence in ('daily', 'weekly', 'monthly'));

create index if not exists admin_email_campaigns_due_idx
  on public.admin_email_campaigns (status, next_run_at);

-- Modèles d'emails réutilisables
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  html_content text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Adresses désinscrites (exclues de tous les envois marketing)
create table if not exists public.email_unsubscribes (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.email_templates enable row level security;
alter table public.email_unsubscribes enable row level security;

drop policy if exists "Admins read templates" on public.email_templates;
create policy "Admins read templates" on public.email_templates
  for select using (public.is_platform_admin());

drop policy if exists "Admins read unsubscribes" on public.email_unsubscribes;
create policy "Admins read unsubscribes" on public.email_unsubscribes
  for select using (public.is_platform_admin());

grant select on public.email_templates, public.email_unsubscribes to authenticated;
grant all on public.email_templates, public.email_unsubscribes to service_role;

-- Realtime : l'écran Admin suit l'état des campagnes en direct
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_email_campaigns'
  ) then
    alter publication supabase_realtime add table public.admin_email_campaigns;
  end if;
end $$;

commit;
