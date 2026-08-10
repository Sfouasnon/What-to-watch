import fs from "node:fs";
import { execSync } from "node:child_process";

const expectedBranch = "chatgpt/editorial-engine-a3";
const currentBranch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
if (currentBranch !== expectedBranch) {
  throw new Error("Run this only on " + expectedBranch + " (current: " + (currentBranch || "detached") + ")");
}

const text = (lines) => lines.join("\n");
const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, source) => fs.writeFileSync(path, source);

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(label + ": expected exactly one match, found " + count);
  return source.replace(before, after);
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = source.match(pattern);
  if (!matches) throw new Error(label + ": no match");
  const probe = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const first = source.search(probe);
  const tail = source.slice(first + matches[0].length);
  if (probe.test(tail)) throw new Error(label + ": more than one match");
  return source.replace(pattern, after);
}

// Core type: stable persistence lane plus optional evidence-backed display badge.
{
  const path = "src/lib/recommendation/types.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    "export interface Recommendation { rank: number; lane: RecommendationLane; title: Title;",
    "export interface Recommendation { rank: number; lane: RecommendationLane; badge?: RecommendationLane; title: Title;",
    "Recommendation badge type",
  );
  write(path, source);
}

// Engine A3: rank ten first, badge second, reward humor diversity, penalize metadata uncertainty.
{
  const path = "src/lib/recommendation/engine.ts";
  let source = read(path);
  source = replaceOnce(source, 'modelVersion: "1.1.0",', 'modelVersion: "1.2.0",', "model version");

  const rankingLoop = text([
    "  for (let index = 0; index < count; index += 1) {",
    "    // Persistence lanes stay unique for the existing database contract.",
    "    // They no longer decide whether a genuinely eligible title can be selected.",
    "    const persistenceLane = lane ?? RECOMMENDATION_LANES[index];",
    "    const scoringLane = persistenceLane;",
    "    const exploration = config.exploration[scoringLane];",
    "    const laneCandidates = lane",
    "      ? remaining.filter((candidate) => laneEligible(candidate, scoringLane, selected))",
    "      : remaining;",
    "    if (!laneCandidates.length) break;",
    "    const ranked = laneCandidates",
    "      .map((candidate) => ({",
    "        candidate,",
    "        score: laneScore(candidate, scoringLane, exploration, selected, config, moods),",
    "      }))",
    "      .sort(",
    "        (a, b) =>",
    "          b.score - a.score ||",
    "          b.candidate.intrinsicScore - a.candidate.intrinsicScore ||",
    "          a.candidate.title.id.localeCompare(b.candidate.title.id),",
    "      );",
    "    const winner = ranked[0];",
    "    if (!winner) break;",
    "    const candidate = winner.candidate;",
    "    const badge = lane ? scoringLane : selectSemanticBadge(persistenceLane, candidate, selected);",
    "    const requiresPayment =",
    "      candidate.primaryAvailability.kind === \"rental\" || candidate.primaryAvailability.kind === \"purchase\";",
    "    const evidence = buildEvidence(candidate, moods, vibes, badge, requiresPayment);",
    "    const normalizedScore = normalizeScore(winner.score, config);",
    "    const calibratedMatchScore =",
    "      config.normalization.minimumDisplayMatch +",
    "      normalizedScore *",
    "        (config.normalization.maximumDisplayMatch - config.normalization.minimumDisplayMatch);",
    "    const matchScore = Math.round(clamp(",
    "      calibratedMatchScore - moodEvidencePenalty(candidate, moods),",
    "      config.normalization.minimumDisplayMatch,",
    "      config.normalization.maximumDisplayMatch,",
    "    ));",
    "    selected.push({",
    "      rank: selected.length + 1,",
    "      lane: persistenceLane,",
    "      badge,",
    "      title: candidate.title,",
    "      rawScore: round(winner.score, 3),",
    "      normalizedScore: round(normalizedScore, 4),",
    "      matchScore,",
    "      explanation: evidence.slice(0, 2).join(\" \"),",
    "      evidence,",
    "      contributions: [...candidate.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),",
    "      availability: candidate.availability,",
    "      primaryAvailability: candidate.primaryAvailability,",
    "      requiresPayment,",
    "      modelVersion: config.modelVersion,",
    "      friendContext: candidate.friendContext,",
    "    });",
    "    remaining.splice(remaining.indexOf(candidate), 1);",
    "  }",
    "",
  ]);
  source = replaceRegexOnce(
    source,
    /  for \(let index = 0; index < count; index \+= 1\) \{[\s\S]*?\n  \}\n\n  \/\/ Displayed confidence/,
    rankingLoop + "  // Displayed confidence",
    "ranking loop",
  );

  source = replaceOnce(
    source,
    text([
      "  const maxWatchedSimilarity = rated.length",
      "    ? Math.max(...rated.map(({ title: ratedTitle }) => titleSimilarity(title, ratedTitle)))",
      "    : 0;",
      "  const novelty = clamp(1 - maxWatchedSimilarity, 0, 1);",
    ]),
    text([
      "  const maxWatchedSimilarity = rated.length",
      "    ? Math.max(...rated.map(({ title: ratedTitle }) => titleSimilarity(title, ratedTitle)))",
      "    : 0;",
      "  const metadataCoverage = average([",
      "    title.genres.length ? 1 : 0,",
      "    title.subgenres.length ? 1 : 0,",
      "    title.toneTags.length ? 1 : 0,",
      "    title.themes.length ? 1 : 0,",
      "    title.directors.length ? 1 : 0,",
      "    title.writers.length ? 1 : 0,",
      "    title.actors.length ? 1 : 0,",
      "  ]);",
      "  // Missing enrichment is uncertainty, not novelty.",
      "  const novelty = clamp((1 - maxWatchedSimilarity) * (0.45 + metadataCoverage * 0.55), 0, 1);",
    ]),
    "metadata-aware novelty",
  );

  const badgeSelector = text([
    "function selectSemanticBadge(",
    "  preferred: RecommendationLane,",
    "  candidate: ScoredCandidate,",
    "  selected: readonly Recommendation[],",
    "): RecommendationLane | undefined {",
    "  const used = new Set(selected.flatMap((recommendation) => recommendation.badge ? [recommendation.badge] : []));",
    "  if ((preferred === \"Best Bet\" || preferred === \"Close Second\") && !used.has(preferred)) return preferred;",
    "  const candidates: RecommendationLane[] = [",
    "    preferred, \"Right Mood\", \"Creator Match\", \"Something Different\", \"Go Deeper\",",
    "    \"Hidden Gem\", \"Film School Pick\", \"Left Field\", \"Wild Card\",",
    "  ];",
    "  return candidates.find((candidateLane) =>",
    "    candidateLane !== \"Best Bet\" &&",
    "    candidateLane !== \"Close Second\" &&",
    "    !used.has(candidateLane) &&",
    "    laneEligible(candidate, candidateLane, selected)",
    "  );",
    "}",
  ]);
  source = replaceRegexOnce(
    source,
    /function selectSemanticLane\([\s\S]*?\n\}\n\nfunction laneScore/,
    badgeSelector + "\n\nfunction laneScore",
    "semantic selector",
  );

  source = replaceOnce(
    source,
    text([
      "function laneScore(",
      "  candidate: ScoredCandidate,",
      "  lane: RecommendationLane,",
      "  exploration: number,",
      "  selected: readonly Recommendation[],",
      "  config: RecommendationConfig,",
      "): number {",
    ]),
    text([
      "function laneScore(",
      "  candidate: ScoredCandidate,",
      "  lane: RecommendationLane,",
      "  exploration: number,",
      "  selected: readonly Recommendation[],",
      "  config: RecommendationConfig,",
      "  moods: readonly Mood[],",
      "): number {",
    ]),
    "laneScore signature",
  );

  source = replaceOnce(
    source,
    text([
      "  if (selected.length) {",
      "    const diversity = average(selected.map(({ title }) => 1 - titleSimilarity(candidate.title, title)));",
      "    score += diversity * config.weights.explorationBonus * exploration * 0.7;",
      "  }",
      "  if (lane === \"Right Mood\") score += candidate.moodSignal * 4;",
      "  if (lane === \"Creator Match\") score += candidate.creatorSignal * 7;",
      "  if (lane === \"Hidden Gem\") score += candidate.hiddenGemSignal * 9;",
      "  if (lane === \"Go Deeper\") score += Math.max(candidate.creatorSignal, candidate.tasteAffinitySignal) * 8;",
      "  if (lane === \"Film School Pick\") score += candidate.canonicalSignal * 9;",
      "  if (lane === \"Left Field\") score += candidate.novelty * 8;",
      "  if (lane === \"Wild Card\") score += candidate.novelty * 11;",
    ]),
    text([
      "  if (selected.length) {",
      "    const diversity = average(selected.map(({ title }) => 1 - titleSimilarity(candidate.title, title)));",
      "    score += diversity * config.weights.explorationBonus * exploration * 0.7;",
      "    if (moods.includes(\"comedy\")) {",
      "      score += comedySelectionDiversity(candidate.title, selected.map(({ title }) => title)) *",
      "        config.weights.explorationBonus * 1.15;",
      "    }",
      "  }",
      "  const qualifiesForLane = laneEligible(candidate, lane, selected);",
      "  if (lane === \"Right Mood\" && qualifiesForLane) score += candidate.moodSignal * 4;",
      "  if (lane === \"Creator Match\" && qualifiesForLane) score += candidate.creatorSignal * 7;",
      "  if (lane === \"Hidden Gem\" && qualifiesForLane) score += candidate.hiddenGemSignal * 9;",
      "  if (lane === \"Go Deeper\" && qualifiesForLane) score += Math.max(candidate.creatorSignal, candidate.tasteAffinitySignal) * 8;",
      "  if (lane === \"Film School Pick\" && qualifiesForLane) score += candidate.canonicalSignal * 9;",
      "  if (lane === \"Left Field\" && qualifiesForLane) score += candidate.novelty * 8;",
      "  if (lane === \"Wild Card\" && qualifiesForLane) score += candidate.novelty * 11;",
    ]),
    "lane boosts and comedy diversity",
  );

  const diversityHelper = text([
    "function comedySelectionDiversity(title: Title, selectedTitles: readonly Title[]): number {",
    "  if (!selectedTitles.length) return 0;",
    "  const creators = [...title.directors, ...title.writers, ...title.actors.slice(0, 5)];",
    "  return average(selectedTitles.map((other) => {",
    "    const otherCreators = [...other.directors, ...other.writers, ...other.actors.slice(0, 5)];",
    "    const subgenreDifference = title.subgenres.length && other.subgenres.length",
    "      ? title.subgenres.some((value) => other.subgenres.includes(value)) ? 0 : 1",
    "      : 0.35;",
    "    const toneDifference = title.toneTags.length && other.toneTags.length",
    "      ? title.toneTags.some((value) => other.toneTags.includes(value)) ? 0 : 1",
    "      : 0.35;",
    "    const creatorDifference = creators.length && otherCreators.length",
    "      ? creators.some((value) => otherCreators.includes(value)) ? 0 : 1",
    "      : 0.35;",
    "    const formatDifference = title.contentType === other.contentType ? 0 : 1;",
    "    const decadeDifference = Math.floor(title.year / 10) === Math.floor(other.year / 10) ? 0 : 1;",
    "    return subgenreDifference * 0.38 + toneDifference * 0.22 + creatorDifference * 0.18 +",
    "      formatDifference * 0.12 + decadeDifference * 0.1;",
    "  }));",
    "}",
    "",
  ]);
  source = replaceOnce(source, "function moodFit(title: Title, moods: readonly Mood[]): number {", diversityHelper + "function moodFit(title: Title, moods: readonly Mood[]): number {", "comedy diversity helper");

  source = replaceOnce(
    source,
    text([
      "function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {",
      "  return moodFit(title, moods) > 0;",
      "}",
    ]),
    text([
      "function moodEvidencePenalty(candidate: ScoredCandidate, moods: readonly Mood[]): number {",
      "  if (!moods.length || candidate.title.contentType === \"stand-up\") return 0;",
      "  if (candidate.title.editorial) return candidate.moodSignal >= 0.99 ? 0 : candidate.moodSignal >= 0.62 ? 2 : 5;",
      "  return candidate.moodSignal >= 0.3 ? 6 : 9;",
      "}",
      "",
      "function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {",
      "  if (!moods.length) return true;",
      "  const fit = moodFit(title, moods);",
      "  if (moods.includes(\"comedy\") && !title.editorial && title.contentType !== \"stand-up\") return fit >= 0.3;",
      "  return fit > 0;",
      "}",
    ]),
    "comedy fallback eligibility",
  );

  source = replaceOnce(source, "  lane: RecommendationLane,\n  requiresPayment: boolean,\n): string[] {", "  lane: RecommendationLane | undefined,\n  requiresPayment: boolean,\n): string[] {", "optional evidence badge");
  write(path, source);
}

