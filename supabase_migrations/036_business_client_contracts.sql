begin;

alter table public.quotes
  add column if not exists business_type text
    check (business_type is null or business_type in ('enterprise', 'subcontractor')),
  add column if not exists business_company_name text;

drop function if exists public.nearby_artisans(double precision, double precision, integer, text);
drop function if exists public.nearby_artisans(double precision, double precision, integer, text, text);
create function public.nearby_artisans(
  lat double precision,
  lng double precision,
  radius_meters int default 50000,
  profession_filter text default null,
  p_business_type_filter text default null
)
returns table (
  id uuid,
  full_name text,
  profession text,
  description text,
  city text,
  avatar_url text,
  phone text,
  address text,
  country text,
  years_experience int,
  service_radius_km int,
  rating numeric,
  distance_m double precision,
  latitude double precision,
  longitude double precision,
  business_type text,
  company_name text,
  business_contact_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_business_type_filter is not null
    and p_business_type_filter not in ('enterprise', 'subcontractor') then
    raise exception 'Catégorie entreprise invalide' using errcode = '22023';
  end if;

  return query
  select p.id, p.full_name, p.profession,
         coalesce(business.description, p.description), p.city, p.avatar_url,
         coalesce(business.contact_phone, p.phone),
         coalesce(business.company_address, p.address),
         coalesce(business.country, details.country),
         details.years_experience, details.service_radius_km,
         coalesce(p.rating, 0)::numeric,
         distance.dist, ul.latitude, ul.longitude, p.business_type,
         business.company_name, business.contact_email
  from public.profiles p
  join public.user_locations ul on ul.user_id = p.id
  join public.artisan_map_preferences pref on pref.artisan_id = p.id and pref.visible
  left join public.profile_details details on details.user_id = p.id
  left join public.business_profiles business on business.owner_id = p.id
  cross join lateral (
    select public.haversine_m(lat, lng, ul.latitude, ul.longitude) as dist
  ) distance
  where p.role = 'artisan'
    and coalesce(p.is_available, true)
    and ul.updated_at > now() - interval '5 minutes'
    and lat between -90 and 90
    and lng between -180 and 180
    and radius_meters between 1 and 50000
    and distance.dist <= radius_meters
    and (profession_filter is null or p.profession ilike profession_filter)
    and (
      p_business_type_filter is null
      or (
        p.business_type = p_business_type_filter
        and business.owner_id is not null
        and p.business_modules @> array['contracts']::text[]
      )
    )
    and exists (
      select 1
      from public.user_locations viewer_location
      where viewer_location.user_id = auth.uid()
        and viewer_location.updated_at > now() - interval '5 minutes'
        and public.haversine_m(lat, lng, viewer_location.latitude, viewer_location.longitude) <= 1000
    )
    and exists (
      select 1 from public.profiles viewer
      where viewer.id = auth.uid() and viewer.role = 'client'
    )
  order by distance.dist
  limit 50;
end;
$$;
revoke all on function public.nearby_artisans(double precision, double precision, integer, text, text) from public, anon;
grant execute on function public.nearby_artisans(double precision, double precision, integer, text, text) to authenticated;

drop function if exists public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric, boolean
);
drop function if exists public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric, boolean, uuid
);
create function public.create_quote_request(
  p_description text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_category text default null,
  p_title text default null,
  p_urgency text default 'normal',
  p_address text default null,
  p_budget numeric default null,
  p_share_location boolean default false,
  p_provider_id uuid default null
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
  v_business_type text;
  v_company_name text;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client') then
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

  if p_provider_id is not null then
    select p.business_type, b.company_name
    into v_business_type, v_company_name
    from public.profiles p
    join public.business_profiles b on b.owner_id = p.id
    where p.id = p_provider_id
      and p.id <> auth.uid()
      and p.role = 'artisan'
      and p.business_type in ('enterprise', 'subcontractor')
      and p.business_modules @> array['contracts']::text[];
    if not found then
      raise exception 'Cette entreprise ne peut pas recevoir de demande de contrat.' using errcode = '22023';
    end if;
  end if;

  if v_lat is null or v_lng is null then
    select ul.latitude, ul.longitude into v_lat, v_lng
    from public.user_locations ul
    where ul.user_id = auth.uid();
  end if;

  if p_share_location and (v_lat is null or v_lng is null) then
    raise exception 'Position indisponible : autorisez la localisation avant de partager votre position' using errcode = '22023';
  end if;

  insert into public.quotes (
    client_id, artisan_id, description, status, latitude, longitude, category, title,
    urgency, address, budget, share_location_with_artisan, assigned_at,
    business_type, business_company_name
  )
  values (
    auth.uid(), p_provider_id, trim(p_description),
    case when p_provider_id is null then 'unassigned' else 'pending' end,
    v_lat, v_lng, trim(p_category),
    nullif(trim(coalesce(p_title, '')), ''), coalesce(p_urgency, 'normal'),
    nullif(trim(coalesce(p_address, '')), ''), p_budget, coalesce(p_share_location, false),
    case when p_provider_id is null then null else now() end,
    v_business_type, v_company_name
  )
  returning * into v_quote;

  return v_quote;
end;
$$;
revoke all on function public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric, boolean, uuid
) from public, anon;
grant execute on function public.create_quote_request(
  text, double precision, double precision, text, text, text, text, numeric, boolean, uuid
) to authenticated;

