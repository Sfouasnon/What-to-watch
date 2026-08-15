#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  if (process.argv.includes(exact)) return true;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value || value === true) throw new Error(`--${name} is required.`);
  return value;
}

function readJson(target) {
  return JSON.parse(readFileSync(target, "utf8"));
}

function atomicWriteJson(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, target);
}

function formatValue(value) {
  if (value === null) return "NULL / no secondary";
  if (Array.isArray(value)) return value.length ? value.join(" · ") : "(no tone tags)";
  return String(value);
}

function titleIdentity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function wrap(text, width = 96) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function vocabMaps(ontology) {
  const subgenres = new Map(
    (ontology.subgenre_families ?? []).flatMap((family) =>
      (family.terms ?? []).map((term) => [term.id, term]),
    ),
  );
  const tones = new Map((ontology.tone_tags ?? []).map((tone) => [tone.id, tone]));
  const pacing = new Map((ontology.pacing ?? []).map((pace) => [pace.id, pace]));
  return { subgenres, tones, pacing };
}

function definitions(field, value, vocabulary) {
  if (value === null) return ["No secondary sub-genre."];
  const values = Array.isArray(value) ? value : [value];
  const map = field.includes("subgenre")
    ? vocabulary.subgenres
    : field === "tone_tags"
      ? vocabulary.tones
      : vocabulary.pacing;
  return values.map((id) => {
    const term = map.get(id);
    return term ? `${id}: ${term.definition}` : `${id}: definition unavailable`;
  });
}

function parseCustom(field, answer, vocabulary, acceptedFields) {
  const raw = answer.trim();
  if (field === "tone_tags") {
    const values = raw === "" || /^(none|null)$/i.test(raw)
      ? []
      : raw.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length > 3) throw new Error("Enter no more than three comma-separated tone IDs.");
    if (new Set(values).size !== values.length) throw new Error("Tone IDs must be unique.");
    const invalid = values.filter((value) => !vocabulary.tones.has(value));
    if (invalid.length) throw new Error(`Unknown tone ID(s): ${invalid.join(", ")}`);
    return values;
  }
  if (field === "pacing") {
    const value = /^(none|null)$/i.test(raw) ? null : raw;
    if (value !== null && !vocabulary.pacing.has(value)) {
      throw new Error(`Pacing must be one of: ${[...vocabulary.pacing.keys()].join(", ")}`);
    }
    return value;
  }
  const value = /^(none|null)$/i.test(raw) ? null : raw;
  if (field === "primary_subgenre" && value === null) {
    throw new Error("Primary sub-genre cannot be null.");
  }
  if (value !== null && !vocabulary.subgenres.has(value)) {
    throw new Error(`Unknown sub-genre ID: ${value}`);
  }
  const other = field === "primary_subgenre"
    ? acceptedFields.secondary_subgenre
    : acceptedFields.primary_subgenre;
  if (value !== null && value === other) {
    throw new Error("Primary and secondary sub-genres must differ.");
  }
  return value;
}

const packetRoot = path.resolve(repoRoot, requiredArgument("packet"));
const reviewRoot = path.join(packetRoot, "human-review");
const inputPath = path.join(reviewRoot, "human-review-input.json");
const templatePath = path.join(reviewRoot, "human-review-decisions.template.json");
const decisionsPath = path.join(reviewRoot, "human-review-decisions.json");

if (!existsSync(inputPath)) throw new Error(`Missing ${inputPath}`);
if (!existsSync(templatePath)) throw new Error(`Missing ${templatePath}`);

const review = readJson(inputPath);
const template = readJson(templatePath);
const ontology = readJson(path.join(reviewRoot, `ontology-v${review.ontology_version}.json`));
const vocabulary = vocabMaps(ontology);
const state = existsSync(decisionsPath) ? readJson(decisionsPath) : template;
state.reviewer ??= argument("reviewer") || process.env.USER || "human-reviewer";
state.decisions ??= [];

const decisionByIdentity = new Map(
  state.decisions.map((decision) => [titleIdentity(decision), decision]),
);
const reviewByIdentity = new Map(review.titles.map((title) => [titleIdentity(title), title]));
let totalFields = 0;
let reviewedFields = 0;
for (const title of review.titles) {
  totalFields += title.fields_to_review.length;
  const decision = decisionByIdentity.get(titleIdentity(title));
  reviewedFields += new Set(decision?.reviewed_fields ?? []).size;
}

function save() {
  state.updated_at = new Date().toISOString();
  state.reviewed_at = reviewedFields === totalFields ? state.updated_at : null;
  atomicWriteJson(decisionsPath, state);
}

