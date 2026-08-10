import fs from "node:fs";
import { execSync } from "node:child_process";

const branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
if (branch !== "chatgpt/editorial-engine-a3") {
  throw new Error(`Run this only on chatgpt/editorial-engine-a3 (current: ${branch || "detached"})`);
}

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(before, after);
}

// 1) Recommendation lanes remain unique persistence slots; badges become optional semantics.
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

// 2) Rank up to ten eligible titles first; assign evidence-backed semantic badges second.
{
  const path = "src/lib/recommendation/engine.ts";
  let source = read(path);
  source = replaceOnce(source, 'modelVersion: "1.1.0",', 'modelVersion: "1.2.0",', "A3 model version");

  const oldLoop = String.raw`  for (let index = 0; index < count; index += 1) {
    const requestedLane = RECOMMENDATION_LANES[index];
    const recommendationLane = lane ?? selectSemanticLane(requestedLane, remaining, selected);
    if (!recommendationLane) continue;
    const scoringLane = lane ?? recommendationLane;
    const exploration = config.exploration[scoringLane];
    const laneCandidates = remaining.filter((candidate) => laneEligible(candidate, scoringLane, selected));
    if (!laneCandidates.length) continue;
    const ranked = laneCandidates
      .map((candidate) => ({
        candidate,
        score: laneScore(candidate, scoringLane, exploration, selected, config),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.candidate.intrinsicScore - a.candidate.intrinsicScore ||
          a.candidate.title.id.localeCompare(b.candidate.title.id),
      );
    const winner = ranked[0];
    if (!winner) break;
    const candidate = winner.candidate;
    const requiresPayment =
      candidate.primaryAvailability.kind === "rental" || candidate.primaryAvailability.kind === "purchase";
    const evidence = buildEvidence(candidate, moods, vibes, recommendationLane, requiresPayment);
    const normalizedScore = normalizeScore(winner.score, config);
    const matchScore = Math.round(
      config.normalization.minimumDisplayMatch +
        normalizedScore *
          (config.normalization.maximumDisplayMatch - config.normalization.minimumDisplayMatch),
    );
    selected.push({
      rank: selected.length + 1,
      lane: recommendationLane,
      title: candidate.title,
      rawScore: round(winner.score, 3),
      normalizedScore: round(normalizedScore, 4),
      matchScore,
      explanation: evidence.slice(0, 2).join(" "),
      evidence,
      contributions: [...candidate.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      availability: candidate.availability,
      primaryAvailability: candidate.primaryAvailability,
      requiresPayment,
      modelVersion: config.modelVersion,
      friendContext: candidate.friendContext,
    });
    remaining.splice(remaining.indexOf(candidate), 1);
  }`;

  const newLoop = String.raw`  for (let index = 0; index < count; index += 1) {
    // The lane is a stable, unique persistence slot. It must never decide
    // whether a genuinely eligible title is allowed into the top ten.
    const persistenceLane = lane ?? RECOMMENDATION_LANES[index];
    const scoringLane = persistenceLane;
    const exploration = config.exploration[scoringLane];
    const laneCandidates = lane
      ? remaining.filter((candidate) => laneEligible(candidate, scoringLane, selected))
      : remaining;
    if (!laneCandidates.length) break;
    const ranked = laneCandidates
      .map((candidate) => ({
        candidate,
        score: laneScore(candidate, scoringLane, exploration, selected, config, moods),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.candidate.intrinsicScore - a.candidate.intrinsicScore ||
          a.candidate.title.id.localeCompare(b.candidate.title.id),
      );
    const winner = ranked[0];
    if (!winner) break;
    const candidate = winner.candidate;
    const badge = lane
      ? scoringLane
      : selectSemanticBadge(persistenceLane, candidate, selected);
    const requiresPayment =
      candidate.primaryAvailability.kind === "rental" || candidate.primaryAvailability.kind === "purchase";
    const evidence = buildEvidence(candidate, moods, vibes, badge, requiresPayment);
    const normalizedScore = normalizeScore(winner.score, config);
    const calibratedMatchScore =
      config.normalization.minimumDisplayMatch +
      normalizedScore *
        (config.normalization.maximumDisplayMatch - config.normalization.minimumDisplayMatch);
    const matchScore = Math.round(clamp(
      calibratedMatchScore - moodEvidencePenalty(candidate, moods),
      config.normalization.minimumDisplayMatch,
      config.normalization.maximumDisplayMatch,
    ));
    selected.push({
      rank: selected.length + 1,
      lane: persistenceLane,
      badge,
      title: candidate.title,
      rawScore: round(winner.score, 3),
      normalizedScore: round(normalizedScore, 4),
      matchScore,
      explanation: evidence.slice(0, 2).join(" "),
      evidence,
      contributions: [...candidate.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      availability: candidate.availability,
      primaryAvailability: candidate.primaryAvailability,
      requiresPayment,
      modelVersion: config.modelVersion,
      friendContext: candidate.friendContext,
    });
    remaining.splice(remaining.indexOf(candidate), 1);
  }`;
  source = replaceOnce(source, oldLoop, newLoop, "top-ten ranking loop");

  const oldNovelty = String.raw`  const maxWatchedSimilarity = rated.length
    ? Math.max(...rated.map(({ title: ratedTitle }) => titleSimilarity(title, ratedTitle)))
    : 0;
  const novelty = clamp(1 - maxWatchedSimilarity, 0, 1);`;
  const newNovelty = String.raw`  const maxWatchedSimilarity = rated.length
    ? Math.max(...rated.map(({ title: ratedTitle }) => titleSimilarity(title, ratedTitle)))
    : 0;
  const metadataCoverage = average([
    title.genres.length ? 1 : 0,
    title.subgenres.length ? 1 : 0,
    title.toneTags.length ? 1 : 0,
    title.themes.length ? 1 : 0,
    title.directors.length ? 1 : 0,
    title.writers.length ? 1 : 0,
    title.actors.length ? 1 : 0,
  ]);
  // Missing enrichment is uncertainty, not novelty. Sparse titles therefore
  // cannot become Left Field or Wild Card merely because similarity is unknown.
  const novelty = clamp((1 - maxWatchedSimilarity) * (0.45 + metadataCoverage * 0.55), 0, 1);`;
  source = replaceOnce(source, oldNovelty, newNovelty, "metadata-aware novelty");

  const oldSelector = String.raw`function selectSemanticLane(
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
  const newSelector = String.raw`function selectSemanticBadge(
  preferred: RecommendationLane,
  candidate: ScoredCandidate,
  selected: readonly Recommendation[],
): RecommendationLane | undefined {
  const used = new Set(selected.flatMap((recommendation) => recommendation.badge ? [recommendation.badge] : []));
  if ((preferred === "Best Bet" || preferred === "Close Second") && !used.has(preferred)) {
    return preferred;
  }
  const candidates: RecommendationLane[] = [
    preferred,
    "Right Mood",
    "Creator Match",
    "Something Different",
    "Go Deeper",
    "Hidden Gem",
    "Film School Pick",
    "Left Field",
    "Wild Card",
  ];
  return candidates.find((candidateLane) =>
    candidateLane !== "Best Bet" &&
    candidateLane !== "Close Second" &&
    !used.has(candidateLane) &&
    laneEligible(candidate, candidateLane, selected)
  );
}`;
  source = replaceOnce(source, oldSelector, newSelector, "semantic badge selector");

  source = replaceOnce(
    source,
    String.raw`function laneScore(
  candidate: ScoredCandidate,
  lane: RecommendationLane,
  exploration: number,
  selected: readonly Recommendation[],
  config: RecommendationConfig,
): number {`,
    String.raw`function laneScore(
  candidate: ScoredCandidate,
  lane: RecommendationLane,
  exploration: number,
  selected: readonly Recommendation[],
  config: RecommendationConfig,
  moods: readonly Mood[],
): number {`,
    "laneScore mood input",
  );

  source = replaceOnce(
    source,
    String.raw`  if (selected.length) {
    const diversity = average(selected.map(({ title }) => 1 - titleSimilarity(candidate.title, title)));
    score += diversity * config.weights.explorationBonus * exploration * 0.7;
  }
  if (lane === "Right Mood") score += candidate.moodSignal * 4;
  if (lane === "Creator Match") score += candidate.creatorSignal * 7;
  if (lane === "Hidden Gem") score += candidate.hiddenGemSignal * 9;
  if (lane === "Go Deeper") score += Math.max(candidate.creatorSignal, candidate.tasteAffinitySignal) * 8;
  if (lane === "Film School Pick") score += candidate.canonicalSignal * 9;
  if (lane === "Left Field") score += candidate.novelty * 8;
  if (lane === "Wild Card") score += candidate.novelty * 11;`,
    String.raw`  if (selected.length) {
    const diversity = average(selected.map(({ title }) => 1 - titleSimilarity(candidate.title, title)));
    score += diversity * config.weights.explorationBonus * exploration * 0.7;
    if (moods.includes("comedy")) {
      score += comedySelectionDiversity(candidate.title, selected.map(({ title }) => title)) *
        config.weights.explorationBonus * 1.15;
    }
  }
  const qualifiesForLane = laneEligible(candidate, lane, selected);
  if (lane === "Right Mood" && qualifiesForLane) score += candidate.moodSignal * 4;
  if (lane === "Creator Match" && qualifiesForLane) score += candidate.creatorSignal * 7;
  if (lane === "Hidden Gem" && qualifiesForLane) score += candidate.hiddenGemSignal * 9;
  if (lane === "Go Deeper" && qualifiesForLane) score += Math.max(candidate.creatorSignal, candidate.tasteAffinitySignal) * 8;
  if (lane === "Film School Pick" && qualifiesForLane) score += candidate.canonicalSignal * 9;
  if (lane === "Left Field" && qualifiesForLane) score += candidate.novelty * 8;
  if (lane === "Wild Card" && qualifiesForLane) score += candidate.novelty * 11;`,
    "evidence-gated lane boosts and comedy diversity",
  );

  source = replaceOnce(
    source,
    "function moodFit(title: Title, moods: readonly Mood[]): number {",
    String.raw`function comedySelectionDiversity(title: Title, selectedTitles: readonly Title[]): number {
  if (!selectedTitles.length) return 0;
  const creators = [...title.directors, ...title.writers, ...title.actors.slice(0, 5)];
  return average(selectedTitles.map((other) => {
    const otherCreators = [...other.directors, ...other.writers, ...other.actors.slice(0, 5)];
    const subgenreDifference = title.subgenres.length && other.subgenres.length
      ? title.subgenres.some((value) => other.subgenres.includes(value)) ? 0 : 1
      : 0.35;
    const toneDifference = title.toneTags.length && other.toneTags.length
      ? title.toneTags.some((value) => other.toneTags.includes(value)) ? 0 : 1
      : 0.35;
    const creatorDifference = creators.length && otherCreators.length
      ? creators.some((value) => otherCreators.includes(value)) ? 0 : 1
      : 0.35;
    const formatDifference = title.contentType === other.contentType ? 0 : 1;
    const decadeDifference = Math.floor(title.year / 10) === Math.floor(other.year / 10) ? 0 : 1;
    return subgenreDifference * 0.38 + toneDifference * 0.22 + creatorDifference * 0.18 +
      formatDifference * 0.12 + decadeDifference * 0.1;
  }));
}

function moodFit(title: Title, moods: readonly Mood[]): number {`,
    "comedy diversity helper",
  );

  source = replaceOnce(
    source,
    String.raw`function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {
  return moodFit(title, moods) > 0;
}`,
    String.raw`function moodEvidencePenalty(candidate: ScoredCandidate, moods: readonly Mood[]): number {
  if (!moods.length || candidate.title.contentType === "stand-up") return 0;
  if (candidate.title.editorial) {
    return candidate.moodSignal >= 0.99 ? 0 : candidate.moodSignal >= 0.62 ? 2 : 5;
  }
  return candidate.moodSignal >= 0.3 ? 6 : 9;
}

function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {
  if (!moods.length) return true;
  const fit = moodFit(title, moods);
  // Broad TMDB Comedy by itself is too noisy. Uncurated comedy candidates need
  // supporting comedy-specific metadata, while editorial classifications remain authoritative.
  if (moods.includes("comedy") && !title.editorial && title.contentType !== "stand-up") {
    return fit >= 0.3;
  }
  return fit > 0;
}`,
    "stronger comedy eligibility and confidence penalty",
  );

  source = replaceOnce(
    source,
    String.raw`function buildEvidence(
  candidate: ScoredCandidate,
  moods: readonly Mood[],
  vibes: readonly Vibe[],
  lane: RecommendationLane,
  requiresPayment: boolean,
): string[] {`,
    String.raw`function buildEvidence(
  candidate: ScoredCandidate,
  moods: readonly Mood[],
  vibes: readonly Vibe[],
  lane: RecommendationLane | undefined,
  requiresPayment: boolean,
): string[] {`,
    "optional semantic badge evidence",
  );

  write(path, source);
}

// 3) Expand the live candidate pool and fetch enough detail safely to fill ten.
{
  const path = "src/app/api/recommendations/route.ts";
  let source = read(path);
  const oldRequests = String.raw`  const candidateRequests = [
    ...seedRequests,
    tmdb.discoverTitles("movie", requestedMovieGenres),
    tmdb.discoverTitles("tv", requestedTvGenres),
    tmdb.getTrending("movie"),
    tmdb.getTrending("tv"),
  ];
  const candidateResponses = await Promise.allSettled(candidateRequests);
  candidateResponses.forEach((result, index) => {
    if (result.status === "fulfilled") addCandidates(candidatePool, result.value, index < seedRequests.length ? 4 : index < seedRequests.length + 2 ? 3 : 1);
  });`;
  const newRequests = String.raw`  const discoveryRequests = [
    tmdb.discoverTitles("movie", requestedMovieGenres, 1),
    tmdb.discoverTitles("tv", requestedTvGenres, 1),
    tmdb.discoverTitles("movie", requestedMovieGenres, 2),
    tmdb.discoverTitles("tv", requestedTvGenres, 2),
  ];
  const candidateRequests = [
    ...seedRequests,
    ...discoveryRequests,
    tmdb.getTrending("movie"),
    tmdb.getTrending("tv"),
  ];
  const candidateResponses = await Promise.allSettled(candidateRequests);
  candidateResponses.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const sourceWeight = index < seedRequests.length
        ? 4
        : index < seedRequests.length + discoveryRequests.length
          ? 3
          : 1;
      addCandidates(candidatePool, result.value, sourceWeight);
    }
  });`;
  source = replaceOnce(source, oldRequests, newRequests, "two-page discovery pool");

  source = replaceOnce(source, ".slice(0, 36)", ".slice(0, 80)", "candidate pool size");

  const oldDetails = String.raw`  const candidateDetails = await Promise.all(candidateStubs.map(async (candidate) => {
    const identity = tmdbIdentity(candidate.externalId);
    return identity ? titleDetails(identity.mediaType, identity.id, parsed.data.region) : null;
  }));`;
  const newDetails = String.raw`  const candidateDetails: Array<TmdbTitleDetails | null> = [];
  // Avoid an 80-request burst while still considering a much broader pool.
  for (let offset = 0; offset < candidateStubs.length; offset += 20) {
    const batch = candidateStubs.slice(offset, offset + 20);
    const details = await Promise.all(batch.map(async (candidate) => {
      const identity = tmdbIdentity(candidate.externalId);
      return identity ? titleDetails(identity.mediaType, identity.id, parsed.data.region) : null;
    }));
    candidateDetails.push(...details);
  }`;
  source = replaceOnce(source, oldDetails, newDetails, "batched candidate enrichment");
  write(path, source);
}

// 4) The client displays only true semantic badges; otherwise it uses a neutral label.
{
  const path = "src/components/what-to-watch-app.tsx";
  let source = read(path);
  source = replaceOnce(
    source,
    String.raw`type LiveApiRecommendation = {
  rank: number;
  lane: string;
  title: LiveApiTitle;`,
    String.raw`type LiveApiRecommendation = {
  rank: number;
  lane: string;
  badge?: string;
  title: LiveApiTitle;`,
    "live badge response type",
  );
  source = replaceOnce(
    source,
    "    lane: value.lane,",
    '    lane: value.badge ?? (value.rank === 1 ? "Best Bet" : value.rank === 2 ? "Close Second" : "Personal Pick"),',
    "neutral client lane label",
  );
  write(path, source);
}

// 5) Regression tests: ten eligible titles stay ten, while badges remain evidence-backed.
{
  const path = "src/lib/recommendation/engine.test.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    'it("returns unique ranked picks without assigning unsupported semantic lanes", () => {',
    'it("returns ten eligible ranked picks while keeping semantic badges evidence-backed", () => {',
    "top-ten test name",
  );
  source = replaceOnce(
    source,
    String.raw`    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(10);`,
    "    expect(picks).toHaveLength(10);",
    "top-ten count assertion",
  );
  source = replaceOnce(
    source,
    String.raw`    expect(new Set(picks.map((pick) => pick.lane)).size).toBe(picks.length);
    expect(picks.map((pick) => pick.rank)).toEqual(Array.from({ length: picks.length }, (_, index) => index + 1));
    expect(picks.every((pick) => RECOMMENDATION_LANES.includes(pick.lane))).toBe(true);`,
    String.raw`    expect(new Set(picks.map((pick) => pick.lane)).size).toBe(picks.length);
    expect(picks.map((pick) => pick.lane)).toEqual(RECOMMENDATION_LANES);
    expect(picks.map((pick) => pick.rank)).toEqual(Array.from({ length: picks.length }, (_, index) => index + 1));
    expect(picks.every((pick) => RECOMMENDATION_LANES.includes(pick.lane))).toBe(true);
    const badges = picks.flatMap((pick) => pick.badge ? [pick.badge] : []);
    expect(new Set(badges).size).toBe(badges.length);`,
    "persistence lane and badge assertions",
  );
  source = source.replaceAll('if (pick.lane === "Creator Match")', 'if (pick.badge === "Creator Match")');
  source = source.replaceAll('if (pick.lane === "Hidden Gem")', 'if (pick.badge === "Hidden Gem")');
  source = source.replaceAll('if (pick.lane === "Go Deeper")', 'if (pick.badge === "Go Deeper")');
  source = source.replaceAll('if (pick.lane === "Film School Pick")', 'if (pick.badge === "Film School Pick")');

  const marker = '  it("provides evidence-based explanations plus separate raw and normalized scores", () => {';
  const additions = String.raw`  it("fills a comedy top ten from supported fallback metadata without admitting broad-only Comedy", () => {
    const supported = Array.from({ length: 10 }, (_, index) => title(` + "`" + `supported-${index}` + "`" + `, {
      genres: ["comedy"],
      themes: [index % 2 ? "satire" : "comedic"],
      popularity: 35 + index,
    }));
    const broadOnly = title("broad-only", {
      genres: ["comedy"],
      canonicalScore: 100,
      popularity: 100,
    });
    const picks = recommendForProfile({
      profile: profile(),
      catalog: [broadOnly, ...supported],
      moods: ["comedy"],
      limit: 10,
    });
    expect(picks).toHaveLength(10);
    expect(picks.map((pick) => pick.title.id)).not.toContain("broad-only");
  });

  it("uses humor-style diversity to avoid near-duplicate early comedy picks", () => {
    const workplaceEditorial = {
      primarySubgenre: "workplace-comedy",
      primaryFamily: "comedy",
      ontologyVersion: "0.1.1",
      source: "gold-set" as const,
    };
    const absurdistEditorial = {
      primarySubgenre: "absurdist-comedy",
      primaryFamily: "comedy",
      ontologyVersion: "0.1.1",
      source: "gold-set" as const,
    };
    const workplaceOne = title("a-workplace-one", {
      genres: ["comedy"], subgenres: ["workplace-comedy"], toneTags: ["wry"], editorial: workplaceEditorial,
    });
    const workplaceTwo = title("b-workplace-two", {
      genres: ["comedy"], subgenres: ["workplace-comedy"], toneTags: ["wry"], editorial: workplaceEditorial,
    });
    const absurdist = title("c-absurdist", {
      genres: ["comedy"], subgenres: ["absurdist-comedy"], toneTags: ["playful"], editorial: absurdistEditorial,
    });
    const picks = recommendForProfile({
      profile: profile(),
      catalog: [workplaceOne, workplaceTwo, absurdist],
      moods: ["comedy"],
      limit: 3,
    });
    expect(picks[0].title.id).toBe("a-workplace-one");
    expect(picks[1].title.id).toBe("c-absurdist");
  });

`;
  source = replaceOnce(source, marker, additions + marker, "A3 comedy regression tests");
  write(path, source);
}

console.log("Applied Editorial Engine A3: broader candidate pool, ten-pick ranking, evidence-backed badges, comedy diversity, and confidence calibration.");
