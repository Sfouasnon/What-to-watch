import readline from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function defaultExportDate() {
  // TMDB publishes the daily exports after its UTC morning job. Yesterday is a
  // deliberately conservative default so this script is reliable at any hour.
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function parseExportDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid --date=${value}; expected YYYY-MM-DD.`);
  const [, year, month, day] = match;
  return { iso: value, fileDate: `${month}_${day}_${year}` };
}

const exportDate = parseExportDate(argument("date") ?? defaultExportDate());
const requestedType = argument("media-type");
if (requestedType && !["movie", "tv"].includes(requestedType)) {
  throw new Error("--media-type must be movie or tv.");
}

const BATCH_SIZE = Math.max(100, Number(argument("batch-size") ?? 1000));
const TYPES = requestedType ? [requestedType] : ["movie", "tv"];

function exportUrl(mediaType) {
  const filename = mediaType === "movie"
    ? `movie_ids_${exportDate.fileDate}.json.gz`
    : `tv_series_ids_${exportDate.fileDate}.json.gz`;
  return `https://files.tmdb.org/p/exports/${filename}`;
}

async function flush(mediaType, rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from("tmdb_catalog_index")
    .upsert(rows, { onConflict: "media_type,tmdb_id" });
  if (error) throw error;
}

async function importType(mediaType) {
  const url = exportUrl(mediaType);
  console.log(`Downloading ${mediaType} index for ${exportDate.iso}…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`TMDB export request failed (${response.status}) for ${url}`);
  }

  const gunzip = createGunzip();
  Readable.fromWeb(response.body).pipe(gunzip);
  const lines = readline.createInterface({ input: gunzip, crlfDelay: Infinity });

  let batch = [];
  let imported = 0;
  let adult = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    const item = JSON.parse(line);
    if (!Number.isInteger(item.id) || item.id <= 0) continue;

    if (item.adult === true) adult += 1;
    batch.push({
      media_type: mediaType,
      tmdb_id: item.id,
      original_name: item.original_title ?? item.original_name ?? item.name ?? null,
      popularity: Number.isFinite(Number(item.popularity)) ? Number(item.popularity) : null,
      adult: item.adult === true,
      video: mediaType === "movie" ? item.video === true : null,
      is_active: true,
      source_export_date: exportDate.iso,
      indexed_at: new Date().toISOString(),
    });

    if (batch.length >= BATCH_SIZE) {
      await flush(mediaType, batch);
      imported += batch.length;
      batch = [];
      if (imported % 10000 === 0) process.stdout.write(`\r${mediaType}: ${imported.toLocaleString()} indexed`);
    }
  }

  await flush(mediaType, batch);
  imported += batch.length;

  // Anything not present in this full valid-ID export is no longer considered
  // active. Keep the row for audit/history instead of deleting it.
  const { error: deactivateError } = await supabase
    .from("tmdb_catalog_index")
    .update({ is_active: false })
    .eq("media_type", mediaType)
    .lt("source_export_date", exportDate.iso)
    .eq("is_active", true);
  if (deactivateError) throw deactivateError;

  console.log(`\r${mediaType}: ${imported.toLocaleString()} indexed (${adult.toLocaleString()} adult IDs retained but excluded from hydration by default).`);
  return imported;
}

let total = 0;
for (const mediaType of TYPES) total += await importType(mediaType);
console.log(`TMDB catalog index import complete: ${total.toLocaleString()} rows processed.`);
