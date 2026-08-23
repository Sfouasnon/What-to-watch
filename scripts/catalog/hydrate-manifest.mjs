import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { validateHydrationManifest } from "./lib/batch-selection.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !process.env.TMDB_TOKEN) {
  throw new Error("TMDB_TOKEN, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const manifestArgument = argument("manifest");
if (!manifestArgument) throw new Error("--manifest=/path/to/manifest.json is required.");
const delayMs = Number(argument("delay-ms") ?? 75);
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error("--delay-ms must be an integer between 0 and 60000.");
}

const manifestPath = path.resolve(manifestArgument);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const validationErrors = validateHydrationManifest(manifest);
if (validationErrors.length) throw new Error(`Manifest validation failed:\n${validationErrors.join("\n")}`);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function run(script, args) {
  const result = spawnSync(process.execPath, [path.resolve(script), ...args], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${path.basename(script)} exited with status ${result.status}.`);
}

async function statusesForBatch(batch) {
  const rows = [];
  for (const mediaType of ["movie", "tv"]) {
    const ids = batch.titles.filter((title) => title.mediaType === mediaType).map((title) => title.tmdbId);
    for (let index = 0; index < ids.length; index += 100) {
      const { data, error } = await supabase
        .from("tmdb_catalog_index")
        .select("media_type,tmdb_id,hydration_status,title_id,last_error")
        .eq("media_type", mediaType)
        .in("tmdb_id", ids.slice(index, index + 100));
      if (error) throw error;
      rows.push(...(data ?? []));
    }
  }
  return rows;
}

for (const batch of manifest.batches) {
  console.log(`\n=== ${manifest.runId} batch ${batch.batchNumber}/${manifest.batches.length} ===`);
  run("scripts/catalog/queue-hydration-batch.mjs", [
    `--manifest=${manifestPath}`,
    `--batch=${batch.batchNumber}`,
    "--write",
  ]);
  run("scripts/catalog/hydrate-tmdb.mjs", [
    `--limit=${batch.titleCount}`,
    `--delay-ms=${delayMs}`,
  ]);

  const statuses = await statusesForBatch(batch);
  const hydrated = statuses.filter((row) => row.hydration_status === "hydrated" && row.title_id).length;
  if (statuses.length !== batch.titleCount || hydrated !== batch.titleCount) {
    const unresolved = statuses.filter((row) => row.hydration_status !== "hydrated" || !row.title_id);
    throw new Error(`Batch ${batch.batchNumber} stopped with ${hydrated}/${batch.titleCount} hydrated. Unresolved: ${JSON.stringify(unresolved.slice(0, 10))}`);
  }
  console.log(`Verified batch ${batch.batchNumber}: ${hydrated}/${batch.titleCount} hydrated.`);
}

console.log(`\nManifest hydration complete: ${manifest.titleCount}/${manifest.titleCount} titles hydrated.`);
