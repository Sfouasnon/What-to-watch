# Controlled hydration batches

Hydration manifests are intentionally small, immutable snapshots of the exact TMDB identities selected for a catalog run. They prevent a changing popularity feed from changing the meaning of “the next 900” halfway through a multi-day review.

## 1. Prepare the nine-batch manifest

```bash
npm run catalog:prepare-batches -- --total=900 --batch-size=100 --movie-percent=50 --min-votes=250
```

This reads TMDB Discover and the current Supabase catalog, excludes identities already stored or queued, requires useful classification evidence, and writes one JSON manifest in this directory. It does not modify the database.

## 2. Inspect and dry-run one batch

```bash
npm run catalog:queue-batch -- --manifest=curation/batches/<manifest>.json --batch=1
```

The command refuses to mix a new batch with pending, failed, or in-flight rows from another batch.

## 3. Admit exactly one batch

```bash
npm run catalog:queue-batch -- --manifest=curation/batches/<manifest>.json --batch=1 --write
npm run catalog:hydrate -- --limit=100
npm run catalog:export-batch -- --manifest=curation/batches/<manifest>.json --batch=1
```

Finish or explicitly resolve the current batch before admitting the next one. The existing hydrator records `pending`, `hydrating`, `hydrated`, `error`, and `skipped` states and recovers stale in-flight work.

The export command requires every title in the selected batch to be hydrated. It then creates a self-contained LLM work packet at `curation/classification/YYYY-MM-DD/batch-NNN/` with hydrated evidence, the frozen ontology, response schema, model instructions, output locations, and explicit subgenre/tone-tag workflow status. The command refuses to overwrite an existing packet.

## Default at scale: one validated GPT pass

For routine capacity runs, combine up to three hydrated 100-title batches into a GPT-only experiment:

```bash
npm run catalog:export-experiment -- \
  --manifest=curation/batches/<manifest>.json \
  --batches=1,2,3 \
  --experiment=batches-001-003-gpt \
  --workflow=gpt-only

# Save the response as outputs/model-1.json, then validate and finalize it.
npm run catalog:finalize-gpt-experiment -- \
  --packet=curation/classification-experiments/YYYY-MM-DD/batches-001-003-gpt
```

The finalizer requires exact identity coverage, controlled ontology values, two or three unique tone tags, valid pacing, confidence, and bounded rationales. It flags confidence below `0.75` for audit and never publishes to Supabase. Before a run is promoted, review the flagged rows plus a random quality-control sample. The multi-model and terminal human-review flow below remains available for benchmark audits or a run that fails quality control.

## Optional audit flow: reconcile two independent model passes

Save the responses as `outputs/model-1.json` and `outputs/model-2.json`, then run:

```bash
npm run catalog:reconcile-batch -- --packet=curation/classification/YYYY-MM-DD/batch-NNN
```

The reconciler rejects missing titles, duplicate identities, uncontrolled vocabulary, invalid cardinality, and malformed metadata. It accepts exact field-level agreements (tone-tag order is ignored), writes an immutable consensus report, and creates a self-contained `arbiter/` folder containing only titles and fields that disagreed. It does not write editorial classifications to Supabase.

## Validate the arbiter and create human review

Save the arbiter result as `outputs/arbiter-response.json`, then run:

```bash
npm run catalog:finalize-batch -- --packet=curation/classification/YYYY-MM-DD/batch-NNN
```

The finalizer accepts an arbiter value when it matches either original model value, forming an adjudicated majority. A new third value or arbiter confidence below `0.75` is placed in a self-contained `human-review/` packet. The generated classifications remain provisional until that packet is complete; nothing is written to Supabase.

## Review the remaining fields in the terminal

```bash
npm run catalog:review-batch -- --packet=curation/classification/YYYY-MM-DD/batch-NNN
```

The interactive reviewer shows the title evidence, all three proposed values, and the relevant controlled definitions. Choose `A`, `B`, or `C`; use `O` for another valid ontology value, `S` to skip, or `Q` to save and quit. Progress is saved after every answer in `human-review/human-review-decisions.json`, and rerunning the command resumes where it stopped.

## Complete the local batch artifact

After the terminal reviewer reports completion, run:

```bash
npm run catalog:complete-batch -- --packet=curation/classification/YYYY-MM-DD/batch-NNN
```

This validates reviewer identity, timestamp, exact field coverage, controlled vocabulary, and subgenre constraints. It writes immutable `outputs/final-classifications.json` and marks all local workflow statuses complete. Publishing those classifications to Supabase remains a separate, explicit operation.

## Selection policy

- 50% movies and 50% television by default.
- Candidates come from both high-vote and currently popular TMDB Discover pools.
- Adult, video, unreleased, posterless, dateless, genreless, low-evidence, and low-vote candidates are excluded.
- The deterministic selector rewards quality evidence while preventing genres, decades, and languages from collapsing into a single narrow cluster.
- Existing `titles` and `tmdb_catalog_index` identities are excluded.

Manifests contain metadata and IDs only—no artwork or full TMDB payloads. They are generated operational artifacts and are ignored by Git. Archive completed manifests in durable object storage, keyed by `runId`, instead of growing the source repository.

## Validate a completed local run

Pass the manifest, each final classification artifact, and optionally the generated preview catalog to the validator:

```bash
npm run catalog:validate-local -- \
  --manifest=curation/batches/<manifest>.json \
  --artifact=curation/classification/<run>/outputs/final-classifications.json \
  --preview=src/data/preview-catalog-<size>.json
```

Repeat `--artifact` for runs that produced multiple final artifacts. Validation requires exact identity coverage, controlled ontology values, two or three unique tone tags, valid pacing, unique preview IDs, and complete recommendation metadata.
