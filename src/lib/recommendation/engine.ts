import {
  RECOMMENDATION_LANES,
  type AvailabilityOption,
  type FeatureContribution,
  type FriendContext,
  type Mood,
  type PreferenceBlendInput,
  type Profile,
  type QuestionnaireDecayConfig,
  type Recommendation,
  type RecommendationConfig,
  type RecommendationFeedback,
  type RecommendationLane,
  type RecommendationWeights,
  type RecommendForProfileInput,
  type SocialRecommendationInput,
  type Title,
  type Vibe,
} from "./types";
import { buildRecommendationNarrative } from "./narrative";

const REFERENCE_YEAR = 2026;

export const defaultRecommendationConfig: RecommendationConfig = {
  schemaVersion: 1,
  modelVersion: "1.0.0",
  weights: {
    directorAffinity: 8,
    actorAffinity: 5,
    writerAffinity: 7,
    cinematographerAffinity: 7,
    genreMatch: 10,
    questionnaireMatch: 7,
    tradeoffMatch: 6,
    feedbackMatch: 12,
    subgenreMatch: 6,
    moodMatch: 13,
    vibeMatch: 9,
    decadeAffinity: 4,
    countryAffinity: 3,
    languageAffinity: 3,
    runtimeAffinity: 2,
    canonicalScore: 5,
    criterionBonus: 4,
    popularitySignal: 3,
    noveltyBonus: 5,
    explorationBonus: 8,
    dislikedSimilarityPenalty: 22,
    availabilityPreference: 7,
  },
  thresholds: {
    stronglyLikedRating: 8,
    stronglyDislikedRating: 4,
    creatorMinimumEvidence: 2,
    rentalExceptionalMargin: 7,
    rentalExceptionalAbsoluteScore: 76,
    canonicalMinimum: 55,
    trendingMinimum: 60,
    maxRecommendations: 10,
  },
  exploration: {
    "Best Bet": 0.05,
    "Close Second": 0.1,
    "Right Mood": 0.15,
    "Creator Match": 0.18,
    "Something Different": 0.34,
    "Hidden Gem": 0.42,
    "Go Deeper": 0.5,
    "Film School Pick": 0.55,
    "Left Field": 0.7,
    "Wild Card": 0.9,
  },
  questionnaireDecay: {
    initialWeight: 0.72,
    minimumWeight: 0.08,
    decayRatings: 20,
    behavioralEvidenceScale: 2,
  },
  normalization: {
    midpoint: 67,
    scale: 12,
    minimumDisplayMatch: 51,
    maximumDisplayMatch: 98,
  },
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const average = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const unique = <T,>(values: readonly T[]) => [...new Set(values)];

/** A single, smooth prior-decay formula used everywhere questionnaire evidence is blended. */
export function questionnaireConfidence(
  ratingCount: number,
  config: QuestionnaireDecayConfig = defaultRecommendationConfig.questionnaireDecay,
): number {
  const count = Math.max(0, ratingCount);
  return (
    config.minimumWeight +
    (config.initialWeight - config.minimumWeight) * Math.exp(-count / config.decayRatings)
  );
}

/** Blends a weak questionnaire prior with increasingly trusted observed behavior. */
export function effectivePreference({
  behavioralPreference,
  behavioralEvidence = 0,
  questionnairePreference,
  ratingCount,
  config = defaultRecommendationConfig.questionnaireDecay,
}: PreferenceBlendInput): number {
  const hasBehavior = behavioralPreference !== undefined && behavioralEvidence > 0;
  const hasPrior = questionnairePreference !== undefined;
  if (!hasBehavior && !hasPrior) return 0;

  const priorWeight = hasPrior ? questionnaireConfidence(ratingCount, config) : 0;
  const behaviorConfidence = hasBehavior
    ? 1 - Math.exp(-Math.max(0, behavioralEvidence) / config.behavioralEvidenceScale)
    : 0;
  // Behavioral evidence both contributes directly and displaces the prior for
  // this feature. With no observations the prior is useful; repeated concrete
  // behavior rapidly wins even when the questionnaire originally disagreed.
  return clamp(
    (behavioralPreference ?? 0) * behaviorConfidence +
      (questionnairePreference ?? 0) * priorWeight * (1 - behaviorConfidence),
    -1,
    1,
  );
}

const weightKeys = Object.keys(defaultRecommendationConfig.weights) as Array<keyof RecommendationWeights>;

/**
 * Imports only the versioned algorithm allow-list. Historical/profile keys in the
 * payload are ignored by construction, so this function cannot rewrite user data.
 */
export function importTunedConfiguration(
  input: unknown,
  current: RecommendationConfig = defaultRecommendationConfig,
): RecommendationConfig {
  const root = isRecord(input) ? input : {};
  const candidate = isRecord(root.configuration)
    ? root.configuration
    : isRecord(root.config)
      ? root.config
      : root;
  const weights = isRecord(candidate.weights) ? candidate.weights : {};
  const thresholds = isRecord(candidate.thresholds) ? candidate.thresholds : {};
  const exploration = isRecord(candidate.exploration) ? candidate.exploration : {};
  const decay = isRecord(candidate.questionnaireDecay) ? candidate.questionnaireDecay : {};
  const normalization = isRecord(candidate.normalization) ? candidate.normalization : {};

  const next: RecommendationConfig = {
    ...current,
    weights: { ...current.weights },
    thresholds: { ...current.thresholds },
    exploration: { ...current.exploration },
    questionnaireDecay: { ...current.questionnaireDecay },
    normalization: { ...current.normalization },
  };

  if (typeof candidate.modelVersion === "string" && /^[a-zA-Z0-9._-]{1,40}$/.test(candidate.modelVersion)) {
    next.modelVersion = candidate.modelVersion;
  }
  for (const key of weightKeys) {
    const value = weights[key];
    if (isFiniteNumber(value)) next.weights[key] = clamp(value, -50, 50);
  }
  for (const key of Object.keys(next.thresholds) as Array<keyof typeof next.thresholds>) {
    const value = thresholds[key];
    if (isFiniteNumber(value)) next.thresholds[key] = clamp(value, 0, key === "maxRecommendations" ? 10 : 200);
  }
  next.thresholds.maxRecommendations = Math.min(10, Math.round(next.thresholds.maxRecommendations));
  for (const lane of RECOMMENDATION_LANES) {
    const value = exploration[lane];
    if (isFiniteNumber(value)) next.exploration[lane] = clamp(value, 0, 1);
  }
  for (const key of Object.keys(next.questionnaireDecay) as Array<keyof QuestionnaireDecayConfig>) {
    const value = decay[key];
    if (isFiniteNumber(value)) next.questionnaireDecay[key] = clamp(value, 0.001, 250);
  }
  next.questionnaireDecay.initialWeight = clamp(next.questionnaireDecay.initialWeight, 0, 1);
  next.questionnaireDecay.minimumWeight = clamp(
    next.questionnaireDecay.minimumWeight,
    0,
    next.questionnaireDecay.initialWeight,
  );
  for (const key of Object.keys(next.normalization) as Array<keyof typeof next.normalization>) {
    const value = normalization[key];
    if (isFiniteNumber(value)) next.normalization[key] = clamp(value, 0.01, 200);
  }
  next.normalization.minimumDisplayMatch = clamp(next.normalization.minimumDisplayMatch, 0, 100);
  next.normalization.maximumDisplayMatch = clamp(
    next.normalization.maximumDisplayMatch,
    next.normalization.minimumDisplayMatch,
    100,
  );
  return next;
}

interface ScoredCandidate {
  title: Title;
  exactVibeMatch: boolean;
  intrinsicScore: number;
  novelty: number;
  creatorSignal: number;
  hiddenGemSignal: number;
  canonicalSignal: number;
  moodSignal: number;
  socialScore: number;
  socialEnabled: boolean;
  friendContext?: FriendContext;
  contributions: FeatureContribution[];
  evidence: string[];
  availability: AvailabilityOption[];
  primaryAvailability: AvailabilityOption;
}

interface AffinityResult {
  value: number;
  evidenceCount: number;
  person?: string;
  averageRating?: number;
}

export function recommendForProfile({
  profile,
  catalog,
  moods = [],
  vibes = [],
  lane,
  config = defaultRecommendationConfig,
  limit,
  excludeTitleIds = [],
  social,
  feedback = [],
}: RecommendForProfileInput): Recommendation[] {
  const safeLimit = Math.min(100, Math.max(0, Math.floor(limit ?? config.thresholds.maxRecommendations)));
  if (!safeLimit || !catalog.length) return [];

  const titleById = new Map(catalog.map((title) => [title.id, title]));
  const excludedTitleIdsSet = new Set(excludeTitleIds);
  const rated = profile.ratings
    .map((rating) => ({ rating, title: titleById.get(rating.titleId) }))
    .filter((entry): entry is { rating: Profile["ratings"][number]; title: Title } => Boolean(entry.title));
  const watchedIds = new Set(rated.filter(({ rating }) => rating.watched).map(({ rating }) => rating.titleId));
  const profileFeedback = feedback.filter((item) => item.profileId === profile.id);
  const excludedByFeedback = new Set(
    profileFeedback.flatMap((item) =>
      item.reason && (
        ["already-seen", "not-interested", "misclassified", "not-available"].includes(item.reason) ||
        (["wrong-mood", "good-wrong-night"].includes(item.reason) && feedbackMatchesTonight(item, moods, vibes))
      )
        ? [item.titleId]
        : [],
    ),
  );
  const rewatchMode = vibes.includes("rewatch-favorite");

  const preAvailability = catalog
    .filter((title) => !excludedTitleIdsSet.has(title.id))
    .filter((title) => matchesRequestedMood(title, moods))
    .filter((title) => !matchesStrongGenreAvoidance(title, profile, rated, config))
    .filter((title) => !excludedByFeedback.has(title.id))
    .filter((title) =>
      rewatchMode
        ? watchedIds.has(title.id) && (profile.ratings.find((rating) => rating.titleId === title.id)?.score ?? 0) >= 7
        : !watchedIds.has(title.id),
    )
    .map((title) => ({
      ...scoreTitle(title, profile, rated, moods, vibes, config, social, profileFeedback, titleById),
      exactVibeMatch: matchesVibeGate(title, vibes, profile, rated, config),
    }));

  const watchable = preAvailability
    .map((candidate) => {
      const availability = regionAvailability(candidate.title, profile);
      if (!availability.length) return undefined;
      return {
        ...candidate,
        availability,
        primaryAvailability: availability[0],
      } satisfies ScoredCandidate;
    })
    .filter((candidate): candidate is ScoredCandidate => Boolean(candidate));

  const includedScores = watchable
    .filter(({ primaryAvailability }) =>
      primaryAvailability.kind === "subscription" || primaryAvailability.kind === "free",
    )
    .map(({ intrinsicScore }) => intrinsicScore);
  const bestIncluded = includedScores.length ? Math.max(...includedScores) : undefined;

  const eligible = watchable.filter((candidate) => {
    const kind = candidate.primaryAvailability.kind;
    if (kind === "subscription" || kind === "free") return true;
    if (profile.rentalMode === "never") return false;
    if (profile.rentalMode === "always") return true;
    if (kind === "purchase") return false;
    return bestIncluded === undefined
      ? candidate.intrinsicScore >= config.thresholds.rentalExceptionalAbsoluteScore
      : candidate.intrinsicScore >= bestIncluded + config.thresholds.rentalExceptionalMargin;
  });

  const exactEligible = eligible.filter((candidate) => candidate.exactVibeMatch);
  const minimumPageSize = Math.min(config.thresholds.maxRecommendations, safeLimit);
  const recommendationPool = exactEligible.length >= minimumPageSize || eligible.length < minimumPageSize
    ? exactEligible
    : eligible;
  const count = Math.min(safeLimit, recommendationPool.length);
  const selected: Recommendation[] = [];
  const remaining = [...recommendationPool];

  for (let index = 0; index < count; index += 1) {
    const recommendationLane = RECOMMENDATION_LANES[index % RECOMMENDATION_LANES.length];
    const scoringLane = lane ?? recommendationLane;
    const exploration = config.exploration[scoringLane];
    const ranked = remaining
      .map((candidate) => ({
        candidate,
        score: laneScore(candidate, scoringLane, exploration, selected, config),
      }))
      .sort(
        (a, b) =>
          Number(b.candidate.exactVibeMatch) - Number(a.candidate.exactVibeMatch) ||
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
    if (!candidate.exactVibeMatch && vibes.length) {
      evidence.push(`This is a strong nearby match used after the exact ${vibes[0].replaceAll("-", " ")} options.`);
    }
    const narrative = buildRecommendationNarrative({
      title: candidate.title,
      profile,
      moods,
      vibes,
      lane: recommendationLane,
      evidence,
    });
    const normalizedScore = normalizeScore(winner.score, config);
    const matchScore = Math.round(
      config.normalization.minimumDisplayMatch +
        normalizedScore *
          (config.normalization.maximumDisplayMatch - config.normalization.minimumDisplayMatch),
    );
    selected.push({
      rank: index + 1,
      lane: recommendationLane,
      title: candidate.title,
      rawScore: round(winner.score, 3),
      normalizedScore: round(normalizedScore, 4),
      matchScore,
      explanation: [narrative.fit, narrative.cast, narrative.setup].filter(Boolean).join(" "),
      narrative,
      evidence,
      contributions: [...candidate.contributions].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      availability: candidate.availability,
      primaryAvailability: candidate.primaryAvailability,
      requiresPayment,
      modelVersion: config.modelVersion,
      friendContext: candidate.friendContext,
    });
    remaining.splice(remaining.indexOf(candidate), 1);
  }

  return selected;
}

function feedbackMatchesTonight(
  feedback: RecommendationFeedback,
  moods: readonly Mood[],
  vibes: readonly Vibe[],
): boolean {
  const feedbackMoods = feedback.context?.moods ?? [];
  const feedbackVibes = feedback.context?.vibes ?? [];
  if (!feedbackMoods.length && !feedbackVibes.length) return false;
  const moodMatches = !feedbackMoods.length || feedbackMoods.some((mood) => moods.includes(mood));
  const vibeMatches = !feedbackVibes.length || feedbackVibes.some((vibe) => vibes.includes(vibe));
  return moodMatches && vibeMatches;
}

function scoreTitle(
  title: Title,
  profile: Profile,
  rated: Array<{ rating: Profile["ratings"][number]; title: Title }>,
  moods: readonly Mood[],
  vibes: readonly Vibe[],
  config: RecommendationConfig,
  social?: SocialRecommendationInput,
  feedback: readonly RecommendationFeedback[] = [],
  titleById: ReadonlyMap<string, Title> = new Map(),
): Omit<ScoredCandidate, "availability" | "primaryAvailability" | "exactVibeMatch"> {
  const contributions: FeatureContribution[] = [];
  const evidence: string[] = [];
  let score = 50;
  const add = (feature: string, value: number, fact?: string) => {
    if (Math.abs(value) < 0.0001) return;
    score += value;
    contributions.push({ feature, value: round(value, 3), evidence: fact });
    if (fact) {
      if (feature === "directorAffinity") evidence.unshift(fact);
      else evidence.push(fact);
    }
  };

  const profileRatingCount = rated.length;
  const genreSignals = unique(title.genres).flatMap((genre) => {
    const behavior = affinityFromSharedValues([genre], rated, (item) => item.genres);
    const questionnaire = questionnaireGenrePreference(genre, profile);
    if (!behavior.evidence && questionnaire === undefined) return [];
    return [effectivePreference({
      behavioralPreference: behavior.evidence ? behavior.value : undefined,
      behavioralEvidence: behavior.evidence,
      questionnairePreference: questionnaire,
      ratingCount: profileRatingCount,
      config: config.questionnaireDecay,
    })];
  });
  const genrePreference = cautiousPreference(genreSignals);
  const genreBehavior = affinityFromSharedValues(title.genres, rated, (item) => item.genres);
  add("genreMatch", config.weights.genreMatch * genrePreference);

  const subgenre = affinityFromSharedValues(title.subgenres, rated, (item) => item.subgenres);
  add("subgenreMatch", config.weights.subgenreMatch * subgenre.value);

  const moodSignal = moods.length ? 1 : 0;
  if (moodSignal) add("moodMatch", config.weights.moodMatch, moodEvidence(title, moods));

  const creatorResults: Array<{ feature: string; weight: number; result: AffinityResult }> = [
    { feature: "directorAffinity", weight: config.weights.directorAffinity, result: creatorAffinity(title.directors, rated, "directors", profile, config) },
    { feature: "writerAffinity", weight: config.weights.writerAffinity, result: creatorAffinity(title.writers, rated, "writers", profile, config) },
    { feature: "cinematographerAffinity", weight: config.weights.cinematographerAffinity, result: creatorAffinity(title.cinematographers, rated, "cinematographers", profile, config) },
    { feature: "actorAffinity", weight: config.weights.actorAffinity, result: creatorAffinity(title.actors, rated, "actors", profile, config) },
  ];
  for (const { feature, weight, result } of creatorResults) {
    const fact =
      result.person && result.evidenceCount >= config.thresholds.creatorMinimumEvidence
        ? `${result.evidenceCount} ${result.person} titles you rated average ${result.averageRating?.toFixed(1)}/10.`
        : result.person && result.value > 0
          ? `${result.person} is in your saved favorites.`
          : undefined;
    add(feature, weight * result.value, fact);
  }
  const creatorSignal = Math.max(0, ...creatorResults.map(({ result }) => result.value));

  const decade = affinityFromSharedValues([String(Math.floor(title.year / 10) * 10)], rated, (item) => [String(Math.floor(item.year / 10) * 10)]);
  const country = affinityFromSharedValues(title.countries, rated, (item) => item.countries);
  const language = affinityFromSharedValues(title.languages, rated, (item) => item.languages);
  const runtime = affinityFromSharedValues([runtimeBucket(title)], rated, runtimeBucketArray);
  add("decadeAffinity", config.weights.decadeAffinity * decade.value);
  add("countryAffinity", config.weights.countryAffinity * country.value);
  add("languageAffinity", config.weights.languageAffinity * language.value);
  add("runtimeAffinity", config.weights.runtimeAffinity * runtime.value);

  const canonicalSignal = clamp(title.canonicalScore / 100, 0, 1);
  add(
    "canonicalScore",
    config.weights.canonicalScore * canonicalSignal,
    vibes.some((vibe) => ["rediscover-classic", "film-school-night", "blind-spot"].includes(vibe))
      ? `${title.name} has a ${title.canonicalScore}/100 aggregated canonical score.`
      : undefined,
  );
  if (title.criterionCollection) {
    add(
      "criterionBonus",
      config.weights.criterionBonus,
      vibes.includes("criterion-pick") ? `${title.name} is Criterion-associated.` : undefined,
    );
  }
  add("popularitySignal", config.weights.popularitySignal * clamp(title.popularity / 100, 0, 1));

  const maxWatchedSimilarity = rated.length
    ? Math.max(...rated.map(({ title: ratedTitle }) => titleSimilarity(title, ratedTitle)))
    : 0;
  const novelty = clamp(1 - maxWatchedSimilarity, 0, 1);
  add("noveltyBonus", config.weights.noveltyBonus * novelty * (vibes.includes("try-something-new") ? 1 : 0.35));

  const questionnaireFit = questionnairePreference(title, profile, novelty, maxWatchedSimilarity);
  const effectiveQuestionnaireFit = effectivePreference({
    behavioralPreference: genreBehavior.evidence ? 0 : undefined,
    behavioralEvidence: genreBehavior.evidence,
    questionnairePreference: questionnaireFit,
    ratingCount: profileRatingCount,
    config: config.questionnaireDecay,
  });
  add("questionnaireMatch", config.weights.questionnaireMatch * effectiveQuestionnaireFit);

  const tradeoffFit = tradeoffPreference(title, profile, novelty);
  const effectiveTradeoffFit = effectivePreference({
    questionnairePreference: tradeoffFit,
    ratingCount: profileRatingCount,
    config: config.questionnaireDecay,
  });
  add("tradeoffMatch", config.weights.tradeoffMatch * effectiveTradeoffFit);

  const learnedFeedback = feedbackPreference(title, feedback, titleById);
  add(
    "feedbackMatch",
    config.weights.feedbackMatch * learnedFeedback,
    Math.abs(learnedFeedback) >= 0.2
      ? "Your earlier recommendation feedback directly adjusted this match."
      : undefined,
  );

  const vibeSignal = vibeScore(title, vibes, profile, rated, creatorSignal, novelty, config);
  add("vibeMatch", config.weights.vibeMatch * vibeSignal, vibeEvidence(title, vibes));

  const disliked = rated.filter(({ rating }) => rating.score <= config.thresholds.stronglyDislikedRating);
  const dislikedSimilarity = disliked.length
    ? Math.max(...disliked.map(({ title: dislikedTitle }) => titleSimilarity(title, dislikedTitle)))
    : 0;
  if (dislikedSimilarity > 0) {
    const nearest = disliked
      .map((item) => ({ ...item, similarity: titleSimilarity(title, item.title) }))
      .sort((a, b) => b.similarity - a.similarity)[0];
    add(
      "dislikedSimilarityPenalty",
      -config.weights.dislikedSimilarityPenalty * dislikedSimilarity,
      nearest && dislikedSimilarity >= 0.35
        ? `Similarity to ${nearest.title.name}, which you rated ${nearest.rating.score}/10, reduced this match.`
        : undefined,
    );
  }

  const closeLiked = rated
    .filter(({ rating }) => rating.score >= config.thresholds.stronglyLikedRating)
    .map((item) => ({ ...item, similarity: titleSimilarity(title, item.title) }))
    .filter(({ similarity }) => similarity >= 0.2)
    .sort((a, b) => b.similarity - a.similarity)[0];
  if (closeLiked) {
    evidence.unshift(
      `${title.name} shares concrete genre, tone, or creator signals with ${closeLiked.title.name}, which you rated ${closeLiked.rating.score}/10.`,
    );
  }

  const socialEvidence = scoreFriendEvidence(
    profile,
    title.id,
    social,
    config.thresholds.stronglyLikedRating,
  );

  return {
    title,
    intrinsicScore: score,
    novelty,
    creatorSignal,
    hiddenGemSignal: clamp((100 - title.popularity) / 100, 0, 1) * (0.5 + canonicalSignal / 2),
    canonicalSignal,
    moodSignal,
    socialScore: socialEvidence.score,
    socialEnabled: vibes.includes("friends-picks"),
    friendContext: socialEvidence.context,
    contributions,
    evidence: unique(evidence),
  };
}

function laneScore(
  candidate: ScoredCandidate,
  lane: RecommendationLane,
  exploration: number,
  selected: readonly Recommendation[],
  config: RecommendationConfig,
): number {
  let score = candidate.intrinsicScore;
  const kind = candidate.primaryAvailability.kind;
  score += config.weights.availabilityPreference *
    (kind === "subscription" ? 1 : kind === "free" ? 0.65 : kind === "rental" ? -0.45 : -0.75);
  score += candidate.novelty * config.weights.explorationBonus * exploration;
  if (selected.length) {
    const diversity = average(selected.map(({ title }) => 1 - titleSimilarity(candidate.title, title)));
    score += diversity * config.weights.explorationBonus * exploration * 0.7;
  }
  if (lane === "Right Mood") score += candidate.moodSignal * 4;
  if (lane === "Creator Match") score += candidate.creatorSignal * 7;
  if (lane === "Hidden Gem") score += candidate.hiddenGemSignal * 9;
  if (lane === "Go Deeper") score += (candidate.creatorSignal * 0.6 + candidate.hiddenGemSignal * 0.4) * 8;
  if (lane === "Film School Pick") score += candidate.canonicalSignal * 9;
  if (lane === "Left Field") score += candidate.novelty * 8;
  if (lane === "Wild Card") score += candidate.novelty * 11;
  if (candidate.socialEnabled && candidate.socialScore > 0) {
    score += candidate.socialScore;
  }
  return score;
}

function matchesRequestedMood(title: Title, moods: readonly Mood[]): boolean {
  if (!moods.length) return true;
  if (title.contentType === "stand-up") return moods.includes("stand-up");
  const normalizedGenres = title.genres.map((genre) => genre.toLowerCase());
  return moods.some((mood) => {
    if (mood === "stand-up") return false;
    if (mood === "comedy" && title.primarySubgenre) return isComedyLedSubgenre(title.primarySubgenre);
    return normalizedGenres.includes(mood);
  });
}

function matchesStrongGenreAvoidance(
  title: Title,
  profile: Profile,
  rated: Array<{ rating: Profile["ratings"][number]; title: Title }>,
  config: RecommendationConfig,
): boolean {
  const questionnaireGenres = new Map(
    Object.entries(profile.questionnaire?.genreScores ?? {}).map(([genre, score]) => [genre.toLowerCase(), score]),
  );
  return title.genres.some((genre) => {
    const questionnaireScore = questionnaireGenres.get(genre.toLowerCase());
    if (questionnaireScore === undefined || questionnaireScore > 1.5) return false;
    const matchingRatings = rated.filter(({ title: ratedTitle }) => ratedTitle.genres.includes(genre));
    return matchingRatings.length >= 2
      && average(matchingRatings.map(({ rating }) => rating.score)) <= config.thresholds.stronglyDislikedRating;
  });
}

function matchesVibeGate(
  title: Title,
  vibes: readonly Vibe[],
  profile: Profile,
  rated: Array<{ rating: Profile["ratings"][number]; title: Title }>,
  config: RecommendationConfig,
): boolean {
  for (const vibe of vibes) {
    if (vibe === "criterion-pick" && !title.criterionCollection) return false;
    if (vibe === "popular-international" && title.countries.includes(profile.region)) return false;
    if (vibe === "bingeable-tv" && title.contentType !== "series") return false;
    if (
      vibe === "trending-series" &&
      (title.contentType !== "series" || title.trendingScore < config.thresholds.trendingMinimum)
    ) return false;
    if (
      ["rediscover-classic", "film-school-night", "blind-spot"].includes(vibe) &&
      title.canonicalScore < config.thresholds.canonicalMinimum
    ) return false;
    if (vibe === "rediscover-classic" && title.year > 2000) return false;
    if (vibe === "complete-director" || vibe === "go-deeper") {
      const likedDirectors = new Set(
        rated
          .filter(({ rating }) => rating.score >= config.thresholds.stronglyLikedRating)
          .flatMap(({ title: ratedTitle }) => ratedTitle.directors),
      );
      if (!title.directors.some((director) => likedDirectors.has(director))) return false;
    }
  }
  return true;
}

function regionAvailability(title: Title, profile: Profile): AvailabilityOption[] {
  const priority: Record<AvailabilityOption["kind"], number> = {
    subscription: 0,
    free: 1,
    rental: 2,
    purchase: 3,
  };
  return title.availability
    .filter((option) => option.region === profile.region)
    .filter((option) => {
      if (option.kind === "subscription") return profile.subscriptions.includes(option.serviceId);
      if (option.kind === "free") return profile.allowAdSupported;
      return true;
    })
    .sort((a, b) => priority[a.kind] - priority[b.kind] || a.serviceId.localeCompare(b.serviceId));
}

function creatorAffinity(
  people: readonly string[],
  rated: Array<{ rating: Profile["ratings"][number]; title: Title }>,
  key: "directors" | "writers" | "cinematographers" | "actors",
  profile: Profile,
  config: RecommendationConfig,
): AffinityResult {
  const favoriteKey = key === "directors" ? "directors" : key === "writers" ? "writers" : key === "cinematographers" ? "cinematographers" : "actors";
  const results = people.map((person) => {
    const relevant = rated.filter(({ title }) => title[key].includes(person));
    const savedFavorite = profile.favoritePeople[favoriteKey].includes(person);
    const evidenceCount = relevant.length;
    const averageRating = evidenceCount ? average(relevant.map(({ rating }) => rating.score)) : undefined;
    const observed = averageRating === undefined ? 0 : clamp((averageRating - 5.5) / 4.5, -1, 1);
    const confidence = evidenceCount >= config.thresholds.creatorMinimumEvidence
      ? 1 - Math.exp(-evidenceCount / 2)
      : evidenceCount * 0.2;
    return {
      person,
      evidenceCount,
      averageRating,
      value: clamp(observed * confidence + (savedFavorite ? 0.45 : 0), -1, 1),
    };
  });
  return results.sort((a, b) => b.value - a.value)[0] ?? { value: 0, evidenceCount: 0 };
}

function affinityFromSharedValues(
  candidateValues: readonly string[],
  rated: Array<{ rating: Profile["ratings"][number]; title: Title }>,
  extract: (title: Title) => readonly string[],
): { value: number; evidence: number } {
  const relevant = rated.filter(({ title }) => extract(title).some((value) => candidateValues.includes(value)));
  if (!relevant.length) return { value: 0, evidence: 0 };
  return {
    value: clamp(average(relevant.map(({ rating }) => (rating.score - 5.5) / 4.5)), -1, 1),
    evidence: relevant.length,
  };
}

function questionnaireGenrePreference(term: string, profile: Profile): number | undefined {
  const genreScores = profile.questionnaire?.genreScores;
  if (!genreScores) return undefined;
  const normalize = (value: string) => value.toLowerCase().replaceAll("-", " ").trim();
  const scoresByGenre = new Map(Object.entries(genreScores).map(([genre, value]) => [normalize(genre), value]));
  const normalized = normalize(term);
  const score = scoresByGenre.get(normalized)
    ?? (normalized === "history" ? scoresByGenre.get("historical") : undefined);
  return score === undefined ? undefined : clamp((score - 4) / 3, -1, 1);
}

function cautiousPreference(values: readonly number[]): number {
  if (!values.length) return 0;
  const strongestAversion = Math.min(0, ...values);
  return clamp(average(values) + strongestAversion * 0.6, -1, 1);
}

function isComedyLedSubgenre(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("comedy")
    || normalized.includes("sitcom")
    || normalized === "satire"
    || normalized === "news-satire"
    || normalized === "sketch-comedy";
}

function questionnairePreference(
  title: Title,
  profile: Profile,
  novelty: number,
  familiarity: number,
): number | undefined {
  const scores = profile.questionnaire?.dimensionScores;
  if (!scores) return undefined;
  const tags = [...title.genres, ...title.subgenres, ...title.toneTags]
    .map((value) => value.toLowerCase().replaceAll("-", " ").trim());
  const has = (...values: string[]) => tags.some((tag) => values.includes(tag));
  const scripted = title.contentType !== "stand-up";
  const horror = has("horror", "supernatural horror", "psychological horror", "body horror", "slasher");
  const characteristicSignals: Array<[keyof typeof scores, number]> = [
    ["cerebral", has("mystery", "cerebral", "investigative", "ambiguous", "nonlinear") ? 1 : 0],
    ["emotionalIntensity", has("emotional", "intense", "bittersweet", "tragic", "heartfelt") ? 1 : 0],
    ["darknessTolerance", has("dark", "bleak", "crime", "moral ambiguity", "psychological") ? 1 : 0],
    ["thrill", has("action", "thriller", "suspense", "fast", "twisty", "spectacle") ? 1 : 0],
    ["imagination", has("science fiction", "fantasy", "surreal", "imaginative", "nonlinear") ? 1 : 0],
    ["comedy", scripted && has("comedy", "dark comedy", "dry comedy", "satire", "visual comedy", "buddy comedy") ? 1 : 0],
    ["dryComedy", scripted && has("dry comedy", "deadpan", "wry", "understated") ? 1 : 0],
    ["darkComedy", scripted && has("dark comedy", "black comedy", "awkward comedy", "absurdist comedy", "cynical") ? 1 : 0],
    ["broadComedy", scripted && has("broad comedy", "slapstick", "buddy comedy", "visual comedy", "parody spoof", "raunchy", "sex comedy") ? 1 : 0],
    ["standUp", title.contentType === "stand-up" ? 1 : 0],
    ["characterOrientation", has("character study", "ensemble", "character-driven") ? 1 : 0],
    ["realism", has("based on true events", "procedural", "realist", "grounded", "documentary") ? 1 : 0],
    ["ambiguityTolerance", has("ambiguous", "twisty", "nonlinear", "mystery") ? 1 : 0],
    ["slowPacing", title.pacing === "slow" ? 1 : 0],
    ["novelty", novelty],
    ["discovery", clamp((70 - title.popularity) / 50, 0, 1)],
    ["classicOpenness", clamp((2000 - title.year) / 60, 0, 1)],
    ["internationalOpenness", !title.languages.includes("en") || !title.countries.includes(profile.region) ? 1 : 0],
    ["horrorTolerance", has("horror", "creature", "gore", "body horror", "psychological") ? 1 : 0],
    ["psychologicalHorror", horror && has("psychological horror", "psychological", "dread", "unsettling", "slow burn") ? 1 : 0],
    ["goreTolerance", horror && has("gore", "graphic", "body horror", "visceral", "slasher") ? 1 : 0],
    ["rewatchOrientation", familiarity],
    ["televisionCommitment", title.contentType === "series" ? clamp((title.seasons ?? 1) / 5, 0.25, 1) : 0],
    ["bingePreference", title.contentType === "series" ? bingeability(title) : 0],
  ];
  const values = characteristicSignals.flatMap(([dimension, signal]) => {
    const value = scores[dimension];
    return value === undefined || signal <= 0 ? [] : [clamp((value - 50) / 50, -1, 1) * signal];
  });
  return values.length ? average(values) : undefined;
}

function tradeoffPreference(title: Title, profile: Profile, novelty: number): number | undefined {
  const scores = profile.questionnaire?.tradeoffScores;
  if (!scores) return undefined;
  const values: number[] = [];
  if (scores.pace !== undefined && title.pacing !== "moderate") {
    values.push(scores.pace * (title.pacing === "fast" ? 1 : -1));
  }
  if (scores.release !== undefined) {
    const releaseSignal = clamp(title.trendingScore / 100 - title.canonicalScore / 100, -1, 1);
    if (Math.abs(releaseSignal) > 0.05) values.push(scores.release * releaseSignal);
  }
  if (scores.familiarity !== undefined) {
    values.push(scores.familiarity * (novelty * 2 - 1));
  }
  return values.length ? average(values) : undefined;
}

function feedbackPreference(
  title: Title,
  feedback: readonly RecommendationFeedback[],
  titleById: ReadonlyMap<string, Title>,
): number {
  const tags = [...title.genres, ...title.subgenres, ...title.toneTags].map((value) => value.toLowerCase());
  const has = (...values: string[]) => tags.some((tag) => values.includes(tag));
  const darkSignal = has("dark", "bleak", "crime", "horror", "psychological", "moral ambiguity") ? 1 : 0;
  const lightSignal = has("gentle", "warm", "family", "visual comedy", "broad comedy") ? 1 : 0;
  const oldSignal = clamp((REFERENCE_YEAR - title.year - 20) / 60, 0, 1);
  const minutes = title.contentType === "series" ? title.episodeRuntimeMinutes : title.runtimeMinutes;
  const longSignal = minutes ? clamp((minutes - 100) / 80, 0, 1) : 0;
  let signal = 0;

  for (const item of feedback) {
    const source = titleById.get(item.titleId);
    const similarity = source ? titleSimilarity(title, source) : item.titleId === title.id ? 1 : 0;
    if (item.recommendationScore !== undefined && similarity > 0) {
      signal += clamp((item.recommendationScore - 5.5) / 4.5, -1, 1) * similarity * 0.7;
    }
    if (item.reason === "too-dark") signal -= darkSignal * 0.55;
    if (item.reason === "too-light") signal -= lightSignal * 0.55;
    if (item.reason === "too-old") signal -= oldSignal * 0.55;
    if (item.reason === "too-long") signal -= longSignal * 0.55;
    if (item.reason === "disliked-actor" && source && title.actors.some((actor) => source.actors.includes(actor))) {
      signal -= 0.8;
    }
    if (item.reason === "good-wrong-night" && similarity > 0) signal += similarity * 0.2;
  }

  return clamp(signal, -1, 1);
}

function vibeScore(
  title: Title,
  vibes: readonly Vibe[],
  profile: Profile,
  rated: Array<{ rating: Profile["ratings"][number]; title: Title }>,
  creatorSignal: number,
  novelty: number,
  config: RecommendationConfig,
): number {
  if (!vibes.length) return 0;
  const ownRating = profile.ratings.find((rating) => rating.titleId === title.id);
  const scores = vibes.map((vibe) => {
    switch (vibe) {
      case "rewatch-favorite": return clamp(((ownRating?.score ?? 5.5) - 5.5) / 4.5, 0, 1);
      case "rediscover-classic": return clamp(title.canonicalScore / 100 + (REFERENCE_YEAR - title.year) / 150, 0, 1);
      case "try-something-new": return novelty;
      case "popular-international": return clamp(title.popularity / 100, 0, 1);
      case "bingeable-tv": return bingeability(title);
      case "trending-series": return clamp(title.trendingScore / 100, 0, 1);
      case "hidden-gem": return clamp((100 - title.popularity) / 100 + title.canonicalScore / 200, 0, 1);
      case "surprise-me": return novelty;
      case "complete-director": return creatorSignal;
      case "criterion-pick": return title.criterionCollection ? 1 : 0;
      case "film-school-night": return clamp(title.canonicalScore / 100, 0, 1);
      case "blind-spot": return clamp(title.canonicalScore / 100, 0, 1);
      case "go-deeper": return clamp(creatorSignal + (100 - title.popularity) / 200, 0, 1);
      case "friends-picks": return 0;
    }
  });
  void rated;
  void config;
  return average(scores);
}

type ScoredFriendActivity = {
  friend: SocialRecommendationInput["friendProfiles"][number];
  rating?: number;
  review?: SocialRecommendationInput["reviews"][number];
  recommendation?: SocialRecommendationInput["recommendations"][number];
  strength: number;
};

function scoreFriendEvidence(
  profile: Profile,
  titleId: string,
  social: SocialRecommendationInput | undefined,
  positiveRatingThreshold: number,
): { score: number; context?: FriendContext } {
  if (!social) return { score: 0 };
  const acceptedFriendIds = new Set(
    social.friendships.flatMap((friendship) => {
      if (friendship.status !== "accepted") return [];
      if (friendship.requesterProfileId === profile.id) return [friendship.addresseeProfileId];
      if (friendship.addresseeProfileId === profile.id) return [friendship.requesterProfileId];
      return [];
    }),
  );
  if (!acceptedFriendIds.size) return { score: 0 };

  const activity = social.friendProfiles.flatMap((friend): ScoredFriendActivity[] => {
    if (!acceptedFriendIds.has(friend.profileId)) return [];
    const recommendation = social.recommendations
      .filter((item) => item.senderProfileId === friend.profileId && item.recipientProfileId === profile.id && item.titleId === titleId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const visibleRating = friend.shareWithFriends === "nothing"
      ? undefined
      : friend.ratings.find((item) => item.titleId === titleId);
    const positiveRating = visibleRating && visibleRating.score >= positiveRatingThreshold ? visibleRating : undefined;
    const review = positiveRating && friend.shareWithFriends === "ratings_and_reviews"
      ? social.reviews
        .filter((item) => item.authorProfileId === friend.profileId && item.titleId === titleId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
    if (!recommendation && !positiveRating) return [];

    const compatibility = friendTasteCompatibility(profile.ratings, friend.ratings);
    const ratingStrength = positiveRating ? (positiveRating.score - positiveRatingThreshold + 1) * 1.35 : 0;
    const explicitStrength = recommendation ? 6.25 : 0;
    const noteStrength = recommendation?.note || review?.note ? 1.4 : 0;
    const recent = socialRecency(
      recommendation?.createdAt ?? review?.createdAt ?? positiveRating?.ratedAt,
      social.now,
    );
    return [{
      friend,
      rating: positiveRating?.score,
      review,
      recommendation,
      strength: (ratingStrength + explicitStrength + noteStrength + recent * 1.4) * (0.7 + compatibility * 0.5),
    }];
  });

  if (!activity.length) return { score: 0 };
  const explicitWithNote = activity
    .filter((item) => item.recommendation?.note)
    .sort((a, b) => (b.recommendation?.createdAt ?? "").localeCompare(a.recommendation?.createdAt ?? ""))[0];
  const reviewWithNote = activity
    .filter((item) => item.review?.note)
    .sort((a, b) => (b.review?.createdAt ?? "").localeCompare(a.review?.createdAt ?? ""))[0];
  const explicit = activity.find((item) => item.recommendation);
  const strongest = [...activity].sort((a, b) => b.strength - a.strength)[0];
  const highlighted = explicitWithNote ?? reviewWithNote ?? explicit ?? strongest;
  const ratings = activity.flatMap((item) => item.rating === undefined ? [] : [item.rating]);
  const averageRating = ratings.length ? average(ratings) : undefined;
  const friendCount = activity.length;
  const isExplicit = Boolean(highlighted.recommendation);
  const headline = isExplicit
    ? `${highlighted.friend.displayName} picked this for you`
    : friendCount > 1
      ? `${friendCount} friends liked this`
      : highlighted.rating === 10
        ? `${highlighted.friend.displayName} loved this`
        : `${highlighted.friend.displayName} also enjoyed this`;

  return {
    score: Math.min(18, activity.reduce((sum, item) => sum + item.strength, 0) + Math.max(0, friendCount - 1) * 1.2),
    context: {
      headline,
      note: highlighted.recommendation?.note ?? highlighted.review?.note,
      rating: highlighted.rating,
      friendCount,
      averageRating,
      explicit: isExplicit,
    },
  };
}

function friendTasteCompatibility(ownRatings: readonly Profile["ratings"][number][], friendRatings: readonly Profile["ratings"][number][]): number {
  const ownByTitle = new Map(ownRatings.map((rating) => [rating.titleId, rating.score]));
  const overlaps = friendRatings.flatMap((rating) => {
    const ownScore = ownByTitle.get(rating.titleId);
    return ownScore === undefined ? [] : [Math.abs(ownScore - rating.score)];
  });
  if (overlaps.length < 2) return 0.5;
  const raw = clamp(1 - average(overlaps) / 9, 0, 1);
  const confidence = Math.min(1, overlaps.length / 8);
  return 0.5 + (raw - 0.5) * confidence;
}

function socialRecency(value: string | undefined, nowValue: string | undefined): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  const now = nowValue ? new Date(nowValue).getTime() : Date.now();
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 0;
  const ageInDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.max(0, 1 - ageInDays / 120);
}

function bingeability(title: Title): number {
  if (title.contentType !== "series") return 0;
  const runtime = title.episodeRuntimeMinutes ?? 55;
  const shortEpisode = clamp((70 - runtime) / 45, 0, 1);
  const seasonCommitment = title.seasons ? clamp((7 - title.seasons) / 6, 0, 1) : 0.5;
  return clamp(shortEpisode * 0.35 + seasonCommitment * 0.25 + (title.serialized ? 0.3 : 0.15) + (title.completed ? 0.1 : 0), 0, 1);
}

function moodEvidence(title: Title, moods: readonly Mood[]): string {
  const matched = moods.find((mood) =>
    title.contentType === "stand-up"
      ? mood === "stand-up"
      : title.genres.some((genre) => genre.toLowerCase() === mood),
  );
  return `You asked for ${matched ?? moods[0]}; ${title.name} is classified as ${title.contentType === "stand-up" ? "stand-up" : matched ?? title.genres[0]}.`;
}

function vibeEvidence(title: Title, vibes: readonly Vibe[]): string | undefined {
  if (vibes.includes("hidden-gem")) return `${title.name} has lower mainstream popularity while retaining editorial quality signals.`;
  if (vibes.includes("popular-international")) return `${title.name} is primarily from ${title.countries.join(", ")} and has a ${title.popularity}/100 popularity signal.`;
  if (vibes.includes("trending-series")) return `${title.name} has a ${title.trendingScore}/100 current demo trending signal.`;
  if (vibes.includes("bingeable-tv")) return `${title.name} has ${title.episodeRuntimeMinutes ?? "unknown"}-minute episodes and a transparent bingeability fit.`;
  if (vibes.includes("try-something-new")) return `${title.name} adds unfamiliar features relative to your watched history.`;
  return undefined;
}

function buildEvidence(
  candidate: ScoredCandidate,
  moods: readonly Mood[],
  vibes: readonly Vibe[],
  lane: RecommendationLane,
  requiresPayment: boolean,
): string[] {
  const facts = [...candidate.evidence];
  if (!facts.length && moods.length) facts.push(moodEvidence(candidate.title, moods));
  if (!facts.length && vibes.includes("friends-picks")) facts.push(`${candidate.title.name} remains a personal taste and quality match before friend evidence is considered.`);
  if (!facts.length && vibes.length) facts.push(`${candidate.title.name} satisfies your ${vibes[0].replaceAll("-", " ")} filter.`);
  if (!facts.length) facts.push(`${candidate.title.name} is an unseen title with concrete quality and taste-fit signals.`);
  if (lane === "Hidden Gem" && !facts.some((fact) => fact.includes("popularity"))) {
    facts.push(`Its ${candidate.title.popularity}/100 popularity signal makes it a less obvious option.`);
  }
  if (lane === "Film School Pick" && !facts.some((fact) => fact.includes("canonical"))) {
    facts.push(`Its aggregated canonical score is ${candidate.title.canonicalScore}/100.`);
  }
  if (requiresPayment) facts.push("It cleared the exceptional paid-match rule; payment is required and clearly labeled.");
  return unique(facts);
}

function titleSimilarity(a: Title, b: Title): number {
  const aFeatures = new Set([
    ...a.genres.map((value) => `genre:${value}`),
    ...a.subgenres.map((value) => `subgenre:${value}`),
    ...a.toneTags.map((value) => `tone:${value}`),
    ...a.themes.map((value) => `theme:${value}`),
    ...a.directors.map((value) => `director:${value}`),
    ...a.writers.map((value) => `writer:${value}`),
    ...a.cinematographers.map((value) => `cinematographer:${value}`),
    ...a.actors.map((value) => `actor:${value}`),
  ]);
  const bFeatures = new Set([
    ...b.genres.map((value) => `genre:${value}`),
    ...b.subgenres.map((value) => `subgenre:${value}`),
    ...b.toneTags.map((value) => `tone:${value}`),
    ...b.themes.map((value) => `theme:${value}`),
    ...b.directors.map((value) => `director:${value}`),
    ...b.writers.map((value) => `writer:${value}`),
    ...b.cinematographers.map((value) => `cinematographer:${value}`),
    ...b.actors.map((value) => `actor:${value}`),
  ]);
  const intersection = [...aFeatures].filter((feature) => bFeatures.has(feature)).length;
  const union = new Set([...aFeatures, ...bFeatures]).size;
  return union ? intersection / union : 0;
}

function runtimeBucket(title: Title): string {
  const minutes = title.contentType === "series" ? title.episodeRuntimeMinutes : title.runtimeMinutes;
  if (!minutes) return "unknown";
  if (minutes <= 35) return "short";
  if (minutes <= 70) return "medium";
  if (minutes <= 120) return "feature";
  return "long";
}

function runtimeBucketArray(title: Title): string[] {
  return [runtimeBucket(title)];
}

function normalizeScore(rawScore: number, config: RecommendationConfig): number {
  return clamp(1 / (1 + Math.exp(-(rawScore - config.normalization.midpoint) / config.normalization.scale)), 0, 1);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
