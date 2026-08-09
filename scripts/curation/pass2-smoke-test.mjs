#!/usr/bin/env node
/**
 * pass2-smoke-test.mjs
 *
 * Smoke-tests scripts/curation/compare-pass2.mjs against synthetic fixtures, without touching
 * curation/pilot/pass2/*-pass2.json (which don't exist yet — the real comparator run is
 * intentionally blocked until a human produces them via the manual ChatGPT/Claude/Gemini
 * workflow in curation/pilot/pass2/README.md).
 *
 * It reuses four REAL titles/disputes from the real adjudication-input.json (so the
 * proposed-final-classifications.json merge step, which reads the real Pass 1 data, has
 * something real to merge against) and fabricates three synthetic *-pass2.json adjudication
 * files that deliberately exercise:
 *   - AUTO_ACCEPT      (tone_tags on Across the Spider-Verse: unanimous set, 1 human_review ok)
 *   - PROVISIONAL_ACCEPT (secondary_subgenre on Across the Spider-Verse: 2-of-3 agree)
 *   - HUMAN_REVIEW via "all three different" (primary_subgenre on The Super Mario Galaxy Movie)
 *   - HUMAN_REVIEW via ">=2 human_review requests" despite 2-of-3 value agreement
 *     (secondary_subgenre on Project Hail Mary)
 *   - HUMAN_REVIEW + validation error via an invalid controlled-vocabulary id
 *     (primary_subgenre on The Godfather)
 *   - a validation error via an adjudicated field that was never disputed for that title
 *     (an extra primary_subgenre entry injected into gemini's Project Hail Mary adjudication)
 *
 * All fixtures and outputs live under a temp directory and are deleted at the end (unless
 * --keep is passed). Nothing under curation/pilot/pass2/ is written or modified.
 *
 * Usage: node scripts/curation/pass2-smoke-test.mjs [--keep]
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const REAL_PASS2_DIR = path.join(ROOT, "curation/pilot/pass2");
const COMPARE_SCRIPT = path.join(__dirname, "compare-pass2.mjs");

const KEEP = process.argv.includes("--keep");

function loadJSON(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`SMOKE TEST FAILED: ${msg}`);
  console.log(`  ok — ${msg}`);
}

function pickTitle(realInput, tmdbId) {
  const t = realInput.titles.find(x => x.tmdb_id === tmdbId);
  if (!t) throw new Error(`Fixture setup: tmdb_id ${tmdbId} not found in real adjudication-input.json`);
  return t;
}

function baseAdjudication(t) {
  return { tmdb_id: t.tmdb_id, media_type: t.media_type };
}

function main() {
  const realInput = loadJSON(path.join(REAL_PASS2_DIR, "adjudication-input.json"));
  const realMap = loadJSON(path.join(REAL_PASS2_DIR, "proposal-map.json"));

  const IDS = {
    spiderVerse: 569094, // tone_tags + secondary_subgenre
    marioGalaxy: 1226863, // primary_subgenre only
    hailMary: 687163, // secondary_subgenre only
    godfather: 238, // primary_subgenre only
  };

  const fixtureTitles = Object.values(IDS).map(id => pickTitle(realInput, id));
  const fixtureMapEntries = Object.values(IDS).map(id =>
    realMap.entries.find(e => e.tmdb_id === id)
  );

  const tmp = mkdtempSync(path.join(os.tmpdir(), "pass2-smoke-"));
  console.log(`Fixture dir: ${tmp}`);

  writeFileSync(
    path.join(tmp, "adjudication-input.json"),
    JSON.stringify({ ontology_version: "0.1.1", pass: 2, title_count: fixtureTitles.length, titles: fixtureTitles }, null, 2)
  );
  writeFileSync(
    path.join(tmp, "proposal-map.json"),
    JSON.stringify({ seed: realMap.seed, entries: fixtureMapEntries }, null, 2)
  );

  const spiderVerse = pickTitle(realInput, IDS.spiderVerse);
  const marioGalaxy = pickTitle(realInput, IDS.marioGalaxy);
  const hailMary = pickTitle(realInput, IDS.hailMary);
  const godfather = pickTitle(realInput, IDS.godfather);

  const chatgptAdjudications = [
    {
      ...baseAdjudication(spiderVerse),
      fields: [
        { field: "tone_tags", preferred_value: ["stylized", "earnest"], human_review: false, severity: "minor", reason: "Consistent stylized-but-sincere register across the source material." },
        { field: "secondary_subgenre", preferred_value: "adventure-action", human_review: false, severity: "minor", reason: "Multiverse chase structure adds real information beyond superhero." },
      ],
    },
    {
      ...baseAdjudication(marioGalaxy),
      fields: [
        { field: "primary_subgenre", preferred_value: "adventure-action", human_review: false, severity: "meaningful", reason: "Quest-driven spectacle, not primarily an all-ages-signal title." },
      ],
    },
    {
      ...baseAdjudication(hailMary),
      fields: [
        { field: "secondary_subgenre", preferred_value: "alien-first-contact", human_review: true, severity: "minor", reason: "First-contact plot thread is present but secondary to the survival premise; flagging for review." },
      ],
    },
    {
      ...baseAdjudication(godfather),
      fields: [
        { field: "primary_subgenre", preferred_value: "organized-crime", human_review: false, severity: "meaningful", reason: "Institutional focus on the Corleone family as an organization." },
      ],
    },
  ];

  const claudeAdjudications = [
    {
      ...baseAdjudication(spiderVerse),
      fields: [
        { field: "tone_tags", preferred_value: ["earnest", "stylized"], human_review: true, severity: "minor", reason: "Same two tags, order-independent; flagging low-confidence on omitting tense." },
        { field: "secondary_subgenre", preferred_value: "adventure-action", human_review: false, severity: "minor", reason: "Agrees the multiverse-chase structure is the meaningful secondary." },
      ],
    },
    {
      ...baseAdjudication(marioGalaxy),
      fields: [
        { field: "primary_subgenre", preferred_value: "animated-family", human_review: false, severity: "meaningful", reason: "All-ages framing is the more useful signal for this title." },
      ],
    },
    {
      ...baseAdjudication(hailMary),
      fields: [
        { field: "secondary_subgenre", preferred_value: "alien-first-contact", human_review: true, severity: "minor", reason: "Agrees on value but the call is close enough to flag." },
      ],
    },
    {
      ...baseAdjudication(godfather),
      fields: [
        // Deliberately invalid controlled-vocabulary id, to test validation + HUMAN_REVIEW-via-invalid.
        { field: "primary_subgenre", preferred_value: "mafia-saga", human_review: false, severity: "meaningful", reason: "Invalid id, injected deliberately for smoke-test validation coverage." },
      ],
    },
  ];

  const geminiAdjudications = [
    {
      ...baseAdjudication(spiderVerse),
      fields: [
        { field: "tone_tags", preferred_value: ["stylized", "earnest"], human_review: false, severity: "minor", reason: "Matches the visual/emotional register described in context." },
        { field: "secondary_subgenre", preferred_value: "animated-family", human_review: false, severity: "meaningful", reason: "Minority read: the animation packaging is itself notable here." },
      ],
    },
    {
      ...baseAdjudication(marioGalaxy),
      fields: [
        { field: "primary_subgenre", preferred_value: "epic-fantasy", human_review: false, severity: "fundamental", reason: "Deliberately divergent third reading, injected for all-three-differ coverage." },
      ],
    },
    {
      ...baseAdjudication(hailMary),
      fields: [
        { field: "secondary_subgenre", preferred_value: null, human_review: false, severity: "minor", reason: "Prefers no forced secondary." },
        // Deliberately unexpected field (was never disputed for this title) to test that validation error path.
        { field: "primary_subgenre", preferred_value: "crime-drama", human_review: false, severity: "minor", reason: "Injected deliberately: this field was never disputed for this title." },
      ],
    },
    {
      ...baseAdjudication(godfather),
      fields: [
        { field: "primary_subgenre", preferred_value: "gangster", human_review: false, severity: "meaningful", reason: "Rise-and-fall arc of a single criminal figure is the dominant structure." },
      ],
    },
  ];

  for (const [name, adjudications] of [
    ["chatgpt-pass2.json", chatgptAdjudications],
    ["claude-pass2.json", claudeAdjudications],
    ["gemini-pass2.json", geminiAdjudications],
  ]) {
    writeFileSync(
      path.join(tmp, name),
      JSON.stringify({ ontology_version: "0.1.1", pass: 2, adjudications }, null, 2)
    );
  }

  console.log("Running compare-pass2.mjs against fixtures...");
  let stdout;
  try {
    stdout = execFileSync("node", [COMPARE_SCRIPT, `--input-dir=${tmp}`, `--out-dir=${tmp}`], { encoding: "utf8" });
  } catch (err) {
    console.error(err.stdout ?? "");
    console.error(err.stderr ?? "");
    throw new Error("compare-pass2.mjs exited non-zero against fixtures — see output above");
  }
  console.log(stdout);

  console.log("Checking outputs...");
  const summary = loadJSON(path.join(tmp, "pass2-summary.json"));
  const auto = loadJSON(path.join(tmp, "auto-accepted.json"));
  const provisional = loadJSON(path.join(tmp, "provisional-accepted.json"));
  const humanReview = loadJSON(path.join(tmp, "human-review.json"));
  const final = loadJSON(path.join(tmp, "proposed-final-classifications.json"));

  assert(summary.disputed_field_count === 5, `disputed_field_count is 5 (got ${summary.disputed_field_count})`);
  assert(summary.validation.chatgpt.error_count === 0, `chatgpt has 0 validation errors (got ${summary.validation.chatgpt.error_count})`);
  assert(summary.validation.claude.error_count >= 1, `claude has >=1 validation error for the injected invalid id (got ${summary.validation.claude.error_count})`);
  assert(summary.validation.gemini.error_count >= 1, `gemini has >=1 validation error for the injected unexpected field (got ${summary.validation.gemini.error_count})`);

  const autoTone = auto.items.find(i => i.tmdb_id === IDS.spiderVerse && i.field === "tone_tags");
  assert(!!autoTone, "AUTO_ACCEPT includes Across the Spider-Verse tone_tags");
  assert(JSON.stringify([...autoTone.resolved_value].sort()) === JSON.stringify(["earnest", "stylized"]), "AUTO_ACCEPT tone_tags resolved to {earnest, stylized} regardless of proposal order");

  const provisionalSecondary = provisional.items.find(i => i.tmdb_id === IDS.spiderVerse && i.field === "secondary_subgenre");
  assert(!!provisionalSecondary, "PROVISIONAL_ACCEPT includes Across the Spider-Verse secondary_subgenre");
  assert(provisionalSecondary.resolved_value === "adventure-action", `PROVISIONAL_ACCEPT resolved_value is "adventure-action" (got ${provisionalSecondary.resolved_value})`);

  const marioHR = humanReview.items.find(i => i.tmdb_id === IDS.marioGalaxy && i.field === "primary_subgenre");
  assert(!!marioHR && marioHR.consensus_type === "none", "Mario Galaxy primary_subgenre is HUMAN_REVIEW via all-three-differ");

  const hailMaryHR = humanReview.items.find(i => i.tmdb_id === IDS.hailMary && i.field === "secondary_subgenre");
  assert(!!hailMaryHR && hailMaryHR.human_review_requests >= 2, "Project Hail Mary secondary_subgenre is HUMAN_REVIEW via >=2 human_review requests despite 2-of-3 value agreement");

  const godfatherHR = humanReview.items.find(i => i.tmdb_id === IDS.godfather && i.field === "primary_subgenre");
  assert(!!godfatherHR && godfatherHR.consensus_type === "invalid", "The Godfather primary_subgenre is HUMAN_REVIEW via invalid output detection");

  assert(summary.resolution_counts.HUMAN_REVIEW >= 3, `at least 3 fields resolved to HUMAN_REVIEW (got ${summary.resolution_counts.HUMAN_REVIEW})`);
  assert(final.title_count === 100, `proposed-final-classifications.json covers all 100 Pass 1 titles (got ${final.title_count})`);
  assert(final.pending_human_review_field_count >= 3, `merge marks >=3 fields as pending human review (got ${final.pending_human_review_field_count})`);

  const finalMario = final.classifications.find(c => c.tmdb_id === IDS.marioGalaxy);
  assert(finalMario.primary_subgenre.human_review_pending === true && finalMario.primary_subgenre.value === null, "merged final record marks Mario Galaxy primary_subgenre as pending, value null (not silently resolved)");

  const finalSpiderVerse = final.classifications.find(c => c.tmdb_id === IDS.spiderVerse);
  assert(
    finalSpiderVerse.secondary_subgenre.value === "adventure-action" && finalSpiderVerse.secondary_subgenre.source.startsWith("pass2-provisional"),
    `merged final record uses Pass 2 provisional value for Spider-Verse secondary_subgenre (got value=${finalSpiderVerse.secondary_subgenre.value}, source=${finalSpiderVerse.secondary_subgenre.source})`
  );

  // Un-disputed title should fall back to Pass 1 policy untouched.
  const untouchedTitle = final.classifications.find(c => c.tmdb_id !== IDS.spiderVerse && c.tmdb_id !== IDS.marioGalaxy && c.tmdb_id !== IDS.hailMary && c.tmdb_id !== IDS.godfather);
  assert(["pass1-full", "pass1-majority"].includes(untouchedTitle.primary_subgenre.source), "titles outside the fixture set still resolve via Pass 1 policy (full/majority), untouched");

  console.log("\nAll smoke-test assertions passed.");

  if (KEEP) {
    console.log(`Fixtures kept at: ${tmp}`);
  } else {
    rmSync(tmp, { recursive: true, force: true });
    console.log("Fixture directory cleaned up.");
  }

  // Confirm the real comparator still refuses to run for real (no pass2 model files exist yet).
  const realFilesExist = ["chatgpt-pass2.json", "claude-pass2.json", "gemini-pass2.json"]
    .every(f => existsSync(path.join(REAL_PASS2_DIR, f)));
  assert(!realFilesExist, "real curation/pilot/pass2/*-pass2.json files still do not exist — real comparator run remains correctly blocked");
}

main();
