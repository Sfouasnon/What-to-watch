import { createClient } from "@supabase/supabase-js";

import { buildCastContext } from "./lib/cast-context.mjs";

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
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be between ${min} and ${max}.`);
  return value;
}

const LIMIT = integerArgument("limit", 100, { min: 1, max: 100 });
const CAST_LIMIT = integerArgument("cast-limit", 6, { min: 1, max: 10 });
const REFERENCE_LIMIT = integerArgument("reference-limit", 8, { min: 1, max: 20 });
const CONCURRENCY = integerArgument("concurrency", 5, { min: 1, max: 10 });
const WRITE = process.argv.includes("--write");
const CHECKED_AT = new Date().toISOString();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function tmdb(path, attempt = 0) {
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429 && attempt < 4) {
    await sleep(Math.max(1000, Number(response.headers.get("retry-after") ?? 1) * 1000));
    return tmdb(path, attempt + 1);
  }
  if (!response.ok) throw new Error(`TMDB ${response.status} for ${path}`);
  return response.json();
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

const { data: classifications, error: classificationError } = await supabase
  .from("title_editorial_classifications")
  .select("title_id")
  .eq("review_status", "gold")
  .order("title_id")
  .limit(LIMIT);
if (classificationError) throw classificationError;

const titleIds = (classifications ?? []).map((row) => row.title_id);
const { data: titles, error: titleError } = await supabase
  .from("titles")
  .select("id,tmdb_id,tmdb_media_type,name")
  .in("id", titleIds);
if (titleError) throw titleError;

const selectedTitles = (titles ?? []).filter((title) => title.tmdb_id && (title.tmdb_media_type === "movie" || title.tmdb_media_type === "tv"));
const castByTitleId = new Map();

await mapConcurrent(selectedTitles, async (title) => {
  const payload = await tmdb(`/${title.tmdb_media_type}/${title.tmdb_id}/credits?language=en-US`);
  castByTitleId.set(title.id, (payload.cast ?? []).slice(0, CAST_LIMIT));
});

const people = new Map();
for (const cast of castByTitleId.values()) {
  for (const person of cast) people.set(Number(person.id), person);
}
const combinedCreditsByPerson = new Map();
await mapConcurrent([...people.values()], async (person) => {
  const payload = await tmdb(`/person/${person.id}/combined_credits?language=en-US`);
  combinedCreditsByPerson.set(Number(person.id), payload.cast ?? []);
});

const updates = selectedTitles.map((title) => {
  const castContext = buildCastContext(castByTitleId.get(title.id), combinedCreditsByPerson, {
    currentTmdbId: title.tmdb_id,
    currentMediaType: title.tmdb_media_type,
    castLimit: CAST_LIMIT,
    referenceLimit: REFERENCE_LIMIT,
  });
  return {
    title_id: title.id,
    source: "tmdb",
    cache_version: "tmdb-combined-credits-v1",
    checked_at: CHECKED_AT,
    cast_context: castContext,
    updated_at: CHECKED_AT,
  };
});

if (WRITE) {
  await mapConcurrent(updates, async (update) => {
    const { error } = await supabase
      .from("title_cast_context_cache")
      .upsert(update, { onConflict: "title_id" });
    if (error) throw error;
  });
}

console.log(JSON.stringify({
  mode: WRITE ? "write" : "dry-run",
  titleCount: updates.length,
  uniquePeople: people.size,
  titlesWithCastContext: updates.filter((update) => update.cast_context.length > 0).length,
  checkedAt: CHECKED_AT,
}, null, 2));
