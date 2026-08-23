import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));
const subgenreIds = (ontology) => ontology.subgenre_families
  .flatMap((family) => family.terms.map((term) => term.id));
const toneIds = (ontology) => ontology.tone_tags.map((tone) => tone.id);

it("extends v0.2.0 without dropping controlled IDs and reports accurate counts", async () => {
  const [previous, ontology] = await Promise.all([
    readJson(path.join(repoRoot, "curation/ontology/v0.2.0/ontology.json")),
    readJson(path.join(repoRoot, "curation/ontology/v0.3.0/ontology.json")),
  ]);
  const previousSubgenres = subgenreIds(previous);
  const currentSubgenres = subgenreIds(ontology);
  const previousTones = toneIds(previous);
  const currentTones = toneIds(ontology);

  expect(ontology.ontology_version).toBe("0.3.0");
  expect(ontology.based_on).toBe("0.2.0");
  expect(previousSubgenres.filter((id) => !currentSubgenres.includes(id))).toEqual([]);
  expect(previousTones.filter((id) => !currentTones.includes(id))).toEqual([]);
  expect(new Set(currentSubgenres).size).toBe(currentSubgenres.length);
  expect(new Set(currentTones).size).toBe(currentTones.length);
  expect(ontology.subgenre_term_count).toBe(currentSubgenres.length);
  expect(ontology.tone_tag_count).toBe(currentTones.length);
  expect(ontology.subgenre_term_count).toBe(138);
  expect(ontology.tone_tag_count).toBe(33);
});

it("adds the aggregate-review subgenres, tones, and documentary boundaries", async () => {
  const ontology = await readJson(path.join(repoRoot, "curation/ontology/v0.3.0/ontology.json"));
  const currentSubgenres = subgenreIds(ontology);
  const currentTones = toneIds(ontology);
  const terms = new Map(
    ontology.subgenre_families.flatMap((family) => family.terms.map((term) => [term.id, term])),
  );

  expect([
    "family-comedy",
    "slapstick-comedy",
    "biographical-drama",
    "medical-drama",
    "true-crime-drama",
    "supernatural-thriller",
    "fantasy-comedy",
    "concert-film",
  ].filter((id) => !currentSubgenres.includes(id))).toEqual([]);
  expect([
    "anxious",
    "sensual",
    "candid",
    "exuberant",
    "nostalgic",
  ].filter((id) => !currentTones.includes(id))).toEqual([]);
  expect(terms.get("biography-profile-documentary").exclusion_guidance).toContain("biographical-drama");
  expect(terms.get("true-crime-documentary").exclusion_guidance).toContain("true-crime-drama");
  expect(terms.get("music-documentary").exclusion_guidance).toContain("concert-film");
  expect(terms.get("family-sitcom").exclusion_guidance).toContain("family-comedy");
});

it("uses v0.3.0 as the default while requiring artifact-version agreement", async () => {
  const sources = await Promise.all([
    "export-classification-batch.mjs",
    "export-classification-experiment.mjs",
    "publish-classification-catalog.mjs",
    "validate-local-catalog.mjs",
  ].map((filename) => readFile(path.join(repoRoot, "scripts/catalog", filename), "utf8")));

  for (const source of sources) expect(source).toContain("v0.3.0");
  expect(sources[2]).toContain("artifact.ontology_version !== ontology.ontology_version");
  expect(sources[3]).toContain("artifact.ontology_version !== ontology.ontology_version");
});
