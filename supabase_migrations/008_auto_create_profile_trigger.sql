-- Jusqu'ici, la ligne `profiles` était créée côté client (app mobile) juste
-- après `supabase.auth.signUp()`. Si cette deuxième étape échouait (crash,
-- perte réseau, RLS, inscription OAuth, compte créé à la main dans Supabase...),
-- l'utilisateur restait authentifié sans profil -> 403 "Profil introuvable"
-- sur toutes les routes qui en dépendent (cf. server/src/middleware/auth.ts).
--
-- Ce trigger déplace la création du profil côté base de données : elle devient
-- automatique et garantie pour TOUT nouvel utilisateur de auth.users, quel que
-- soit le chemin d'inscription.

begin;

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
  insert into public.profiles (id, full_name, role, phone, description, address)
  values (
    new.id,
    coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
    case when requested_role in ('client', 'artisan', 'admin') then requested_role else 'client' end,
    meta->>'phone',
    meta->>'description',
    meta->>'address'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rattrapage : comptes auth.users déjà existants sans profil correspondant
-- (ex. l'utilisateur dont les logs montrent "Profil introuvable").
insert into public.profiles (id, full_name, role, phone, description, address)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  case
    when u.raw_user_meta_data->>'role' in ('client', 'artisan', 'admin') then u.raw_user_meta_data->>'role'
    else 'client'
  end,
  u.raw_user_meta_data->>'phone',
  u.raw_user_meta_data->>'description',
  u.raw_user_meta_data->>'address'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

commit;

notify pgrst, 'reload schema';