create table if not exists public.business_client_contracts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  company_name text not null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  document_path text not null,
  status text not null default 'draft'
    check (status in ('draft', 'signing', 'signed', 'declined', 'canceled')),
  company_signer_name text not null,
  company_signer_email text not null,
  company_signed_by uuid references public.profiles(id),
  company_signed_name text,
  company_signed_at timestamptz,
  company_signature_consent text,
  client_signer_name text not null,
  client_signer_email text not null,
  client_signed_by uuid references public.profiles(id),
  client_signed_name text,
  client_signed_at timestamptz,
  client_signature_consent text,
  amount numeric(12,2) check (amount is null or amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id <> client_id)
);

create index if not exists business_client_contracts_owner_idx
  on public.business_client_contracts (owner_id, created_at desc);
create index if not exists business_client_contracts_client_idx
  on public.business_client_contracts (client_id, created_at desc);
create unique index if not exists business_client_contracts_quote_active_idx
  on public.business_client_contracts (quote_id)
  where status in ('draft', 'signing', 'signed');

alter table public.business_client_contracts enable row level security;
drop policy if exists business_client_contracts_participant_read on public.business_client_contracts;
create policy business_client_contracts_participant_read
  on public.business_client_contracts for select to authenticated
  using (
    (auth.uid() = owner_id and public.business_has_module(owner_id, 'contracts'))
    or (auth.uid() = client_id and status in ('signing', 'signed'))
  );
revoke all on public.business_client_contracts from anon;
grant select on public.business_client_contracts to authenticated;
grant all on public.business_client_contracts to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-client-contracts', 'business-client-contracts', false, 20971520, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_client_contract_documents_insert on storage.objects;
create policy business_client_contract_documents_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'business-client-contracts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.profiles p
      join public.quotes q on q.artisan_id = p.id
      where p.id = auth.uid()
        and p.business_type is not null
        and p.business_modules @> array['contracts']::text[]
        and q.id::text = (storage.foldername(name))[2]
        and q.status = 'accepted'
    )
  );

drop policy if exists business_client_contract_documents_read on storage.objects;
create policy business_client_contract_documents_read on storage.objects
  for select to authenticated using (
    bucket_id = 'business-client-contracts'
    and exists (
      select 1 from public.business_client_contracts c
      where c.document_path = name
        and (
          (c.owner_id = auth.uid() and public.business_has_module(c.owner_id, 'contracts'))
          or (c.client_id = auth.uid() and c.status in ('signing', 'signed'))
        )
    )
  );

drop policy if exists business_client_contract_documents_delete on storage.objects;
create policy business_client_contract_documents_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'business-client-contracts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.business_has_module(auth.uid(), 'contracts')
  );

