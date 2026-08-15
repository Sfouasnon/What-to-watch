import { describe, expect, it } from "vitest";

import {
  FACTUAL_TITLE_FIELDS,
  MAX_CAST_CREDITS,
  assertFactualTitleFields,
  dateOrNull,
  factualTitleFields,
  genreLookupKey,
  mergePreservingExisting,
  normalizeCredits,
} from "./tmdb-mapping.mjs";

const CHECKED_AT = "2026-08-11T00:00:00.000Z";

const movieDetail = {
  title: "The Last House",
  original_title: "The Last House",
  overview: "A family sealed inside their home must survive.",
  release_date: "2026-01-16",
  runtime: 110,
  original_language: "en",
  production_countries: [{ iso_3166_1: "US" }, { iso_3166_1: "CA" }],
  poster_path: "/poster.jpg",
  backdrop_path: "/backdrop.jpg",
  popularity: 290.8148,
  vote_average: 6.56,
  vote_count: 209,
  genres: [{ id: 27, name: "Horror" }],
  external_ids: { imdb_id: "tt1234567" },
  credits: {
    cast: [
      { id: 11, name: "Greta Lee", character: "Nina", order: 0, profile_path: "/greta.jpg" },
      { id: 12, name: "Wagner Moura", character: "Paulo", order: 1, profile_path: null },
    ],
    crew: [
      { id: 21, name: "Louis Leterrier", job: "Director", profile_path: "/louis.jpg" },
      { id: 22, name: "Matthew Robinson", job: "Screenplay" },
      { id: 23, name: "Pål Ulvik Rokseth", job: "Director of Photography" },
      { id: 24, name: "Some Gaffer", job: "Gaffer" },
    ],
  },
};

const seriesDetail = {
  name: "Slow Horses",
  original_name: "Slow Horses",
  overview: "A dumping ground for MI5 rejects.",
  first_air_date: "2022-04-01",
  last_air_date: "2025-11-05",
  status: "Ended",
  episode_run_time: [46],
  number_of_seasons: 5,
  number_of_episodes: 30,
  original_language: "en",
  origin_country: ["GB"],
  poster_path: "/horses.jpg",
  backdrop_path: null,
  popularity: 88.2,
  vote_average: 8.1,
  vote_count: 1200,
  genres: [{ id: 18, name: "Drama" }],
  created_by: [{ id: 31, name: "Will Smith", profile_path: null }],
  credits: {
    cast: [{ id: 41, name: "Gary Oldman", character: "Jackson Lamb", order: 0 }],
    crew: [{ id: 42, name: "James Hawes", job: "Director" }],
  },
};

describe("dateOrNull", () => {
  it("accepts ISO calendar dates and rejects everything else", () => {
    expect(dateOrNull("2026-01-16")).toBe("2026-01-16");
    expect(dateOrNull("")).toBeNull();
    expect(dateOrNull(undefined)).toBeNull();
    expect(dateOrNull("2026")).toBeNull();
    expect(dateOrNull("2026-01-16T00:00:00Z")).toBeNull();
  });
});

