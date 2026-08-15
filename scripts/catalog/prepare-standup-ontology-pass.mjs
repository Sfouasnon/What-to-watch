import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packetArgument = process.argv.find((value) => value.startsWith("--packet="))?.slice("--packet=".length);
if (!packetArgument) throw new Error("--packet=<classification packet path> is required.");

const packetRoot = path.resolve(repoRoot, packetArgument);
const sourceOntologyPath = path.join(repoRoot, "curation/ontology/v0.1.1/ontology.json");
const targetOntologyRoot = path.join(repoRoot, "curation/ontology/v0.2.0");
const targetOntologyPath = path.join(targetOntologyRoot, "ontology.json");

const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));
const unique = (values) => [...new Set(values)];

const standupTerms = [
  {
    id: "standup-observational",
    label: "Observational Stand-Up",
    definition: "Stand-up built primarily from close observations of everyday behavior, relationships, routines, or social conventions.",
  },
  {
    id: "standup-storytelling",
    label: "Storytelling Stand-Up",
    definition: "Stand-up organized around extended personal or reported stories whose narrative development and payoff are central to the act.",
  },
  {
    id: "standup-satirical",
    label: "Satirical Stand-Up",
    definition: "Stand-up that sustains critique of politics, institutions, ideologies, public figures, or social norms through ridicule, irony, or exaggeration.",
  },
  {
    id: "standup-dark",
    label: "Dark Stand-Up",
    definition: "Stand-up that repeatedly turns death, trauma, illness, cruelty, or other taboo and distressing subjects into its primary comic material.",
  },
  {
    id: "standup-deadpan",
    label: "Deadpan Stand-Up",
    definition: "Stand-up whose defining performance technique is controlled, flat, or affectless delivery that contrasts with the material.",
  },
  {
    id: "standup-absurdist",
    label: "Absurdist Stand-Up",
    definition: "Stand-up driven by surreal premises, non sequiturs, anti-logic, or deliberately irrational escalation rather than ordinary realism.",
  },
  {
    id: "standup-raunchy",
    label: "Raunchy Stand-Up",
    definition: "Stand-up in which explicit sexual, bodily, or profane material is a dominant and recurring comic engine.",
  },
  {
    id: "standup-one-liner",
    label: "One-Liner Stand-Up",
    definition: "Stand-up structured around a high density of short, self-contained jokes rather than extended narratives or thematic passages.",
  },
  {
    id: "standup-alternative",
    label: "Alternative Stand-Up",
    definition: "Stand-up that deliberately rejects conventional setup-and-punchline presentation through experimental structure, anti-comedy, multimedia, or performance-art techniques.",
  },
  {
    id: "standup-character",
    label: "Character Stand-Up",
    definition: "Stand-up built substantially around original personas or sustained fictional characters performed by the comedian.",
  },
  {
    id: "standup-musical",
    label: "Musical Stand-Up",
    definition: "Stand-up in which original songs, musical performance, or music-driven routines are integral to the comedy rather than incidental accompaniment.",
  },
  {
    id: "standup-clean",
    label: "Clean Stand-Up",
    definition: "Stand-up deliberately designed to avoid explicit sexual content and strong profanity as a defining audience and performance choice; do not infer it merely from missing evidence.",
  },
  {
    id: "standup-prop-comedy",
    label: "Prop Comedy",
    definition: "Stand-up in which physical objects, visual devices, or constructed stage gimmicks are essential to a substantial share of the jokes.",
  },
  {
    id: "standup-impressions",
    label: "Impressions",
    definition: "Stand-up in which vocal or physical imitation of recognizable people, celebrities, or character types is a dominant performance technique.",
  },
];

const addedTones = [
  {
    id: "thoughtful",
    label: "Thoughtful",
    definition: "Reflective and self-aware, using the performance to consider lived experience or ideas in a way meant to linger beyond the immediate joke.",
  },
  {
    id: "inventive",
    label: "Inventive",
    definition: "Feels formally imaginative or structurally novel in an observable way; use for unusual construction or presentation, not as generic praise for creativity.",
  },
  {
    id: "surprising",
    label: "Surprising",
    definition: "Repeatedly subverts the audience's expectations through unexpected turns, reveals, reversals, or punchlines; a single twist is insufficient.",
  },
];

