import { describe, expect, it } from "vitest";

import { tmdbDetailsToDomainTitle } from "./domain";
import type { TmdbTitleDetails } from "./types";

function details(overrides: Partial<TmdbTitleDetails> = {}): TmdbTitleDetails {
  return {
    externalId: "tmdb:movie:680",
    provider: "tmdb",
    providerId: 680,
    mediaType: "movie",
    contentType: "movie",
    title: "Pulp Fiction",
    originalTitle: "Pulp Fiction",
    overview: "",
    releaseDate: "1994-10-14",
    releaseYear: 1994,
    originalLanguage: "en",
    posterUrl: null,
    backdropUrl: null,
    popularity: 80,
    voteAverage: 8.5,
    voteCount: 28000,
    runtimeMinutes: 154,
    episodeRuntimeMinutes: null,
    seasonCount: null,
    completed: true,
    genres: [{ id: 35, name: "Comedy" }, { id: 53, name: "Thriller" }],
    keywords: ["crime", "nonlinear"],
    countries: ["US"],
    languages: ["en"],
    directors: ["Quentin Tarantino"],
    writers: ["Quentin Tarantino"],
    cinematographers: ["Andrzej Sekula"],
    cast: ["John Travolta"],
    availability: {
      providerId: 680,
      mediaType: "movie",
      region: "US",
      sourceLink: null,
      checkedAt: "2026-08-09T00:00:00.000Z",
      offers: [],
    },
    ...overrides,
  };
}

describe("TMDB recommendation-domain enrichment", () => {
  it("uses curated primary family instead of broad TMDB genres when gold-set data exists", () => {
    const title = tmdbDetailsToDomainTitle(details());
    expect(title.genres).toEqual(["comedy"]);
    expect(title.subgenres[0]).toBe("dark-comedy");
    expect(title.editorial).toMatchObject({
      primaryFamily: "comedy",
      primarySubgenre: "dark-comedy",
      source: "gold-set",
    });
  });

  it("keeps TMDB genres as an explicit fallback outside the curated set", () => {
    const title = tmdbDetailsToDomainTitle(details({
      externalId: "tmdb:movie:999999999",
      providerId: 999999999,
      title: "Uncurated title",
    }));
    expect(title.genres).toEqual(["Comedy", "Thriller"]);
    expect(title.editorial).toBeUndefined();
  });
});
