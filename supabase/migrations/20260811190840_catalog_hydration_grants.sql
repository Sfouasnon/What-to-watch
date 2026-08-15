-- Grants the catalog hydration scripts exactly the object privileges they need,
-- and nothing more. Supabase checks object grants before RLS, and the
-- service-role key bypasses RLS but never object grants.

grant update on table public.titles to service_role;

grant select, insert, update on table public.people to service_role;

grant select, insert, delete on table public.title_credits to service_role;

grant select, insert on table public.title_genres to service_role;

grant select on table public.genres to service_role;

-- Defensive: re-assert that the editorial tables stay read-only for the API
-- roles, so a future broad `grant all ... to service_role` cannot silently
-- reopen them.
revoke insert, update, delete, truncate on table
  public.title_editorial_classifications,
  public.title_classification_inputs
from service_role;
