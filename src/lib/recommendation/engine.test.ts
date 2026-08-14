import { describe, expect, it } from "vitest";

import { demoCatalog, demoProfiles, demoSocial } from "./demo-data";
import {
  defaultRecommendationConfig,
  effectivePreference,
  importTunedConfiguration,
  questionnaireConfidence,
  recommendForProfile,
} from "./engine";
import { RECOMMENDATION_LANES, type Profile, type Rating, type SocialRecommendationInput, type Title } from "./types";

const NOW = "2026-08-08T00:00:00.000Z";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    accountId: "a1",
    displayName: "Test",
    avatar: "T",
    createdAt: NOW,
    onboardingCompleted: true,
    guest: false,
    region: "US",
    modelVersion: "1.0.0",
    subscriptions: ["netflix"],
    rentalMode: "never",
    allowAdSupported: false,
    ratings: [],
    favoritePeople: { actors: [], directors: [], writers: [], cinematographers: [] },
    ...overrides,
  };
}

function rating(titleId: string, score: number): Rating {
  return { titleId, score, watched: true, ratedAt: NOW };
}

function title(id: string, overrides: Partial<Title> = {}): Title {
  return {
    id,
    name: id.replaceAll("-", " "),
    year: 2020,
    contentType: "movie",
    synopsis: "Test fixture",
    runtimeMinutes: 105,
    genres: ["Thriller"],
    subgenres: ["Mystery"],
    toneTags: ["tense"],
    themes: ["identity"],
    pacing: "moderate",
    countries: ["US"],
    languages: ["en"],
    directors: ["Director Neutral"],
    writers: ["Writer Neutral"],
    cinematographers: ["DP Neutral"],
    actors: ["Actor Neutral"],
    canonicalScore: 20,
    canonicalMemberships: [],
    criterionCollection: false,
    popularity: 50,
    trendingScore: 20,
    availability: [{ serviceId: "netflix", region: "US", kind: "subscription", checkedAt: NOW, source: "demo" }],
    ...overrides,
  };
}

function social(overrides: Partial<SocialRecommendationInput> = {}): SocialRecommendationInput {
  return {
    now: NOW,
    friendProfiles: [{
      profileId: "friend-jane",
      displayName: "Jane",
      shareWithFriends: "ratings_and_reviews",
      ratings: [rating("overlap-a", 10), rating("overlap-b", 9), rating("social-pick", 10)],
    }],
    friendships: [{ requesterProfileId: "p1", addresseeProfileId: "friend-jane", status: "accepted" }],
    reviews: [{ authorProfileId: "friend-jane", titleId: "social-pick", note: "Best thing I have seen all week.", createdAt: NOW }],
    recommendations: [{ senderProfileId: "friend-jane", recipientProfileId: "p1", titleId: "social-pick", note: "The details in this are completely your thing.", createdAt: NOW }],
    ...overrides,
  };
}

