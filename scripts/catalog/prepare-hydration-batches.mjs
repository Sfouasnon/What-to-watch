import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  buildHydrationBatches,
  mergeCandidatePools,
  normalizeDiscoverCandidate,
  selectDiversifiedCandidates,
  validateHydrationManifest,
} from "./lib/batch-selection.mjs";

const TMDB_TOKEN = process.env.TMDB_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TMDB_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("TMDB_TOKEN, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

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

function dateArgument(name, fallback) {
  const value = argument(name) ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`--${name} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

const TOTAL = integerArgument("total", 900, { min: 20, max: 5000 });
const BATCH_SIZE = integerArgument("batch-size", 100, { min: 10, max: 500 });
const MOVIE_PERCENT = integerArgument("movie-percent", 50, { min: 0, max: 100 });
const POOL_PAGES = integerArgument("pool-pages", 30, { min: 1, max: 100 });
const MINIMUM_VOTES = integerArgument("min-votes", 250, { min: 0, max: 1000000 });
const FROM_DATE = dateArgument("from-date", "1900-01-01");
const RUN_ID = argument("run-id") ?? `catalog-${TOTAL}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
const OUTPUT = path.resolve(argument("output") ?? `curation/batches/${RUN_ID}.json`);
const movieTarget = Math.round(TOTAL * MOVIE_PERCENT / 100);
const tvTarget = TOTAL - movieTarget;
const today = new Date().toISOString().slice(0, 10);
if (FROM_DATE > today) throw new Error("--from-date cannot be later than today.");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function tmdb(pathname, parameters, attempt = 0) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429 && attempt < 4) {
    await sleep(Math.max(1000, Number(response.headers.get("retry-after") ?? 1) * 1000));
    return tmdb(pathname, parameters, attempt + 1);
  }
  if (!response.ok) throw new Error(`TMDB ${response.status} for ${pathname}`);
  return response.json();
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

async function discoverPool(mediaType, sortBy) {
  const pages = Array.from({ length: POOL_PAGES }, (_, index) => index + 1);
  const responses = await mapConcurrent(pages, 4, (page) => tmdb(`/discover/${mediaType}`, {
    include_adult: false,
    ...(mediaType === "movie"
      ? { include_video: false, "primary_release_date.gte": FROM_DATE, "primary_release_date.lte": today }
      : { include_null_first_air_dates: false, "first_air_date.gte": FROM_DATE, "first_air_date.lte": today }),
    language: "en-US",
    page,
    sort_by: sortBy,
    "vote_count.gte": MINIMUM_VOTES,
  }));
  return responses.flatMap((response) => response.results ?? []).map((item) => normalizeDiscoverCandidate(item, mediaType, sortBy));
}

async function allRows(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

const [existingTitles, existingQueue, movieVotePool, moviePopularityPool, tvVotePool, tvPopularityPool] = await Promise.all([
  allRows("titles", "tmdb_media_type,tmdb_id"),
  allRows("tmdb_catalog_index", "media_type,tmdb_id"),
  discoverPool("movie", "vote_count.desc"),
  discoverPool("movie", "popularity.desc"),
  discoverPool("tv", "vote_count.desc"),
  discoverPool("tv", "popularity.desc"),
]);

const excludedIdentities = new Set([
  ...existingTitles.filter((row) => row.tmdb_id && row.tmdb_media_type).map((row) => `${row.tmdb_media_type}:${row.tmdb_id}`),
  ...existingQueue.map((row) => `${row.media_type}:${row.tmdb_id}`),
]);

const moviePool = mergeCandidatePools([movieVotePool, moviePopularityPool]);
const tvPool = mergeCandidatePools([tvVotePool, tvPopularityPool]);
const selectionOptions = {
  excludedIdentities,
  minimumVotes: MINIMUM_VOTES,
  minimumReleaseDate: FROM_DATE,
  maximumReleaseDate: today,
};
const movies = selectDiversifiedCandidates(moviePool, movieTarget, selectionOptions);
const television = selectDiversifiedCandidates(tvPool, tvTarget, selectionOptions);
const batches = buildHydrationBatches(movies, television, BATCH_SIZE);

const manifest = {
  schemaVersion: "catalog-hydration-manifest-v1",
  runId: RUN_ID,
  generatedAt: new Date().toISOString(),
  titleCount: TOTAL,
  movieCount: movies.length,
  tvCount: television.length,
  selector: {
    version: "tmdb-discover-diversified-v1",
    poolPagesPerSort: POOL_PAGES,
    minimumVotes: MINIMUM_VOTES,
    moviePercent: MOVIE_PERCENT,
    minimumReleaseDate: FROM_DATE,
    maximumReleaseDate: today,
    requiredEvidence: ["overview>=40", "release_date", "poster_path", "genre_ids"],
    excludedExistingIdentityCount: excludedIdentities.size,
  },
  batches,
};

const validationErrors = validateHydrationManifest(manifest);
if (validationErrors.length) throw new Error(`Manifest validation failed:\n${validationErrors.join("\n")}`);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({
  output: OUTPUT,
  runId: RUN_ID,
  titleCount: manifest.titleCount,
  movieCount: manifest.movieCount,
  tvCount: manifest.tvCount,
  batchCount: manifest.batches.length,
  batchSizes: manifest.batches.map((batch) => batch.titleCount),
  movieCandidatePool: moviePool.length,
  tvCandidatePool: tvPool.length,
  excludedExistingIdentityCount: excludedIdentities.size,
}, null, 2));
