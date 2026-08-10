export type SearchableContentType = "movie" | "tv_series";

/** Provider-neutral title result used by UI and future metadata providers. */
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

export type WatchProviderMediaType = "movie" | "tv";
export type WatchProviderKind = "subscription" | "free" | "rental" | "purchase";

export type WatchProviderOffer = {
  providerId: number;
  providerName: string;
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

export type WatchProviderCatalogItem = {
  providerId: number;
  providerName: string;
  logoUrl: string | null;
  displayPriority: number;
  mediaTypes: WatchProviderMediaType[];
};

export type WatchProviderCatalogResult = {
  region: string;
  checkedAt: string;
  providers: WatchProviderCatalogItem[];
};

export interface MetadataProvider {
  searchTitles(query: string, page?: number): Promise<TitleSearchPage>;
  getWatchProviders(mediaType: WatchProviderMediaType, providerId: number, region: string): Promise<WatchProviderResult>;
  getProviderCatalog(region: string): Promise<WatchProviderCatalogResult>;
}
