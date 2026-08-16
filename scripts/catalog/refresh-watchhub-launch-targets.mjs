import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bestWatchHubStream,
  isSupportedLaunchProvider,
  normalizeWatchHubProvider,
  targetsFromWatchHubStream,
} from "./lib/watchhub-launch-targets.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const WRITE = process.argv.includes("--write");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const options = new Map(process.argv.slice(2).filter((argument) => argument !== "--write").map((argument) => {
  if (!argument.startsWith("--") || !argument.includes("=")) throw new Error(`Expected --name=value, received ${argument}`);
  const separator = argument.indexOf("=");
  return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
const asInteger = (name, fallback, minimum, maximum) => {
  const value = Number(options.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
};
const region = (options.get("region") ?? "US").toUpperCase();
if (region !== "US") throw new Error("WatchHub launch-target probing is currently limited to --region=US.");
const limit = asInteger("limit", 10, 1, 250);
const offset = asInteger("offset", 0, 0, 1_000_000);
const concurrency = asInteger("concurrency", 2, 1, 4);
const requestSpacingMs = asInteger("request-spacing-ms", 300, 100, 5_000);
const ttlDays = asInteger("ttl-days", 7, 1, 30);
const manifestPath = options.get("manifest") ?? null;
const tmdbIdentity = options.get("tmdb") ?? null;
if (tmdbIdentity && !/^movie:\d+$/.test(tmdbIdentity)) {
  throw new Error("--tmdb currently supports movie:<id>.");
}
const WATCHHUB_BASE = "https://watchhub.strem.io/stream";
const SOURCE = "watchhub";
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function identity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function manifestIdentity(value) {
  return `${value.mediaType}:${value.tmdbId}`;
}

async function fetchManifestTitleIds(supabase, targetManifestPath) {
  const manifest = JSON.parse(await readFile(path.resolve(repoRoot, targetManifestPath), "utf8"));
  const manifestTitles = manifest.batches?.flatMap((batch) => batch.titles ?? []) ?? [];
  const expected = new Set(manifestTitles.map(manifestIdentity));
  if (
    !Number.isInteger(manifest.titleCount) || manifest.titleCount < 1 ||
    manifestTitles.length !== manifest.titleCount || expected.size !== manifest.titleCount
  ) {
    throw new Error(
      `Manifest title count mismatch: declared ${manifest.titleCount}, rows ${manifestTitles.length}, unique identities ${expected.size}.`,
    );
  }

  const queueRows = [];
  for (const chunk of chunks([...new Set(manifestTitles.map((title) => title.tmdbId))], 150)) {
    const { data, error } = await supabase
      .from("tmdb_catalog_index")
      .select("media_type,tmdb_id,title_id,hydration_status")
      .in("tmdb_id", chunk);
    if (error) throw error;
    queueRows.push(...(data ?? []).filter((row) => expected.has(identity(row))));
  }
  const queueByIdentity = new Map(queueRows.map((row) => [identity(row), row]));
  const incomplete = [...expected].filter((key) => {
    const row = queueByIdentity.get(key);
    return !row?.title_id || row.hydration_status !== "hydrated";
  });
  if (incomplete.length) throw new Error(`Manifest has incomplete hydration rows: ${incomplete.slice(0, 10).join(", ")}`);
  return [...expected].map((key) => queueByIdentity.get(key).title_id);
}

async function fetchPublishedTitleIds(supabase) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from("title_editorial_classifications")
      .select("title_id")
      .in("review_status", ["gold", "accepted"])
      .order("title_id")
      .range(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 500) return rows.map((row) => row.title_id);
  }
}

async function fetchTitles(supabase, titleIds) {
  const rows = [];
  for (const chunk of chunks(titleIds, 150)) {
    const { data, error } = await supabase
      .from("titles")
      .select("id,tmdb_id,tmdb_media_type,content_type,name,external_ids")
      .in("id", chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows.sort((a, b) => a.tmdb_media_type.localeCompare(b.tmdb_media_type) || a.tmdb_id - b.tmdb_id);
}

async function fetchOffers(supabase, titleIds) {
  const rows = [];
  for (const chunk of chunks(titleIds, 150)) {
    const { data, error } = await supabase
      .from("availability_offers")
      .select("id,title_id,provider_key,provider_name,offer_type,expires_at")
      .in("title_id", chunk)
      .eq("region", region)
      .gt("expires_at", new Date().toISOString());
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

function imdbId(title) {
  const value = title.external_ids?.imdb_id;
  return typeof value === "string" && /^tt\d{7,10}$/.test(value) ? value : null;
}

async function requestWatchHub(title) {
  const imdb = imdbId(title);
  if (!imdb) throw new Error("MISSING_IMDB_ID");
  const endpoint = `${WATCHHUB_BASE}/movie/${encodeURIComponent(imdb)}.json`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 750 * 2 ** attempt);
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || !Array.isArray(payload.streams)) throw new Error(`WATCHHUB_${response.status}`);
      return { title, endpoint, checkedAt: new Date().toISOString(), streams: payload.streams };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await pause(750 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("WATCHHUB_LOOKUP_FAILED");
}

async function mapConcurrent(values, workerCount, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(workerCount, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await mapper(values[index]) };
      } catch (error) {
        results[index] = { ok: false, value: values[index], error };
      }
      await pause(requestSpacingMs);
    }
  }));
  return results;
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const titleIds = manifestPath
  ? await fetchManifestTitleIds(supabase, manifestPath)
  : await fetchPublishedTitleIds(supabase);
