// Hydrates the 100-title gold pilot with factual TMDB metadata and artwork.
//
// The gold set was seeded from `curation/pilot/sample-100.json`, which carries
// enough evidence to classify a title but none of the presentation metadata:
// no artwork, no release dates, no season/episode counts, no external ids, and
// no normalized credits. This script fills those gaps from live TMDB detail
// payloads.
//
// Two invariants are enforced at runtime rather than assumed:
//
//   1. Editorial classifications are never written. The script snapshots
//      `title_editorial_classifications` for the gold titles before it starts
//      and re-compares afterwards, failing loudly on any drift.
//   2. `title_classification_inputs` is never rewritten. That packet is the
//      frozen evidence the gold labels were derived from -- refreshing it would
//      silently change the provenance of the benchmark (and would discard the
//      sampled provider payload the app reads).
//
// Usage:
//   node scripts/catalog/hydrate-gold-100.mjs [--limit=100] [--delay-ms=75]
//                                             [--media-type=movie|tv] [--dry-run]

import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  EDITORIAL_TABLES,
  factualTitleFields,
  genreLookupKey,
  mergePreservingExisting,
  normalizeCredits,
} from "./lib/tmdb-mapping.mjs";

const TMDB_TOKEN = process.env.TMDB_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TMDB_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("TMDB_TOKEN, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function integerArgument(name, fallback, { min, max }) {
  const raw = argument(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const LIMIT = integerArgument("limit", 100, { min: 1, max: 100 });
const DELAY_MS = integerArgument("delay-ms", 75, { min: 0, max: 60000 });
const DRY_RUN = process.argv.includes("--dry-run");
const mediaTypeFilter = argument("media-type");
if (mediaTypeFilter && !["movie", "tv"].includes(mediaTypeFilter)) {
  throw new Error("--media-type must be movie or tv.");
}

class TmdbError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TmdbError";
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const identity = (mediaType, tmdbId) => `${mediaType}:${tmdbId}`;

async function tmdb(path, attempt = 0) {
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
  });

  if (response.status === 429 && attempt < 4) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 1);
    await sleep(Math.max(1000, retryAfter * 1000));
    return tmdb(path, attempt + 1);
  }

  if (!response.ok) {
    throw new TmdbError(response.status, `TMDB ${response.status} for ${path}`);
  }

  return response.json();
}

const readJson = (relativePath) => JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
const sample = readJson("../../curation/pilot/sample-100.json");

if (sample.title_count !== 100 || sample.titles.length !== 100) {
  throw new Error("Pilot sample must contain exactly 100 titles.");
}

const goldIdentities = sample.titles
  .map((title) => ({ media_type: title.media_type, tmdb_id: title.tmdb_id }))
  .filter((title) => !mediaTypeFilter || title.media_type === mediaTypeFilter);

// --- Resolve the persisted gold rows -----------------------------------------

const persistedByIdentity = new Map();
for (const mediaType of ["movie", "tv"]) {
  const ids = sample.titles.filter((title) => title.media_type === mediaType).map((title) => title.tmdb_id);
  if (!ids.length) continue;
  const { data, error } = await supabase
    .from("titles")
    .select(
      "id,tmdb_id,tmdb_media_type,overview,release_date,end_date,runtime_minutes,episode_runtime_minutes,season_count,episode_count,original_language,poster_path,backdrop_path",
    )
    .eq("tmdb_media_type", mediaType)
    .in("tmdb_id", ids);
  if (error) throw error;
  for (const row of data ?? []) persistedByIdentity.set(identity(row.tmdb_media_type, row.tmdb_id), row);
}

if (persistedByIdentity.size !== 100) {
  throw new Error(
    `Expected 100 persisted gold titles, found ${persistedByIdentity.size}. Run \`npm run catalog:seed-gold\` first.`,
  );
}

const goldTitleIds = [...persistedByIdentity.values()].map((row) => row.id);

// --- Snapshot the editorial layer so drift cannot pass silently ---------------

const EDITORIAL_SNAPSHOT_COLUMNS =
  "title_id,primary_subgenre,secondary_subgenre,tone_tags,pacing,ontology_version,classifier_version,confidence,source,review_status,classified_at";

async function editorialSnapshot() {
  const { data, error } = await supabase
    .from("title_editorial_classifications")
    .select(EDITORIAL_SNAPSHOT_COLUMNS)
    .in("title_id", goldTitleIds)
    .order("title_id", { ascending: true });
  if (error) throw error;
  return JSON.stringify(data ?? []);
}

const editorialBefore = await editorialSnapshot();
const editorialRowCount = JSON.parse(editorialBefore).length;
if (editorialRowCount !== 100) {
  throw new Error(`Expected 100 gold editorial classifications, found ${editorialRowCount}.`);
}

// --- Genre lookup -------------------------------------------------------------

const MISSING_GRANT_HINT =
  "Apply supabase/migrations/0005_catalog_hydration_grants.sql -- service_role needs object grants on the factual catalog tables.";

function rethrowWithGrantHint(error, table) {
  if (!error) return;
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) {
    throw new Error(`Permission denied on ${table}. ${MISSING_GRANT_HINT}`);
  }
  throw error;
}

const { data: genreRows, error: genreLookupError } = await supabase
  .from("genres")
  .select("id,tmdb_movie_genre_id,tmdb_tv_genre_id");