// Live candidate pool: two discovery pages and 80 detailed candidates, in safe batches.
{
  const path = "src/app/api/recommendations/route.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    text([
      "  const candidateRequests = [",
      "    ...seedRequests,",
      "    tmdb.discoverTitles(\"movie\", requestedMovieGenres),",
      "    tmdb.discoverTitles(\"tv\", requestedTvGenres),",
      "    tmdb.getTrending(\"movie\"),",
      "    tmdb.getTrending(\"tv\"),",
      "  ];",
      "  const candidateResponses = await Promise.allSettled(candidateRequests);",
      "  candidateResponses.forEach((result, index) => {",
      "    if (result.status === \"fulfilled\") addCandidates(candidatePool, result.value, index < seedRequests.length ? 4 : index < seedRequests.length + 2 ? 3 : 1);",
      "  });",
    ]),
    text([
      "  const discoveryRequests = [",
      "    tmdb.discoverTitles(\"movie\", requestedMovieGenres, 1),",
      "    tmdb.discoverTitles(\"tv\", requestedTvGenres, 1),",
      "    tmdb.discoverTitles(\"movie\", requestedMovieGenres, 2),",
      "    tmdb.discoverTitles(\"tv\", requestedTvGenres, 2),",
      "  ];",
      "  const candidateRequests = [",
      "    ...seedRequests,",
      "    ...discoveryRequests,",
      "    tmdb.getTrending(\"movie\"),",
      "    tmdb.getTrending(\"tv\"),",
      "  ];",
      "  const candidateResponses = await Promise.allSettled(candidateRequests);",
      "  candidateResponses.forEach((result, index) => {",
      "    if (result.status === \"fulfilled\") {",
      "      const sourceWeight = index < seedRequests.length ? 4 : index < seedRequests.length + discoveryRequests.length ? 3 : 1;",
      "      addCandidates(candidatePool, result.value, sourceWeight);",
      "    }",
      "  });",
    ]),
    "expanded discovery requests",
  );
  source = replaceOnce(source, ".slice(0, 36)", ".slice(0, 80)", "candidate detail pool");
  source = replaceOnce(
    source,
    text([
      "  const candidateDetails = await Promise.all(candidateStubs.map(async (candidate) => {",
      "    const identity = tmdbIdentity(candidate.externalId);",
      "    return identity ? titleDetails(identity.mediaType, identity.id, parsed.data.region) : null;",
      "  }));",
    ]),
    text([
      "  const candidateDetails: Array<TmdbTitleDetails | null> = [];",
      "  for (let offset = 0; offset < candidateStubs.length; offset += 20) {",
      "    const batch = candidateStubs.slice(offset, offset + 20);",
      "    const details = await Promise.all(batch.map(async (candidate) => {",
      "      const identity = tmdbIdentity(candidate.externalId);",
      "      return identity ? titleDetails(identity.mediaType, identity.id, parsed.data.region) : null;",
      "    }));",
      "    candidateDetails.push(...details);",
      "  }",
    ]),
    "batched detail enrichment",
  );
  write(path, source);
}

