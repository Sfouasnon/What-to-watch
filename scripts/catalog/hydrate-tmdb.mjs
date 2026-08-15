import { createClient } from "@supabase/supabase-js";

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

const LIMIT = integerArgument("limit", 100, { min: 1, max: 1000 });
const DELAY_MS = integerArgument("delay-ms", 75, { min: 0, max: 60000 });
const mediaTypeFilter = argument("media-type");
if (mediaTypeFilter && !["movie", "tv"].includes(mediaTypeFilter)) {
  throw new Error("--media-type must be movie or tv.");
}
const forcedContentType = argument("content-type");
if (forcedContentType && !["movie", "tv_series", "standup_special"].includes(forcedContentType)) {
  throw new Error("--content-type must be movie, tv_series, or standup_special.");
}
if (forcedContentType === "standup_special" && mediaTypeFilter !== "movie") {
  throw new Error("--content-type=standup_special requires --media-type=movie.");
}

class TmdbError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TmdbError";
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tmdb(path, attempt = 0) {
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: {
      Authorization: `Bearer ${TMDB_TOKEN}`,
      accept: "application/json",
    },
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

function dateOrNull(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;
}

function classificationFeatures(detail) {
  const crew = detail.credits?.crew ?? [];
  const keywords = detail.keywords?.keywords ?? detail.keywords?.results ?? [];
  return {
    directors: crew.filter((person) => person.job === "Director").map((person) => person.name),
    writers: [...new Set(
      crew
        .filter((person) => ["Writer", "Screenplay", "Teleplay", "Story"].includes(person.job))
        .map((person) => person.name),
    )],
    cinematographers: crew
      .filter((person) => person.job === "Director of Photography")
      .map((person) => person.name),
    principalCast: (detail.credits?.cast ?? []).slice(0, 6).map((person) => person.name),
    keywords: keywords.slice(0, 15).map((keyword) => keyword.name),
  };
}

async function loadGenreMap() {
  const { data, error } = await supabase
    .from("genres")
    .select("id,display_name,tmdb_movie_genre_id,tmdb_tv_genre_id");
  if (error) throw error;

  const map = new Map();
  for (const genre of data ?? []) {
    if (genre.tmdb_movie_genre_id) {
      const key = `movie:${genre.tmdb_movie_genre_id}`;
      map.set(key, [...(map.get(key) ?? []), genre.id]);
    }
    if (genre.tmdb_tv_genre_id) {
      const key = `tv:${genre.tmdb_tv_genre_id}`;
      map.set(key, [...(map.get(key) ?? []), genre.id]);
    }
  }
  return map;
}

async function hydrateIndexRow(row, genreMap) {
  const mediaType = row.media_type;
  const append = "credits,keywords,external_ids";
  const detail = await tmdb(`/${mediaType}/${row.tmdb_id}?language=en-US&append_to_response=${append}`);
  const features = classificationFeatures(detail);

  const titleRow = {
    tmdb_id: row.tmdb_id,
    tmdb_media_type: mediaType,
    content_type: forcedContentType ?? (mediaType === "movie" ? "movie" : "tv_series"),
    name: mediaType === "movie" ? detail.title : detail.name,
    original_name: mediaType === "movie" ? detail.original_title : detail.original_name,
    overview: detail.overview || null,
    release_date: dateOrNull(mediaType === "movie" ? detail.release_date : detail.first_air_date),
    runtime_minutes: mediaType === "movie" && detail.runtime > 0 ? detail.runtime : null,
    episode_runtime_minutes: mediaType === "tv" && detail.episode_run_time?.[0] > 0 ? detail.episode_run_time[0] : null,
    season_count: mediaType === "tv" ? detail.number_of_seasons ?? null : null,
    episode_count: mediaType === "tv" ? detail.number_of_episodes ?? null : null,
    original_language: detail.original_language || null,
    production_countries: mediaType === "movie"
      ? (detail.production_countries ?? []).map((country) => country.iso_3166_1)
      : detail.origin_country ?? [],
    poster_path: detail.poster_path || null,
    backdrop_path: detail.backdrop_path || null,
    popularity: detail.popularity ?? null,
    vote_average: detail.vote_average ?? null,
    vote_count: detail.vote_count ?? null,
    external_ids: detail.external_ids ?? {},
    metadata_source: "tmdb",
    metadata_checked_at: new Date().toISOString(),
  };

  const { data: title, error: titleError } = await supabase
    .from("titles")
    .upsert(titleRow, { onConflict: "tmdb_media_type,tmdb_id" })
    .select("id")
    .single();
  if (titleError) throw titleError;

  const { data: existingInput, error: existingInputError } = await supabase
    .from("title_classification_inputs")
    .select("raw_payload")
    .eq("title_id", title.id)
    .maybeSingle();
  if (existingInputError) throw existingInputError;
  const existingRawPayload = existingInput?.raw_payload && typeof existingInput.raw_payload === "object" && !Array.isArray(existingInput.raw_payload)
    ? existingInput.raw_payload
    : {};

  const inputRow = {
    title_id: title.id,
    overview: detail.overview || null,
    tmdb_genres: (detail.genres ?? []).map((genre) => genre.name),
    directors: features.directors,
    writers: features.writers,
    cinematographers: features.cinematographers,
    principal_cast: features.principalCast,
    keywords: features.keywords,
    source: "tmdb",
    metadata_version: "tmdb-classification-input-v1",
    captured_at: new Date().toISOString(),
    raw_payload: {
      ...existingRawPayload,
      tmdb_id: row.tmdb_id,
      media_type: mediaType,
      original_language: detail.original_language ?? null,
      origin_country: mediaType === "movie"
        ? (detail.production_countries ?? []).map((country) => country.iso_3166_1)
        : detail.origin_country ?? [],
      popularity: detail.popularity ?? null,
      vote_average: detail.vote_average ?? null,
      vote_count: detail.vote_count ?? null,
    },
  };

  // Classification evidence is append-only through this general hydrator.
  // In particular, it must never refresh the frozen input packet behind a gold
  // classification. A later, explicitly versioned evidence migration can copy
  // or supersede these packets without weakening the gold benchmark.
  if (!existingInput) {
    const { error: inputError } = await supabase
      .from("title_classification_inputs")
      .insert(inputRow);
    if (inputError) throw inputError;
  }

  const genreRows = [];
  for (const tmdbGenre of detail.genres ?? []) {
    for (const genreId of genreMap.get(`${mediaType}:${tmdbGenre.id}`) ?? []) {
      genreRows.push({ title_id: title.id, genre_id: genreId, is_primary: false, confidence: 1 });
    }
  }
  if (genreRows.length) {
    const { error: genreError } = await supabase
      .from("title_genres")
      .upsert(genreRows, { onConflict: "title_id,genre_id", ignoreDuplicates: true });
    if (genreError) throw genreError;
  }

  const { error: queueError } = await supabase
    .from("tmdb_catalog_index")
    .update({
      hydration_status: "hydrated",
      title_id: title.id,
      hydrated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("media_type", mediaType)
    .eq("tmdb_id", row.tmdb_id);
  if (queueError) throw queueError;

  return titleRow.name;
}

// Recover jobs left in-flight by an interrupted process.
const staleCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
await supabase
  .from("tmdb_catalog_index")
  .update({ hydration_status: "error", last_error: "stale_hydration_recovered" })
  .eq("hydration_status", "hydrating")
  .lt("updated_at", staleCutoff);

let queueQuery = supabase
  .from("tmdb_catalog_index")
  .select("media_type,tmdb_id,popularity,hydration_attempts")
  .eq("is_active", true)
  .eq("adult", false)
  .in("hydration_status", ["pending", "error"])
  .lt("hydration_attempts", 5)
  .order("popularity", { ascending: false, nullsFirst: false })
  .limit(LIMIT);

if (mediaTypeFilter) queueQuery = queueQuery.eq("media_type", mediaTypeFilter);

const { data: queue, error: queueError } = await queueQuery;
if (queueError) throw queueError;
if (!queue?.length) {
  console.log("No TMDB catalog rows are currently eligible for hydration.");
  process.exit(0);
}

const genreMap = await loadGenreMap();
let hydrated = 0;
let failed = 0;
let skipped = 0;

for (const [index, row] of queue.entries()) {
  const attempts = (row.hydration_attempts ?? 0) + 1;
  await supabase
    .from("tmdb_catalog_index")
    .update({ hydration_status: "hydrating", hydration_attempts: attempts, last_error: null })
    .eq("media_type", row.media_type)
    .eq("tmdb_id", row.tmdb_id);

  try {
    const name = await hydrateIndexRow(row, genreMap);
    hydrated += 1;
    console.log(`[${index + 1}/${queue.length}] hydrated ${row.media_type}:${row.tmdb_id} ${name}`);
  } catch (error) {
    const status = error instanceof TmdbError && error.status === 404 ? "skipped" : "error";
    if (status === "skipped") skipped += 1;
    else failed += 1;

    await supabase
      .from("tmdb_catalog_index")
      .update({ hydration_status: status, last_error: String(error?.message ?? error).slice(0, 1000) })
      .eq("media_type", row.media_type)
      .eq("tmdb_id", row.tmdb_id);

    console.error(`[${index + 1}/${queue.length}] ${status} ${row.media_type}:${row.tmdb_id}:`, error?.message ?? error);
    if (error instanceof TmdbError && [401, 403].includes(error.status)) throw error;
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

console.log(`Hydration complete: ${hydrated} hydrated, ${skipped} skipped, ${failed} failed.`);
