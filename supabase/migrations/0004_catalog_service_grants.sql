-- Allow the server-side recommendation catalog route to read the minimum
-- production tables it needs through Supabase's Data API.
--
-- Supabase Data API access uses two separate layers: PostgreSQL object grants
-- determine whether a role can reach a table at all, while RLS determines
-- which rows that role may access. The service-role/secret key bypasses RLS,
-- but still needs an explicit SELECT grant when automatic table exposure is
-- disabled.

grant select on table
  public.titles,
  public.title_classification_inputs,
  public.title_editorial_classifications
to service_role;
