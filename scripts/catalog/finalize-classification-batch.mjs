import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  finalizeArbiterResolutions,
  validateArbiterResponse,
} from "./lib/classification-reconciliation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function numberArgument(name, fallback, { min, max }) {
  const raw = argument(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
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

async function atomicWriteJson(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const minimumConfidence = numberArgument("minimum-confidence", 0.75, { min: 0, max: 1 });
const input = await readJson(path.join(packetRoot, "llm-input.json"));
const statusPath = path.join(packetRoot, "status.json");
const status = await readJson(statusPath);
const consensus = await readJson(path.join(packetRoot, "outputs", "consensus.json"));
const arbiterInput = await readJson(path.join(packetRoot, "arbiter", "arbiter-input.json"));
const ontology = await readJson(path.join(packetRoot, `ontology-v${input.ontology_version}.json`));

const explicitResponse = argument("arbiter-response");
const responseCandidates = explicitResponse
  ? [path.resolve(repoRoot, explicitResponse)]
  : [
      path.join(packetRoot, "outputs", "arbiter-response.json"),
      path.join(packetRoot, "arbiter", "arbiter-response.json"),
    ];
let arbiterResponsePath = null;
for (const candidate of responseCandidates) {
  if (await exists(candidate)) {
    arbiterResponsePath = candidate;
    break;
  }
}
if (!arbiterResponsePath) {
  throw new Error(`Arbiter response not found. Checked: ${responseCandidates.join(", ")}`);
}
const arbiterResponse = await readJson(arbiterResponsePath);

const subgenreIds = unique(
  (ontology.subgenre_families ?? []).flatMap((family) =>
    (family.terms ?? []).map((term) => term.id),
  ),
);
const toneIds = unique((ontology.tone_tags ?? []).map((tone) => tone.id));
const pacingIds = unique((ontology.pacing ?? []).map((pace) => pace.id));
const arbiterRows = validateArbiterResponse({
  response: arbiterResponse,
  arbiterTitles: arbiterInput.titles,
  runId: input.run_id,
  batchNumber: input.batch_number,
  ontologyVersion: input.ontology_version,
  subgenreIds,
  toneIds,
  pacingIds,
});
const finalized = finalizeArbiterResolutions({
  inputTitles: input.titles,
  consensusRows: consensus.classifications,
  arbiterRows,
  minimumConfidence,
});
const generatedAt = new Date().toISOString();

const provisional = {
  schema_version: "provisional-editorial-classifications-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  policy: {
    two_model_agreement: "accepted",
    arbiter_matches_either_original_value: "accepted as an adjudicated majority",
    arbiter_introduces_third_value: "human review required",
    minimum_arbiter_confidence: minimumConfidence,
  },
  models: {
    ...status.models,
    arbiter: arbiterResponse.model,
  },
  summary: finalized.summary,
  classifications: finalized.classifications,
};

const humanReview = {
  schema_version: "human-review-input-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  title_count: finalized.humanReview.length,
  field_count: finalized.summary.human_review_fields,
  minimum_arbiter_confidence: minimumConfidence,
  titles: finalized.humanReview,
};

const decisionTemplate = {
  schema_version: "human-review-decisions-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  reviewer: null,
  reviewed_at: null,
  decisions: finalized.humanReview.map((title) => ({
    tmdb_id: title.tmdb_id,
    media_type: title.media_type,
    title: title.title,
    approved: false,
    resolved: Object.fromEntries(
      title.fields_to_review.map((field) => [field.field, field.arbiter]),
    ),
    notes: null,
  })),
};

const reviewInstructions = `# Batch ${String(input.batch_number).padStart(3, "0")} human review

Review only the fields listed under \`fields_to_review\` in \`human-review-input.json\`. The packet contains ${finalized.humanReview.length} titles and ${finalized.summary.human_review_fields} fields; all other fields already have an automated majority.

For each row in \`human-review-decisions.template.json\`:

1. Compare the title evidence, both original model answers, the arbiter answer, and the controlled definitions in \`ontology-v${input.ontology_version}.json\`.
2. Keep or replace each proposed value under \`resolved\`.
3. Set \`approved\` to \`true\` after reviewing every listed field for that title.
4. Add optional notes, plus the reviewer and reviewed timestamp at the top.
5. Save the completed file as \`human-review-decisions.json\` in this folder.

Do not edit fields that are absent from the template. They have already reached an automated majority.
`;

const humanRoot = path.join(packetRoot, "human-review");
if (await exists(humanRoot)) {
  throw new Error(`Human-review packet already exists and will not be overwritten: ${humanRoot}`);
}
const tempRoot = `${humanRoot}.tmp-${process.pid}`;
try {
  await mkdir(tempRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(tempRoot, "human-review-input.json"), `${JSON.stringify(humanReview, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "human-review-decisions.template.json"), `${JSON.stringify(decisionTemplate, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, `ontology-v${input.ontology_version}.json`), `${JSON.stringify(ontology, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "HUMAN-REVIEW-INSTRUCTIONS.md"), reviewInstructions, { flag: "wx" }),
  ]);
  await rename(tempRoot, humanRoot);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}

await atomicWriteJson(path.join(packetRoot, "outputs", "provisional-classifications.json"), provisional);
const pendingFields = new Set(
  finalized.humanReview.flatMap((title) => title.fields_to_review.map((field) => field.field)),
);
const updatedStatus = {
  ...status,
  updated_at: generatedAt,
  status: {
    ...status.status,
    subgenre: pendingFields.has("primary_subgenre") || pendingFields.has("secondary_subgenre")
      ? "human_review_pending"
      : "complete",
    tone_tags: pendingFields.has("tone_tags") ? "human_review_pending" : "complete",
    pacing: pendingFields.has("pacing") ? "human_review_pending" : "complete",
    arbiter: "complete",
    consensus: finalized.humanReview.length ? "human_review_pending" : "complete",
    human_review: finalized.humanReview.length ? "pending" : "not_needed",
  },
  counts: {
    ...status.counts,
    automated_complete: finalized.summary.automated_complete_titles,
    arbiter_majority_fields: finalized.summary.arbiter_majority_fields,
    arbiter_novel_fields: finalized.summary.arbiter_novel_fields,
    human_review_pending: finalized.summary.human_review_titles,
    human_review_pending_fields: finalized.summary.human_review_fields,
  },
  models: {
    ...status.models,
    arbiter: arbiterResponse.model,
  },
  artifacts: {
    ...status.artifacts,
    consensus: "outputs/consensus.json",
    arbiter_response: path.relative(packetRoot, arbiterResponsePath),
    provisional_classifications: "outputs/provisional-classifications.json",
    human_review: "human-review/",
  },
};
await atomicWriteJson(statusPath, updatedStatus);

console.log(JSON.stringify({
  packet: packetRoot,
  arbiterResponse: arbiterResponsePath,
  arbiterModel: arbiterResponse.model,
  ...finalized.summary,
  humanReviewPacket: humanRoot,
}, null, 2));
