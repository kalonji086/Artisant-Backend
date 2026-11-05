-- Les demandes d'aide passent désormais par l'API (rate limit par IP).
-- On retire l'insertion directe avec la clé anonyme pour fermer le contournement.
-- À exécuter après le déploiement du backend et de l'app.

revoke insert on public.support_requests from anon, authenticated;
drop policy if exists "Anyone submits support requests" on public.support_requests;
