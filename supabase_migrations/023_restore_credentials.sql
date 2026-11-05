-- Restore Credentials (Google Play "Zero-Tap") : clés WebAuthn restaurables
-- Écrit uniquement par le backend (service role).

create table if not exists public.restore_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists restore_credentials_user_idx on public.restore_credentials(user_id);

create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  challenge text not null,
  purpose text not null check (purpose in ('registration', 'authentication')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists webauthn_challenges_expires_idx on public.webauthn_challenges(expires_at);

alter table public.restore_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;

revoke all on public.restore_credentials from public, anon, authenticated;
revoke all on public.webauthn_challenges from public, anon, authenticated;
grant all on public.restore_credentials to service_role;
grant all on public.webauthn_challenges to service_role;
