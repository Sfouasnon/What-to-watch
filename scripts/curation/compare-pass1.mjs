#!/usr/bin/env node
/**
 * compare-pass1.mjs
 *
 * Deterministic comparison of the three independent Pass 1 manual classification
 * runs (ChatGPT, Claude, Gemini) against the same 100-title input packet, using
 * the controlled vocabulary in curation/ontology/v0.1.1/ontology.json.
 *
 * This script makes NO network calls and requires NO API keys. It only reads
 * local JSON files and writes local JSON/CSV files.
 *
 * STATUS: prepared but intentionally NOT YET RUN. It expects three files that
 * do not exist yet:
 *   curation/pilot/pass1/chatgpt.json
 *   curation/pilot/pass1/claude.json
 *   curation/pilot/pass1/gemini.json
 * Produce those by following curation/pilot/pass1/README.md, then run this
 * script from the repo root:
 *
 *   node scripts/curation/compare-pass1.mjs
 *
 * It will refuse to run (with a clear error) until all three files are present.
 *
 * What it does:
 *   1. Loads the controlled vocabulary from ontology.json.
 *   2. Loads the canonical title list from classification-input.json.
 *   3. Validates each model's output file against the same schema:
 *      - top-level shape ({ ontology_version, classifications: [...] })
 *      - every classification has the required fields with correct types
 *      - primary_subgenre / secondary_subgenre are valid ontology ids or null
 *      - secondary_subgenre !== primary_subgenre
 *      - tone_tags has 0-3 entries, all valid ontology ids, no duplicates
 *      - pacing is slow | moderate | fast | null
 *   4. Identifies missing titles (in the input but absent from a model's output),
 *      duplicate titles (same tmdb_id+media_type classified more than once by a
 *      model), and unexpected titles (present in a model's output but not in the
 *      input).
 *   5. For every title classified by all three models, compares primary_subgenre,
 *      secondary_subgenre, pacing (exact match / majority / no agreement) and
 *      tone_tags (pairwise Jaccard overlap), then assigns an agreement severity.
 *   6. Writes:
 *      curation/pilot/pass1/agreement-summary.json — aggregate stats
 *      curation/pilot/pass1/disagreements.json     — per-title disagreement detail
 *      curation/pilot/pass1/human-review.csv        — flat side-by-side export
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const ONTOLOGY_VERSION = "0.1.1";
const ONTOLOGY_PATH = path.join(ROOT, `curation/ontology/v${ONTOLOGY_VERSION}/ontology.json`);
const INPUT_PATH = path.join(ROOT, "curation/pilot/pass1/classification-input.json");
const PASS1_DIR = path.join(ROOT, "curation/pilot/pass1");

const MODELS = ["chatgpt", "claude", "gemini"];
const MODEL_FILES = Object.fromEntries(
  MODELS.map(m => [m, path.join(PASS1_DIR, `${m}.json`)])
);

const OUT_SUMMARY = path.join(PASS1_DIR, "agreement-summary.json");
const OUT_DISAGREEMENTS = path.join(PASS1_DIR, "disagreements.json");
const OUT_CSV = path.join(PASS1_DIR, "human-review.csv");

const VALID_PACING = new Set(["slow", "moderate", "fast"]);

function loadJSON(p, label) {
  if (!existsSync(p)) {
    throw new Error(`Missing required file (${label}): ${p}`);
  }
  const raw = readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} (${p}): ${err.message}`);
  }
}

function buildVocab(ontology) {
  const subgenreIds = new Set();
  for (const family of ontology.subgenre_families ?? []) {
    for (const term of family.terms ?? []) {
      subgenreIds.add(term.id);
    }
  }
  const toneIds = new Set((ontology.tone_tags ?? []).map(t => t.id));
  return { subgenreIds, toneIds };
}

function keyOf(entry) {
  return `${entry.tmdb_id}:${entry.media_type}`;
}

/**
 * Validates one model's classification file. Returns:
 *   { errors: string[], byKey: Map<key, classification>, duplicateKeys: string[] }
 * On a duplicate key, the FIRST occurrence is kept in byKey and every
 * subsequent occurrence is recorded in duplicateKeys (and as an error).
 */
