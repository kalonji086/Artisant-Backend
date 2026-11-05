-- 028 : paramètres généraux de l'application mobile pilotés par l'admin, en temps réel.
-- Prérequis : 006, 015.

alter table public.admin_platform_settings
  add column if not exists app_primary_color text not null default '#007AFF',
  add column if not exists default_language text not null default 'fr',
  add column if not exists default_theme text not null default 'light',
  add column if not exists maintenance_mode boolean not null default false,
  add column if not exists maintenance_message text not null default '',
  add column if not exists announcement text not null default '',
  add column if not exists allow_signups boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'admin_settings_theme_check') then
    alter table public.admin_platform_settings
      add constraint admin_settings_theme_check check (default_theme in ('light', 'dark', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admin_settings_lang_check') then
    alter table public.admin_platform_settings
      add constraint admin_settings_lang_check check (default_language in ('fr', 'en'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admin_settings_color_check') then
    alter table public.admin_platform_settings
      add constraint admin_settings_color_check check (app_primary_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end
$$;

-- Lecture pour tous les utilisateurs de l'app (écriture toujours réservée aux admins, via la politique 006).
drop policy if exists "Settings lisibles par l'application" on public.admin_platform_settings;
create policy "Settings lisibles par l'application"
  on public.admin_platform_settings for select
  to authenticated, anon
  using (true);

-- Les visiteurs non connectés ne voient que les colonnes publiques.
revoke select on public.admin_platform_settings from anon;
grant select (id, platform_name, support_email, contact_email, facebook_url, github_url, x_url,
              linkedin_url, instagram_url, app_primary_color, default_language, default_theme,
              maintenance_mode, maintenance_message, announcement, allow_signups, updated_at)
  on public.admin_platform_settings to anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'admin_platform_settings') then
    alter publication supabase_realtime add table public.admin_platform_settings;
  end if;
end
$$;
