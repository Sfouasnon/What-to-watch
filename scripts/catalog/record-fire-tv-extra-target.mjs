import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const WRITE = process.argv.includes("--write");
const options = new Map(process.argv.slice(2).filter((argument) => argument !== "--write").map((argument) => {
  if (!argument.startsWith("--") || !argument.includes("=")) throw new Error(`Expected --name=value, received ${argument}`);
  const separator = argument.indexOf("=");
  return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
const required = (name, pattern, maximum = 512) => {
  const value = options.get(name)?.trim() ?? "";
  if (!value || value.length > maximum || (pattern && !pattern.test(value))) throw new Error(`--${name} is invalid.`);
  return value;
};

const identity = required("tmdb", /^(movie|tv):\d+$/, 40);
const [, mediaType, tmdbId] = /^(movie|tv):(\d+)$/.exec(identity);
const providerKey = required("provider", /^[a-z0-9][a-z0-9-]{0,120}$/, 121);
const packageName = required("package", /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/, 240);
const componentName = required("component", /^[A-Za-z0-9_.$]+(?:\.[A-Za-z0-9_.$]+)+$/, 300);
const action = required("action", /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/, 240);
const dataExtraName = required("data-extra-name", /^[A-Za-z][A-Za-z0-9_.]{0,119}$/, 120);
const dataExtraValue = required("data-extra-value", /^[^\u0000-\u001f\u007f]+$/, 512);
const source = options.get("source")?.trim() || "fire-tv-comrade";
if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(source)) throw new Error("--source is invalid.");
const expiresDays = Number(options.get("expires-days") ?? 30);
if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 365) throw new Error("--expires-days must be from 1 to 365.");
const observedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1_000).toISOString();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: title, error: titleError } = await supabase
  .from("titles")
  .select("id,name")
  .eq("tmdb_media_type", mediaType)
  .eq("tmdb_id", Number(tmdbId))
  .maybeSingle();
if (titleError) throw titleError;
if (!title) throw new Error(`No title found for ${identity}.`);

const { data: offers, error: offerError } = await supabase
  .from("availability_offers")
  .select("id,provider_key,provider_name,offer_type")
  .eq("title_id", title.id)
  .eq("provider_key", providerKey)
  .eq("region", "US")
  .gt("expires_at", observedAt);
if (offerError) throw offerError;
if (!offers?.length) throw new Error(`No current US ${providerKey} offer found for ${title.name}.`);
if (offers.length > 1) throw new Error(`Expected one current ${providerKey} offer for ${title.name}; found ${offers.length}.`);
const offer = offers[0];

const { data: existing, error: existingError } = await supabase
  .from("offer_launch_targets")
  .select("id,target_kind,target_uri,package_name,component_name,action,data_extra_name,data_extra_value,content_specific,verification_status,verified_at,verification_notes")
  .eq("availability_offer_id", offer.id)
  .eq("platform", "fire_tv")
  .eq("external_source", source)
  .maybeSingle();
if (existingError) throw existingError;
const unchanged = existing &&
  existing.target_kind === "android_string_extra" && existing.target_uri === null &&
  existing.package_name === packageName && existing.component_name === componentName &&
  existing.action === action && existing.data_extra_name === dataExtraName &&
  existing.data_extra_value === dataExtraValue && existing.content_specific;

const row = {
  availability_offer_id: offer.id,
  platform: "fire_tv",
  target_kind: "android_string_extra",
  target_uri: null,
  package_name: packageName,
  component_name: componentName,
  action,
  data_extra_name: dataExtraName,
  data_extra_value: dataExtraValue,
  content_specific: true,
  external_source: source,
  observed_at: observedAt,
  expires_at: expiresAt,
  verification_status: unchanged ? existing.verification_status : "unverified",
  verified_at: unchanged ? existing.verified_at : null,
  verification_notes: unchanged ? existing.verification_notes : null,
  source_payload: {
    evidence: "production-firetv-comrade-and-controlled-replay",
    deviceModel: options.get("device-model") ?? null,
    fireOsBuild: options.get("fire-os-build") ?? null,
    appVersion: options.get("app-version") ?? null,
  },
};

if (WRITE) {
  const { error } = await supabase
    .from("offer_launch_targets")
    .upsert(row, { onConflict: "availability_offer_id,platform,external_source" });
  if (error) throw error;
}

console.log(JSON.stringify({
  mode: WRITE ? "write" : "dry-run",
  title: { name: title.name, tmdb: identity },
  offer,
  source,
  unchanged: Boolean(unchanged),
  target: row,
}, null, 2));