function printStatus() {
  console.log("");
  console.log(`Batch ${String(review.batch_number).padStart(3, "0")} human review`);
  console.log(`${reviewedFields}/${totalFields} fields reviewed across ${review.title_count} titles.`);
  console.log(`Decisions: ${decisionsPath}`);
  console.log("");
}

if (argument("status")) {
  printStatus();
  process.exit(0);
}

const rl = readline.createInterface({ input, output });

console.log("");
console.log("==========================================");
console.log(" WHAT TO WATCH — HUMAN EDITORIAL REVIEW");
console.log("==========================================");
console.log("");
console.log(`${totalFields - reviewedFields} of ${totalFields} fields remain.`);
console.log("Choose A, B, or C; O enters another ontology value; S skips; Q saves and quits.");
console.log("Progress is saved after every answer.");

outer:
for (const title of review.titles) {
  const identity = titleIdentity(title);
  const decision = decisionByIdentity.get(identity);
  if (!decision) throw new Error(`Missing decision template row for ${identity}`);
  decision.reviewed_fields ??= [];
  decision.decision_details ??= {};

  for (const fieldReview of title.fields_to_review) {
    if (decision.reviewed_fields.includes(fieldReview.field)) continue;

    console.log("\n==========================================");
    console.log(`[${reviewedFields + 1}/${totalFields}] ${title.title} (${title.year ?? "year unknown"})`);
    console.log(`Field: ${fieldReview.field}`);
    console.log("==========================================");
    for (const line of wrap(title.overview)) console.log(`  ${line}`);
    console.log(`\nGenres: ${(title.tmdb_genres ?? []).join(" · ") || "unknown"}`);
    console.log(`Arbiter confidence: ${fieldReview.arbiter_confidence}`);
    console.log(`Reason for review: ${fieldReview.reasons.join(", ")}`);

    const choices = {
      A: fieldReview.model_1,
      B: fieldReview.model_2,
      C: fieldReview.arbiter,
    };
    for (const [choice, value] of Object.entries(choices)) {
      console.log(`\n${choice}  ${formatValue(value)}`);
      for (const definition of definitions(fieldReview.field, value, vocabulary)) {
        for (const line of wrap(definition, 90)) console.log(`     ${line}`);
      }
    }

    let selectedValue;
    let selectedChoice;
    while (true) {
      const answer = (await rl.question("\nYour choice [A/B/C/O/S/Q]: ")).trim().toUpperCase();
      if (answer === "Q") {
        save();
        console.log(`\nSaved ${reviewedFields}/${totalFields} fields. Run the command again to continue.`);
        break outer;
      }
      if (answer === "S") {
        console.log("Skipped for this session.");
        continue outer;
      }
      if (["A", "B", "C"].includes(answer)) {
        selectedChoice = answer;
        selectedValue = choices[answer];
        break;
      }
      if (answer === "O") {
        const custom = await rl.question(
          fieldReview.field === "tone_tags"
            ? "Enter zero to three comma-separated tone IDs (or none): "
            : "Enter a controlled ontology ID (or null where allowed): ",
        );
        try {
          selectedValue = parseCustom(fieldReview.field, custom, vocabulary, {
            ...title.accepted_fields,
            ...decision.resolved,
          });
          selectedChoice = "O";
          break;
        } catch (error) {
          console.log(error.message);
          continue;
        }
      }
      console.log("Please enter A, B, C, O, S, or Q.");
    }

    if (selectedChoice === undefined) break outer;
    decision.resolved[fieldReview.field] = selectedValue;
    decision.reviewed_fields.push(fieldReview.field);
    decision.decision_details[fieldReview.field] = {
      choice: selectedChoice,
      value: selectedValue,
      decided_at: new Date().toISOString(),
    };
    decision.approved = decision.reviewed_fields.length === title.fields_to_review.length;
    reviewedFields += 1;
    save();
    console.log(`✓ Selected ${selectedChoice}: ${formatValue(selectedValue)}`);
  }
}

await rl.close();

if (reviewedFields === totalFields) {
  state.reviewed_at = new Date().toISOString();
  for (const decision of state.decisions) {
    const title = reviewByIdentity.get(titleIdentity(decision));
    decision.approved = Boolean(title)
      && title.fields_to_review.every((field) => decision.reviewed_fields?.includes(field.field));
  }
  atomicWriteJson(decisionsPath, state);
  console.log("\n==========================================");
  console.log(" HUMAN REVIEW COMPLETE");
  console.log("==========================================");
  console.log(`${reviewedFields} decisions recorded in:`);
  console.log(decisionsPath);
} else {
  printStatus();
}
