# Editorial benchmark

This directory contains the controlled editorial vocabulary and the 100-title benchmark used to evaluate future movie/TV enrichment.

## Promoted assets

- `ontology/v0.1.1/ontology.json` — controlled subgenre, tone, and pacing vocabulary.
- `pilot/sample-100.json` — the TMDB evidence packet used by the pilot: 50 movies and 50 TV series, including overview, TMDB genres, runtime, language/country, popularity/votes, credits, and keywords.
- `pilot/pass2/final-classifications-v1.0-gold.json` — frozen 100-title adjudicated gold set.
- `pilot/pass2/editorial-corrections-v1.1.json` — explicit human corrections layered over the frozen gold artifact.

The gold set is a benchmark, not a template to mutate. New classifier versions should be measured against it. Human corrections are additive/versioned and always outrank generated classifications.

## Catalog pipeline

1. `npm run catalog:import-index` mirrors TMDB's daily valid movie/TV ID exports into `tmdb_catalog_index`.
2. `npm run catalog:hydrate -- --limit=100` progressively hydrates high-popularity non-adult titles into `titles`, `title_genres`, and `title_classification_inputs`.
3. `npm run catalog:seed-gold` persists the 100 benchmark titles and their authoritative classifications into Supabase.
4. `npm run catalog:prepare-batches`, `catalog:queue-batch`, and `catalog:export-batch` create controlled hydration and classification packets.
5. Reconciliation/finalization scripts validate model output against the ontology before classifications are eligible for publication.
6. `npm run catalog:publish-classifications` performs a dry run by default, then publishes an explicitly supplied manifest, final artifacts, and provider cache only when `--write` is present.

The publisher cannot overwrite `review_status = 'gold'` rows. Final artifacts retain low-confidence flags and original review provenance in `source_payload`, even when the approved release is published as `accepted`.

## Storage policy

Git contains the reusable ontology, benchmark, workflow documentation, scripts, tests, and migrations. Dated manifests, model input/output packets, provider caches, and generated preview catalogs are local operational artifacts and are ignored by Git. At larger scale, immutable run artifacts should move to object storage with their run IDs and checksums recorded in the database; finalized catalog rows belong in Supabase rather than repository JSON.

## Environment

Maintenance scripts require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Hydration also requires `TMDB_TOKEN`. These are server/maintenance credentials and must not be exposed to the browser.
