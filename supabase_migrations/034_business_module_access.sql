begin;

alter table public.profiles
  add column if not exists business_modules text[] not null default '{}';

alter table public.artisan_business_verifications
  add column if not exists assigned_modules text[] not null default '{}';

alter table public.artisan_business_verifications
  drop constraint if exists artisan_business_verifications_status_check;
alter table public.artisan_business_verifications
  add constraint artisan_business_verifications_status_check
  check (status in ('pending', 'in_review', 'approved', 'rejected', 'revoked'));

alter table public.profiles
  drop constraint if exists profiles_business_modules_check;
alter table public.profiles
  add constraint profiles_business_modules_check
  check (
    business_modules <@ array[
      'dashboard', 'jobs', 'applications', 'artisans', 'projects', 'messages',
      'contracts', 'payments', 'favorites', 'reports', 'team', 'profile', 'support'
    ]::text[]
    and array_position(business_modules, null) is null
    and (business_type is not null or cardinality(business_modules) = 0)
  );

update public.profiles
set business_modules = array[
  'dashboard', 'jobs', 'applications', 'artisans', 'projects', 'messages',
  'contracts', 'payments', 'favorites', 'reports', 'team', 'profile', 'support'
]
where business_type is not null;

create or replace function public.prevent_business_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.business_type is distinct from old.business_type
    or new.business_modules is distinct from old.business_modules
  )
    and auth.uid() is not null
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_admin()
  then
    raise exception 'Modification du statut ou des modules entreprise interdite' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_business_access_change on public.profiles;
create trigger profiles_prevent_business_access_change
  before update of business_type, business_modules on public.profiles
  for each row execute function public.prevent_business_access_change();

update public.artisan_business_verifications v
set assigned_modules = p.business_modules
from public.profiles p
where p.id = v.user_id
  and v.status = 'approved'
  and p.business_type is not null;

update public.artisan_business_verifications
set status = 'revoked',
    assigned_modules = '{}',
    updated_at = now()
where status = 'approved'
  and user_id in (
    select id from public.profiles where business_type is null
  );

create or replace function public.business_is_member(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = p_owner_id and p.business_type is not null
    )
  or exists (
    select 1
    from public.business_members m
    join public.profiles p on p.id = m.owner_id and p.business_type is not null
    where m.owner_id = p_owner_id
      and m.member_user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.business_has_module(p_owner_id uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = p_owner_id
        and p.business_type is not null
        and p_module = any(p.business_modules)
    )
  or exists (
    select 1
    from public.business_members m
    join public.profiles p on p.id = m.owner_id and p.business_type is not null
    where m.owner_id = p_owner_id
      and m.member_user_id = auth.uid()
      and m.status = 'active'
      and p_module = any(array['dashboard', 'projects', 'messages', 'support'])
  );
$$;

create or replace function public.review_artisan_business_verification(
  p_request_id uuid,
  p_status text,
  p_review_note text,
  p_admin_id uuid,
  p_modules text[]
)
returns public.artisan_business_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.artisan_business_verifications;
  v_allowed_modules text[] := array[
    'dashboard', 'jobs', 'applications', 'artisans', 'projects', 'messages',
    'contracts', 'payments', 'favorites', 'reports', 'team', 'profile', 'support'
  ];
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_admin_id and p.role = 'admin'
  ) then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'in_review', 'approved', 'rejected', 'revoked') then
    raise exception 'Statut de vérification invalide' using errcode = '22023';
  end if;
  if p_status = 'rejected' and nullif(btrim(p_review_note), '') is null then
    raise exception 'Une raison est obligatoire pour rejeter la demande' using errcode = '22023';
  end if;
  if p_modules is null
    or array_position(p_modules, null) is not null
    or not (p_modules <@ v_allowed_modules)
    or cardinality(p_modules) <> (select count(distinct module) from unnest(p_modules) as module)
  then
    raise exception 'La liste des modules entreprise est invalide' using errcode = '22023';
  end if;
  if p_status = 'approved' and cardinality(p_modules) = 0 then
    raise exception 'Attribuez au moins un module avant l’approbation' using errcode = '22023';
  end if;
  if p_review_note is not null and char_length(p_review_note) > 1000 then
    raise exception 'La note de suivi ne peut pas dépasser 1000 caractères' using errcode = '22023';
  end if;

  select * into v_request
  from public.artisan_business_verifications
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Demande de vérification introuvable' using errcode = 'P0002';
  end if;

  update public.artisan_business_verifications
  set status = p_status,
      assigned_modules = case when p_status in ('rejected', 'revoked') then '{}' else p_modules end,
      review_note = nullif(btrim(p_review_note), ''),
      reviewed_by = p_admin_id,
      reviewed_at = case when p_status in ('approved', 'rejected', 'revoked') then now() else null end,
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  update public.profiles
  set business_type = case when p_status = 'approved' then v_request.business_type else null end,
      business_modules = case when p_status = 'approved' then p_modules else '{}' end
  where id = v_request.user_id and role = 'artisan';

  if p_status <> 'approved' then
    update public.business_members
    set status = 'revoked'
    where owner_id = v_request.user_id and status = 'active';
  end if;

  return v_request;
