-- Migration 022 : gestion des utilisateurs par l'admin (suspension, motif).
-- La suspension est aussi appliquée côté auth (ban) par le serveur ; ce champ sert à l'affichage temps réel.

alter table public.profiles
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

create index if not exists profiles_is_suspended_idx on public.profiles(is_suspended);
