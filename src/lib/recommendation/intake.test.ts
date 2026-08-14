import { describe, expect, it } from "vitest";

import { mapQuestionnaireAnswers, QUESTIONNAIRE_DIMENSION_MAP } from "./intake";

describe("intake mapping", () => {
  it("maps every questionnaire statement, every tradeoff, and genre ratings", () => {
    const genres = [
      "Drama", "Crime", "Thriller", "Mystery", "Action", "Adventure", "Science Fiction",
      "Fantasy", "Horror", "Romance", "Comedy", "Dark Comedy", "Satire", "Animation",
      "Documentary", "Historical", "War", "Western", "Musical", "Family", "Stand-up",
    ];
    const answers = Object.fromEntries(
      Object.keys(QUESTIONNAIRE_DIMENSION_MAP).map((key, index) => [key, index % 2 ? 75 : 100]),
    );
    const mapped = mapQuestionnaireAnswers({
      ...answers,
      ...Object.fromEntries(genres.map((genre) => [`genre:${genre}`, 100])),
      dryComedy: 25,
      darkComedy: 75,
      horror: 20,
      psychologicalHorror: 20,
      gore: 80,
      goreTolerance: 80,
      "genre:Horror": 0,
      "tradeoff:0": 25,
      "tradeoff:1": 75,
      "tradeoff:2": 75,
    });

    expect(Object.keys(QUESTIONNAIRE_DIMENSION_MAP)).toHaveLength(24);
    expect(Object.keys(mapped.dimensionScores)).toHaveLength(22);
    expect(mapped.dimensionScores.dryComedy).toBe(25);
    expect(mapped.dimensionScores.darkComedy).toBe(75);
    expect(mapped.dimensionScores.broadComedy).toBeDefined();
    expect(mapped.dimensionScores.psychologicalHorror).toBe(20);
    expect(mapped.dimensionScores.goreTolerance).toBe(80);
    expect(Object.keys(mapped.genreScores)).toHaveLength(21);
    expect(mapped.genreScores.Drama).toBe(7);
    expect(mapped.genreScores.Horror).toBe(1);
    expect(mapped.tradeoffScores).toEqual({ pace: -1, release: 1, familiarity: 1 });
  });
});
