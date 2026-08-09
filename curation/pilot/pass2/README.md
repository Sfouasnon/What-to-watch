# Pass 2 — Blind Adjudication Experiment (Ontology v0.1.1)

Pass 1 ran the same 100-title pilot sample through three LLMs and compared their answers
(`curation/pilot/pass1/`). Pass 2 does **not** reclassify all 100 titles. It takes only the
fields that were meaningfully disputed in Pass 1, shows each of them to three independent
reviewers as three **anonymized** proposals (Proposal A/B/C — model identity hidden and
reshuffled per title), and asks each reviewer to adjudicate against the ontology. The goal is
to see whether independent reviewers converge when shown the competing interpretations, not to
re-run Pass 1's guesswork a second time.

## What's in this folder

- `adjudication-input.json` — the disputed-field packet: 49 titles, 77 disputed fields
  (32 `primary_subgenre`, 19 `secondary_subgenre`, 26 `tone_tags`), each field's three Pass 1
  proposals anonymized as A/B/C. **Safe to upload to a model.**
- `adjudication-prompt.md` — the instructions and full controlled vocabulary to paste into each
  model alongside `adjudication-input.json`.
- `proposal-map.json` — the hidden A/B/C → source-model mapping, generated with a deterministic
  seed so it's reproducible. **Do NOT upload this file to any model.** It only exists so the
  comparator script and a human reviewer can trace an adjudicated answer back to which Pass 1
  model originally proposed it, after the fact.
- `README.md` — this file.
- (to be added by you, one per model) `chatgpt-pass2.json`, `claude-pass2.json`, `gemini-pass2.json`
- (to be produced later by `scripts/curation/compare-pass2.mjs`) `pass2-summary.json`,
  `auto-accepted.json`, `provisional-accepted.json`, `human-review.json`, `human-review.csv`,
  `proposed-final-classifications.json`

## How to run the experiment

1. **ChatGPT.** Start a fresh conversation — do not reuse the Pass 1 conversation or reference it.
   Paste the contents of `adjudication-prompt.md`, then paste or attach `adjudication-input.json`
   in the same turn. Save the model's JSON response, exactly as returned, to
   `curation/pilot/pass2/chatgpt-pass2.json`.
2. **Claude.** Repeat independently in a fresh Claude conversation, using the same two files.
   Save the result to `curation/pilot/pass2/claude-pass2.json`.
3. **Gemini.** Repeat independently in a fresh Gemini conversation, using the same two files.
   Save the result to `curation/pilot/pass2/gemini-pass2.json`.

**Do not show one model's Pass 2 output to another model**, and do not tell any of the three
which underlying Pass 1 model produced which proposal — none of them are told this either,
since `adjudication-input.json` contains no model identity. This independence is what makes
convergence (or lack of it) across the three Pass 2 runs meaningful.

If a model wraps its JSON in a code fence or adds any stray prose, strip that before saving —
each saved file should contain nothing but the JSON object described in `adjudication-prompt.md`
(`{"ontology_version": "0.1.1", "pass": 2, "adjudications": [...]}`).

## After all three files exist

Once `chatgpt-pass2.json`, `claude-pass2.json`, and `gemini-pass2.json` are all present in this
folder, run the comparator:

```
node scripts/curation/compare-pass2.mjs
```

It validates all three files against the ontology and the original dispute list, then resolves
every disputed field using these rules:

- **AUTO-ACCEPT** — all three adjudicators chose the same `preferred_value` and no more than one
  requested `human_review`.
- **PROVISIONAL ACCEPT** — two of three chose the same value, the third differs, and fewer than
  two adjudicators requested `human_review`.
- **HUMAN REVIEW** — all three chose different values, OR at least two requested `human_review`,
  OR the field is `primary_subgenre` and remains unresolved, OR the comparator detects
  conflicting or invalid output. HUMAN REVIEW items are never silently resolved by majority.

It writes `pass2-summary.json`, `auto-accepted.json`, `provisional-accepted.json`,
`human-review.json`, `human-review.csv`, and a merged `proposed-final-classifications.json` that
combines Pass 1's already-settled fields with Pass 2's resolved fields, marking anything still
unresolved explicitly. It does not modify any Pass 1 file.

The script is deterministic (no LLM calls) and intentionally **refuses to run** until all three
Pass 2 model files exist.

## Tone tag preference policy (2026-08-09)

`adjudication-prompt.md` now instructs adjudicators to **prefer exactly 3 tone tags** whenever three genuinely descriptive controlled terms apply, reversing the earlier "prefer fewer, precise tags" guidance. Two tags remain acceptable only when a third would be weak, redundant, speculative, or misleading; one or zero tags should be rare and require genuinely insufficient evidence; tags must never be padded to three just to hit the count. This is a preference change, not a vocabulary change — ontology version stays at 0.1.1 (see `curation/ontology/v0.1.1/ontology.md`, "Tone tag preference policy"). It applies to any **future** run of this Pass 2 workflow; the `chatgpt-pass2.json`/`claude-pass2.json`/`gemini-pass2.json` outputs, `human-decisions.json`, and `final-classifications.json` already on disk were produced under the prior guidance and are not retroactively changed. `curation/pilot/pass2/tone-coverage-review.json` lists every title in `final-classifications.json` currently under 3 tone tags, with its source and a `needs_editorial_review` flag, for optional manual re-examination against this policy — no tags were added or changed automatically.

## Scope reminder

Pass 2 only adjudicates `primary_subgenre`, `secondary_subgenre`, and `tone_tags`, and only for
titles/fields that met the dispute criteria in `curation/pilot/pass2/adjudication-input.json`
(see `scripts/curation/build-pass2.mjs` for the exact, documented policy). `pacing` is never
sent to Pass 2 — Pass 1 majority is used automatically, since all 100 titles reached at least
majority pacing agreement. Titles/fields not present in `adjudication-input.json` are not part
of this experiment.
