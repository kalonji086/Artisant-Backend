begin;

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
      values (
        new.client_id,
        'quote',
        'Artisan assigné',
        'Un artisan a été assigné à votre demande.',
        jsonb_build_object('quoteId', new.id)
      );
    end if;
  elsif new.status is distinct from old.status and new.client_id is not null then
    v_status_label := case new.status
      when 'assigned' then 'attribuée'
      when 'pending' then 'en attente'
      when 'accepted' then 'acceptée'
      when 'in_progress' then 'en cours'
      when 'rejected' then 'refusée'
      when 'completed' then 'terminée'
      else new.status
    end;
    insert into public.app_notifications (user_id, notification_type, title, body, data)
    values (
      new.client_id,
      'quote',
      'Mise à jour de votre demande',
      'Votre demande est maintenant ' || v_status_label || '.',
      jsonb_build_object('quoteId', new.id)
    );
  end if;

  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
