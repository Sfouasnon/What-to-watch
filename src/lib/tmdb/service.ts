import "server-only";

import {
  normalizeTmdbAvailability,
  normalizeTmdbTitle,
  type RawTmdbTitle,
  type RawTmdbWatchRegion,
} from "./normalization";
import type {
  AvailabilityProvider,
  MetadataProvider,
  TitleSearchPage,
  TitleSearchResult,
  TmdbTitleDetails,
  WatchProviderMediaType,
  WatchProviderResult,
} from "./types";

const TMDB_API_BASE = "https://api.themoviedb.org/3";

type TmdbListResponse = {
  page: number;
  results: RawTmdbTitle[];
  total_pages: number;
  total_results: number;
  status_message?: string;
};

type TmdbWatchResponse = {
  id: number;
  results: Record<string, RawTmdbWatchRegion>;
  status_message?: string;
};

type TmdbGenre = { id: number; name: string };
type TmdbCrew = { name: string; job?: string; department?: string };
type TmdbCast = { name: string; order?: number };
type TmdbDetailResponse = RawTmdbTitle & {
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number;
  status?: string;
  in_production?: boolean;
  genres?: TmdbGenre[];
  production_countries?: Array<{ iso_3166_1: string }>;
  spoken_languages?: Array<{ iso_639_1: string }>;
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
  keywords?: { keywords?: Array<{ name: string }>; results?: Array<{ name: string }> };
  "watch/providers"?: { results?: Record<string, RawTmdbWatchRegion> };
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

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

function mediaResult(result: RawTmdbTitle, mediaType: WatchProviderMediaType) {
  return normalizeTmdbTitle(result, mediaType);
}

export class TmdbMetadataProvider implements MetadataProvider, AvailabilityProvider {
  private async request<T extends { status_message?: string }>(
    path: string,
    params: URLSearchParams,
    revalidate: number,
  ): Promise<T> {
    const token = process.env.TMDB_TOKEN?.trim();
    if (!token) throw new TmdbConfigurationError();

    const response = await fetch(`${TMDB_API_BASE}${path}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate },
    });
    const payload = (await response.json().catch(() => null)) as T | null;
    if (!response.ok || !payload) {
      throw new TmdbUpstreamError(
        payload?.status_message || `TMDB request failed with status ${response.status}`,
        response.status,
      );
    }
    return payload;
  }

  async searchTitles(query: string, page = 1): Promise<TitleSearchPage> {
    const payload = await this.request<TmdbListResponse>(
      "/search/multi",
      new URLSearchParams({
        query,
        page: String(page),
        include_adult: "false",
        language: "en-US",
      }),
      900,
    );
    return {
      results: payload.results
        .map((result) => normalizeTmdbTitle(result))
        .filter((item): item is TitleSearchResult => item !== null),
      page: payload.page,
      totalPages: payload.total_pages,
      totalResults: payload.total_results,
    };
  }

  async getAvailability(
    mediaType: WatchProviderMediaType,
    providerId: number,
    region: string,
  ): Promise<WatchProviderResult> {
    const payload = await this.request<TmdbWatchResponse>(
      `/${mediaType}/${providerId}/watch/providers`,
      new URLSearchParams(),
      21_600,
    );
    const normalizedRegion = region.toUpperCase();
    return normalizeTmdbAvailability({
      providerId,
      mediaType,
      region: normalizedRegion,
      entry: payload.results[normalizedRegion],
    });
  }

  /** Backward-compatible route boundary; new code depends on AvailabilityProvider. */
  getWatchProviders(
    mediaType: WatchProviderMediaType,
    providerId: number,
    region: string,
  ) {
    return this.getAvailability(mediaType, providerId, region);
  }

  async getTitleDetails(
    mediaType: WatchProviderMediaType,
    providerId: number,
    region: string,
  ): Promise<TmdbTitleDetails> {
    const payload = await this.request<TmdbDetailResponse>(
      `/${mediaType}/${providerId}`,
      new URLSearchParams({
        language: "en-US",
        append_to_response: "credits,keywords,watch/providers",
      }),
      21_600,
    );
    const base = mediaResult(payload, mediaType);
    if (!base) throw new TmdbUpstreamError("TMDB returned an invalid title.", 502);

    const crew = payload.credits?.crew ?? [];
    const writers = crew.filter((person) =>
      person.department === "Writing" ||
      ["Writer", "Screenplay", "Story", "Teleplay", "Novel"].includes(person.job ?? ""),
    );
    const cinematographers = crew.filter((person) =>
      ["Director of Photography", "Cinematography", "Cinematographer"].includes(person.job ?? ""),
    );
    const normalizedRegion = region.toUpperCase();
    const availability = normalizeTmdbAvailability({
      providerId,
      mediaType,
      region: normalizedRegion,
      entry: payload["watch/providers"]?.results?.[normalizedRegion],
    });
    const episodeRuntimes = (payload.episode_run_time ?? []).filter((value) => value > 0);

    return {
      ...base,
      mediaType,
      runtimeMinutes: payload.runtime && payload.runtime > 0 ? payload.runtime : null,
      episodeRuntimeMinutes: episodeRuntimes[0] ?? null,
      seasonCount: typeof payload.number_of_seasons === "number" ? payload.number_of_seasons : null,
      completed: mediaType === "tv"
        ? ["Ended", "Canceled"].includes(payload.status ?? "")
        : null,
      genres: payload.genres ?? [],
      keywords: unique([
        ...(payload.keywords?.keywords ?? []).map((keyword) => keyword.name),
        ...(payload.keywords?.results ?? []).map((keyword) => keyword.name),
      ]).slice(0, 16),
      countries: unique((payload.production_countries ?? []).map((country) => country.iso_3166_1)),
      languages: unique((payload.spoken_languages ?? []).map((language) => language.iso_639_1)),
      directors: unique(crew.filter((person) => person.job === "Director").map((person) => person.name)).slice(0, 6),
      writers: unique(writers.map((person) => person.name)).slice(0, 8),
      cinematographers: unique(cinematographers.map((person) => person.name)).slice(0, 6),
      cast: unique(
        [...(payload.credits?.cast ?? [])]
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
          .map((person) => person.name),
      ).slice(0, 12),
      availability,
    };
  }

  async getRecommendations(
    mediaType: WatchProviderMediaType,
    providerId: number,
    page = 1,
  ): Promise<TitleSearchResult[]> {
    const payload = await this.request<TmdbListResponse>(
      `/${mediaType}/${providerId}/recommendations`,
      new URLSearchParams({ language: "en-US", page: String(page) }),
      21_600,
    );
    return payload.results
      .map((result) => mediaResult(result, mediaType))
      .filter((item): item is TitleSearchResult => item !== null);
  }

  async getTrending(mediaType: WatchProviderMediaType, page = 1): Promise<TitleSearchResult[]> {
    const payload = await this.request<TmdbListResponse>(
      `/trending/${mediaType}/week`,
      new URLSearchParams({ language: "en-US", page: String(page) }),
      3_600,
    );
    return payload.results
      .map((result) => mediaResult(result, mediaType))
      .filter((item): item is TitleSearchResult => item !== null);
  }

  async discoverTitles(
    mediaType: WatchProviderMediaType,
    genreIds: readonly number[],
    page = 1,
  ): Promise<TitleSearchResult[]> {
    const params = new URLSearchParams({
      language: "en-US",
      page: String(page),
      include_adult: "false",
      sort_by: "vote_count.desc",
      "vote_count.gte": "100",
    });
    if (genreIds.length) params.set("with_genres", [...new Set(genreIds)].slice(0, 8).join("|"));
    const payload = await this.request<TmdbListResponse>(`/discover/${mediaType}`, params, 21_600);
    return payload.results
      .map((result) => mediaResult(result, mediaType))
      .filter((item): item is TitleSearchResult => item !== null);
  }
}

export const tmdb = new TmdbMetadataProvider();
