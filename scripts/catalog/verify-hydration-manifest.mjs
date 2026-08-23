import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { validateHydrationManifest } from "./lib/batch-selection.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const manifestArgument = argument("manifest");
if (!manifestArgument) throw new Error("--manifest=/path/to/manifest.json is required.");

const manifestPath = path.resolve(manifestArgument);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const validationErrors = validateHydrationManifest(manifest);
if (validationErrors.length) throw new Error(`Manifest validation failed:\n${validationErrors.join("\n")}`);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const titles = manifest.batches.flatMap((batch) => batch.titles);
const indexRows = [];
for (const mediaType of ["movie", "tv"]) {
  const ids = titles.filter((title) => title.mediaType === mediaType).map((title) => title.tmdbId);
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase
      .from("tmdb_catalog_index")
      .select("media_type,tmdb_id,hydration_status,title_id")
      .eq("media_type", mediaType)
      .in("tmdb_id", ids.slice(index, index + 100));
    if (error) throw error;
    indexRows.push(...(data ?? []));
  }
}

const titleIds = indexRows.map((row) => row.title_id).filter(Boolean);
const inputTitleIds = new Set();
for (let index = 0; index < titleIds.length; index += 100) {
  const { data, error } = await supabase
    .from("title_classification_inputs")
    .select("title_id")
    .in("title_id", titleIds.slice(index, index + 100));
  if (error) throw error;
  for (const row of data ?? []) inputTitleIds.add(row.title_id);
}

const tableCounts = {};
for (const table of ["titles", "tmdb_catalog_index", "title_classification_inputs", "title_editorial_classifications"]) {
  const { count, error } = await supabase.from(table).select("*", { head: true, count: "exact" });
  if (error) throw error;
  tableCounts[table] = count;
}

const identities = titles.map((title) => `${title.mediaType}:${title.tmdbId}`);
const uniqueIdentities = new Set(identities);
const hydratedRows = indexRows.filter((row) => row.hydration_status === "hydrated" && row.title_id);
const releaseDates = titles.map((title) => title.releaseDate).sort();
const result = {
  runId: manifest.runId,
  manifestTitles: titles.length,
  uniqueIdentities: uniqueIdentities.size,
  movieCount: titles.filter((title) => title.mediaType === "movie").length,
  tvCount: titles.filter((title) => title.mediaType === "tv").length,
  databaseIndexRows: indexRows.length,
  hydratedRows: hydratedRows.length,
  classificationInputs: inputTitleIds.size,
  minimumReleaseDate: releaseDates.at(0),
  maximumReleaseDate: releaseDates.at(-1),
  tableCounts,
};

console.log(JSON.stringify(result, null, 2));

const expected = manifest.titleCount;
if (
  titles.length !== expected ||
  uniqueIdentities.size !== expected ||
  indexRows.length !== expected ||
  hydratedRows.length !== expected ||
  inputTitleIds.size !== expected
) {
  throw new Error("Whole-manifest verification failed.");
}
