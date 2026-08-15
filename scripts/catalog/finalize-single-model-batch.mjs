import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateClassificationResponse } from "./lib/classification-reconciliation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const responseKeys = ["model", "run_id", "batch_number", "ontology_version", "classifications"];
const classificationKeys = [
  "tmdb_id",
  "media_type",
  "primary_subgenre",
  "secondary_subgenre",
  "tone_tags",
  "pacing",
  "confidence",
  "rationale",
];

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function packetArtifact(packetRoot, artifact) {
  const target = path.resolve(packetRoot, artifact);
  const relative = path.relative(packetRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact must be inside the classification packet: ${artifact}`);
  }
  return target;
}

function identity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function unique(values) {
  return [...new Set(values)];
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function distribution(values) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map())].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))),
  );
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys must be [${wanted.join(", ")}], received [${actual.join(", ")}].`);
  }
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(target, value, { overwrite = false } = {}) {
  if (!overwrite && await exists(target)) throw new Error(`Refusing to overwrite existing artifact: ${target}`);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const responseArtifact = argument("response") ?? "outputs/model-1.json";
const replaceDerived = process.argv.includes("--replace-derived");
const input = await readJson(path.join(packetRoot, "llm-input.json"));
const ontology = await readJson(path.join(packetRoot, `ontology-v${input.ontology_version}.json`));
const response = await readJson(packetArtifact(packetRoot, responseArtifact));
const statusPath = path.join(packetRoot, "status.json");
const status = await readJson(statusPath);

assertExactKeys(response, responseKeys, "Response");
if (!Array.isArray(response.classifications)) {
  throw new Error("Response classifications must be an array.");
}
for (const [index, row] of response.classifications.entries()) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`classifications[${index}] must be an object.`);
  }
  assertExactKeys(row, classificationKeys, `classifications[${index}]`);
}

const subgenreIds = unique(
  ontology.subgenre_families.flatMap((family) => family.terms.map((term) => term.id)),
);
const toneIds = ontology.tone_tags.map((tone) => tone.id);
const pacingIds = ontology.pacing.map((pace) => pace.id);
const rows = validateClassificationResponse({
  response,
  inputTitles: input.titles,
  runId: input.run_id,
  batchNumber: input.batch_number,
  ontologyVersion: input.ontology_version,
  subgenreIds,
  toneIds,
  pacingIds,
});

const standupFamily = ontology.subgenre_families.find((family) => family.family_id === "stand-up");
const isStandupBatch = input.titles.every((title) => title.content_type === "standup_special");
if (isStandupBatch) {
  if (!standupFamily) throw new Error("Stand-up packet requires a Stand-Up ontology family.");
  const standupIds = new Set(standupFamily.terms.map((term) => term.id));
  const errors = [];
  for (const [rowIdentity, row] of rows) {
    if (!standupIds.has(row.primary_subgenre)) errors.push(`${rowIdentity} primary_subgenre is not a Stand-Up style`);
    if (row.secondary_subgenre !== null && !standupIds.has(row.secondary_subgenre)) {
      errors.push(`${rowIdentity} secondary_subgenre is not a Stand-Up style`);
    }
    if (row.tone_tags.length < 2) errors.push(`${rowIdentity} must contain at least two tone tags`);
    if (row.pacing === null) errors.push(`${rowIdentity} pacing must not be null`);
  }
  if (errors.length) throw new Error(`Invalid stand-up response:\n- ${errors.join("\n- ")}`);
}

const inputByIdentity = new Map(input.titles.map((title) => [identity(title), title]));
const orderedRows = input.titles.map((title) => rows.get(identity(title)));
const lowConfidence = orderedRows
  .filter((row) => row.confidence < 0.75)
  .map((row) => ({
    tmdb_id: row.tmdb_id,
    media_type: row.media_type,
    title: inputByIdentity.get(identity(row)).title,
    confidence: row.confidence,
    primary_subgenre: row.primary_subgenre,
    secondary_subgenre: row.secondary_subgenre,
    tone_tags: row.tone_tags,
    pacing: row.pacing,
  }));
