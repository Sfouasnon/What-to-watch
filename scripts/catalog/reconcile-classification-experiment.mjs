import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const classificationFields = ["primary_subgenre", "secondary_subgenre", "tone_tags", "pacing"];

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function identity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function unique(values) {
  return [...new Set(values)];
}

function normalized(field, value) {
  return field === "tone_tags" ? [...value].sort() : value;
}

function equal(field, left, right) {
  return JSON.stringify(normalized(field, left)) === JSON.stringify(normalized(field, right));
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

function validateAndNormalizeModel({ response, input, subgenreIds, toneIds, pacingIds }) {
  const errors = [];
  const sanitizations = [];
  const expected = new Set(input.titles.map(identity));
  const allowedSubgenres = new Set(subgenreIds);
  const allowedTones = new Set(toneIds);
  const allowedPacing = new Set(pacingIds);

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
  for (const [index, original] of (response.classifications ?? []).entries()) {
    const row = structuredClone(original);
    const rowIdentity = identity(row);
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
      const invalidTones = row.tone_tags.filter((tone) => !allowedTones.has(tone));
      if (invalidTones.length) {
        row.tone_tags = row.tone_tags.filter((tone) => allowedTones.has(tone));
        sanitizations.push({
          identity: rowIdentity,
          field: "tone_tags",
          removed_values: invalidTones,
          retained_values: row.tone_tags,
        });
      }
      if (row.tone_tags.length < 2 || row.tone_tags.length > 3) {
        errors.push(`${rowIdentity}: tone_tags must retain two or three controlled values`);
      }
      if (new Set(row.tone_tags).size !== row.tone_tags.length) {
        errors.push(`${rowIdentity}: tone_tags contains duplicates`);
      }
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
  if (errors.length) {
    throw new Error(`Invalid ${response.model || "model"} response:\n- ${errors.join("\n- ")}`);
  }
  return { rows, sanitizations };
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const input = await readJson(path.join(packetRoot, "llm-input.json"));
const ontology = await readJson(path.join(packetRoot, `ontology-v${input.ontology_version}.json`));
const statusPath = path.join(packetRoot, "status.json");
const status = await readJson(statusPath);
const model1 = await readJson(path.join(packetRoot, "outputs", "model-1.json"));
const model2 = await readJson(path.join(packetRoot, "outputs", "model-2.json"));

const subgenreIds = unique(
  (ontology.subgenre_families ?? []).flatMap((family) =>
    (family.terms ?? []).map((term) => term.id),
  ),
);
const toneIds = unique((ontology.tone_tags ?? []).map((tone) => tone.id));
const pacingIds = unique((ontology.pacing ?? []).map((pace) => pace.id));
const validationOptions = { input, subgenreIds, toneIds, pacingIds };
const first = validateAndNormalizeModel({ response: model1, ...validationOptions });
const second = validateAndNormalizeModel({ response: model2, ...validationOptions });
const inputByIdentity = new Map(input.titles.map((title) => [identity(title), title]));
const sanitizationsByIdentity = new Map();
for (const item of [...first.sanitizations, ...second.sanitizations]) {
  sanitizationsByIdentity.set(item.identity, [
    ...(sanitizationsByIdentity.get(item.identity) ?? []),
    item,
  ]);
}

const perField = Object.fromEntries(
  classificationFields.map((field) => [field, { agreed: 0, conflicted: 0 }]),
);
let fullyAgreedTitles = 0;
let agreedFields = 0;
let conflictedFields = 0;
const classifications = input.titles.map((inputTitle) => {
  const rowIdentity = identity(inputTitle);
  const model1Row = first.rows.get(rowIdentity);
  const model2Row = second.rows.get(rowIdentity);
  const agreed = {};
  const conflicts = {};
  for (const field of classificationFields) {
    if (equal(field, model1Row[field], model2Row[field])) {
      agreed[field] = normalized(field, model1Row[field]);
      perField[field].agreed += 1;
      agreedFields += 1;
    } else {
      conflicts[field] = {
        model_1: normalized(field, model1Row[field]),
        model_2: normalized(field, model2Row[field]),
      };
      perField[field].conflicted += 1;
      conflictedFields += 1;
    }
  }
  const conflictFields = Object.keys(conflicts);
  if (!conflictFields.length) fullyAgreedTitles += 1;
  return {
    tmdb_id: inputTitle.tmdb_id,
    media_type: inputTitle.media_type,
    title: inputTitle.title,
    agreed,
    conflicts,
    conflict_fields: conflictFields,
    sanitizations: sanitizationsByIdentity.get(rowIdentity) ?? [],
    model_confidence: {
      model_1: model1Row.confidence,
      model_2: model2Row.confidence,
    },
  };
});
const conflicted = classifications.filter((classification) => classification.conflict_fields.length);
const generatedAt = new Date().toISOString();
const summary = {
  title_count: input.title_count,
  fully_agreed_titles: fullyAgreedTitles,
  titles_with_conflicts: conflicted.length,
  agreed_fields: agreedFields,
  conflicted_fields: conflictedFields,
  sanitized_invalid_tone_tags: first.sanitizations.length + second.sanitizations.length,
  per_field: perField,
};
const consensus = {
  schema_version: "two-model-experiment-consensus-v1",
  experiment_id: input.experiment_id,
  run_id: input.run_id,
  source_batches: input.source_batches,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  policy: "Exact field agreement is accepted; invalid tone IDs are removed without changing original model files.",
  models: { model_1: model1.model, model_2: model2.model },
  sanitizations: [...first.sanitizations, ...second.sanitizations],
  summary,
  classifications,
};
const arbiterInput = {
  schema_version: "two-model-conflict-arbiter-input-v1",
  experiment_id: input.experiment_id,
  run_id: input.run_id,
  source_batches: input.source_batches,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  title_count: conflicted.length,
  conflict_field_count: conflictedFields,
  titles: conflicted.map((classification) => ({
    ...inputByIdentity.get(identity(classification)),
    agreed_fields: classification.agreed,
    conflicts: classification.conflicts,
    sanitizations: classification.sanitizations,
  })),
};
const arbiterSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "What to Watch 200-title experiment arbiter response",
  type: "object",
  additionalProperties: false,
  required: ["model", "experiment_id", "run_id", "source_batches", "ontology_version", "resolutions"],
  properties: {
    model: { type: "string", minLength: 1 },
    experiment_id: { const: input.experiment_id },
    run_id: { const: input.run_id },
    source_batches: { const: input.source_batches },
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
                minItems: 2,
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
const instructions = `# 200-title conflict-only arbiter pass

Resolve only the disputed fields in \`arbiter-input.json\` using controlled IDs from \`ontology-v${input.ontology_version}.json\`.

- Each title includes two independent proposals under \`conflicts\` and already accepted values under \`agreed_fields\`.
- Some model values were sanitized because they were not controlled ontology IDs; those removed values are listed under \`sanitizations\` and must not be restored.
- Under \`resolved\`, include exactly the fields named in that title's \`conflicts\` object. Do not re-decide agreed fields.
- Tone tags must contain two or three distinct controlled IDs. Select tags independently for their usefulness as recommendation/filtering dimensions; avoid redundant padding.
- You may choose either proposal or a better controlled value when both are wrong.
- Return JSON only and validate against \`arbiter-response.schema.json\`.

Save the result as \`arbiter-response.json\` in the experiment's \`outputs/\` folder. This experiment uses the arbiter as the automatic tie-breaker; no mandatory human stage follows.
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
    writeFile(path.join(tempRoot, "ARBITER-INSTRUCTIONS.md"), instructions, { flag: "wx" }),
  ]);
  await rename(tempRoot, arbiterRoot);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}

await atomicWriteJson(path.join(packetRoot, "outputs", "two-model-consensus.json"), consensus);
const updatedStatus = {
  ...status,
  updated_at: generatedAt,
  workflow: "two-model-plus-conflict-arbiter",
  status: {
    ...status.status,
    model_1: "complete",
    model_2: second.sanitizations.length ? "complete_with_sanitization" : "complete",
    model_3: "abandoned",
    reconciliation: "complete",
    arbiter: "pending",
    evaluation: "arbiter_pending",
  },
  counts: {
    ...status.counts,
    model_outputs: 2,
    valid_model_outputs: 2,
    sanitized_invalid_tone_tags: summary.sanitized_invalid_tone_tags,
    fully_agreed_titles: summary.fully_agreed_titles,
    titles_with_conflicts: summary.titles_with_conflicts,
    agreed_fields: summary.agreed_fields,
    conflicted_fields: summary.conflicted_fields,
  },
  models: { model_1: model1.model, model_2: model2.model },
  artifacts: {
    ...status.artifacts,
    consensus: "outputs/two-model-consensus.json",
    arbiter: "arbiter/",
  },
};
await atomicWriteJson(statusPath, updatedStatus);

console.log(JSON.stringify({
  packet: packetRoot,
  models: updatedStatus.models,
  ...summary,
  arbiterPacket: arbiterRoot,
}, null, 2));
