import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { normalizeDiscoverCandidate } from "./lib/batch-selection.mjs";

const TMDB_TOKEN = process.env.TMDB_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!TMDB_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("TMDB_TOKEN, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required.");
}

function integerArgument(name, fallback, minimum, maximum) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const TARGET = integerArgument("total", 100, 1, 300);
const PAGE_LIMIT = integerArgument("pages", 10, 1, 25);
const STANDUP_KEYWORD_ID = 9716;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exclusionsPath = path.join(repoRoot, "curation/reference/not-standup-specials.json");
const exclusions = JSON.parse(await readFile(exclusionsPath, "utf8"));
const excludedTmdbIds = new Set((exclusions.titles ?? []).map((title) => title.tmdbId));
const allowExisting = hasFlag("allow-existing");
const generatedAt = new Date().toISOString();
const date = generatedAt.slice(0, 10).replaceAll("-", "");
const outputPath = path.join(repoRoot, `curation/batches/standup-${TARGET}-${date}.json`);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function tmdb(pathname) {
  const response = await fetch(`https://api.themoviedb.org/3${pathname}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`TMDB ${response.status} for ${pathname}.`);
  return response.json();
}

const pages = [];
for (let page = 1; page <= PAGE_LIMIT; page += 1) {
  const query = new URLSearchParams({
    language: "en-US",
    include_adult: "false",
    include_video: "false",
    sort_by: "vote_count.desc",
    with_keywords: String(STANDUP_KEYWORD_ID),
    page: String(page),
  });
  pages.push(await tmdb(`/discover/movie?${query}`));
}

const discovered = pages
  .flatMap((page) => page.results ?? [])
  .map((movie) => normalizeDiscoverCandidate(movie, "movie", `tmdb-keyword:${STANDUP_KEYWORD_ID}`))
  .filter((movie) => movie.releaseDate && movie.posterPath && movie.overview.length >= 30 && movie.voteCount > 0)
  .filter((movie) => !excludedTmdbIds.has(movie.tmdbId));
const discoveredIds = [...new Set(discovered.map((movie) => movie.tmdbId))];

const existingIds = new Set();
for (let index = 0; index < discoveredIds.length; index += 100) {
  const ids = discoveredIds.slice(index, index + 100);
  const [{ data: titles, error: titleError }, { data: indexRows, error: indexError }] = await Promise.all([
    supabase.from("titles").select("tmdb_id").eq("tmdb_media_type", "movie").in("tmdb_id", ids),
    supabase.from("tmdb_catalog_index").select("tmdb_id").eq("media_type", "movie").in("tmdb_id", ids),
  ]);
  if (titleError || indexError) throw titleError ?? indexError;
  for (const row of [...(titles ?? []), ...(indexRows ?? [])]) existingIds.add(row.tmdb_id);
}

const selected = discovered
  .filter((movie) => allowExisting || !existingIds.has(movie.tmdbId))
  .sort((a, b) => b.voteCount - a.voteCount || b.voteAverage - a.voteAverage || b.popularity - a.popularity || a.tmdbId - b.tmdbId)
  .slice(0, TARGET)
  .map((movie, index) => ({ ...movie, selectionRank: index + 1, selectionScore: movie.voteCount }));

if (selected.length !== TARGET) {
  throw new Error(`Only ${selected.length} eligible new stand-up specials were found for target ${TARGET}.`);
}

const manifest = {
  schemaVersion: "catalog-hydration-manifest-v1",
  generatedAt,
  runId: `standup-${TARGET}-${date}`,
  titleCount: selected.length,
  movieCount: selected.length,
  tvCount: 0,
  selector: {
    source: "TMDB Discover",
    tmdbKeywordId: STANDUP_KEYWORD_ID,
    tmdbKeyword: "stand-up comedy",
    sort: "vote_count.desc",
    pagesScanned: PAGE_LIMIT,
    excludesExistingTitlesAndIndexRows: !allowExisting,
    explicitExclusionCount: excludedTmdbIds.size,
  },
  batches: [{ batchNumber: 1, titleCount: selected.length, movieCount: selected.length, tvCount: 0, titles: selected }],
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, runId: manifest.runId, selected: selected.length, discovered: discovered.length, excludedExisting: existingIds.size }, null, 2));
