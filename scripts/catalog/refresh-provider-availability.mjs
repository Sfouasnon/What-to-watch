import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  databaseOfferType,
  normalizedProvider,
  providerKey,
} from "./lib/provider-normalization.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const TMDB_TOKEN = process.env.TMDB_TOKEN?.trim();
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TMDB_TOKEN) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and TMDB_TOKEN are required.");
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
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
};
const region = (options.get("region") ?? "US").toUpperCase();
if (!/^[A-Z]{2}$/.test(region)) throw new Error("--region must be a two-letter region.");
const limit = asInteger("limit", 100, 1, 10_000);
const offset = asInteger("offset", 0, 0, 1_000_000);
const concurrency = asInteger("concurrency", 2, 1, 6);
const ttlDays = asInteger("ttl-days", 14, 1, 60);
const requestSpacingMs = asInteger("request-spacing-ms", 200, 50, 5_000);
const manifestPath = options.get("manifest") ?? null;
const TMDB_BASE = "https://api.themoviedb.org/3";
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
  const tmdbIds = [...new Set(manifestTitles.map((title) => title.tmdbId))];
  for (const chunk of chunks(tmdbIds, 150)) {
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
      .select("id,tmdb_id,tmdb_media_type,name")
      .in("id", chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows
    .filter((row) => row.tmdb_id && (row.tmdb_media_type === "movie" || row.tmdb_media_type === "tv"))
    .sort((a, b) => a.tmdb_media_type.localeCompare(b.tmdb_media_type) || a.tmdb_id - b.tmdb_id);
}

async function requestProviders(title) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${TMDB_BASE}/${title.tmdb_media_type}/${title.tmdb_id}/watch/providers`, {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 750 * 2 ** attempt);
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(`TMDB_${response.status}`);
      const entry = payload.results?.[region];
      const groups = [
        ["subscription", entry?.flatrate ?? []],
        ["free", [...(entry?.free ?? []), ...(entry?.ads ?? [])]],
        ["rental", entry?.rent ?? []],
        ["purchase", entry?.buy ?? []],
      ];
      const offers = new Map();
      for (const [kind, providers] of groups) {
        for (const rawProvider of providers) {
          if (!rawProvider?.provider_name) continue;
          const provider = normalizedProvider(rawProvider.provider_name);
          const type = databaseOfferType(kind);
          const key = `${providerKey(provider.providerName)}:${type}`;
          offers.set(key, {
            provider_key: providerKey(provider.providerName),
            provider_name: provider.providerName,
            offer_type: type,
            service_slug: provider.serviceSlug,
          });
        }
      }
      return { title, checkedAt: new Date().toISOString(), sourceLink: entry?.link ?? null, offers: [...offers.values()] };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await pause(750 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("TMDB_PROVIDER_LOOKUP_FAILED");
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

async function recordRefreshState(supabase, stateRows) {
  for (const chunk of chunks(stateRows, 250)) {
    const { error } = await supabase.rpc("record_availability_refresh_state", { payload: chunk });
    if (error) throw error;
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const titleIds = manifestPath
  ? await fetchManifestTitleIds(supabase, manifestPath)
  : await fetchPublishedTitleIds(supabase);
const availableTitles = await fetchTitles(supabase, titleIds);
if (availableTitles.length !== titleIds.length) {
  throw new Error(`Expected ${titleIds.length} title rows, found ${availableTitles.length}.`);
}
if (WRITE && manifestPath) {
  const publishedIds = new Set(await fetchPublishedTitleIds(supabase));
  const unpublished = titleIds.filter((titleId) => !publishedIds.has(titleId));
  if (unpublished.length) {
    throw new Error(`Refusing provider write for ${unpublished.length} unpublished manifest titles.`);
  }
}
const selected = availableTitles.slice(offset, offset + limit);
if (!selected.length) throw new Error(`No published titles at offset ${offset}.`);
const results = await mapConcurrent(selected, concurrency, requestProviders);
const successful = results.filter((result) => result.ok).map((result) => result.value);
const failed = results.filter((result) => !result.ok);
const now = Date.now();
const expiresAt = new Date(now + ttlDays * 24 * 60 * 60 * 1_000).toISOString();

if (WRITE && successful.length) {
  const payload = successful.map((result) => ({
    title_id: result.title.id,
    region,
    checked_at: result.checkedAt,
    expires_at: expiresAt,
    offers: result.offers,
  }));
  for (const chunk of chunks(payload, 100)) {
    const { error } = await supabase.rpc("replace_catalog_availability", { payload: chunk });
    if (error) throw error;
  }

  const stateRows = successful.map((result) => ({
    title_id: result.title.id,
    region,
    external_source: "tmdb-watch-providers",
    checked_at: result.checkedAt,
    refresh_after: expiresAt,
    last_status: result.offers.length ? "ok" : "empty",
    error_code: null,
  }));
  await recordRefreshState(supabase, stateRows);
}

if (WRITE && failed.length) {
  const retryAt = new Date(now + 24 * 60 * 60 * 1_000).toISOString();
  const stateRows = failed.map((result) => ({
    title_id: result.value.id,
    region,
    external_source: "tmdb-watch-providers",
    checked_at: new Date().toISOString(),
    refresh_after: retryAt,
    last_status: "error",
    error_code: result.error instanceof Error ? result.error.message.slice(0, 120) : "UNKNOWN",
  }));
  await recordRefreshState(supabase, stateRows);
}

console.log(JSON.stringify({
  mode: WRITE ? "write" : "dry-run",
  scope: manifestPath ? "manifest" : "published-catalog",
  manifest: manifestPath,
  availableTitles: availableTitles.length,
  offset,
  requested: selected.length,
  succeeded: successful.length,
  failed: failed.length,
  titlesWithOffers: successful.filter((result) => result.offers.length).length,
  titlesWithoutOffers: successful.filter((result) => !result.offers.length).length,
  offers: successful.reduce((sum, result) => sum + result.offers.length, 0),
  sourceLinksObserved: successful.filter((result) => result.sourceLink).length,
  nextOffset: offset + selected.length < availableTitles.length ? offset + selected.length : null,
  failures: failed.slice(0, 10).map((result) => ({
    title: result.value.name,
    mediaType: result.value.tmdb_media_type,
    tmdbId: result.value.tmdb_id,
    error: result.error instanceof Error ? result.error.message : String(result.error),
  })),
}, null, 2));

if (failed.length) process.exitCode = 1;
