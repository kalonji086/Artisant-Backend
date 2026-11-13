begin;

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
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('client', 'artisan')
  ) then
    raise exception 'Seuls les clients et artisans peuvent contacter un artisan' using errcode = '42501';
  end if;
  if p_artisan_id = auth.uid() then
    raise exception 'Vous ne pouvez pas envoyer une demande à votre propre profil' using errcode = '22023';
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
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('client', 'artisan')
  ) then
    raise exception 'Seuls les clients et artisans peuvent contacter un artisan' using errcode = '42501';
  end if;
  if p_artisan_id = auth.uid() then
    raise exception 'Vous ne pouvez pas ouvrir une discussion avec votre propre profil' using errcode = '22023';
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

commit;

notify pgrst, 'reload schema';