create or replace function public.sign_business_client_contract(
  p_contract_id uuid,
  p_signer_user_id uuid,
  p_full_name text,
  p_confirmed boolean
)
returns public.business_client_contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.business_client_contracts;
  v_expected_name text;
  v_consent text := 'Je confirme avoir lu le contrat, en accepter le contenu et signer dans ARTISANTS.';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Accès interdit' using errcode = '42501';
  end if;
  if p_confirmed is distinct from true then
    raise exception 'Une confirmation explicite est requise.' using errcode = '22023';
  end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 120 then
    raise exception 'Saisissez votre nom complet (2 à 120 caractères).' using errcode = '22023';
  end if;

  select * into v_contract
  from public.business_client_contracts
  where id = p_contract_id
  for update;
  if not found then
    raise exception 'Contrat introuvable.' using errcode = 'P0002';
  end if;

  if p_signer_user_id = v_contract.owner_id then
    v_expected_name := v_contract.company_signer_name;
    if v_contract.status <> 'draft' or v_contract.company_signed_at is not null then
      raise exception 'Ce contrat n’est plus disponible pour la signature de l’entreprise.' using errcode = '55000';
    end if;
    if lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
       is distinct from lower(regexp_replace(btrim(v_expected_name), '\s+', ' ', 'g')) then
      raise exception 'Le nom saisi doit correspondre au signataire de l’entreprise.' using errcode = '22023';
    end if;

    update public.business_client_contracts
    set company_signed_by = p_signer_user_id,
        company_signed_name = btrim(p_full_name),
        company_signed_at = now(),
        company_signature_consent = v_consent,
        status = 'signing',
        updated_at = now()
    where id = p_contract_id
    returning * into v_contract;
  elsif p_signer_user_id = v_contract.client_id then
    v_expected_name := v_contract.client_signer_name;
    if v_contract.status <> 'signing' or v_contract.company_signed_at is null then
      raise exception 'L’entreprise doit signer avant que le client puisse signer.' using errcode = '55000';
    end if;
    if v_contract.client_signed_at is not null then
      raise exception 'La signature du client est déjà enregistrée.' using errcode = '23505';
    end if;
    if lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
       is distinct from lower(regexp_replace(btrim(v_expected_name), '\s+', ' ', 'g')) then
      raise exception 'Le nom saisi doit correspondre au nom complet du client.' using errcode = '22023';
    end if;

    update public.business_client_contracts
    set client_signed_by = p_signer_user_id,
        client_signed_name = btrim(p_full_name),
        client_signed_at = now(),
        client_signature_consent = v_consent,
        status = 'signed',
        updated_at = now()
    where id = p_contract_id
    returning * into v_contract;
  else
    raise exception 'Vous n’êtes pas signataire de ce contrat.' using errcode = '42501';
  end if;

  return v_contract;
end;
$$;

revoke all on function public.sign_business_client_contract(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.sign_business_client_contract(uuid, uuid, text, boolean)
  to service_role;

create or replace function public.notify_business_client_contract_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.company_signed_at is null and new.company_signed_at is not null
    and coalesce((select notify_quotes from public.user_preferences where user_id = new.client_id), true) then
    insert into public.app_notifications (user_id, kind, title, body, data)
    values (
      new.client_id,
      'quote',
      'Contrat prêt à signer',
      new.company_name || ' a signé « ' || new.title || ' ». À vous de signer.',
      jsonb_build_object('screen', 'quotes', 'quote_id', new.quote_id, 'contract_id', new.id)
    );
  elsif old.client_signed_at is null and new.client_signed_at is not null
    and coalesce((select notify_quotes from public.user_preferences where user_id = new.owner_id), true) then
    insert into public.app_notifications (user_id, kind, title, body, data)
    values (
      new.owner_id,
      'quote',
      'Contrat client signé',
      new.client_signer_name || ' a signé « ' || new.title || ' ».',
      jsonb_build_object('screen', 'business', 'section', 'contracts', 'quote_id', new.quote_id, 'contract_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists business_client_contract_signature_notification
  on public.business_client_contracts;
create trigger business_client_contract_signature_notification
  after update of company_signed_at, client_signed_at
  on public.business_client_contracts
  for each row execute function public.notify_business_client_contract_signature();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'business_client_contracts'
  ) then
    alter publication supabase_realtime add table public.business_client_contracts;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