const ontology = structuredClone(await readJson(sourceOntologyPath));
ontology.ontology_version = "0.2.0";
ontology.based_on = "0.1.1";
ontology.patch_notes = {
  summary: "Additive stand-up expansion. Adds 14 controlled stand-up performance styles and 3 audience-experience tone tags without changing or retiring any v0.1.1 ID.",
  motivation: [
    "The general film/TV comedy vocabulary collapsed most stand-up specials into generic satire and could not represent observational, storytelling, one-liner, musical, impressions, clean, or prop-driven acts.",
    "The prior stand-up pass left more than 40 percent of titles without tone tags because the global tone vocabulary lacked thoughtful, inventive, and surprising audience-experience signals.",
  ],
  added_subgenres: standupTerms.map((term) => term.id),
  added_tones: addedTones.map((tone) => tone.id),
  unchanged: "All v0.1.1 subgenre, tone, and pacing IDs retain their existing definitions.",
};
ontology.standup_design_principle = "For content_type standup_special, primary_subgenre and secondary_subgenre must use the Stand-Up family. These fields describe the act's dominant comic construction or performance technique. Tone tags describe the audience-facing emotional or stylistic experience. Musical, impressions, storytelling, character, clean, and prop comedy are styles, not tones.";

if (ontology.subgenre_families.some((family) => family.family_id === "stand-up")) {
  throw new Error("Source ontology already contains a stand-up family.");
}
const comedyIndex = ontology.subgenre_families.findIndex((family) => family.family_id === "comedy");
if (comedyIndex < 0) throw new Error("Source ontology has no comedy family.");
ontology.subgenre_families.splice(comedyIndex + 1, 0, {
  family_id: "stand-up",
  family_label: "Stand-Up",
  terms: standupTerms,
});
ontology.tone_tags.push(...addedTones);

const allSubgenreIds = ontology.subgenre_families.flatMap((family) => family.terms.map((term) => term.id));
const allToneIds = ontology.tone_tags.map((tone) => tone.id);
if (unique(allSubgenreIds).length !== allSubgenreIds.length) throw new Error("Duplicate subgenre ID in generated ontology.");
if (unique(allToneIds).length !== allToneIds.length) throw new Error("Duplicate tone ID in generated ontology.");

const inputPath = path.join(packetRoot, "llm-input.json");
const schemaPath = path.join(packetRoot, "llm-response.schema.json");
const statusPath = path.join(packetRoot, "status.json");
const [input, schema, status] = await Promise.all([
  readJson(inputPath),
  readJson(schemaPath),
  readJson(statusPath),
]);
if (!input.titles?.length || input.titles.some((title) => title.content_type !== "standup_special")) {
  throw new Error("Every packet title must have content_type standup_special.");
}

input.ontology_version = ontology.ontology_version;
schema.properties.ontology_version.const = ontology.ontology_version;
const rowProperties = schema.properties.classifications.items.properties;
rowProperties.primary_subgenre.enum = standupTerms.map((term) => term.id);
rowProperties.secondary_subgenre.anyOf = [
  { enum: standupTerms.map((term) => term.id) },
  { type: "null" },
];
rowProperties.tone_tags.minItems = 2;
rowProperties.tone_tags.maxItems = 3;
rowProperties.tone_tags.items.enum = allToneIds;
rowProperties.pacing = { enum: ["slow", "moderate", "fast"] };

status.updated_at = new Date().toISOString();
status.status = {
  ...status.status,
  subgenre: "pending_v0.2.0",
  tone_tags: "pending_v0.2.0",
  pacing: "pending_v0.2.0",
  model_1: "pending_v0.2.0",
  model_2: "not_required",
  arbiter: "not_required",
  consensus: "not_started",
  human_review: "not_started",
};
status.artifacts.ontology = `ontology-v${ontology.ontology_version}.json`;

const instructions = `# Stand-up Batch 001 · ontology v${ontology.ontology_version}

Classify all 100 titles in \`llm-input.json\` using only controlled IDs from \`ontology-v${ontology.ontology_version}.json\` and the exact response structure in \`llm-response.schema.json\`.

This is a fresh ontology pass. Do not reuse or lightly edit any v0.1.1 classification. That vocabulary forced stand-up into generic film-comedy categories and produced insufficient tone coverage.

For every title:

1. Choose exactly one primary style from the **Stand-Up** family.
2. Choose zero or one genuinely distinct secondary style from the **Stand-Up** family.
3. Choose exactly two or three non-duplicative tone tags. Use evidence about material, delivery, and audience experience; do not pad with generic praise.
4. Choose \`slow\`, \`moderate\`, or \`fast\` for performance rhythm. Do not return null.
5. Preserve each TMDB ID and media type exactly, return every title exactly once, and include a concise evidence-based rationale.

Important semantic mappings:

- “creative” maps to the controlled tone \`inventive\` only when the form or construction is observably unusual.
- “fun” maps to \`playful\`.
- “absurd” maps to the tone \`absurdist\`; \`standup-absurdist\` describes the act's dominant construction.
- Storytelling, musical comedy, characters, impressions, clean comedy, and prop comedy are stand-up styles, not tone tags.
- \`satirical\` is a tone; \`standup-satirical\` is a dominant sustained approach. Do not label ordinary observations or isolated topical jokes as satire.
- \`standup-clean\` requires affirmative evidence that clean material is part of the act's design, not merely an absence of explicit keywords.

Calibration examples (semantic examples, not mandatory assignments):

- Bo Burnham: musical/alternative construction; thoughtful, inventive, and potentially satirical experience.
- Sarah Silverman: dark/raunchy construction; raunchy, surprising, and often deadpan experience.
- Iliza Shlesinger: storytelling/observational construction; playful experience, with other tones determined by the specific special.
- Adam Sandler: musical/absurdist construction; absurdist, playful, and inventive experience.
- Frank Caliendo: impressions/character construction; playful, stylized, and potentially surprising experience.

Return JSON only. Set \`ontology_version\` to \`${ontology.ontology_version}\`. Save the complete untouched response as \`outputs/model-1.json\`.
`;

