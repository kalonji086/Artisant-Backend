begin;

create table if not exists public.business_profiles (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  business_type text not null check (business_type in ('enterprise', 'subcontractor')),
  company_name text not null,
  country text not null,
  registration_number text not null,
  tax_number text not null,
  company_address text not null,
  contact_person text not null,
  contact_email text not null,
  contact_phone text not null,
  industry text,
  website text,
  description text,
  updated_at timestamptz not null default now()
);

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  member_user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  role text not null default 'employee' check (role = 'employee'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (owner_id, member_user_id),
  check (owner_id <> member_user_id)
);

create unique index if not exists business_members_email_active_idx
  on public.business_members (owner_id, lower(email)) where status = 'active';
create unique index if not exists business_members_user_active_idx
  on public.business_members (member_user_id) where status = 'active';
create index if not exists business_members_user_idx
  on public.business_members (member_user_id, status);

create table if not exists public.business_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null check (char_length(btrim(title)) between 5 and 140),
  category text not null check (char_length(btrim(category)) between 2 and 80),
  description text not null check (char_length(btrim(description)) between 20 and 4000),
  city text not null check (char_length(btrim(city)) between 2 and 100),
  work_type text not null default 'project'
    check (work_type in ('project', 'full_time', 'part_time', 'contract', 'internship')),
  budget_min numeric(12,2) check (budget_min is null or budget_min >= 0),
  budget_max numeric(12,2) check (budget_max is null or budget_max >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_max >= budget_min)
);

create index if not exists business_jobs_owner_idx
  on public.business_jobs (owner_id, created_at desc);
create index if not exists business_jobs_search_idx
  on public.business_jobs (status, city, category, created_at desc);

