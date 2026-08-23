import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

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

function identity(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

function year(value) {
  return /^\d{4}/.test(value ?? "") ? Number(value.slice(0, 4)) : null;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

const manifestPath = path.resolve(repoRoot, requiredArgument("manifest"));
const sourceBatches = unique(
  requiredArgument("batches")
    .split(",")
    .map((value) => Number(value.trim())),
);
if (!sourceBatches.length || sourceBatches.some((value) => !Number.isInteger(value) || value < 1)) {
  throw new Error("--batches must be a comma-separated list of positive integers.");
}

const experimentId = requiredArgument("experiment");
if (!/^[a-z0-9][a-z0-9-]*$/.test(experimentId)) {
  throw new Error("--experiment must contain lowercase letters, numbers, and hyphens only.");
}

const workflow = argument("workflow") ?? "three-model";
if (!["three-model", "gpt-only"].includes(workflow)) {
  throw new Error("--workflow must be either three-model or gpt-only.");
}
const isGptOnly = workflow === "gpt-only";

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const selectedBatches = sourceBatches.map((batchNumber) => {
  const batch = manifest.batches?.find((candidate) => candidate.batchNumber === batchNumber);
  if (!batch) throw new Error(`Batch ${batchNumber} is not present in ${manifestPath}.`);
  return batch;
});
const selectedTitles = selectedBatches.flatMap((batch) => batch.titles);
const identities = selectedTitles.map((title) => identity(title.mediaType, title.tmdbId));
if (new Set(identities).size !== identities.length) {
  throw new Error("Selected batches contain duplicate TMDB identities.");
}

const packetDate = String(manifest.generatedAt ?? "").slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(packetDate)) {
  throw new Error("Manifest generatedAt must contain an ISO date.");
}
const packetRoot = path.join(
  repoRoot,
  "curation",
  "classification-experiments",
  packetDate,
  experimentId,
);
if (await exists(packetRoot)) throw new Error(`Experiment packet already exists: ${packetRoot}`);

const ontologyPath = path.join(repoRoot, "curation", "ontology", "v0.3.0", "ontology.json");
const ontology = JSON.parse(await readFile(ontologyPath, "utf8"));
const subgenreIds = unique(
  (ontology.subgenre_families ?? []).flatMap((family) =>
    (family.terms ?? []).map((term) => term.id),
  ),
);
const toneIds = unique((ontology.tone_tags ?? []).map((tone) => tone.id));
const pacingIds = unique((ontology.pacing ?? []).map((pace) => pace.id));

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tmdbIds = unique(selectedTitles.map((title) => title.tmdbId));
const { data: queueRows, error: queueError } = await supabase
  .from("tmdb_catalog_index")
  .select("media_type,tmdb_id,hydration_status,title_id,last_error,hydrated_at")
  .in("tmdb_id", tmdbIds);
if (queueError) throw queueError;
const queueByIdentity = new Map(
  (queueRows ?? []).map((row) => [identity(row.media_type, row.tmdb_id), row]),
);
const queueForExperiment = selectedTitles.map(
  (title) => queueByIdentity.get(identity(title.mediaType, title.tmdbId)),
);
const missing = selectedTitles.filter((title, index) => !queueForExperiment[index]);
const incomplete = queueForExperiment.filter((row) => row && row.hydration_status !== "hydrated");
if (missing.length || incomplete.length) {
  throw new Error(
    `Experiment is not ready. Missing: ${missing.map((title) => identity(title.mediaType, title.tmdbId)).join(", ") || "none"}. `
    + `Incomplete: ${incomplete.map((row) => `${identity(row.media_type, row.tmdb_id)}=${row.hydration_status}`).join(", ") || "none"}.`,
  );
}

const titleIds = unique(queueForExperiment.map((row) => row.title_id));
const { data: titleRows, error: titleError } = await supabase
  .from("titles")
  .select([
    "id",
    "tmdb_id",
    "tmdb_media_type",
    "name",
    "original_name",
    "overview",
    "release_date",
    "runtime_minutes",
    "episode_runtime_minutes",
    "season_count",
    "episode_count",
    "original_language",
    "production_countries",
    "popularity",
    "vote_average",
    "vote_count",
  ].join(","))
  .in("id", titleIds);
if (titleError) throw titleError;

const { data: inputRows, error: inputError } = await supabase
  .from("title_classification_inputs")
  .select([
    "title_id",
    "overview",
    "tmdb_genres",
    "directors",
    "writers",
    "cinematographers",
    "principal_cast",
    "keywords",
  ].join(","))
  .in("title_id", titleIds);
if (inputError) throw inputError;

const titlesById = new Map((titleRows ?? []).map((title) => [title.id, title]));
const inputsByTitleId = new Map((inputRows ?? []).map((classificationInput) => [
  classificationInput.title_id,
  classificationInput,
]));
const missingEvidence = queueForExperiment.filter(
  (row) => !titlesById.has(row.title_id) || !inputsByTitleId.has(row.title_id),
);
if (missingEvidence.length) {
  throw new Error(
    `Hydrated rows are missing evidence: ${missingEvidence
      .map((row) => identity(row.media_type, row.tmdb_id)).join(", ")}`,
  );
}

const llmTitles = selectedTitles.map((selected, index) => {
  const queue = queueByIdentity.get(identity(selected.mediaType, selected.tmdbId));
  const title = titlesById.get(queue.title_id);
  const classificationInput = inputsByTitleId.get(queue.title_id);
  return {
    experiment_position: index + 1,
    source_batch: selectedBatches.find((batch) =>
      batch.titles.some((candidate) => identity(candidate.mediaType, candidate.tmdbId) === identity(selected.mediaType, selected.tmdbId)),
    ).batchNumber,
    tmdb_id: title.tmdb_id,
    media_type: title.tmdb_media_type,
    title: title.name,
    original_title: title.original_name,
    year: year(title.release_date),
    overview: classificationInput.overview ?? title.overview,
    tmdb_genres: classificationInput.tmdb_genres ?? [],
    runtime: title.runtime_minutes,
    episode_runtime: title.episode_runtime_minutes,
    season_count: title.season_count,
    episode_count: title.episode_count,
    original_language: title.original_language,
    origin_country: title.production_countries ?? [],
    popularity: title.popularity,
    vote_average: title.vote_average,
    vote_count: title.vote_count,
    directors: classificationInput.directors ?? [],
    writers: classificationInput.writers ?? [],
    cinematographers: classificationInput.cinematographers ?? [],
    principal_cast: classificationInput.principal_cast ?? [],
    keywords: classificationInput.keywords ?? [],
  };
});

const exportedAt = new Date().toISOString();
const llmInput = {
  schema_version: "classification-capacity-experiment-input-v1",
  experiment_id: experimentId,
  run_id: manifest.runId,
  source_batches: sourceBatches,
  packet_date: packetDate,
  exported_at: exportedAt,
  workflow,
  ontology_version: ontology.ontology_version,
  title_count: llmTitles.length,
  titles: llmTitles,
};

const responseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "What to Watch capacity experiment response",
  type: "object",
  additionalProperties: false,
  required: ["model", "experiment_id", "run_id", "source_batches", "ontology_version", "classifications"],
  properties: {
    model: { type: "string", minLength: 1 },
    experiment_id: { const: experimentId },
    run_id: { const: manifest.runId },
    source_batches: { const: sourceBatches },
    ontology_version: { const: ontology.ontology_version },
    classifications: {
      type: "array",
      minItems: llmTitles.length,
      maxItems: llmTitles.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "tmdb_id",
          "media_type",
          "primary_subgenre",
          "secondary_subgenre",
          "tone_tags",
          "pacing",
          "confidence",
          "rationale",
        ],
        properties: {
          tmdb_id: { type: "integer" },
          media_type: { enum: ["movie", "tv"] },
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
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", minLength: 1, maxLength: 600 },
        },
      },
    },
  },
};