const confidences = orderedRows.map((row) => row.confidence).sort((left, right) => left - right);
const toneCounts = orderedRows.map((row) => row.tone_tags.length);
const generatedAt = new Date().toISOString();
const allTitlesUseMaximumTones = toneCounts.every((count) => count === 3);

const evaluation = {
  schema_version: "single-model-batch-evaluation-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  production_eligible: false,
  model: response.model,
  response_artifact: responseArtifact,
  validation: {
    status: "passed",
    expected_classifications: input.titles.length,
    returned_classifications: orderedRows.length,
    unique_identities: rows.size,
    missing_identities: 0,
    invalid_fields: 0,
  },
  confidence: {
    minimum: confidences[0],
    percentile_10: confidences[Math.floor(confidences.length * 0.1)],
    median: confidences[Math.floor(confidences.length * 0.5)],
    average: round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length),
    below_0_75: lowConfidence.length,
  },
  distributions: {
    primary_subgenre: distribution(orderedRows.map((row) => row.primary_subgenre)),
    pacing: distribution(orderedRows.map((row) => row.pacing)),
    tone_count: distribution(toneCounts),
    tone_tags: distribution(orderedRows.flatMap((row) => row.tone_tags)),
  },
  automated_review_flags: {
    low_confidence: lowConfidence,
    all_titles_use_maximum_tone_tags: allTitlesUseMaximumTones,
  },
};

const finalClassifications = {
  schema_version: "automated-final-editorial-classifications-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  production_eligible: false,
  workflow: "single-model-batch-pass",
  models: { model_1: response.model },
  response_artifact: responseArtifact,
  summary: {
    title_count: input.titles.length,
    automated_final: input.titles.length,
    low_confidence_flags: lowConfidence.length,
    human_review_count: 0,
  },
  classifications: orderedRows.map((row) => ({
    tmdb_id: row.tmdb_id,
    media_type: row.media_type,
    title: inputByIdentity.get(identity(row)).title,
    primary_subgenre: row.primary_subgenre,
    secondary_subgenre: row.secondary_subgenre,
    tone_tags: row.tone_tags,
    pacing: row.pacing,
    confidence: row.confidence,
    rationale: row.rationale,
    field_sources: {
      primary_subgenre: "single-model-batch-pass",
      secondary_subgenre: "single-model-batch-pass",
      tone_tags: "single-model-batch-pass",
      pacing: "single-model-batch-pass",
    },
    review_status: row.confidence < 0.75 ? "automated_low_confidence" : "automated_final",
  })),
};

const finalPath = path.join(packetRoot, "outputs", "final-classifications.json");
const evaluationPath = path.join(packetRoot, "outputs", "evaluation.json");
await atomicWriteJson(finalPath, finalClassifications, { overwrite: replaceDerived });
await atomicWriteJson(evaluationPath, evaluation, { overwrite: replaceDerived });

const updatedStatus = {
  ...status,
  updated_at: generatedAt,
  status: {
    ...status.status,
    subgenre: "complete",
    tone_tags: "complete",
    pacing: "complete",
    model_1: "complete",
    consensus: "not_required",
    human_review: lowConfidence.length ? "flagged" : "not_required",
  },
  counts: {
    ...status.counts,
    classified: input.titles.length,
    final_classifications: input.titles.length,
    low_confidence_flags: lowConfidence.length,
    human_review_pending: lowConfidence.length,
  },
  artifacts: {
    ...status.artifacts,
    model_response: responseArtifact,
    final_classifications: "outputs/final-classifications.json",
    evaluation: "outputs/evaluation.json",
  },
  models: { model_1: response.model },
};
await atomicWriteJson(statusPath, updatedStatus, { overwrite: true });

console.log(JSON.stringify({
  packet: packetRoot,
  model: response.model,
  responseArtifact,
  validated: orderedRows.length,
  lowConfidenceFlags: lowConfidence.length,
  allTitlesUseMaximumTones,
  finalClassifications: finalPath,
  evaluation: evaluationPath,
  productionEligible: false,
}, null, 2));
