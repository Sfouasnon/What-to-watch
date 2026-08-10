import "server-only";

import type {
  MetadataProvider,
  TitleSearchPage,
  TitleSearchResult,
  WatchProviderCatalogItem,
  WatchProviderCatalogResult,
  WatchProviderKind,
  WatchProviderMediaType,
  WatchProviderResult,
} from "./types";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

type TmdbMultiResult = {
  id: number;
  media_type: "movie" | "tv" | "person";
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

type TmdbSearchResponse = {
  page: number;
  results: TmdbMultiResult[];
  total_pages: number;
  total_results: number;
  success?: boolean;
  status_message?: string;
};

type TmdbProvider = {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
  display_priorities?: Record<string, number>;
};

type TmdbProviderListResponse = {
  results: TmdbProvider[];
  status_message?: string;
};

type TmdbWatchRegion = {
  link?: string;
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
};

type TmdbWatchResponse = {
  id: number;
  results: Record<string, TmdbWatchRegion>;
  status_message?: string;
};

export class TmdbConfigurationError extends Error {
  constructor() {
    super("TMDB_TOKEN is not configured");
    this.name = "TmdbConfigurationError";
  }
}

export class TmdbUpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TmdbUpstreamError";
  }
}

export function isTmdbConfigured() {
  return Boolean(process.env.TMDB_TOKEN?.trim());
}

