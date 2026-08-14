import { describe, expect, it } from "vitest";

import {
  actorOptionsForSubscriptions,
  filterTitlesForFavoriteActors,
  hasProminentActor,
} from "./actor-discovery";

const title = (
  id: string,
  cast: string[],
  providers: string[],
  availabilityType: "subscription" | "free" | "rental" = "subscription",
) => ({ id, cast, providers, availabilityType });

describe("favorite actor discovery", () => {
  it("matches only actors included in the prominent cast list", () => {
    const pulpFiction = title("pulp-fiction", ["John Travolta", "Samuel L. Jackson"], ["Prime Video"]);

    expect(hasProminentActor(pulpFiction, " samuel  l. jackson ")).toBe(true);
    expect(hasProminentActor(pulpFiction, "Christopher Walken")).toBe(false);
  });

  it("hard-filters results to the selected actor and subscribed services", () => {
    const catalog = [
      title("pulp-fiction", ["Samuel L. Jackson"], ["Prime Video"]),
      title("far-from-home", ["Samuel L. Jackson"], ["Disney+"]),
      title("unavailable", ["Samuel L. Jackson"], ["Max"]),
      title("rental", ["Samuel L. Jackson"], ["Prime Video"], "rental"),
      title("other-actor", ["Viola Davis"], ["Prime Video"]),
    ];

    expect(filterTitlesForFavoriteActors(catalog, ["Samuel L. Jackson"], ["Prime Video", "Disney+"])
      .map((item) => item.id)).toEqual(["pulp-fiction", "far-from-home"]);
  });

  it("builds actor choices only from subscription titles available to the profile", () => {
    const options = actorOptionsForSubscriptions([
      title("one", ["Samuel L. Jackson", "Uma Thurman"], ["Prime Video"]),
      title("two", ["Samuel L. Jackson"], ["Disney+"]),
      title("three", ["Viola Davis"], ["Max"]),
    ], ["Prime Video", "Disney+"]);

    expect(options).toEqual([
      { name: "Samuel L. Jackson", availableTitleCount: 2 },
      { name: "Uma Thurman", availableTitleCount: 1 },
    ]);
  });
});
