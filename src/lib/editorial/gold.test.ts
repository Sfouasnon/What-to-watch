import { describe, expect, it } from "vitest";

import ontologyJson from "../../../curation/ontology/v0.1.1/ontology.json";
import correctionsJson from "../../../curation/pilot/pass2/editorial-corrections-v1.1.json";
import goldJson from "../../../curation/pilot/pass2/final-classifications-v1.0-gold.json";
import sampleJson from "../../../curation/pilot/sample-100.json";

import { allGoldEditorialClassifications, GOLD_ONTOLOGY_VERSION, GOLD_SET_SIZE, goldEditorialClassification } from "./gold";

const ontology = ontologyJson as {
  ontology_version: string;
  subgenre_families: Array<{ terms: Array<{ id: string }> }>;
  tone_tags: Array<{ id: string }>;
};
const gold = goldJson as {
  title_count: number;
  pending_human_review_field_count: number;
  classifications: Array<{ tmdb_id: number; media_type: "movie" | "tv" }>;
};
const sample = sampleJson as {
  title_count: number;
  titles: Array<{ tmdb_id: number; media_type: "movie" | "tv" }>;
};
const corrections = correctionsJson as {
  corrections: Array<{ tmdb_id: number; media_type: "movie" | "tv"; primary_subgenre: { to: string } }>;
};

const identity = (mediaType: "movie" | "tv", tmdbId: number) => `${mediaType}:${tmdbId}`;
const subgenres = new Set(ontology.subgenre_families.flatMap((family) => family.terms.map((term) => term.id)));
const tones = new Set(ontology.tone_tags.map((tone) => tone.id));

function expectControlledClassification(classification: ReturnType<typeof goldEditorialClassification>) {
  expect(classification).not.toBeNull();
  if (!classification) return;
  expect(subgenres.has(classification.primarySubgenre)).toBe(true);
  if (classification.secondarySubgenre) expect(subgenres.has(classification.secondarySubgenre)).toBe(true);
  expect(classification.secondarySubgenre).not.toBe(classification.primarySubgenre);
  expect(classification.toneTags.length).toBeLessThanOrEqual(3);
  for (const tone of classification.toneTags) expect(tones.has(tone)).toBe(true);
  if (classification.pacing) expect(["slow", "moderate", "fast"]).toContain(classification.pacing);
}

describe("editorial gold set", () => {
  it("keeps the benchmark at exactly 100 fully adjudicated titles", () => {
    expect(GOLD_SET_SIZE).toBe(100);
    expect(gold.title_count).toBe(100);
    expect(sample.title_count).toBe(100);
    expect(gold.pending_human_review_field_count).toBe(0);
    expect(allGoldEditorialClassifications()).toHaveLength(100);
  });

  it("uses the same ontology version as the promoted controlled vocabulary", () => {
    expect(GOLD_ONTOLOGY_VERSION).toBe(ontology.ontology_version);
    expect(GOLD_ONTOLOGY_VERSION).toBe("0.1.1");
  });

  it("has a classification for every sampled TMDB identity", () => {
    const goldIds = new Set(gold.classifications.map((item) => identity(item.media_type, item.tmdb_id)));
    const sampleIds = new Set(sample.titles.map((item) => identity(item.media_type, item.tmdb_id)));
    expect(goldIds).toEqual(sampleIds);
  });

  it("keeps every final field inside the controlled vocabulary", () => {
    for (const record of gold.classifications) {
      expectControlledClassification(goldEditorialClassification(record.media_type, record.tmdb_id));
    }
  });

  it("layers human editorial corrections over the frozen v1.0 gold artifact", () => {
    expect(corrections.corrections.length).toBeGreaterThan(0);
    for (const correction of corrections.corrections) {
      const classification = goldEditorialClassification(correction.media_type, correction.tmdb_id);
      expect(classification?.primarySubgenre).toBe(correction.primary_subgenre.to);
      expect(classification?.source).toBe("human-editorial-correction");
    }
  });
});
