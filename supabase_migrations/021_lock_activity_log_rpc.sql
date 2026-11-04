-- Migration 021 : verrouille l'écriture du journal d'activité.
-- log_activity ne doit être appelable que par le service role (serveur) et par les triggers
-- (qui s'exécutent avec les droits du propriétaire). Sans ce correctif, un utilisateur connecté
-- pouvait appeler rpc('log_activity') avec l'identifiant d'un autre utilisateur et falsifier le journal.
begin;

revoke all on function public.log_activity(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_activity(uuid, text, text, text, jsonb) to service_role;

commit;
