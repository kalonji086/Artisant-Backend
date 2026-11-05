-- 027 : avis clients, note moyenne automatique, et notifications push
-- (déclencheurs pg_net -> backend). Prérequis : 026.

-- ============================================================
-- 1. Avis
-- ============================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes(id) on delete cascade,
  artisan_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  client_name text,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists reviews_artisan on public.reviews (artisan_id, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "Avis visibles par les utilisateurs connectés" on public.reviews;
create policy "Avis visibles par les utilisateurs connectés"
  on public.reviews for select to authenticated using (true);

-- Aucune écriture directe : uniquement via submit_review.
create or replace function public.submit_review(p_quote_id uuid, p_rating int, p_comment text default null)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes;
  v_review public.reviews;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Note invalide (1 à 5)' using errcode = '22023';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found or v_quote.client_id is distinct from auth.uid() or v_quote.artisan_id is null then
    raise exception 'Devis introuvable' using errcode = '42501';
  end if;
  if v_quote.status <> 'completed' then
    raise exception 'Vous pouvez noter un artisan une fois le travail terminé' using errcode = '22023';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.reviews (quote_id, artisan_id, client_id, client_name, rating, comment)
  values (p_quote_id, v_quote.artisan_id, auth.uid(), v_name, p_rating,
          nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
  on conflict (quote_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_review;
  return v_review;
end;
$$;

revoke all on function public.submit_review(uuid, int, text) from public, anon;
grant execute on function public.submit_review(uuid, int, text) to authenticated;

create or replace function public.refresh_artisan_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set rating = coalesce((select round(avg(rating)::numeric, 1) from public.reviews where artisan_id = new.artisan_id), 0)
  where id = new.artisan_id;
  return new;
end;
$$;

drop trigger if exists reviews_refresh_rating on public.reviews;
create trigger reviews_refresh_rating
  after insert or update on public.reviews
  for each row execute function public.refresh_artisan_rating();

-- ============================================================
-- 2. Notifications push : la base appelle le backend, qui envoie via Expo.
-- ============================================================
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.backend_config (
  key text primary key,
  value text not null
);
revoke all on private.backend_config from public, anon, authenticated;

create or replace function private.notify_backend()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.backend_config where key = 'webhook_url';
  select value into v_secret from private.backend_config where key = 'webhook_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret)
  );
  return new;
exception when others then
  return new; -- une notification ratée ne doit jamais bloquer l'écriture
end;
$$;

drop trigger if exists push_chat_messages on public.chat_messages;
create trigger push_chat_messages
  after insert on public.chat_messages
  for each row execute function private.notify_backend();

drop trigger if exists push_quotes on public.quotes;
create trigger push_quotes
  after insert or update on public.quotes
  for each row execute function private.notify_backend();

-- Après exécution, renseignez le backend (une seule fois) :
-- insert into private.backend_config (key, value) values
--   ('webhook_url', 'https://artisant-backend.onrender.com/api/v1/webhooks/supabase'),
--   ('webhook_secret', 'LE_MEME_SECRET_QUE_SUPABASE_WEBHOOK_SECRET')
-- on conflict (key) do update set value = excluded.value;
