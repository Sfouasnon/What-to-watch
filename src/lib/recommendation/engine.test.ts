import { describe, expect, it } from "vitest";

import {
  RECOMMENDATION_LANES,
  type AvailabilityOption,
  type Profile,
  type Title,
} from "./types";
import {
  defaultRecommendationConfig,
  questionnaireConfidence,
  recommendForProfile,
} from "./engine";

const checkedAt = "2026-08-09T18:00:00.000Z";

function offer(serviceId: string, kind: AvailabilityOption["kind"] = "subscription"): AvailabilityOption {
  return { serviceId, region: "US", kind, checkedAt, source: "demo" };
}

function title(id: string, overrides: Partial<Title> = {}): Title {
  return {
    id,
    name: id,
    year: 2020,
    contentType: "movie",
    synopsis: "Synopsis",
    genres: ["thriller"],
    subgenres: [],
    toneTags: [],
    themes: [],
    pacing: "moderate",
    countries: ["US"],
    languages: ["en"],
    directors: [],
    writers: [],
    cinematographers: [],
    actors: [],
    canonicalScore: 50,
    canonicalMemberships: [],
    criterionCollection: false,
    popularity: 50,
    trendingScore: 50,
    availability: [offer("netflix")],
    ...overrides,
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "profile-a",
    accountId: "account-a",
    displayName: "A",
    avatar: "A",
    createdAt: checkedAt,
    onboardingCompleted: true,
    guest: false,
    region: "US",
    modelVersion: "1.0.0",
    subscriptions: ["netflix"],
    rentalMode: "exceptional",
    allowAdSupported: true,
    ratings: [],
    questionnaire: { dimensionScores: {}, genreScores: {} },
    favoritePeople: { actors: [], directors: [], writers: [], cinematographers: [] },
    ...overrides,
  };
}

describe("recommendation eligibility and scoring", () => {
  it("strictly excludes titles outside the profile's services and region", () => {
    const picks = recommendForProfile({
      profile: profile(),
      catalog: [
        title("on-netflix"),
        title("on-hulu", { availability: [offer("hulu")] }),
        title("wrong-region", { availability: [{ ...offer("netflix"), region: "GB" }] }),
      ],
    });
    expect(picks.map((pick) => pick.title.id)).toEqual(["on-netflix"]);
  });

  it("does not mistake an Amazon purchase for Prime subscription access", () => {
    const picks = recommendForProfile({
      profile: profile({ subscriptions: ["prime-video"], rentalMode: "never" }),
      catalog: [title("purchase", { availability: [offer("amazon-video", "purchase")] })],
    });
    expect(picks).toHaveLength(0);
  });

  it("admits only meaningfully stronger rentals in exceptional mode", () => {
    const included = title("included", { canonicalScore: 25 });
    const ordinaryRental = title("ordinary-rental", { canonicalScore: 25, availability: [offer("apple-tv-store", "rental")] });
    const exceptionalRental = title("exceptional-rental", {
      canonicalScore: 100,
      genres: ["thriller", "drama"],
      availability: [offer("apple-tv-store", "rental")],
    });
    const picks = recommendForProfile({ profile: profile(), catalog: [included, ordinaryRental, exceptionalRental] });
    expect(picks.map((pick) => pick.title.id)).not.toContain("ordinary-rental");
  });

  it("keeps stand-up separate from scripted comedy", () => {
    const comedy = title("scripted-comedy", { genres: ["comedy"] });
    const standup = title("standup", { contentType: "stand-up", genres: ["comedy"] });
    expect(recommendForProfile({ profile: profile(), catalog: [comedy, standup], moods: ["comedy"] }).map((pick) => pick.title.id)).toEqual(["scripted-comedy"]);
    expect(recommendForProfile({ profile: profile(), catalog: [comedy, standup], moods: ["stand-up"] }).map((pick) => pick.title.id)).toEqual(["standup"]);
  });

  it("excludes watched titles normally and selects favorites in rewatch mode", () => {
    const watched = title("watched");
    const p = profile({ ratings: [{ titleId: "watched", score: 9, watched: true, ratedAt: checkedAt }] });
    expect(recommendForProfile({ profile: p, catalog: [watched] })).toHaveLength(0);
    expect(recommendForProfile({ profile: p, catalog: [watched], vibes: ["rewatch-favorite"] }).map((pick) => pick.title.id)).toEqual(["watched"]);
  });

  it("learns creator affinity from repeated ratings", () => {
    const seedA = title("seed-a", { directors: ["Director"] });
    const seedB = title("seed-b", { directors: ["Director"] });
    const candidate = title("candidate", { directors: ["Director"] });
    const control = title("control");
    const p = profile({ ratings: [
      { titleId: seedA.id, score: 9, watched: true, ratedAt: checkedAt },
      { titleId: seedB.id, score: 9, watched: true, ratedAt: checkedAt },
    ] });
    const picks = recommendForProfile({ profile: p, catalog: [seedA, seedB, candidate, control] });
    expect(picks.findIndex((pick) => pick.title.id === "candidate")).toBeLessThan(picks.findIndex((pick) => pick.title.id === "control"));
  });

  it("penalizes similarity to strongly disliked titles", () => {
    const disliked = title("disliked", { subgenres: ["same"] });
    const similar = title("similar", { subgenres: ["same"] });
    const different = title("different", { subgenres: ["other"] });
    const p = profile({ ratings: [{ titleId: disliked.id, score: 2, watched: true, ratedAt: checkedAt }] });
    const picks = recommendForProfile({ profile: p, catalog: [disliked, similar, different] });
    expect(picks[0].title.id).toBe("different");
  });

  it("lets repeated behavior override a contradictory questionnaire prior", () => {
    const likedA = title("liked-a", { genres: ["drama"] });
    const likedB = title("liked-b", { genres: ["drama"] });
    const candidate = title("candidate", { genres: ["drama"] });
    const p = profile({
      ratings: [
        { titleId: likedA.id, score: 10, watched: true, ratedAt: checkedAt },
        { titleId: likedB.id, score: 10, watched: true, ratedAt: checkedAt },
      ],
      questionnaire: { dimensionScores: {}, genreScores: { Drama: 1 } },
    });
    const picks = recommendForProfile({ profile: p, catalog: [likedA, likedB, candidate] });
    expect(picks[0].title.id).toBe("candidate");
  });

  it("never allows one profile's evidence to leak into another", () => {
    const seed = title("seed", { directors: ["Director"] });
    const candidate = title("candidate", { directors: ["Director"] });
    const a = profile({ id: "a", ratings: [{ titleId: seed.id, score: 10, watched: true, ratedAt: checkedAt }] });
    const b = profile({ id: "b" });
    const catalog = [seed, candidate];
    const scoreA = recommendForProfile({ profile: a, catalog })[0]?.rawScore ?? 0;
    const scoreB = recommendForProfile({ profile: b, catalog })[0]?.rawScore ?? 0;
    expect(scoreA).toBeGreaterThan(scoreB);
  });
});

