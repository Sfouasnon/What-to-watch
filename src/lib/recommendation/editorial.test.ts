import { describe, expect, it } from "vitest";

import { editorialClassification } from "./editorial";

describe("editorial gold-set lookup", () => {
  it("resolves Pulp Fiction by exact TMDB identity", () => {
    expect(editorialClassification("movie", 680)).toMatchObject({
      primarySubgenre: "dark-comedy",
    });
  });

  it("does not leak a movie classification onto a TV identity", () => {
    expect(editorialClassification("tv", 680)).toBeNull();
  });

  it("returns null for titles outside the curated gold set", () => {
    expect(editorialClassification("movie", 999999999)).toBeNull();
  });
});
