#!/usr/bin/env node
/**
 * Build tone-completion review candidates from the existing curated pilot.
 *
 * No network or LLM calls. Historical outputs are read-only.
 *
 * Reads (when present):
 *   curation/ontology/v0.1.1/ontology.json
 *   curation/pilot/pass2/final-classifications.json
 *   curation/pilot/pass1/{chatgpt,claude,gemini}.json
 *   curation/pilot/pass1/disagreements.json
 *   curation/pilot/pass2/{chatgpt-pass2,claude-pass2,gemini-pass2}.json
 *   curation/pilot/pass2/human-review.json
 *
 * Writes:
 *   curation/pilot/pass2/tone-completion/candidates.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const ONTOLOGY_VERSION = "0.1.1";
const PASS1_DIR = path.join(ROOT, "curation/pilot/pass1");
const PASS2_DIR = path.join(ROOT, "curation/pilot/pass2");
const TONE_DIR = path.join(PASS2_DIR, "tone-completion");
const ONTOLOGY_PATH = path.join(ROOT, `curation/ontology/v${ONTOLOGY_VERSION}/ontology.json`);
const FINAL_PATH = path.join(PASS2_DIR, "final-classifications.json");
const OUTPUT_PATH = path.join(TONE_DIR, "candidates.json");

function loadJSON(p, label, required = true) {
  if (!existsSync(p)) {
    if (!required) return null;
    throw new Error(`Missing required file (${label}): ${p}`);
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

function addEvidence(store, key, source, tags, currentTags, validToneIds) {
  if (!Array.isArray(tags)) return;
  if (!store.has(key)) store.set(key, new Map());
  const perTag = store.get(key);
  for (const tag of tags) {
    if (!validToneIds.has(tag) || currentTags.has(tag)) continue;
    if (!perTag.has(tag)) perTag.set(tag, new Set());
    perTag.get(tag).add(source);
  }
}

const ontology = loadJSON(ONTOLOGY_PATH, "ontology.json");
if (ontology.ontology_version !== ONTOLOGY_VERSION) {
  throw new Error(`Expected ontology ${ONTOLOGY_VERSION}, got ${ontology.ontology_version}`);
}
const validToneIds = new Set((ontology.tone_tags ?? []).map(t => t.id));
const final = loadJSON(FINAL_PATH, "final-classifications.json");
const thin = (final.classifications ?? []).filter(entry => {
  const tags = entry?.tone_tags?.value ?? [];
  return Array.isArray(tags) && tags.length < 3;
});
const currentByKey = new Map(thin.map(entry => [
  keyOf(entry.tmdb_id, entry.media_type),
  new Set(entry.tone_tags.value ?? []),
]));

const evidence = new Map();
const sourceUniverse = new Map();
function noteSource(key, source) {
  if (!sourceUniverse.has(key)) sourceUniverse.set(key, new Set());
  sourceUniverse.get(key).add(source);
}

// Pass 1 raw outputs, if available.
for (const model of ["chatgpt", "claude", "gemini"]) {
  const p = path.join(PASS1_DIR, `${model}.json`);
  const data = loadJSON(p, `${model}.json`, false);
  if (!data) continue;
  for (const row of data.classifications ?? []) {
    const key = keyOf(row.tmdb_id, row.media_type);
    if (!currentByKey.has(key)) continue;
    const source = `pass1:${model}`;
    noteSource(key, source);
    addEvidence(evidence, key, source, row.tone_tags, currentByKey.get(key), validToneIds);
  }
}

// Pass 1 disagreement artifact is a fallback and also makes this script portable if raw outputs are absent.
const disagreement = loadJSON(path.join(PASS1_DIR, "disagreements.json"), "disagreements.json", false);
if (disagreement) {
  for (const row of disagreement.disagreements ?? []) {
    const key = keyOf(row.tmdb_id, row.media_type);
    if (!currentByKey.has(key)) continue;
    for (const model of ["chatgpt", "claude", "gemini"]) {
      const source = `pass1:${model}`;
      noteSource(key, source);
      addEvidence(evidence, key, source, row?.tone_tags?.[model], currentByKey.get(key), validToneIds);
    }
  }
}

// Pass 2 raw adjudications, if available.
for (const model of ["chatgpt", "claude", "gemini"]) {
  const p = path.join(PASS2_DIR, `${model}-pass2.json`);
  const data = loadJSON(p, `${model}-pass2.json`, false);
  if (!data) continue;
  for (const row of data.adjudications ?? []) {
    const key = keyOf(row.tmdb_id, row.media_type);
    if (!currentByKey.has(key)) continue;
    for (const field of row.fields ?? []) {
      if (field.field !== "tone_tags") continue;
      const source = `pass2:${model}`;
      noteSource(key, source);
      addEvidence(evidence, key, source, field.preferred_value, currentByKey.get(key), validToneIds);
    }
  }
}

// Human-review artifact preserves Pass 2 adjudicator outputs for unresolved fields.
const humanReview = loadJSON(path.join(PASS2_DIR, "human-review.json"), "human-review.json", false);
if (humanReview) {
  for (const item of humanReview.items ?? []) {
    if (item.field !== "tone_tags") continue;
    const key = keyOf(item.tmdb_id, item.media_type);
    if (!currentByKey.has(key)) continue;
    for (const [model, adjudication] of Object.entries(item.adjudications ?? {})) {
      const source = `pass2:${model}`;
      noteSource(key, source);
      addEvidence(evidence, key, source, adjudication.preferred_value, currentByKey.get(key), validToneIds);
    }
  }
}

const candidates = thin.map(entry => {
  const key = keyOf(entry.tmdb_id, entry.media_type);
  const tagEvidence = evidence.get(key) ?? new Map();
  const ranked = [...tagEvidence.entries()]
    .map(([tone, sources]) => ({ tone, support_count: sources.size, appeared_in: [...sources].sort() }))
    .sort((a, b) => b.support_count - a.support_count || a.tone.localeCompare(b.tone));

  // This is a HUMAN review queue, not an automatic mutation. A candidate is allowed when at least
  // one prior model/adjudicator actually proposed it. Ties are deterministic; the editor can press K.
  const best = ranked[0] ?? null;
  const proposed = best?.tone ?? null;
  const considered = sourceUniverse.get(key)?.size ?? 0;

  return {
    tmdb_id: entry.tmdb_id,
    media_type: entry.media_type,
    title: entry.title,
    current_tone_tags: entry.tone_tags.value ?? [],
    current_source: entry.tone_tags.source ?? null,
    tag_count: (entry.tone_tags.value ?? []).length,
    proposed_third_tone: proposed,
    evidence: {
      support_count: best?.support_count ?? 0,
      considered_source_count: considered,
      appeared_in: best?.appeared_in ?? [],
      ranked_candidates: ranked,
    },
  };
});

// Validation.
const errors = [];
for (const c of candidates) {
  if (!Array.isArray(c.current_tone_tags) || c.current_tone_tags.length >= 3) {
    errors.push(`${c.title}: invalid current tone count ${c.current_tone_tags?.length}`);
  }
  if (new Set(c.current_tone_tags).size !== c.current_tone_tags.length) {
    errors.push(`${c.title}: duplicate current tone tags`);
  }
  for (const tag of c.current_tone_tags) if (!validToneIds.has(tag)) errors.push(`${c.title}: invalid current tone ${tag}`);
  if (c.proposed_third_tone) {
    if (!validToneIds.has(c.proposed_third_tone)) errors.push(`${c.title}: invalid proposed tone ${c.proposed_third_tone}`);
    if (c.current_tone_tags.includes(c.proposed_third_tone)) errors.push(`${c.title}: proposed tone already present`);
    if (c.evidence.support_count < 1 || c.evidence.appeared_in.length < 1) errors.push(`${c.title}: proposed tone has no prior evidence`);
  }
}
if (errors.length) throw new Error(`Candidate validation failed:\n- ${errors.join("\n- ")}`);

const counts = {
  total_candidates: candidates.length,
  with_1_current_tone: candidates.filter(c => c.tag_count === 1).length,
  with_2_current_tones: candidates.filter(c => c.tag_count === 2).length,
  with_proposed_third_tone: candidates.filter(c => c.proposed_third_tone).length,
  with_no_prior_third_tone_evidence: candidates.filter(c => !c.proposed_third_tone).length,
};

if (!existsSync(TONE_DIR)) mkdirSync(TONE_DIR, { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify({
  ontology_version: ONTOLOGY_VERSION,
  generated_at: new Date().toISOString(),
  policy: "Prefer three tones when a genuinely descriptive third exists; candidate tones must have appeared in prior model/adjudicator evidence and are never auto-applied.",
  counts,
  candidates,
}, null, 2) + "\n");

console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
console.log(`Candidates: ${counts.total_candidates}`);
console.log(`  1 current tone: ${counts.with_1_current_tone}`);
console.log(`  2 current tones: ${counts.with_2_current_tones}`);
console.log(`  proposed third tone: ${counts.with_proposed_third_tone}`);
console.log(`  no prior third-tone evidence: ${counts.with_no_prior_third_tone_evidence}`);
