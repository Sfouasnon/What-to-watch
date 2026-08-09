#!/usr/bin/env node
/**
 * review-tone-completion.mjs
 *
 * Fast, resumable, terminal-based human review of the tone-completion candidates produced by
 * build-tone-completion.mjs. No LLM calls. No network calls.
 *
 * Usage:
 *   node scripts/curation/review-tone-completion.mjs             interactive review loop
 *   node scripts/curation/review-tone-completion.mjs --status     print progress only, no prompts
 *   node scripts/curation/review-tone-completion.mjs --finalize   (re)write final-classifications-v1.json
 *                                                                  from decisions already saved, no prompts
 *
 * Reads:
 *   curation/ontology/v0.1.1/ontology.json
 *   curation/pilot/pass2/tone-completion/candidates.json     (from build-tone-completion.mjs)
 *   curation/pilot/pass2/tone-completion/human-tone-decisions.json  (if it already exists — resume)
 *   curation/pilot/pass2/final-classifications.json           (never modified — only read from)
 *
 * Writes:
 *   curation/pilot/pass2/tone-completion/human-tone-decisions.json   (saved after every choice)
 *   curation/pilot/pass2/final-classifications-v1.json                (rebuilt at the end of every
 *                                                                       session, and on --finalize)
 *
 * Per candidate, exactly one of four choices is recorded:
 *   A = Add proposed third tone   (only offered when candidate.proposed_third_tone is not null)
 *   K = Keep current tags unchanged
 *   S = Skip for later            (explicit, non-terminal — the item is shown again next run)
 *   Q = Save and quit             (stops the loop; everything already decided this run is saved)
 *
 * "Skip for later" is never silently treated as "kept" or "resolved" anywhere in this script:
 * summarize() reports it under `pending`, and final-classifications-v1.json lists every skipped
 * (or never-reviewed) title under `tone_completion_summary.outstanding_pending_or_skipped` rather
 * than adding or dropping a tag for it.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const ONTOLOGY_VERSION = "0.1.1";
const ONTOLOGY_PATH = path.join(ROOT, `curation/ontology/v${ONTOLOGY_VERSION}/ontology.json`);
const PASS2_DIR = path.join(ROOT, "curation/pilot/pass2");
const TONE_DIR = path.join(PASS2_DIR, "tone-completion");
const CANDIDATES_PATH = path.join(TONE_DIR, "candidates.json");
const DECISIONS_PATH = path.join(TONE_DIR, "human-tone-decisions.json");
const FINAL_PATH = path.join(PASS2_DIR, "final-classifications.json");
const FINAL_V1_PATH = path.join(PASS2_DIR, "final-classifications-v1.json");

function loadJSON(p, label, required = true) {
  if (!existsSync(p)) {
    if (!required) return null;
    throw new Error(`Missing required file (${label}): ${p}. Run build-tone-completion.mjs first.`);
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} (${p}): ${err.message}`);
  }
}

function keyOf(tmdb_id, media_type) {
  return `${tmdb_id}:${media_type}`;
}

function buildToneVocab(ontology) {
  return new Set((ontology.tone_tags ?? []).map(t => t.id));
}

function loadDecisions() {
  const data = loadJSON(DECISIONS_PATH, "human-tone-decisions.json", false);
  if (data && data.decisions) return data;
  return {
    ontology_version: ONTOLOGY_VERSION,
    created_at: new Date().toISOString(),
    updated_at: null,
    decisions: {},
  };
}

function saveDecisions(state) {
  state.updated_at = new Date().toISOString();
  if (!existsSync(TONE_DIR)) mkdirSync(TONE_DIR, { recursive: true });
  writeFileSync(DECISIONS_PATH, JSON.stringify(state, null, 2) + "\n");
}

const TERMINAL_STATUSES = new Set(["added", "kept"]);

function summarize(candidates, state) {
  let added = 0, kept = 0, skipped = 0, undecided = 0;
  for (const c of candidates) {
    const d = state.decisions[keyOf(c.tmdb_id, c.media_type)];
    if (!d) undecided += 1;
    else if (d.status === "added") added += 1;
    else if (d.status === "kept") kept += 1;
    else if (d.status === "skipped") skipped += 1;
    else undecided += 1;
  }
  return {
    total: candidates.length,
    added, kept, skipped, undecided,
    resolved: added + kept,
    pending: skipped + undecided,
  };
}

function printProgress(summary) {
  console.log("");
  console.log(
    `Progress: ${summary.resolved}/${summary.total} resolved ` +
    `(added=${summary.added}, kept=${summary.kept}) | ` +
    `skipped=${summary.skipped} | not yet reviewed=${summary.undecided}`
  );
}

/**
 * Rebuilds final-classifications-v1.json from final-classifications.json plus whatever "added"
 * decisions exist right now. Safe to call at any time (partial or complete); never mutates
 * final-classifications.json itself. Titles that are kept/skipped/undecided are copied through
 * byte-for-byte unchanged (their tone_tags object is the exact same object from the source file).
 */
