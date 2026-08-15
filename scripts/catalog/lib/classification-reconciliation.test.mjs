import { describe, expect, it } from "vitest";

import {
  applyHumanReviewDecisions,
  classificationIdentity,
  finalizeArbiterResolutions,
  reconcileClassificationResponses,
  validateArbiterResponse,
  validateClassificationResponse,
  validateHumanReviewDecisions,
} from "./classification-reconciliation.mjs";

const inputTitles = [
  { tmdb_id: 1, media_type: "movie", title: "One" },
  { tmdb_id: 2, media_type: "tv", title: "Two" },
];

function response(model) {
  return {
    model,
    run_id: "run",
    batch_number: 1,
    ontology_version: "1",
    classifications: inputTitles.map((title) => ({
      tmdb_id: title.tmdb_id,
      media_type: title.media_type,
      primary_subgenre: "crime",
      secondary_subgenre: null,
      tone_tags: ["tense", "dark"],
      pacing: "fast",
      confidence: 0.9,
      rationale: "Evidence.",
    })),
  };
}

const validationOptions = {
  inputTitles,
  runId: "run",
  batchNumber: 1,
  ontologyVersion: "1",
  subgenreIds: ["crime", "thriller"],
  toneIds: ["tense", "dark"],
  pacingIds: ["slow", "moderate", "fast"],
};

describe("classification reconciliation", () => {
  it("validates identities and controlled vocabulary", () => {
    const rows = validateClassificationResponse({ response: response("one"), ...validationOptions });
    expect(rows.get("movie:1").primary_subgenre).toBe("crime");
    expect(classificationIdentity(inputTitles[1])).toBe("tv:2");
  });

  it("rejects duplicate and invalid classifications", () => {
    const invalid = response("bad");
    invalid.classifications[1] = { ...invalid.classifications[0], primary_subgenre: "unknown" };
    expect(() => validateClassificationResponse({ response: invalid, ...validationOptions }))
      .toThrow(/duplicates movie:1/);
  });

  it("accepts tone agreement independent of order and isolates field conflicts", () => {
    const first = response("one");
    const second = response("two");
    second.classifications[0].tone_tags = ["dark", "tense"];
    second.classifications[1].primary_subgenre = "thriller";
    const model1Rows = validateClassificationResponse({ response: first, ...validationOptions });
    const model2Rows = validateClassificationResponse({ response: second, ...validationOptions });
    const result = reconcileClassificationResponses({ inputTitles, model1Rows, model2Rows });

    expect(result.summary.fully_agreed_titles).toBe(1);
    expect(result.summary.conflicted_fields).toBe(1);
    expect(result.classifications[0].agreed.tone_tags).toEqual(["dark", "tense"]);
    expect(result.classifications[1].conflict_fields).toEqual(["primary_subgenre"]);
  });

  it("validates arbiter coverage and routes novel or low-confidence decisions to people", () => {
    const first = response("one");
    const second = response("two");
    second.classifications[0].tone_tags = ["tense"];
    second.classifications[1].primary_subgenre = "thriller";
    const model1Rows = validateClassificationResponse({ response: first, ...validationOptions });
    const model2Rows = validateClassificationResponse({ response: second, ...validationOptions });
    const reconciliation = reconcileClassificationResponses({ inputTitles, model1Rows, model2Rows });
    const arbiterTitles = reconciliation.classifications
      .filter((row) => row.conflict_fields.length)
      .map((row) => ({
        ...inputTitles.find((title) => classificationIdentity(title) === classificationIdentity(row)),
        agreed_fields: row.agreed,
        conflicts: row.conflicts,
      }));
    const arbiterResponse = {
      model: "arbiter",
      run_id: "run",
      batch_number: 1,
      ontology_version: "1",
      resolutions: [
        {
          tmdb_id: 1,
          media_type: "movie",
          resolved: { tone_tags: ["dark"] },
          confidence: 0.9,
          rationale: "A third combination remains ambiguous.",
        },
        {
          tmdb_id: 2,
          media_type: "tv",
          resolved: { primary_subgenre: "thriller" },
          confidence: 0.7,
          rationale: "Matches model two with low confidence.",
        },
      ],
    };
    const arbiterRows = validateArbiterResponse({
      response: arbiterResponse,
      arbiterTitles,
      runId: "run",
      batchNumber: 1,
      ontologyVersion: "1",
      subgenreIds: validationOptions.subgenreIds,
      toneIds: validationOptions.toneIds,
      pacingIds: validationOptions.pacingIds,
    });
    const finalized = finalizeArbiterResolutions({
      inputTitles,
      consensusRows: reconciliation.classifications,
      arbiterRows,
      minimumConfidence: 0.75,
    });

    expect(finalized.summary.human_review_titles).toBe(2);
    expect(finalized.summary.arbiter_novel_fields).toBe(1);
    expect(finalized.summary.low_confidence_fields).toBe(1);
  });

  it("validates and applies completed human decisions", () => {
    const reviewTitles = [{
      ...inputTitles[0],
      accepted_fields: {
        primary_subgenre: "crime",
        secondary_subgenre: null,
        pacing: "fast",
      },
      fields_to_review: [{ field: "tone_tags" }],
    }];
    const decisions = {
      run_id: "run",
      batch_number: 1,
      ontology_version: "1",
      reviewer: "editor",
      reviewed_at: "2026-08-15T00:00:00.000Z",
      decisions: [{
        tmdb_id: 1,
        media_type: "movie",
        approved: true,
        reviewed_fields: ["tone_tags"],
        resolved: { tone_tags: ["dark", "tense"] },
      }],
    };
    const decisionRows = validateHumanReviewDecisions({
      decisions,
      reviewTitles,
      runId: "run",
      batchNumber: 1,
      ontologyVersion: "1",
      subgenreIds: validationOptions.subgenreIds,
      toneIds: validationOptions.toneIds,
      pacingIds: validationOptions.pacingIds,
    });
    const result = applyHumanReviewDecisions({
      provisionalClassifications: [{
        tmdb_id: 1,
        media_type: "movie",
        primary_subgenre: "crime",
        secondary_subgenre: null,
        tone_tags: ["tense"],
        pacing: "fast",
        field_sources: { tone_tags: "arbiter-provisional" },
        review_status: "human_review_pending",
        human_review_pending_fields: ["tone_tags"],
      }],
      decisionRows,
    });

    expect(result.summary.pending_human_review_fields).toBe(0);
    expect(result.classifications[0].tone_tags).toEqual(["dark", "tense"]);
    expect(result.classifications[0].review_status).toBe("human_verified");
  });
});
