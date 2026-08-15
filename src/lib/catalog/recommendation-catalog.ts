import sampleJson from "../../../curation/pilot/sample-100.json";

export type AppCatalogTitle = {
  id: string;
  name: string;
  year: number;
  kind: "Movie" | "Series" | "Stand-up";
  runtime: string;
  poster: string;
  backdrop: string;
  synopsis: string;
  genres: string[];
  tags: string[];
  director: string;
  writers: string[];
  cinematographer?: string;
  cast: string[];
  providers: string[];
  availabilityType: "subscription" | "free" | "rental";
  criterion?: boolean;
  canonical?: string[];
  popularity: number;
  baseline: number;
};

type GoldSampleTitle = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year: number;
  runtime?: number | null;
  overview?: string | null;
  original_language?: string | null;
  origin_country?: string[];
  vote_average?: number | null;
  vote_count?: number | null;
};

type GoldSample = {
  title_count: number;
  titles: GoldSampleTitle[];
};

export type CatalogTitleRow = {
  id: string;
  tmdb_id: number | null;
  tmdb_media_type: "movie" | "tv" | null;
  content_type: "movie" | "tv_series" | "standup_special";
  name: string;
  overview: string | null;
  release_date: string | null;
  runtime_minutes: number | null;
  episode_runtime_minutes: number | null;
  season_count: number | null;
  episode_count: number | null;
  original_language: string | null;
  production_countries: string[] | null;
  popularity: number | string | null;
  vote_average: number | string | null;
  vote_count: number | null;
  canonical_score: number | string | null;
  poster_path: string | null;
  backdrop_path: string | null;
};

export type CatalogInputRow = {
  title_id: string;
  tmdb_genres: string[] | null;
  directors: string[] | null;
  writers: string[] | null;
  cinematographers: string[] | null;
  principal_cast: string[] | null;
  keywords: string[] | null;
  raw_payload: unknown;
};

export type CatalogClassificationRow = {
  title_id: string;
  primary_subgenre: string;
  secondary_subgenre: string | null;
  tone_tags: string[] | null;
  pacing: "slow" | "moderate" | "fast" | null;
  confidence: number | string;
  review_status: "gold" | "accepted" | "needs_review" | "rejected";
};

const sample = sampleJson as GoldSample;
const sampleByIdentity = new Map(
  sample.titles.map((title) => [`${title.media_type}:${title.tmdb_id}`, title]),
);

export const GOLD_CATALOG_SIZE = sample.title_count;

