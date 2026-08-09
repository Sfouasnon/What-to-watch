import fs from "node:fs";

const path = "src/lib/recommendation/engine.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
`    const recommendationLane = RECOMMENDATION_LANES[index];
    const scoringLane = lane ?? recommendationLane;
    const exploration = config.exploration[scoringLane];
    const ranked = remaining
      .map((candidate) => ({`,
`    const requestedLane = RECOMMENDATION_LANES[index];
    const recommendationLane = lane ?? selectSemanticLane(requestedLane, remaining, selected);
    const scoringLane = lane ?? recommendationLane;
    const exploration = config.exploration[scoringLane];
    const laneCandidates = remaining.filter((candidate) => laneEligible(candidate, scoringLane, selected));
    const ranked = (laneCandidates.length ? laneCandidates : remaining)
      .map((candidate) => ({`,
"semantic lane selection",
);

replaceOnce(
`  const moodSignal = moods.length ? 1 : 0;
  if (moodSignal) add("moodMatch", config.weights.moodMatch, moodEvidence(title, moods));`,
`  const moodSignal = moodFit(title, moods);
  if (moodSignal) add("moodMatch", config.weights.moodMatch * moodSignal, moodEvidence(title, moods));`,
"graded mood signal",
);

replaceOnce(
`function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {
  if (!moods.length) return true;
  if (title.contentType === "stand-up") return moods.includes("stand-up");
  const normalizedGenres = title.genres.map((genre) => genre.toLowerCase());
  return moods.some((mood) => mood !== "stand-up" && normalizedGenres.includes(mood));
}`,
`function moodFit(title: Title, moods: readonly Mood[]): number {
  if (!moods.length) return 1;
  if (title.contentType === "stand-up") return moods.includes("stand-up") ? 1 : 0;
  if (moods.includes("stand-up")) return 0;

  const requested = new Set(moods);
  if (title.editorial) {
    if (requested.has(title.editorial.primaryFamily as Mood)) return 1;
    if (title.editorial.secondaryFamily && requested.has(title.editorial.secondaryFamily as Mood)) return 0.62;
    return 0;
  }

  const normalizedGenres = title.genres.map((genre) => genre.toLowerCase());
  return moods.some((mood) => normalizedGenres.includes(mood)) ? 0.42 : 0;
}

function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {
  return moodFit(title, moods) > 0;
}`,
"editorial mood hierarchy",
);

replaceOnce(
`function moodEvidence(title: Title, moods: readonly Mood[]): string {
  const matched = moods.find((mood) =>
    title.contentType === "stand-up"
      ? mood === "stand-up"
      : title.genres.some((genre) => genre.toLowerCase() === mood),
  );
  return \`You asked for \${matched ?? moods[0]}; \${title.name} is classified as \${title.contentType === "stand-up" ? "stand-up" : matched ?? title.genres[0]}.\`;
}`,
`function moodEvidence(title: Title, moods: readonly Mood[]): string {
  if (title.contentType === "stand-up") return \`You asked for stand-up; \${title.name} is stand-up.\`;
  if (title.editorial) {
    const matchedPrimary = moods.find((mood) => mood === title.editorial?.primaryFamily);
    if (matchedPrimary) return \`You asked for \${matchedPrimary}; editorial classification identifies \${title.name} as \${title.editorial.primarySubgenre}.\`;
    const matchedSecondary = moods.find((mood) => mood === title.editorial?.secondaryFamily);
    if (matchedSecondary) return \`You asked for \${matchedSecondary}; \${title.name} has \${title.editorial.secondarySubgenre} as a secondary editorial classification.\`;
  }
  const matched = moods.find((mood) => title.genres.some((genre) => genre.toLowerCase() === mood));
  return \`You asked for \${matched ?? moods[0]}; \${title.name} currently relies on broad TMDB genre metadata because editorial enrichment is not available yet.\`;
}`,
"editorial mood evidence",
);

const insertionPoint = `function laneScore(\n`;
const helper = `function laneEligible(\n  candidate: ScoredCandidate,\n  lane: RecommendationLane,\n  selected: readonly Recommendation[],\n): boolean {\n  if (lane === "Creator Match") return candidate.creatorSignal >= 0.2;\n  if (lane === "Hidden Gem") return candidate.hiddenGemSignal >= 0.5 && candidate.title.popularity <= 55;\n  if (lane === "Film School Pick") return candidate.canonicalSignal >= 0.65;\n  if (lane === "Go Deeper") return candidate.creatorSignal >= 0.15 || candidate.hiddenGemSignal >= 0.45;\n  if (lane === "Something Different") return candidate.novelty >= 0.45;\n  if (lane === "Left Field") return candidate.novelty >= 0.6;\n  if (lane === "Wild Card") return candidate.novelty >= 0.7;\n  if (lane === "Right Mood") return candidate.moodSignal >= 0.62;\n  void selected;\n  return true;\n}\n\nfunction selectSemanticLane(\n  preferred: RecommendationLane,\n  remaining: readonly ScoredCandidate[],\n  selected: readonly Recommendation[],\n): RecommendationLane {\n  if (remaining.some((candidate) => laneEligible(candidate, preferred, selected))) return preferred;\n  const substitutes: RecommendationLane[] = [\n    "Best Bet", "Close Second", "Right Mood", "Something Different", "Go Deeper",\n    "Creator Match", "Hidden Gem", "Film School Pick", "Left Field", "Wild Card",\n  ];\n  return substitutes.find((candidateLane) =>\n    !selected.some(({ lane }) => lane === candidateLane) &&\n    remaining.some((candidate) => laneEligible(candidate, candidateLane, selected))\n  ) ?? "Best Bet";\n}\n\n`;
if (!source.includes(insertionPoint)) throw new Error("lane helper insertion point missing");
source = source.replace(insertionPoint, helper + insertionPoint);

fs.writeFileSync(path, source);
console.log("Applied editorial engine patch to", path);
