const CLASSIFICATION_FIELDS = [
  "primary_subgenre",
  "secondary_subgenre",
  "tone_tags",
  "pacing",
];

export function classificationIdentity(value) {
  return `${value.media_type}:${value.tmdb_id}`;
}

function normalizedValue(field, value) {
  if (field === "tone_tags") return [...value].sort();
  return value;
}

function equalValue(field, left, right) {
  return JSON.stringify(normalizedValue(field, left)) === JSON.stringify(normalizedValue(field, right));
}

function validateControlledField({ field, value, identity, allowedSubgenres, allowedTones, allowedPacing, errors }) {
  if (field === "primary_subgenre" && !allowedSubgenres.has(value)) {
    errors.push(`${identity} has invalid primary_subgenre ${value}`);
  } else if (field === "secondary_subgenre" && value !== null && !allowedSubgenres.has(value)) {
    errors.push(`${identity} has invalid secondary_subgenre ${value}`);
  } else if (field === "tone_tags") {
    if (!Array.isArray(value) || value.length > 3) {
      errors.push(`${identity} tone_tags must contain zero to three values`);
    } else {
      if (new Set(value).size !== value.length) errors.push(`${identity} tone_tags contains duplicates`);
      for (const tone of value) {
        if (!allowedTones.has(tone)) errors.push(`${identity} has invalid tone tag ${tone}`);
      }
    }
  } else if (field === "pacing" && value !== null && !allowedPacing.has(value)) {
    errors.push(`${identity} has invalid pacing ${value}`);
  }
}