function validateModelFile(modelName, data, vocab, inputKeys) {
  const errors = [];
  const byKey = new Map();
  const duplicateKeys = [];

  if (typeof data !== "object" || data === null) {
    errors.push(`${modelName}: top-level value is not a JSON object`);
    return { errors, byKey, duplicateKeys };
  }
  if (data.ontology_version !== ONTOLOGY_VERSION) {
    errors.push(
      `${modelName}: ontology_version is "${data.ontology_version}", expected "${ONTOLOGY_VERSION}"`
    );
  }
  if (!Array.isArray(data.classifications)) {
    errors.push(`${modelName}: "classifications" is not an array`);
    return { errors, byKey, duplicateKeys };
  }

  data.classifications.forEach((entry, i) => {
    const where = `${modelName}[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${where}: entry is not an object`);
      return;
    }
    const { tmdb_id, media_type, primary_subgenre, secondary_subgenre, tone_tags, pacing } = entry;

    if (typeof tmdb_id !== "number") {
      errors.push(`${where}: tmdb_id must be a number`);
    }
    if (media_type !== "movie" && media_type !== "tv") {
      errors.push(`${where}: media_type must be "movie" or "tv", got ${JSON.stringify(media_type)}`);
    }
    if (primary_subgenre !== null && !vocab.subgenreIds.has(primary_subgenre)) {
      errors.push(`${where}: primary_subgenre "${primary_subgenre}" is not a controlled vocabulary id`);
    }
    if (secondary_subgenre !== null && !vocab.subgenreIds.has(secondary_subgenre)) {
      errors.push(`${where}: secondary_subgenre "${secondary_subgenre}" is not a controlled vocabulary id`);
    }
    if (secondary_subgenre !== null && secondary_subgenre === primary_subgenre) {
      errors.push(`${where}: secondary_subgenre must differ from primary_subgenre`);
    }
    if (!Array.isArray(tone_tags)) {
      errors.push(`${where}: tone_tags must be an array`);
    } else {
      if (tone_tags.length > 3) {
        errors.push(`${where}: tone_tags has ${tone_tags.length} entries, max is 3`);
      }
      const seen = new Set();
      for (const tag of tone_tags) {
        if (!vocab.toneIds.has(tag)) {
          errors.push(`${where}: tone_tag "${tag}" is not a controlled vocabulary id`);
        }
        if (seen.has(tag)) {
          errors.push(`${where}: tone_tag "${tag}" is duplicated within the same title`);
        }
        seen.add(tag);
      }
    }
    if (pacing !== null && !VALID_PACING.has(pacing)) {
      errors.push(`${where}: pacing "${pacing}" must be slow, moderate, fast, or null`);
    }

    if (typeof tmdb_id === "number" && (media_type === "movie" || media_type === "tv")) {
      const key = keyOf(entry);
      if (!inputKeys.has(key)) {
        errors.push(`${where}: title ${key} is not in classification-input.json (unexpected title)`);
      }
      if (byKey.has(key)) {
        duplicateKeys.push(key);
        errors.push(`${where}: duplicate classification for ${key} (first occurrence kept)`);
      } else {
        byKey.set(key, entry);
      }
    }
  });

  return { errors, byKey, duplicateKeys };
}

