import type { TvSeasonRelease } from "./types";

export type TmdbSeasonSummary = {
  air_date?: string | null;
  episode_count?: number | null;
  name?: string | null;
  season_number?: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function latestReleasedSeason(
  providerId: number,
  seasons: readonly TmdbSeasonSummary[],
  asOfDate = new Date().toISOString().slice(0, 10),
): TvSeasonRelease | null {
  const released = seasons.flatMap((season) => {
    const releaseDate = season.air_date?.trim();
    const seasonNumber = season.season_number;
    if (!releaseDate || !ISO_DATE.test(releaseDate) || releaseDate > asOfDate) return [];
    if (!Number.isInteger(seasonNumber) || (seasonNumber ?? 0) <= 0) return [];
    return [{
      providerId,
      seasonNumber: seasonNumber as number,
      name: season.name?.trim() || `Season ${seasonNumber}`,
      releaseDate,
      episodeCount: Number.isInteger(season.episode_count) && (season.episode_count ?? 0) > 0
        ? season.episode_count as number
        : 0,
    }];
  });

  return released.sort((a, b) =>
    b.releaseDate.localeCompare(a.releaseDate) || b.seasonNumber - a.seasonNumber,
  )[0] ?? null;
}

export function isNewSeasonSince(
  season: TvSeasonRelease,
  activityAt: string | undefined,
  knownSeasonCount?: number,
) {
  if (season.seasonNumber <= 1) return false;
  if (knownSeasonCount !== undefined && season.seasonNumber > knownSeasonCount) return true;
  const activityDate = activityAt?.slice(0, 10);
  return Boolean(activityDate && ISO_DATE.test(activityDate) && season.releaseDate > activityDate);
}
