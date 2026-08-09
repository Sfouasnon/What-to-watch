# Pass 1 — Manual Editorial Classification Experiment (Ontology v0.1.1)

This is the first experiment in building What to Watch's editorial classification layer. It runs
the same 100-title pilot sample through three different LLMs, by hand, using identical inputs and
instructions, so their outputs can be compared for agreement and disagreement before any
classification pipeline is automated.

## What's in this folder

- `classification-input.json` — the 100-title factual context packet (from `sample-100.json`),
  identical for all three models.
- `classification-prompt.md` — the instructions and controlled vocabulary to paste into each model.
- `README.md` — this file.
- (to be added by you, one per model) `chatgpt.json`, `claude.json`, `gemini.json`
- (to be produced later by `scripts/curation/compare-pass1.mjs`) `agreement-summary.json`,
  `disagreements.json`, `human-review.csv`

## How to run the experiment

1. **ChatGPT.** Start a fresh conversation. Paste the contents of `classification-prompt.md`, then
   paste or attach `classification-input.json` in the same turn. Save the model's JSON response,
   exactly as returned, to `curation/pilot/pass1/chatgpt.json`.
2. **Claude.** Repeat independently in a fresh Claude conversation, using the same two files. Save
   the result to `curation/pilot/pass1/claude.json`.
3. **Gemini.** Repeat independently in a fresh Gemini conversation, using the same two files. Save
   the result to `curation/pilot/pass1/gemini.json`.

**Do not show one model's output to another model.** Each of the three runs must be independent —
no model should see another model's classifications, reasoning, or JSON before producing its own.
This is what makes the three outputs usable as independent samples for an agreement analysis.

If a model wraps its JSON in a code fence or adds any stray prose, strip that before saving — each
saved file should contain nothing but the JSON object described in `classification-prompt.md`
(`{"ontology_version": "0.1.1", "classifications": [...]}`).

## After all three files exist

Once `chatgpt.json`, `claude.json`, and `gemini.json` are all present in this folder, the comparison
script at `scripts/curation/compare-pass1.mjs` can be run to produce:

- `agreement-summary.json` — aggregate agreement statistics across the three models, per field.
- `disagreements.json` — the specific titles and fields where the models disagreed, with severity.
- `human-review.csv` — a flat, spreadsheet-friendly export of every title's three classifications
  side by side, for manual adjudication.

The script is deterministic (no LLM calls) and validates all three files against the same schema
before comparing them. See the script's header comment for exact usage. It has been written but
intentionally **not run** as part of this task, since the three model output files don't exist yet.

## Scope reminder

This pass classifies only `primary_subgenre`, `secondary_subgenre`, `tone_tags`, and `pacing` — the
intrinsic editorial properties defined in `curation/ontology/v0.1.1/ontology.md`. It does not touch
hidden-gem, comfort-watch, blind-spot, rewatchability, mainstream/niche, film-school-worthiness,
canonical importance, or Criterion status. Those remain out of scope for this experiment.

## Tone tag preference policy (2026-08-09)

`classification-prompt.md` now instructs models to **prefer exactly 3 tone tags** whenever three genuinely descriptive controlled terms apply, reversing the earlier "prefer fewer, precise tags" guidance. Two tags remain acceptable only when a third would be weak, redundant, speculative, or misleading; one or zero tags should be rare and require genuinely insufficient evidence; tags must never be padded to three just to hit the count. This is a preference change, not a vocabulary change — ontology version stays at 0.1.1 (see `curation/ontology/v0.1.1/ontology.md`, "Tone tag preference policy"). It applies to any **future** run of this Pass 1 workflow; the `chatgpt.json`/`claude.json`/`gemini.json` outputs already on disk were produced under the prior guidance and are not retroactively changed. See `curation/pilot/pass2/tone-coverage-review.json` for the titles already below 3 tone tags.

## Ontology version note

This experiment uses **Editorial Ontology v0.1.1**, an additive patch on v0.1 that adds an
Animation subgenre family (`animated-family`, `adult-animation`, `anime-action`, `isekai`) and two
TV-specific terms (`late-night-talk-show`, `news-satire`) to address gaps found in this same
100-title sample. See `curation/ontology/v0.1.1/ontology.md` for the full vocabulary and
`curation/ontology/v0.1.1/gaps-v0.1.1.md` for remaining known gaps. The original v0.1 ontology is
preserved unmodified at `curation/ontology/v0.1/` for reference; it is not used by this pass.