function jaccard(a, b) {
  const setA = new Set(a ?? []);
  const setB = new Set(b ?? []);
  if (setA.size === 0 && setB.size === 0) return 1; // both empty: trivially in full agreement
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

function threeWayAgreement(values) {
  // values: array of 3 comparable values (primitives, or null)
  const [a, b, c] = values;
  if (a === b && b === c) return "full";
  if (a === b || b === c || a === c) return "majority";
  return "none";
}

/**
 * Severity policy (documented here since this is a judgment call, not a fact):
 *   - "major":    primary_subgenre has no agreement at all across the 3 models
 *   - "moderate": primary_subgenre has 2-of-3 agreement, OR primary_subgenre is in
 *                 full agreement but 2+ of {secondary, pacing, tone} diverge meaningfully
 *   - "low":      primary_subgenre is in full agreement and exactly 1 of
 *                 {secondary, pacing, tone} diverges meaningfully
 *   - "none":     primary_subgenre is in full agreement and secondary/pacing/tone
 *                 are all in full (or near-full, tone Jaccard >= 0.5) agreement
 */
function assignSeverity({ primaryAgreement, secondaryAgreement, pacingAgreement, avgToneJaccard }) {
  if (primaryAgreement === "none") return "major";
  if (primaryAgreement === "majority") return "moderate";

  let divergences = 0;
  if (secondaryAgreement !== "full") divergences += 1;
  if (pacingAgreement !== "full") divergences += 1;
  if (avgToneJaccard < 0.5) divergences += 1;

  if (divergences === 0) return "none";
  if (divergences === 1) return "low";
  return "moderate";
}

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function main() {
  const ontology = loadJSON(ONTOLOGY_PATH, "ontology.json");
  const vocab = buildVocab(ontology);

  const input = loadJSON(INPUT_PATH, "classification-input.json");
  const inputTitles = input.titles ?? [];
  const inputKeys = new Set(inputTitles.map(keyOf));
  const titleMeta = new Map(inputTitles.map(t => [keyOf(t), t]));

  for (const model of MODELS) {
    if (!existsSync(MODEL_FILES[model])) {
      throw new Error(
        `Missing ${model}.json in curation/pilot/pass1/. Follow curation/pilot/pass1/README.md ` +
        `to produce chatgpt.json, claude.json, and gemini.json before running this script.`
      );
    }
  }

  const modelData = {};
  const validation = {};
  for (const model of MODELS) {
    const data = loadJSON(MODEL_FILES[model], `${model}.json`);
    modelData[model] = data;
    validation[model] = validateModelFile(model, data, vocab, inputKeys);
  }

  const missing = {};
  const duplicates = {};
  const unexpectedCount = {};
  for (const model of MODELS) {
    const byKey = validation[model].byKey;
    missing[model] = [...inputKeys].filter(k => !byKey.has(k));
    duplicates[model] = validation[model].duplicateKeys;
    unexpectedCount[model] = [...byKey.keys()].filter(k => !inputKeys.has(k)).length;
  }

  // Titles classified by all three models — the comparable set.
  const comparableKeys = [...inputKeys].filter(k =>
    MODELS.every(m => validation[m].byKey.has(k))
  );

  const disagreements = [];
  const rows = [];
  const tally = {
    none: 0, low: 0, moderate: 0, major: 0,
    primaryFull: 0, primaryMajority: 0, primaryNone: 0,
    secondaryFull: 0, secondaryMajority: 0, secondaryNone: 0,
    pacingFull: 0, pacingMajority: 0, pacingNone: 0,
  };
  let toneJaccardSum = 0;

  for (const key of comparableKeys) {
    const meta = titleMeta.get(key);
    const c = MODELS.map(m => validation[m].byKey.get(key));
    const [chatgpt, claude, gemini] = c;

    const primaryAgreement = threeWayAgreement(c.map(x => x.primary_subgenre));
    const secondaryAgreement = threeWayAgreement(c.map(x => x.secondary_subgenre));
    const pacingAgreement = threeWayAgreement(c.map(x => x.pacing));

    const pairs = [
      [chatgpt.tone_tags, claude.tone_tags],
      [chatgpt.tone_tags, gemini.tone_tags],
      [claude.tone_tags, gemini.tone_tags],
    ];
    const avgToneJaccard = pairs.reduce((sum, [a, b]) => sum + jaccard(a, b), 0) / pairs.length;
    toneJaccardSum += avgToneJaccard;

    tally[`primary${cap(primaryAgreement)}`] += 1;
    tally[`secondary${cap(secondaryAgreement)}`] += 1;
    tally[`pacing${cap(pacingAgreement)}`] += 1;

    const severity = assignSeverity({ primaryAgreement, secondaryAgreement, pacingAgreement, avgToneJaccard });
    tally[severity] += 1;

    if (severity !== "none") {
      disagreements.push({
        tmdb_id: meta.tmdb_id,
        media_type: meta.media_type,
        title: meta.title,
        severity,
        primary_subgenre: { chatgpt: chatgpt.primary_subgenre, claude: claude.primary_subgenre, gemini: gemini.primary_subgenre, agreement: primaryAgreement },
        secondary_subgenre: { chatgpt: chatgpt.secondary_subgenre, claude: claude.secondary_subgenre, gemini: gemini.secondary_subgenre, agreement: secondaryAgreement },
        pacing: { chatgpt: chatgpt.pacing, claude: claude.pacing, gemini: gemini.pacing, agreement: pacingAgreement },
        tone_tags: { chatgpt: chatgpt.tone_tags, claude: claude.tone_tags, gemini: gemini.tone_tags, avg_pairwise_jaccard: round3(avgToneJaccard) },
      });
    }

    rows.push({
      tmdb_id: meta.tmdb_id,
      media_type: meta.media_type,
      title: meta.title,
      severity,
      chatgpt_primary: chatgpt.primary_subgenre,
      claude_primary: claude.primary_subgenre,
      gemini_primary: gemini.primary_subgenre,
      primary_agreement: primaryAgreement,
      chatgpt_secondary: chatgpt.secondary_subgenre,
      claude_secondary: claude.secondary_subgenre,
      gemini_secondary: gemini.secondary_subgenre,
      secondary_agreement: secondaryAgreement,
      chatgpt_tone_tags: (chatgpt.tone_tags ?? []).join("|"),
      claude_tone_tags: (claude.tone_tags ?? []).join("|"),
      gemini_tone_tags: (gemini.tone_tags ?? []).join("|"),
      avg_tone_jaccard: round3(avgToneJaccard),
      chatgpt_pacing: chatgpt.pacing,
      claude_pacing: claude.pacing,
      gemini_pacing: gemini.pacing,
      pacing_agreement: pacingAgreement,
    });
  }

  const totalErrors = MODELS.reduce((sum, m) => sum + validation[m].errors.length, 0);

  const summary = {
    ontology_version: ONTOLOGY_VERSION,
    generated_at: new Date().toISOString(),
    input_title_count: inputTitles.length,
    comparable_title_count: comparableKeys.length,
    validation: Object.fromEntries(
      MODELS.map(m => [m, {
        error_count: validation[m].errors.length,
        errors: validation[m].errors,
        classified_count: validation[m].byKey.size,
        missing_titles: missing[m],
        duplicate_titles: duplicates[m],
        unexpected_title_count: unexpectedCount[m],
      }])
    ),
    agreement: {
      severity_counts: { none: tally.none, low: tally.low, moderate: tally.moderate, major: tally.major },
      primary_subgenre: { full: tally.primaryFull, majority: tally.primaryMajority, none: tally.primaryNone },
      secondary_subgenre: { full: tally.secondaryFull, majority: tally.secondaryMajority, none: tally.secondaryNone },
      pacing: { full: tally.pacingFull, majority: tally.pacingMajority, none: tally.pacingNone },
      avg_tone_jaccard: comparableKeys.length ? round3(toneJaccardSum / comparableKeys.length) : null,
    },
    ready_for_review: totalErrors === 0,
  };

  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(OUT_DISAGREEMENTS, JSON.stringify({ ontology_version: ONTOLOGY_VERSION, disagreements }, null, 2) + "\n");

  const csvHeader = Object.keys(rows[0] ?? {
    tmdb_id: "", media_type: "", title: "", severity: "",
    chatgpt_primary: "", claude_primary: "", gemini_primary: "", primary_agreement: "",
    chatgpt_secondary: "", claude_secondary: "", gemini_secondary: "", secondary_agreement: "",
    chatgpt_tone_tags: "", claude_tone_tags: "", gemini_tone_tags: "", avg_tone_jaccard: "",
    chatgpt_pacing: "", claude_pacing: "", gemini_pacing: "", pacing_agreement: "",
  });
  const csvLines = [csvHeader.join(",")];
  for (const row of rows) {
    csvLines.push(csvHeader.map(h => csvEscape(row[h])).join(","));
  }
  writeFileSync(OUT_CSV, csvLines.join("\n") + "\n");

  console.log(`Compared ${comparableKeys.length}/${inputTitles.length} titles across ${MODELS.join(", ")}.`);
  console.log(`Validation errors: ${totalErrors}`);
  console.log(`Wrote: ${path.relative(ROOT, OUT_SUMMARY)}, ${path.relative(ROOT, OUT_DISAGREEMENTS)}, ${path.relative(ROOT, OUT_CSV)}`);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

main();
