import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArguments(argv) {
  const options = new Map();
  for (const argument of argv) {
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
  const absolutePath = path.resolve(repoRoot, target);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

const classificationIdentity = (value) => `${value.media_type}:${value.tmdb_id}`;
const manifestIdentity = (value) => `${value.mediaType}:${value.tmdbId}`;

function validateClassification(row, allowed, label, errors) {
  if (!allowed.subgenres.has(row.primary_subgenre)) {
    errors.push(`${label} has invalid primary_subgenre ${row.primary_subgenre}`);
  }
  if (row.secondary_subgenre !== null && row.secondary_subgenre !== undefined) {
    if (!allowed.subgenres.has(row.secondary_subgenre)) {
      errors.push(`${label} has invalid secondary_subgenre ${row.secondary_subgenre}`);
    }
    if (row.secondary_subgenre === row.primary_subgenre) {
      errors.push(`${label} repeats its primary_subgenre as secondary_subgenre`);
    }
  }
  if (!Array.isArray(row.tone_tags) || row.tone_tags.length < 2 || row.tone_tags.length > 3) {
    errors.push(`${label} must contain two or three tone_tags`);
  } else {
    if (new Set(row.tone_tags).size !== row.tone_tags.length) {
      errors.push(`${label} contains duplicate tone_tags`);
    }
    for (const tone of row.tone_tags) {
      if (!allowed.tones.has(tone)) errors.push(`${label} has invalid tone tag ${tone}`);
    }
  }
  if (!allowed.pacing.has(row.pacing)) errors.push(`${label} has invalid pacing ${row.pacing}`);
}

function validatePreviewTitle(title, allowed, errors) {
  const label = title.id || "preview title without id";
  validateClassification({
    primary_subgenre: title.primarySubgenre,
    secondary_subgenre: title.secondarySubgenre,
    tone_tags: title.toneTags,
    pacing: title.pacing,
  }, allowed, label, errors);
  if (typeof title.name !== "string" || !title.name.trim()) errors.push(`${label} has no name`);
  if (!Number.isInteger(title.year) || title.year < 1870) errors.push(`${label} has an invalid year`);
  if (typeof title.synopsis !== "string" || !title.synopsis.trim()) errors.push(`${label} has no synopsis`);
  if (!Array.isArray(title.genres) || !title.genres.length) errors.push(`${label} has no genres`);
  if (!Array.isArray(title.providers)) errors.push(`${label} providers must be an array`);
  if (typeof title.poster !== "string" || !title.poster.trim()) errors.push(`${label} has no poster`);
}

const options = parseArguments(process.argv.slice(2));
const manifestPath = options.get("manifest")?.[0];
const artifactPaths = options.get("artifact") ?? [];
const ontologyPath = options.get("ontology")?.[0] ?? "curation/ontology/v0.1.1/ontology.json";
const previewPath = options.get("preview")?.[0];
if (!manifestPath || !artifactPaths.length) {
  throw new Error(
    "Usage: node scripts/catalog/validate-local-catalog.mjs --manifest=<path> --artifact=<path> [--artifact=<path> ...] [--preview=<path>] [--ontology=<path>]",
  );
}

const [manifest, ontology, ...artifacts] = await Promise.all([
  readJson(manifestPath),
  readJson(ontologyPath),
  ...artifactPaths.map(readJson),
]);
const allowed = {
  subgenres: new Set(ontology.subgenre_families.flatMap((family) => family.terms.map((term) => term.id))),
  tones: new Set(ontology.tone_tags.map((tone) => tone.id)),
  pacing: new Set(ontology.pacing.map((pace) => pace.id)),
};
const errors = [];
const manifestTitles = manifest.batches.flatMap((batch) => batch.titles);
const manifestIdentities = manifestTitles.map(manifestIdentity);
const expectedIdentities = new Set(manifestIdentities);
if (manifest.titleCount !== manifestTitles.length) {
  errors.push(`Manifest declares ${manifest.titleCount} titles but contains ${manifestTitles.length}`);
}
if (expectedIdentities.size !== manifestTitles.length) errors.push("Manifest contains duplicate title identities");

const classifications = artifacts.flatMap((artifact) => artifact.classifications ?? []);
const classifiedIdentities = new Set();
for (const classification of classifications) {
  const identity = classificationIdentity(classification);
  if (classifiedIdentities.has(identity)) errors.push(`Duplicate classification ${identity}`);
  classifiedIdentities.add(identity);
  if (!expectedIdentities.has(identity)) errors.push(`Unexpected classification ${identity}`);
  validateClassification(classification, allowed, identity, errors);
}
for (const identity of expectedIdentities) {
  if (!classifiedIdentities.has(identity)) errors.push(`Missing classification ${identity}`);
}

let previewSummary;
if (previewPath) {
  const preview = await readJson(previewPath);
  const previewTitles = preview.titles ?? [];
  const previewIds = new Set();
  for (const title of previewTitles) {
    if (previewIds.has(title.id)) errors.push(`Duplicate preview title ${title.id}`);
    previewIds.add(title.id);
    validatePreviewTitle(title, allowed, errors);
  }
  if (preview.title_count !== previewTitles.length) {
    errors.push(`Preview declares ${preview.title_count} titles but contains ${previewTitles.length}`);
  }
  for (const identity of expectedIdentities) {
    if (!previewIds.has(`tmdb:${identity}`)) errors.push(`Preview is missing manifest title ${identity}`);
  }
  previewSummary = {
    titleCount: previewTitles.length,
    uniqueIds: previewIds.size,
    movies: previewTitles.filter((title) => title.kind === "Movie").length,
    series: previewTitles.filter((title) => title.kind === "Series").length,
    standUp: previewTitles.filter((title) => title.kind === "Stand-up").length,
    titlesWithProviders: previewTitles.filter((title) => title.providers.length > 0).length,
  };
}

if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join("\n- ")}`);
console.log(JSON.stringify({
  manifestTitles: manifestTitles.length,
  classifications: classifications.length,
  classificationArtifacts: artifactPaths.length,
  ontologyVersion: ontology.ontology_version,
  preview: previewSummary,
  status: "valid",
}, null, 2));
