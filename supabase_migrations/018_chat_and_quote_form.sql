-- 018 : formulaire de devis complet, messagerie (client / artisan / Admin « Artisant »),
-- et carte des artisans proches. Prérequis : 013 exécutée.

-- ============================================================
-- 1. Devis : champs supplémentaires
-- ============================================================
alter table public.quotes
  add column if not exists category text,
  add column if not exists title text,
  add column if not exists urgency text not null default 'normal',
  add column if not exists address text,
  add column if not exists budget numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_urgency_check') then
    alter table public.quotes
      add constraint quotes_urgency_check check (urgency in ('flexible', 'normal', 'urgent'));
  end if;
end
$$;

drop function if exists public.create_quote_request(text, double precision, double precision);
drop function if exists public.create_quote_request(text, double precision, double precision, text, text, text, text, numeric);

create or replace function public.create_quote_request(
  p_description text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_category text default null,
  p_title text default null,
  p_urgency text default 'normal',
  p_address text default null,
  p_budget numeric default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision := p_latitude;
  v_lng double precision := p_longitude;
  v_quote public.quotes;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'client') then
    raise exception 'Seuls les clients peuvent demander un devis' using errcode = '42501';
  end if;
  if p_category is null or length(trim(p_category)) = 0 or length(p_category) > 80 then
    raise exception 'Catégorie requise' using errcode = '22023';
  end if;
  if p_description is null or length(trim(p_description)) < 10 or length(p_description) > 1000 then
    raise exception 'Description requise (10 à 1000 caractères)' using errcode = '22023';
  end if;
  if p_title is not null and length(p_title) > 120 then
    raise exception 'Titre trop long' using errcode = '22023';
  end if;
  if p_address is not null and length(p_address) > 250 then
    raise exception 'Adresse trop longue' using errcode = '22023';
  end if;
  if p_budget is not null and p_budget < 0 then
    raise exception 'Budget invalide' using errcode = '22023';
  end if;
  if coalesce(p_urgency, 'normal') not in ('flexible', 'normal', 'urgent') then
    raise exception 'Urgence invalide' using errcode = '22023';
  end if;

  if v_lat is null or v_lng is null then
    select ul.latitude, ul.longitude into v_lat, v_lng
    from public.user_locations ul where ul.user_id = auth.uid();
  end if;

  insert into public.quotes (client_id, description, status, latitude, longitude,
                             category, title, urgency, address, budget)
  values (auth.uid(), trim(p_description), 'unassigned', v_lat, v_lng,
          trim(p_category), nullif(trim(coalesce(p_title, '')), ''),
          coalesce(p_urgency, 'normal'), nullif(trim(coalesce(p_address, '')), ''), p_budget)
  returning * into v_quote;

  return v_quote;
end;
$$;

revoke all on function public.create_quote_request(text, double precision, double precision, text, text, text, text, numeric) from public, anon;
grant execute on function public.create_quote_request(text, double precision, double precision, text, text, text, text, numeric) to authenticated;

-- ============================================================
-- 2. Artisans proches (avec coordonnées pour la carte)
-- ============================================================
drop function if exists public.nearby_artisans(double precision, double precision, int, text);

create or replace function public.nearby_artisans(
  lat double precision,
  lng double precision,
  radius_meters int default 50000,
  profession_filter text default null
)
returns table (
  id uuid,
  full_name text,
  profession text,
  description text,
  city text,
  avatar_url text,
  rating numeric,
  distance_m double precision,
  latitude double precision,
  longitude double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.profession, p.description, p.city, p.avatar_url,
         coalesce(p.rating, 0)::numeric,
         d.dist, ul.latitude, ul.longitude
  from public.profiles p
  join public.user_locations ul on ul.user_id = p.id
  cross join lateral (
    select public.haversine_m(lat, lng, ul.latitude, ul.longitude) as dist
  ) d
  where p.role = 'artisan'
    and coalesce(p.is_available, true)
    and d.dist <= radius_meters
    and (profession_filter is null or p.profession ilike profession_filter)
  order by d.dist
  limit 50;
$$;

revoke all on function public.nearby_artisans(double precision, double precision, int, text) from public, anon;
grant execute on function public.nearby_artisans(double precision, double precision, int, text) to authenticated;

-- ============================================================
-- 3. Messagerie
-- ============================================================
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'support')),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid references public.profiles(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  last_message text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((kind = 'direct' and user_b is not null) or (kind = 'support' and user_b is null))
);

