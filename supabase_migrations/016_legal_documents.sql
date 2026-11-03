-- Migration 016 : contenu modifiable des pages légales (politique de confidentialité et conditions)
begin;

create table if not exists public.legal_documents (
  slug text primary key check (slug in ('privacy', 'terms')),
  content_html text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Accès uniquement via le backend (clé service_role) : aucune politique publique.
alter table public.legal_documents enable row level security;

commit;
