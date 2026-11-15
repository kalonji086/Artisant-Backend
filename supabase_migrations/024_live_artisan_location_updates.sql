-- Send location-change signals without exposing GPS coordinates to subscribers.
begin;

drop policy if exists nearby_artisan_location_updates_read on realtime.messages;
create policy nearby_artisan_location_updates_read
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() = 'nearby_artisan_locations'
  );

drop policy if exists own_location_updates_read on realtime.messages;
create policy own_location_updates_read
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() = 'user_location:' || (select auth.uid())::text
  );

create or replace function public.broadcast_location_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_artisan boolean;
begin
  if tg_op = 'UPDATE'
    and new.latitude is not distinct from old.latitude
    and new.longitude is not distinct from old.longitude then
    return new;
  end if;

  perform realtime.send(
    payload => jsonb_build_object('user_id', new.user_id),
    event => 'user_location_changed',
    topic => 'user_location:' || new.user_id::text,
    private => true
  );

  select exists (
    select 1
    from public.profiles
    where id = new.user_id and role = 'artisan'
  ) into v_is_artisan;

  if v_is_artisan then
    perform realtime.send(
      payload => '{}'::jsonb,
      event => 'artisan_location_changed',
      topic => 'nearby_artisan_locations',
      private => true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists user_location_realtime_broadcast on public.user_locations;
create trigger user_location_realtime_broadcast
  after insert or update of latitude, longitude on public.user_locations
  for each row execute function public.broadcast_location_changes();

commit;
