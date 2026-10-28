-- Enable live updates for the artisan dashboard's profile, quote, and service data.
do $$
declare
  target_table text;
begin
  foreach target_table in array array['profiles', 'quotes', 'artisan_services'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target_table
      );
    end if;
  end loop;
end
$$;