export function validateClassificationResponse({
  response,
  inputTitles,
  runId,
  batchNumber,
  ontologyVersion,
  subgenreIds,
  toneIds,
  pacingIds,
}) {
  const errors = [];
  const expectedIdentities = new Set(inputTitles.map(classificationIdentity));
  const allowedSubgenres = new Set(subgenreIds);
  const allowedTones = new Set(toneIds);
  const allowedPacing = new Set(pacingIds);

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Response must be a JSON object.");
  }
  if (typeof response.model !== "string" || !response.model.trim()) errors.push("model must be a non-empty string");
  if (response.run_id !== runId) errors.push(`run_id must be ${runId}`);
  if (response.batch_number !== batchNumber) errors.push(`batch_number must be ${batchNumber}`);
  if (response.ontology_version !== ontologyVersion) {
    errors.push(`ontology_version must be ${ontologyVersion}`);
  }
  if (!Array.isArray(response.classifications)) {
    errors.push("classifications must be an array");
  } else if (response.classifications.length !== inputTitles.length) {
    errors.push(`classifications must contain ${inputTitles.length} rows`);
  }

  const rowsByIdentity = new Map();
  for (const [index, row] of (response.classifications ?? []).entries()) {
    const label = `classifications[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const rowIdentity = classificationIdentity(row);
    if (!expectedIdentities.has(rowIdentity)) errors.push(`${label} has unexpected identity ${rowIdentity}`);
    if (rowsByIdentity.has(rowIdentity)) errors.push(`${label} duplicates ${rowIdentity}`);
    rowsByIdentity.set(rowIdentity, row);

    if (!allowedSubgenres.has(row.primary_subgenre)) {
      errors.push(`${rowIdentity} has invalid primary_subgenre ${row.primary_subgenre}`);
    }
    if (row.secondary_subgenre !== null && !allowedSubgenres.has(row.secondary_subgenre)) {
      errors.push(`${rowIdentity} has invalid secondary_subgenre ${row.secondary_subgenre}`);
    }
    if (row.secondary_subgenre === row.primary_subgenre) {
      errors.push(`${rowIdentity} repeats primary_subgenre as secondary_subgenre`);
    }
    if (!Array.isArray(row.tone_tags) || row.tone_tags.length > 3) {
      errors.push(`${rowIdentity} tone_tags must contain zero to three values`);
    } else {
      if (new Set(row.tone_tags).size !== row.tone_tags.length) {
        errors.push(`${rowIdentity} tone_tags contains duplicates`);
      }
      for (const tone of row.tone_tags) {
        if (!allowedTones.has(tone)) errors.push(`${rowIdentity} has invalid tone tag ${tone}`);
      }
    }
    if (row.pacing !== null && !allowedPacing.has(row.pacing)) {
      errors.push(`${rowIdentity} has invalid pacing ${row.pacing}`);
    }
    if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
      errors.push(`${rowIdentity} confidence must be between 0 and 1`);
    }
    if (typeof row.rationale !== "string" || !row.rationale.trim() || row.rationale.length > 600) {
      errors.push(`${rowIdentity} rationale must contain 1 to 600 characters`);
    }
  }

  for (const expectedIdentity of expectedIdentities) {
    if (!rowsByIdentity.has(expectedIdentity)) errors.push(`missing classification for ${expectedIdentity}`);
  }

  if (errors.length) {
    throw new Error(`Invalid ${response.model || "model"} response:\n- ${errors.join("\n- ")}`);
  }
  return rowsByIdentity;
}

export function reconcileClassificationResponses({ inputTitles, model1Rows, model2Rows }) {
  const perField = Object.fromEntries(
    CLASSIFICATION_FIELDS.map((field) => [field, { agreed: 0, conflicted: 0 }]),
  );
  let fullyAgreedTitles = 0;
  let agreedFields = 0;
  let conflictedFields = 0;

  const classifications = inputTitles.map((title) => {
    const rowIdentity = classificationIdentity(title);
    const first = model1Rows.get(rowIdentity);
    const second = model2Rows.get(rowIdentity);
    const agreed = {};
    const conflicts = {};

    for (const field of CLASSIFICATION_FIELDS) {
      if (equalValue(field, first[field], second[field])) {
        agreed[field] = normalizedValue(field, first[field]);
        perField[field].agreed += 1;
        agreedFields += 1;
      } else {
        conflicts[field] = {
          model_1: normalizedValue(field, first[field]),
          model_2: normalizedValue(field, second[field]),
        };
        perField[field].conflicted += 1;
        conflictedFields += 1;
      }
    }

    const conflictFields = Object.keys(conflicts);
    if (conflictFields.length === 0) fullyAgreedTitles += 1;

    return {
      tmdb_id: title.tmdb_id,
      media_type: title.media_type,
      title: title.title,
      agreed,
      conflicts,
      conflict_fields: conflictFields,
      model_confidence: {
        model_1: first.confidence,
        model_2: second.confidence,
      },
    };
  });

  return {
    classifications,
    summary: {
      title_count: inputTitles.length,
      fully_agreed_titles: fullyAgreedTitles,
      titles_with_conflicts: inputTitles.length - fullyAgreedTitles,
      agreed_fields: agreedFields,
      conflicted_fields: conflictedFields,
      per_field: perField,
    },
  };
}

export function validateArbiterResponse({
  response,
  arbiterTitles,
  runId,
  batchNumber,
  ontologyVersion,
  subgenreIds,
  toneIds,
  pacingIds,
}) {
  const errors = [];
  const expectedByIdentity = new Map(
    arbiterTitles.map((title) => [classificationIdentity(title), title]),
  );
  const allowedSubgenres = new Set(subgenreIds);
  const allowedTones = new Set(toneIds);
  const allowedPacing = new Set(pacingIds);

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Arbiter response must be a JSON object.");
  }
  if (typeof response.model !== "string" || !response.model.trim()) errors.push("model must be a non-empty string");
  if (response.run_id !== runId) errors.push(`run_id must be ${runId}`);
  if (response.batch_number !== batchNumber) errors.push(`batch_number must be ${batchNumber}`);
  if (response.ontology_version !== ontologyVersion) {
    errors.push(`ontology_version must be ${ontologyVersion}`);
  }
  if (!Array.isArray(response.resolutions)) {
    errors.push("resolutions must be an array");
  } else if (response.resolutions.length !== arbiterTitles.length) {
    errors.push(`resolutions must contain ${arbiterTitles.length} rows`);
  }

  const rowsByIdentity = new Map();
  for (const [index, row] of (response.resolutions ?? []).entries()) {
    const label = `resolutions[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const rowIdentity = classificationIdentity(row);
    const expected = expectedByIdentity.get(rowIdentity);
    if (!expected) errors.push(`${label} has unexpected identity ${rowIdentity}`);
    if (rowsByIdentity.has(rowIdentity)) errors.push(`${label} duplicates ${rowIdentity}`);
    rowsByIdentity.set(rowIdentity, row);

    if (!row.resolved || typeof row.resolved !== "object" || Array.isArray(row.resolved)) {
      errors.push(`${rowIdentity} resolved must be an object`);
      continue;
    }
    if (expected) {
      const expectedFields = Object.keys(expected.conflicts).sort();
      const resolvedFields = Object.keys(row.resolved).sort();
      if (JSON.stringify(expectedFields) !== JSON.stringify(resolvedFields)) {
        errors.push(
          `${rowIdentity} must resolve exactly [${expectedFields.join(", ")}], received [${resolvedFields.join(", ")}]`,
        );
      }
    }
    for (const [field, value] of Object.entries(row.resolved)) {
      if (!CLASSIFICATION_FIELDS.includes(field)) {
        errors.push(`${rowIdentity} has unexpected resolved field ${field}`);
        continue;
      }
      validateControlledField({
        field,
        value,
        identity: rowIdentity,
        allowedSubgenres,
        allowedTones,
        allowedPacing,
        errors,
      });
    }
    if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
      errors.push(`${rowIdentity} confidence must be between 0 and 1`);
    }
    if (typeof row.rationale !== "string" || !row.rationale.trim() || row.rationale.length > 600) {
      errors.push(`${rowIdentity} rationale must contain 1 to 600 characters`);
    }

    if (expected) {
      const combined = { ...expected.agreed_fields, ...row.resolved };
      if (combined.secondary_subgenre === combined.primary_subgenre) {
        errors.push(`${rowIdentity} repeats primary_subgenre as secondary_subgenre after merge`);
      }
    }
  }

  for (const expectedIdentity of expectedByIdentity.keys()) {
    if (!rowsByIdentity.has(expectedIdentity)) errors.push(`missing arbiter resolution for ${expectedIdentity}`);
  }
  if (errors.length) {
    throw new Error(`Invalid ${response.model || "arbiter"} response:\n- ${errors.join("\n- ")}`);
  }
  return rowsByIdentity;
}

