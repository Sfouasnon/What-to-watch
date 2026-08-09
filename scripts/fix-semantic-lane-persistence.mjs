import fs from "node:fs";

const path = "src/lib/recommendation/engine.ts";
let source = fs.readFileSync(path, "utf8");

const before = `    const requestedLane = RECOMMENDATION_LANES[index];
    const recommendationLane = lane ?? selectSemanticLane(requestedLane, remaining, selected);
    const scoringLane = lane ?? recommendationLane;
    const exploration = config.exploration[scoringLane];
    const laneCandidates = remaining.filter((candidate) => laneEligible(candidate, scoringLane, selected));
    const ranked = (laneCandidates.length ? laneCandidates : remaining)
      .map((candidate) => ({`;

const after = `    const requestedLane = RECOMMENDATION_LANES[index];
    const recommendationLane = lane ?? selectSemanticLane(requestedLane, remaining, selected);
    if (!recommendationLane) continue;
    const scoringLane = lane ?? recommendationLane;
    const exploration = config.exploration[scoringLane];
    const laneCandidates = remaining.filter((candidate) => laneEligible(candidate, scoringLane, selected));
    if (!laneCandidates.length) continue;
    const ranked = laneCandidates
      .map((candidate) => ({`;

if (!source.includes(before)) {
  throw new Error("Expected semantic lane selection block was not found. Apply the earlier editorial engine patch first.");
}
source = source.replace(before, after);

const beforeHelper = `function selectSemanticLane(
  preferred: RecommendationLane,
  remaining: readonly ScoredCandidate[],
  selected: readonly Recommendation[],
): RecommendationLane {
  if (remaining.some((candidate) => laneEligible(candidate, preferred, selected))) return preferred;
  const substitutes: RecommendationLane[] = [
    "Best Bet", "Close Second", "Right Mood", "Something Different", "Go Deeper",
    "Creator Match", "Hidden Gem", "Film School Pick", "Left Field", "Wild Card",
  ];
  return substitutes.find((candidateLane) =>
    !selected.some(({ lane }) => lane === candidateLane) &&
    remaining.some((candidate) => laneEligible(candidate, candidateLane, selected))
  ) ?? "Best Bet";
}`;

const afterHelper = `function selectSemanticLane(
  preferred: RecommendationLane,
  remaining: readonly ScoredCandidate[],
  selected: readonly Recommendation[],
): RecommendationLane | undefined {
  const used = new Set(selected.map(({ lane }) => lane));
  if (!used.has(preferred) && remaining.some((candidate) => laneEligible(candidate, preferred, selected))) {
    return preferred;
  }
  const substitutes: RecommendationLane[] = [
    "Best Bet", "Close Second", "Right Mood", "Something Different", "Go Deeper",
    "Creator Match", "Hidden Gem", "Film School Pick", "Left Field", "Wild Card",
  ];
  return substitutes.find((candidateLane) =>
    !used.has(candidateLane) &&
    remaining.some((candidate) => laneEligible(candidate, candidateLane, selected))
  );
}`;

if (!source.includes(beforeHelper)) {
  throw new Error("Expected selectSemanticLane helper was not found.");
}
source = source.replace(beforeHelper, afterHelper);

fs.writeFileSync(path, source);
console.log("Fixed semantic lane persistence: recommendation types are now unique and unsupported lanes are skipped.");
