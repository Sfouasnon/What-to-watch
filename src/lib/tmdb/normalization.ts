import type {
  TitleSearchResult,
  WatchProviderKind,
  WatchProviderMediaType,
  WatchProviderResult,
} from "./types";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type RawTmdbTitle = {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string;
  original_title?: string;
  release_date?: string;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  overview?: string;
  original_language?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
};

export type RawTmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
};

export type RawTmdbWatchRegion = {
  link?: string;
  flatrate?: RawTmdbProvider[];
  free?: RawTmdbProvider[];
  ads?: RawTmdbProvider[];
  rent?: RawTmdbProvider[];
  buy?: RawTmdbProvider[];
};

export function tmdbImageUrl(path: string | null | undefined, size: "w342" | "w780") {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

export function normalizeTmdbTitle(
  result: RawTmdbTitle,
  forcedMediaType?: WatchProviderMediaType,
): TitleSearchResult | null {
  const mediaType = forcedMediaType ?? result.media_type;
  if (mediaType !== "movie" && mediaType !== "tv") return null;

  const isMovie = mediaType === "movie";
  const title = isMovie ? result.title : result.name;
  if (!title || !Number.isInteger(result.id) || result.id <= 0) return null;

  const releaseDate = (isMovie ? result.release_date : result.first_air_date) || null;
  const parsedYear = releaseDate ? Number.parseInt(releaseDate.slice(0, 4), 10) : NaN;

  return {
    externalId: `tmdb:${mediaType}:${result.id}`,
    provider: "tmdb",
    providerId: result.id,
    contentType: isMovie ? "movie" : "tv_series",
    title,
    originalTitle: (isMovie ? result.original_title : result.original_name) || null,
    overview: result.overview || null,
    releaseDate,
    releaseYear: Number.isFinite(parsedYear) ? parsedYear : null,
    originalLanguage: result.original_language || null,
    posterUrl: tmdbImageUrl(result.poster_path, "w342"),
    backdropUrl: tmdbImageUrl(result.backdrop_path, "w780"),
    popularity: result.popularity ?? 0,
    voteAverage: result.vote_average ?? null,
    voteCount: result.vote_count ?? 0,
  };
}

function normalizedProviderName(name: string) {
  return name.trim().toLowerCase().replaceAll("+", " plus ").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Converts TMDB/JustWatch provider identities into stable app identities.
 * Offer kind is deliberately part of the mapping: Amazon and Apple stores are
 * marketplaces, not entitlements to Prime Video or Apple TV+.
 */
export function tmdbServiceId(provider: RawTmdbProvider, kind: WatchProviderKind): string {
  const name = normalizedProviderName(provider.provider_name);

  if (provider.provider_id === 10) return "amazon-video";
  if (provider.provider_id === 2) return "apple-tv-store";
  if (provider.provider_id === 9) {
    return kind === "subscription" ? "prime-video" : "amazon-video";
  }
  if (provider.provider_id === 350) {
    return kind === "subscription" ? "apple-tv-plus" : "apple-tv-store";
  }
  if (name === "amazon video") return "amazon-video";
  if (name === "amazon prime video" || name === "prime video") {
    return kind === "subscription" ? "prime-video" : "amazon-video";
  }
  if (name === "apple tv plus") {
    return kind === "subscription" ? "apple-tv-plus" : "apple-tv-store";
  }
  if (name === "apple tv") return "apple-tv-store";

  const known: Record<number, string> = {
    8: "netflix",
    15: "hulu",
    337: "disney-plus",
    1899: "max",
    386: "peacock",
    531: "paramount-plus",
    258: "criterion-channel",
  };
  return known[provider.provider_id] ?? `tmdb-provider-${provider.provider_id}`;
}

function providerDisplayName(provider: RawTmdbProvider, serviceId: string) {
  const canonical: Record<string, string> = {
    "amazon-video": "Amazon Video",
    "apple-tv-plus": "Apple TV+",
    "apple-tv-store": "Apple TV",
    "disney-plus": "Disney+",
    "prime-video": "Prime Video",
  };
  return canonical[serviceId] ?? provider.provider_name;
}

export function normalizeTmdbAvailability(input: {
  providerId: number;
  mediaType: WatchProviderMediaType;
  region: string;
  entry?: RawTmdbWatchRegion;
  checkedAt?: string;
}): WatchProviderResult {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const region = input.region.toUpperCase();
  const groups: Array<[WatchProviderKind, RawTmdbProvider[] | undefined]> = [
    ["subscription", input.entry?.flatrate],
    ["free", [...(input.entry?.free ?? []), ...(input.entry?.ads ?? [])]],
    ["rental", input.entry?.rent],
    ["purchase", input.entry?.buy],
  ];
  const kindPriority: Record<WatchProviderKind, number> = {
    subscription: 0,
    free: 1,
    rental: 2,
    purchase: 3,
  };
  const seen = new Set<string>();
  const offers = groups.flatMap(([kind, providers]) => (providers ?? []).flatMap((provider) => {
    const serviceId = tmdbServiceId(provider, kind);
    const key = `${kind}:${provider.provider_id}:${serviceId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      providerId: provider.provider_id,
      providerName: providerDisplayName(provider, serviceId),
      serviceId,
      logoUrl: tmdbImageUrl(provider.logo_path, "w342"),
      displayPriority: provider.display_priority ?? 999,
      kind,
      region,
      source: "tmdb" as const,
      checkedAt,
    }];
  })).sort((a, b) =>
    kindPriority[a.kind] - kindPriority[b.kind] ||
    a.displayPriority - b.displayPriority ||
    a.providerName.localeCompare(b.providerName),
  );

  return {
    providerId: input.providerId,
    mediaType: input.mediaType,
    region,
    sourceLink: input.entry?.link ?? null,
    checkedAt,
    offers,
  };
}
