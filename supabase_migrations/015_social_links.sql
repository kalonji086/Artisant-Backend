-- Migration 015 : réseaux sociaux et contact légal (paramètres de la plateforme)
begin;

alter table public.admin_platform_settings
  add column if not exists contact_email text not null default 'Togethertechsupport@gmail.com',
  add column if not exists facebook_url text not null default '',
  add column if not exists github_url text not null default '',
  add column if not exists x_url text not null default '',
  add column if not exists linkedin_url text not null default '',
  add column if not exists instagram_url text not null default '';

commit;