const allTitles = await fetchTitles(supabase, titleIds);
const eligibleTitles = allTitles.filter((title) => title.tmdb_media_type === "movie" && imdbId(title));
const selected = tmdbIdentity
  ? eligibleTitles.filter((title) => `${title.tmdb_media_type}:${title.tmdb_id}` === tmdbIdentity)
  : eligibleTitles.slice(offset, offset + limit);
if (!selected.length) throw new Error(`No IMDb-addressable movie titles at offset ${offset}.`);

const offers = await fetchOffers(supabase, selected.map((title) => title.id));
const supportedOffers = offers.filter((offer) => isSupportedLaunchProvider(offer.provider_key));
const offersByTitle = new Map();
for (const offer of supportedOffers) {
  offersByTitle.set(offer.title_id, [...(offersByTitle.get(offer.title_id) ?? []), offer]);
}

const results = await mapConcurrent(selected, concurrency, requestWatchHub);
const successful = results.filter((result) => result.ok).map((result) => result.value);
const failed = results.filter((result) => !result.ok);
const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1_000).toISOString();
const payload = [];
const unmatchedProviders = new Set();
let matchedStreams = 0;
let exactTargets = 0;

for (const result of successful) {
  const titleOffers = offersByTitle.get(result.title.id) ?? [];
  const matchedKeys = new Set();
  for (const offer of titleOffers) {
    const stream = bestWatchHubStream(result.streams, offer.provider_key);
    const targets = stream ? targetsFromWatchHubStream(stream) : [];
    if (stream) {
      matchedStreams += 1;
      matchedKeys.add(offer.provider_key);
      exactTargets += targets.filter((target) => target.content_specific).length;
    }
    payload.push({
      availability_offer_id: offer.id,
      external_source: SOURCE,
      observed_at: result.checkedAt,
      expires_at: expiresAt,
      targets,
    });
  }
  for (const stream of result.streams) {
    const normalized = normalizeWatchHubProvider(stream?.name);
    if (normalized && isSupportedLaunchProvider(normalized.providerKey) && !matchedKeys.has(normalized.providerKey)) {
      unmatchedProviders.add(`${result.title.name}:${normalized.providerName}`);
    }
  }
}

if (WRITE && payload.length) {
  for (const chunk of chunks(payload, 100)) {
    const { error } = await supabase.rpc("replace_offer_launch_targets", { payload: chunk });
    if (error) throw error;
  }
}

console.log(JSON.stringify({
  mode: WRITE ? "write" : "dry-run",
  source: SOURCE,
  scope: manifestPath ? "manifest" : "published-catalog",
  manifest: manifestPath,
  tmdb: tmdbIdentity,
  publishedTitles: allTitles.length,
  eligibleMovieTitles: eligibleTitles.length,
  skippedSeriesTitles: allTitles.filter((title) => title.tmdb_media_type === "tv").length,
  skippedMissingImdb: allTitles.filter((title) => title.tmdb_media_type === "movie" && !imdbId(title)).length,
  offset,
  requested: selected.length,
  succeeded: successful.length,
  failed: failed.length,
  currentSupportedOffers: supportedOffers.length,
  matchedOfferStreams: matchedStreams,
  offerTargetSets: payload.length,
  targets: payload.reduce((sum, item) => sum + item.targets.length, 0),
  exactTargets,
  unmatchedProviders: [...unmatchedProviders].slice(0, 25),
  nextOffset: !tmdbIdentity && offset + selected.length < eligibleTitles.length ? offset + selected.length : null,
  failures: failed.slice(0, 10).map((result) => ({
    title: result.value.name,
    tmdbId: result.value.tmdb_id,
    imdbId: imdbId(result.value),
    error: result.error instanceof Error ? result.error.message : String(result.error),
  })),
}, null, 2));

if (failed.length) process.exitCode = 1;
