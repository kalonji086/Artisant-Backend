begin;

drop policy if exists "Profils visibles par tous" on public.profiles;
create policy "Profils visibles par tous"
  on public.profiles
  for select
  using (role is distinct from 'admin');

commit;
