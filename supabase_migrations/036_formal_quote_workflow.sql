begin;

create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique check (template_key in ('fixed', 'detailed')),
  name text not null,
  html_content text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.quote_templates enable row level security;

insert into public.quote_templates (template_key, name, html_content)
values
  (
    'fixed',
    'Devis forfaitaire',
    '<h1>Devis forfaitaire</h1><p><strong>Référence :</strong> {{quote_number}}</p><p><strong>Client :</strong> {{client_name}}</p><p><strong>Artisan :</strong> {{artisan_name}} — {{profession}}</p><h2>Forfait : {{title}}</h2><p>{{description}}</p>{{items_html}}<p>Prix forfaitaire : {{subtotal}} {{currency}}</p><p>TVA ajoutée ({{tax_rate}} %) : {{tax_amount}} {{currency}}</p><h2>Total TTC : {{total}} {{currency}}</h2><p>Valable jusqu’au : {{valid_until}}</p><p>{{terms}}</p>'
  ),
  (
    'detailed',
    'Devis détaillé',
    '<h1>Devis détaillé</h1><p><strong>Référence :</strong> {{quote_number}}</p><p><strong>Client :</strong> {{client_name}}</p><p><strong>Artisan :</strong> {{artisan_name}} — {{profession}}</p><h2>Détail des travaux : {{title}}</h2><p>{{description}}</p>{{items_html}}<p>Sous-total des prestations : {{subtotal}} {{currency}}</p><p>TVA ajoutée ({{tax_rate}} %) : {{tax_amount}} {{currency}}</p><h2>Total TTC : {{total}} {{currency}}</h2><p>Valable jusqu’au : {{valid_until}}</p><p>{{terms}}</p>'
  )
on conflict (template_key) do nothing;

revoke all on public.quote_templates from anon, authenticated;

alter table public.quotes
  add column if not exists proposal_template_key text
    check (proposal_template_key is null or proposal_template_key in ('fixed', 'detailed')),
  add column if not exists proposal_intro text,
  add column if not exists proposal_items jsonb not null default '[]'::jsonb,
  add column if not exists proposal_currency text,
  add column if not exists proposal_tax_rate numeric(7, 4),
  add column if not exists proposal_subtotal numeric(20, 6),
  add column if not exists proposal_tax_amount numeric(20, 6),
  add column if not exists proposal_total numeric(20, 6),
  add column if not exists proposal_valid_until date,
  add column if not exists proposal_terms text,
  add column if not exists proposal_sent_at timestamptz,
  add column if not exists proposal_email_id text,
  add column if not exists proposal_sending_at timestamptz;

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes
  add constraint quotes_status_check
  check (status in ('unassigned', 'assigned', 'pending', 'accepted', 'in_progress', 'rejected', 'completed', 'quote_sent'));

create or replace function public.admin_assign_quote_with_template(
  p_quote_id uuid,
  p_artisan_id uuid,
  p_template_key text
)
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
  if p_template_key is null or p_template_key not in ('fixed', 'detailed') then
    raise exception 'Modèle de devis invalide' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_artisan_id and role = 'artisan') then
    raise exception 'Artisan introuvable' using errcode = '22023';
  end if;

  update public.quotes
  set artisan_id = p_artisan_id,
      status = 'assigned',
      assigned_at = now(),
      assigned_by = auth.uid(),
      proposal_template_key = p_template_key,
      proposal_intro = null,
      proposal_items = '[]'::jsonb,
      proposal_currency = null,
      proposal_tax_rate = null,
      proposal_subtotal = null,
      proposal_tax_amount = null,
      proposal_total = null,
      proposal_valid_until = null,
      proposal_terms = null,
      proposal_sent_at = null,
      proposal_email_id = null,
      proposal_sending_at = null
  where id = p_quote_id
    and status in ('unassigned', 'assigned', 'pending', 'rejected')
    and proposal_sending_at is null
    and proposal_sent_at is null
  returning * into v_quote;

  if not found then
    raise exception 'Demande introuvable ou non réassignable' using errcode = '22023';
  end if;
  return v_quote;
end;
$$;

revoke all on function public.admin_assign_quote_with_template(uuid, uuid, text) from public, anon;
grant execute on function public.admin_assign_quote_with_template(uuid, uuid, text) to authenticated;

create or replace function public.notify_quote_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_label text;
  v_assignment_changed boolean := false;
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

  v_assignment_changed :=
    new.artisan_id is not null
    and (
      new.artisan_id is distinct from old.artisan_id
      or (new.status is distinct from old.status and new.status = 'assigned')
    );

  if v_assignment_changed then
    insert into public.app_notifications (user_id, notification_type, title, body, data)
    values (
      new.artisan_id,
      'quote',
      'Nouvelle demande attribuée',
      coalesce(nullif(new.title, ''), nullif(new.category, ''), 'Une demande vous a été attribuée.'),
      jsonb_build_object('quoteId', new.id)
    );
    if new.client_id is not null then
      insert into public.app_notifications (user_id, notification_type, title, body, data)
      values (new.client_id, 'quote', 'Artisan assigné',
        'Un artisan a été assigné à votre demande.', jsonb_build_object('quoteId', new.id));
    end if;
  elsif new.status is distinct from old.status and new.client_id is not null then
    v_status_label := case new.status
      when 'assigned' then 'attribuée'
      when 'pending' then 'en attente'
      when 'accepted' then 'acceptée'
      when 'in_progress' then 'en cours'
      when 'rejected' then 'refusée'
      when 'completed' then 'terminée'
      when 'quote_sent' then 'accompagnée d’un devis envoyé par email'
      else new.status
    end;
    insert into public.app_notifications (user_id, notification_type, title, body, data)
    values (
      new.client_id,
      'quote',
      case when new.status = 'quote_sent' then 'Votre devis est envoyé' else 'Mise à jour de votre demande' end,
      case when new.status = 'quote_sent'
        then 'Votre devis est arrivé dans votre boîte mail.'
        else 'Votre demande est maintenant ' || v_status_label || '.'
      end,
      jsonb_build_object('quoteId', new.id)
    );
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quote_templates'
  ) then
    alter publication supabase_realtime add table public.quote_templates;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
