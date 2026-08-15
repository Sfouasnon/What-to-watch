import { describe, expect, it } from "vitest";

import { buildCastContext, rankReferenceCredits } from "./cast-context.mjs";

describe("TMDB cast context", () => {
  it("keeps recognizable, prominent released credits and excludes the current title", () => {
    const credits = [
      { id: 10, media_type: "movie", title: "Current", release_date: "2026-01-01", vote_count: 900, popularity: 80, order: 0 },
      { id: 20, media_type: "movie", title: "Recognizable Lead", release_date: "2020-01-01", vote_count: 4000, popularity: 60, order: 0 },
      { id: 30, media_type: "tv", name: "Future Show", first_air_date: "2028-01-01", vote_count: 1000, popularity: 90, order: 0 },
      { id: 40, media_type: "movie", title: "Tiny Cameo", release_date: "2021-01-01", vote_count: 1, popularity: 1, order: 45 },
    ];
    expect(rankReferenceCredits(credits, { currentTmdbId: 10, currentMediaType: "movie", maximumYear: 2026 }))
      .toEqual([expect.objectContaining({ externalId: "tmdb:movie:20", name: "Recognizable Lead" })]);
  });

  it("retains stable person IDs, billing order, and ranked references", () => {
    const credits = new Map([[7, [
      { id: 22, media_type: "tv", name: "Known Show", first_air_date: "2022-01-01", vote_count: 2000, popularity: 40, order: 1 },
    ]]]);
    expect(buildCastContext([{ id: 7, name: "Actor One", character: "Lead", order: 0 }], credits, {
      currentTmdbId: 10,
      currentMediaType: "movie",
      maximumYear: 2026,
    })).toEqual([{
      tmdbPersonId: 7,
      name: "Actor One",
      character: "Lead",
      billingOrder: 0,
      references: [expect.objectContaining({ externalId: "tmdb:tv:22", name: "Known Show" })],
    }]);
  });

  it("does not let a famous one-episode cameo outrank a substantial role", () => {
    const credits = [
      { id: 50, media_type: "tv", name: "Famous Sitcom Cameo", first_air_date: "2019-01-01", vote_count: 50000, popularity: 180, order: 60, episode_count: 1 },
      { id: 60, media_type: "tv", name: "Lead Series", first_air_date: "2020-01-01", vote_count: 1800, popularity: 35, order: 0, episode_count: 80 },
    ];
    expect(rankReferenceCredits(credits, { maximumYear: 2026 })).toEqual([
      expect.objectContaining({ name: "Lead Series" }),
    ]);
  });
});