const outputInstructions = isGptOnly
  ? "Save the complete result as `outputs/model-1.json`. This is the only model output required for this experiment."
  : "Save three independent results as `outputs/model-1.json`, `outputs/model-2.json`, and `outputs/model-3.json`. Never expose one model's response to another.";

const instructions = `# ${llmTitles.length}-title ${isGptOnly ? "GPT-only" : "three-model"} capacity experiment

Classify every title in \`llm-input.json\` using only controlled IDs from \`ontology-v${ontology.ontology_version}.json\`.

This is one independent model pass. Do not inspect or infer another model's output.

For every title:

1. Choose exactly one \`primary_subgenre\`.
2. Choose zero or one different \`secondary_subgenre\`.
3. Choose two or three distinct \`tone_tags\`. Do not default to three. Keep a third tone only when it passes all three tests:
   - It describes a distinct viewing experience rather than repeating or closely overlapping another selected tone.
   - It is strongly supported by the supplied overview, genres, keywords, or other evidence.
   - It adds meaningful recommendation-filtering value: removing it would materially change which users might seek out or avoid the title.
   If the third tone fails any test, return only the two strongest and most useful tones.
4. Choose \`slow\`, \`moderate\`, or \`fast\` pacing, or \`null\` only when evidence is insufficient.
5. Return confidence from 0 to 1 and a concise evidence-based rationale.

Return JSON only. It must validate against \`llm-response.schema.json\`, contain exactly ${llmTitles.length} unique title identities, and preserve \`experiment_id\`, \`run_id\`, \`source_batches\`, and \`ontology_version\` exactly.

${outputInstructions}
`;

