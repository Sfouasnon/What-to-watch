#!/usr/bin/env node
/**
 * compare-pass2.mjs
 *
 * Deterministic comparison of the three independent Pass 2 blind-adjudication runs
 * (ChatGPT, Claude, Gemini) against curation/pilot/pass2/adjudication-input.json, using the
 * controlled vocabulary in curation/ontology/v0.1.1/ontology.json.
 *
 * This script makes NO network calls and requires NO API keys. It only reads local JSON files
 * and writes local JSON/CSV files.
 *
 * STATUS: prepared but intentionally NOT YET RUN against real data. It expects three files that
 * do not exist yet:
 *   curation/pilot/pass2/chatgpt-pass2.json
 *   curation/pilot/pass2/claude-pass2.json
 *   curation/pilot/pass2/gemini-pass2.json
 * Produce those by following curation/pilot/pass2/README.md, then run this script from the repo
 * root:
 *
 *   node scripts/curation/compare-pass2.mjs
 *
 * It will refuse to run (with a clear error) until all three files are present.
 *
 * Optional flags (used for smoke-testing against synthetic fixtures — see
 * scripts/curation/pass2-smoke-test.mjs):
 *   --input-dir=<path>   directory to read adjudication-input.json, proposal-map.json, and the
 *                        three *-pass2.json model files from (default: curation/pilot/pass2)
 *   --out-dir=<path>     directory to write outputs to (default: same as --input-dir)
 *
 * What it does:
 *   1. Loads the controlled vocabulary from ontology.json.
 *   2. Loads adjudication-input.json — the canonical list of disputed titles/fields.
 *   3. Loads proposal-map.json — the hidden A/B/C -> source-model mapping (for provenance only;
 *      never uploaded to a model, never required for resolution logic).
 *   4. Validates each model's Pass 2 output file:
 *      - top-level shape ({ ontology_version, pass: 2, adjudications: [...] })
 *      - every adjudication has tmdb_id + media_type matching a title in adjudication-input.json
 *      - every disputed field for that title appears exactly once in "fields"
 *      - no fields are adjudicated that were not disputed for that title
 *      - preferred_value is a valid ontology id (or null, where allowed) / valid tone_tags array
 *      - human_review is boolean, severity is minor|meaningful|fundamental, reason is a string
 *   5. For every disputed field, compares the three preferred_values and applies the resolution
 *      rules (AUTO-ACCEPT / PROVISIONAL ACCEPT / HUMAN REVIEW) described in the task spec.
 *   6. Writes pass2-summary.json, auto-accepted.json, provisional-accepted.json,
 *      human-review.json, human-review.csv, and proposed-final-classifications.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const ONTOLOGY_VERSION = "0.1.1";
const ONTOLOGY_PATH = path.join(ROOT, `curation/ontology/v${ONTOLOGY_VERSION}/ontology.json`);
const PASS1_DIR = path.join(ROOT, "curation/pilot/pass1");
const DEFAULT_PASS2_DIR = path.join(ROOT, "curation/pilot/pass2");

const MODELS = ["chatgpt", "claude", "gemini"];
const VALID_SEVERITY = new Set(["minor", "meaningful", "fundamental"]);
const VALID_FIELDS = new Set(["primary_subgenre", "secondary_subgenre", "tone_tags"]);
const VALID_PACING = new Set(["slow", "moderate", "fast"]);

function parseArgs(argv) {
  const args = { inputDir: DEFAULT_PASS2_DIR, outDir: null };
  for (const a of argv.slice(2)) {
    const m1 = a.match(/^--input-dir=(.+)$/);
    const m2 = a.match(/^--out-dir=(.+)$/);
    if (m1) args.inputDir = path.resolve(m1[1]);
    if (m2) args.outDir = path.resolve(m2[1]);
  }
  if (!args.outDir) args.outDir = args.inputDir;
  return args;
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
  const subgenreIds = new Set();
  for (const family of ontology.subgenre_families ?? []) {
    for (const term of family.terms ?? []) subgenreIds.add(term.id);
  }
  const toneIds = new Set((ontology.tone_tags ?? []).map(t => t.id));
  return { subgenreIds, toneIds };
}

function sortedTuple(arr) {
  return [...new Set(arr ?? [])].sort().join("|");
}

function valuesEqual(field, a, b) {
  if (field === "tone_tags") return sortedTuple(a) === sortedTuple(b);
  return a === b; // primary_subgenre / secondary_subgenre: string or null
}

/** Validates one model's Pass 2 output file against the dispute list. Returns { errors, byKey }. */
function validatePass2File(modelName, data, vocab, disputesByKey) {
  const errors = [];
  const byKey = new Map(); // key -> Map(field -> {preferred_value, human_review, severity, reason})

  if (typeof data !== "object" || data === null) {
    errors.push(`${modelName}: top-level value is not a JSON object`);
    return { errors, byKey };
  }
  if (data.ontology_version !== ONTOLOGY_VERSION) {
    errors.push(`${modelName}: ontology_version is "${data.ontology_version}", expected "${ONTOLOGY_VERSION}"`);
  }
  if (data.pass !== 2) {
    errors.push(`${modelName}: pass is ${JSON.stringify(data.pass)}, expected 2`);
  }
  if (!Array.isArray(data.adjudications)) {
    errors.push(`${modelName}: "adjudications" is not an array`);
    return { errors, byKey };
  }

  const seenKeys = new Set();
  for (const [i, entry] of data.adjudications.entries()) {
    const where = `${modelName}.adjudications[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${where}: entry is not an object`);
      continue;
    }
    const { tmdb_id, media_type, fields } = entry;
    if (typeof tmdb_id !== "number") errors.push(`${where}: tmdb_id must be a number`);
    if (media_type !== "movie" && media_type !== "tv") {
      errors.push(`${where}: media_type must be "movie" or "tv"`);
      continue;
    }
    const key = keyOf(entry);
    const expectedFields = disputesByKey.get(key);
    if (!expectedFields) {
      errors.push(`${where}: title ${key} has no disputes in adjudication-input.json (unexpected title)`);
      continue;
    }
    if (seenKeys.has(key)) {
      errors.push(`${where}: duplicate adjudication for ${key}`);
      continue;
    }
    seenKeys.add(key);

    if (!Array.isArray(fields)) {
      errors.push(`${where}: "fields" is not an array`);
      continue;
    }
    const fieldMap = new Map();
    for (const [j, f] of fields.entries()) {
      const fwhere = `${where}.fields[${j}]`;
      if (typeof f !== "object" || f === null) {
        errors.push(`${fwhere}: entry is not an object`);
        continue;
      }
      const { field, preferred_value, human_review, severity, reason } = f;
      if (!VALID_FIELDS.has(field)) {
        errors.push(`${fwhere}: unknown field "${field}"`);
        continue;
      }
      if (!expectedFields.has(field)) {
        errors.push(`${fwhere}: field "${field}" was not disputed for ${key} (unexpected adjudication)`);
        continue;
      }
      if (fieldMap.has(field)) {
        errors.push(`${fwhere}: duplicate adjudication for field "${field}" on ${key}`);
        continue;
      }
      if (typeof human_review !== "boolean") {
        errors.push(`${fwhere}: human_review must be a boolean`);
      }
      if (!VALID_SEVERITY.has(severity)) {
        errors.push(`${fwhere}: severity "${severity}" must be one of ${[...VALID_SEVERITY].join(", ")}`);
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        errors.push(`${fwhere}: reason must be a non-empty string`);
      }

      let valueValid = true;
      if (field === "primary_subgenre") {
        if (preferred_value !== null && !vocab.subgenreIds.has(preferred_value)) {
          errors.push(`${fwhere}: primary_subgenre preferred_value "${preferred_value}" is not a controlled vocabulary id`);
          valueValid = false;
        }
      } else if (field === "secondary_subgenre") {
        if (preferred_value !== null && !vocab.subgenreIds.has(preferred_value)) {
          errors.push(`${fwhere}: secondary_subgenre preferred_value "${preferred_value}" is not a controlled vocabulary id`);
          valueValid = false;
        }
      } else if (field === "tone_tags") {
        if (!Array.isArray(preferred_value)) {
          errors.push(`${fwhere}: tone_tags preferred_value must be an array`);
          valueValid = false;
        } else {
          if (preferred_value.length > 3) {
            errors.push(`${fwhere}: tone_tags preferred_value has ${preferred_value.length} entries, max is 3`);
            valueValid = false;
          }
          const seen = new Set();
          for (const t of preferred_value) {
            if (!vocab.toneIds.has(t)) {
              errors.push(`${fwhere}: tone tag "${t}" is not a controlled vocabulary id`);
              valueValid = false;
            }
            if (seen.has(t)) {
              errors.push(`${fwhere}: tone tag "${t}" is duplicated`);
              valueValid = false;
            }
            seen.add(t);
          }
        }
      }

      fieldMap.set(field, {
        preferred_value,
        human_review: typeof human_review === "boolean" ? human_review : null,
        severity: VALID_SEVERITY.has(severity) ? severity : null,
        reason: typeof reason === "string" ? reason : null,
        valid: valueValid,
      });
    }

    for (const expected of expectedFields) {
      if (!fieldMap.has(expected)) {
        errors.push(`${where}: missing adjudication for disputed field "${expected}" on ${key}`);
      }
    }

    byKey.set(key, fieldMap);
  }

  for (const key of disputesByKey.keys()) {
    if (!seenKeys.has(key)) {
      errors.push(`${modelName}: missing adjudication for disputed title ${key}`);
    }
  }

  return { errors, byKey };
}

