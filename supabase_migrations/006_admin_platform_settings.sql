begin;

create table if not exists public.admin_platform_settings (
  id boolean primary key default true check (id),
  platform_name text not null default 'ARTISANTS',
  support_email text not null default 'support@artisants.com',
  sender_name text not null default 'ARTISANTS',
  sender_email text not null default 'noreply@artisants.com',
  reply_to_email text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.admin_platform_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.admin_platform_settings enable row level security;

drop policy if exists "Admins manage platform settings" on public.admin_platform_settings;
create policy "Admins manage platform settings"
  on public.admin_platform_settings
  for all
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

grant select, insert, update, delete on public.admin_platform_settings to authenticated;
grant all on public.admin_platform_settings to service_role;

create table if not exists public.admin_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id),
  audience text not null check (audience in ('client', 'artisan')),
  subject text not null,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  status text not null check (status in ('sent', 'partial', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists admin_email_campaigns_created_at_idx
  on public.admin_email_campaigns (created_at desc);

alter table public.admin_email_campaigns enable row level security;

drop policy if exists "Admins view email campaign history" on public.admin_email_campaigns;
create policy "Admins view email campaign history"
  on public.admin_email_campaigns
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

grant select on public.admin_email_campaigns to authenticated;
grant all on public.admin_email_campaigns to service_role;

commit;
