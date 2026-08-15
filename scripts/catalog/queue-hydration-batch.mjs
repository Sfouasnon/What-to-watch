import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { validateHydrationManifest } from "./lib/batch-selection.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const manifestArgument = argument("manifest");
if (!manifestArgument) throw new Error("--manifest=/path/to/manifest.json is required.");
const batchNumber = Number(argument("batch") ?? 1);
if (!Number.isInteger(batchNumber) || batchNumber < 1) throw new Error("--batch must be a positive integer.");
const WRITE = process.argv.includes("--write");
const manifestPath = path.resolve(manifestArgument);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const validationErrors = validateHydrationManifest(manifest);
if (validationErrors.length) throw new Error(`Manifest validation failed:\n${validationErrors.join("\n")}`);
const batch = manifest.batches.find((item) => item.batchNumber === batchNumber);
if (!batch) throw new Error(`Batch ${batchNumber} is not present in ${manifestPath}.`);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const batchIdentities = new Set(batch.titles.map((title) => `${title.mediaType}:${title.tmdbId}`));
const { data: eligibleQueue, error: queueError } = await supabase
  .from("tmdb_catalog_index")
  .select("media_type,tmdb_id,hydration_status")
  .eq("is_active", true)
  .in("hydration_status", ["pending", "error", "hydrating"]);
if (queueError) throw queueError;

const foreignQueue = (eligibleQueue ?? []).filter((row) => !batchIdentities.has(`${row.media_type}:${row.tmdb_id}`));
if (foreignQueue.length) {
  throw new Error(`Refusing to queue Batch ${batchNumber}: ${foreignQueue.length} active queue rows belong to another batch.`);
}

const existingIdentities = new Set((eligibleQueue ?? []).map((row) => `${row.media_type}:${row.tmdb_id}`));
const selectionDate = String(manifest.generatedAt).slice(0, 10);
const rows = batch.titles
  .filter((title) => !existingIdentities.has(`${title.mediaType}:${title.tmdbId}`))
  .map((title) => ({
    media_type: title.mediaType,
    tmdb_id: title.tmdbId,
    original_name: title.originalName || title.name || null,
    popularity: title.popularity,
    adult: false,
    video: title.mediaType === "movie" ? false : null,
    is_active: true,
    source_export_date: selectionDate,
    indexed_at: new Date().toISOString(),
    hydration_status: "pending",
    hydration_attempts: 0,
    last_error: null,
  }));

if (WRITE && rows.length) {
  const { error } = await supabase.from("tmdb_catalog_index").insert(rows);
  if (error) throw error;
}

console.log(JSON.stringify({
  mode: WRITE ? "write" : "dry-run",
  manifest: manifestPath,
  runId: manifest.runId,
  batchNumber,
  batchTitleCount: batch.titleCount,
  alreadyQueued: batch.titleCount - rows.length,
  rowsToQueue: rows.length,
  movieCount: batch.movieCount,
  tvCount: batch.tvCount,
}, null, 2));