function imageUrl(path: string | null | undefined, size: "w342" | "w780") {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

function normalizeResult(result: TmdbMultiResult): TitleSearchResult | null {
  if (result.media_type !== "movie" && result.media_type !== "tv") return null;

  const isMovie = result.media_type === "movie";
  const title = isMovie ? result.title : result.name;
  if (!title) return null;

  const releaseDate = (isMovie ? result.release_date : result.first_air_date) || null;
  const parsedYear = releaseDate ? Number.parseInt(releaseDate.slice(0, 4), 10) : NaN;

  return {
    externalId: `tmdb:${result.media_type}:${result.id}`,
    provider: "tmdb",
    providerId: result.id,
    contentType: isMovie ? "movie" : "tv_series",
    title,
    originalTitle: (isMovie ? result.original_title : result.original_name) || null,
    overview: result.overview || null,
    releaseDate,
    releaseYear: Number.isFinite(parsedYear) ? parsedYear : null,
    originalLanguage: result.original_language || null,
    posterUrl: imageUrl(result.poster_path, "w342"),
    backdropUrl: imageUrl(result.backdrop_path, "w780"),
    popularity: result.popularity ?? 0,
    voteAverage: result.vote_average ?? null,
    voteCount: result.vote_count ?? 0,
  };
}

function providerPriority(provider: TmdbProvider, region: string) {
  return provider.display_priorities?.[region] ?? provider.display_priority ?? 999;
}

async function parseProviderList(response: Response): Promise<TmdbProviderListResponse> {
  const payload = (await response.json().catch(() => null)) as TmdbProviderListResponse | null;
  if (!response.ok || !payload) {
    throw new TmdbUpstreamError(
      payload?.status_message || `TMDB provider catalog request failed with status ${response.status}`,
      response.status,
    );
  }
  return payload;
}

export class TmdbMetadataProvider implements MetadataProvider {
  async searchTitles(query: string, page = 1): Promise<TitleSearchPage> {
    const token = process.env.TMDB_TOKEN?.trim();
    if (!token) throw new TmdbConfigurationError();

    const params = new URLSearchParams({
      query,
      page: String(page),
      include_adult: "false",
      language: "en-US",
    });
    const response = await fetch(`${TMDB_API_BASE}/search/multi?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 900 },
    });

    const payload = (await response.json().catch(() => null)) as TmdbSearchResponse | null;
    if (!response.ok || !payload) {
      throw new TmdbUpstreamError(
        payload?.status_message || `TMDB request failed with status ${response.status}`,
        response.status,
      );
    }

    return {
      results: payload.results.map(normalizeResult).filter((item): item is TitleSearchResult => item !== null),
      page: payload.page,
      totalPages: payload.total_pages,
      totalResults: payload.total_results,
    };
  }

  async getProviderCatalog(region: string): Promise<WatchProviderCatalogResult> {
    const token = process.env.TMDB_TOKEN?.trim();
    if (!token) throw new TmdbConfigurationError();

    const normalizedRegion = region.toUpperCase();
    const params = new URLSearchParams({
      language: "en-US",
      watch_region: normalizedRegion,
    });
    const request = (mediaType: WatchProviderMediaType) => fetch(`${TMDB_API_BASE}/watch/providers/${mediaType}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 86_400 },
    });

    const [moviePayload, tvPayload] = await Promise.all([
      request("movie").then(parseProviderList),
      request("tv").then(parseProviderList),
    ]);

    const providers = new Map<number, WatchProviderCatalogItem>();
    const merge = (mediaType: WatchProviderMediaType, entries: TmdbProvider[]) => {
      entries.forEach((provider) => {
        const priority = providerPriority(provider, normalizedRegion);
        const existing = providers.get(provider.provider_id);
        if (!existing) {
          providers.set(provider.provider_id, {
            providerId: provider.provider_id,
            providerName: provider.provider_name,
            logoUrl: imageUrl(provider.logo_path, "w342"),
            displayPriority: priority,
            mediaTypes: [mediaType],
          });
          return;
        }
        providers.set(provider.provider_id, {
          ...existing,
          providerName: provider.provider_name || existing.providerName,
          logoUrl: imageUrl(provider.logo_path, "w342") ?? existing.logoUrl,
          displayPriority: Math.min(existing.displayPriority, priority),
          mediaTypes: existing.mediaTypes.includes(mediaType) ? existing.mediaTypes : [...existing.mediaTypes, mediaType],
        });
      });
    };

    merge("movie", moviePayload.results ?? []);
    merge("tv", tvPayload.results ?? []);

    return {
      region: normalizedRegion,
      checkedAt: new Date().toISOString(),
      providers: [...providers.values()].sort(
        (a, b) => a.displayPriority - b.displayPriority || a.providerName.localeCompare(b.providerName),
      ),
    };
  }

  async getWatchProviders(mediaType: WatchProviderMediaType, providerId: number, region: string): Promise<WatchProviderResult> {
    const token = process.env.TMDB_TOKEN?.trim();
    if (!token) throw new TmdbConfigurationError();

    const response = await fetch(`${TMDB_API_BASE}/${mediaType}/${providerId}/watch/providers`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 21_600 },
    });
    const payload = (await response.json().catch(() => null)) as TmdbWatchResponse | null;
    if (!response.ok || !payload) {
      throw new TmdbUpstreamError(payload?.status_message || `TMDB provider request failed with status ${response.status}`, response.status);
    }

    const checkedAt = new Date().toISOString();
    const normalizedRegion = region.toUpperCase();
    const entry = payload.results[normalizedRegion];
    const groups: Array<[WatchProviderKind, TmdbProvider[] | undefined]> = [
      ["subscription", entry?.flatrate],
      ["free", [...(entry?.free ?? []), ...(entry?.ads ?? [])]],
      ["rental", entry?.rent],
      ["purchase", entry?.buy],
    ];
    const seen = new Set<string>();
    const offers = groups.flatMap(([kind, providers]) => (providers ?? []).flatMap((provider) => {
      const key = `${kind}:${provider.provider_id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        providerId: provider.provider_id,
        providerName: provider.provider_name,
        logoUrl: imageUrl(provider.logo_path, "w342"),
        displayPriority: provider.display_priority ?? 999,
        kind,
        region: normalizedRegion,
        source: "tmdb" as const,
        checkedAt,
      }];
    })).sort((a, b) => a.displayPriority - b.displayPriority || a.providerName.localeCompare(b.providerName));

    return { providerId, mediaType, region: normalizedRegion, sourceLink: entry?.link ?? null, checkedAt, offers };
  }
}

export const tmdb = new TmdbMetadataProvider();
