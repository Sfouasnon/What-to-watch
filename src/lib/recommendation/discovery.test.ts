import { describe, expect, it } from "vitest";

import {
  canonicalTitleKey,
  dedupeTitles,
  newReleasePool,
  newReleaseScore,
  suggestPerson,
  assemblePersonRecommendations,
  type DiscoveryTitle,
} from "./discovery";
import type { Recommendation } from "./types";

const makeTitle = (overrides: Partial<DiscoveryTitle> & Pick<DiscoveryTitle, "id">): DiscoveryTitle => ({
  kind: "Movie",
  year: 2026,
  releaseDate: "2026-06-01",
  popularity: 50,
  director: "Director One",
  cast: ["Actor One"],
  ...overrides,
});

describe("discovery selectors", () => {
  const now = Date.parse("2026-08-22T00:00:00Z");

  it("uses recent released titles and excludes future releases", () => {
    const recent = makeTitle({ id: "recent", releaseDate: "2026-08-01", popularity: 20 });
    const older = makeTitle({ id: "older", releaseDate: "2025-10-01", popularity: 99 });
    const future = makeTitle({ id: "future", releaseDate: "2026-09-01", popularity: 100 });

    expect(newReleasePool([older, future, recent], now).map((title) => title.id)).toEqual(["recent"]);
  });

  it("adds bounded recency and popularity boosts to personalized fit", () => {
    const recentPopular = makeTitle({ id: "recent", releaseDate: "2026-08-20", popularity: 90 });
    const olderQuiet = makeTitle({ id: "older", releaseDate: "2026-05-01", popularity: 10 });

    expect(newReleaseScore(recentPopular, 80, now)).toBeGreaterThan(newReleaseScore(olderQuiet, 80, now));
    expect(newReleaseScore(olderQuiet, 92, now)).toBeGreaterThan(newReleaseScore(recentPopular, 80, now));
  });

  it("learns actor and director suggestions from positive ratings", () => {
    const liked = makeTitle({ id: "liked", director: "Jane Director", cast: ["Alex Actor"], popularity: 30 });
    const disliked = makeTitle({ id: "disliked", director: "Other Director", cast: ["Other Actor"], popularity: 99 });

    expect(suggestPerson("actor", { liked: 9, disliked: 2 }, [liked, disliked], [])).toBe("Alex Actor");
    expect(suggestPerson("director", { liked: 9, disliked: 2 }, [liked, disliked], [])).toBe("Jane Director");
  });

  it("prefers TMDB identity and falls back to normalized kind, name, and year", () => {
    expect(canonicalTitleKey({ id: "one", tmdbId: 42, kind: "Movie", name: "Same", year: 2020 }))
      .toBe("movie:tmdb:42");
    expect(canonicalTitleKey({ id: "one", kind: "Movie", name: "  The O\u2019Clock  ", year: 2020 }))
      .toBe("movie:name:the oclock:2020");
    expect(canonicalTitleKey({ id: "one", kind: "Series", name: "Same", year: 2020 }))
      .not.toBe(canonicalTitleKey({ id: "two", kind: "Movie", name: "Same", year: 2020 }));
  });

  it("removes duplicate title identities while preserving first-ranked order", () => {
    const first = makeTitle({ id: "first", name: "Arrival", tmdbId: 11 });
    const duplicate = makeTitle({ id: "duplicate", name: "Arrival (2016)", tmdbId: 11 });
    const fallback = makeTitle({ id: "fallback", name: "The Fall", year: 2006 });
    const fallbackDuplicate = makeTitle({ id: "fallback-duplicate", name: "  the fall ", year: 2006 });

    expect(dedupeTitles([first, duplicate, fallback, fallbackDuplicate]).map((title) => title.id))
      .toEqual(["first", "fallback"]);
  });

  it("keeps exact person matches first and labels inspired fill-ins", () => {
    const recommendation = (id: string): Recommendation => ({
      rank: 1,
      lane: "Best Bet",
      title: {
        id,
        name: id,
        year: 2026,
        contentType: "movie",
        synopsis: "",
        genres: [], subgenres: [], toneTags: [], themes: [], pacing: "moderate",
        countries: ["US"], languages: ["en"], directors: ["Director"], writers: [], cinematographers: [], actors: ["Actor"],
        canonicalScore: 0, canonicalMemberships: [], criterionCollection: false, popularity: 1, trendingScore: 1,
        availability: [],
      },
      rawScore: 1, normalizedScore: 1, matchScore: 60, explanation: "", narrative: { header: "", heading: "", fit: "", setup: "" },
      evidence: [], contributions: [], availability: [], primaryAvailability: { serviceId: "x", region: "US", kind: "free", checkedAt: "", source: "demo" },
      requiresPayment: false, modelVersion: "1",
    });
    const result = assemblePersonRecommendations(
      [recommendation("exact")],
      [recommendation("inspired"), recommendation("exact")],
      { person: "Steven Spielberg", role: "director", limit: 2 },
    );
    expect(result.map((item) => item.title.id)).toEqual(["exact", "inspired"]);
    expect(result[0].personMatch?.kind).toBe("exact");
    expect(result[1].personMatch?.note).toContain("Not directed by Steven Spielberg");
  });
});