rethrowWithGrantHint(genreLookupError, "genres");

const genreMap = new Map();
for (const genre of genreRows ?? []) {
  if (genre.tmdb_movie_genre_id) {
    const key = genreLookupKey("movie", genre.tmdb_movie_genre_id);
    genreMap.set(key, [...(genreMap.get(key) ?? []), genre.id]);
  }
  if (genre.tmdb_tv_genre_id) {
    const key = genreLookupKey("tv", genre.tmdb_tv_genre_id);
    genreMap.set(key, [...(genreMap.get(key) ?? []), genre.id]);
  }
}

// --- Hydration ----------------------------------------------------------------

async function upsertPeople(people) {
  if (!people.length) return new Map();
  const { data, error } = await supabase
    .from("people")
    .upsert(people, { onConflict: "tmdb_id" })
    .select("id,tmdb_id");
  rethrowWithGrantHint(error, "people");
  return new Map((data ?? []).map((person) => [person.tmdb_id, person.id]));
}

async function replaceCredits(titleId, credits, personIdByTmdbId) {
  const { error: deleteError } = await supabase.from("title_credits").delete().eq("title_id", titleId);
  rethrowWithGrantHint(deleteError, "title_credits");

  const rows = credits
    .map((credit) => ({
      title_id: titleId,
      person_id: personIdByTmdbId.get(credit.person_tmdb_id),
      department: credit.department,
      job: credit.job,
      character_name: credit.character_name,
      billing_order: credit.billing_order,
      credited: true,
    }))
    .filter((row) => Boolean(row.person_id));

  if (!rows.length) return 0;
  const { error } = await supabase.from("title_credits").insert(rows);
  rethrowWithGrantHint(error, "title_credits");
  return rows.length;
}

async function refreshGenres(titleId, mediaType, detailGenres) {
  const rows = [];
  for (const tmdbGenre of detailGenres ?? []) {
    for (const genreId of genreMap.get(genreLookupKey(mediaType, tmdbGenre.id)) ?? []) {
      rows.push({ title_id: titleId, genre_id: genreId, is_primary: false, confidence: 1 });
    }
  }
  if (!rows.length) return 0;
  const { error } = await supabase
    .from("title_genres")
    .upsert(rows, { onConflict: "title_id,genre_id", ignoreDuplicates: true });
  rethrowWithGrantHint(error, "title_genres");
  return rows.length;
}

async function hydrateGoldTitle(target) {
  const { media_type: mediaType, tmdb_id: tmdbId } = target;
  const persisted = persistedByIdentity.get(identity(mediaType, tmdbId));
  const detail = await tmdb(
    `/${mediaType}/${tmdbId}?language=en-US&append_to_response=credits,external_ids`,
  );

  const fresh = factualTitleFields(detail, mediaType);
  const patch = mergePreservingExisting(fresh, persisted);
  const { people, credits } = normalizeCredits(detail, mediaType);

  if (DRY_RUN) {
    return {
      name: fresh.name,
      artwork: Boolean(patch.poster_path ?? persisted.poster_path),
      credits: credits.length,
      people: people.length,
    };
  }

  const { error: titleError } = await supabase.from("titles").update(patch).eq("id", persisted.id);
  rethrowWithGrantHint(titleError, "titles");

  const personIdByTmdbId = await upsertPeople(people);
  const creditCount = await replaceCredits(persisted.id, credits, personIdByTmdbId);
  await refreshGenres(persisted.id, mediaType, detail.genres);

  return {
    name: fresh.name,
    artwork: Boolean(patch.poster_path ?? persisted.poster_path),
    credits: creditCount,
    people: people.length,
  };
}

const queue = goldIdentities.slice(0, LIMIT);
let hydrated = 0;
let failed = 0;
let missingArtwork = 0;
let totalCredits = 0;
const failures = [];

for (const [index, target] of queue.entries()) {
  try {
    const result = await hydrateGoldTitle(target);
    hydrated += 1;
    totalCredits += result.credits;
    if (!result.artwork) missingArtwork += 1;
    console.log(
      `[${index + 1}/${queue.length}] ${DRY_RUN ? "would hydrate" : "hydrated"} ` +
        `${target.media_type}:${target.tmdb_id} ${result.name} ` +
        `(${result.credits} credits${result.artwork ? "" : ", no poster"})`,
    );
  } catch (error) {
    failed += 1;
    failures.push(`${target.media_type}:${target.tmdb_id} ${error?.message ?? error}`);
    console.error(`[${index + 1}/${queue.length}] failed ${target.media_type}:${target.tmdb_id}:`, error?.message ?? error);
    if (error instanceof TmdbError && [401, 403].includes(error.status)) throw error;
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

// --- Verify the editorial layer is byte-identical ------------------------------

const editorialAfter = await editorialSnapshot();
if (editorialAfter !== editorialBefore) {
  throw new Error(
    `Gold editorial classifications changed during hydration. ${EDITORIAL_TABLES[0]} must never be written by this script.`,
  );
}

console.log(
  `\nHydration ${DRY_RUN ? "dry run " : ""}complete: ${hydrated} hydrated, ${failed} failed, ` +
    `${totalCredits} credits, ${missingArtwork} without a poster.`,
);
console.log(`Gold editorial classifications verified unchanged (${editorialRowCount} rows).`);

if (failures.length) {
  console.error(`\nFailures:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
