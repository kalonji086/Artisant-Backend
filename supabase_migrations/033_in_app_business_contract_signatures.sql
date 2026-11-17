begin;

alter table public.business_contracts
  alter column signature_provider set default 'in_app';

alter table public.business_contracts
  add column if not exists company_signed_by uuid references public.profiles(id),
  add column if not exists company_signed_name text,
  add column if not exists company_signed_at timestamptz,
  add column if not exists company_signature_consent text,
  add column if not exists artisan_signed_by uuid references public.profiles(id),
  add column if not exists artisan_signed_name text,
  add column if not exists artisan_signed_at timestamptz,
  add column if not exists artisan_signature_consent text;

alter table public.business_contracts
  drop constraint if exists business_contracts_signature_provider_check;
alter table public.business_contracts
  add constraint business_contracts_signature_provider_check
  check (signature_provider in ('yousign', 'in_app'));

update public.business_contracts
set signature_provider = 'in_app',
    updated_at = now()
where signature_provider = 'yousign'
  and status in ('draft', 'error')
  and signature_request_id is null;

create or replace function public.sign_business_contract_in_app(
  p_contract_id uuid,
  p_signer_user_id uuid,
  p_full_name text,
  p_confirmed boolean
)
returns public.business_contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.business_contracts;
  v_artisan_id uuid;
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
  from public.business_contracts
  where id = p_contract_id
  for update;
  if not found then
    raise exception 'Contrat introuvable.' using errcode = 'P0002';
  end if;
  if v_contract.signature_provider <> 'in_app' then
    raise exception 'Ce contrat ne peut pas être signé dans ARTISANTS.' using errcode = '55000';
  end if;
  if v_contract.status in ('signed', 'declined', 'expired', 'canceled') then
    raise exception 'Ce contrat n’est plus disponible pour signature.' using errcode = '55000';
  end if;

  select artisan_id into v_artisan_id
  from public.business_projects
  where id = v_contract.project_id;
  if not found then
    raise exception 'Projet introuvable.' using errcode = 'P0002';
  end if;

  if p_signer_user_id = v_contract.owner_id then
    v_expected_name := v_contract.company_signer_name;
    if v_contract.company_signed_at is not null then
      raise exception 'La signature de l’entreprise est déjà enregistrée.' using errcode = '23505';
    end if;
    if lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
       is distinct from lower(regexp_replace(btrim(v_expected_name), '\s+', ' ', 'g')) then
      raise exception 'Le nom saisi doit correspondre au nom complet du signataire indiqué au contrat.' using errcode = '22023';
    end if;

    update public.business_contracts
    set company_signed_by = p_signer_user_id,
        company_signed_name = btrim(p_full_name),
        company_signed_at = now(),
        company_signature_consent = v_consent,
        status = case when artisan_signed_at is not null then 'signed' else 'signing' end,
        updated_at = now()
    where id = p_contract_id
    returning * into v_contract;
  elsif p_signer_user_id = v_artisan_id then
    v_expected_name := v_contract.artisan_signer_name;
    if v_contract.artisan_signed_at is not null then
      raise exception 'La signature de l’artisan est déjà enregistrée.' using errcode = '23505';
    end if;
    if lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
       is distinct from lower(regexp_replace(btrim(v_expected_name), '\s+', ' ', 'g')) then
      raise exception 'Le nom saisi doit correspondre au nom complet du signataire indiqué au contrat.' using errcode = '22023';
    end if;

    update public.business_contracts
    set artisan_signed_by = p_signer_user_id,
        artisan_signed_name = btrim(p_full_name),
        artisan_signed_at = now(),
        artisan_signature_consent = v_consent,
        status = case when company_signed_at is not null then 'signed' else 'signing' end,
        updated_at = now()
    where id = p_contract_id
    returning * into v_contract;
  else
    raise exception 'Vous n’êtes pas signataire de ce contrat.' using errcode = '42501';
  end if;

  return v_contract;
end;
$$;

revoke all on function public.sign_business_contract_in_app(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.sign_business_contract_in_app(uuid, uuid, text, boolean) to service_role;

commit;

notify pgrst, 'reload schema';
