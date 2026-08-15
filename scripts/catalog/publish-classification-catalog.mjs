import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRITE = process.argv.includes("--write");
const CHUNK_SIZE = 100;

function parseArguments(argv) {
  const options = new Map();
  for (const argument of argv.filter((value) => value !== "--write")) {
    if (!argument.startsWith("--") || !argument.includes("=")) {
      throw new Error(`Expected --name=value, received ${argument}`);
    }
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    options.set(name, [...(options.get(name) ?? []), value]);
  }
  return options;
}

async function readJson(target) {
  return JSON.parse(await readFile(path.resolve(repoRoot, target), "utf8"));
}

function identity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function manifestIdentity(value) {
  return `${value.mediaType}:${value.tmdbId}`;
}

function unique(values) {
  return [...new Set(values)];
}

function chunks(values, size = CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function confidenceFor(row) {
  if (typeof row.confidence === "number" && Number.isFinite(row.confidence)) return row.confidence;
  if (row.review_status === "human_verified") return 1;
  if (row.review_status === "automated_consensus") return 0.9;
  return 0.85;
}

function classifierVersion(artifact) {
  const workflow = artifact.workflow ?? (artifact.models ? "adjudicated-multi-model" : "editorial-final");
  const models = Object.values(artifact.models ?? {}).filter((value) => typeof value === "string");
  return `${workflow}:${models.join("+") || "recorded-in-artifact"}`.slice(0, 160);
}

const knownServices = [
  { slug: "netflix", label: "Netflix", matches: (name) => name.startsWith("netflix") },
  { slug: "prime-video", label: "Prime Video", matches: (name) => name.includes("prime video") },
  { slug: "hulu", label: "Hulu", matches: (name) => name === "hulu" },
  { slug: "criterion-channel", label: "Criterion Channel", matches: (name) => name === "criterion channel" },
  { slug: "disney-plus", label: "Disney+", matches: (name) => name === "disney+" },
  { slug: "apple-tv-plus", label: "Apple TV+", matches: (name) => name === "apple tv+" },
  { slug: "max", label: "Max", matches: (name) => name === "max" || name.startsWith("hbo max ") },
  { slug: "paramount-plus", label: "Paramount+", matches: (name) => name.startsWith("paramount plus") || name.startsWith("paramount+") },
  { slug: "peacock", label: "Peacock", matches: (name) => name.startsWith("peacock") },
];

function normalizedProvider(rawName) {
  const trimmed = rawName.trim();
  const normalized = trimmed.toLocaleLowerCase();
  const service = knownServices.find((candidate) => candidate.matches(normalized));
  return {
    providerName: service?.label ?? trimmed,
    serviceSlug: service?.slug ?? null,
  };
}

function providerKey(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 121);
  if (!slug) throw new Error(`Unable to derive provider key for ${value}`);
  return slug;
}

function offerType(value) {
  if (value === "free") return "free_ad_supported";
  if (value === "rental") return "rent";
  return "subscription";
}

