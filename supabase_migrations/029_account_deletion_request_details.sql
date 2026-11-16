begin;

alter table public.account_deletion_requests
  add column if not exists reason text not null default 'other',
  add column if not exists details text not null default 'Demande antérieure à la collecte des précisions.';

alter table public.account_deletion_requests
  add constraint account_deletion_requests_reason_check
  check (reason in ('no_longer_needed', 'duplicate_account', 'privacy', 'other'));

alter table public.account_deletion_requests
  add constraint account_deletion_requests_details_length_check
  check (char_length(btrim(details)) between 20 and 2000);

commit;

notify pgrst, 'reload schema';
