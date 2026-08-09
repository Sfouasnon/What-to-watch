import { editorialClassification } from "@/lib/recommendation/editorial";
import type { Title } from "@/lib/recommendation/types";

import type { TmdbTitleDetails } from "./types";

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedPopularity(value: number) {
  return clamp(100 * (1 - Math.exp(-Math.max(0, value) / 85)));
}

function pacing(details: TmdbTitleDetails): Title["pacing"] {
  const tags = details.keywords.map((keyword) => keyword.toLowerCase());
  if (tags.some((tag) => tag.includes("slow burn") || tag.includes("meditative"))) return "slow";
  if (tags.some((tag) => tag.includes("fast paced") || tag.includes("chase"))) return "fast";
  return "moderate";
}

/** Maps live provider-neutral TMDB data into the deterministic engine contract. */
export function tmdbDetailsToDomainTitle(details: TmdbTitleDetails): Title {
  const voteSignal = details.voteAverage === null ? 50 : details.voteAverage * 10;
  const evidence = clamp(Math.log10(Math.max(1, details.voteCount)) / 5, 0, 1);
  const canonicalScore = clamp(50 * (1 - evidence) + voteSignal * evidence);
  const popularity = normalizedPopularity(details.popularity);
  const keywords = details.keywords.map((keyword) => keyword.toLowerCase());
  const editorial = editorialClassification(details.mediaType, details.providerId);

  // For curated titles the primary editorial family is authoritative for the
  // broad mood gate. Raw TMDB genres remain the fallback for titles that have
  // not been curated yet. Secondary family remains explicit metadata rather
  // than silently becoming an equal-strength primary mood classification.
  const genres = editorial ? [editorial.primaryFamily] : details.genres.map((genre) => genre.name);

  return {
    id: details.externalId,
    name: details.title,
    year: details.releaseYear ?? 0,
    contentType: details.contentType === "movie" ? "movie" : "series",
    synopsis: details.overview ?? "TMDB has no synopsis for this title yet.",
    runtimeMinutes: details.runtimeMinutes ?? undefined,
    episodeRuntimeMinutes: details.episodeRuntimeMinutes ?? undefined,
    seasons: details.seasonCount ?? undefined,
    completed: details.completed ?? undefined,
    serialized: details.mediaType === "tv",
    genres,
    subgenres: editorial
      ? [editorial.primarySubgenre, ...(editorial.secondarySubgenre ? [editorial.secondarySubgenre] : [])]
      : keywords.slice(0, 8),
    toneTags: editorial?.toneTags ?? keywords.slice(0, 12),
    themes: keywords.slice(0, 12),
    pacing: editorial?.pacing ?? pacing(details),
    editorial: editorial ? {
      primarySubgenre: editorial.primarySubgenre,
      secondarySubgenre: editorial.secondarySubgenre,
      primaryFamily: editorial.primaryFamily,
      secondaryFamily: editorial.secondaryFamily,
      ontologyVersion: editorial.ontologyVersion,
      source: "gold-set",
    } : undefined,
    countries: details.countries,
    languages: details.languages.length
      ? details.languages
      : details.originalLanguage ? [details.originalLanguage] : [],
    directors: details.directors,
    writers: details.writers,
    cinematographers: details.cinematographers,
    actors: details.cast,
    canonicalScore,
    canonicalMemberships: [],
    criterionCollection: false,
    popularity,
    trendingScore: popularity,
    availability: details.availability.offers.map((offer) => ({
      serviceId: offer.serviceId,
      providerId: offer.providerId,
      providerName: offer.providerName,
      logoUrl: offer.logoUrl,
      region: offer.region,
      kind: offer.kind,
      checkedAt: offer.checkedAt,
      source: "tmdb" as const,
      deepLink: details.availability.sourceLink ?? undefined,
    })),
    posterUrl: details.posterUrl ?? undefined,
    backdropUrl: details.backdropUrl ?? undefined,
  };
}