end;
$$;

drop function if exists public.review_artisan_business_verification(uuid, text, text, uuid);
revoke all on function public.review_artisan_business_verification(uuid, text, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.review_artisan_business_verification(uuid, text, text, uuid, text[]) to service_role;

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
  if public.business_is_member(v_project.owner_id)
    and not public.business_has_module(v_project.owner_id, 'messages') then
    raise exception 'Le module Messages entreprise n’est pas attribué à votre compte' using errcode = '42501';
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
  if v_conv.business_project_id is not null
    and (auth.uid() = v_conv.business_owner_id or public.business_is_member(v_conv.business_owner_id))
    and not public.business_has_module(v_conv.business_owner_id, 'messages') then
    raise exception 'Le module Messages entreprise n’est pas attribué à votre compte' using errcode = '42501';
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
    and (
      c.business_project_id is null
      or (
        auth.uid() <> c.business_owner_id
        and not public.business_is_member(c.business_owner_id)
      )
      or (
        (auth.uid() = c.business_owner_id or public.business_is_member(c.business_owner_id))
        and public.business_has_module(c.business_owner_id, 'messages')
      )
    )
    and m.sender_id <> auth.uid()
    and m.read_at is null;
end;
$$;

drop policy if exists business_contract_documents_read on storage.objects;
create policy business_contract_documents_read on storage.objects
  for select to authenticated using (
    bucket_id = 'business-contracts'
    and (
      exists (
        select 1 from public.business_profiles b
        where b.owner_id::text = (storage.foldername(name))[1]
          and public.business_has_module(b.owner_id, 'contracts')
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
        and public.business_has_module(b.owner_id, 'contracts')
    )
  );

drop policy if exists "Conversations visibles par leurs membres" on public.chat_conversations;
create policy "Conversations visibles par leurs membres"
  on public.chat_conversations for select
  using (
    (
      auth.uid() = user_a
      or auth.uid() = user_b
      or (business_project_id is not null and public.business_is_member(business_owner_id))
    )
    and (
      business_project_id is null
      or (
        auth.uid() <> business_owner_id
        and not public.business_is_member(business_owner_id)
      )
      or (
        public.business_is_member(business_owner_id)
        and public.business_has_module(business_owner_id, 'messages')
      )
    )
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
        and (
          c.business_project_id is null
          or (
            auth.uid() <> c.business_owner_id
            and not public.business_is_member(c.business_owner_id)
          )
          or (
            public.business_is_member(c.business_owner_id)
            and public.business_has_module(c.business_owner_id, 'messages')
          )
        )
    )
  );

revoke all on function public.business_has_module(uuid, text) from public, anon;
grant execute on function public.business_has_module(uuid, text) to authenticated, service_role;
revoke all on function public.start_business_project_chat(uuid) from public, anon;
grant execute on function public.start_business_project_chat(uuid) to authenticated;
revoke all on function public.send_chat_message(uuid, text) from public, anon;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

drop policy if exists business_profiles_owner_read on public.business_profiles;
create policy business_profiles_owner_read on public.business_profiles
  for select to authenticated using (public.business_has_module(owner_id, 'profile'));
drop policy if exists business_profiles_owner_write on public.business_profiles;
create policy business_profiles_owner_write on public.business_profiles
  for update to authenticated using (public.business_has_module(owner_id, 'profile'))
  with check (public.business_has_module(owner_id, 'profile'));

drop policy if exists business_members_owner_read on public.business_members;
create policy business_members_owner_read on public.business_members
  for select to authenticated using (
    public.business_has_module(owner_id, 'team') or member_user_id = auth.uid()
  );

drop policy if exists business_jobs_owner_insert on public.business_jobs;
drop policy if exists business_jobs_public_read on public.business_jobs;
create policy business_jobs_public_read on public.business_jobs
  for select to authenticated using (
    status = 'published'
    or public.business_has_module(owner_id, 'jobs')
    or public.business_has_module(owner_id, 'applications')
  );

create policy business_jobs_owner_insert on public.business_jobs
  for insert to authenticated with check (
    public.business_has_module(owner_id, 'jobs') and created_by = auth.uid()
  );
drop policy if exists business_jobs_owner_update on public.business_jobs;
create policy business_jobs_owner_update on public.business_jobs
  for update to authenticated using (public.business_has_module(owner_id, 'jobs'))
  with check (public.business_has_module(owner_id, 'jobs'));
drop policy if exists business_jobs_owner_delete on public.business_jobs;
create policy business_jobs_owner_delete on public.business_jobs
  for delete to authenticated using (
    public.business_has_module(owner_id, 'jobs') and status = 'draft'
  );

drop policy if exists business_applications_visible on public.business_applications;
create policy business_applications_visible on public.business_applications
  for select to authenticated using (
    applicant_id = auth.uid()
    or exists (
      select 1 from public.business_jobs j
      where j.id = job_id and public.business_has_module(j.owner_id, 'applications')
    )
  );

drop policy if exists business_projects_participant_read on public.business_projects;
create policy business_projects_participant_read on public.business_projects
  for select to authenticated using (
    public.business_has_module(owner_id, 'projects')
    or public.business_has_module(owner_id, 'messages')
    or artisan_id = auth.uid()
  );
drop policy if exists business_projects_owner_update on public.business_projects;
create policy business_projects_owner_update on public.business_projects
  for update to authenticated using (public.business_has_module(owner_id, 'projects'))
  with check (public.business_has_module(owner_id, 'projects'));

drop policy if exists business_favorites_owner_manage on public.business_favorites;
create policy business_favorites_owner_manage on public.business_favorites
  for all to authenticated
  using (public.business_has_module(owner_id, 'favorites'))
  with check (public.business_has_module(owner_id, 'favorites'));

drop policy if exists business_contracts_participant_read on public.business_contracts;
create policy business_contracts_participant_read on public.business_contracts
  for select to authenticated using (
    public.business_has_module(owner_id, 'contracts')
    or exists (
      select 1 from public.business_projects p
      where p.id = project_id and p.artisan_id = auth.uid()
    )
  );

drop policy if exists business_payments_owner_read on public.business_payments;
create policy business_payments_owner_read on public.business_payments
  for select to authenticated using (public.business_has_module(owner_id, 'payments'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;

update public.business_members m
set status = 'revoked'
from public.artisan_business_verifications v
where m.owner_id = v.user_id
  and m.status = 'active'
  and v.status = 'revoked';

commit;

notify pgrst, 'reload schema';
