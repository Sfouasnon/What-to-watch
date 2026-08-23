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

function integerArgument(name, { min, max }) {
  const raw = requiredArgument(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function identity(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

function year(value) {
  return /^\d{4}/.test(value ?? "") ? Number(value.slice(0, 4)) : null;
}

function unique(values) {
  return [...new Set(values)];
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
const batchNumber = integerArgument("batch", { min: 1, max: 10000 });
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const batch = manifest.batches?.find((candidate) => candidate.batchNumber === batchNumber);

if (!batch) throw new Error(`Batch ${batchNumber} is not present in ${manifestPath}.`);
if (!Array.isArray(batch.titles) || batch.titles.length === 0) {
  throw new Error(`Batch ${batchNumber} has no titles.`);
}

const packetDate = String(manifest.generatedAt ?? "").slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(packetDate)) {
  throw new Error("Manifest generatedAt must contain an ISO date.");
}

const batchSlug = `batch-${String(batchNumber).padStart(3, "0")}`;
const packetRoot = path.join(repoRoot, "curation", "classification", packetDate, batchSlug);
if (await exists(packetRoot)) {
  throw new Error(`Classification packet already exists: ${packetRoot}`);
}

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
const tmdbIds = unique(batch.titles.map((title) => title.tmdbId));

const { data: queueRows, error: queueError } = await supabase
  .from("tmdb_catalog_index")
  .select("media_type,tmdb_id,hydration_status,title_id,last_error,hydrated_at")
  .in("tmdb_id", tmdbIds);
if (queueError) throw queueError;

const queueByIdentity = new Map(
  (queueRows ?? []).map((row) => [identity(row.media_type, row.tmdb_id), row]),
);
const queueForBatch = batch.titles.map((title) => queueByIdentity.get(identity(title.mediaType, title.tmdbId)));
const missingQueue = batch.titles.filter((title, index) => !queueForBatch[index]);
const incompleteQueue = queueForBatch.filter((row) => row && row.hydration_status !== "hydrated");

if (missingQueue.length || incompleteQueue.length) {
  const missing = missingQueue.map((title) => identity(title.mediaType, title.tmdbId));
  const incomplete = incompleteQueue.map((row) => `${identity(row.media_type, row.tmdb_id)}=${row.hydration_status}`);
  throw new Error(
    `Batch is not ready for classification. Missing queue rows: ${missing.join(", ") || "none"}. `
    + `Incomplete rows: ${incomplete.join(", ") || "none"}.`,
  );
}

const titleIds = unique(queueForBatch.map((row) => row.title_id));
const { data: titleRows, error: titleError } = await supabase
  .from("titles")
  .select([
    "id",
    "tmdb_id",
    "tmdb_media_type",
    "content_type",
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
    "source",
    "metadata_version",
    "captured_at",
  ].join(","))
  .in("title_id", titleIds);
if (inputError) throw inputError;

const titlesById = new Map((titleRows ?? []).map((title) => [title.id, title]));
const inputsByTitleId = new Map((inputRows ?? []).map((input) => [input.title_id, input]));
const missingEvidence = queueForBatch.filter(
  (row) => !titlesById.has(row.title_id) || !inputsByTitleId.has(row.title_id),
);
if (missingEvidence.length) {
  throw new Error(
    `Hydrated rows are missing title or classification evidence: ${missingEvidence
      .map((row) => identity(row.media_type, row.tmdb_id)).join(", ")}`,
  );
}

const llmTitles = batch.titles.map((selected, index) => {
  const queue = queueByIdentity.get(identity(selected.mediaType, selected.tmdbId));
  const title = titlesById.get(queue.title_id);
  const input = inputsByTitleId.get(queue.title_id);
  return {
    batch_position: index + 1,
    tmdb_id: title.tmdb_id,
    media_type: title.tmdb_media_type,
    content_type: title.content_type,
    title: title.name,
    original_title: title.original_name,
    year: year(title.release_date),
    overview: input.overview ?? title.overview,
    tmdb_genres: input.tmdb_genres ?? [],
    runtime: title.runtime_minutes,
    episode_runtime: title.episode_runtime_minutes,
    season_count: title.season_count,
    episode_count: title.episode_count,
    original_language: title.original_language,
    origin_country: title.production_countries ?? [],
    popularity: title.popularity,
    vote_average: title.vote_average,
    vote_count: title.vote_count,
    directors: input.directors ?? [],
    writers: input.writers ?? [],
    cinematographers: input.cinematographers ?? [],
    principal_cast: input.principal_cast ?? [],
    keywords: input.keywords ?? [],
  };
});

const exportedAt = new Date().toISOString();
const llmInput = {
  schema_version: "classification-input-v1",
  run_id: manifest.runId,
  batch_number: batchNumber,
  batch_date: packetDate,
  exported_at: exportedAt,
  ontology_version: ontology.ontology_version,
  title_count: llmTitles.length,
  titles: llmTitles,
};

const status = {
  schema_version: "classification-batch-status-v1",
  run_id: manifest.runId,
  batch_number: batchNumber,
  batch_date: packetDate,
  title_count: llmTitles.length,
  updated_at: exportedAt,
  status: {
    hydration: "complete",
    subgenre: "pending",
    tone_tags: "pending",
    pacing: "pending",
    model_1: "pending",
    model_2: "pending",
    arbiter: "not_started",
    consensus: "not_started",
    human_review: "not_started",
  },
  counts: {
    hydrated: llmTitles.length,
    classified: 0,
    consensus_accepted: 0,
    conflicts: 0,
    human_review_pending: 0,
  },
  artifacts: {
    input: "llm-input.json",
    ontology: `ontology-v${ontology.ontology_version}.json`,
    instructions: "LLM-INSTRUCTIONS.md",
    response_schema: "llm-response.schema.json",
    outputs: "outputs/",
  },
};

const responseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "What to Watch batch classification response",
  type: "object",
  additionalProperties: false,
  required: ["model", "run_id", "batch_number", "ontology_version", "classifications"],
  properties: {
    model: { type: "string", minLength: 1 },
    run_id: { const: manifest.runId },
    batch_number: { const: batchNumber },
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
            minItems: 0,
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

const instructions = `# Batch ${String(batchNumber).padStart(3, "0")} LLM instructions

Classify every title in \`llm-input.json\` using only controlled IDs from \`ontology-v${ontology.ontology_version}.json\`.

For each title:

1. Choose exactly one \`primary_subgenre\`.
2. Choose zero or one different \`secondary_subgenre\`.
3. Choose zero to three \`tone_tags\`. Prefer exactly three when three strong, non-redundant tags genuinely apply; never pad weak tags.
4. Choose one pacing value (\`slow\`, \`moderate\`, or \`fast\`), or \`null\` only when evidence is insufficient.
5. Give a confidence from 0 to 1 and a concise evidence-based rationale.

Return JSON only. It must validate against \`llm-response.schema.json\` and preserve every title's TMDB ID and media type. Save independent first-pass results as:

- \`outputs/model-1.json\`
- \`outputs/model-2.json\`

Do not let either model see the other's output. The arbiter receives only conflicts after both independent passes are validated.
`;

const outputsReadme = `# Model outputs

Place independent model responses here as \`model-1.json\` and \`model-2.json\`. Do not overwrite either response during adjudication. Later automation will write conflict-only arbitration and human-review artifacts alongside them.
`;

const tempRoot = `${packetRoot}.tmp-${process.pid}`;
try {
  await mkdir(path.join(tempRoot, "outputs"), { recursive: true });
  await Promise.all([
    writeFile(path.join(tempRoot, "llm-input.json"), `${JSON.stringify(llmInput, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, `ontology-v${ontology.ontology_version}.json`), `${JSON.stringify(ontology, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "status.json"), `${JSON.stringify(status, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "llm-response.schema.json"), `${JSON.stringify(responseSchema, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(tempRoot, "LLM-INSTRUCTIONS.md"), instructions, { flag: "wx" }),
    writeFile(path.join(tempRoot, "outputs", "README.md"), outputsReadme, { flag: "wx" }),
  ]);
  await rename(tempRoot, packetRoot);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}

console.log(JSON.stringify({
  output: packetRoot,
  date: packetDate,
  batchNumber,
  titleCount: llmTitles.length,
  hydration: "complete",
  subgenre: "pending",
  toneTags: "pending",
}, null, 2));
