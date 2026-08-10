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
4. A future classifier writes only the differentiated editorial layer (`primary_subgenre`, optional `secondary_subgenre`, `tone_tags`, and `pacing`) to `title_editorial_classifications`, with classifier version, confidence, and review status.

The bulk classifier should not overwrite `review_status = 'gold'` rows. Low-confidence or ambiguous generated results should be routed to review rather than silently promoted.

## Environment

Maintenance scripts require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Hydration also requires `TMDB_TOKEN`. These are server/maintenance credentials and must not be exposed to the browser.
