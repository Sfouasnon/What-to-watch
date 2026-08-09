import { describe, expect, it } from "vitest";

import { editorialClassification, editorialFamilyForSubgenre } from "./editorial";

describe("editorial gold-set lookup", () => {
  it("resolves Pulp Fiction by exact TMDB identity and ontology family", () => {
    expect(editorialClassification("movie", 680)).toMatchObject({
      primarySubgenre: "dark-comedy",
      primaryFamily: "comedy",
      ontologyVersion: "0.1.1",
    });
  });

  it("derives families from the versioned ontology rather than hard-coded lists", () => {
    expect(editorialFamilyForSubgenre("romantic-comedy")).toBe("comedy");
    expect(editorialFamilyForSubgenre("psychological-horror")).toBe("horror");
  });

  it("does not leak a movie classification onto a TV identity", () => {
    expect(editorialClassification("tv", 680)).toBeNull();
  });

  it("returns null for titles outside the curated gold set", () => {
    expect(editorialClassification("movie", 999999999)).toBeNull();
  });
});
