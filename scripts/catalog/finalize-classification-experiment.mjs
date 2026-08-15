import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const classificationFields = ["primary_subgenre", "secondary_subgenre", "tone_tags", "pacing"];

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function identity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function normalized(field, value) {
  return field === "tone_tags" ? [...value].sort() : value;
}

function equal(field, left, right) {
  return JSON.stringify(normalized(field, left)) === JSON.stringify(normalized(field, right));
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

function modelValue(classification, field, modelKey) {
  return Object.hasOwn(classification.agreed, field)
    ? classification.agreed[field]
    : classification.conflicts[field][modelKey];
}

function resolveToneTags({ model1, model2, arbiter }) {
  const votes = new Map();
  for (const tags of [model1, model2, arbiter]) {
    for (const tone of new Set(tags)) votes.set(tone, (votes.get(tone) ?? 0) + 1);
  }
  const rawMajority = [...votes.entries()]
    .filter(([, count]) => count >= 2)
    .map(([tone]) => tone);
  const arbiterSet = new Set(arbiter);
  const bothFirstPasses = new Set(model1.filter((tone) => model2.includes(tone)));
  const ranked = [...votes.entries()].sort((left, right) => {
    const [leftTone, leftVotes] = left;
    const [rightTone, rightVotes] = right;
    return rightVotes - leftVotes
      || Number(arbiterSet.has(rightTone)) - Number(arbiterSet.has(leftTone))
      || Number(bothFirstPasses.has(rightTone)) - Number(bothFirstPasses.has(leftTone))
      || leftTone.localeCompare(rightTone);
  });
  const selected = rawMajority.length > 3
    ? ranked.filter(([tone]) => rawMajority.includes(tone)).slice(0, 3).map(([tone]) => tone)
    : [...rawMajority];
  let fallbackAdded = 0;
  if (selected.length < 2) {
    const fallback = [
      ...arbiter,
      ...ranked.map(([tone]) => tone),
    ];
    for (const tone of fallback) {
      if (!selected.includes(tone)) {
        selected.push(tone);
        fallbackAdded += 1;
      }
      if (selected.length === 2) break;
    }
  }
  return {
    value: selected.slice(0, 3).sort(),
    votes: Object.fromEntries([...votes.entries()].sort()),
    rawMajorityCount: rawMajority.length,
    capped: rawMajority.length > 3,
    fallbackAdded,
  };
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const input = await readJson(path.join(packetRoot, "llm-input.json"));
const ontology = await readJson(path.join(packetRoot, `ontology-v${input.ontology_version}.json`));
const consensus = await readJson(path.join(packetRoot, "outputs", "two-model-consensus.json"));
const arbiterInput = await readJson(path.join(packetRoot, "arbiter", "arbiter-input.json"));
const statusPath = path.join(packetRoot, "status.json");
const status = await readJson(statusPath);

const responseCandidates = [
  path.join(packetRoot, "outputs", "arbiter-response.json"),
  path.join(packetRoot, "arbiter", "arbiter-response.json"),
];
let arbiterResponsePath = null;
for (const candidate of responseCandidates) {
  if (await exists(candidate)) {
    arbiterResponsePath = candidate;
    break;
  }
}
if (!arbiterResponsePath) {
  throw new Error(`Arbiter response not found. Checked: ${responseCandidates.join(", ")}`);
}
const arbiterResponse = await readJson(arbiterResponsePath);

const allowedSubgenres = new Set(
  (ontology.subgenre_families ?? []).flatMap((family) =>
    (family.terms ?? []).map((term) => term.id),
  ),
);
const allowedTones = new Set((ontology.tone_tags ?? []).map((tone) => tone.id));
const allowedPacing = new Set((ontology.pacing ?? []).map((pace) => pace.id));
const expectedArbiterTitles = new Map(
  arbiterInput.titles.map((title) => [identity(title), title]),
);
const validationErrors = [];
if (arbiterResponse.experiment_id !== input.experiment_id) validationErrors.push("experiment_id mismatch");
if (arbiterResponse.run_id !== input.run_id) validationErrors.push("run_id mismatch");
if (JSON.stringify(arbiterResponse.source_batches) !== JSON.stringify(input.source_batches)) {
  validationErrors.push("source_batches mismatch");
}
if (arbiterResponse.ontology_version !== input.ontology_version) validationErrors.push("ontology_version mismatch");
if (!Array.isArray(arbiterResponse.resolutions)
  || arbiterResponse.resolutions.length !== expectedArbiterTitles.size) {
  validationErrors.push(`resolutions must contain ${expectedArbiterTitles.size} rows`);
}

const arbiterRows = new Map();
for (const [index, row] of (arbiterResponse.resolutions ?? []).entries()) {
  const rowIdentity = identity(row);
  const expected = expectedArbiterTitles.get(rowIdentity);
  if (!expected) validationErrors.push(`${index}: unexpected identity ${rowIdentity}`);
  if (arbiterRows.has(rowIdentity)) validationErrors.push(`${index}: duplicate identity ${rowIdentity}`);
  arbiterRows.set(rowIdentity, row);
  if (!row.resolved || typeof row.resolved !== "object" || Array.isArray(row.resolved)) {
    validationErrors.push(`${rowIdentity}: resolved must be an object`);
    continue;
  }
  if (expected) {
    const expectedFields = Object.keys(expected.conflicts).sort();
    const receivedFields = Object.keys(row.resolved).sort();
    if (JSON.stringify(expectedFields) !== JSON.stringify(receivedFields)) {
      validationErrors.push(
        `${rowIdentity}: expected fields [${expectedFields.join(", ")}], received [${receivedFields.join(", ")}]`,
      );
    }
  }
  for (const [field, value] of Object.entries(row.resolved)) {
    if (!classificationFields.includes(field)) {
      validationErrors.push(`${rowIdentity}: unexpected field ${field}`);
    } else if (field === "primary_subgenre" && !allowedSubgenres.has(value)) {
      validationErrors.push(`${rowIdentity}: invalid primary_subgenre ${value}`);
    } else if (field === "secondary_subgenre" && value !== null && !allowedSubgenres.has(value)) {
      validationErrors.push(`${rowIdentity}: invalid secondary_subgenre ${value}`);
    } else if (field === "tone_tags") {
      if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
        validationErrors.push(`${rowIdentity}: tone_tags must contain two or three values`);
      } else {
        if (new Set(value).size !== value.length) validationErrors.push(`${rowIdentity}: duplicate tone tags`);
        for (const tone of value) {
          if (!allowedTones.has(tone)) validationErrors.push(`${rowIdentity}: invalid tone tag ${tone}`);
        }
      }
    } else if (field === "pacing" && value !== null && !allowedPacing.has(value)) {
      validationErrors.push(`${rowIdentity}: invalid pacing ${value}`);
    }
  }
  if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
    validationErrors.push(`${rowIdentity}: invalid confidence`);
  }
  if (typeof row.rationale !== "string" || !row.rationale.trim() || row.rationale.length > 600) {
    validationErrors.push(`${rowIdentity}: invalid rationale`);
  }
  if (expected) {
    const combined = { ...expected.agreed_fields, ...row.resolved };
    if (combined.secondary_subgenre === combined.primary_subgenre) {
      validationErrors.push(`${rowIdentity}: primary and secondary subgenres match after merge`);
    }
  }
}
for (const rowIdentity of expectedArbiterTitles.keys()) {
  if (!arbiterRows.has(rowIdentity)) validationErrors.push(`missing resolution for ${rowIdentity}`);
}
if (validationErrors.length) {
  throw new Error(`Invalid arbiter response:\n- ${validationErrors.join("\n- ")}`);
}

