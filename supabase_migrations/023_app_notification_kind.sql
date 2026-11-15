-- Repair existing notification tables created before the kind column existed.
begin;

alter table public.app_notifications
  add column if not exists kind text;

update public.app_notifications
set kind = case
  when kind in ('message', 'quote') then kind
  when data ->> 'screen' = 'messages' then 'message'
  else 'quote'
end
where kind is null or kind not in ('message', 'quote');

alter table public.app_notifications
  alter column kind set default 'quote',
  alter column kind set not null;

alter table public.app_notifications
  drop constraint if exists app_notifications_kind_check;
alter table public.app_notifications
  add constraint app_notifications_kind_check check (kind in ('message', 'quote'));

grant select on public.app_notifications to authenticated;
grant update (read_at) on public.app_notifications to authenticated;
grant all on public.app_notifications to service_role;

commit;

notify pgrst, 'reload schema';