export function finalizeArbiterResolutions({ inputTitles, consensusRows, arbiterRows, minimumConfidence = 0.75 }) {
  const inputByIdentity = new Map(inputTitles.map((title) => [classificationIdentity(title), title]));
  const humanReview = [];
  let arbiterMajorityFields = 0;
  let arbiterNovelFields = 0;
  let lowConfidenceFields = 0;
  let automatedCompleteTitles = 0;

  const classifications = consensusRows.map((consensus) => {
    const rowIdentity = classificationIdentity(consensus);
    const input = inputByIdentity.get(rowIdentity);
    const arbiter = arbiterRows.get(rowIdentity);
    const finalValues = { ...consensus.agreed };
    const fieldSources = Object.fromEntries(
      Object.keys(consensus.agreed).map((field) => [field, "two-model-agreement"]),
    );
    const pendingFields = [];

    for (const [field, candidates] of Object.entries(consensus.conflicts)) {
      const value = normalizedValue(field, arbiter.resolved[field]);
      const matchesModel1 = equalValue(field, value, candidates.model_1);
      const matchesModel2 = equalValue(field, value, candidates.model_2);
      const hasMajority = matchesModel1 || matchesModel2;
      const lowConfidence = arbiter.confidence < minimumConfidence;
      const reasons = [];
      if (!hasMajority) {
        reasons.push("no-three-model-majority");
        arbiterNovelFields += 1;
      } else {
        arbiterMajorityFields += 1;
      }
      if (lowConfidence) {
        reasons.push("arbiter-confidence-below-threshold");
        lowConfidenceFields += 1;
      }

      finalValues[field] = value;
      fieldSources[field] = reasons.length ? "arbiter-provisional" : "arbiter-majority";
      if (reasons.length) {
        pendingFields.push({
          field,
          model_1: candidates.model_1,
          model_2: candidates.model_2,
          arbiter: value,
          arbiter_confidence: arbiter.confidence,
          arbiter_rationale: arbiter.rationale,
          reasons,
        });
      }
    }

    if (pendingFields.length) {
      humanReview.push({
        ...input,
        accepted_fields: Object.fromEntries(
          Object.entries(finalValues).filter(([field]) => !pendingFields.some((pending) => pending.field === field)),
        ),
        fields_to_review: pendingFields,
      });
    } else {
      automatedCompleteTitles += 1;
    }

    return {
      tmdb_id: consensus.tmdb_id,
      media_type: consensus.media_type,
      title: consensus.title,
      primary_subgenre: finalValues.primary_subgenre,
      secondary_subgenre: finalValues.secondary_subgenre,
      tone_tags: finalValues.tone_tags,
      pacing: finalValues.pacing,
      field_sources: fieldSources,
      review_status: pendingFields.length ? "human_review_pending" : "automated_consensus",
      human_review_pending_fields: pendingFields.map((pending) => pending.field),
    };
  });

  return {
    classifications,
    humanReview,
    summary: {
      title_count: classifications.length,
      automated_complete_titles: automatedCompleteTitles,
      human_review_titles: humanReview.length,
      human_review_fields: humanReview.reduce((total, title) => total + title.fields_to_review.length, 0),
      arbiter_majority_fields: arbiterMajorityFields,
      arbiter_novel_fields: arbiterNovelFields,
      low_confidence_fields: lowConfidenceFields,
      minimum_arbiter_confidence: minimumConfidence,
    },
  };
}

