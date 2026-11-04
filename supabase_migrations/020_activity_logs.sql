-- Migration 020 : journal d'activité (module Logs de l'admin, temps réel)
-- Les actions passant par le backend (service role) sont journalisées par le serveur.
-- Les triggers ci-dessous ne journalisent que les écritures faites avec une session utilisateur (auth.uid() non nul),
-- afin d'éviter les doublons.
begin;

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or actor_role in ('client', 'artisan', 'admin', 'system')),
  actor_name text,
  action text not null check (length(action) between 3 and 80),
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_idx on public.activity_logs (created_at desc);
create index if not exists activity_logs_actor_idx on public.activity_logs (actor_id, created_at desc);

alter table public.activity_logs enable row level security;

drop policy if exists "Admins read activity logs" on public.activity_logs;
create policy "Admins read activity logs" on public.activity_logs
  for select using (public.is_platform_admin());

grant select on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;

-- Insertion : uniquement via ce helper (security definer) ou le service role
create or replace function public.log_activity(
  p_actor_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
begin
  if p_actor_id is not null then
    select role, full_name into v_role, v_name from public.profiles where id = p_actor_id;
  end if;

  insert into public.activity_logs (actor_id, actor_role, actor_name, action, entity_type, entity_id, metadata)
  values (p_actor_id, coalesce(v_role, 'system'), v_name, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.log_activity(uuid, text, text, text, jsonb) from public;

-- Trigger : création de compte (inscription)
create or replace function public.trg_log_profile_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_activity(new.id, 'account.created', 'profile', new.id::text,
    jsonb_build_object('role', new.role));
  return new;
end;
$$;

drop trigger if exists log_profile_created on public.profiles;
create trigger log_profile_created
  after insert on public.profiles
  for each row execute function public.trg_log_profile_created();

-- Trigger : modification de profil faite directement par l'utilisateur (session authentifiée)
create or replace function public.trg_log_profile_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role then
    perform public.log_activity(auth.uid(), 'profile.role_changed', 'profile', new.id::text,
      jsonb_build_object('from', old.role, 'to', new.role, 'target_id', new.id));
  elsif new.full_name is distinct from old.full_name or new.city is distinct from old.city
     or new.phone is distinct from old.phone or new.profession is distinct from old.profession then
    perform public.log_activity(auth.uid(), 'profile.updated', 'profile', new.id::text,
      jsonb_build_object('target_id', new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists log_profile_updated on public.profiles;
create trigger log_profile_updated
  after update on public.profiles
  for each row execute function public.trg_log_profile_updated();

-- Trigger : messages de chat envoyés directement par un utilisateur
create or replace function public.trg_log_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.sender_is_admin then
    return new;
  end if;
  perform public.log_activity(auth.uid(), 'chat.message_sent', 'chat_conversation', new.conversation_id::text,
    jsonb_build_object('length', length(new.content)));
  return new;
end;
$$;

drop trigger if exists log_chat_message on public.chat_messages;
create trigger log_chat_message
  after insert on public.chat_messages
  for each row execute function public.trg_log_chat_message();

-- Trigger : mise à jour de statut de devis faite directement par l'utilisateur
create or replace function public.trg_log_quote_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.status is not distinct from old.status then
    return new;
  end if;
  perform public.log_activity(auth.uid(), 'quote.status_changed', 'quote', new.id::text,
    jsonb_build_object('from', old.status, 'to', new.status));
  return new;
end;
$$;

drop trigger if exists log_quote_status on public.quotes;
create trigger log_quote_status
  after update of status on public.quotes
  for each row execute function public.trg_log_quote_status();

-- Realtime : le journal se met à jour en direct dans l'admin
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_logs'
  ) then
    alter publication supabase_realtime add table public.activity_logs;
  end if;
end $$;

commit;
