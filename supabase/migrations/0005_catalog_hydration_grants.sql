-- Grants the catalog hydration scripts exactly the object privileges they need,
-- and nothing more.
--
-- Migration 0004 gave service_role SELECT on the three tables the recommendation
-- route reads. The hydration scripts additionally write factual metadata, so
-- they need DML on the factual tables. Supabase's Data API checks PostgreSQL
-- object grants before RLS, and the service-role key bypasses RLS but never
-- object grants -- so without this migration `catalog:hydrate-gold` fails with
-- "permission denied for table titles" on its first write.
--
-- The shape of these grants is deliberate. service_role receives:
--
--   * UPDATE on titles          -- factual columns only, enforced in the script
--   * INSERT/UPDATE on people   -- upserted by TMDB person id
--   * INSERT/DELETE on title_credits, which is rebuilt per title each run
--   * INSERT on title_genres    -- genre links refreshed from TMDB
--   * SELECT on genres          -- the TMDB genre id -> genre lookup
--
-- and pointedly does NOT receive INSERT, UPDATE, or DELETE on
-- title_editorial_classifications or title_classification_inputs. Those keep
-- SELECT only, from 0004. The separation of factual metadata from editorial
-- truth is therefore enforced by the database itself: even a buggy or malicious
-- hydration run cannot write the gold set, independently of the allowlist in
-- scripts/catalog/lib/tmdb-mapping.mjs and the protect_gold_editorial_
-- classification trigger.

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
