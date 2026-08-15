import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyHumanReviewDecisions,
  validateHumanReviewDecisions,
} from "./lib/classification-reconciliation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(target, value, { overwrite = true } = {}) {
  if (!overwrite && await exists(target)) throw new Error(`Refusing to overwrite ${target}`);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const statusPath = path.join(packetRoot, "status.json");
const status = await readJson(statusPath);
const provisional = await readJson(path.join(packetRoot, "outputs", "provisional-classifications.json"));
const review = await readJson(path.join(packetRoot, "human-review", "human-review-input.json"));
const decisions = await readJson(path.join(packetRoot, "human-review", "human-review-decisions.json"));
const ontology = await readJson(path.join(packetRoot, `ontology-v${provisional.ontology_version}.json`));

const subgenreIds = unique(
  (ontology.subgenre_families ?? []).flatMap((family) =>
    (family.terms ?? []).map((term) => term.id),
  ),
);
const toneIds = unique((ontology.tone_tags ?? []).map((tone) => tone.id));
const pacingIds = unique((ontology.pacing ?? []).map((pace) => pace.id));
const decisionRows = validateHumanReviewDecisions({
  decisions,
  reviewTitles: review.titles,
  runId: provisional.run_id,
  batchNumber: provisional.batch_number,
  ontologyVersion: provisional.ontology_version,
  subgenreIds,
  toneIds,
  pacingIds,
});
const completed = applyHumanReviewDecisions({
  provisionalClassifications: provisional.classifications,
  decisionRows,
});
const generatedAt = new Date().toISOString();
const finalArtifact = {
  schema_version: "final-editorial-classifications-v1",
  run_id: provisional.run_id,
  batch_number: provisional.batch_number,
  ontology_version: provisional.ontology_version,
  generated_at: generatedAt,
  based_on: "outputs/provisional-classifications.json",
  human_review: {
    reviewer: decisions.reviewer,
    reviewed_at: decisions.reviewed_at,
    decision_count: completed.summary.human_decision_fields,
  },
  models: provisional.models,
  summary: completed.summary,
  classifications: completed.classifications,
};
const finalPath = path.join(packetRoot, "outputs", "final-classifications.json");
await atomicWriteJson(finalPath, finalArtifact, { overwrite: false });

const updatedStatus = {
  ...status,
  updated_at: generatedAt,
  status: {
    ...status.status,
    subgenre: "complete",
    tone_tags: "complete",
    pacing: "complete",
    consensus: "complete",
    human_review: "complete",
  },
  counts: {
    ...status.counts,
    final_classifications: completed.summary.title_count,
    automated_complete: completed.summary.automated_consensus_titles,
    human_verified: completed.summary.human_verified_titles,
    human_review_pending: 0,
    human_review_pending_fields: 0,
  },
  artifacts: {
    ...status.artifacts,
    human_decisions: "human-review/human-review-decisions.json",
    final_classifications: "outputs/final-classifications.json",
  },
};
await atomicWriteJson(statusPath, updatedStatus);

console.log(JSON.stringify({
  packet: packetRoot,
  output: finalPath,
  reviewer: decisions.reviewer,
  ...completed.summary,
}, null, 2));
