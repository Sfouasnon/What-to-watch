import type { QuestionnaireDimension, QuestionnaireProfile } from "./types";

export const QUESTIONNAIRE_DIMENSION_MAP = {
  cerebral: "cerebral",
  emotional: "emotionalIntensity",
  darkness: "darknessTolerance",
  thrill: "thrill",
  imagination: "imagination",
  dryComedy: "dryComedy",
  darkComedy: "darkComedy",
  broadComedy: "broadComedy",
  standup: "standUp",
  character: "characterOrientation",
  realism: "realism",
  ambiguity: "ambiguityTolerance",
  slowPace: "slowPacing",
  novelty: "novelty",
  discovery: "discovery",
  classics: "classicOpenness",
  international: "internationalOpenness",
  horror: "psychologicalHorror",
  psychologicalHorror: "psychologicalHorror",
  gore: "goreTolerance",
  goreTolerance: "goreTolerance",
  rewatch: "rewatchOrientation",
  tvCommitment: "televisionCommitment",
  binge: "bingePreference",
} as const satisfies Record<string, QuestionnaireDimension>;

export const TRADEOFF_ANSWER_MAP = {
  "tradeoff:0": "pace",
  "tradeoff:1": "release",
  "tradeoff:2": "familiarity",
} as const satisfies Record<string, "pace" | "release" | "familiarity">;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/** Converts the browser-local onboarding shape into the engine's canonical profile. */
export function mapQuestionnaireAnswers(
  answers: Readonly<Record<string, number>>,
  completedAt?: string,
): QuestionnaireProfile {
  const dimensionValues = new Map<QuestionnaireDimension, number[]>();
  const genreScores: Record<string, number> = {};
  const tradeoffScores: NonNullable<QuestionnaireProfile["tradeoffScores"]> = {};

  for (const [key, rawValue] of Object.entries(answers)) {
    if (!Number.isFinite(rawValue)) continue;

    if (key.startsWith("genre:")) {
      const genre = key.slice("genre:".length);
      if (genre) genreScores[genre] = 1 + clamp(rawValue, 0, 100) * 0.06;
      continue;
    }

    const tradeoff = TRADEOFF_ANSWER_MAP[key as keyof typeof TRADEOFF_ANSWER_MAP];
    if (tradeoff) {
      tradeoffScores[tradeoff] = rawValue < 50 ? -1 : 1;
      continue;
    }

    const dimension = QUESTIONNAIRE_DIMENSION_MAP[key as keyof typeof QUESTIONNAIRE_DIMENSION_MAP];
    if (!dimension) continue;
    dimensionValues.set(dimension, [...(dimensionValues.get(dimension) ?? []), clamp(rawValue, 0, 100)]);
  }

  const dimensionScores = Object.fromEntries(
    [...dimensionValues.entries()].map(([dimension, values]) => [
      dimension,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ]),
  ) as QuestionnaireProfile["dimensionScores"];

  return {
    completedAt,
    dimensionScores,
    genreScores,
    tradeoffScores,
  };
}
