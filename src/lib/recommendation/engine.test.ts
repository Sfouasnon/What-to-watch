import { describe, expect, it } from "vitest";

import {
  defaultRecommendationConfig,
  questionnaireConfidence,
  recommendForProfile,
} from "./engine";
import {
  RECOMMENDATION_LANES,
  type AvailabilityOption,
  type Profile,
  type Title,
} from "./types";

const checkedAt = "2026-08-09T18:00:00.000Z";

function availability(serviceId = "netflix", kind: AvailabilityOption["kind"] = "subscription", region = "US"): AvailabilityOption {
  return { serviceId, region, kind, checkedAt, source: "demo" };
}

function title(id: string, overrides: Partial<Title> = {}): Title {
  return {
    id,
    name: id,
    year: 2020,
    contentType: "movie",
    synopsis: `${id} synopsis`,
    runtimeMinutes: 100,
    genres: ["Thriller"],
    subgenres: ["mystery"],
    toneTags: ["tense"],
    themes: ["identity"],
    pacing: "moderate",
    countries: ["US"],
    languages: ["en"],
    directors: ["Director A"],
    writers: ["Writer A"],
    cinematographers: ["DP A"],
    actors: ["Actor A"],
    canonicalScore: 55,
    canonicalMemberships: [],
    criterionCollection: false,
    popularity: 60,
    trendingScore: 60,
    availability: [availability()],
    ...overrides,
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "profile-1",
    accountId: "account-1",
    displayName: "Viewer",
    avatar: "V",
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

describe("availability and access", () => {
  it("strictly excludes titles outside the profile's services and region", () => {
    const picks = recommendForProfile({
      profile: profile(),
      catalog: [
        title("netflix"),
        title("hulu", { availability: [availability("hulu")] }),
        title("uk", { availability: [availability("netflix", "subscription", "GB")] }),
      ],
    });
    expect(picks.map((pick) => pick.title.id)).toEqual(["netflix"]);
  });

  it("does not mistake an Amazon purchase for Prime subscription access", () => {
    const picks = recommendForProfile({
      profile: profile({ subscriptions: ["prime-video"], rentalMode: "never" }),
      catalog: [
        title("prime", { availability: [availability("prime-video")] }),
        title("amazon-store", { availability: [availability("amazon-video", "purchase")] }),
      ],
    });
    expect(picks.map((pick) => pick.title.id)).toEqual(["prime"]);
  });

  it("admits only meaningfully stronger rentals in exceptional mode", () => {
    const included = title("included", { popularity: 65, canonicalScore: 65 });
    const weakRental = title("weak-rental", { popularity: 65, canonicalScore: 65, availability: [availability("apple-tv-store", "rental")] });
    const strongRental = title("strong-rental", {
      popularity: 100,
      canonicalScore: 100,
      directors: ["Fav Director"],
      availability: [availability("apple-tv-store", "rental")],
    });
    const viewer = profile({
      subscriptions: ["netflix"],
      ratings: [
        { titleId: "liked-director", score: 10, watched: true, ratedAt: checkedAt },
        { titleId: "liked-director-2", score: 10, watched: true, ratedAt: checkedAt },
      ],
    });
    const catalog = [
      included,
      weakRental,
      strongRental,
      title("liked-director", { directors: ["Fav Director"] }),
      title("liked-director-2", { directors: ["Fav Director"] }),
    ];
    const ids = recommendForProfile({ profile: viewer, catalog }).map((pick) => pick.title.id);
    expect(ids).toContain("included");
    expect(ids).toContain("strong-rental");
    expect(ids).not.toContain("weak-rental");
  });
});

describe("moods, watched state, and learned taste", () => {
  it("keeps stand-up separate from scripted comedy", () => {
    const standup = title("standup", { contentType: "stand-up", genres: ["Comedy"] });
    const comedy = title("comedy", { genres: ["Comedy"] });
    expect(recommendForProfile({ profile: profile(), catalog: [standup, comedy], moods: ["comedy"] }).map((pick) => pick.title.id)).toEqual(["comedy"]);
    expect(recommendForProfile({ profile: profile(), catalog: [standup, comedy], moods: ["stand-up"] }).map((pick) => pick.title.id)).toEqual(["standup"]);
  });

  it("excludes watched titles normally and selects favorites in rewatch mode", () => {
    const watched = title("watched");
    const unseen = title("unseen");
    const viewer = profile({ ratings: [{ titleId: "watched", score: 9, watched: true, ratedAt: checkedAt }] });
    expect(recommendForProfile({ profile: viewer, catalog: [watched, unseen] }).map((pick) => pick.title.id)).toEqual(["unseen"]);
    expect(recommendForProfile({ profile: viewer, catalog: [watched, unseen], vibes: ["rewatch-favorite"] }).map((pick) => pick.title.id)).toEqual(["watched"]);
  });

  it("learns creator affinity from repeated ratings", () => {
    const catalog = [
      title("liked-1", { directors: ["Fav"] }),
      title("liked-2", { directors: ["Fav"] }),
      title("candidate-fav", { directors: ["Fav"] }),
      title("candidate-other", { directors: ["Other"] }),
    ];
    const viewer = profile({ ratings: [
      { titleId: "liked-1", score: 9, watched: true, ratedAt: checkedAt },
      { titleId: "liked-2", score: 10, watched: true, ratedAt: checkedAt },
    ] });
    expect(recommendForProfile({ profile: viewer, catalog })[0].title.id).toBe("candidate-fav");
  });

  it("penalizes similarity to strongly disliked titles", () => {
    const disliked = title("disliked", { genres: ["Horror"], toneTags: ["bleak"] });
    const similar = title("similar", { genres: ["Horror"], toneTags: ["bleak"] });
    const different = title("different", { genres: ["Comedy"], toneTags: ["warm"] });
    const viewer = profile({ ratings: [{ titleId: "disliked", score: 2, watched: true, ratedAt: checkedAt }] });
    expect(recommendForProfile({ profile: viewer, catalog: [disliked, similar, different] })[0].title.id).toBe("different");
  });

  it("lets repeated behavior override a contradictory questionnaire prior", () => {
    const likedComedy = title("liked-comedy", { genres: ["Comedy"] });
    const comedy = title("comedy", { genres: ["Comedy"] });
    const drama = title("drama", { genres: ["Drama"] });
    const viewer = profile({
      ratings: Array.from({ length: 12 }, (_, index) => ({ titleId: `liked-${index}`, score: 9, watched: true, ratedAt: checkedAt })),
      questionnaire: { dimensionScores: {}, genreScores: { Comedy: 1, Drama: 7 } },
    });
    const catalog = [comedy, drama, ...viewer.ratings.map((rating) => title(rating.titleId, { genres: ["Comedy"] })), likedComedy];
    expect(recommendForProfile({ profile: viewer, catalog })[0].title.genres).toContain("Comedy");
  });

  it("never allows one profile's evidence to leak into another", () => {
    const catalog = [title("liked", { directors: ["Fav"] }), title("candidate", { directors: ["Fav"] }), title("other", { directors: ["Other"] })];
    const a = profile({ id: "a", ratings: [{ titleId: "liked", score: 10, watched: true, ratedAt: checkedAt }] });
    const b = profile({ id: "b" });
    expect(recommendForProfile({ profile: a, catalog })[0].title.id).toBe("candidate");
    expect(recommendForProfile({ profile: b, catalog })[0].title.id).not.toBe("liked");
  });
});

describe("editorial modes, ranking, and confidence", () => {
  it("treats Criterion association separately from Criterion Channel availability", () => {
    const associatedOnNetflix = title("criterion-film", { criterionCollection: true, availability: [availability("netflix")] });
    const merelyStreamingOnCriterion = title("criterion-stream", { availability: [availability("criterion-channel")] });
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

  it("returns a unique top ten without assigning unsupported semantic lanes", () => {
    const catalog = Array.from({ length: 13 }, (_, index) => title(`candidate-${String(index + 1).padStart(2, "0")}`, {
      popularity: 25 + index * 4,
      canonicalScore: index * 6,
      subgenres: [`subgenre-${index}`],
      directors: [`director-${index}`],
    }));
    const picks = recommendForProfile({ profile: profile(), catalog });
    expect(picks).toHaveLength(10);
    expect(new Set(picks.map((pick) => pick.title.id)).size).toBe(10);
    expect(picks[0].rank).toBe(1);
    expect(picks[9].rank).toBe(10);
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
