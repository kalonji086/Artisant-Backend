begin;

alter table public.profile_details
  add column if not exists administrative_area text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role text := meta->>'role';
begin
  insert into public.profiles (id, full_name, role, phone, description, address, profession, city)
  values (
    new.id,
    coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
    case when requested_role in ('client', 'artisan') then requested_role else 'client' end,
    meta->>'phone',
    meta->>'description',
    meta->>'address',
    meta->>'profession',
    meta->>'city'
  )
  on conflict (id) do nothing;

  begin
    insert into public.profile_details (
      user_id, email, birth_date, age, gender, country, administrative_area,
      years_experience, service_radius_km, terms_accepted_at, terms_version
    )
    values (
      new.id,
      new.email,
      public._safe_date(meta->>'birth_date'),
      public._safe_age(meta->>'age'),
      meta->>'gender',
      meta->>'country',
      meta->>'province',
      public._safe_int(meta->>'years_experience'),
      public._safe_int(meta->>'service_radius_km'),
      public._safe_ts(meta->>'terms_accepted_at'),
      meta->>'terms_version'
    )
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'profile_details non créé pour %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
