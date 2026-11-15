begin;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme_mode text not null default 'system'
    check (theme_mode in ('system', 'light', 'dark')),
  accent_color text not null default 'blue'
    check (accent_color in ('blue', 'orange', 'green', 'purple')),
  language text not null default 'fr'
    check (language in ('fr', 'en')),
  notify_messages boolean not null default true,
  notify_quotes boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
drop policy if exists "Users read own preferences" on public.user_preferences;
create policy "Users read own preferences" on public.user_preferences
  for select using (auth.uid() = user_id);
drop policy if exists "Users create own preferences" on public.user_preferences;
create policy "Users create own preferences" on public.user_preferences
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own preferences" on public.user_preferences;
create policy "Users update own preferences" on public.user_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('message', 'quote')),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists app_notifications_unread_idx
  on public.app_notifications (user_id, created_at desc)
  where read_at is null;
create index if not exists app_notifications_user_date_idx
  on public.app_notifications (user_id, created_at desc);

alter table public.app_notifications enable row level security;
drop policy if exists "Users read own notifications" on public.app_notifications;
create policy "Users read own notifications" on public.app_notifications
  for select using (auth.uid() = user_id);
drop policy if exists "Users mark own notifications read" on public.app_notifications;
create policy "Users mark own notifications read" on public.app_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select on public.app_notifications to authenticated;
grant update (read_at) on public.app_notifications to authenticated;
grant all on public.app_notifications to service_role;

create or replace function public.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.chat_conversations%rowtype;
  v_recipient uuid;
begin
  select * into v_conversation
  from public.chat_conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  if v_conversation.kind = 'support' then
    v_recipient := v_conversation.user_a;
  elsif new.sender_id = v_conversation.user_a then
    v_recipient := v_conversation.user_b;
  else
    v_recipient := v_conversation.user_a;
  end if;

  if v_recipient is null or v_recipient = new.sender_id
    or not coalesce((
      select notify_messages from public.user_preferences where user_id = v_recipient
    ), true) then
    return new;
  end if;

  insert into public.app_notifications (user_id, kind, title, body, data)
  values (
    v_recipient,
    'message',
    case
      when new.sender_is_admin and coalesce((
        select language from public.user_preferences where user_id = v_recipient
      ), 'fr') = 'en' then 'New support message'
      when new.sender_is_admin then 'Nouveau message du support'
      when coalesce((
        select language from public.user_preferences where user_id = v_recipient
      ), 'fr') = 'en' then 'New message'
      else 'Nouveau message'
    end,
    left(new.content, 180),
    jsonb_build_object('screen', 'messages', 'conversation_id', new.conversation_id)
  );
  return new;
end;
$$;

drop trigger if exists chat_message_notification on public.chat_messages;
create trigger chat_message_notification
  after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

create or replace function public.notify_quote_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_assignment boolean := false;
begin
  if tg_op = 'INSERT' then
    v_new_assignment := new.artisan_id is not null;
  else
    v_new_assignment := new.artisan_id is not null
      and new.artisan_id is distinct from old.artisan_id;
  end if;

  if v_new_assignment and coalesce((
    select notify_quotes from public.user_preferences where user_id = new.artisan_id
  ), true) then
    insert into public.app_notifications (user_id, kind, title, body, data)
    values (
      new.artisan_id,
      'quote',
      case coalesce((
        select language from public.user_preferences where user_id = new.artisan_id
      ), 'fr') when 'en' then 'New request assigned' else 'Nouvelle demande attribuée' end,
      coalesce(nullif(new.title, ''), nullif(new.category, ''), 'Une demande vous a été attribuée'),
      jsonb_build_object('screen', 'dashboard', 'quote_id', new.id)
    );
  end if;

  if v_new_assignment and new.client_id is not null
    and coalesce((
      select notify_quotes from public.user_preferences where user_id = new.client_id
    ), true) then
    insert into public.app_notifications (user_id, kind, title, body, data)
    values (
      new.client_id,
      'quote',
      case coalesce((
        select language from public.user_preferences where user_id = new.client_id
      ), 'fr') when 'en' then 'Professional assigned' else 'Artisan trouvé' end,
      case coalesce((
        select language from public.user_preferences where user_id = new.client_id
      ), 'fr') when 'en' then 'A professional has been assigned to your request.'
        else 'Un artisan a été attribué à votre demande.' end,
      jsonb_build_object('screen', 'quotes', 'quote_id', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status
    and new.client_id is not null
    and coalesce((
      select notify_quotes from public.user_preferences where user_id = new.client_id
    ), true) then
    insert into public.app_notifications (user_id, kind, title, body, data)
    values (
      new.client_id,
      'quote',
      case coalesce((
        select language from public.user_preferences where user_id = new.client_id
      ), 'fr') when 'en' then 'Your request was updated' else 'Mise à jour de votre demande' end,
      case coalesce((
        select language from public.user_preferences where user_id = new.client_id
      ), 'fr') when 'en'
        then 'Your request status is now: ' || new.status || '.'
        else 'Le statut de votre demande est maintenant : ' ||
          case new.status
            when 'unassigned' then 'en attente d’attribution'
            when 'assigned' then 'attribuée'
            when 'pending' then 'en attente de réponse'
            when 'accepted' then 'acceptée'
            when 'rejected' then 'refusée'
            when 'completed' then 'terminée'
            else new.status
          end || '.' end,
      jsonb_build_object('screen', 'quotes', 'quote_id', new.id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists quote_change_notification on public.quotes;
create trigger quote_change_notification
  after insert or update of artisan_id, status on public.quotes
  for each row execute function public.notify_quote_change();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_preferences'
  ) then
    alter publication supabase_realtime add table public.user_preferences;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_notifications'
  ) then
    alter publication supabase_realtime add table public.app_notifications;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