describe("factualTitleFields", () => {
  it("maps a movie payload onto factual title columns only", () => {
    const row = factualTitleFields(movieDetail, "movie", CHECKED_AT);

    expect(row).toMatchObject({
      name: "The Last House",
      release_date: "2026-01-16",
      runtime_minutes: 110,
      episode_runtime_minutes: null,
      season_count: null,
      episode_count: null,
      production_countries: ["US", "CA"],
      poster_path: "/poster.jpg",
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: "tt1234567" },
      metadata_source: "tmdb",
      metadata_checked_at: CHECKED_AT,
    });
    expect(Object.keys(row).every((field) => FACTUAL_TITLE_FIELDS.includes(field))).toBe(true);
  });

  it("maps a series payload including season, episode and end-date facts", () => {
    const row = factualTitleFields(seriesDetail, "tv", CHECKED_AT);

    expect(row).toMatchObject({
      name: "Slow Horses",
      release_date: "2022-04-01",
      end_date: "2025-11-05",
      runtime_minutes: null,
      episode_runtime_minutes: 46,
      season_count: 5,
      episode_count: 30,
      production_countries: ["GB"],
      backdrop_path: null,
    });
  });

  it("leaves end_date null while a series is still running", () => {
    const running = { ...seriesDetail, status: "Returning Series" };
    expect(factualTitleFields(running, "tv", CHECKED_AT).end_date).toBeNull();
  });

  it("never emits editorial or scoring columns", () => {
    const row = factualTitleFields(movieDetail, "movie", CHECKED_AT);
    for (const forbidden of ["canonical_score", "bingeability_score", "content_type", "id", "tmdb_id"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
  });

  it("rejects a payload with no usable name", () => {
    expect(() => factualTitleFields({ ...movieDetail, title: null }, "movie", CHECKED_AT)).toThrow(/missing a title name/);
  });

  it("coerces absent or invalid numerics to null rather than zero", () => {
    const sparse = { ...movieDetail, runtime: 0, popularity: undefined, vote_count: null };
    const row = factualTitleFields(sparse, "movie", CHECKED_AT);
    expect(row.runtime_minutes).toBeNull();
    expect(row.popularity).toBeNull();
    expect(row.vote_count).toBeNull();
  });
});

describe("assertFactualTitleFields", () => {
  it("throws when a non-factual column sneaks into the patch", () => {
    expect(() => assertFactualTitleFields({ name: "x", canonical_score: 90 })).toThrow(
      /non-factual title columns: canonical_score/,
    );
  });

  it("returns the row unchanged when every column is factual", () => {
    const row = { name: "x", poster_path: "/y.jpg" };
    expect(assertFactualTitleFields(row)).toBe(row);
  });
});

describe("mergePreservingExisting", () => {
  it("drops null fields that would erase persisted metadata", () => {
    const merged = mergePreservingExisting(
      { name: "x", poster_path: null, overview: null, popularity: null },
      { poster_path: "/kept.jpg", overview: "kept" },
    );
    expect(merged).not.toHaveProperty("poster_path");
    expect(merged).not.toHaveProperty("overview");
    expect(merged.popularity).toBeNull();
  });

  it("keeps fresh values when TMDB supplies them", () => {
    const merged = mergePreservingExisting({ poster_path: "/fresh.jpg" }, { poster_path: "/stale.jpg" });
    expect(merged.poster_path).toBe("/fresh.jpg");
  });

  it("passes the fresh row through when nothing is persisted yet", () => {
    const fresh = { poster_path: null, name: "x" };
    expect(mergePreservingExisting(fresh, null)).toEqual(fresh);
  });
});

describe("normalizeCredits", () => {
  it("maps cast and crew onto the allowed title_credits departments", () => {
    const { people, credits } = normalizeCredits(movieDetail, "movie");

    expect(people).toContainEqual({ tmdb_id: 11, name: "Greta Lee", profile_path: "/greta.jpg" });
    expect(credits).toContainEqual({
      person_tmdb_id: 11,
      department: "acting",
      job: "Actor",
      character_name: "Nina",
      billing_order: 0,
    });
    expect(credits).toContainEqual({
      person_tmdb_id: 21,
      department: "directing",
      job: "Director",
      character_name: null,
      billing_order: null,
    });
    expect(credits.find((credit) => credit.person_tmdb_id === 22)?.department).toBe("writing");
    expect(credits.find((credit) => credit.person_tmdb_id === 23)?.department).toBe("cinematography");
  });

  it("ignores crew jobs outside the modelled departments", () => {
    const { credits } = normalizeCredits(movieDetail, "movie");
    expect(credits.some((credit) => credit.person_tmdb_id === 24)).toBe(false);
  });

  it("records series creators as writing credits", () => {
    const { credits } = normalizeCredits(seriesDetail, "tv");
    expect(credits).toContainEqual({
      person_tmdb_id: 31,
      department: "writing",
      job: "Creator",
      character_name: null,
      billing_order: null,
    });
  });

  it("ignores created_by on movies", () => {
    const { credits } = normalizeCredits({ ...movieDetail, created_by: [{ id: 99, name: "Nobody" }] }, "movie");
    expect(credits.some((credit) => credit.person_tmdb_id === 99)).toBe(false);
  });

  it("caps acting credits and keeps the top billing order", () => {
    const cast = Array.from({ length: MAX_CAST_CREDITS + 5 }, (_, index) => ({
      id: 100 + index,
      name: `Actor ${index}`,
      character: `Role ${index}`,
      order: MAX_CAST_CREDITS + 4 - index,
    }));
    const { credits } = normalizeCredits({ ...movieDetail, credits: { cast, crew: [] } }, "movie");
    const acting = credits.filter((credit) => credit.department === "acting");

    expect(acting).toHaveLength(MAX_CAST_CREDITS);
    expect(Math.max(...acting.map((credit) => credit.billing_order))).toBeLessThan(MAX_CAST_CREDITS);
  });

  it("collapses duplicates on the title_credits unique tuple", () => {
    const crew = [
      { id: 21, name: "Louis Leterrier", job: "Director" },
      { id: 21, name: "Louis Leterrier", job: "Director" },
    ];
    const { people, credits } = normalizeCredits({ ...movieDetail, credits: { cast: [], crew } }, "movie");

    expect(people).toHaveLength(1);
    expect(credits).toHaveLength(1);
  });

  it("skips people without a usable TMDB id or name", () => {
    const crew = [
      { id: null, name: "Ghost", job: "Director" },
      { id: 50, name: "", job: "Director" },
    ];
    const { people, credits } = normalizeCredits({ ...movieDetail, credits: { cast: [], crew } }, "movie");

    expect(people).toHaveLength(0);
    expect(credits).toHaveLength(0);
  });

  it("tolerates a payload with no credits at all", () => {
    const { people, credits } = normalizeCredits({ ...movieDetail, credits: undefined }, "movie");
    expect(people).toHaveLength(0);
    expect(credits).toHaveLength(0);
  });
});

describe("genreLookupKey", () => {
  it("namespaces TMDB genre ids by media type", () => {
    expect(genreLookupKey("movie", 27)).toBe("movie:27");
    expect(genreLookupKey("tv", 18)).toBe("tv:18");
    expect(genreLookupKey("movie", 18)).not.toBe(genreLookupKey("tv", 18));
  });
});
