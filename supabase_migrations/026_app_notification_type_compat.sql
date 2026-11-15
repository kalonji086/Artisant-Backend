begin;

alter table public.app_notifications
  add column if not exists notification_type text;

update public.app_notifications
set notification_type = case
  when kind = 'message' then 'chat'
  else 'quote'
end
where notification_type is null or btrim(notification_type) = '';

alter table public.app_notifications
  alter column notification_type set not null;

create or replace function public.fill_app_notification_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.notification_type is null or btrim(new.notification_type) = '' then
    new.notification_type := case new.kind
      when 'message' then 'chat'
      else 'quote'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists app_notifications_fill_notification_type on public.app_notifications;
create trigger app_notifications_fill_notification_type
  before insert on public.app_notifications
  for each row execute function public.fill_app_notification_type();

commit;

notify pgrst, 'reload schema';
