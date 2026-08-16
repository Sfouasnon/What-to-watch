const knownServices = [
  { slug: "max-amazon-channel", label: "Max Amazon Channel", matches: (name) => name === "hbo max amazon channel" || name === "max amazon channel" },
  { slug: "paramount-plus-amazon-channel", label: "Paramount+ Amazon Channel", matches: (name) => name === "paramount+ amazon channel" || name === "paramount plus amazon channel" },
  { slug: "netflix", label: "Netflix", matches: (name) => name.startsWith("netflix") },
  { slug: "prime-video", label: "Prime Video", matches: (name) => name.includes("prime video") || name === "amazon video" },
  { slug: "hulu", label: "Hulu", matches: (name) => name === "hulu" },
  { slug: "criterion-channel", label: "Criterion Channel", matches: (name) => name === "criterion channel" },
  { slug: "disney-plus", label: "Disney+", matches: (name) => name === "disney+" },
  { slug: "apple-tv-plus", label: "Apple TV+", matches: (name) => name === "apple tv+" },
  { slug: "max", label: "Max", matches: (name) => name === "max" || name === "hbo max" },
  { slug: "paramount-plus", label: "Paramount+", matches: (name) => name.startsWith("paramount plus") || name.startsWith("paramount+") },
  { slug: "peacock", label: "Peacock", matches: (name) => name.startsWith("peacock") },
];

export function normalizedProvider(rawName) {
  const trimmed = rawName.trim();
  const normalized = trimmed.toLocaleLowerCase();
  const service = knownServices.find((candidate) => candidate.matches(normalized));
  return {
    providerName: service?.label ?? trimmed,
    serviceSlug: service?.slug ?? null,
  };
}

export function providerKey(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 121);
  if (!slug) throw new Error(`Unable to derive provider key for ${value}`);
  return slug;
}

export function databaseOfferType(value) {
  if (value === "free") return "free_ad_supported";
  if (value === "rental") return "rent";
  if (value === "purchase") return "buy";
  return "subscription";
}
