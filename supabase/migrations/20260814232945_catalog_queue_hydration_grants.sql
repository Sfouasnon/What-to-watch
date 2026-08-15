-- Permit the server-only maintenance key to run the targeted, queue-driven
-- catalog hydrator without opening any catalog write path to browser roles.
--
-- The earlier gold hydrator intentionally kept title_classification_inputs
-- read-only. The general hydrator keeps that invariant for existing rows: it
-- may INSERT evidence for a new title, but it cannot UPDATE or DELETE the
-- frozen packet behind a gold or previously classified title.

grant select, insert, update on table public.tmdb_catalog_index to service_role;

grant insert on table public.titles to service_role;

grant insert on table public.title_classification_inputs to service_role;

-- Reassert the intended boundary explicitly. The batch selector and hydrator
-- are maintenance scripts; no queue or classifier-input writes are available
-- to browser-facing roles.
revoke all on table public.tmdb_catalog_index from anon, authenticated;
revoke insert, update, delete, truncate on table public.title_classification_inputs from anon, authenticated;

-- Gold and accepted editorial labels remain completely outside hydration.
revoke insert, update, delete, truncate on table public.title_editorial_classifications from service_role, anon, authenticated;
