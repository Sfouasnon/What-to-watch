import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const responseKeys = [
  "model",
  "experiment_id",
  "run_id",
  "source_batches",
  "ontology_version",
  "classifications",
];
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
    throw new Error(`--response must point to a file inside the experiment packet: ${artifact}`);
  }
  return target;
}

function identity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
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

async function writeNewJson(target, value) {
  if (await exists(target)) throw new Error(`Refusing to overwrite existing artifact: ${target}`);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

async function replaceJson(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

function validateResponse({ response, input, ontology }) {
  const errors = [];
  const expected = new Set(input.titles.map(identity));
  const allowedSubgenres = new Set(
    (ontology.subgenre_families ?? []).flatMap((family) =>
      (family.terms ?? []).map((term) => term.id),
    ),
  );
  const allowedTones = new Set((ontology.tone_tags ?? []).map((tone) => tone.id));
  const allowedPacing = new Set((ontology.pacing ?? []).map((pace) => pace.id));

  const unexpectedResponseKeys = Object.keys(response).filter((key) => !responseKeys.includes(key));
  if (unexpectedResponseKeys.length) errors.push(`unexpected response keys: ${unexpectedResponseKeys.join(", ")}`);
  for (const key of responseKeys) {
    if (!(key in response)) errors.push(`missing response key: ${key}`);
  }
  if (typeof response.model !== "string" || !response.model.trim()) errors.push("model must be a non-empty string");
  if (response.experiment_id !== input.experiment_id) errors.push("experiment_id mismatch");
  if (response.run_id !== input.run_id) errors.push("run_id mismatch");
  if (JSON.stringify(response.source_batches) !== JSON.stringify(input.source_batches)) {
    errors.push("source_batches mismatch");
  }
  if (response.ontology_version !== input.ontology_version) errors.push("ontology_version mismatch");
  if (!Array.isArray(response.classifications) || response.classifications.length !== input.title_count) {
    errors.push(`classifications must contain ${input.title_count} rows`);
  }

  const rows = new Map();
  for (const [index, row] of (response.classifications ?? []).entries()) {
    const rowIdentity = identity(row);
    const unexpectedKeys = Object.keys(row).filter((key) => !classificationKeys.includes(key));
    if (unexpectedKeys.length) errors.push(`${rowIdentity}: unexpected keys ${unexpectedKeys.join(", ")}`);
    for (const key of classificationKeys) {
      if (!(key in row)) errors.push(`${rowIdentity}: missing key ${key}`);
    }
    if (!expected.has(rowIdentity)) errors.push(`${index}: unexpected identity ${rowIdentity}`);
    if (rows.has(rowIdentity)) errors.push(`${index}: duplicate identity ${rowIdentity}`);
    if (!allowedSubgenres.has(row.primary_subgenre)) {
      errors.push(`${rowIdentity}: invalid primary_subgenre ${row.primary_subgenre}`);
    }
    if (row.secondary_subgenre !== null && !allowedSubgenres.has(row.secondary_subgenre)) {
      errors.push(`${rowIdentity}: invalid secondary_subgenre ${row.secondary_subgenre}`);
    }
    if (row.secondary_subgenre === row.primary_subgenre) {
      errors.push(`${rowIdentity}: primary and secondary subgenres match`);
    }
    if (!Array.isArray(row.tone_tags)) {
      errors.push(`${rowIdentity}: tone_tags must be an array`);
    } else {
      if (row.tone_tags.length < 2 || row.tone_tags.length > 3) {
        errors.push(`${rowIdentity}: tone_tags must contain two or three values`);
      }
      if (new Set(row.tone_tags).size !== row.tone_tags.length) {
        errors.push(`${rowIdentity}: tone_tags contains duplicates`);
      }
      const invalidTones = row.tone_tags.filter((tone) => !allowedTones.has(tone));
      if (invalidTones.length) errors.push(`${rowIdentity}: invalid tone tags ${invalidTones.join(", ")}`);
    }
    if (row.pacing !== null && !allowedPacing.has(row.pacing)) {
      errors.push(`${rowIdentity}: invalid pacing ${row.pacing}`);
    }
    if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
      errors.push(`${rowIdentity}: invalid confidence`);
    }
    if (typeof row.rationale !== "string" || !row.rationale.trim() || row.rationale.length > 600) {
      errors.push(`${rowIdentity}: invalid rationale`);
    }
    rows.set(rowIdentity, row);
  }

  const missing = [...expected].filter((rowIdentity) => !rows.has(rowIdentity));
  if (missing.length) errors.push(`missing ${missing.length} expected identities`);
  if (errors.length) throw new Error(`Invalid ${response.model || "model"} response:\n- ${errors.join("\n- ")}`);
  return rows;
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const input = await readJson(path.join(packetRoot, "llm-input.json"));
const ontology = await readJson(path.join(packetRoot, `ontology-v${input.ontology_version}.json`));
const responseArtifact = argument("response") ?? "outputs/model-1.json";
const response = await readJson(packetArtifact(packetRoot, responseArtifact));
const replaceDerived = process.argv.includes("--replace-derived");
const statusPath = path.join(packetRoot, "status.json");
const status = await readJson(statusPath);
if (status.workflow !== "gpt-only") {
  throw new Error(`Expected a gpt-only experiment, received ${status.workflow ?? "no workflow"}.`);
}

const rows = validateResponse({ response, input, ontology });
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
const evaluation = {
  schema_version: "gpt-only-experiment-evaluation-v1",
  experiment_id: input.experiment_id,
  run_id: input.run_id,
  source_batches: input.source_batches,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  production_eligible: false,
  model: response.model,
  response_artifact: responseArtifact,
  validation: {
    status: "passed",
    expected_classifications: input.title_count,
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
    media_type: distribution(input.titles.map((title) => title.media_type)),
    primary_subgenre: distribution(orderedRows.map((row) => row.primary_subgenre)),
    pacing: distribution(orderedRows.map((row) => row.pacing)),
    tone_count: distribution(toneCounts),
    tone_tags: distribution(orderedRows.flatMap((row) => row.tone_tags)),
    tone_combinations: distribution(
      orderedRows.map((row) => [...row.tone_tags].sort().join("|")),
    ),
  },
  automated_review_flags: {
    low_confidence: lowConfidence,
    all_titles_use_maximum_tone_tags: toneCounts.every((count) => count === 3),
  },
  recommendation: "Accept as a valid capacity-test result. Keep low-confidence rows and maximum-tone-tag behavior visible for comparison before publishing or adopting the workflow.",
};

const finalClassifications = {
  schema_version: "automated-final-editorial-classifications-v1",
  experiment_id: input.experiment_id,
  run_id: input.run_id,
  source_batches: input.source_batches,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  production_eligible: false,
  workflow: "single-gpt-pass",
  models: { model_1: response.model },
  response_artifact: responseArtifact,
  summary: {
    title_count: input.title_count,
    automated_final: input.title_count,
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
      primary_subgenre: "single-gpt-pass",
      secondary_subgenre: "single-gpt-pass",
      tone_tags: "single-gpt-pass",
      pacing: "single-gpt-pass",
    },
    review_status: row.confidence < 0.75 ? "automated_low_confidence" : "automated_final",
  })),
};

