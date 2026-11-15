begin;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  full_name text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null
);

create index if not exists account_deletion_requests_status_date_idx
  on public.account_deletion_requests (status, requested_at desc);

create unique index if not exists account_deletion_requests_open_user_idx
  on public.account_deletion_requests (user_id)
  where status in ('pending', 'processing');

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant all on public.account_deletion_requests to service_role;

commit;

notify pgrst, 'reload schema';
