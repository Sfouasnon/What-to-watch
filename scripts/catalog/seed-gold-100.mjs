import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const readJson = (relativePath) => JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
const sample = readJson("../../curation/pilot/sample-100.json");
const gold = readJson("../../curation/pilot/pass2/final-classifications-v1.0-gold.json");
const corrections = readJson("../../curation/pilot/pass2/editorial-corrections-v1.1.json");
const ontology = readJson("../../curation/ontology/v0.1.1/ontology.json");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const identity = (mediaType, tmdbId) => `${mediaType}:${tmdbId}`;
const subgenres = new Set(ontology.subgenre_families.flatMap((family) => family.terms.map((term) => term.id)));
const tones = new Set(ontology.tone_tags.map((tone) => tone.id));
const pacingValues = new Set(["slow", "moderate", "fast"]);
const correctionByIdentity = new Map(corrections.corrections.map((item) => [identity(item.media_type, item.tmdb_id), item]));

function validateAssets() {
  if (sample.title_count !== 100 || sample.titles.length !== 100) throw new Error("Pilot sample must contain exactly 100 titles.");
  if (gold.title_count !== 100 || gold.classifications.length !== 100) throw new Error("Gold set must contain exactly 100 classifications.");
  if (gold.pending_human_review_field_count !== 0) throw new Error("Gold set still has pending human review fields.");
  if (gold.ontology_version !== ontology.ontology_version) throw new Error("Gold set and ontology versions do not match.");

  const sampleIdentities = new Set(sample.titles.map((title) => identity(title.media_type, title.tmdb_id)));
  for (const classification of gold.classifications) {
    const key = identity(classification.media_type, classification.tmdb_id);
    if (!sampleIdentities.has(key)) throw new Error(`Gold classification ${key} is missing from sample-100.`);
    if (!subgenres.has(classification.primary_subgenre.value)) throw new Error(`Unknown primary subgenre for ${key}.`);
    if (classification.secondary_subgenre.value && !subgenres.has(classification.secondary_subgenre.value)) throw new Error(`Unknown secondary subgenre for ${key}.`);
    const tags = classification.tone_tags.value ?? [];
    if (tags.length > 3 || tags.some((tag) => !tones.has(tag))) throw new Error(`Invalid tone tags for ${key}.`);
    if (classification.pacing.value && !pacingValues.has(classification.pacing.value)) throw new Error(`Invalid pacing for ${key}.`);
  }

  for (const correction of corrections.corrections) {
    if (!subgenres.has(correction.primary_subgenre.to)) throw new Error(`Unknown corrected primary subgenre for ${correction.title}.`);
    if (correction.secondary_subgenre.to && !subgenres.has(correction.secondary_subgenre.to)) throw new Error(`Unknown corrected secondary subgenre for ${correction.title}.`);
    if (correction.tone_tags?.value?.some((tag) => !tones.has(tag))) throw new Error(`Unknown corrected tone tag for ${correction.title}.`);
  }
}

validateAssets();

const titleRows = sample.titles.map((title) => ({
  tmdb_id: title.tmdb_id,
  tmdb_media_type: title.media_type,
  content_type: title.media_type === "movie" ? "movie" : "tv_series",
  name: title.title,
  original_name: title.original_title || null,
  overview: title.overview || null,
  runtime_minutes: title.media_type === "movie" && title.runtime > 0 ? title.runtime : null,
  episode_runtime_minutes: title.media_type === "tv" && title.runtime > 0 ? title.runtime : null,
  original_language: title.original_language || null,
  production_countries: title.origin_country ?? [],
  popularity: title.popularity ?? null,
  vote_average: title.vote_average ?? null,
  vote_count: title.vote_count ?? null,
  metadata_source: "tmdb-gold-pilot",
  metadata_checked_at: sample.generated_at,
}));

const { error: titleUpsertError } = await supabase
  .from("titles")
  .upsert(titleRows, { onConflict: "tmdb_media_type,tmdb_id" });
if (titleUpsertError) throw titleUpsertError;

