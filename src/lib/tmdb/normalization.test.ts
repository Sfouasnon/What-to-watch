import { describe, expect, it } from "vitest";

import {
  normalizeTmdbAvailability,
  normalizeTmdbTitle,
  tmdbServiceId,
} from "./normalization";

const checkedAt = "2026-08-09T18:00:00.000Z";

describe("TMDB title normalization", () => {
  it("keeps movie and TV identities distinct and rejects people", () => {
    expect(normalizeTmdbTitle({
      id: 550,
      media_type: "movie",
      title: "Fight Club",
      release_date: "1999-10-15",
    })).toMatchObject({
      externalId: "tmdb:movie:550",
      contentType: "movie",
      title: "Fight Club",
      releaseYear: 1999,
    });
    expect(normalizeTmdbTitle({
      id: 1399,
      media_type: "tv",
      name: "Game of Thrones",
      first_air_date: "2011-04-17",
    })).toMatchObject({
      externalId: "tmdb:tv:1399",
      contentType: "tv_series",
      title: "Game of Thrones",
      releaseYear: 2011,
    });
    expect(normalizeTmdbTitle({ id: 1, media_type: "person", name: "Someone" })).toBeNull();
  });
});

describe("TMDB availability normalization", () => {
  it("normalizes Netflix, Hulu, and Disney+ flatrate offers as subscriptions", () => {
    const result = normalizeTmdbAvailability({
      providerId: 1,
      mediaType: "movie",
      region: "us",
      checkedAt,
      entry: {
        flatrate: [
          { provider_id: 8, provider_name: "Netflix", display_priority: 1 },
          { provider_id: 15, provider_name: "Hulu", display_priority: 2 },
          { provider_id: 337, provider_name: "Disney Plus", display_priority: 3 },
        ],
      },
    });
    expect(result.region).toBe("US");
    expect(result.offers.map(({ serviceId, kind }) => [serviceId, kind])).toEqual([
      ["netflix", "subscription"],
      ["hulu", "subscription"],
      ["disney-plus", "subscription"],
    ]);
    expect(result.offers.map(({ providerName }) => providerName)).toEqual(["Netflix", "Hulu", "Disney+"]);
  });

  it("never treats Amazon rental or purchase as a Prime Video entitlement", () => {
    const result = normalizeTmdbAvailability({
      providerId: 2,
      mediaType: "movie",
      region: "US",
      checkedAt,
      entry: {
        flatrate: [{ provider_id: 9, provider_name: "Amazon Prime Video" }],
        rent: [{ provider_id: 10, provider_name: "Amazon Video" }],
        buy: [{ provider_id: 10, provider_name: "Amazon Video" }],
      },
    });
    expect(result.offers.map(({ serviceId, kind }) => [serviceId, kind])).toEqual([
      ["prime-video", "subscription"],
      ["amazon-video", "rental"],
      ["amazon-video", "purchase"],
    ]);
    expect(result.offers.map(({ providerName }) => providerName)).toEqual([
      "Prime Video",
      "Amazon Video",
      "Amazon Video",
    ]);
    expect(tmdbServiceId({ provider_id: 9, provider_name: "Prime Video" }, "rental"))
      .toBe("amazon-video");
  });

  it("keeps Apple TV+ separate from Apple rental and buy offers", () => {
    const result = normalizeTmdbAvailability({
      providerId: 3,
      mediaType: "tv",
      region: "US",
      checkedAt,
      entry: {
        flatrate: [{ provider_id: 350, provider_name: "Apple TV" }],
        rent: [{ provider_id: 2, provider_name: "Apple TV" }],
        buy: [{ provider_id: 2, provider_name: "Apple TV" }],
      },
    });
    expect(result.mediaType).toBe("tv");
    expect(result.offers.map(({ serviceId, kind }) => [serviceId, kind])).toEqual([
      ["apple-tv-plus", "subscription"],
      ["apple-tv-store", "rental"],
      ["apple-tv-store", "purchase"],
    ]);
    expect(result.offers.map(({ providerName }) => providerName)).toEqual([
      "Apple TV+",
      "Apple TV",
      "Apple TV",
    ]);
  });

  it("merges free and ad-supported lists without duplicates and never invents prices", () => {
    const result = normalizeTmdbAvailability({
      providerId: 4,
      mediaType: "movie",
      region: "US",
      checkedAt,
      entry: {
        free: [{ provider_id: 386, provider_name: "Peacock" }],
        ads: [{ provider_id: 386, provider_name: "Peacock" }],
      },
    });
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ serviceId: "peacock", kind: "free" });
    expect(result.offers[0]).not.toHaveProperty("price");
  });

  it("returns an explicit empty offer list when a title is unavailable in the region", () => {
    const result = normalizeTmdbAvailability({
      providerId: 5,
      mediaType: "tv",
      region: "US",
      checkedAt,
    });
    expect(result).toMatchObject({ mediaType: "tv", region: "US", offers: [] });
  });
});
