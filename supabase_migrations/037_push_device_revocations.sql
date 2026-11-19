begin;

create table if not exists public.push_device_revocations (
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null,
  platform text not null check (platform in ('ios', 'android', 'unknown')),
  revoked_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  primary key (user_id, token_hash)
);

alter table public.push_device_revocations enable row level security;
revoke all on public.push_device_revocations from anon, authenticated;
grant all on public.push_device_revocations to service_role;

comment on table public.push_device_revocations is
  'Jetons push révoqués par l’administration; la révocation survit à la réinscription automatique du mobile.';

commit;

notify pgrst, 'reload schema';