create table if not exists public.business_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.business_jobs(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  proposed_amount numeric(12,2) check (proposed_amount is null or proposed_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  estimated_days integer check (estimated_days is null or estimated_days between 1 and 3650),
  status text not null default 'submitted'
    check (status in ('submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);

create index if not exists business_applications_job_idx
  on public.business_applications (job_id, created_at desc);
create index if not exists business_applications_applicant_idx
  on public.business_applications (applicant_id, created_at desc);
create unique index if not exists business_job_one_accepted_application_idx
  on public.business_applications (job_id) where status = 'accepted';

create table if not exists public.business_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.business_jobs(id) on delete set null,
  application_id uuid unique references public.business_applications(id) on delete set null,
  artisan_id uuid not null references public.profiles(id),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  description text,
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'completed', 'cancelled')),
  start_date date,
  due_date date,
  budget numeric(12,2) check (budget is null or budget >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create index if not exists business_projects_owner_idx
  on public.business_projects (owner_id, updated_at desc);
create index if not exists business_projects_artisan_idx
  on public.business_projects (artisan_id, updated_at desc);

create table if not exists public.business_favorites (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artisan_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, artisan_id),
  check (owner_id <> artisan_id)
);

create table if not exists public.business_contracts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.business_projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  document_path text not null,
  company_signer_name text not null,
  company_signer_email text not null,
  artisan_signer_name text not null,
  artisan_signer_email text not null,
  status text not null default 'draft'
    check (status in ('draft', 'signing', 'signed', 'declined', 'expired', 'canceled', 'error')),
  signature_provider text not null default 'yousign' check (signature_provider = 'yousign'),
  signature_request_id text unique,
  signed_document_path text,
  amount numeric(12,2) check (amount is null or amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_contracts_owner_idx
  on public.business_contracts (owner_id, created_at desc);
create index if not exists business_contracts_project_idx
  on public.business_contracts (project_id, created_at desc);

create table if not exists public.business_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.business_projects(id) on delete cascade,
  contract_id uuid references public.business_contracts(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  description text not null check (char_length(btrim(description)) between 3 and 300),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  due_date date,
  status text not null default 'planned' check (status in ('planned', 'due', 'paid', 'overdue', 'canceled')),
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_signature_events (
  event_id text primary key,
  event_name text not null,
  received_at timestamptz not null default now()
);

create index if not exists business_payments_owner_idx
  on public.business_payments (owner_id, due_date, created_at desc);
create index if not exists business_payments_project_idx
  on public.business_payments (project_id, created_at desc);

alter table public.chat_conversations
  add column if not exists business_project_id uuid
    references public.business_projects(id) on delete set null;
alter table public.chat_conversations
  add column if not exists business_owner_id uuid
    references public.profiles(id) on delete cascade;

create or replace function public.business_is_member(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_owner_id
    and exists (select 1 from public.profiles p where p.id = p_owner_id and p.business_type is not null)
  or exists (
    select 1 from public.business_members m
    where m.owner_id = p_owner_id and m.member_user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.business_is_owner(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_owner_id
    and exists (select 1 from public.profiles p where p.id = p_owner_id and p.business_type is not null);
$$;

create or replace function public.business_can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_projects p
    where p.id = p_project_id
      and (
        public.business_is_member(p.owner_id)
        or p.artisan_id = auth.uid()
      )
  );
$$;

create or replace function public.business_create_project_for_accepted_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.business_jobs;
begin
  if new.status = 'accepted' and old.status is distinct from new.status then
    select * into v_job from public.business_jobs where id = new.job_id;
    if not found then
      raise exception 'Demande introuvable' using errcode = 'P0002';
    end if;
    insert into public.business_projects (
      owner_id, job_id, application_id, artisan_id, title, description,
      budget, currency
    )
    values (
      v_job.owner_id, v_job.id, new.id, new.applicant_id, v_job.title,
      new.message, coalesce(new.proposed_amount, v_job.budget_max),
      case when new.proposed_amount is not null then new.currency else v_job.currency end
    )
    on conflict (application_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists business_application_accepted_project on public.business_applications;
create trigger business_application_accepted_project
  after update of status on public.business_applications
  for each row execute function public.business_create_project_for_accepted_application();

create or replace function public.business_seed_profile_from_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_type is not null and old.business_type is distinct from new.business_type then
    insert into public.business_profiles (
      owner_id, business_type, company_name, country, registration_number,
      tax_number, company_address, contact_person, contact_email, contact_phone
    )
    select v.user_id, v.business_type, v.company_name, v.country, v.registration_number,
           v.tax_number, v.company_address, v.contact_person, v.contact_email, v.contact_phone
    from public.artisan_business_verifications v
    where v.user_id = new.id and v.status = 'approved'
    on conflict (owner_id) do update
      set business_type = excluded.business_type,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_seed_business_profile on public.profiles;
create trigger profiles_seed_business_profile
  after update of business_type on public.profiles
  for each row execute function public.business_seed_profile_from_verification();

insert into public.business_profiles (
  owner_id, business_type, company_name, country, registration_number,
  tax_number, company_address, contact_person, contact_email, contact_phone
)
select v.user_id, v.business_type, v.company_name, v.country, v.registration_number,
       v.tax_number, v.company_address, v.contact_person, v.contact_email, v.contact_phone
from public.artisan_business_verifications v
join public.profiles p on p.id = v.user_id and p.business_type = v.business_type
where v.status = 'approved'
on conflict (owner_id) do nothing;

create or replace function public.start_business_project_chat(p_project_id uuid)
returns public.chat_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.business_projects;
  v_conv public.chat_conversations;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '28000';
  end if;
  select * into v_project from public.business_projects where id = p_project_id;
  if not found or not public.business_can_access_project(p_project_id) then
    raise exception 'Projet introuvable ou accès refusé' using errcode = '42501';
  end if;
  insert into public.chat_conversations (
    kind, user_a, user_b, business_project_id, business_owner_id
  )
  values ('direct', v_project.owner_id, v_project.artisan_id, p_project_id, v_project.owner_id)
  on conflict (user_a, user_b) where kind = 'direct'
  do update set business_project_id = coalesce(
        public.chat_conversations.business_project_id,
        excluded.business_project_id
      ),
      business_owner_id = excluded.business_owner_id
  returning * into v_conv;
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
  if not found or not (
    auth.uid() in (v_conv.user_a, coalesce(v_conv.user_b, v_conv.user_a))
    or (v_conv.business_project_id is not null and public.business_is_member(v_conv.business_owner_id))
  ) then
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
    and (
      auth.uid() in (c.user_a, coalesce(c.user_b, c.user_a))
      or (c.business_project_id is not null and public.business_is_member(c.business_owner_id))
    )
    and m.sender_id <> auth.uid()
    and m.read_at is null;
end;
$$;

alter table public.business_profiles enable row level security;
alter table public.business_members enable row level security;
alter table public.business_jobs enable row level security;
alter table public.business_applications enable row level security;
alter table public.business_projects enable row level security;
alter table public.business_favorites enable row level security;
alter table public.business_contracts enable row level security;
alter table public.business_payments enable row level security;

create policy business_profiles_owner_read on public.business_profiles
  for select to authenticated using (public.business_is_owner(owner_id));
create policy business_profiles_owner_write on public.business_profiles
  for update to authenticated using (public.business_is_owner(owner_id))
  with check (public.business_is_owner(owner_id));

create policy business_members_owner_read on public.business_members
  for select to authenticated using (public.business_is_owner(owner_id) or member_user_id = auth.uid());

create policy business_jobs_public_read on public.business_jobs
  for select to authenticated
  using (status = 'published' or public.business_is_member(owner_id));
create policy business_jobs_owner_insert on public.business_jobs
  for insert to authenticated with check (
    public.business_is_owner(owner_id) and created_by = auth.uid()
  );
create policy business_jobs_owner_update on public.business_jobs
  for update to authenticated using (public.business_is_owner(owner_id))
  with check (public.business_is_owner(owner_id));
create policy business_jobs_owner_delete on public.business_jobs
  for delete to authenticated using (public.business_is_owner(owner_id) and status = 'draft');

create policy business_applications_visible on public.business_applications
  for select to authenticated using (
    applicant_id = auth.uid()
    or exists (
      select 1 from public.business_jobs j
      where j.id = job_id and public.business_is_member(j.owner_id)
    )
  );
create policy business_applications_submit on public.business_applications
  for insert to authenticated with check (
    applicant_id = auth.uid()
    and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artisan'
    )
    and exists (
      select 1 from public.business_jobs j where j.id = job_id and j.status = 'published'
    )
  );
create policy business_projects_participant_read on public.business_projects
  for select to authenticated using (
    public.business_is_member(owner_id) or artisan_id = auth.uid()
  );
create policy business_projects_owner_update on public.business_projects
  for update to authenticated using (public.business_is_owner(owner_id))
  with check (public.business_is_owner(owner_id));

create policy business_favorites_owner_manage on public.business_favorites
  for all to authenticated
  using (public.business_is_owner(owner_id))
  with check (public.business_is_owner(owner_id));

create policy business_contracts_participant_read on public.business_contracts
  for select to authenticated using (
    public.business_is_owner(owner_id)
    or exists (
      select 1 from public.business_projects p
      where p.id = project_id and p.artisan_id = auth.uid()
    )
  );

create policy business_payments_owner_read on public.business_payments
  for select to authenticated using (public.business_is_owner(owner_id));

grant select, update on public.business_profiles to authenticated;
grant select on public.business_members to authenticated;
grant select, insert, update, delete on public.business_jobs to authenticated;
grant select, insert on public.business_applications to authenticated;
grant select, update on public.business_projects to authenticated;
grant select, insert, delete on public.business_favorites to authenticated;
grant select on public.business_contracts to authenticated;
grant select on public.business_payments to authenticated;
grant all on public.business_profiles, public.business_members, public.business_jobs,
  public.business_applications, public.business_projects, public.business_favorites,
  public.business_contracts, public.business_payments, public.business_signature_events to service_role;
revoke all on public.business_signature_events from anon, authenticated;

revoke all on function public.business_is_member(uuid) from public, anon;
revoke all on function public.business_is_owner(uuid) from public, anon;
revoke all on function public.business_can_access_project(uuid) from public, anon;
revoke all on function public.start_business_project_chat(uuid) from public, anon;
grant execute on function public.business_is_member(uuid) to authenticated, service_role;
grant execute on function public.business_is_owner(uuid) to authenticated, service_role;
grant execute on function public.business_can_access_project(uuid) to authenticated, service_role;
grant execute on function public.start_business_project_chat(uuid) to authenticated;

revoke all on function public.send_chat_message(uuid, text) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-contracts',
  'business-contracts',
  false,
  20971520,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_contract_documents_read on storage.objects;
create policy business_contract_documents_read on storage.objects
  for select to authenticated using (
    bucket_id = 'business-contracts'
    and (
      exists (
        select 1 from public.business_profiles b
        where b.owner_id::text = (storage.foldername(name))[1]
          and public.business_is_owner(b.owner_id)
      )
      or exists (
        select 1 from public.business_projects p
        where p.id::text = (storage.foldername(name))[2]
          and p.artisan_id = auth.uid()
      )
    )
  );

drop policy if exists business_contract_documents_insert on storage.objects;
create policy business_contract_documents_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'business-contracts'
    and exists (
      select 1
      from public.business_profiles b
      join public.business_projects p on p.owner_id = b.owner_id
      where b.owner_id::text = (storage.foldername(name))[1]
        and p.id::text = (storage.foldername(name))[2]
        and public.business_is_owner(b.owner_id)
    )
  );

drop policy if exists "Conversations visibles par leurs membres" on public.chat_conversations;
create policy "Conversations visibles par leurs membres"
  on public.chat_conversations for select
  using (
    auth.uid() = user_a
    or auth.uid() = user_b
    or (business_project_id is not null and public.business_is_member(business_owner_id))
    or public.is_platform_admin()
  );

drop policy if exists "Messages visibles par les membres" on public.chat_messages;
create policy "Messages visibles par les membres"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id
        and (
          auth.uid() = c.user_a
          or auth.uid() = c.user_b
          or (c.business_project_id is not null and public.business_is_member(c.business_owner_id))
          or public.is_platform_admin()
        )
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'business_jobs'
  ) then
    alter publication supabase_realtime add table public.business_jobs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'business_applications'
  ) then
    alter publication supabase_realtime add table public.business_applications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'business_projects'
  ) then
    alter publication supabase_realtime add table public.business_projects;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'business_contracts'
  ) then
    alter publication supabase_realtime add table public.business_contracts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'business_payments'
  ) then
    alter publication supabase_realtime add table public.business_payments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'business_members'
  ) then
    alter publication supabase_realtime add table public.business_members;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
