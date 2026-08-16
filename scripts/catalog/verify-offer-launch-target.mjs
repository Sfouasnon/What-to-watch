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
const identity = options.get("tmdb") ?? "";
const identityMatch = /^(movie|tv):(\d+)$/.exec(identity);
if (!identityMatch) throw new Error("--tmdb must use movie:<id> or tv:<id>.");
const providerKey = options.get("provider") ?? "";
if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(providerKey)) throw new Error("--provider must be a normalized provider key.");
const platform = options.get("platform") ?? "fire_tv";
if (!["web", "android_tv", "fire_tv"].includes(platform)) throw new Error("--platform must be web, android_tv, or fire_tv.");
const source = options.get("source") ?? "watchhub";
if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(source)) throw new Error("--source is invalid.");
const status = options.get("status") ?? "unverified";
if (!["unverified", "verified", "rejected"].includes(status)) throw new Error("--status must be unverified, verified, or rejected.");
const notes = options.get("notes")?.trim() || null;
if (notes && notes.length > 1000) throw new Error("--notes must be at most 1000 characters.");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: title, error: titleError } = await supabase
  .from("titles")
  .select("id,name,tmdb_id,tmdb_media_type")
  .eq("tmdb_media_type", identityMatch[1])
  .eq("tmdb_id", Number(identityMatch[2]))
  .maybeSingle();
if (titleError) throw titleError;
if (!title) throw new Error(`No title found for ${identity}.`);

const { data: offers, error: offerError } = await supabase
  .from("availability_offers")
  .select("id,provider_key,provider_name,offer_type")
  .eq("title_id", title.id)
  .eq("provider_key", providerKey)
  .eq("region", "US")
  .gt("expires_at", new Date().toISOString());
if (offerError) throw offerError;
if (!offers?.length) throw new Error(`No current US ${providerKey} offer found for ${title.name}.`);

const offerIds = offers.map((offer) => offer.id);
const { data: allTargets, error: targetError } = await supabase
  .from("offer_launch_targets")
  .select("id,availability_offer_id,platform,target_kind,target_uri,package_name,component_name,action,data_extra_name,data_extra_value,content_specific,external_source,verification_status,verified_at,verification_notes,expires_at")
  .in("availability_offer_id", offerIds)
  .eq("external_source", source)
  .gt("expires_at", new Date().toISOString());
if (targetError) throw targetError;
const targets = (allTargets ?? []).filter((target) => target.platform === platform);
if (!targets.length) throw new Error(`No current ${source} ${platform} target found for ${title.name} on ${providerKey}.`);
if (status === "verified" && targets.some((target) => !target.content_specific)) {
  throw new Error("Contentless launch targets cannot be marked verified.");
}

const webByOffer = new Map((allTargets ?? [])
  .filter((target) => target.platform === "web" && target.content_specific)
  .map((target) => [target.availability_offer_id, target.target_uri]));
const checkedAt = new Date().toISOString();
if (WRITE) {
  const { error } = await supabase
    .from("offer_launch_targets")
    .update({
      verification_status: status,
      verified_at: status === "verified" ? checkedAt : null,
      verification_notes: notes,
    })
    .in("id", targets.map((target) => target.id));
  if (error) throw error;
}

console.log(JSON.stringify({
  mode: WRITE ? "write" : "dry-run",
  title: { name: title.name, tmdb: identity },
  providerKey,
  platform,
  source,
  status,
  notes,
  matchedTargets: targets.length,
  adbPayloads: targets.map((target) => ({
    providerKey,
    platform: target.platform,
    targetKind: target.target_kind,
    targetUri: target.target_uri,
    packageName: target.package_name,
    componentName: target.component_name,
    action: target.action,
    dataExtraName: target.data_extra_name,
    dataExtraValue: target.data_extra_value,
    contentSpecific: target.content_specific,
    verificationStatus: WRITE ? status : target.verification_status,
    webUrl: webByOffer.get(target.availability_offer_id) ?? null,
  })),
}, null, 2));
