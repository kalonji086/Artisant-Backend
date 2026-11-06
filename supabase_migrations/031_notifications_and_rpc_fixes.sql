begin;

alter table public.profiles
  add column if not exists expo_push_token text;

create or replace function public.create_direct_quote(
  p_artisan_id uuid,
  p_description text,
  p_category text default null,
  p_title text default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
  v_lat double precision;
  v_lng double precision;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'client') then
    raise exception 'Seuls les clients peuvent envoyer une demande' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_artisan_id and role = 'artisan') then
    raise exception 'Artisan introuvable' using errcode = '22023';
  end if;
  if p_description is null or length(trim(p_description)) = 0 or length(p_description) > 1000 then
    raise exception 'Description requise (1000 caractères max)' using errcode = '22023';
  end if;

  select latitude, longitude into v_lat, v_lng
  from public.user_locations
  where user_id = auth.uid();

  insert into public.quotes (
    client_id, artisan_id, description, status, latitude, longitude,
    category, title, direct_request, assigned_at
  )
  values (
    auth.uid(), p_artisan_id, trim(p_description), 'pending', v_lat, v_lng,
    nullif(trim(coalesce(p_category, '')), ''),
    nullif(trim(coalesce(p_title, '')), ''), true, now()
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

revoke all on function public.create_direct_quote(uuid, text, text, text) from public, anon;
grant execute on function public.create_direct_quote(uuid, text, text, text) to authenticated;

create or replace function public.start_direct_chat(p_artisan_id uuid)
returns public.chat_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.chat_conversations;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = p_artisan_id and role = 'artisan') then
    raise exception 'Artisan introuvable' using errcode = '22023';
  end if;

  select * into v_conv
  from public.chat_conversations
  where kind = 'direct' and user_a = auth.uid() and user_b = p_artisan_id;

  if not found then
    insert into public.chat_conversations (kind, user_a, user_b)
    values ('direct', auth.uid(), p_artisan_id)
    returning * into v_conv;
  end if;

  return v_conv;
end;
$$;

revoke all on function public.start_direct_chat(uuid) from public, anon;
grant execute on function public.start_direct_chat(uuid) to authenticated;

create or replace function public.set_my_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if p_token is not null and (length(p_token) = 0 or length(p_token) > 255) then
    raise exception 'Token de notification invalide' using errcode = '22023';
  end if;

  update public.profiles
  set expo_push_token = p_token
  where id = auth.uid();

  if not found then
    raise exception 'Profil introuvable' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_my_push_token(text) from public, anon;
grant execute on function public.set_my_push_token(text) to authenticated;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists app_notifications_user_created
  on public.app_notifications (user_id, created_at desc);

alter table public.app_notifications enable row level security;

drop policy if exists "Users read own notifications" on public.app_notifications;
create policy "Users read own notifications"
  on public.app_notifications for select to authenticated
  using (auth.uid() = user_id);

grant select on public.app_notifications to authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;

  update public.app_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.notify_quote_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_label text;
begin
  if tg_op = 'INSERT' then
    if new.artisan_id is not null then
      insert into public.app_notifications (user_id, notification_type, title, body, data)
      values (
        new.artisan_id,
        'quote',
        'Nouvelle demande',
        coalesce(nullif(new.title, ''), nullif(new.category, ''), 'Un client vous a envoyé une demande.'),
        jsonb_build_object('quoteId', new.id)
      );
    end if;
    return new;
  end if;

  if new.artisan_id is distinct from old.artisan_id and new.artisan_id is not null then
    insert into public.app_notifications (user_id, notification_type, title, body, data)
    values (
      new.artisan_id,
      'quote',
      'Nouvelle demande',
      coalesce(nullif(new.title, ''), nullif(new.category, ''), 'Une demande vous a été attribuée.'),
      jsonb_build_object('quoteId', new.id)
    );
  end if;

  if new.status is distinct from old.status and new.client_id is not null then
    v_status_label := case new.status
      when 'assigned' then 'attribuée'
      when 'pending' then 'en attente'
      when 'accepted' then 'acceptée'
      when 'in_progress' then 'en cours'
      when 'rejected' then 'refusée'
      when 'completed' then 'terminée'
      else new.status
    end;
    insert into public.app_notifications (user_id, notification_type, title, body, data)
    values (
      new.client_id,
      'quote',
      'Mise à jour de votre demande',
      'Votre demande est maintenant ' || v_status_label || '.',
      jsonb_build_object('quoteId', new.id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists app_notifications_quote_activity on public.quotes;
create trigger app_notifications_quote_activity
  after insert or update of status, artisan_id on public.quotes
  for each row execute function public.notify_quote_activity();

create or replace function public.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.chat_conversations;
  v_recipient uuid;
begin
  select * into v_conv
  from public.chat_conversations
  where id = new.conversation_id;

  if not found then
    return new;
  end if;

  if new.sender_id = v_conv.user_a then
    v_recipient := v_conv.user_b;
  else
    v_recipient := v_conv.user_a;
  end if;

  if v_recipient is not null and v_recipient <> new.sender_id then
    insert into public.app_notifications (user_id, notification_type, title, body, data)
    values (
      v_recipient,
      'chat',
      'Nouveau message',
      left(new.content, 160),
      jsonb_build_object('conversationId', new.conversation_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists app_notifications_chat_message on public.chat_messages;
create trigger app_notifications_chat_message
  after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_notifications'
  ) then
    alter publication supabase_realtime add table public.app_notifications;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