// Client: display true badge; otherwise show a neutral Personal Pick label.
{
  const path = "src/components/what-to-watch-app.tsx";
  let source = read(path);
  source = replaceOnce(source, "  lane: string;\n  title: LiveApiTitle;", "  lane: string;\n  badge?: string;\n  title: LiveApiTitle;", "live badge type");
  source = replaceOnce(source, "    lane: value.lane,", '    lane: value.badge ?? (value.rank === 1 ? "Best Bet" : value.rank === 2 ? "Close Second" : "Personal Pick"),', "display badge mapping");
  write(path, source);
}

// Tests: top ten is independent of special badges; Comedy has a strict fallback test.
{
  const path = "src/lib/recommendation/engine.test.ts";
  let source = read(path);
  source = replaceOnce(source, 'it("returns unique ranked picks without assigning unsupported semantic lanes", () => {', 'it("returns ten eligible ranked picks while keeping semantic badges evidence-backed", () => {', "test name");
  source = replaceOnce(source, "    expect(picks.length).toBeGreaterThan(0);\n    expect(picks.length).toBeLessThanOrEqual(10);", "    expect(picks).toHaveLength(10);", "top ten assertion");
  source = replaceOnce(source, "    expect(new Set(picks.map((pick) => pick.lane)).size).toBe(picks.length);\n    expect(picks.map((pick) => pick.rank)).toEqual(Array.from({ length: picks.length }, (_, index) => index + 1));", "    expect(new Set(picks.map((pick) => pick.lane)).size).toBe(picks.length);\n    expect(picks.map((pick) => pick.lane)).toEqual(RECOMMENDATION_LANES);\n    const badges = picks.flatMap((pick) => pick.badge ? [pick.badge] : []);\n    expect(new Set(badges).size).toBe(badges.length);\n    expect(picks.map((pick) => pick.rank)).toEqual(Array.from({ length: picks.length }, (_, index) => index + 1));", "lane and badge assertions");
  source = source.replaceAll('if (pick.lane === "Creator Match")', 'if (pick.badge === "Creator Match")');
  source = source.replaceAll('if (pick.lane === "Hidden Gem")', 'if (pick.badge === "Hidden Gem")');
  source = source.replaceAll('if (pick.lane === "Go Deeper")', 'if (pick.badge === "Go Deeper")');
  source = source.replaceAll('if (pick.lane === "Film School Pick")', 'if (pick.badge === "Film School Pick")');

  const marker = '  it("provides evidence-based explanations plus separate raw and normalized scores", () => {';
  const additions = text([
    '  it("fills a comedy top ten from supported fallback metadata without admitting broad-only Comedy", () => {',
    '    const supported = Array.from({ length: 10 }, (_, index) => title("supported-" + index, {',
    '      genres: ["comedy"],',
    '      themes: [index % 2 ? "satire" : "comedic"],',
    '      popularity: 35 + index,',
    '    }));',
    '    const broadOnly = title("broad-only", { genres: ["comedy"], canonicalScore: 100, popularity: 100 });',
    '    const picks = recommendForProfile({ profile: profile(), catalog: [broadOnly, ...supported], moods: ["comedy"], limit: 10 });',
    '    expect(picks).toHaveLength(10);',
    '    expect(picks.map((pick) => pick.title.id)).not.toContain("broad-only");',
    '  });',
    '',
    '  it("uses humor-style diversity to avoid a near-duplicate second comedy pick", () => {',
    '    const workplaceEditorial = { primarySubgenre: "workplace-comedy", primaryFamily: "comedy", ontologyVersion: "0.1.1", source: "gold-set" as const };',
    '    const absurdistEditorial = { primarySubgenre: "absurdist-comedy", primaryFamily: "comedy", ontologyVersion: "0.1.1", source: "gold-set" as const };',
    '    const workplaceOne = title("a-workplace-one", { genres: ["comedy"], subgenres: ["workplace-comedy"], toneTags: ["wry"], editorial: workplaceEditorial });',
    '    const workplaceTwo = title("b-workplace-two", { genres: ["comedy"], subgenres: ["workplace-comedy"], toneTags: ["wry"], editorial: workplaceEditorial });',
    '    const absurdist = title("c-absurdist", { genres: ["comedy"], subgenres: ["absurdist-comedy"], toneTags: ["playful"], editorial: absurdistEditorial });',
    '    const picks = recommendForProfile({ profile: profile(), catalog: [workplaceOne, workplaceTwo, absurdist], moods: ["comedy"], limit: 3 });',
    '    expect(picks[0].title.id).toBe("a-workplace-one");',
    '    expect(picks[1].title.id).toBe("c-absurdist");',
    '  });',
    '',
  ]);
  source = replaceOnce(source, marker, additions + marker, "A3 tests");
  write(path, source);
}

console.log("Applied Editorial Engine A3: ten-pick ranking, evidence-backed badges, broader live pool, comedy diversity, and confidence calibration.");
