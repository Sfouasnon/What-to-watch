import { normalizedProvider, providerKey } from "./provider-normalization.mjs";

const WATCHHUB_PROVIDER_OVERRIDES = new Map([
  ["amazon prime video", { providerKey: "prime-video", providerName: "Prime Video" }],
  ["amazon video", { providerKey: "prime-video", providerName: "Prime Video" }],
  ["disney plus", { providerKey: "disney-plus", providerName: "Disney+" }],
  ["hbo max", { providerKey: "max", providerName: "Max" }],
  ["hbo max amazon channel", { providerKey: "max-amazon-channel", providerName: "Max Amazon Channel" }],
  ["paramount+ amazon channel", { providerKey: "paramount-plus-amazon-channel", providerName: "Paramount+ Amazon Channel" }],
  ["peacock premium", { providerKey: "peacock", providerName: "Peacock" }],
]);

const SUPPORTED_PROVIDER_KEYS = new Set([
  "netflix",
  "prime-video",
  "hulu",
  "disney-plus",
  "max",
  "max-amazon-channel",
  "peacock",
  "paramount-plus",
  "paramount-plus-amazon-channel",
]);

export function normalizeWatchHubProvider(rawName) {
  const trimmed = String(rawName ?? "").trim();
  if (!trimmed) return null;
  const override = WATCHHUB_PROVIDER_OVERRIDES.get(trimmed.toLocaleLowerCase());
  if (override) return override;
  const provider = normalizedProvider(trimmed);
  const key = provider.serviceSlug ?? providerKey(provider.providerName);
  return { providerKey: key, providerName: provider.providerName };
}

export function isSupportedLaunchProvider(providerKeyValue) {
  return SUPPORTED_PROVIDER_KEYS.has(providerKeyValue);
}

export function parseAndroidIntentUri(targetUri) {
  if (!targetUri.startsWith("intent:")) return {};
  const marker = targetUri.indexOf("#Intent;");
  if (marker < 0 || !targetUri.endsWith(";end")) return {};
  const fields = targetUri.slice(marker + "#Intent;".length, -";end".length).split(";");
  const result = {};
  for (const field of fields) {
    const separator = field.indexOf("=");
    if (separator < 1) continue;
    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    if (key === "package") result.packageName = value;
    else if (key === "component") result.componentName = value;
    else if (key === "action") result.action = value;
  }
  return result;
}

export function isContentSpecificTarget(targetUri) {
  const value = String(targetUri ?? "");
  if (!value) return false;
  if (/search_query=|\/search(?:[/?#]|$)/i.test(value)) return false;
  if (/(?:[?&]|;S\.)(?:content_id|providerId|pvid|gti|asin|id)=/i.test(value)) return true;

  const route = value.startsWith("intent:")
    ? value.slice("intent://".length, value.indexOf("#Intent;") >= 0 ? value.indexOf("#Intent;") : undefined)
    : value;
  const parsed = runCatchingUrl(route, value.startsWith("intent:") ? "https://" : undefined);
  return Boolean(parsed && parsed.pathname && parsed.pathname !== "/");
}

function runCatchingUrl(value, prefix = "") {
  try {
    return new URL(`${prefix}${value}`);
  } catch {
    return null;
  }
}

function asTarget(platform, targetUri, stream) {
  if (typeof targetUri !== "string" || !/^(https?:\/\/|intent:|amzn:\/\/|pplus:\/\/)/.test(targetUri)) return null;
  const parsed = parseAndroidIntentUri(targetUri);
  return {
    platform,
    target_kind: targetUri.startsWith("intent:") ? "android_intent_uri" : "uri",
    target_uri: targetUri,
    package_name: parsed.packageName ?? null,
    component_name: parsed.componentName ?? null,
    action: parsed.action ?? null,
    content_specific: isContentSpecificTarget(targetUri),
    source_payload: stream,
  };
}

export function targetsFromWatchHubStream(stream) {
  if (!stream || typeof stream !== "object" || Array.isArray(stream)) return [];
  return [
    asTarget("web", stream.externalUrl, stream),
    asTarget("android_tv", stream.androidTvUrl, stream),
    asTarget("fire_tv", stream.fireTvUrl, stream),
  ].filter(Boolean);
}

function streamStrength(stream) {
  const targets = targetsFromWatchHubStream(stream);
  const exact = targets.filter((target) => target.content_specific).length;
  const fire = targets.some((target) => target.platform === "fire_tv" && target.content_specific) ? 4 : 0;
  const android = targets.some((target) => target.platform === "android_tv" && target.content_specific) ? 2 : 0;
  return exact * 10 + fire + android + targets.length;
}

export function bestWatchHubStream(streams, targetProviderKey) {
  return (Array.isArray(streams) ? streams : [])
    .filter((stream) => normalizeWatchHubProvider(stream?.name)?.providerKey === targetProviderKey)
    .sort((a, b) => streamStrength(b) - streamStrength(a))[0] ?? null;
}

export function preferredVerifiedTarget(targets) {
  const candidates = (targets ?? []).filter((target) =>
    target.verification_status === "verified" && target.content_specific,
  );
  const platformRank = { fire_tv: 0, android_tv: 1, web: 2 };
  return [...candidates].sort((a, b) =>
    (platformRank[a.platform] ?? 9) - (platformRank[b.platform] ?? 9),
  )[0] ?? null;
}
