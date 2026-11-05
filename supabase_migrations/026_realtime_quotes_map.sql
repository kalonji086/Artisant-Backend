-- 026 : devis temps réel (statut "en cours", commentaire artisan, refus visible),
-- demande directe à un artisan, carte (en ligne / téléphone public). Prérequis : 013, 018.

alter table public.quotes
  add column if not exists artisan_comment text,
  add column if not exists direct_request boolean not null default false;

alter table public.profiles
  add column if not exists phone_public boolean not null default false,
  add column if not exists expo_push_token text;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.quotes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.quotes drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.quotes
  add constraint quotes_status_check
  check (status in ('unassigned', 'assigned', 'pending', 'accepted', 'in_progress', 'rejected', 'completed'));

-- Demande directe à un artisan (bouton « Demander un devis » / exploit sur la carte).
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
  select ul.latitude, ul.longitude into v_lat, v_lng
  from public.user_locations ul where ul.user_id = auth.uid();

  insert into public.quotes (client_id, artisan_id, description, status, latitude, longitude,
                             category, title, direct_request, assigned_at)
  values (auth.uid(), p_artisan_id, trim(p_description), 'pending', v_lat, v_lng,
          nullif(trim(coalesce(p_category, '')), ''),
          nullif(trim(coalesce(p_title, '')), ''), true, now())
  returning * into v_quote;
  return v_quote;
end;
$$;

revoke all on function public.create_direct_quote(uuid, text, text, text) from public, anon;
grant execute on function public.create_direct_quote(uuid, text, text, text) to authenticated;

-- L'artisan répond : accepter, refuser, mettre en cours, terminer (+ prix et commentaire).
drop function if exists public.artisan_respond_to_quote(uuid, text, numeric);

create or replace function public.artisan_respond_to_quote(
  p_quote_id uuid,
  p_action text,
  p_price numeric default null,
  p_comment text default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
  v_comment text := nullif(left(trim(coalesce(p_comment, '')), 1000), '');
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or v_quote.artisan_id is distinct from auth.uid() then
    raise exception 'Devis introuvable' using errcode = '42501';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'Prix invalide' using errcode = '22023';
  end if;

  if p_action = 'accept' and v_quote.status in ('assigned', 'pending') then
    update public.quotes
    set status = 'accepted', price = coalesce(p_price, price),
        artisan_comment = coalesce(v_comment, artisan_comment)
    where id = p_quote_id returning * into v_quote;
  elsif p_action = 'reject' and v_quote.status in ('assigned', 'pending') then
    update public.quotes
    set status = 'rejected', artisan_comment = coalesce(v_comment, artisan_comment)
    where id = p_quote_id returning * into v_quote;
  elsif p_action = 'start' and v_quote.status = 'accepted' then
    update public.quotes
    set status = 'in_progress', artisan_comment = coalesce(v_comment, artisan_comment)
    where id = p_quote_id returning * into v_quote;
  elsif p_action = 'complete' and v_quote.status in ('accepted', 'in_progress') then
    update public.quotes
    set status = 'completed', price = coalesce(p_price, price),
        artisan_comment = coalesce(v_comment, artisan_comment)
    where id = p_quote_id returning * into v_quote;
  else
    raise exception 'Action impossible pour le statut actuel (%)', v_quote.status using errcode = '22023';
  end if;
  return v_quote;
end;
$$;

revoke all on function public.artisan_respond_to_quote(uuid, text, numeric, text) from public, anon;
grant execute on function public.artisan_respond_to_quote(uuid, text, numeric, text) to authenticated;

-- L'admin peut réassigner un devis refusé.
create or replace function public.admin_assign_quote(p_quote_id uuid, p_artisan_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_artisan_id and role = 'artisan') then
    raise exception 'Artisan introuvable' using errcode = '22023';
  end if;
  update public.quotes
  set artisan_id = p_artisan_id, status = 'assigned', assigned_at = now(),
      assigned_by = auth.uid(), artisan_comment = null
  where id = p_quote_id and status in ('unassigned', 'assigned', 'pending', 'rejected')
  returning * into v_quote;
  if not found then
    raise exception 'Devis introuvable ou déjà accepté/terminé' using errcode = '22023';
  end if;
  return v_quote;
end;
$$;

-- Carte : artisans avec photo, statut en ligne (position vue < 5 min) et téléphone si public.
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
  longitude double precision,
  phone text,
  is_online boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.profession, p.description, p.city, p.avatar_url,
         coalesce(p.rating, 0)::numeric,
         d.dist, ul.latitude, ul.longitude,
         case when p.phone_public then p.phone else null end,
         (ul.updated_at > now() - interval '5 minutes')
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
  limit 100;
$$;

revoke all on function public.nearby_artisans(double precision, double precision, int, text) from public, anon;
grant execute on function public.nearby_artisans(double precision, double precision, int, text) to authenticated;

-- Temps réel : les devis, profils, positions et messages sont publiés.
do $$
declare t text;
begin
  foreach t in array array['quotes', 'profiles', 'user_locations', 'chat_messages', 'chat_conversations'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- Contacter un artisan directement depuis la carte (sans devis préalable).
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
  select * into v_conv from public.chat_conversations
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
