import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = process.cwd();

const REVIEW_PATH = path.join(
  ROOT,
  "curation/pilot/pass2/human-review.json"
);

const PROPOSED_PATH = path.join(
  ROOT,
  "curation/pilot/pass2/proposed-final-classifications.json"
);

const DECISIONS_PATH = path.join(
  ROOT,
  "curation/pilot/pass2/human-decisions.json"
);

const FINAL_PATH = path.join(
  ROOT,
  "curation/pilot/pass2/final-classifications.json"
);

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function formatValue(value) {
  if (value === null) return "NULL / no secondary";
  if (Array.isArray(value)) return value.join(" · ");
  return String(value);
}

function decisionKey(item) {
  return `${item.media_type}:${item.tmdb_id}:${item.field}`;
}

if (!fs.existsSync(REVIEW_PATH)) {
  throw new Error(`Missing ${REVIEW_PATH}`);
}

if (!fs.existsSync(PROPOSED_PATH)) {
  throw new Error(`Missing ${PROPOSED_PATH}`);
}

const review = readJSON(REVIEW_PATH);
const proposed = readJSON(PROPOSED_PATH);

const previous = fs.existsSync(DECISIONS_PATH)
  ? readJSON(DECISIONS_PATH)
  : {
      ontology_version: review.ontology_version,
      decisions: []
    };

const decisionMap = new Map(
  previous.decisions.map(d => [d.key, d])
);

const rl = readline.createInterface({ input, output });

console.log("");
console.log("==========================================");
console.log(" WHAT TO WATCH — HUMAN EDITORIAL REVIEW");
console.log("==========================================");
console.log("");
console.log(`${review.items.length} disputed fields total.`);
console.log("Choose A, B, or C.");
console.log("Type Q at any time to save and quit.");
console.log("");

let completedThisRun = 0;

for (let index = 0; index < review.items.length; index++) {
  const item = review.items[index];
  const key = decisionKey(item);

  if (decisionMap.has(key)) {
    continue;
  }

  console.log("\n");
  console.log("==========================================");
  console.log(`[${index + 1}/${review.items.length}] ${item.title}`);
  console.log(`Field: ${item.field}`);
  console.log("==========================================\n");

  console.log(`A  ${formatValue(item.proposals.proposal_a)}`);
  console.log(`B  ${formatValue(item.proposals.proposal_b)}`);
  console.log(`C  ${formatValue(item.proposals.proposal_c)}`);

  console.log("");

  // Brief adjudication context, without changing the choices.
  if (item.adjudications) {
    console.log("Reviewers:");

    for (const [name, adjudication] of Object.entries(item.adjudications)) {
      console.log(
        `  ${name}: ${formatValue(adjudication.preferred_value)}`
      );
    }

    console.log("");
  }

  let choice;

  while (true) {
    const answer = (
      await rl.question("Your choice [A/B/C/Q]: ")
    )
      .trim()
      .toUpperCase();

    if (answer === "Q") {
      writeJSON(DECISIONS_PATH, {
        ontology_version: review.ontology_version,
        updated_at: new Date().toISOString(),
        decisions: [...decisionMap.values()]
      });

      console.log("");
      console.log(`Saved progress to:`);
      console.log(DECISIONS_PATH);
      console.log("");
      await rl.close();
      process.exit(0);
    }

    if (["A", "B", "C"].includes(answer)) {
      choice = answer;
      break;
    }

    console.log("Please enter A, B, C, or Q.");
  }

  const proposalKey = `proposal_${choice.toLowerCase()}`;
  const selectedValue = item.proposals[proposalKey];

  const decision = {
    key,
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    field: item.field,
    choice,
    value: selectedValue,
    decided_at: new Date().toISOString()
  };

  decisionMap.set(key, decision);
  completedThisRun++;

  // Save after every answer.
  writeJSON(DECISIONS_PATH, {
    ontology_version: review.ontology_version,
    updated_at: new Date().toISOString(),
    decisions: [...decisionMap.values()]
  });

  console.log(`✓ Selected ${choice}: ${formatValue(selectedValue)}`);
}

await rl.close();

const decisions = [...decisionMap.values()];

if (decisions.length !== review.items.length) {
  console.log("");
  console.log(
    `Saved ${decisions.length}/${review.items.length} decisions.`
  );
  console.log("Run the script again to continue.");
  process.exit(0);
}

// Apply human decisions to a copy of the proposed final classifications.
const finalData = structuredClone(proposed);

for (const decision of decisions) {
  const title = finalData.classifications.find(
    t =>
      t.tmdb_id === decision.tmdb_id &&
      t.media_type === decision.media_type
  );

  if (!title) {
    throw new Error(
      `Could not find ${decision.media_type}:${decision.tmdb_id}`
    );
  }

  if (!title[decision.field]) {
    throw new Error(
      `Missing field ${decision.field} on ${decision.title}`
    );
  }

  title[decision.field] = {
    value: decision.value,
    source: "human-review",
    human_review_pending: false
  };
}

finalData.pending_human_review_field_count = 0;
finalData.human_review_completed_at = new Date().toISOString();
finalData.human_decision_count = decisions.length;

writeJSON(FINAL_PATH, finalData);

console.log("");
console.log("==========================================");
console.log(" HUMAN REVIEW COMPLETE");
console.log("==========================================");
console.log("");
console.log(`${decisions.length} human decisions recorded.`);
console.log("");
console.log("Decisions:");
console.log(DECISIONS_PATH);
console.log("");
console.log("Final classifications:");
console.log(FINAL_PATH);
console.log("");
