-- Diagnostic only: this is not an executable RLS migration.
--
-- Supabase owns PostGIS extension objects as supabase_admin. The project
-- postgres role cannot enable RLS or change grants on public.spatial_ref_sys.
-- Because public.profiles.location uses the PostGIS geography type, do not
-- drop/recreate PostGIS yourself: that can remove the column and dependent
-- indexes, views, and functions.
--
-- Ask Supabase Support to move PostGIS to the non-exposed extensions schema.
-- Check the current location and anon write privileges with:

select
  e.extnamespace::regnamespace as postgis_schema,
  pg_get_userbyid(c.relowner) as spatial_ref_sys_owner,
  has_table_privilege(
    'anon',
    e.extnamespace::regnamespace || '.spatial_ref_sys',
    'insert, update, delete'
  ) as anon_can_write
from pg_extension e
join pg_class c
  on c.relname = 'spatial_ref_sys'
join pg_namespace n
  on n.oid = c.relnamespace
 and n.oid = e.extnamespace
where e.extname = 'postgis';
