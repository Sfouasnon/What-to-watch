import sampleJson from "../../../curation/pilot/sample-100.json";
import rottenTomatoesCanonJson from "../../../curation/reference/rotten-tomatoes-top-300.json";
import type { CastContextPerson } from "../recommendation/types";

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
  primarySubgenre: string;
  secondarySubgenre?: string;
  toneTags: string[];
  pacing: "slow" | "moderate" | "fast";
  director: string;
  writers: string[];
  cinematographer?: string;
  cast: string[];
  castContext: CastContextPerson[];
  providers: string[];
  watchOptions: Array<{
    provider: string;
    offerType: "subscription" | "free" | "rental" | "purchase";
    launchTarget?: AppLaunchTarget;
  }>;
  watchOptionsUrl: string;
  availabilityType: "subscription" | "free" | "rental";
  criterion?: boolean;
  canonical?: string[];
  canonicalScore: number;
  popularity: number;
  baseline: number;
};

export type AppLaunchTarget = {
  providerKey: string;
  platform: "web" | "android_tv" | "fire_tv";
  targetKind: "uri" | "android_intent_uri";
  targetUri: string;
  packageName?: string;
  componentName?: string;
  action?: string;
  contentSpecific: true;
  verificationStatus: "verified";
  webUrl?: string;
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

type RottenTomatoesCanon = {
  movies: Array<{ rank: number; title: string; year: number; rotten_tomatoes_url: string }>;
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

export type CatalogCastContextRow = {
  title_id: string;
  cast_context: unknown;
};

export type CatalogAvailabilityRow = {
  id: string;
  title_id: string;
  provider_key: string;
  provider_name: string;
  offer_type: "subscription" | "free_ad_supported" | "rent" | "buy";
  deeplink_url: string | null;
  launch_targets?: CatalogLaunchTargetRow[];
};

export type CatalogLaunchTargetRow = {
  availability_offer_id: string;
  platform: "web" | "android_tv" | "fire_tv";
  target_kind: "uri" | "android_intent_uri";
  target_uri: string;
  package_name: string | null;
  component_name: string | null;
  action: string | null;
  content_specific: boolean;
  verification_status: "unverified" | "verified" | "rejected";
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
const rottenTomatoesCanon = rottenTomatoesCanonJson as RottenTomatoesCanon;
const sampleByIdentity = new Map(
  sample.titles.map((title) => [`${title.media_type}:${title.tmdb_id}`, title]),
);

export const GOLD_CATALOG_SIZE = sample.title_count;

const normalizeCanonTitle = (value: string) => value
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const rottenTomatoesByIdentity = new Map(rottenTomatoesCanon.movies.map((movie) => [
  `${normalizeCanonTitle(movie.title)}:${movie.year}`,
  movie,
]));

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

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function cachedCastContext(rawPayload: unknown): CastContextPerson[] {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return [];
  const value = (rawPayload as { cast_context?: unknown }).cast_context;
  if (!Array.isArray(value)) return [];
  return value.flatMap((person) => {
    if (!person || typeof person !== "object" || Array.isArray(person)) return [];
    const candidate = person as Record<string, unknown>;
    if (!finiteNumber(candidate.tmdbPersonId) || typeof candidate.name !== "string" || !finiteNumber(candidate.billingOrder)) return [];
    const references = Array.isArray(candidate.references) ? candidate.references.flatMap((reference) => {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) return [];
      const item = reference as Record<string, unknown>;
      if (
        typeof item.externalId !== "string" || !finiteNumber(item.tmdbId) ||
        (item.mediaType !== "movie" && item.mediaType !== "tv") || typeof item.name !== "string" ||
        !finiteNumber(item.year) || !finiteNumber(item.popularity) || !finiteNumber(item.voteCount)
      ) return [];
      const mediaType: "movie" | "tv" = item.mediaType;
      return [{
        externalId: item.externalId,
        tmdbId: item.tmdbId,
        mediaType,
        name: item.name,
        year: item.year,
        character: typeof item.character === "string" ? item.character : null,
        billingOrder: finiteNumber(item.billingOrder) ? item.billingOrder : null,
        popularity: item.popularity,
        voteCount: item.voteCount,
      }];
    }) : [];
    return [{
      tmdbPersonId: candidate.tmdbPersonId,
      name: candidate.name,
      character: typeof candidate.character === "string" ? candidate.character : null,
      billingOrder: candidate.billingOrder,
      references,
    }];
  });
}

export function displayTitleName(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || name !== name.toLocaleUpperCase() || !/[A-Z]/.test(name)) return name;
  const preservedAcronyms = new Set(["TV", "UK", "US", "USA", "U.S.", "II", "III", "IV"]);
  return words.map((word) => {
    if (/^\d+$/.test(word) || preservedAcronyms.has(word)) return word;
    return word[0] + word.slice(1).toLocaleLowerCase();
  }).join(" ");
}

function normalizedPopularity(value: number | string | null) {
  const raw = Math.max(0, asNumber(value));
  return clamp(Math.round(25 + Math.log10(1 + raw) * 25), 25, 100);
}

function baselineScore(title: CatalogTitleRow, sampleTitle?: GoldSampleTitle) {
  const voteAverage = asNumber(title.vote_average, sampleTitle?.vote_average ?? 6.5);
  const voteCount = Math.max(0, title.vote_count ?? sampleTitle?.vote_count ?? 0);
  const voteEvidence = Math.min(8, Math.log10(1 + voteCount) * 2);
  return clamp(Math.round(58 + voteAverage * 3 + voteEvidence), 72, 95);
}

/**
 * Prefers the hydrated TMDB release date over the pilot sample's year, so the
 * catalog reflects live metadata once `catalog:hydrate-gold` has run and still
 * renders correctly before it has.
 */
export function releaseYear(title: CatalogTitleRow, sampleTitle?: GoldSampleTitle) {
  const year = Number(title.release_date?.slice(0, 4));
  return Number.isInteger(year) && year > 1870 ? year : sampleTitle?.year ?? 0;
}

function runtimeLabel(title: CatalogTitleRow, sampleTitle?: GoldSampleTitle) {
  const minutes = title.content_type === "tv_series"
    ? title.episode_runtime_minutes ?? sampleTitle?.runtime ?? null
    : title.runtime_minutes ?? sampleTitle?.runtime ?? null;

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
  sampleTitle?: GoldSampleTitle,
) {
  const countries = title.production_countries ?? sampleTitle?.origin_country ?? [];
  const language = title.original_language ?? sampleTitle?.original_language;
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

function availabilityType(rows: readonly CatalogAvailabilityRow[]): AppCatalogTitle["availabilityType"] {
  if (rows.some((row) => row.offer_type === "subscription")) return "subscription";
  if (rows.some((row) => row.offer_type === "free_ad_supported")) return "free";
  if (rows.some((row) => row.offer_type === "rent" || row.offer_type === "buy")) return "rental";
  return "subscription";
}

function appOfferType(value: CatalogAvailabilityRow["offer_type"]): AppCatalogTitle["watchOptions"][number]["offerType"] {
  if (value === "free_ad_supported") return "free";
  if (value === "rent") return "rental";
  if (value === "buy") return "purchase";
  return "subscription";
}

function appLaunchTarget(row: CatalogAvailabilityRow): AppLaunchTarget | undefined {
  const verified = (row.launch_targets ?? []).filter((target) =>
    target.verification_status === "verified" && target.content_specific,
  );
  const platformRank = { fire_tv: 0, android_tv: 1, web: 2 };
  const selected = [...verified].sort((a, b) => platformRank[a.platform] - platformRank[b.platform])[0];
  if (!selected) return undefined;
  const webUrl = verified.find((target) => target.platform === "web")?.target_uri;
  return {
    providerKey: row.provider_key,
    platform: selected.platform,
    targetKind: selected.target_kind,
    targetUri: selected.target_uri,
    ...(selected.package_name ? { packageName: selected.package_name } : {}),
    ...(selected.component_name ? { componentName: selected.component_name } : {}),
    ...(selected.action ? { action: selected.action } : {}),
    contentSpecific: true,
    verificationStatus: "verified",
    ...(webUrl ? { webUrl } : {}),
  };
}

export function buildAppCatalogTitle(
  title: CatalogTitleRow,
  input: CatalogInputRow,
  classification: CatalogClassificationRow,
  castContext: unknown = [],
  availability: readonly CatalogAvailabilityRow[] = [],
): AppCatalogTitle | null {
  if (!title.tmdb_id || !title.tmdb_media_type) return null;
  const sampleTitle = sampleByIdentity.get(`${title.tmdb_media_type}:${title.tmdb_id}`);
  const providers = unique([
    ...sampledProviders(input.raw_payload),
    ...availability.map((row) => normalizeGoldProviderName(row.provider_name)),
  ]);
  const watchOptions = availability.map((row) => {
    const launchTarget = appLaunchTarget(row);
    return {
      provider: normalizeGoldProviderName(row.provider_name),
      offerType: appOfferType(row.offer_type),
      ...(launchTarget ? { launchTarget } : {}),
    };
  });

  const canonicalScore = asNumber(title.canonical_score);
  const titleYear = releaseYear(title, sampleTitle);
  const rottenTomatoesEntry = rottenTomatoesByIdentity.get(`${normalizeCanonTitle(displayTitleName(title.name))}:${titleYear}`);
  const rottenTomatoesScore = rottenTomatoesEntry
    ? Math.round(100 - ((rottenTomatoesEntry.rank - 1) / 299) * 45)
    : 0;
  const aggregateCanonicalScore = Math.max(canonicalScore, rottenTomatoesScore);
  const artwork = title.poster_path
    ? `https://image.tmdb.org/t/p/w780${title.poster_path}`
    : "/icons/icon-512.png";
  const backdrop = title.backdrop_path
    ? `https://image.tmdb.org/t/p/original${title.backdrop_path}`
    : artwork;

  return {
    id: `tmdb:${title.tmdb_media_type}:${title.tmdb_id}`,
    name: displayTitleName(title.name),
    year: titleYear,
    kind: contentKind(title, classification),
    runtime: runtimeLabel(title, sampleTitle),
    poster: artwork,
    backdrop,
    synopsis: title.overview ?? sampleTitle?.overview ?? "No synopsis available yet.",
    genres: input.tmdb_genres ?? [],
    tags: derivedTags(title, classification, sampleTitle),
    primarySubgenre: classification.primary_subgenre,
    ...(classification.secondary_subgenre ? { secondarySubgenre: classification.secondary_subgenre } : {}),
    toneTags: classification.tone_tags ?? [],
    pacing: classification.pacing ?? "moderate",
    director: input.directors?.[0] ?? "Unknown director",
    writers: input.writers ?? [],
    cinematographer: input.cinematographers?.[0],
    cast: input.principal_cast ?? [],
    castContext: cachedCastContext({ cast_context: castContext }),
    providers,
    watchOptions,
    watchOptionsUrl: `https://www.themoviedb.org/${title.tmdb_media_type}/${title.tmdb_id}/watch?locale=US`,
    availabilityType: availabilityType(availability),
    criterion: providers.includes("Criterion Channel"),
    canonical: unique([
      canonicalScore > 0 ? `Canonical score ${Math.round(canonicalScore)}` : null,
      rottenTomatoesEntry ? `Rotten Tomatoes all-time #${rottenTomatoesEntry.rank}` : null,
    ]),
    canonicalScore: aggregateCanonicalScore,
    popularity: normalizedPopularity(title.popularity),
    baseline: baselineScore(title, sampleTitle),
  };
}