function writeFinalV1(candidates, state, toneIds) {
  const final = loadJSON(FINAL_PATH, "final-classifications.json");
  const byKey = new Map(candidates.map(c => [keyOf(c.tmdb_id, c.media_type), c]));

  let addedCount = 0;
  const outstanding = [];
  const errors = [];

  const classifications = final.classifications.map(entry => {
    const key = keyOf(entry.tmdb_id, entry.media_type);
    const cand = byKey.get(key);
    if (!cand) return entry; // not one of the 38 tone-completion candidates — untouched

    const decision = state.decisions[key];

    if (!decision || decision.status === "skipped") {
      outstanding.push({
        tmdb_id: entry.tmdb_id,
        media_type: entry.media_type,
        title: entry.title,
        status: decision ? decision.status : "undecided",
      });
      return entry; // explicitly NOT resolved — left byte-identical, never silently applied
    }

    if (decision.status === "kept") {
      return entry; // human explicitly chose to keep current tags — left byte-identical
    }

    // decision.status === "added"
    const addedTag = decision.proposed_third_tone ?? cand.proposed_third_tone;
    const originalTags = entry.tone_tags.value ?? [];

    if (!addedTag || !toneIds.has(addedTag)) {
      errors.push(`${key}: cannot apply "added" decision — invalid or missing tone id "${addedTag}"`);
      return entry;
    }
    if (originalTags.includes(addedTag)) {
      errors.push(`${key}: "added" tone "${addedTag}" is already present in current tags — leaving unchanged`);
      return entry;
    }
    const newTags = [...originalTags, addedTag];
    if (newTags.length > 3) {
      errors.push(`${key}: adding "${addedTag}" would exceed 3 tone tags — leaving unchanged`);
      return entry;
    }
    if (new Set(newTags).size !== newTags.length) {
      errors.push(`${key}: adding "${addedTag}" would create a duplicate tone tag — leaving unchanged`);
      return entry;
    }

    addedCount += 1;
    return {
      ...entry,
      tone_tags: {
        value: newTags,
        source: "human-tone-completion",
        previous_source: entry.tone_tags.source,
        added_tone: addedTag,
        decided_at: decision.decided_at ?? null,
        human_review_pending: false,
      },
    };
  });

  const fullyResolved = outstanding.length === 0;

  const output = {
    ...final,
    generated_at: new Date().toISOString(),
    based_on: "curation/pilot/pass2/final-classifications.json",
    tone_completion_summary: {
      candidates_considered: candidates.length,
      tones_added: addedCount,
      fully_resolved: fullyResolved,
      outstanding_pending_or_skipped: outstanding,
    },
    classifications,
  };

  if (!existsSync(PASS2_DIR)) mkdirSync(PASS2_DIR, { recursive: true });
  writeFileSync(FINAL_V1_PATH, JSON.stringify(output, null, 2) + "\n");

  return { addedCount, fullyResolved, outstanding, errors };
}

function reportFinalV1Result({ addedCount, fullyResolved, outstanding, errors }) {
  console.log("");
  console.log(
    `Wrote curation/pilot/pass2/final-classifications-v1.json ` +
    `[${fullyResolved ? "COMPLETE" : "PARTIAL"}] — ${addedCount} tone(s) added.`
  );
  if (!fullyResolved) {
    console.log(`  ${outstanding.length} title(s) still pending/skipped (kept as-is, not silently resolved):`);
    for (const o of outstanding) console.log(`    - [${o.status}] ${o.title}`);
  }
  if (errors.length) {
    console.log(`  Errors while applying decisions:`);
    for (const e of errors) console.log(`    - ${e}`);
  }
}

function loadCandidates() {
  const data = loadJSON(CANDIDATES_PATH, "candidates.json");
  return data.candidates ?? [];
}