create unique index if not exists chat_direct_unique
  on public.chat_conversations (user_a, user_b) where kind = 'direct';
create unique index if not exists chat_support_unique
  on public.chat_conversations (user_a) where kind = 'support';
create index if not exists chat_conv_user_b on public.chat_conversations (user_b);
create index if not exists chat_conv_last on public.chat_conversations (last_message_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_is_admin boolean not null default false,
  content text not null check (length(trim(content)) > 0 and length(content) <= 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists chat_msg_conv on public.chat_messages (conversation_id, created_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "Conversations visibles par leurs membres" on public.chat_conversations;
create policy "Conversations visibles par leurs membres"
  on public.chat_conversations for select
  using (auth.uid() = user_a or auth.uid() = user_b or public.is_platform_admin());

drop policy if exists "Messages visibles par les membres" on public.chat_messages;
create policy "Messages visibles par les membres"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b or public.is_platform_admin())
    )
  );

-- Aucune écriture directe : uniquement via les fonctions ci-dessous.

create or replace function public.start_support_chat()
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
  select * into v_conv from public.chat_conversations
  where kind = 'support' and user_a = auth.uid();
  if not found then
    insert into public.chat_conversations (kind, user_a) values ('support', auth.uid())
    returning * into v_conv;
  end if;
  return v_conv;
end;
$$;

create or replace function public.start_quote_chat(p_quote_id uuid)
returns public.chat_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
  v_conv public.chat_conversations;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found or v_quote.artisan_id is null
     or auth.uid() not in (v_quote.client_id, v_quote.artisan_id) then
    raise exception 'Discussion impossible pour ce devis' using errcode = '42501';
  end if;
  select * into v_conv from public.chat_conversations
  where kind = 'direct' and user_a = v_quote.client_id and user_b = v_quote.artisan_id;
  if not found then
    insert into public.chat_conversations (kind, user_a, user_b, quote_id)
    values ('direct', v_quote.client_id, v_quote.artisan_id, p_quote_id)
    returning * into v_conv;
  end if;
  return v_conv;
end;
$$;

create or replace function public.send_chat_message(p_conversation_id uuid, p_content text)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.chat_conversations;
  v_msg public.chat_messages;
  v_text text := trim(coalesce(p_content, ''));
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if length(v_text) = 0 or length(v_text) > 2000 then
    raise exception 'Message invalide (1 à 2000 caractères)' using errcode = '22023';
  end if;
  select * into v_conv from public.chat_conversations where id = p_conversation_id;
  if not found or auth.uid() not in (v_conv.user_a, coalesce(v_conv.user_b, v_conv.user_a)) then
    raise exception 'Conversation introuvable' using errcode = '42501';
  end if;
  insert into public.chat_messages (conversation_id, sender_id, content)
  values (p_conversation_id, auth.uid(), v_text)
  returning * into v_msg;
  update public.chat_conversations
    set last_message = left(v_text, 200), last_message_at = v_msg.created_at
  where id = p_conversation_id;
  return v_msg;
end;
$$;

create or replace function public.mark_chat_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  update public.chat_messages m
    set read_at = now()
  from public.chat_conversations c
  where m.conversation_id = c.id
    and c.id = p_conversation_id
    and auth.uid() in (c.user_a, coalesce(c.user_b, c.user_a))
    and m.sender_id <> auth.uid()
    and m.read_at is null;
end;
$$;

revoke all on function public.start_support_chat() from public, anon;
revoke all on function public.start_quote_chat(uuid) from public, anon;
revoke all on function public.send_chat_message(uuid, text) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.start_support_chat() to authenticated;
grant execute on function public.start_quote_chat(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Temps réel
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_conversations') then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;
end
$$;