const outputsReadme = `# Stand-up ontology v${ontology.ontology_version} output

Save the fresh complete response as \`model-1.json\`.

The original v0.1.1 model responses are stored in a sibling audit folder outside this upload packet. They are evidence for the ontology revision and are not publishable.
`;

const outputsRoot = path.join(packetRoot, "outputs");
const auditRoot = path.join(path.dirname(packetRoot), `${path.basename(packetRoot)}-pre-v0.2.0-audit`);
const responseFiles = (await readdir(outputsRoot)).filter((name) => name.endsWith(".json"));
const auditedResponses = [];
for (const name of responseFiles) {
  const responsePath = path.join(outputsRoot, name);
  const response = await readJson(responsePath);
  if (response.ontology_version !== "0.1.1" || !Array.isArray(response.classifications)) continue;
  const counts = (values) => Object.fromEntries(
    [...values.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))),
  );
  const primaryCounts = new Map();
  const toneCounts = new Map();
  const toneCardinality = new Map();
  for (const row of response.classifications) {
    primaryCounts.set(row.primary_subgenre, (primaryCounts.get(row.primary_subgenre) ?? 0) + 1);
    toneCardinality.set(row.tone_tags.length, (toneCardinality.get(row.tone_tags.length) ?? 0) + 1);
    for (const tone of row.tone_tags) toneCounts.set(tone, (toneCounts.get(tone) ?? 0) + 1);
  }
  auditedResponses.push({
    artifact: name,
    model: response.model,
    title_count: response.classifications.length,
    primary_subgenre_counts: counts(primaryCounts),
    tone_counts: counts(toneCounts),
    tone_tag_cardinality: counts(toneCardinality),
  });
}

await Promise.all([
  mkdir(targetOntologyRoot, { recursive: true }),
  mkdir(auditRoot, { recursive: true }),
]);
for (const response of auditedResponses) {
  await rename(path.join(outputsRoot, response.artifact), path.join(auditRoot, response.artifact));
}
try {
  await rename(path.join(packetRoot, "ontology-v0.1.1.json"), path.join(auditRoot, "ontology-v0.1.1.json"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (auditedResponses.length) {
  await writeFile(path.join(auditRoot, "audit-summary.json"), `${JSON.stringify({
    schema_version: "standup-ontology-gap-audit-v1",
    audited_ontology_version: "0.1.1",
    replacement_ontology_version: ontology.ontology_version,
    finding: "The general film/TV ontology collapsed stand-up styles and produced insufficient tone coverage; these responses are retained for audit only.",
    responses: auditedResponses,
  }, null, 2)}\n`, "utf8");
}

await Promise.all([
  writeFile(targetOntologyPath, `${JSON.stringify(ontology, null, 2)}\n`, "utf8"),
  writeFile(path.join(packetRoot, `ontology-v${ontology.ontology_version}.json`), `${JSON.stringify(ontology, null, 2)}\n`, "utf8"),
  writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8"),
  writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8"),
  writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8"),
  writeFile(path.join(packetRoot, "LLM-INSTRUCTIONS.md"), instructions, "utf8"),
  writeFile(path.join(packetRoot, "outputs/README.md"), outputsReadme, "utf8"),
]);

console.log(JSON.stringify({
  packetRoot,
  ontologyVersion: ontology.ontology_version,
  standupStyles: standupTerms.length,
  totalTones: allToneIds.length,
  addedTones: addedTones.map((tone) => tone.id),
  titleCount: input.titles.length,
  archivedResponses: auditedResponses.length,
}, null, 2));
