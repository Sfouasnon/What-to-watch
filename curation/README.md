# Editorial benchmark

This directory contains the controlled editorial vocabulary and the 100-title benchmark used to evaluate future movie/TV enrichment.

## Promoted assets

- `ontology/v0.1.1/ontology.json` — frozen movie/TV benchmark vocabulary.
- `ontology/v0.2.0/ontology.json` — additive current vocabulary with 14 stand-up performance styles and the thoughtful, inventive, and surprising tones.
- `pilot/sample-100.json` — the TMDB evidence packet used by the pilot: 50 movies and 50 TV series, including overview, TMDB genres, runtime, language/country, popularity/votes, credits, and keywords.
- `pilot/pass2/final-classifications-v1.0-gold.json` — frozen 100-title adjudicated gold set.
- `pilot/pass2/editorial-corrections-v1.1.json` — explicit human corrections layered over the frozen gold artifact.
- `editorial-overrides-v1.json` — small, durable owner-approved corrections applied after generated release artifacts and recorded in publication provenance.

The gold set is a benchmark, not a template to mutate. New classifier versions should be measured against it. Human corrections are additive/versioned and always outrank generated classifications.

## Catalog pipeline

1. `npm run catalog:import-index` mirrors TMDB's daily valid movie/TV ID exports into `tmdb_catalog_index`.
2. `npm run catalog:hydrate -- --limit=100` progressively hydrates high-popularity non-adult titles into `titles`, `title_genres`, and `title_classification_inputs`.
3. `npm run catalog:seed-gold` persists the 100 benchmark titles and their authoritative classifications into Supabase.
4. `npm run catalog:prepare-batches`, `catalog:queue-batch`, and `catalog:export-batch` create controlled hydration and classification packets.
5. Reconciliation/finalization scripts validate model output against the ontology before classifications are eligible for publication.
6. `npm run catalog:publish-classifications` performs a dry run by default, then publishes an explicitly supplied manifest and final artifacts only when `--write` is present. A matching legacy provider cache may be supplied with `--providers`; otherwise availability is left unchanged for the refresh job.
7. `npm run catalog:refresh-providers -- --limit=100 --offset=0` refreshes a bounded TMDB availability segment with polite concurrency. Supply `--manifest=<path>` to target an exact controlled release. Add `--write` only after reviewing a dry run; continue from the reported `nextOffset`.
8. `npm run catalog:refresh-launch-targets -- --limit=10 --offset=0` probes WatchHub for separate web, Android TV, and Fire TV launch artifacts. It is dry-run and deliberately small by default. `--tmdb=movie:<id>` targets one published movie, and `--write` stores candidates as unverified offer launch targets. Series are skipped until recommendations identify a specific episode.

Launch-target refresh is a research and device-validation path, not authorization to depend on WatchHub as an unlicensed production feed. Production ingestion should use a source with appropriate commercial terms and an availability/deep-link SLA. Resolver payloads retain provenance and expire after seven days by default.

Imported launch targets never become executable automatically. Use `npm run catalog:verify-launch-target -- --tmdb=movie:<id> --provider=<provider-key> --platform=fire_tv` to inspect the candidate and produce the structured ADB test payload. After a successful real-device test, rerun with `--status=verified --notes=<evidence> --write`. Changed resolver targets reset to unverified, and contentless app-launch targets cannot be marked verified.

Dedicated stand-up batches use `npm run catalog:prepare-standup-ontology -- --packet=<packet-path>` after hydration. The pass requires a Stand-Up-family primary style, permits one distinct secondary style, requires two or three controlled audience-experience tones, and requires a non-null performance rhythm. It preserves any pre-v0.2.0 model responses in a sibling `<batch>-pre-v0.2.0-audit/` directory outside the upload packet instead of treating them as publishable classifications.

After placing the fresh response at `outputs/model-1.json`, run `npm run catalog:finalize-single-batch -- --packet=<packet-path>`. The finalizer validates every identity and controlled value, enforces the Stand-Up-family constraints for stand-up packets, records low-confidence and maximum-tone-cardinality flags, and creates local evaluation and final-classification artifacts. It does not publish classifications.

The publisher cannot overwrite `review_status = 'gold'` rows. Final artifacts retain low-confidence flags and original review provenance in `source_payload`, even when the approved release is published as `accepted`. Owner-approved release corrections are applied from `editorial-overrides-v1.json` by default, so an idempotent republish cannot revert them.

## Storage policy

Git contains the reusable ontology, benchmark, workflow documentation, scripts, tests, and migrations. Dated manifests, model input/output packets, provider caches, and generated preview catalogs are local operational artifacts and are ignored by Git. At larger scale, immutable run artifacts should move to object storage with their run IDs and checksums recorded in the database; finalized catalog rows belong in Supabase rather than repository JSON.

## Environment

Maintenance scripts require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Hydration also requires `TMDB_TOKEN`. These are server/maintenance credentials and must not be exposed to the browser.

Provider refresh also requires `TMDB_TOKEN`. It defaults to two concurrent requests, 200 ms between requests per worker, a 14-day availability TTL, and four bounded retry attempts that honor TMDB `Retry-After` responses. Successful empty responses intentionally clear stale TMDB offers; failures keep existing offers and schedule the title for a one-day retry in `availability_refresh_state`.

WatchHub launch-target probing requires only the Supabase maintenance credentials. It defaults to two concurrent requests, 300 ms between requests per worker, and a seven-day TTL. Keep these bounds conservative and do not bulk-ingest until the resolver's production-use terms are established.
