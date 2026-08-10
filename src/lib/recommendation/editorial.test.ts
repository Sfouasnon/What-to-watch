import { describe, expect, it } from "vitest";

import { editorialClassification, editorialFamilyForSubgenre } from "./editorial";

describe("editorial gold-set lookup", () => {
  it("applies the human Pulp Fiction correction by exact TMDB identity", () => {
    expect(editorialClassification("movie", 680)).toMatchObject({
      primarySubgenre: "crime-drama",
      primaryFamily: "crime",
      secondarySubgenre: "crime-thriller",
      secondaryFamily: "thriller",
      toneTags: ["wry", "stylized", "visceral"],
      ontologyVersion: "0.1.1",
    });
  });

  it("derives families from the versioned ontology rather than hard-coded lists", () => {
    expect(editorialFamilyForSubgenre("romantic-comedy")).toBe("comedy");
    expect(editorialFamilyForSubgenre("crime-drama")).toBe("crime");
    expect(editorialFamilyForSubgenre("crime-thriller")).toBe("thriller");
    expect(editorialFamilyForSubgenre("psychological-horror")).toBe("horror");
  });

  it("does not leak a movie classification onto a TV identity", () => {
    expect(editorialClassification("tv", 680)).toBeNull();
  });

  it("returns null for titles outside the curated gold set", () => {
    expect(editorialClassification("movie", 999999999)).toBeNull();
  });
});