const experimentReadme = `# ${experimentId}

This folder is an isolated ${llmTitles.length}-title ${isGptOnly ? "GPT-only" : "three-model"} capacity and quality experiment built from manifest Batches ${sourceBatches.map((value) => String(value).padStart(3, "0")).join(", ")}.

It is not a production classification batch. Hydrated evidence may remain in Supabase, but no result from this folder is eligible for editorial publishing until the experiment is evaluated.

## Success criteria

- ${isGptOnly ? "GPT returns" : "Each independent model returns"} exactly ${llmTitles.length} unique classifications without truncation.
- Every response validates against the controlled ontology and response schema.
- Tone outputs contain two or three tags per title, and every retained third tag adds distinct filtering value.
- ${isGptOnly ? "The result is compared with the prior 200-title two-model experiment and Batch 001 baseline." : "Tag-level three-model voting is compared with Batch 001's 100-title baseline."}
- We inspect invalid-output, truncation, and retry rates before adopting ${llmTitles.length}-title packets.
`;

const status = {
  schema_version: "classification-capacity-experiment-status-v1",
  experiment_id: experimentId,
  run_id: manifest.runId,
  source_batches: sourceBatches,
  packet_date: packetDate,
  title_count: llmTitles.length,
  workflow,
  updated_at: exportedAt,
  production_eligible: false,
  status: {
    hydration: "complete",
    packet: "ready",
    model_1: "pending",
    ...(isGptOnly ? {} : { model_2: "pending", model_3: "pending" }),
    evaluation: "not_started",
  },
  counts: {
    hydrated: llmTitles.length,
    model_outputs: 0,
    valid_model_outputs: 0,
  },
  artifacts: {
    input: "llm-input.json",
    ontology: `ontology-v${ontology.ontology_version}.json`,
    instructions: "LLM-INSTRUCTIONS.md",
    response_schema: "llm-response.schema.json",
    outputs: "outputs/",
  },
};

const outputsReadme = `# ${isGptOnly ? "GPT" : "Independent model"} outputs

${isGptOnly ? "Save the untouched GPT response as `model-1.json`." : "Save the three untouched responses as `model-1.json`, `model-2.json`, and `model-3.json`."} This experiment is isolated and no output is production-eligible until validation and evaluation are complete.
`;

const tempRoot = `${packetRoot}.tmp-${process.pid}`;
try {
  await mkdir(path.join(tempRoot, "outputs"), { recursive: true });
  await Promise.all([
    writeFile(path.join(tempRoot, "llm-input.json"), `${JSON.stringify(llmInput, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, `ontology-v${ontology.ontology_version}.json`), `${JSON.stringify(ontology, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "llm-response.schema.json"), `${JSON.stringify(responseSchema, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "LLM-INSTRUCTIONS.md"), instructions, { flag: "wx" }),
    writeFile(path.join(tempRoot, "EXPERIMENT.md"), experimentReadme, { flag: "wx" }),
    writeFile(path.join(tempRoot, "status.json"), `${JSON.stringify(status, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "outputs", "README.md"), outputsReadme, { flag: "wx" }),
  ]);
  await rename(tempRoot, packetRoot);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}

console.log(JSON.stringify({
  output: packetRoot,
  experimentId,
  workflow,
  sourceBatches,
  titleCount: llmTitles.length,
  movieCount: llmTitles.filter((title) => title.media_type === "movie").length,
  tvCount: llmTitles.filter((title) => title.media_type === "tv").length,
  hydration: "complete",
  productionEligible: false,
}, null, 2));
