-- Migration 011: Add INSERT policy to admin_email_campaigns table
-- Purpose: Allow admins to insert email campaign records

begin;

-- Add INSERT policy for admins only
drop policy if exists "Admins create email campaigns" on public.admin_email_campaigns;
create policy "Admins create email campaigns"
  on public.admin_email_campaigns
  for insert
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
