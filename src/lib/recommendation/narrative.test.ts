import { describe, expect, it } from "vitest";

import { buildRecommendationNarrative, castReferenceSentence } from "./narrative";
import type { Profile, Title } from "./types";

const title: Title = {
  id: "tmdb:movie:949838",
  name: "72 Hours",
  year: 2026,
  contentType: "movie",
  synopsis: "To save his career, an ad exec joins a Miami bachelor party.",
  runtimeMinutes: 102,
  genres: ["Comedy", "Crime"],
  subgenres: ["buddy-comedy", "playful", "raunchy", "absurdist", "fast"],
  toneTags: ["buddy-comedy", "playful", "raunchy", "absurdist", "fast"],
  themes: [],
  pacing: "fast",
  countries: ["US"],
  languages: ["en"],
  directors: ["Tim Story"],
  writers: [],
  cinematographers: [],
  actors: ["Kevin Hart", "Marcello Hernández"],
  castContext: [
    { tmdbPersonId: 1, name: "Kevin Hart", billingOrder: 0, references: [
      { externalId: "tmdb:movie:11", tmdbId: 11, mediaType: "movie", name: "Jumanji", year: 2017, popularity: 80, voteCount: 12000 },
      { externalId: "tmdb:movie:12", tmdbId: 12, mediaType: "movie", name: "A More Popular Cameo", year: 2019, popularity: 200, voteCount: 50000 },
    ] },
    { tmdbPersonId: 2, name: "Marcello Hernández", billingOrder: 1, references: [{ externalId: "tmdb:tv:22", tmdbId: 22, mediaType: "tv", name: "Saturday Night Live", year: 1975, popularity: 50, voteCount: 500 }] },
  ],
  canonicalScore: 20,
  canonicalMemberships: [],
  criterionCollection: false,
  popularity: 71,
  trendingScore: 71,
  availability: [{ serviceId: "Netflix", region: "US", kind: "subscription", checkedAt: "2026-08-14", source: "tmdb" }],
};

const profile = (ratings: Profile["ratings"] = []): Profile => ({
  id: "p1",
  accountId: "a1",
  displayName: "Sam",
  avatar: "S",
  createdAt: "2026-08-14",
  onboardingCompleted: true,
  guest: false,
  region: "US",
  modelVersion: "1",
  subscriptions: ["Netflix"],
  rentalMode: "never",
  allowAdSupported: true,
  ratings,
  questionnaire: { dimensionScores: { broadComedy: 100 }, genreScores: { Comedy: 7 } },
  favoritePeople: { actors: [], directors: [], writers: [], cinematographers: [] },
});

describe("recommendation narratives", () => {
  it("blends tonight intent, title character, and supported personal preference", () => {
    const narrative = buildRecommendationNarrative({ title, profile: profile(), moods: ["comedy"], vibes: [], lane: "Best Bet" });
    expect(narrative.header).toContain("comedy you asked for");
    expect(narrative.fit).toContain("fast, playful buddy comedy with a raunchier edge");
    expect(narrative.fit).toContain("big, high-energy humor");
    expect(narrative.cast).toContain("Kevin Hart leads the cast and also appears in Jumanji");
    expect(narrative.setup).toBe(title.synopsis);
  });

  it("prefers a users own highly rated cast connection", () => {
    const sentence = castReferenceSentence(title, profile([{ titleId: "tmdb:tv:22", score: 9, watched: true, ratedAt: "2026-08-14" }]));
    expect(sentence).toBe("You rated Saturday Night Live 9/10, and Marcello Hernández appears here too.");
  });
});
