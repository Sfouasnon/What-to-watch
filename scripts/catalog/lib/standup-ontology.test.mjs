import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));

it("gives stand-up ontology v0.2.0 distinct controlled styles and new tones", async () => {
  const ontology = await readJson(path.join(repoRoot, "curation/ontology/v0.2.0/ontology.json"));
  const standup = ontology.subgenre_families.find((family) => family.family_id === "stand-up");
  const styleIds = standup.terms.map((term) => term.id);
  const toneIds = ontology.tone_tags.map((tone) => tone.id);

  expect(ontology.ontology_version).toBe("0.2.0");
  expect(styleIds).toHaveLength(14);
  expect(new Set(styleIds).size).toBe(14);
  expect(
    ["standup-storytelling", "standup-musical", "standup-impressions", "standup-prop-comedy"]
      .filter((id) => !styleIds.includes(id)),
  ).toEqual([]);
  expect(
    ["thoughtful", "inventive", "surprising"].filter((id) => !toneIds.includes(id)),
  ).toEqual([]);
});