function main() {
  const args = parseArgs(process.argv);
  const INPUT_PATH = path.join(args.inputDir, "adjudication-input.json");
  const PROPOSAL_MAP_PATH = path.join(args.inputDir, "proposal-map.json");
  const MODEL_FILES = Object.fromEntries(MODELS.map(m => [m, path.join(args.inputDir, `${m}-pass2.json`)]));

  const ontology = loadJSON(ONTOLOGY_PATH, "ontology.json");
  const vocab = buildVocab(ontology);

  const adjudicationInput = loadJSON(INPUT_PATH, "adjudication-input.json");
  const proposalMap = existsSync(PROPOSAL_MAP_PATH) ? loadJSON(PROPOSAL_MAP_PATH, "proposal-map.json") : null;
  const mappingByKey = new Map(
    (proposalMap?.entries ?? []).map(e => [keyOf(e), e.mapping])
  );

  const disputesByKey = new Map(); // key -> Set(field)
  const titleMetaByKey = new Map(); // key -> {tmdb_id, media_type, title}
  const disputeDetailByKey = new Map(); // key -> Map(field -> {proposal_a, proposal_b, proposal_c})
  for (const t of adjudicationInput.titles ?? []) {
    const key = keyOf(t);
    titleMetaByKey.set(key, { tmdb_id: t.tmdb_id, media_type: t.media_type, title: t.title });
    disputesByKey.set(key, new Set(t.disputes.map(d => d.field)));
    disputeDetailByKey.set(key, new Map(t.disputes.map(d => [d.field, d])));
  }

  for (const model of MODELS) {
    if (!existsSync(MODEL_FILES[model])) {
      throw new Error(
        `Missing ${path.basename(MODEL_FILES[model])} in ${args.inputDir}. Follow ` +
        `curation/pilot/pass2/README.md to produce chatgpt-pass2.json, claude-pass2.json, and ` +
        `gemini-pass2.json before running this script.`
      );
    }
  }

  const modelData = {};
  const validation = {};
  for (const model of MODELS) {
    const data = loadJSON(MODEL_FILES[model], `${model}-pass2.json`);
    modelData[model] = data;
    validation[model] = validatePass2File(model, data, vocab, disputesByKey);
  }

  const totalErrors = MODELS.reduce((s, m) => s + validation[m].errors.length, 0);

  // Resolve every disputed field.
  const resolvedFields = []; // flat list, one per (title, field)
  for (const [key, fields] of disputesByKey) {
    const meta = titleMetaByKey.get(key);
    const details = disputeDetailByKey.get(key);
    const mapping = mappingByKey.get(key) ?? null;

    for (const field of fields) {
      const perModel = MODELS.map(m => {
        const fm = validation[m].byKey.get(key);
        return fm ? fm.get(field) : undefined;
      });

      const anyMissingOrInvalid = perModel.some(p => !p || p.valid === false || p.preferred_value === undefined);

      let resolution, resolvedValue = null, consensusType;
      const humanReviewCount = perModel.filter(p => p && p.human_review === true).length;

      if (anyMissingOrInvalid) {
        resolution = "HUMAN_REVIEW";
        consensusType = "invalid";
      } else {
        const [a, b, c] = perModel.map(p => p.preferred_value);
        const abEqual = valuesEqual(field, a, b);
        const bcEqual = valuesEqual(field, b, c);
        const acEqual = valuesEqual(field, a, c);
        const unanimous = abEqual && bcEqual;
        const twoOfThree = abEqual || bcEqual || acEqual;

        if (unanimous) {
          consensusType = "unanimous";
          resolvedValue = a;
          resolution = humanReviewCount <= 1 ? "AUTO_ACCEPT" : "HUMAN_REVIEW";
        } else if (twoOfThree) {
          consensusType = "two_of_three";
          resolvedValue = abEqual ? a : bcEqual ? b : a; // the value shared by the matching pair
          resolution = humanReviewCount < 2 ? "PROVISIONAL_ACCEPT" : "HUMAN_REVIEW";
        } else {
          consensusType = "none";
          resolution = "HUMAN_REVIEW";
        }

        // Safety net matching the spec's explicit primary_subgenre clause: primary_subgenre may
        // only leave this function as AUTO_ACCEPT/PROVISIONAL_ACCEPT under the exact criteria
        // above; anything else (should already be impossible given the branches, but enforced
        // defensively) is HUMAN_REVIEW rather than silently resolved.
        if (field === "primary_subgenre" && resolution !== "AUTO_ACCEPT" && resolution !== "PROVISIONAL_ACCEPT") {
          resolution = "HUMAN_REVIEW";
        }
      }

      const severityDistribution = { minor: 0, meaningful: 0, fundamental: 0 };
      for (const p of perModel) {
        if (p && p.severity) severityDistribution[p.severity] += 1;
      }

      resolvedFields.push({
        tmdb_id: meta.tmdb_id,
        media_type: meta.media_type,
        title: meta.title,
        field,
        resolution,
        consensus_type: consensusType,
        resolved_value: resolution === "AUTO_ACCEPT" || resolution === "PROVISIONAL_ACCEPT" ? resolvedValue : null,
        human_review_requests: humanReviewCount,
        severity_distribution: severityDistribution,
        proposals: {
          // Pass 1 anonymized proposals shown to reviewers, for reference.
          proposal_a: details.get(field)?.proposal_a ?? null,
          proposal_b: details.get(field)?.proposal_b ?? null,
          proposal_c: details.get(field)?.proposal_c ?? null,
        },
        adjudications: Object.fromEntries(
          MODELS.map((m, i) => [m, perModel[i] ? {
            preferred_value: perModel[i].preferred_value,
            human_review: perModel[i].human_review,
            severity: perModel[i].severity,
            reason: perModel[i].reason,
          } : null])
        ),
        source_mapping: mapping, // A/B/C -> Pass 1 model, for traceability (not shown to reviewers)
      });
    }
  }

  const autoAccepted = resolvedFields.filter(f => f.resolution === "AUTO_ACCEPT");
  const provisionalAccepted = resolvedFields.filter(f => f.resolution === "PROVISIONAL_ACCEPT");
  const humanReview = resolvedFields.filter(f => f.resolution === "HUMAN_REVIEW");

  const fieldBreakdown = {};
  for (const f of resolvedFields) {
    fieldBreakdown[f.field] = fieldBreakdown[f.field] ?? { AUTO_ACCEPT: 0, PROVISIONAL_ACCEPT: 0, HUMAN_REVIEW: 0 };
    fieldBreakdown[f.field][f.resolution] += 1;
  }

  const summary = {
    ontology_version: ONTOLOGY_VERSION,
    pass: 2,
    generated_at: new Date().toISOString(),
    input_dir: path.relative(ROOT, args.inputDir) || ".",
    disputed_title_count: disputesByKey.size,
    disputed_field_count: resolvedFields.length,
    validation: Object.fromEntries(
      MODELS.map(m => [m, { error_count: validation[m].errors.length, errors: validation[m].errors }])
    ),
    resolution_counts: {
      AUTO_ACCEPT: autoAccepted.length,
      PROVISIONAL_ACCEPT: provisionalAccepted.length,
      HUMAN_REVIEW: humanReview.length,
    },
    field_breakdown: fieldBreakdown,
    ready: totalErrors === 0,
  };

  if (!existsSync(args.outDir)) mkdirSync(args.outDir, { recursive: true });

  writeFileSync(path.join(args.outDir, "pass2-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(path.join(args.outDir, "auto-accepted.json"), JSON.stringify({ ontology_version: ONTOLOGY_VERSION, items: autoAccepted }, null, 2) + "\n");
  writeFileSync(path.join(args.outDir, "provisional-accepted.json"), JSON.stringify({ ontology_version: ONTOLOGY_VERSION, items: provisionalAccepted }, null, 2) + "\n");
  writeFileSync(path.join(args.outDir, "human-review.json"), JSON.stringify({ ontology_version: ONTOLOGY_VERSION, items: humanReview }, null, 2) + "\n");

  const csvHeader = ["tmdb_id", "media_type", "title", "field", "resolution", "consensus_type",
    "resolved_value", "human_review_requests", "chatgpt_value", "claude_value", "gemini_value",
    "chatgpt_severity", "claude_severity", "gemini_severity", "proposal_a", "proposal_b", "proposal_c"];
  const csvEscape = v => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("|") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvLines = [csvHeader.join(",")];
  for (const f of humanReview) {
    csvLines.push([
      f.tmdb_id, f.media_type, f.title, f.field, f.resolution, f.consensus_type,
      f.resolved_value, f.human_review_requests,
      f.adjudications.chatgpt?.preferred_value, f.adjudications.claude?.preferred_value, f.adjudications.gemini?.preferred_value,
      f.adjudications.chatgpt?.severity, f.adjudications.claude?.severity, f.adjudications.gemini?.severity,
      f.proposals.proposal_a, f.proposals.proposal_b, f.proposals.proposal_c,
    ].map(csvEscape).join(","));
  }
  writeFileSync(path.join(args.outDir, "human-review.csv"), csvLines.join("\n") + "\n");

  // ---- proposed-final-classifications.json ----
  // Combines: (a) Pass 1 fields that were never disputed (full agreement, or majority for
  // pacing/secondary per policy), (b) Pass 2 AUTO_ACCEPT / PROVISIONAL_ACCEPT resolutions, and
  // (c) explicit unresolved markers for anything left in HUMAN_REVIEW. Never overwrites Pass 1
  // files; this is a new, separate artifact.
  const pass1Input = loadJSON(path.join(PASS1_DIR, "classification-input.json"), "classification-input.json");
  const pass1ModelFiles = {
    chatgpt: findCaseInsensitive(PASS1_DIR, ["chatgpt.json", "ChatGPT.json"]),
    claude: findCaseInsensitive(PASS1_DIR, ["claude.json", "Claude.json"]),
    gemini: findCaseInsensitive(PASS1_DIR, ["gemini.json", "Gemini.json"]),
  };
  const pass1ByKey = {};
  for (const m of MODELS) {
    const data = loadJSON(pass1ModelFiles[m], `${m} pass1 output`);
    pass1ByKey[m] = new Map((data.classifications ?? []).map(e => [keyOf(e), e]));
  }

  function threeWayAgreement(values) {
    const [a, b, c] = values;
    if (a === b && b === c) return "full";
    if (a === b || b === c || a === c) return "majority";
    return "none";
  }
  function majorityOf(values) {
    const [a, b, c] = values;
    if (a === b) return a;
    if (b === c) return b;
    if (a === c) return a;
    return null;
  }

  const resolvedByKeyField = new Map(); // key -> field -> resolvedField entry
  for (const f of resolvedFields) {
    const k = keyOf(f);
    if (!resolvedByKeyField.has(k)) resolvedByKeyField.set(k, new Map());
    resolvedByKeyField.get(k).set(f.field, f);
  }

  const finalClassifications = [];
  let pendingCount = 0;
  for (const meta of pass1Input.titles ?? []) {
    const key = keyOf(meta);
    const chatgpt = pass1ByKey.chatgpt.get(key);
    const claude = pass1ByKey.claude.get(key);
    const gemini = pass1ByKey.gemini.get(key);
    const perTitleResolved = resolvedByKeyField.get(key) ?? new Map();

    function resolveField(fieldName, pass1Values) {
      const disputed = perTitleResolved.get(fieldName);
      if (disputed) {
        if (disputed.resolution === "AUTO_ACCEPT" || disputed.resolution === "PROVISIONAL_ACCEPT") {
          return { value: disputed.resolved_value, source: `pass2-${disputed.resolution.toLowerCase()}`, human_review_pending: false };
        }
        pendingCount += 1;
        return { value: null, source: "pass2-human-review-pending", human_review_pending: true };
      }
      const agreement = threeWayAgreement(pass1Values);
      if (agreement === "full") return { value: pass1Values[0], source: "pass1-full", human_review_pending: false };
      // majority, not escalated to pass2 (secondary_subgenre only, per policy)
      return { value: majorityOf(pass1Values), source: "pass1-majority", human_review_pending: false };
    }

    function resolveTone() {
      const disputed = perTitleResolved.get("tone_tags");
      if (disputed) {
        if (disputed.resolution === "AUTO_ACCEPT" || disputed.resolution === "PROVISIONAL_ACCEPT") {
          return { value: disputed.resolved_value, source: `pass2-${disputed.resolution.toLowerCase()}`, human_review_pending: false };
        }
        pendingCount += 1;
        return { value: null, source: "pass2-human-review-pending", human_review_pending: true };
      }
      // Not disputed: accept individual tags with >=2/3 support (policy section 10).
      const counts = new Map();
      for (const list of [chatgpt.tone_tags, claude.tone_tags, gemini.tone_tags]) {
        for (const tag of new Set(list ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      const supported = [...counts.entries()].filter(([, c]) => c >= 2).map(([t]) => t).slice(0, 3);
      return { value: supported, source: "pass1-majority-tags", human_review_pending: false };
    }

    function resolvePacing() {
      const values = [chatgpt.pacing, claude.pacing, gemini.pacing];
      const agreement = threeWayAgreement(values);
      return {
        value: agreement === "full" ? values[0] : majorityOf(values),
        source: agreement === "full" ? "pass1-full" : "pass1-majority",
        human_review_pending: false,
      };
    }

    finalClassifications.push({
      tmdb_id: meta.tmdb_id,
      media_type: meta.media_type,
      title: meta.title,
      primary_subgenre: resolveField("primary_subgenre", [chatgpt.primary_subgenre, claude.primary_subgenre, gemini.primary_subgenre]),
      secondary_subgenre: resolveField("secondary_subgenre", [chatgpt.secondary_subgenre, claude.secondary_subgenre, gemini.secondary_subgenre]),
      tone_tags: resolveTone(),
      pacing: resolvePacing(),
    });
  }

  writeFileSync(
    path.join(args.outDir, "proposed-final-classifications.json"),
    JSON.stringify({
      ontology_version: ONTOLOGY_VERSION,
      generated_at: new Date().toISOString(),
      title_count: finalClassifications.length,
      pending_human_review_field_count: pendingCount,
      classifications: finalClassifications,
    }, null, 2) + "\n"
  );

  console.log(`Disputed fields: ${resolvedFields.length} across ${disputesByKey.size} titles.`);
  console.log(`AUTO_ACCEPT: ${autoAccepted.length}, PROVISIONAL_ACCEPT: ${provisionalAccepted.length}, HUMAN_REVIEW: ${humanReview.length}`);
  console.log(`Validation errors: ${totalErrors}`);
  console.log(`Pending human-review fields in proposed-final-classifications.json: ${pendingCount}`);
  console.log(`Wrote outputs to ${path.relative(ROOT, args.outDir) || "."}`);
}

function findCaseInsensitive(dir, candidates) {
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (existsSync(p)) return p;
  }
  throw new Error(`None of ${candidates.join(", ")} found in ${dir}`);
}

main();