const finalPath = path.join(packetRoot, "outputs", "final-classifications.json");
const evaluationPath = path.join(packetRoot, "outputs", "evaluation.json");
const writeDerivedJson = replaceDerived ? replaceJson : writeNewJson;
await writeDerivedJson(finalPath, finalClassifications);
await writeDerivedJson(evaluationPath, evaluation);

status.updated_at = generatedAt;
status.status.model_1 = "complete";
status.status.evaluation = "complete";
status.status.finalization = "complete";
status.counts.model_outputs = 1;
status.counts.valid_model_outputs = 1;
status.counts.final_classifications = input.title_count;
status.counts.low_confidence_flags = lowConfidence.length;
status.counts.human_review = 0;
status.artifacts.final_classifications = "outputs/final-classifications.json";
status.artifacts.evaluation = "outputs/evaluation.json";
status.artifacts.model_response = responseArtifact;
status.models = { model_1: response.model };
await replaceJson(statusPath, status);

console.log(JSON.stringify({
  packet: packetRoot,
  model: response.model,
  responseArtifact,
  replacedDerivedArtifacts: replaceDerived,
  validated: orderedRows.length,
  lowConfidenceFlags: lowConfidence.length,
  allTitlesUseThreeTones: evaluation.automated_review_flags.all_titles_use_maximum_tone_tags,
  finalClassifications: finalPath,
  evaluation: evaluationPath,
  productionEligible: false,
}, null, 2));