describe("availability and content gates", () => {
  it("strictly excludes titles outside the profile's services and region", () => {
    const catalog = [
      title("included"),
      title("wrong-service", { availability: [{ serviceId: "hulu", region: "US", kind: "subscription", checkedAt: NOW, source: "demo" }] }),
      title("wrong-region", { availability: [{ serviceId: "netflix", region: "GB", kind: "subscription", checkedAt: NOW, source: "demo" }] }),
      title("unavailable", { availability: [] }),
    ];
    expect(recommendForProfile({ profile: profile(), catalog }).map((pick) => pick.title.id)).toEqual(["included"]);
  });

  it("does not mistake an Amazon purchase for Prime subscription access", () => {
    const result = recommendForProfile({
      profile: profile({ subscriptions: ["prime"], rentalMode: "never" }),
      catalog: [title("sold-on-amazon", { availability: [{ serviceId: "prime", region: "US", kind: "purchase", checkedAt: NOW, source: "demo", price: 14.99, currency: "USD" }] })],
    });
    expect(result).toEqual([]);
  });

  it("admits only meaningfully stronger rentals in exceptional mode", () => {
    const included = title("included", { canonicalScore: 0, popularity: 0 });
    const exceptional = title("exceptional-rental", {
      canonicalScore: 100,
      criterionCollection: true,
      popularity: 100,
      availability: [{ serviceId: "apple-store", region: "US", kind: "rental", checkedAt: NOW, source: "demo", price: 3.99, currency: "USD" }],
    });
    const weak = title("weak-rental", {
      canonicalScore: 0,
      popularity: 0,
      availability: [{ serviceId: "apple-store", region: "US", kind: "rental", checkedAt: NOW, source: "demo" }],
    });
    const picks = recommendForProfile({ profile: profile({ rentalMode: "exceptional" }), catalog: [included, exceptional, weak] });
    expect(picks.map((pick) => pick.title.id)).toContain("exceptional-rental");
    expect(picks.map((pick) => pick.title.id)).not.toContain("weak-rental");
    expect(picks.find((pick) => pick.title.id === "exceptional-rental")?.requiresPayment).toBe(true);
  });

  it("keeps stand-up separate from scripted comedy", () => {
    const standup = title("standup", { contentType: "stand-up", genres: ["Stand-Up"] });
    const comedy = title("comedy", { genres: ["Comedy"] });
    expect(recommendForProfile({ profile: profile(), catalog: [standup, comedy], moods: ["comedy"] }).map((pick) => pick.title.id)).toEqual(["comedy"]);
    expect(recommendForProfile({ profile: profile(), catalog: [standup, comedy], moods: ["stand-up"] }).map((pick) => pick.title.id)).toEqual(["standup"]);
  });
});

