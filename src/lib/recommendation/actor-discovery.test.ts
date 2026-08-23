import { describe, expect, it } from "vitest";

import {
  actorOptionsForSubscriptions,
  defaultActorOptionsForSubscriptions,
  directorOptionsForSubscriptions,
  filterTitlesForFavoriteDirectors,
  filterTitlesForFavoriteActors,
  hasProminentActor,
  hasProminentDirector,
  leadTitlesForActors,
  representativeTitlesForDirectors,
} from "./actor-discovery";

const title = (
  id: string,
  cast: string[],
  providers: string[],
  availabilityType: "subscription" | "free" | "rental" = "subscription",
  extra: Record<string, unknown> = {},
) => ({ id, cast, providers, availabilityType, ...extra });

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

  it("uses the published catalog when a questionnaire-only profile has not configured services", () => {
    const catalog = [
      title("film", ["Viola Davis"], ["Netflix"]),
      title("series", ["Denzel Washington"], [], "free", { director: "Spike Lee" }),
      title("unknown", [], [], "free", { director: "Unknown director" }),
    ];

    expect(actorOptionsForSubscriptions(catalog, []).map((option) => option.name))
      .toEqual(["Denzel Washington", "Viola Davis"]);
    expect(filterTitlesForFavoriteActors(catalog, ["Viola Davis"], []).map((item) => item.id))
      .toEqual(["film"]);
    expect(directorOptionsForSubscriptions(catalog, [])).toEqual([
      { name: "Spike Lee", availableTitleCount: 1 },
    ]);
    expect(filterTitlesForFavoriteDirectors(catalog, ["Spike Lee"], []).map((item) => item.id))
      .toEqual(["series"]);
  });

  it("enforces a prominent billing cutoff when cast context is available", () => {
    const film = title("film", ["Lead Actor", "Cameo Actor"], ["Prime Video"], "subscription", {
      castContext: [
        { name: "Lead Actor", billingOrder: 1 },
        { name: "Cameo Actor", billingOrder: 20 },
      ],
    });

    expect(hasProminentActor(film, "Lead Actor")).toBe(true);
    expect(hasProminentActor(film, "Cameo Actor")).toBe(false);
    expect(actorOptionsForSubscriptions([film], ["Prime Video"])).toEqual([
      { name: "Lead Actor", availableTitleCount: 1 },
    ]);
  });

  it("chooses actor artwork from the title where the actor is billed highest", () => {
    const supportingRole = title("popular-supporting", ["Lead Actor", "Featured Actor"], ["Prime Video"], "subscription", {
      name: "Popular Supporting Role",
      popularity: 100,
      castContext: [
        { name: "Lead Actor", billingOrder: 0 },
        { name: "Featured Actor", billingOrder: 3 },
      ],
    });
    const leadRole = title("less-popular-lead", ["Featured Actor"], ["Prime Video"], "subscription", {
      name: "Less Popular Lead Role",
      popularity: 20,
      castContext: [{ name: "Featured Actor", billingOrder: 0 }],
    });

    expect(leadTitlesForActors([supportingRole, leadRole], ["Featured Actor"]).get("Featured Actor")?.id)
      .toBe("less-popular-lead");
  });

  it("seeds a mixed actor grid when those names exist, then fills to ten by evidence", () => {
    const seeded = ["Denzel Washington", "Viola Davis", "Oscar Isaac", "Cate Blanchett"];
    const catalog = [...seeded, ...Array.from({ length: 9 }, (_, index) => `Ranked Actor ${index + 1}`)]
      .map((name, index) => title(`title-${index}`, [name], ["Prime Video"]));

    expect(defaultActorOptionsForSubscriptions(catalog, ["Prime Video"], 10).map((option) => option.name))
      .toEqual([
        "Viola Davis",
        "Cate Blanchett",
        "Denzel Washington",
        "Oscar Isaac",
        "Ranked Actor 1",
        "Ranked Actor 2",
        "Ranked Actor 3",
        "Ranked Actor 4",
        "Ranked Actor 5",
        "Ranked Actor 6",
      ]);
  });

  it("supports director filtering and distinct director options", () => {
    const kurosawa = title("seven-samurai", ["Toshiro Mifune"], ["Criterion Channel"], "subscription", {
      director: "Akira Kurosawa",
      directors: ["Akira Kurosawa"],
    });
    const other = title("ran", ["Tatsuya Nakadai"], ["Criterion Channel"], "subscription", {
      director: "Akira Kurosawa",
      directors: ["Akira Kurosawa", "Second Unit"],
    });

    expect(hasProminentDirector(kurosawa, " akira  kurosawa ")).toBe(true);
    expect(filterTitlesForFavoriteDirectors([kurosawa, other], ["Akira Kurosawa"], ["Criterion Channel"])
      .map((item) => item.id)).toEqual(["seven-samurai", "ran"]);
    expect(directorOptionsForSubscriptions([kurosawa, other], ["Criterion Channel"])).toEqual([
      { name: "Akira Kurosawa", availableTitleCount: 2 },
      { name: "Second Unit", availableTitleCount: 1 },
    ]);
  });

  it("chooses poster-capable representative artwork for each director", () => {
    const noPosterPopular = title("popular-without-art", [], ["Criterion Channel"], "subscription", {
      name: "Film without poster",
      popularity: 100,
      director: "Jon Watts",
      poster: null,
    });
    const posterFilm = title("poster-film", [], ["Criterion Channel"], "subscription", {
      name: "Poster film",
      popularity: 50,
      director: "Jon Watts",
      poster: "https://image.tmdb.org/t/p/w780/poster.jpg",
    });
    const otherDirector = title("other-film", [], ["Criterion Channel"], "subscription", {
      name: "Other film",
      popularity: 90,
      director: "Greta Gerwig",
      poster: "https://image.tmdb.org/t/p/w780/other.jpg",
    });

    const artwork = representativeTitlesForDirectors(
      [noPosterPopular, posterFilm, otherDirector],
      ["Jon Watts", "Greta Gerwig"],
    );

    expect(artwork.get("Jon Watts")?.id).toBe("poster-film");
    expect(artwork.get("Greta Gerwig")?.id).toBe("other-film");
  });
});
