import { describe, expect, it } from "vitest";

import { isNewSeasonSince, latestReleasedSeason } from "./seasons";

describe("new season status", () => {
  const seasons = [
    { season_number: 0, name: "Specials", air_date: "2025-01-01", episode_count: 2 },
    { season_number: 1, name: "Season 1", air_date: "2022-06-23", episode_count: 8 },
    { season_number: 2, name: "Season 2", air_date: "2023-06-22", episode_count: 10 },
    { season_number: 3, name: "Season 3", air_date: "2026-09-01", episode_count: 10 },
  ];

  it("returns the most recently released numbered season", () => {
    expect(latestReleasedSeason(136315, seasons, "2026-08-16")).toEqual({
      providerId: 136315,
      seasonNumber: 2,
      name: "Season 2",
      releaseDate: "2023-06-22",
      episodeCount: 10,
    });
  });

  it("excludes specials, future seasons, and invalid air dates", () => {
    expect(latestReleasedSeason(1, [
      seasons[0],
      seasons[3],
      { season_number: 4, air_date: "not-a-date" },
    ], "2026-08-16")).toBeNull();
  });

  it("flags a season released after profile activity or above the known count", () => {
    const season = latestReleasedSeason(136315, seasons, "2026-08-16");
    expect(season).not.toBeNull();
    expect(isNewSeasonSince(season!, "2023-01-01T12:00:00.000Z", 1)).toBe(true);
    expect(isNewSeasonSince(season!, "2024-01-01T12:00:00.000Z", 2)).toBe(false);
    expect(isNewSeasonSince(season!, undefined, 1)).toBe(true);
  });
});
