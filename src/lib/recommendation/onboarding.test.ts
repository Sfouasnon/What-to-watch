import { describe, expect, it } from "vitest";

import {
  buildStartingTasteSummary,
  conditionalQuestions,
  selectCalibrationTitle,
  type CalibrationTitle,
} from "./onboarding";

const title = (id: string, genres: string[], tags: string[], popularity = 60): CalibrationTitle => ({
  id,
  name: id,
  genres,
  tags,
  popularity,
  baseline: 80,
});

describe("streamlined onboarding", () => {
  it("only asks comedy and horror follow-ups when the genre pass calls for them", () => {
    expect(conditionalQuestions(["Drama"], {})).toEqual([]);
    expect(conditionalQuestions(["Comedy"], {}).map((question) => question.id)).toEqual([
      "dryComedy", "darkComedy", "broadComedy",
    ]);
    expect(conditionalQuestions([], { Horror: 5 }).map((question) => question.id)).toEqual([
      "psychologicalHorror", "goreTolerance",
    ]);
  });

  it("chooses an informative title from a taste outlier instead of catalog order", () => {
    const first = title("generic", ["Drama"], [], 100);
    const psychological = title("psychological", ["Horror"], ["psychological-horror", "dread"], 75);
    const graphic = title("graphic", ["Horror"], ["body-horror", "visceral"], 70);
    const selected = selectCalibrationTitle([first, psychological, graphic], {
      targetGenres: ["Horror"],
      excludedIds: new Set(),
    });
    expect(selected?.id).toBe("psychological");
    const next = selectCalibrationTitle([first, psychological, graphic], {
      targetGenres: ["Horror"],
      excludedIds: new Set(["psychological"]),
      askedTitles: [psychological],
    });
    expect(next?.id).toBe("graphic");
  });

  it("uses only strong evidence in the starting taste display", () => {
    expect(buildStartingTasteSummary({ cerebral: 50, emotional: 75, goreTolerance: 20 }, { Drama: 6 })).toEqual({
      headline: "You want stories that make you feel.",
      description: "Your starting profile points toward stories with real emotional weight and horror that keeps the gore restrained. Your strongest genre pulls are Drama.",
      tags: ["Emotional stories", "Low-gore horror", "Drama"],
    });
    expect(buildStartingTasteSummary({ cerebral: 50 }, {} as Record<string, number>).headline)
      .toBe("Here’s where your taste starts.");
    expect(buildStartingTasteSummary({}, { "Stand-up": 7 }).headline)
      .toBe("Stand-up gets its own night.");
  });
});
