begin;

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  submitted_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null
);

create index if not exists support_requests_status_date_idx
  on public.support_requests (status, submitted_at desc);

alter table public.support_requests enable row level security;
revoke all on public.support_requests from anon, authenticated;
grant all on public.support_requests to service_role;

commit;

notify pgrst, 'reload schema';