const titleByIdentity = new Map();
for (const mediaType of ["movie", "tv"]) {
  const ids = sample.titles.filter((title) => title.media_type === mediaType).map((title) => title.tmdb_id);
  const { data, error } = await supabase
    .from("titles")
    .select("id,tmdb_id,tmdb_media_type")
    .eq("tmdb_media_type", mediaType)
    .in("tmdb_id", ids);
  if (error) throw error;
  for (const title of data ?? []) titleByIdentity.set(identity(title.tmdb_media_type, title.tmdb_id), title.id);
}

if (titleByIdentity.size !== 100) {
  throw new Error(`Expected 100 persisted gold titles, found ${titleByIdentity.size}.`);
}

const inputRows = sample.titles.map((title) => ({
  title_id: titleByIdentity.get(identity(title.media_type, title.tmdb_id)),
  overview: title.overview || null,
  tmdb_genres: title.tmdb_genres ?? [],
  directors: title.directors ?? [],
  writers: title.writers ?? [],
  cinematographers: title.cinematographers ?? [],
  principal_cast: title.principal_cast ?? [],
  keywords: title.keywords ?? [],
  source: "tmdb-gold-pilot",
  metadata_version: sample.schema_version,
  captured_at: sample.generated_at,
  raw_payload: {
    sampled_streaming_providers: title.sampled_streaming_providers ?? [],
    original_language: title.original_language ?? null,
    origin_country: title.origin_country ?? [],
    popularity: title.popularity ?? null,
    vote_average: title.vote_average ?? null,
    vote_count: title.vote_count ?? null,
  },
}));

const { error: inputError } = await supabase
  .from("title_classification_inputs")
  .upsert(inputRows, { onConflict: "title_id" });
if (inputError) throw inputError;

const classificationRows = gold.classifications.map((classification) => {
  const key = identity(classification.media_type, classification.tmdb_id);
  const correction = correctionByIdentity.get(key);
  return {
    title_id: titleByIdentity.get(key),
    primary_subgenre: correction?.primary_subgenre.to ?? classification.primary_subgenre.value,
    secondary_subgenre: correction
      ? correction.secondary_subgenre.to ?? null
      : classification.secondary_subgenre.value ?? null,
    tone_tags: correction?.tone_tags?.value ?? classification.tone_tags.value ?? [],
    pacing: classification.pacing.value ?? null,
    ontology_version: ontology.ontology_version,
    classifier_version: null,
    confidence: 1,
    source: correction?.source ?? "gold-v1.0",
    review_status: "gold",
    classified_at: gold.generated_at,
    source_payload: {
      base_gold_set: corrections.base_gold_set,
      primary_source: classification.primary_subgenre.source,
      secondary_source: classification.secondary_subgenre.source,
      tone_source: classification.tone_tags.source,
      pacing_source: classification.pacing.source,
      correction: correction ?? null,
    },
  };
});

const { error: classificationError } = await supabase
  .from("title_editorial_classifications")
  .upsert(classificationRows, { onConflict: "title_id" });
if (classificationError) throw classificationError;

const { data: genres, error: genresError } = await supabase.from("genres").select("id,display_name");
if (genresError) throw genresError;
const genreByName = new Map((genres ?? []).map((genre) => [genre.display_name.toLowerCase(), genre.id]));
const genreAliases = {
  "action & adventure": ["action", "adventure"],
  "sci-fi & fantasy": ["science fiction", "fantasy"],
  "war & politics": ["war"],
};

const titleGenreRows = [];
for (const title of sample.titles) {
  const titleId = titleByIdentity.get(identity(title.media_type, title.tmdb_id));
  for (const tmdbGenre of title.tmdb_genres ?? []) {
    const names = genreAliases[tmdbGenre.toLowerCase()] ?? [tmdbGenre.toLowerCase()];
    for (const name of names) {
      const genreId = genreByName.get(name);
      if (genreId) titleGenreRows.push({ title_id: titleId, genre_id: genreId, is_primary: false, confidence: 1 });
    }
  }
}

if (titleGenreRows.length) {
  const { error } = await supabase
    .from("title_genres")
    .upsert(titleGenreRows, { onConflict: "title_id,genre_id", ignoreDuplicates: true });
  if (error) throw error;
}

console.log(`Seeded ${titleByIdentity.size} gold titles, ${classificationRows.length} editorial classifications, and ${inputRows.length} classifier input packets.`);