describe("personal taste behavior", () => {
  it("uses questionnaire dimensions independently from genre ratings", () => {
    const slow = title("slow", { pacing: "slow", toneTags: ["slow-burn"] });
    const fast = title("fast", { pacing: "fast", toneTags: ["fast"] });
    const viewer = profile({
      questionnaire: { dimensionScores: { slowPacing: 100 }, genreScores: { Thriller: 4 } },
    });
    expect(recommendForProfile({ profile: viewer, catalog: [fast, slow] })[0].title.id).toBe("slow");
  });

  it("keeps scripted comedy styles separate and never applies them to stand-up", () => {
    const dry = title("dry", { genres: ["Comedy"], toneTags: ["dry-comedy"] });
    const broad = title("broad", { genres: ["Comedy"], toneTags: ["slapstick"] });
    const standup = title("standup", { contentType: "stand-up", genres: ["Stand-Up"], toneTags: ["dry-comedy"] });
    const viewer = profile({
      questionnaire: { dimensionScores: { dryComedy: 100, broadComedy: 0 }, genreScores: {} },
    });
    const picks = recommendForProfile({ profile: viewer, catalog: [broad, standup, dry] });
    expect(picks[0].title.id).toBe("dry");
    expect(picks.find((pick) => pick.title.id === "standup")?.contributions.find((item) => item.feature === "questionnaire")?.value ?? 0).toBe(0);
  });

  it("separates psychological horror preference from gore tolerance", () => {
    const psychological = title("psychological", { genres: ["Horror"], toneTags: ["psychological-horror", "dread"] });
    const graphic = title("graphic", { genres: ["Horror"], toneTags: ["body-horror", "visceral"] });
    const viewer = profile({
      questionnaire: { dimensionScores: { psychologicalHorror: 100, goreTolerance: 0 }, genreScores: { Horror: 7 } },
    });
    expect(recommendForProfile({ profile: viewer, catalog: [graphic, psychological] })[0].title.id).toBe("psychological");
  });

  it("matches genre-matrix aliases and tag-level genres", () => {
    const historical = title("historical", { genres: ["History"], toneTags: ["based on true events"] });
    const darkComedy = title("dark-comedy", { genres: ["Comedy"], toneTags: ["dark comedy"] });
    const neutral = title("neutral", { genres: ["Drama"], toneTags: ["warm"] });
    const historicalViewer = profile({
      questionnaire: { dimensionScores: {}, genreScores: { Historical: 7, Drama: 4 } },
    });
    const comedyViewer = profile({
      questionnaire: { dimensionScores: {}, genreScores: { "Dark Comedy": 7, Comedy: 4, Drama: 4 } },
    });
    expect(recommendForProfile({ profile: historicalViewer, catalog: [neutral, historical] })[0].title.id).toBe("historical");
    expect(recommendForProfile({ profile: comedyViewer, catalog: [neutral, darkComedy] })[0].title.id).toBe("dark-comedy");
  });

  it("uses forced-choice pace, release, and familiarity tradeoffs", () => {
    const familiarSlowCanon = title("familiar-slow-canon", {
      pacing: "slow",
      canonicalScore: 90,
      trendingScore: 10,
    });
    const novelFastRelease = title("novel-fast-release", {
      pacing: "fast",
      canonicalScore: 10,
      trendingScore: 90,
      subgenres: ["Unfamiliar"],
      toneTags: ["new"],
    });
    const viewer = profile({
      questionnaire: {
        dimensionScores: {},
        genreScores: {},
        tradeoffScores: { pace: 1, release: 1, familiarity: 1 },
      },
    });
    expect(recommendForProfile({ profile: viewer, catalog: [familiarSlowCanon, novelFastRelease] })[0].title.id)
      .toBe("novel-fast-release");
  });

  it("excludes watched titles normally and selects favorites in rewatch mode", () => {
    const watched = title("watched");
    const unseen = title("unseen");
    const viewer = profile({ ratings: [rating("watched", 9)] });
    expect(recommendForProfile({ profile: viewer, catalog: [watched, unseen] }).map((pick) => pick.title.id)).toEqual(["unseen"]);
    expect(recommendForProfile({ profile: viewer, catalog: [watched, unseen], vibes: ["rewatch-favorite"] }).map((pick) => pick.title.id)).toEqual(["watched"]);
  });

  it("learns creator affinity from repeated ratings", () => {
    const catalog = [
      title("fincher-seen-1", { directors: ["David Fincher"] }),
      title("fincher-seen-2", { directors: ["David Fincher"] }),
      title("fincher-next", { directors: ["David Fincher"] }),
      title("other-next", { directors: ["Someone Else"] }),
    ];
    const viewer = profile({ ratings: [rating("fincher-seen-1", 10), rating("fincher-seen-2", 9)] });
    const picks = recommendForProfile({ profile: viewer, catalog, moods: ["thriller"] });
    expect(picks[0].title.id).toBe("fincher-next");
    expect(picks[0].explanation).toContain("David Fincher");
  });

  it("penalizes similarity to strongly disliked titles", () => {
    const disliked = title("disliked", {
      genres: ["Thriller"], subgenres: ["Home Invasion"], toneTags: ["cruel", "bleak"], themes: ["revenge"],
      directors: ["Bad Fit"], writers: ["Bad Fit"], cinematographers: ["Bad Fit"], actors: ["Bad Fit"],
    });
    const similar = title("similar", {
      genres: ["Thriller"], subgenres: ["Home Invasion"], toneTags: ["cruel", "bleak"], themes: ["revenge"],
      directors: ["Bad Fit"], writers: ["Bad Fit"], cinematographers: ["Bad Fit"], actors: ["Bad Fit"],
    });
    const different = title("different", { genres: ["Thriller"], subgenres: ["Political"], toneTags: ["cerebral"], themes: ["justice"] });
    const picks = recommendForProfile({ profile: profile({ ratings: [rating("disliked", 1)] }), catalog: [disliked, similar, different] });
    expect(picks[0].title.id).toBe("different");
    expect(picks.find((pick) => pick.title.id === "similar")?.contributions.some((item) => item.feature === "dislikedSimilarityPenalty")).toBe(true);
  });

  it("lets repeated behavior override a contradictory questionnaire prior", () => {
    const seen = [0, 1, 2, 3].map((index) => title(`horror-seen-${index}`, { genres: ["Horror"], toneTags: ["dark"] }));
    const horror = title("horror-next", { genres: ["Horror"], toneTags: ["dark"] });
    const neutral = title("neutral-next", { genres: ["Drama"] });
    const viewer = profile({
      ratings: seen.map((item) => rating(item.id, 10)),
      questionnaire: { dimensionScores: { horrorTolerance: 0 }, genreScores: { Horror: 1, Drama: 7 } },
    });
    const picks = recommendForProfile({ profile: viewer, catalog: [...seen, horror, neutral] });
    expect(picks[0].title.id).toBe("horror-next");
  });

  it("never allows one profile's evidence to leak into another", () => {
    const catalog = [
      title("a-seen-1", { directors: ["Director A"] }), title("a-seen-2", { directors: ["Director A"] }),
      title("b-seen-1", { directors: ["Director B"] }), title("b-seen-2", { directors: ["Director B"] }),
      title("a-next", { directors: ["Director A"] }), title("b-next", { directors: ["Director B"] }),
    ];
    const a = profile({ id: "a", ratings: [rating("a-seen-1", 10), rating("a-seen-2", 9), rating("b-seen-1", 2), rating("b-seen-2", 2)] });
    const b = profile({ id: "b", ratings: [rating("a-seen-1", 2), rating("a-seen-2", 2), rating("b-seen-1", 10), rating("b-seen-2", 9)] });
    expect(recommendForProfile({ profile: a, catalog })[0].title.id).toBe("a-next");
    expect(recommendForProfile({ profile: b, catalog })[0].title.id).toBe("b-next");
    expect(a.ratings).not.toBe(b.ratings);
  });

  it("hard-excludes explicit rejection and availability feedback", () => {
    const catalog = [title("already"), title("unwanted"), title("wrong-data"), title("gone"), title("eligible")];
    const feedback = [
      { titleId: "already", reason: "already-seen" as const },
      { titleId: "unwanted", reason: "not-interested" as const },
      { titleId: "wrong-data", reason: "misclassified" as const },
      { titleId: "gone", reason: "not-available" as const },
    ].map((item) => ({ ...item, profileId: "p1", modelVersion: "1", createdAt: NOW }));
    expect(recommendForProfile({ profile: profile(), catalog, feedback }).map((pick) => pick.title.id)).toEqual(["eligible"]);
  });

  it("keeps wrong-night feedback contextual instead of corrupting long-term taste", () => {
    const candidate = title("candidate");
    const feedback = [{
      profileId: "p1",
      titleId: candidate.id,
      modelVersion: "1",
      reason: "good-wrong-night" as const,
      context: { moods: ["thriller" as const], vibes: ["try-something-new" as const] },
      createdAt: NOW,
    }];
    expect(recommendForProfile({ profile: profile(), catalog: [candidate], moods: ["thriller"], vibes: ["try-something-new"], feedback })).toEqual([]);
    expect(recommendForProfile({ profile: profile(), catalog: [candidate], moods: ["thriller"], vibes: ["surprise-me"], feedback })).toHaveLength(1);
  });

  it("learns soft aversions and recommendation-quality scores from feedback", () => {
    const dark = title("dark", { toneTags: ["dark"], actors: ["Actor A"] });
    const light = title("light", { toneTags: ["warm"], actors: ["Actor B"] });
    const feedback = [
      { profileId: "p1", titleId: "dark", modelVersion: "1", reason: "too-dark" as const, createdAt: NOW },
      { profileId: "p1", titleId: "dark", modelVersion: "1", recommendationScore: 2, createdAt: NOW },
    ];
    const picks = recommendForProfile({ profile: profile(), catalog: [dark, light], feedback });
    expect(picks[0].title.id).toBe("light");
    expect(picks.find((pick) => pick.title.id === "dark")?.contributions.some((item) => item.feature === "feedbackMatch")).toBe(true);
  });
});