const selectionStats = Object.fromEntries(
  classificationFields.map((field) => [field, { model_1: 0, model_2: 0, third_value: 0 }]),
);
const toneStats = {
  final_tag_counts: { two: 0, three: 0 },
  raw_majority_counts: {},
  capped_titles: 0,
  fallback_titles: 0,
  fallback_tags: 0,
  unanimous_tag_votes: 0,
  two_of_three_tag_votes: 0,
  one_vote_fallback_tags: 0,
  final_exact_model_1: 0,
  final_exact_model_2: 0,
  final_exact_arbiter_on_disputed_titles: 0,
};
const alignment = {
  model_1: Object.fromEntries([...classificationFields, "all_fields"].map((field) => [field, 0])),
  model_2: Object.fromEntries([...classificationFields, "all_fields"].map((field) => [field, 0])),
};
let arbiterConfidenceTotal = 0;
let lowConfidenceArbiterTitles = 0;
const finalClassifications = consensus.classifications.map((classification) => {
  const rowIdentity = identity(classification);
  const arbiter = arbiterRows.get(rowIdentity);
  const values = { ...classification.agreed };
  const fieldSources = Object.fromEntries(
    Object.keys(classification.agreed).map((field) => [field, "two-model-agreement"]),
  );
  const toneAudit = {};

  if (arbiter) {
    arbiterConfidenceTotal += arbiter.confidence;
    if (arbiter.confidence < 0.75) lowConfidenceArbiterTitles += 1;
  }
  for (const field of classification.conflict_fields) {
    const candidates = classification.conflicts[field];
    const arbiterValue = normalized(field, arbiter.resolved[field]);
    if (equal(field, arbiterValue, candidates.model_1)) selectionStats[field].model_1 += 1;
    else if (equal(field, arbiterValue, candidates.model_2)) selectionStats[field].model_2 += 1;
    else selectionStats[field].third_value += 1;

    if (field === "tone_tags") {
      const resolved = resolveToneTags({
        model1: candidates.model_1,
        model2: candidates.model_2,
        arbiter: arbiterValue,
      });
      values[field] = resolved.value;
      fieldSources[field] = resolved.fallbackAdded
        ? "tag-vote-with-arbiter-fallback"
        : resolved.capped
          ? "tag-vote-with-arbiter-cap"
          : "tag-level-majority";
      toneAudit.votes = resolved.votes;
      toneAudit.raw_majority_count = resolved.rawMajorityCount;
      toneAudit.fallback_added = resolved.fallbackAdded;
      toneStats.raw_majority_counts[resolved.rawMajorityCount] = (
        toneStats.raw_majority_counts[resolved.rawMajorityCount] ?? 0
      ) + 1;
      if (resolved.capped) toneStats.capped_titles += 1;
      if (resolved.fallbackAdded) {
        toneStats.fallback_titles += 1;
        toneStats.fallback_tags += resolved.fallbackAdded;
      }
    } else {
      values[field] = arbiterValue;
      fieldSources[field] = "arbiter-tiebreak";
    }
  }

  if (values.tone_tags.length === 2) toneStats.final_tag_counts.two += 1;
  else if (values.tone_tags.length === 3) toneStats.final_tag_counts.three += 1;
  if (toneAudit.votes) {
    for (const tone of values.tone_tags) {
      const votes = toneAudit.votes[tone] ?? 0;
      if (votes === 3) toneStats.unanimous_tag_votes += 1;
      else if (votes === 2) toneStats.two_of_three_tag_votes += 1;
      else toneStats.one_vote_fallback_tags += 1;
    }
  }

  const model1Tone = modelValue(classification, "tone_tags", "model_1");
  const model2Tone = modelValue(classification, "tone_tags", "model_2");
  if (equal("tone_tags", values.tone_tags, model1Tone)) toneStats.final_exact_model_1 += 1;
  if (equal("tone_tags", values.tone_tags, model2Tone)) toneStats.final_exact_model_2 += 1;
  if (classification.conflict_fields.includes("tone_tags")
    && equal("tone_tags", values.tone_tags, arbiter.resolved.tone_tags)) {
    toneStats.final_exact_arbiter_on_disputed_titles += 1;
  }

  for (const modelKey of ["model_1", "model_2"]) {
    let allMatch = true;
    for (const field of classificationFields) {
      const match = equal(field, values[field], modelValue(classification, field, modelKey));
      if (match) alignment[modelKey][field] += 1;
      else allMatch = false;
    }
    if (allMatch) alignment[modelKey].all_fields += 1;
  }

  return {
    tmdb_id: classification.tmdb_id,
    media_type: classification.media_type,
    title: classification.title,
    primary_subgenre: values.primary_subgenre,
    secondary_subgenre: values.secondary_subgenre,
    tone_tags: values.tone_tags,
    pacing: values.pacing,
    field_sources: fieldSources,
    review_status: "automated_final",
    tone_vote_audit: toneAudit,
  };
});