async function fetchInChunks(supabase, table, columns, field, values, chunkSize = 150) {
  const rows = [];
  for (const chunk of chunks(values, chunkSize)) {
    const { data, error } = await supabase.from(table).select(columns).in(field, chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

const options = parseArguments(process.argv.slice(2));
const manifestPath = options.get("manifest")?.[0];
const artifactPaths = options.get("artifact") ?? [];
const providersPath = options.get("providers")?.[0];
const ontologyPath = options.get("ontology")?.[0] ?? "curation/ontology/v0.1.1/ontology.json";
if (!manifestPath || !artifactPaths.length || !providersPath) {
  throw new Error(
    "Usage: node scripts/catalog/publish-classification-catalog.mjs --manifest=<path> --artifact=<path> [--artifact=<path> ...] --providers=<path> [--write]",
  );
}

const [manifest, ontology, providersCache, ...artifacts] = await Promise.all([
  readJson(manifestPath),
  readJson(ontologyPath),
  readJson(providersPath),
  ...artifactPaths.map(readJson),
]);
const manifestTitles = manifest.batches.flatMap((batch) => batch.titles);
const expectedIdentities = new Set(manifestTitles.map(manifestIdentity));
if (manifest.titleCount !== 900 || manifestTitles.length !== 900 || expectedIdentities.size !== 900) {
  throw new Error(`Expected one 900-title manifest, found ${manifest.titleCount}/${manifestTitles.length}/${expectedIdentities.size}.`);
}

const allowedSubgenres = new Set(
  ontology.subgenre_families.flatMap((family) => family.terms.map((term) => term.id)),
);
const allowedTones = new Set(ontology.tone_tags.map((tone) => tone.id));
const allowedPacing = new Set(ontology.pacing.map((pace) => pace.id));
const classificationsByIdentity = new Map();
for (const [artifactIndex, artifact] of artifacts.entries()) {
  for (const row of artifact.classifications ?? []) {
    const rowIdentity = identity(row);
    if (!expectedIdentities.has(rowIdentity)) throw new Error(`Unexpected classification ${rowIdentity}.`);
    if (classificationsByIdentity.has(rowIdentity)) throw new Error(`Duplicate classification ${rowIdentity}.`);
    if (!allowedSubgenres.has(row.primary_subgenre)) throw new Error(`Invalid primary subgenre for ${rowIdentity}.`);
    if (row.secondary_subgenre !== null && row.secondary_subgenre !== undefined && !allowedSubgenres.has(row.secondary_subgenre)) {
      throw new Error(`Invalid secondary subgenre for ${rowIdentity}.`);
    }
    if (row.secondary_subgenre === row.primary_subgenre) throw new Error(`Duplicate subgenres for ${rowIdentity}.`);
    if (!Array.isArray(row.tone_tags) || row.tone_tags.length < 2 || row.tone_tags.length > 3) {
      throw new Error(`Invalid tone count for ${rowIdentity}.`);
    }
    if (new Set(row.tone_tags).size !== row.tone_tags.length || row.tone_tags.some((tone) => !allowedTones.has(tone))) {
      throw new Error(`Invalid tone tags for ${rowIdentity}.`);
    }
    if (!allowedPacing.has(row.pacing)) throw new Error(`Invalid pacing for ${rowIdentity}.`);
    classificationsByIdentity.set(rowIdentity, { row, artifact, artifactPath: artifactPaths[artifactIndex] });
  }
}
if (classificationsByIdentity.size !== 900) throw new Error(`Expected 900 classifications, found ${classificationsByIdentity.size}.`);

const providerEntries = Object.entries(providersCache.titles ?? {});
if (providerEntries.length !== 900 || new Set(providerEntries.map(([key]) => key)).size !== 900) {
  throw new Error(`Expected 900 provider-cache identities, found ${providerEntries.length}.`);
}
for (const [key] of providerEntries) {
  if (!expectedIdentities.has(key)) throw new Error(`Unexpected provider-cache identity ${key}.`);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const tmdbIds = unique(manifestTitles.map((title) => title.tmdbId));
const queueRows = await fetchInChunks(
  supabase,
  "tmdb_catalog_index",
  "media_type,tmdb_id,title_id,hydration_status",
  "tmdb_id",
  tmdbIds,
);
const queueByIdentity = new Map(queueRows.map((row) => [`${row.media_type}:${row.tmdb_id}`, row]));
const missingQueue = [...expectedIdentities].filter((key) => {
  const row = queueByIdentity.get(key);
  return !row?.title_id || row.hydration_status !== "hydrated";
});
if (missingQueue.length) throw new Error(`Missing hydrated queue rows: ${missingQueue.slice(0, 10).join(", ")}`);

const titleIds = [...expectedIdentities].map((key) => queueByIdentity.get(key).title_id);
const existingClassifications = await fetchInChunks(
  supabase,
  "title_editorial_classifications",
  "title_id,review_status",
  "title_id",
  titleIds,
);
if (existingClassifications.some((row) => row.review_status === "gold")) {
  throw new Error("The 900-title manifest overlaps a protected gold classification.");
}

const classificationPayload = [...expectedIdentities].map((key) => {
  const { row, artifact, artifactPath } = classificationsByIdentity.get(key);
  const confidence = confidenceFor(row);
  return {
    title_id: queueByIdentity.get(key).title_id,
    primary_subgenre: row.primary_subgenre,
    secondary_subgenre: row.secondary_subgenre ?? null,
    tone_tags: row.tone_tags,
    pacing: row.pacing,
    ontology_version: ontology.ontology_version,
    classifier_version: classifierVersion(artifact),
    confidence,
    source: "llm-assisted-editorial",
    review_status: "accepted",
    classified_at: artifact.generated_at ?? artifact.exported_at ?? manifest.generatedAt,
    source_payload: {
      manifest_run_id: manifest.runId,
      artifact: artifactPath,
      artifact_schema: artifact.schema_version,
      experiment_id: artifact.experiment_id ?? null,
      workflow: artifact.workflow ?? null,
      models: artifact.models ?? null,
      original_review_status: row.review_status,
      low_confidence_flag: row.review_status === "automated_low_confidence" || confidence < 0.75,
      field_sources: row.field_sources ?? null,
      rationale: row.rationale ?? null,
    },
  };
});

const availabilityPayload = [...expectedIdentities].map((key) => {
  const cached = providersCache.titles[key];
  const checkedAt = new Date(cached.checkedAt);
  if (Number.isNaN(checkedAt.getTime())) throw new Error(`Invalid checkedAt for ${key}.`);
  const expiresAt = new Date(checkedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const offers = new Map();
  for (const rawProvider of cached.providers ?? []) {
    const provider = normalizedProvider(rawProvider);
    const type = offerType(cached.availabilityType);
    const keyForOffer = `${providerKey(provider.providerName)}:${type}`;
    offers.set(keyForOffer, {
      provider_key: providerKey(provider.providerName),
      provider_name: provider.providerName,
      offer_type: type,
      service_slug: provider.serviceSlug,
    });
  }
  return {
    title_id: queueByIdentity.get(key).title_id,
    region: "US",
    checked_at: checkedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    offers: [...offers.values()],
  };
});

const summary = {
  mode: WRITE ? "write" : "dry-run",
  manifestTitles: expectedIdentities.size,
  classifications: classificationPayload.length,
  existingClassifications: existingClassifications.length,
  accepted: classificationPayload.filter((row) => row.review_status === "accepted").length,
  lowConfidenceFlags: classificationPayload.filter((row) => row.source_payload.low_confidence_flag).length,
  titlesWithProviders: availabilityPayload.filter((row) => row.offers.length > 0).length,
  titlesWithoutProviders: availabilityPayload.filter((row) => row.offers.length === 0).length,
  availabilityOffers: availabilityPayload.reduce((sum, row) => sum + row.offers.length, 0),
};

if (!WRITE) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const classificationResults = [];
for (const chunk of chunks(classificationPayload)) {
  const { data, error } = await supabase.rpc("publish_editorial_classifications", { payload: chunk });
  if (error) throw error;
  classificationResults.push(data);
}
const availabilityResults = [];
for (const chunk of chunks(availabilityPayload)) {
  const { data, error } = await supabase.rpc("replace_catalog_availability", { payload: chunk });
  if (error) throw error;
  availabilityResults.push(data);
}

console.log(JSON.stringify({
  ...summary,
  classificationResults,
  availabilityResults,
}, null, 2));