export function validateHumanReviewDecisions({
  decisions,
  reviewTitles,
  runId,
  batchNumber,
  ontologyVersion,
  subgenreIds,
  toneIds,
  pacingIds,
}) {
  const errors = [];
  const expectedByIdentity = new Map(
    reviewTitles.map((title) => [classificationIdentity(title), title]),
  );
  const allowedSubgenres = new Set(subgenreIds);
  const allowedTones = new Set(toneIds);
  const allowedPacing = new Set(pacingIds);

  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) {
    throw new Error("Human-review decisions must be a JSON object.");
  }
  if (decisions.run_id !== runId) errors.push(`run_id must be ${runId}`);
  if (decisions.batch_number !== batchNumber) errors.push(`batch_number must be ${batchNumber}`);
  if (decisions.ontology_version !== ontologyVersion) {
    errors.push(`ontology_version must be ${ontologyVersion}`);
  }
  if (typeof decisions.reviewer !== "string" || !decisions.reviewer.trim()) {
    errors.push("reviewer must be a non-empty string");
  }
  if (!decisions.reviewed_at || Number.isNaN(Date.parse(decisions.reviewed_at))) {
    errors.push("reviewed_at must be a valid timestamp");
  }
  if (!Array.isArray(decisions.decisions)) {
    errors.push("decisions must be an array");
  } else if (decisions.decisions.length !== reviewTitles.length) {
    errors.push(`decisions must contain ${reviewTitles.length} rows`);
  }

  const rowsByIdentity = new Map();
  for (const [index, row] of (decisions.decisions ?? []).entries()) {
    const label = `decisions[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const rowIdentity = classificationIdentity(row);
    const expected = expectedByIdentity.get(rowIdentity);
    if (!expected) errors.push(`${label} has unexpected identity ${rowIdentity}`);
    if (rowsByIdentity.has(rowIdentity)) errors.push(`${label} duplicates ${rowIdentity}`);
    rowsByIdentity.set(rowIdentity, row);
    if (row.approved !== true) errors.push(`${rowIdentity} must be approved`);
    if (!row.resolved || typeof row.resolved !== "object" || Array.isArray(row.resolved)) {
      errors.push(`${rowIdentity} resolved must be an object`);
      continue;
    }

    if (expected) {
      const expectedFields = expected.fields_to_review.map((field) => field.field).sort();
      const reviewedFields = [...(row.reviewed_fields ?? [])].sort();
      const resolvedFields = Object.keys(row.resolved).sort();
      if (JSON.stringify(expectedFields) !== JSON.stringify(reviewedFields)) {
        errors.push(
          `${rowIdentity} reviewed_fields must be exactly [${expectedFields.join(", ")}]`,
        );
      }
      if (JSON.stringify(expectedFields) !== JSON.stringify(resolvedFields)) {
        errors.push(
          `${rowIdentity} resolved fields must be exactly [${expectedFields.join(", ")}]`,
        );
      }
    }

    for (const [field, value] of Object.entries(row.resolved)) {
      if (!CLASSIFICATION_FIELDS.includes(field)) {
        errors.push(`${rowIdentity} has unexpected resolved field ${field}`);
        continue;
      }
      validateControlledField({
        field,
        value,
        identity: rowIdentity,
        allowedSubgenres,
        allowedTones,
        allowedPacing,
        errors,
      });
    }
    if (expected) {
      const combined = { ...expected.accepted_fields, ...row.resolved };
      if (combined.secondary_subgenre === combined.primary_subgenre) {
        errors.push(`${rowIdentity} repeats primary_subgenre as secondary_subgenre after merge`);
      }
    }
  }

  for (const expectedIdentity of expectedByIdentity.keys()) {
    if (!rowsByIdentity.has(expectedIdentity)) errors.push(`missing human decision for ${expectedIdentity}`);
  }
  if (errors.length) {
    throw new Error(`Invalid human-review decisions:\n- ${errors.join("\n- ")}`);
  }
  return rowsByIdentity;
}

export function applyHumanReviewDecisions({ provisionalClassifications, decisionRows }) {
  let humanVerifiedTitles = 0;
  let humanDecisionFields = 0;
  const classifications = provisionalClassifications.map((classification) => {
    const decision = decisionRows.get(classificationIdentity(classification));
    if (!decision) return { ...classification };

    const updated = {
      ...classification,
      field_sources: { ...classification.field_sources },
      review_status: "human_verified",
      human_review_pending_fields: [],
    };
    for (const [field, value] of Object.entries(decision.resolved)) {
      updated[field] = normalizedValue(field, value);
      updated.field_sources[field] = "human-review";
      humanDecisionFields += 1;
    }
    humanVerifiedTitles += 1;
    return updated;
  });

  const pending = classifications.filter(
    (classification) => classification.human_review_pending_fields.length > 0,
  );
  if (pending.length) {
    throw new Error(`Human review did not resolve ${pending.length} title(s).`);
  }
  return {
    classifications,
    summary: {
      title_count: classifications.length,
      automated_consensus_titles: classifications.length - humanVerifiedTitles,
      human_verified_titles: humanVerifiedTitles,
      human_decision_fields: humanDecisionFields,
      pending_human_review_fields: 0,
    },
  };
}

export { CLASSIFICATION_FIELDS };
