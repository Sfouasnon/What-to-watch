import { describe, expect, it } from "vitest";

import {
  buildAppCatalogTitle,
  displayTitleName,
  GOLD_CATALOG_SIZE,
  normalizeGoldProviderName,
  releaseYear,
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
  release_date: null,
  runtime_minutes: 154,
  episode_runtime_minutes: null,
  season_count: null,
  episode_count: null,
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

  it("falls back to the pilot sample year until TMDB hydration supplies a release date", () => {
    expect(releaseYear(pulpFictionTitle, { year: 1994 } as never)).toBe(1994);
  });

  it("prefers the hydrated release date over the pilot sample year", () => {
    const hydrated = { ...pulpFictionTitle, release_date: "1994-09-10" };
    expect(releaseYear(hydrated, { year: 1900 } as never)).toBe(1994);
    expect(buildAppCatalogTitle(hydrated, pulpFictionInput, pulpFictionClassification)?.year).toBe(1994);
  });

  it("ignores an unusable release date rather than emitting NaN", () => {
    for (const release_date of ["", "not-a-date", "0001-01-01"]) {
      expect(releaseYear({ ...pulpFictionTitle, release_date }, { year: 1994 } as never)).toBe(1994);
    }
  });

  it("serves hydrated TMDB artwork once poster and backdrop paths exist", () => {
    const hydrated = { ...pulpFictionTitle, poster_path: "/poster.jpg", backdrop_path: "/backdrop.jpg" };
    const title = buildAppCatalogTitle(hydrated, pulpFictionInput, pulpFictionClassification);

    expect(title?.poster).toBe("https://image.tmdb.org/t/p/w780/poster.jpg");
    expect(title?.backdrop).toBe("https://image.tmdb.org/t/p/w780/backdrop.jpg");
  });

  it("reuses the poster as a backdrop when TMDB has no backdrop", () => {
    const hydrated = { ...pulpFictionTitle, poster_path: "/poster.jpg" };
    const title = buildAppCatalogTitle(hydrated, pulpFictionInput, pulpFictionClassification);

    expect(title?.backdrop).toBe("https://image.tmdb.org/t/p/w780/poster.jpg");
  });

  it("keeps editorial tags sourced from the classification, not from hydrated metadata", () => {
    const hydrated = { ...pulpFictionTitle, release_date: "1994-09-10", poster_path: "/poster.jpg" };
    const before = buildAppCatalogTitle(pulpFictionTitle, pulpFictionInput, pulpFictionClassification);
    const after = buildAppCatalogTitle(hydrated, pulpFictionInput, pulpFictionClassification);

    expect(after?.tags).toEqual(before?.tags);
  });

  it("maps hydrated titles outside the original gold sample", () => {
    const title = buildAppCatalogTitle(
      {
        ...pulpFictionTitle,
        id: "expanded-title-id",
        tmdb_id: 999999,
        name: "EXPANDED CATALOG TITLE",
        release_date: "2025-06-01",
      },
      {
        ...pulpFictionInput,
        title_id: "expanded-title-id",
        raw_payload: {},
      },
      {
        ...pulpFictionClassification,
        title_id: "expanded-title-id",
        review_status: "accepted",
      },
      [],
      [{
        title_id: "expanded-title-id",
        provider_name: "Amazon Prime Video",
        offer_type: "subscription",
      }],
    );

    expect(title).toEqual(expect.objectContaining({
      id: "tmdb:movie:999999",
      name: "Expanded Catalog Title",
      year: 2025,
      providers: ["Prime Video"],
      availabilityType: "subscription",
    }));
  });

  it("keeps a classified catalog title even when no current US provider is known", () => {
    const title = buildAppCatalogTitle(
      { ...pulpFictionTitle, tmdb_id: 999998, release_date: "2024-01-01" },
      { ...pulpFictionInput, raw_payload: {} },
      { ...pulpFictionClassification, review_status: "accepted" },
    );

    expect(title?.providers).toEqual([]);
  });
});
