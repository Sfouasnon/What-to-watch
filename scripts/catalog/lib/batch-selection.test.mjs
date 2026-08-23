import { describe, expect, it } from "vitest";

import {
  buildHydrationBatches,
  mergeCandidatePools,
  normalizeDiscoverCandidate,
  selectDiversifiedCandidates,
  validateHydrationManifest,
} from "./batch-selection.mjs";

const candidate = (id, mediaType = "movie", overrides = {}) => ({
  mediaType,
  tmdbId: id,
  name: `Title ${id}`,
  originalName: `Title ${id}`,
  releaseDate: "2020-01-01",
  year: 2020,
  overview: "A sufficiently descriptive overview for deterministic candidate selection.",
  genreIds: [id % 2 ? 18 : 35],
  originalLanguage: "en",
  popularity: 50 + id,
  voteAverage: 7,
  voteCount: 1000 + id,
  posterPath: `/poster-${id}.jpg`,
  adult: false,
  video: false,
  discoverySources: ["vote_count.desc"],
  ...overrides,
});

describe("catalog batch selection", () => {
  it("normalizes and merges duplicate discover results by TMDB identity", () => {
    const normalized = normalizeDiscoverCandidate({
      id: 10,
      title: "Movie",
      original_title: "Movie",
      release_date: "2020-01-01",
      overview: "Overview",
      genre_ids: [18],
      vote_count: 100,
    }, "movie", "vote_count.desc");
    const merged = mergeCandidatePools([[normalized], [{ ...normalized, voteCount: 200, discoverySources: ["popularity.desc"] }]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].voteCount).toBe(200);
    expect(merged[0].discoverySources).toEqual(["popularity.desc", "vote_count.desc"]);
  });

  it("selects deterministically while respecting exclusions and evidence requirements", () => {
    const pool = Array.from({ length: 12 }, (_, index) => candidate(index + 1));
    const options = { excludedIdentities: new Set(["movie:12"]), minimumVotes: 200 };
    const first = selectDiversifiedCandidates(pool, 6, options);
    const second = selectDiversifiedCandidates([...pool].reverse(), 6, options);
    expect(first.map((title) => title.tmdbId)).toEqual(second.map((title) => title.tmdbId));
    expect(first.some((title) => title.tmdbId === 12)).toBe(false);
  });

  it("enforces a bounded release-date window", () => {
    const pool = [
      candidate(1, "movie", { releaseDate: "2019-12-31", year: 2019 }),
      candidate(2, "movie", { releaseDate: "2020-01-01", year: 2020 }),
      candidate(3, "movie", { releaseDate: "2026-08-22", year: 2026 }),
      candidate(4, "movie", { releaseDate: "2026-08-23", year: 2026 }),
    ];
    const selected = selectDiversifiedCandidates(pool, 2, {
      minimumReleaseDate: "2020-01-01",
      maximumReleaseDate: "2026-08-22",
    });
    expect(selected.map((title) => title.tmdbId).sort()).toEqual([2, 3]);
  });

  it("builds balanced, unique batches and validates the manifest", () => {
    const movies = Array.from({ length: 9 }, (_, index) => candidate(index + 1, "movie"));
    const television = Array.from({ length: 9 }, (_, index) => candidate(index + 101, "tv"));
    const batches = buildHydrationBatches(movies, television, 6);
    expect(batches).toHaveLength(3);
    expect(batches.every((batch) => batch.movieCount === 3 && batch.tvCount === 3)).toBe(true);

    const manifest = { schemaVersion: "catalog-hydration-manifest-v1", titleCount: 18, batches };
    expect(validateHydrationManifest(manifest)).toEqual([]);
    manifest.batches[1].titles[0] = manifest.batches[0].titles[0];
    expect(validateHydrationManifest(manifest)).toContain("Duplicate title identity movie:1.");
  });
});
