#!/usr/bin/env node
/**
 * build-pass2.mjs
 *
 * Builds the Pass 2 blind-adjudication packet from the existing Pass 1 outputs.
 * Deterministic, no network calls, no LLM calls.
 *
 * Reads:
 *   curation/ontology/v0.1.1/ontology.json
 *   curation/pilot/pass1/classification-input.json
 *   curation/pilot/pass1/{ChatGPT,Claude,Gemini}.json   (case-insensitive fallback)
 *   curation/pilot/pass1/disagreements.json              (cross-check only)
 *
 * Writes:
 *   curation/pilot/pass2/adjudication-input.json   (for model upload — no model identity)
 *   curation/pilot/pass2/proposal-map.json          (hidden mapping — NOT for model upload)
 *
 * Scope policy (see task spec / README):
 *   A. primary_subgenre: include if Pass 1 agreement is not full (majority or none).
 *   B. severity "major" titles: always implied by A under the current severity policy
 *      (major is only assigned when primary agreement is "none"), included for robustness.
 *   C. tone_tags: include only when there is no tone id shared by >=2 of the 3 models
 *      ("no clear 2-of-3 consensus on a useful tag"), OR avg pairwise Jaccard < 0.40.
 *   D. pacing: never adjudicated in Pass 2. Pass 1 majority is used automatically downstream.
 *   E. secondary_subgenre: include if all three proposals differ ("none" agreement), OR if
 *      agreement is "majority" AND the minority value's subgenre family differs from the
 *      majority value's family (treating null as its own pseudo-family "none") — a deterministic
 *      proxy for "materially changes the interpretation of the work". Full agreement -> never.
 *
 * A/B/C shuffle: one shuffle per title (applies to every disputed field for that title),
 * seeded deterministically from a fixed master seed + tmdb_id + media_type, so the packet
 * is reproducible. The mapping is written only to proposal-map.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const ONTOLOGY_VERSION = "0.1.1";
const ONTOLOGY_PATH = path.join(ROOT, `curation/ontology/v${ONTOLOGY_VERSION}/ontology.json`);
const INPUT_PATH = path.join(ROOT, "curation/pilot/pass1/classification-input.json");
const DISAGREEMENTS_PATH = path.join(ROOT, "curation/pilot/pass1/disagreements.json");
const PASS1_DIR = path.join(ROOT, "curation/pilot/pass1");
const PASS2_DIR = path.join(ROOT, "curation/pilot/pass2");

const MASTER_SEED = "what-to-watch-pass2-v1";
const TONE_JACCARD_THRESHOLD = 0.40;

const MODELS = ["chatgpt", "claude", "gemini"];
// Pass 1 files were saved with mixed case (ChatGPT.json, Claude.json, Gemini.json) on a
// case-insensitive filesystem. Resolve case-insensitively so this script works regardless.
function resolveModelFile(model) {
  const candidates = [
    `${model}.json`,
    `${model[0].toUpperCase()}${model.slice(1)}.json`,
    model === "chatgpt" ? "ChatGPT.json" : null,
  ].filter(Boolean);
  for (const c of candidates) {
    const p = path.join(PASS1_DIR, c);
    if (existsSync(p)) return p;
  }
  throw new Error(`Could not find pass1 output file for ${model} in ${PASS1_DIR}`);
}

function loadJSON(p, label) {
  if (!existsSync(p)) throw new Error(`Missing required file (${label}): ${p}`);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} (${p}): ${err.message}`);
  }
}

function keyOf(entry) {
  return `${entry.tmdb_id}:${entry.media_type}`;
}

function buildVocab(ontology) {
  const subgenreFamilyOf = new Map();
  for (const family of ontology.subgenre_families ?? []) {
    for (const term of family.terms ?? []) {
      subgenreFamilyOf.set(term.id, family.family_id);
    }
  }
  const toneIds = new Set((ontology.tone_tags ?? []).map(t => t.id));
  return { subgenreFamilyOf, toneIds };
}

function familyOf(subgenreFamilyOf, value) {
  if (value === null || value === undefined) return "__null__";
  return subgenreFamilyOf.get(value) ?? "__unknown__";
}

function jaccard(a, b) {
  const setA = new Set(a ?? []);
  const setB = new Set(b ?? []);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

function threeWayAgreement(values) {
  const [a, b, c] = values;
  if (a === b && b === c) return "full";
  if (a === b || b === c || a === c) return "majority";
  return "none";
}

// Returns the majority value (the one shared by 2 of 3) for a "majority" agreement triple.
function majorityValue(values) {
  const [a, b, c] = values;
  if (a === b) return a;
  if (b === c) return b;
  if (a === c) return a;
  return undefined;
}

function minorityValue(values) {
  const [a, b, c] = values;
  if (a === b) return c;
  if (b === c) return a;
  if (a === c) return b;
  return undefined;
}

function hasTagWithTwoOfThreeSupport(toneA, toneB, toneC) {
  const counts = new Map();
  for (const list of [toneA, toneB, toneC]) {
    for (const tag of new Set(list ?? [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  for (const count of counts.values()) {
    if (count >= 2) return true;
  }
  return false;
}

// --- deterministic seeded PRNG (mulberry32) + FNV-1a string hash for the seed ---
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle3(items, seedStr) {
  const rng = mulberry32(fnv1a(seedStr));
  const arr = items.slice();
  // Fisher-Yates on a 3-element array
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function main() {
  const ontology = loadJSON(ONTOLOGY_PATH, "ontology.json");
  const vocab = buildVocab(ontology);

  const input = loadJSON(INPUT_PATH, "classification-input.json");
  const inputTitles = input.titles ?? [];
  const titleMeta = new Map(inputTitles.map(t => [keyOf(t), t]));

  const disagreements = loadJSON(DISAGREEMENTS_PATH, "disagreements.json");
  const disagreementKeys = new Set(disagreements.disagreements.map(keyOf));

  const modelData = {};
  for (const model of MODELS) {
    const p = resolveModelFile(model);
    const data = loadJSON(p, `${model} pass1 output`);
    const byKey = new Map((data.classifications ?? []).map(e => [keyOf(e), e]));
    modelData[model] = byKey;
  }

  const scopeStats = {
    titles_included: 0,
    fields: { primary_subgenre: 0, secondary_subgenre: 0, tone_tags: 0 },
    secondary_escalated_from_majority: 0,
    secondary_none_included: 0,
    severity_major_all_covered_by_primary: 0,
    titles_not_in_disagreements_but_included: [],
  };

  const proposalMapEntries = [];
  const adjudicationInputEntries = [];

  for (const meta of inputTitles) {
    const key = keyOf(meta);
    const chatgpt = modelData.chatgpt.get(key);
    const claude = modelData.claude.get(key);
    const gemini = modelData.gemini.get(key);
    if (!chatgpt || !claude || !gemini) {
      throw new Error(`Title ${key} (${meta.title}) missing from one or more Pass 1 model outputs`);
    }

    const primaryVals = [chatgpt.primary_subgenre, claude.primary_subgenre, gemini.primary_subgenre];
    const secondaryVals = [chatgpt.secondary_subgenre, claude.secondary_subgenre, gemini.secondary_subgenre];
    const toneVals = [chatgpt.tone_tags, claude.tone_tags, gemini.tone_tags];

    const primaryAgreement = threeWayAgreement(primaryVals);
    const secondaryAgreement = threeWayAgreement(secondaryVals);

    const pairs = [[toneVals[0], toneVals[1]], [toneVals[0], toneVals[2]], [toneVals[1], toneVals[2]]];
    const avgToneJaccard = pairs.reduce((s, [a, b]) => s + jaccard(a, b), 0) / pairs.length;
    const twoOfThreeToneConsensus = hasTagWithTwoOfThreeSupport(...toneVals);

    const disputes = [];

    // A/B: primary_subgenre
    if (primaryAgreement !== "full") {
      disputes.push({ field: "primary_subgenre", values: primaryVals });
      scopeStats.fields.primary_subgenre += 1;
      if (primaryAgreement === "none") scopeStats.severity_major_all_covered_by_primary += 1;
    }

    // C: tone_tags
    if (avgToneJaccard < TONE_JACCARD_THRESHOLD || !twoOfThreeToneConsensus) {
      disputes.push({ field: "tone_tags", values: toneVals });
      scopeStats.fields.tone_tags += 1;
    }

    // E: secondary_subgenre
    // Policy decision (flagged for human approval — see README / build report): "materially
    // changes the interpretation of the work" is inherently a judgment call. An earlier version
    // of this script tried a deterministic proxy (escalate whenever the minority value's
    // subgenre family differs from the majority value's family), but that fired on 47 of 54
    // majority-agreement titles — nearly all of them — because the 16 top-level families are
    // broad and unrelated secondary pairs are the norm, not the exception. That violates the
    // "keep the packet focused" instruction, so this script defaults to the literal, conservative
    // reading of section 10's policy: majority secondary is auto-accepted, full stop. Only
    // "all three differ" (secondaryAgreement === "none") is sent to Pass 2. If a human reviewer
    // wants specific majority-secondary titles escalated as materially misleading, that should be
    // a manual, reviewed addition — not a blanket heuristic — and can be added to `values` below
    // by tmdb_id before re-running.
    if (secondaryAgreement === "none") {
      disputes.push({ field: "secondary_subgenre", values: secondaryVals });
      scopeStats.fields.secondary_subgenre += 1;
      scopeStats.secondary_none_included += 1;
    }

    if (disputes.length === 0) continue;

    scopeStats.titles_included += 1;
    if (!disagreementKeys.has(key)) {
      scopeStats.titles_not_in_disagreements_but_included.push(key);
    }

    // One shuffle per title, deterministic.
    const order = seededShuffle3(MODELS, `${MASTER_SEED}:${key}`);
    const mapping = { A: order[0], B: order[1], C: order[2] };

    proposalMapEntries.push({
      tmdb_id: meta.tmdb_id,
      media_type: meta.media_type,
      title: meta.title,
      mapping,
    });

    const modelValueFor = (field, modelName) => {
      const entry = modelName === "chatgpt" ? chatgpt : modelName === "claude" ? claude : gemini;
      return entry[field];
    };

    const disputeEntries = disputes.map(d => ({
      field: d.field,
      proposal_a: modelValueFor(d.field, mapping.A),
      proposal_b: modelValueFor(d.field, mapping.B),
      proposal_c: modelValueFor(d.field, mapping.C),
    }));

    adjudicationInputEntries.push({
      tmdb_id: meta.tmdb_id,
      media_type: meta.media_type,
      title: meta.title,
      context: {
        original_title: meta.original_title,
        year: meta.year,
        overview: meta.overview,
        tmdb_genres: meta.tmdb_genres,
        runtime: meta.runtime,
        original_language: meta.original_language,
        origin_country: meta.origin_country,
        directors: meta.directors,
        writers: meta.writers,
        cinematographers: meta.cinematographers,
        principal_cast: meta.principal_cast,
        keywords: meta.keywords,
      },
      disputes: disputeEntries,
    });
  }

  if (!existsSync(PASS2_DIR)) mkdirSync(PASS2_DIR, { recursive: true });

  const adjudicationInput = {
    ontology_version: ONTOLOGY_VERSION,
    pass: 2,
    generated_at: new Date().toISOString(),
    title_count: adjudicationInputEntries.length,
    titles: adjudicationInputEntries,
  };
  writeFileSync(
    path.join(PASS2_DIR, "adjudication-input.json"),
    JSON.stringify(adjudicationInput, null, 2) + "\n"
  );

  const proposalMap = {
    warning: "DO NOT upload this file to any model. It de-anonymizes the A/B/C proposals in adjudication-input.json.",
    seed: MASTER_SEED,
    generated_at: new Date().toISOString(),
    entries: proposalMapEntries,
  };
  writeFileSync(
    path.join(PASS2_DIR, "proposal-map.json"),
    JSON.stringify(proposalMap, null, 2) + "\n"
  );

  console.log(`Titles included in Pass 2: ${scopeStats.titles_included} / ${inputTitles.length}`);
  console.log(`Disputed fields: primary_subgenre=${scopeStats.fields.primary_subgenre}, secondary_subgenre=${scopeStats.fields.secondary_subgenre} (none-agreement=${scopeStats.secondary_none_included}, escalated-from-majority=${scopeStats.secondary_escalated_from_majority}), tone_tags=${scopeStats.fields.tone_tags}`);
  console.log(`Titles included that were NOT in disagreements.json (unexpected, should be empty): ${JSON.stringify(scopeStats.titles_not_in_disagreements_but_included)}`);
  console.log(`Wrote curation/pilot/pass2/adjudication-input.json and curation/pilot/pass2/proposal-map.json`);
}

main();
