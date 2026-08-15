import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  reconcileClassificationResponses,
  validateClassificationResponse,
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
const inputPath = path.join(packetRoot, "llm-input.json");
const statusPath = path.join(packetRoot, "status.json");
const model1Path = path.join(packetRoot, "outputs", "model-1.json");
const model2Path = path.join(packetRoot, "outputs", "model-2.json");

const input = await readJson(inputPath);
const status = await readJson(statusPath);
const ontologyPath = path.join(packetRoot, `ontology-v${input.ontology_version}.json`);
const ontology = await readJson(ontologyPath);
const model1 = await readJson(model1Path);
const model2 = await readJson(model2Path);

const subgenreIds = unique(
  (ontology.subgenre_families ?? []).flatMap((family) =>
    (family.terms ?? []).map((term) => term.id),
  ),
);
const toneIds = unique((ontology.tone_tags ?? []).map((tone) => tone.id));
const pacingIds = unique((ontology.pacing ?? []).map((pace) => pace.id));
const validationOptions = {
  inputTitles: input.titles,
  runId: input.run_id,
  batchNumber: input.batch_number,
  ontologyVersion: input.ontology_version,
  subgenreIds,
  toneIds,
  pacingIds,
};

const model1Rows = validateClassificationResponse({ response: model1, ...validationOptions });
const model2Rows = validateClassificationResponse({ response: model2, ...validationOptions });
const reconciliation = reconcileClassificationResponses({
  inputTitles: input.titles,
  model1Rows,
  model2Rows,
});
const conflicted = reconciliation.classifications.filter((row) => row.conflict_fields.length > 0);
const inputByIdentity = new Map(
  input.titles.map((title) => [`${title.media_type}:${title.tmdb_id}`, title]),
);
const generatedAt = new Date().toISOString();

const consensus = {
  schema_version: "two-model-field-consensus-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  policy: "Exact agreement per field; tone tag order is ignored. No conflicting value is auto-accepted.",
  models: {
    model_1: model1.model,
    model_2: model2.model,
  },
  summary: reconciliation.summary,
  classifications: reconciliation.classifications,
};

const arbiterInput = {
  schema_version: "conflict-only-arbiter-input-v1",
  run_id: input.run_id,
  batch_number: input.batch_number,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  title_count: conflicted.length,
  conflict_field_count: reconciliation.summary.conflicted_fields,
  titles: conflicted.map((row) => ({
    ...inputByIdentity.get(`${row.media_type}:${row.tmdb_id}`),
    agreed_fields: row.agreed,
    conflicts: row.conflicts,
  })),
};

const arbiterSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "What to Watch conflict-only arbiter response",
  type: "object",
  additionalProperties: false,
  required: ["model", "run_id", "batch_number", "ontology_version", "resolutions"],
  properties: {
    model: { type: "string", minLength: 1 },
    run_id: { const: input.run_id },
    batch_number: { const: input.batch_number },
    ontology_version: { const: input.ontology_version },
    resolutions: {
      type: "array",
      minItems: conflicted.length,
      maxItems: conflicted.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tmdb_id", "media_type", "resolved", "confidence", "rationale"],
        properties: {
          tmdb_id: { type: "integer" },
          media_type: { enum: ["movie", "tv"] },
          resolved: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: {
              primary_subgenre: { enum: subgenreIds },
              secondary_subgenre: { anyOf: [{ enum: subgenreIds }, { type: "null" }] },
              tone_tags: {
                type: "array",
                uniqueItems: true,
                minItems: 0,
                maxItems: 3,
                items: { enum: toneIds },
              },
              pacing: { anyOf: [{ enum: pacingIds }, { type: "null" }] },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", minLength: 1, maxLength: 600 },
        },
      },
    },
  },
};

const arbiterInstructions = `# Batch ${String(input.batch_number).padStart(3, "0")} conflict-only arbitration

Resolve only the disputed fields in \`arbiter-input.json\` using the definitions in \`ontology-v${input.ontology_version}.json\`.

- Review the title evidence, the two independent values under \`conflicts\`, and any already accepted \`agreed_fields\`.
- Return one resolution for every title in the packet.
- Under \`resolved\`, include exactly the fields named in that title's \`conflicts\` object. Do not re-decide agreed fields.
- Choose the best controlled value from the ontology; you are not required to side with either model when both are wrong.
- Return JSON only and validate it against \`arbiter-response.schema.json\`.

Save the result as \`arbiter-response.json\` in this folder. Low-confidence or genuinely ambiguous resolutions will be routed to human review after validation.
`;

const arbiterRoot = path.join(packetRoot, "arbiter");
if (await exists(arbiterRoot)) {
  throw new Error(`Arbiter packet already exists and will not be overwritten: ${arbiterRoot}`);
}
const tempRoot = `${arbiterRoot}.tmp-${process.pid}`;
try {
  await mkdir(tempRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(tempRoot, "arbiter-input.json"), `${JSON.stringify(arbiterInput, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "arbiter-response.schema.json"), `${JSON.stringify(arbiterSchema, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, `ontology-v${input.ontology_version}.json`), `${JSON.stringify(ontology, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "ARBITER-INSTRUCTIONS.md"), arbiterInstructions, { flag: "wx" }),
  ]);
  await rename(tempRoot, arbiterRoot);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}

await atomicWriteJson(path.join(packetRoot, "outputs", "consensus.json"), consensus);
const conflictFields = reconciliation.summary.per_field;
const subgenreConflicts = conflictFields.primary_subgenre.conflicted + conflictFields.secondary_subgenre.conflicted;
const updatedStatus = {
  ...status,
  updated_at: generatedAt,
  status: {
    ...status.status,
    subgenre: subgenreConflicts ? "arbiter_pending" : "consensus_complete",
    tone_tags: conflictFields.tone_tags.conflicted ? "arbiter_pending" : "consensus_complete",
    pacing: conflictFields.pacing.conflicted ? "arbiter_pending" : "consensus_complete",
    model_1: "complete",
    model_2: "complete",
    arbiter: conflicted.length ? "pending" : "not_needed",
    consensus: conflicted.length ? "partial" : "complete",
    human_review: "not_started",
  },
  counts: {
    ...status.counts,
    classified: input.title_count,
    consensus_accepted: reconciliation.summary.fully_agreed_titles,
    conflicts: reconciliation.summary.titles_with_conflicts,
    conflict_fields: reconciliation.summary.conflicted_fields,
    human_review_pending: 0,
  },
  models: {
    model_1: model1.model,
    model_2: model2.model,
  },
};
await atomicWriteJson(statusPath, updatedStatus);

console.log(JSON.stringify({
  packet: packetRoot,
  models: updatedStatus.models,
  ...reconciliation.summary,
  arbiterPacket: arbiterRoot,
}, null, 2));