const finalValidationErrors = [];
for (const row of finalClassifications) {
  const rowIdentity = identity(row);
  if (!allowedSubgenres.has(row.primary_subgenre)) finalValidationErrors.push(`${rowIdentity}: invalid primary`);
  if (row.secondary_subgenre !== null && !allowedSubgenres.has(row.secondary_subgenre)) {
    finalValidationErrors.push(`${rowIdentity}: invalid secondary`);
  }
  if (row.secondary_subgenre === row.primary_subgenre) finalValidationErrors.push(`${rowIdentity}: duplicate subgenres`);
  if (!Array.isArray(row.tone_tags) || row.tone_tags.length < 2 || row.tone_tags.length > 3) {
    finalValidationErrors.push(`${rowIdentity}: invalid final tone count`);
  }
  if (row.pacing !== null && !allowedPacing.has(row.pacing)) finalValidationErrors.push(`${rowIdentity}: invalid pacing`);
}
if (finalValidationErrors.length) {
  throw new Error(`Invalid final classifications:\n- ${finalValidationErrors.join("\n- ")}`);
}

for (const modelKey of ["model_1", "model_2"]) {
  for (const field of [...classificationFields, "all_fields"]) {
    alignment[modelKey][`${field}_percent`] = Number(
      ((alignment[modelKey][field] / input.title_count) * 100).toFixed(1),
    );
  }
}
const generatedAt = new Date().toISOString();
const evaluation = {
  schema_version: "classification-capacity-experiment-evaluation-v1",
  experiment_id: input.experiment_id,
  run_id: input.run_id,
  source_batches: input.source_batches,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  production_eligible: false,
  workflow: "two-model-plus-conflict-arbiter",
  models: {
    ...status.models,
    arbiter: arbiterResponse.model,
  },
  capacity: {
    requested_titles: input.title_count,
    model_1_complete: true,
    model_2_complete: true,
    arbiter_requested_titles: expectedArbiterTitles.size,
    arbiter_complete: true,
    truncation_detected: false,
  },
  validation: {
    final_title_count: finalClassifications.length,
    final_invalid_rows: 0,
    sanitized_model_2_tone_ids: consensus.summary.sanitized_invalid_tone_tags,
  },
  two_model_consensus: consensus.summary,
  arbiter_selection: selectionStats,
  arbiter_average_confidence: Number(
    (arbiterConfidenceTotal / expectedArbiterTitles.size).toFixed(3),
  ),
  arbiter_titles_below_0_75_confidence: lowConfidenceArbiterTitles,
  tone_voting: toneStats,
  final_alignment: alignment,
  promotion_recommendation: "Review ensemble alignment and spot-check quality before promoting this isolated experiment.",
};
const finalArtifact = {
  schema_version: "automated-final-editorial-classifications-v1",
  experiment_id: input.experiment_id,
  run_id: input.run_id,
  source_batches: input.source_batches,
  ontology_version: input.ontology_version,
  generated_at: generatedAt,
  production_eligible: false,
  workflow: "two-model-plus-conflict-arbiter",
  models: evaluation.models,
  summary: {
    title_count: finalClassifications.length,
    automated_final: finalClassifications.length,
    human_review_count: 0,
  },
  classifications: finalClassifications,
};
const finalPath = path.join(packetRoot, "outputs", "final-classifications.json");
const evaluationPath = path.join(packetRoot, "outputs", "evaluation.json");
await atomicWriteJson(finalPath, finalArtifact, { overwrite: false });
await atomicWriteJson(evaluationPath, evaluation, { overwrite: false });

const updatedStatus = {
  ...status,
  updated_at: generatedAt,
  production_eligible: false,
  status: {
    ...status.status,
    arbiter: "complete",
    finalization: "complete",
    evaluation: "complete",
  },
  counts: {
    ...status.counts,
    arbiter_resolutions: arbiterResponse.resolutions.length,
    final_classifications: finalClassifications.length,
    human_review: 0,
  },
  models: evaluation.models,
  artifacts: {
    ...status.artifacts,
    arbiter_response: path.relative(packetRoot, arbiterResponsePath),
    final_classifications: "outputs/final-classifications.json",
    evaluation: "outputs/evaluation.json",
  },
};
await atomicWriteJson(statusPath, updatedStatus);

console.log(JSON.stringify({
  packet: packetRoot,
  arbiterResponse: arbiterResponsePath,
  finalClassifications: finalPath,
  evaluation: evaluationPath,
  titleCount: finalClassifications.length,
  arbiterModel: arbiterResponse.model,
  arbiterSelection: selectionStats,
  toneVoting: toneStats,
  finalAlignment: alignment,
  productionEligible: false,
}, null, 2));
