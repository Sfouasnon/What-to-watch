-- RLS decides which rows a signed-in user may access; table grants decide which
-- operations reach those policies. Supabase's project defaults granted browser
-- roles TRUNCATE/REFERENCES/TRIGGER but not normal DML for these migration-owned
-- tables, so replace those defaults explicitly.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all tables in schema public from authenticated;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

-- Guest/demo mode is intentionally browser-local and receives no database DML.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
