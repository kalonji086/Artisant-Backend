-- Allow the app to listen only to legal-document update broadcasts.
begin;

drop policy if exists legal_document_updates_read on realtime.messages;
create policy legal_document_updates_read
  on realtime.messages
  for select
  to anon, authenticated
  using (
    extension = 'broadcast'
    and topic = 'legal-document-updates'
  );

commit;