describe("editorial modes, ranking, and confidence", () => {
  it("treats Criterion association separately from Criterion Channel availability", () => {
    const associatedOnNetflix = title("criterion-film", { criterionCollection: true, canonicalScore: 80 });
    const merelyStreamingOnCriterion = title("channel-only", {
      criterionCollection: false,
      availability: [{ serviceId: "criterion-channel", region: "US", kind: "subscription", checkedAt: NOW, source: "demo" }],
    });
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

  it("returns a unique top ten with the exact escalating lane contract", () => {
    const catalog = Array.from({ length: 13 }, (_, index) => title(`candidate-${String(index + 1).padStart(2, "0")}`, {
      popularity: 25 + index * 4,
      canonicalScore: index * 6,
      subgenres: [`subgenre-${index}`],
      directors: [`director-${index}`],
    }));
    const picks = recommendForProfile({ profile: profile(), catalog });
    expect(picks).toHaveLength(10);
    expect(picks.map((pick) => pick.lane)).toEqual([...RECOMMENDATION_LANES]);
    expect(new Set(picks.map((pick) => pick.title.id)).size).toBe(10);
    expect(picks[0].rank).toBe(1);
    expect(picks[9].rank).toBe(10);
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
    expect(weights[3]).toBeGreaterThanOrEqual(defaultRecommendationConfig.questionnaireDecay.minimumWeight);
    expect(effectivePreference({ behavioralPreference: 1, behavioralEvidence: 20, questionnairePreference: -1, ratingCount: 100 })).toBeGreaterThan(0.7);
  });

  it("ships enough serializable demo inventory for a top ten", () => {
    const picks = recommendForProfile({ profile: demoProfiles[0], catalog: demoCatalog });
    expect(picks).toHaveLength(10);
    expect(() => JSON.parse(JSON.stringify({ catalog: demoCatalog, profiles: demoProfiles }))).not.toThrow();
  });
});

describe("friends as contextual recommendation evidence", () => {
  it("strongly incorporates an accepted friend's pick without replacing personal eligibility", () => {
    const viewer = profile({ ratings: [rating("overlap-a", 10), rating("overlap-b", 9)] });
    const picks = recommendForProfile({
      profile: viewer,
      catalog: [title("a-control"), title("social-pick")],
      moods: ["thriller"],
      vibes: ["friends-picks"],
      social: social(),
    });
    expect(picks[0].title.id).toBe("social-pick");
    expect(picks[0].friendContext).toMatchObject({
      headline: "Jane picked this for you",
      note: "The details in this are completely your thing.",
      rating: 10,
      explicit: true,
    });
    expect(picks[0].explanation).not.toContain("Jane");
  });

  it("shows friend context on ordinary picks without changing ordinary ranking", () => {
    const viewer = profile({ ratings: [rating("overlap-a", 10), rating("overlap-b", 9)] });
    const catalog = [title("a-control"), title("social-pick")];
    const baseline = recommendForProfile({ profile: viewer, catalog });
    const withFriends = recommendForProfile({ profile: viewer, catalog, social: social() });
    expect(withFriends.map((pick) => pick.title.id)).toEqual(baseline.map((pick) => pick.title.id));
    expect(withFriends.find((pick) => pick.title.id === "social-pick")?.friendContext?.headline).toBe("Jane picked this for you");
  });

  it("honors ratings-only and nothing privacy while preserving explicit notes", () => {
    const ratingsOnly = social({
      recommendations: [],
      friendProfiles: [{ profileId: "friend-jane", displayName: "Jane", shareWithFriends: "ratings_only", ratings: [rating("social-pick", 9)] }],
    });
    const ratingPick = recommendForProfile({ profile: profile(), catalog: [title("social-pick")], social: ratingsOnly })[0];
    expect(ratingPick.friendContext?.rating).toBe(9);
    expect(ratingPick.friendContext?.note).toBeUndefined();

    const hidden = social({
      friendProfiles: [{ profileId: "friend-jane", displayName: "Jane", shareWithFriends: "nothing", ratings: [rating("social-pick", 10)] }],
      recommendations: [],
    });
    expect(recommendForProfile({ profile: profile(), catalog: [title("social-pick")], social: hidden })[0].friendContext).toBeUndefined();

    const explicit = social({
      friendProfiles: [{ profileId: "friend-jane", displayName: "Jane", shareWithFriends: "nothing", ratings: [rating("social-pick", 10)] }],
      reviews: [],
    });
    const explicitContext = recommendForProfile({ profile: profile(), catalog: [title("social-pick")], social: explicit })[0].friendContext;
    expect(explicitContext?.note).toBe("The details in this are completely your thing.");
    expect(explicitContext?.rating).toBeUndefined();
  });

  it("ignores pending friendships and falls back cleanly when no evidence is eligible", () => {
    const catalog = [title("a-control"), title("social-pick"), title("z-control")];
    const baseline = recommendForProfile({ profile: profile(), catalog });
    const pending = social({ friendships: [{ requesterProfileId: "p1", addresseeProfileId: "friend-jane", status: "pending" }] });
    const picks = recommendForProfile({ profile: profile(), catalog, vibes: ["friends-picks"], social: pending });
    expect(picks.map((pick) => pick.title.id)).toEqual(baseline.map((pick) => pick.title.id));
    expect(picks.every((pick) => pick.friendContext === undefined)).toBe(true);
  });

  it("learns influence from actual overlapping ratings", () => {
    const viewer = profile({ ratings: [rating("overlap-a", 10), rating("overlap-b", 9)] });
    const compatibilitySocial: SocialRecommendationInput = {
      now: NOW,
      friendProfiles: [
        { profileId: "friend-low", displayName: "Low overlap", shareWithFriends: "nothing", ratings: [rating("overlap-a", 1), rating("overlap-b", 2)] },
        { profileId: "friend-high", displayName: "High overlap", shareWithFriends: "nothing", ratings: [rating("overlap-a", 10), rating("overlap-b", 9)] },
      ],
      friendships: [
        { requesterProfileId: "p1", addresseeProfileId: "friend-low", status: "accepted" },
        { requesterProfileId: "p1", addresseeProfileId: "friend-high", status: "accepted" },
      ],
      reviews: [],
      recommendations: [
        { senderProfileId: "friend-low", recipientProfileId: "p1", titleId: "a-low", createdAt: NOW },
        { senderProfileId: "friend-high", recipientProfileId: "p1", titleId: "z-high", createdAt: NOW },
      ],
    };
    const picks = recommendForProfile({ profile: viewer, catalog: [title("a-low"), title("z-high")], vibes: ["friends-picks"], social: compatibilitySocial });
    expect(picks[0].title.id).toBe("z-high");
  });

  it("never lets an explicit recommendation bypass watched, mood, or availability gates", () => {
    const viewer = profile({ ratings: [rating("watched", 9)] });
    const gateSocial = social({
      friendProfiles: [{ profileId: "friend-jane", displayName: "Jane", shareWithFriends: "nothing", ratings: [] }],
      reviews: [],
      recommendations: ["watched", "unavailable", "wrong-mood"].map((titleId) => ({ senderProfileId: "friend-jane", recipientProfileId: "p1", titleId, createdAt: NOW })),
    });
    const catalog = [
      title("watched"),
      title("unavailable", { availability: [] }),
      title("wrong-mood", { genres: ["Comedy"] }),
      title("eligible"),
    ];
    const picks = recommendForProfile({ profile: viewer, catalog, moods: ["thriller"], vibes: ["friends-picks"], social: gateSocial });
    expect(picks.map((pick) => pick.title.id)).toEqual(["eligible"]);
  });

  it("keeps the bundled social demo serializable", () => {
    expect(() => JSON.parse(JSON.stringify(demoSocial))).not.toThrow();
  });
});

describe("configuration import safety", () => {
  it("only imports allow-listed model configuration and cannot alter raw profile history", () => {
    const viewer = profile({ ratings: [rating("immutable", 9)] });
    const before = JSON.stringify(viewer);
    const tuned = importTunedConfiguration({
      configuration: {
        modelVersion: "2.1.0",
        weights: { directorAffinity: 13, maliciousWeight: 999 },
        thresholds: { maxRecommendations: 999 },
      },
      ratings: [{ titleId: "immutable", score: 1 }],
      watchedHistory: [],
      recommendationHistory: [],
      rawFeedback: [],
      profile: { ratings: [] },
    });
    expect(tuned.modelVersion).toBe("2.1.0");
    expect(tuned.weights.directorAffinity).toBe(13);
    expect(tuned.thresholds.maxRecommendations).toBe(10);
    expect("maliciousWeight" in tuned.weights).toBe(false);
    expect(JSON.stringify(viewer)).toBe(before);
  });
});