const providerAliases: Record<string, string> = {
  "Amazon Prime Video": "Prime Video",
  "Apple TV": "Apple TV+",
  "Disney Plus": "Disney+",
  "HBO Max": "Max",
  "Paramount Plus Premium": "Paramount+",
  "Peacock Premium": "Peacock",
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const asNumber = (value: number | string | null | undefined, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const unique = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];

export function normalizeGoldProviderName(name: string) {
  return providerAliases[name] ?? name;
}

function sampledProviders(rawPayload: unknown): string[] {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return [];
  const value = (rawPayload as { sampled_streaming_providers?: unknown }).sampled_streaming_providers;
  if (!Array.isArray(value)) return [];
  return unique(value.filter((item): item is string => typeof item === "string").map(normalizeGoldProviderName));
}

function normalizedPopularity(value: number | string | null) {
  const raw = Math.max(0, asNumber(value));
  return clamp(Math.round(25 + Math.log10(1 + raw) * 25), 25, 100);
}

function baselineScore(title: CatalogTitleRow, sampleTitle: GoldSampleTitle) {
  const voteAverage = asNumber(title.vote_average, sampleTitle.vote_average ?? 6.5);
  const voteCount = Math.max(0, title.vote_count ?? sampleTitle.vote_count ?? 0);
  const voteEvidence = Math.min(8, Math.log10(1 + voteCount) * 2);
  return clamp(Math.round(58 + voteAverage * 3 + voteEvidence), 72, 95);
}

/**
 * Prefers the hydrated TMDB release date over the pilot sample's year, so the
 * catalog reflects live metadata once `catalog:hydrate-gold` has run and still
 * renders correctly before it has.
 */
export function releaseYear(title: CatalogTitleRow, sampleTitle: GoldSampleTitle) {
  const year = Number(title.release_date?.slice(0, 4));
  return Number.isInteger(year) && year > 1870 ? year : sampleTitle.year;
}

function runtimeLabel(title: CatalogTitleRow, sampleTitle: GoldSampleTitle) {
  const minutes = title.content_type === "tv_series"
    ? title.episode_runtime_minutes ?? sampleTitle.runtime ?? null
    : title.runtime_minutes ?? sampleTitle.runtime ?? null;

  if (title.content_type === "tv_series") {
    const episode = minutes ? `${minutes}m episodes` : "Series";
    return title.season_count ? `${title.season_count} season${title.season_count === 1 ? "" : "s"} · ${episode}` : episode;
  }

  if (!minutes) return title.content_type === "standup_special" ? "Stand-up special" : "Movie";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${minutes}m`;
}

function contentKind(title: CatalogTitleRow, classification: CatalogClassificationRow): AppCatalogTitle["kind"] {
  if (title.content_type === "standup_special" || classification.primary_subgenre.includes("stand-up")) return "Stand-up";
  return title.content_type === "tv_series" ? "Series" : "Movie";
}

function derivedTags(
  title: CatalogTitleRow,
  classification: CatalogClassificationRow,
  sampleTitle: GoldSampleTitle,
) {
  const countries = title.production_countries ?? sampleTitle.origin_country ?? [];
  const language = title.original_language ?? sampleTitle.original_language;
  const international = Boolean(language && language !== "en") || countries.some((country) => country !== "US");
  return unique([
    classification.primary_subgenre,
    classification.secondary_subgenre,
    ...(classification.tone_tags ?? []),
    classification.pacing === "slow" ? "slow-burn" : null,
    classification.pacing === "fast" ? "fast" : null,
    international ? "international" : null,
    title.content_type === "tv_series" ? "bingeable" : null,
  ]);
}

export function buildAppCatalogTitle(
  title: CatalogTitleRow,
  input: CatalogInputRow,
  classification: CatalogClassificationRow,
): AppCatalogTitle | null {
  if (!title.tmdb_id || !title.tmdb_media_type) return null;
  const sampleTitle = sampleByIdentity.get(`${title.tmdb_media_type}:${title.tmdb_id}`);
  if (!sampleTitle) return null;

  const providers = sampledProviders(input.raw_payload);
  if (!providers.length) return null;

  const canonicalScore = asNumber(title.canonical_score);
  const artwork = title.poster_path
    ? `https://image.tmdb.org/t/p/w780${title.poster_path}`
    : "/icons/icon-512.png";
  const backdrop = title.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${title.backdrop_path}`
    : artwork;

  return {
    id: `tmdb:${title.tmdb_media_type}:${title.tmdb_id}`,
    name: title.name,
    year: releaseYear(title, sampleTitle),
    kind: contentKind(title, classification),
    runtime: runtimeLabel(title, sampleTitle),
    poster: artwork,
    backdrop,
    synopsis: title.overview ?? sampleTitle.overview ?? "No synopsis available yet.",
    genres: input.tmdb_genres ?? [],
    tags: derivedTags(title, classification, sampleTitle),
    director: input.directors?.[0] ?? "Unknown director",
    writers: input.writers ?? [],
    cinematographer: input.cinematographers?.[0],
    cast: input.principal_cast ?? [],
    providers,
    availabilityType: "subscription",
    criterion: false,
    canonical: canonicalScore > 0 ? [`Canonical score ${Math.round(canonicalScore)}`] : undefined,
    popularity: normalizedPopularity(title.popularity),
    baseline: baselineScore(title, sampleTitle),
  };
}
