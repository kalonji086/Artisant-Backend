-- Clients must be able to read their own requests and track their status.
alter table public.quotes enable row level security;

drop policy if exists "Clients voient leurs devis" on public.quotes;
create policy "Clients voient leurs devis"
  on public.quotes for select
  using (auth.uid() = client_id);

grant select on public.quotes to authenticated;