describe("editorial modes, ranking, and confidence", () => {
  it("treats Criterion association separately from Criterion Channel availability", () => {
    const associatedOnNetflix = title("criterion-film", { criterionCollection: true, availability: [offer("netflix")] });
    const merelyStreamingOnCriterion = title("streaming-only", { availability: [offer("criterion-channel")] });
    const picks = recommendForProfile({
      profile: profile({ subscriptions: ["netflix", "criterion-channel"] }),
      catalog: [associatedOnNetflix, merelyStreamingOnCriterion],
      vibes: ["criterion-pick"],
    });
    expect(picks.map((pick) => pick.title.id)).toEqual(["criterion-film"]);
    expect(picks[0].evidence.join(" ")).toContain("Criterion-associated");
  });

  it("gates canonical modes to significant titles", () => {
    const classic = title("classic", { year: 1968, canonicalScore: 90 });
    const merelyOld = title("merely-old", { year: 1968, canonicalScore: 10 });
    expect(recommendForProfile({ profile: profile(), catalog: [classic, merelyOld], vibes: ["rediscover-classic"] }).map((pick) => pick.title.id)).toEqual(["classic"]);
  });

  it("returns unique ranked picks without assigning unsupported semantic lanes", () => {
    const catalog = Array.from({ length: 13 }, (_, index) => title(`candidate-${String(index + 1).padStart(2, "0")}`, {
      popularity: 25 + index * 4,
      canonicalScore: index * 6,
      subgenres: [`subgenre-${index}`],
      directors: [`director-${index}`],
    }));
    const picks = recommendForProfile({ profile: profile(), catalog });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(10);
    expect(new Set(picks.map((pick) => pick.title.id)).size).toBe(picks.length);
    expect(new Set(picks.map((pick) => pick.lane)).size).toBe(picks.length);
    expect(picks.map((pick) => pick.rank)).toEqual(Array.from({ length: picks.length }, (_, index) => index + 1));
    expect(picks.every((pick) => RECOMMENDATION_LANES.includes(pick.lane))).toBe(true);

    for (const pick of picks) {
      if (pick.lane === "Creator Match") {
        expect(pick.contributions.some((contribution) =>
          ["directorAffinity", "writerAffinity", "cinematographerAffinity", "actorAffinity"].includes(contribution.feature) && contribution.value > 0,
        )).toBe(true);
      }
      if (pick.lane === "Hidden Gem") {
        expect(pick.title.popularity).toBeLessThanOrEqual(55);
      }
      if (pick.lane === "Film School Pick") {
        expect(pick.title.canonicalScore).toBeGreaterThanOrEqual(65);
      }
    }
  });

  it("provides evidence-based explanations plus separate raw and normalized scores", () => {
    const picks = recommendForProfile({ profile: profile(), catalog: [title("one")], moods: ["thriller"] });
    expect(picks[0].explanation.length).toBeGreaterThan(10);
    expect(picks[0].evidence.length).toBeGreaterThan(0);
    expect(Number.isFinite(picks[0].rawScore)).toBe(true);
    expect(picks[0].normalizedScore).toBeGreaterThanOrEqual(0);
    expect(picks[0].normalizedScore).toBeLessThanOrEqual(1);
    expect(picks[0].matchScore).toBeGreaterThanOrEqual(defaultRecommendationConfig.normalization.minimumDisplayMatch);
  });

  it("uses one monotonic mathematical confidence decay", () => {
    const weights = [0, 10, 50, 100].map((count) => questionnaireConfidence(count));
    expect(weights[0]).toBeCloseTo(defaultRecommendationConfig.questionnaireDecay.initialWeight);
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    expect(weights[2]).toBeGreaterThan(weights[3]);
  });
});
