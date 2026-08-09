export type SearchableContentType = "movie" | "tv_series";
export type WatchProviderMediaType = "movie" | "tv";
export type WatchProviderKind = "subscription" | "free" | "rental" | "purchase";

/** Provider-neutral title result used by the UI and future metadata providers. */
export type TitleSearchResult = {
  externalId: string;
  provider: "tmdb";
  providerId: number;
  contentType: SearchableContentType;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  originalLanguage: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  popularity: number;
  voteAverage: number | null;
  voteCount: number;
};

export type TitleSearchPage = {
  results: TitleSearchResult[];
  page: number;
  totalPages: number;
  totalResults: number;
};

export type WatchProviderOffer = {
  providerId: number;
  providerName: string;
  /** Stable app identifier; marketplace offers never impersonate subscriptions. */
  serviceId: string;
  logoUrl: string | null;
  displayPriority: number;
  kind: WatchProviderKind;
  region: string;
  source: "tmdb";
  checkedAt: string;
};

export type WatchProviderResult = {
  providerId: number;
  mediaType: WatchProviderMediaType;
  region: string;
  sourceLink: string | null;
  checkedAt: string;
  offers: WatchProviderOffer[];
};

export type TmdbTitleDetails = TitleSearchResult & {
  mediaType: WatchProviderMediaType;
  runtimeMinutes: number | null;
  episodeRuntimeMinutes: number | null;
  seasonCount: number | null;
  completed: boolean | null;
  genres: Array<{ id: number; name: string }>;
  keywords: string[];
  countries: string[];
  languages: string[];
  directors: string[];
  writers: string[];
  cinematographers: string[];
  cast: string[];
  availability: WatchProviderResult;
};

export type TmdbCandidateSeed = {
  providerId: number;
  mediaType: WatchProviderMediaType;
};

export interface AvailabilityProvider {
  getAvailability(
    mediaType: WatchProviderMediaType,
    providerId: number,
    region: string,
  ): Promise<WatchProviderResult>;
}

export interface MetadataProvider {
  searchTitles(query: string, page?: number): Promise<TitleSearchPage>;
  getTitleDetails(
    mediaType: WatchProviderMediaType,
    providerId: number,
    region: string,
  ): Promise<TmdbTitleDetails>;
  getRecommendations(
    mediaType: WatchProviderMediaType,
    providerId: number,
    page?: number,
  ): Promise<TitleSearchResult[]>;
  getTrending(mediaType: WatchProviderMediaType, page?: number): Promise<TitleSearchResult[]>;
  discoverTitles(
    mediaType: WatchProviderMediaType,
    genreIds: readonly number[],
    page?: number,
  ): Promise<TitleSearchResult[]>;
}
