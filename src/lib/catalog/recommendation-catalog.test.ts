import { describe, expect, it } from "vitest";

import {
  buildAppCatalogTitle,
  displayTitleName,
  GOLD_CATALOG_SIZE,
  normalizeGoldProviderName,
  type CatalogClassificationRow,
  type CatalogInputRow,
  type CatalogTitleRow,
} from "./recommendation-catalog";

const pulpFictionTitle: CatalogTitleRow = {
  id: "db-title-id",
  tmdb_id: 680,
  tmdb_media_type: "movie",
  content_type: "movie",
  name: "Pulp Fiction",
  overview: "Two hit men, a boxer, and other Los Angeles figures collide across interlocking stories.",
  runtime_minutes: 154,
  episode_runtime_minutes: null,
  season_count: null,
  original_language: "en",
  production_countries: ["US"],
  popularity: 83,
  vote_average: 8.49,
  vote_count: 29000,
  canonical_score: 0,
  poster_path: null,
  backdrop_path: null,
};

const pulpFictionInput: CatalogInputRow = {
  title_id: "db-title-id",
  tmdb_genres: ["Thriller", "Crime"],
  directors: ["Quentin Tarantino"],
  writers: ["Quentin Tarantino", "Roger Avary"],
  cinematographers: ["Andrzej Sekuła"],
  principal_cast: ["John Travolta", "Samuel L. Jackson", "Uma Thurman"],
  keywords: ["nonlinear timeline"],
  raw_payload: { sampled_streaming_providers: ["HBO Max", "Amazon Prime Video"] },
};

const pulpFictionClassification: CatalogClassificationRow = {
  title_id: "db-title-id",
  primary_subgenre: "crime-drama",
  secondary_subgenre: "crime-thriller",
  tone_tags: ["wry", "stylized", "visceral"],
  pacing: "fast",
  confidence: 1,
  review_status: "gold",
};

describe("recommendation catalog mapping", () => {
  it("keeps the promoted gold benchmark at exactly 100 titles", () => {
    expect(GOLD_CATALOG_SIZE).toBe(100);
  });

  it("normalizes sampled TMDB providers to the profile selection names", () => {
    expect(normalizeGoldProviderName("HBO Max")).toBe("Max");
    expect(normalizeGoldProviderName("Amazon Prime Video")).toBe("Prime Video");
    expect(normalizeGoldProviderName("Netflix")).toBe("Netflix");
  });

  it("softens multi-word all-caps API titles without damaging acronyms", () => {
    expect(displayTitleName("72 HOURS")).toBe("72 Hours");
    expect(displayTitleName("THE BEAR")).toBe("The Bear");
    expect(displayTitleName("RRR")).toBe("RRR");
  });

  it("maps a gold row into the existing app catalog contract", () => {
    const title = buildAppCatalogTitle(pulpFictionTitle, pulpFictionInput, pulpFictionClassification);

    expect(title).not.toBeNull();
    expect(title?.id).toBe("tmdb:movie:680");
    expect(title?.name).toBe("Pulp Fiction");
    expect(title?.year).toBe(1994);
    expect(title?.providers).toEqual(["Max", "Prime Video"]);
    expect(title?.genres).toEqual(["Thriller", "Crime"]);
    expect(title?.tags).toEqual(expect.arrayContaining(["crime-drama", "crime-thriller", "wry", "stylized", "visceral", "fast"]));
    expect(title?.primarySubgenre).toBe("crime-drama");
    expect(title?.secondarySubgenre).toBe("crime-thriller");
    expect(title?.toneTags).toEqual(["wry", "stylized", "visceral"]);
    expect(title?.pacing).toBe("fast");
    expect(title?.director).toBe("Quentin Tarantino");
    expect(title?.poster).toBe("/icons/icon-512.png");
    expect(title?.availabilityType).toBe("subscription");
  });

  it("validates cached cast references before exposing them to the app", () => {
    const title = buildAppCatalogTitle(pulpFictionTitle, {
      ...pulpFictionInput,
      raw_payload: { sampled_streaming_providers: ["Netflix"] },
    }, pulpFictionClassification, [{
          tmdbPersonId: 2231,
          name: "Samuel L. Jackson",
          billingOrder: 1,
          character: "Jules",
          references: [{
            externalId: "tmdb:movie:329",
            tmdbId: 329,
            mediaType: "movie",
            name: "Jurassic Park",
            year: 1993,
            popularity: 80,
            voteCount: 16000,
          }],
        }]);
    expect(title?.castContext[0]).toEqual(expect.objectContaining({
      tmdbPersonId: 2231,
      name: "Samuel L. Jackson",
      references: [expect.objectContaining({ name: "Jurassic Park" })],
    }));
  });
});