async function interactiveReview() {
  const ontology = loadJSON(ONTOLOGY_PATH, "ontology.json");
  const toneIds = buildToneVocab(ontology);
  const candidates = loadCandidates();
  const state = loadDecisions();

  console.log(`Tone completion review — ${candidates.length} candidates loaded.`);
  printProgress(summarize(candidates, state));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  let quit = false;
  for (let i = 0; i < candidates.length && !quit; i++) {
    const c = candidates[i];
    const key = keyOf(c.tmdb_id, c.media_type);
    const existing = state.decisions[key];

    if (existing && TERMINAL_STATUSES.has(existing.status)) {
      continue; // already finalized in a previous session — resume by skipping silently
    }

    console.log("");
    console.log(`[${i + 1}/${candidates.length}] ${c.title}`);
    console.log(`Current:`);
    console.log(`  ${c.current_tone_tags.length ? c.current_tone_tags.join(" · ") : "(none)"}`);
    console.log(`Proposed third:`);
    if (c.proposed_third_tone) {
      const denom = c.evidence.considered_source_count ?? c.evidence.appeared_in.length;
      console.log(`  ${c.proposed_third_tone}   (support ${c.evidence.support_count}/${denom || "?"}: ${c.evidence.appeared_in.join(", ")})`);
    } else {
      console.log(`  (none — no prior model ever proposed a tag beyond the current tags)`);
    }
    if (existing && existing.status === "skipped") {
      console.log(`  [previously skipped on ${existing.decided_at}]`);
    }

    const hasThird = Boolean(c.proposed_third_tone);
    const allowed = hasThird ? ["A", "K", "S", "Q"] : ["K", "S", "Q"];

    console.log("Choices:");
    if (hasThird) console.log("  A = Add proposed third tone");
    console.log("  K = Keep current tags unchanged");
    console.log("  S = Skip for later");
    console.log("  Q = Save and quit");

    let choice = null;
    while (choice === null) {
      const raw = (await ask("> ")).trim().toUpperCase();
      if (allowed.includes(raw)) {
        choice = raw;
      } else {
        console.log(`Please enter one of: ${allowed.join("/")}`);
      }
    }

    if (choice === "Q") {
      quit = true;
      break;
    }

    const decidedAt = new Date().toISOString();
    if (choice === "A") {
      state.decisions[key] = {
        tmdb_id: c.tmdb_id,
        media_type: c.media_type,
        title: c.title,
        status: "added",
        proposed_third_tone: c.proposed_third_tone,
        final_tone_tags: [...c.current_tone_tags, c.proposed_third_tone],
        decided_at: decidedAt,
      };
    } else if (choice === "K") {
      state.decisions[key] = {
        tmdb_id: c.tmdb_id,
        media_type: c.media_type,
        title: c.title,
        status: "kept",
        proposed_third_tone: c.proposed_third_tone,
        final_tone_tags: c.current_tone_tags,
        decided_at: decidedAt,
      };
    } else if (choice === "S") {
      state.decisions[key] = {
        tmdb_id: c.tmdb_id,
        media_type: c.media_type,
        title: c.title,
        status: "skipped",
        proposed_third_tone: c.proposed_third_tone,
        final_tone_tags: null,
        decided_at: decidedAt,
      };
    }

    saveDecisions(state); // save progress after every single choice, per spec
  }

  rl.close();

  printProgress(summarize(candidates, state));
  reportFinalV1Result(writeFinalV1(candidates, state, toneIds));
}

function statusOnly() {
  const candidates = loadCandidates();
  const state = loadDecisions();
  const summary = summarize(candidates, state);
  console.log(`Tone completion status — ${summary.total} candidates.`);
  printProgress(summary);
  if (summary.pending > 0) {
    console.log("");
    console.log("Still pending (skipped or never reviewed):");
    for (const c of candidates) {
      const d = state.decisions[keyOf(c.tmdb_id, c.media_type)];
      if (!d || d.status === "skipped") {
        console.log(`  - [${d ? d.status : "undecided"}] ${c.title}`);
      }
    }
  }
}

function finalizeOnly() {
  const ontology = loadJSON(ONTOLOGY_PATH, "ontology.json");
  const toneIds = buildToneVocab(ontology);
  const candidates = loadCandidates();
  const state = loadDecisions();
  printProgress(summarize(candidates, state));
  reportFinalV1Result(writeFinalV1(candidates, state, toneIds));
}

const argv = process.argv.slice(2);
if (argv.includes("--status")) {
  statusOnly();
} else if (argv.includes("--finalize")) {
  finalizeOnly();
} else {
  interactiveReview().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
