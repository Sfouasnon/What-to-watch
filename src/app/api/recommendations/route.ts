import { NextResponse } from "next/server";
import { z } from "zod";

import {
  defaultRecommendationConfig,
  importTunedConfiguration,
  recommendForProfile,
} from "@/lib/recommendation/engine";
import {
  MOODS,
  VIBES,
  type Mood,
  type Profile,
  type QuestionnaireDimension,
  type Recommendation,
  type RecommendationLane,
  type Title,
  type Vibe,
} from "@/lib/recommendation/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { isTmdbConfigured, tmdb, type TitleSearchResult, type TmdbTitleDetails } from "@/lib/tmdb";
import { tmdbDetailsToDomainTitle } from "@/lib/tmdb/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  profileId: z.string().uuid(),
  moods: z.array(z.enum(MOODS)).max(2).default([]),
  vibes: z.array(z.enum(VIBES)).max(3).default([]),
  region: z.literal("US").default("US"),
});

const moodGenreIds: Record<Mood, { movie: number[]; tv: number[] }> = {
  comedy: { movie: [35], tv: [35] },
  "stand-up": { movie: [35], tv: [35] },
  drama: { movie: [18], tv: [18] },
  thriller: { movie: [53, 80], tv: [9648, 80] },
  action: { movie: [28], tv: [10759] },
  horror: { movie: [27], tv: [9648, 10765] },
};

const questionnaireKeyBySlug: Record<string, QuestionnaireDimension> = {
  cerebral: "cerebral",
  "emotional-intensity": "emotionalIntensity",
  darkness: "darknessTolerance",
  thrill: "thrill",
  imagination: "imagination",
  "comedy-dry": "comedy",
  "comedy-broad": "comedy",
  standup: "standUp",
  character: "characterOrientation",
  realism: "realism",
  ambiguity: "ambiguityTolerance",
  "slow-pace": "slowPacing",
  novelty: "novelty",
  discovery: "discovery",
  "classic-openness": "classicOpenness",
  international: "internationalOpenness",
  horror: "horrorTolerance",
  rewatch: "rewatchOrientation",
  "tv-commitment": "televisionCommitment",
  binge: "bingePreference",
};

const genreNameByQuestionnaireSlug: Record<string, string> = {
  action: "Action",
  adventure: "Adventure",
  animation: "Animation",
  comedy: "Comedy",
  crime: "Crime",
  documentary: "Documentary",
  drama: "Drama",
  family: "Family",
  fantasy: "Fantasy",
  historical: "History",
  horror: "Horror",
  musical: "Music",
  mystery: "Mystery",
  romance: "Romance",
  "science-fiction": "Science Fiction",
  thriller: "Thriller",
  war: "War",
  western: "Western",
  "dark-comedy": "Dark Comedy",
  satire: "Satire",
  "stand-up": "Stand-Up",
};

const recommendationTypeByLane: Record<RecommendationLane, string> = {
  "Best Bet": "best_bet",
  "Close Second": "close_second",
  "Right Mood": "right_mood",
  "Creator Match": "creator_match",
  "Something Different": "something_different",
  "Hidden Gem": "hidden_gem",
  "Go Deeper": "go_deeper",
  "Film School Pick": "film_school_pick",
  "Left Field": "left_field",
  "Wild Card": "wild_card",
};

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function candidatePriority(result: TitleSearchResult, sourceWeight: number) {
  return sourceWeight * 10_000 + result.voteCount * 0.05 + result.popularity + (result.voteAverage ?? 0) * 10;
}

function addCandidates(
  pool: Map<string, { result: TitleSearchResult; priority: number }>,
  candidates: readonly TitleSearchResult[],
  sourceWeight: number,
) {
  for (const result of candidates) {
    const priority = candidatePriority(result, sourceWeight);
    const existing = pool.get(result.externalId);
    if (existing) existing.priority += sourceWeight * 1_000;
    else pool.set(result.externalId, { result, priority });
  }
}

async function titleDetails(
  mediaType: "movie" | "tv",
  id: number,
  region: "US",
): Promise<TmdbTitleDetails | null> {
  try {
    return await tmdb.getTitleDetails(mediaType, id, region);
  } catch {
    return null;
  }
}

function tmdbIdentity(externalId: string) {
  const match = /^tmdb:(movie|tv):(\d+)$/.exec(externalId);
  if (!match) return null;
  return { mediaType: match[1] as "movie" | "tv", id: Number.parseInt(match[2], 10) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function questionnaireGenreScores(value: Json | undefined): Record<string, number> {
  if (!isRecord(value) || !isRecord(value.scores)) return {};
  const result: Record<string, number> = {};
  for (const [slug, rawScore] of Object.entries(value.scores)) {
    const genre = genreNameByQuestionnaireSlug[slug];
    if (!genre || typeof rawScore !== "number" || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100) continue;
    result[genre] = 1 + rawScore * 0.06;
  }
  return result;
}

function persistedItemIds(value: Json) {
  if (!isRecord(value) || !Array.isArray(value.items)) return new Map<string, string>();
  return new Map(value.items.flatMap((item) => {
    if (!isRecord(item) || typeof item.tmdbId !== "number" ||
        (item.mediaType !== "movie" && item.mediaType !== "tv") ||
        typeof item.recommendationItemId !== "string") return [];
    return [[`tmdb:${item.mediaType}:${item.tmdbId}`, item.recommendationItemId] as const];
  }));
}

export async function POST(request: Request) {
  if (!isTmdbConfigured()) {
    return NextResponse.json(
      { error: { code: "TMDB_NOT_CONFIGURED", message: "Live recommendations are not configured." } },
      { status: 503 },
    );
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_RECOMMENDATION_REQUEST", message: "Choose a valid profile, mood, and vibe." } },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: { code: "SUPABASE_NOT_CONFIGURED", message: "Cloud recommendations are not configured." } },
      { status: 503 },
    );
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json(
      { error: { code: "AUTH_REQUIRED", message: "Sign in before requesting live recommendations." } },
      { status: 401 },
    );
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", parsed.data.profileId)
    .eq("account_id", authData.user.id)
    .single();
  if (profileError || !profileRow) {
    return NextResponse.json(
      { error: { code: "PROFILE_NOT_FOUND", message: "That profile is not available to this account." } },
      { status: 404 },
    );
  }

  const [
    settingsResult,
    serviceLinksResult,
    servicesResult,
    ratingsResult,
    dimensionsResult,
    latestQuestionnaireResult,
  ] = await Promise.all([
    supabase.from("profile_settings").select("*").eq("profile_id", profileRow.id).maybeSingle(),
    supabase.from("profile_streaming_services").select("*").eq("profile_id", profileRow.id),
    supabase.from("streaming_services").select("id, slug").eq("active", true),
    supabase.from("ratings").select("*").eq("profile_id", profileRow.id).order("score", { ascending: false }),
    supabase.from("profile_dimensions").select("*").eq("profile_id", profileRow.id),
    supabase.from("questionnaire_sessions")
      .select("id, questionnaire_version_id, completed_at")
      .eq("profile_id", profileRow.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const readError = settingsResult.error ?? serviceLinksResult.error ?? servicesResult.error ??
    ratingsResult.error ?? dimensionsResult.error ?? latestQuestionnaireResult.error;
  if (readError) {
    return NextResponse.json(
      { error: { code: "PROFILE_READ_FAILED", message: "The profile could not be loaded safely." } },
      { status: 500 },
    );
  }

  const ratingRows = ratingsResult.data ?? [];
  const titleIds = unique(ratingRows.map((rating) => rating.title_id));
  const titlesResult = titleIds.length
    ? await supabase.from("titles").select("id, tmdb_id, tmdb_media_type").in("id", titleIds)
    : { data: [], error: null };
  if (titlesResult.error) {
    return NextResponse.json(
      { error: { code: "RATING_READ_FAILED", message: "Saved ratings could not be loaded." } },
      { status: 500 },
    );
  }

  const titleIdentityById = new Map((titlesResult.data ?? []).flatMap((title) =>
    title.tmdb_id && title.tmdb_media_type
      ? [[title.id, { providerId: title.tmdb_id, mediaType: title.tmdb_media_type }] as const]
      : [],
  ));
  const rankedRatingIdentities = ratingRows.flatMap((rating) => {
    const identity = titleIdentityById.get(rating.title_id);
    return identity ? [{ ...identity, rating }] : [];
  });
  const ratedDetailResults = await Promise.all(
    rankedRatingIdentities.slice(0, 50).map(({ mediaType, providerId }) =>
      titleDetails(mediaType, providerId, parsed.data.region)),
  );
  const detailByExternalId = new Map(ratedDetailResults.flatMap((details) =>
    details ? [[details.externalId, details] as const] : [],
  ));
  const ratedTitles = [...detailByExternalId.values()].map(tmdbDetailsToDomainTitle);

  const serviceSlugById = new Map((servicesResult.data ?? []).map((service) => [service.id, service.slug]));
  const subscriptions = (serviceLinksResult.data ?? []).flatMap((link) => {
    const slug = serviceSlugById.get(link.service_id);
    return slug ? [slug] : [];
  });

  const dimensionIds = unique((dimensionsResult.data ?? []).map((row) => row.dimension_id));
  const dimensionCatalogResult = dimensionIds.length
    ? await supabase.from("questionnaire_dimensions").select("id, slug").in("id", dimensionIds)
    : { data: [], error: null };
  if (dimensionCatalogResult.error) {
    return NextResponse.json(
      { error: { code: "QUESTIONNAIRE_READ_FAILED", message: "Questionnaire evidence could not be loaded." } },
      { status: 500 },
    );
  }
  const dimensionSlugById = new Map((dimensionCatalogResult.data ?? []).map((row) => [row.id, row.slug]));
  const dimensionScores: Partial<Record<QuestionnaireDimension, number>> = {};
  for (const row of dimensionsResult.data ?? []) {
    const key = questionnaireKeyBySlug[dimensionSlugById.get(row.dimension_id) ?? ""];
    if (key && row.effective_value !== null) dimensionScores[key] = row.effective_value;
  }

  let genreScores: Record<string, number> = {};
  const latestQuestionnaire = latestQuestionnaireResult.data;
  if (latestQuestionnaire) {
    const { data: genreQuestion, error: genreQuestionError } = await supabase
      .from("questionnaire_questions")
      .select("id")
      .eq("questionnaire_version_id", latestQuestionnaire.questionnaire_version_id)
      .eq("code", "genre_preferences")
      .maybeSingle();
    if (genreQuestionError) {
      return NextResponse.json(
        { error: { code: "QUESTIONNAIRE_READ_FAILED", message: "Questionnaire evidence could not be loaded." } },
        { status: 500 },
      );
    }
    if (genreQuestion) {
      const { data: genreResponse, error: genreResponseError } = await supabase
        .from("questionnaire_responses")
        .select("response")
        .eq("profile_id", profileRow.id)
        .eq("session_id", latestQuestionnaire.id)
        .eq("question_id", genreQuestion.id)
        .maybeSingle();
      if (genreResponseError) {
        return NextResponse.json(
          { error: { code: "QUESTIONNAIRE_READ_FAILED", message: "Questionnaire evidence could not be loaded." } },
          { status: 500 },
        );
      }
      genreScores = questionnaireGenreScores(genreResponse?.response);
    }
  }

  let config = defaultRecommendationConfig;
  if (profileRow.current_model_version_id) {
    const { data: version } = await supabase.from("model_versions")
      .select("config_id").eq("id", profileRow.current_model_version_id).maybeSingle();
    if (version) {
      const { data: modelConfig } = await supabase.from("model_configs")
        .select("configuration").eq("id", version.config_id).maybeSingle();
      if (modelConfig) config = importTunedConfiguration(modelConfig.configuration);
    }
  }

  const profile: Profile = {
    id: profileRow.id,
    accountId: profileRow.account_id,
    displayName: profileRow.display_name,
    avatar: profileRow.avatar_key ?? profileRow.display_name.slice(0, 1),
    createdAt: profileRow.created_at,
    onboardingCompleted: profileRow.onboarding_completed,
    guest: false,
    region: "US",
    modelVersion: config.modelVersion,
    subscriptions,
    rentalMode: settingsResult.data?.rental_policy ?? "exceptional",
    allowAdSupported: settingsResult.data?.allow_free_with_ads ?? true,
    ratings: rankedRatingIdentities.map(({ mediaType, providerId, rating }) => ({
      titleId: `tmdb:${mediaType}:${providerId}`,
      score: rating.score,
      watched: rating.watched_state === "watched",
      ratedAt: rating.rated_at,
      rewatchCount: rating.rewatch_count,
      source: (rating.source_context === "onboarding" || rating.source_context === "recommendation" ||
        rating.source_context === "import") ? rating.source_context : "search",
    })),
    questionnaire: {
      completedAt: latestQuestionnaire?.completed_at ?? undefined,
      dimensionScores,
      genreScores,
    },
    favoritePeople: { actors: [], directors: [], writers: [], cinematographers: [] },
  };

  const candidatePool = new Map<string, { result: TitleSearchResult; priority: number }>();
  const seedRatings = rankedRatingIdentities.filter(({ rating }) => rating.score >= 7).slice(0, 6);
  const seedRequests = seedRatings.map(({ mediaType, providerId }) =>
    tmdb.getRecommendations(mediaType, providerId));
  const likedGenreIds = unique(seedRatings.flatMap(({ mediaType, providerId }) =>
    detailByExternalId.get(`tmdb:${mediaType}:${providerId}`)?.genres.map((genre) => genre.id) ?? [],
  ));
  const requestedMovieGenres = unique([
    ...likedGenreIds,
    ...parsed.data.moods.flatMap((mood) => moodGenreIds[mood].movie),
  ]);
  const requestedTvGenres = unique([
    ...likedGenreIds,
    ...parsed.data.moods.flatMap((mood) => moodGenreIds[mood].tv),
  ]);
  const discoveryRequests = [
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
      const sourceWeight = index < seedRequests.length ? 4 : index < seedRequests.length + discoveryRequests.length ? 3 : 1;
      addCandidates(candidatePool, result.value, sourceWeight);
    }
  });

  const ratedIds = new Set(profile.ratings.map((rating) => rating.titleId));
  const candidateStubs = [...candidatePool.values()]
    .filter(({ result }) => !ratedIds.has(result.externalId))
    .sort((a, b) => b.priority - a.priority || a.result.externalId.localeCompare(b.result.externalId))
    .slice(0, 80)
    .map(({ result }) => result);
  const candidateDetails: Array<TmdbTitleDetails | null> = [];
  for (let offset = 0; offset < candidateStubs.length; offset += 20) {
    const batch = candidateStubs.slice(offset, offset + 20);
    const details = await Promise.all(batch.map(async (candidate) => {
      const identity = tmdbIdentity(candidate.externalId);
      return identity ? titleDetails(identity.mediaType, identity.id, parsed.data.region) : null;
    }));
    candidateDetails.push(...details);
  }
  const candidateTitles = candidateDetails.flatMap((details) =>
    details ? [tmdbDetailsToDomainTitle(details)] : [],
  );
  const catalog: Title[] = [...ratedTitles, ...candidateTitles];

  const recommendations = recommendForProfile({
    profile,
    catalog,
    moods: parsed.data.moods as Mood[],
    vibes: parsed.data.vibes as Vibe[],
    config,
    limit: 10,
  });
  if (!recommendations.length) {
    return NextResponse.json(
      { error: { code: "NO_AVAILABLE_MATCHES", message: "No current US offers matched this profile. Try another mood, vibe, or subscription." } },
      { status: 422 },
    );
  }

  const rankedItems: Json[] = recommendations.map((recommendation) => {
    const identity = tmdbIdentity(recommendation.title.id);
    if (!identity) throw new Error("Recommendation lost its TMDB identity.");
    const availabilityClass = recommendation.primaryAvailability.kind === "free"
      ? "free_ad_supported"
      : recommendation.primaryAvailability.kind === "rental"
        ? "rent"
        : recommendation.primaryAvailability.kind === "purchase"
          ? "buy"
          : "subscription";
    return {
      tmdbId: identity.id,
      mediaType: identity.mediaType,
      recommendationType: recommendationTypeByLane[recommendation.lane],
      rank: recommendation.rank,
      rawScore: recommendation.rawScore,
      matchScore: recommendation.matchScore,
      availabilityClass,
      explanation: recommendation.explanation,
      featureContributions: recommendation.contributions.map((contribution) => ({
        feature: contribution.feature,
        value: contribution.value,
        evidence: contribution.evidence ?? null,
      })),
    };
  });
  const { data: persisted, error: persistError } = await supabase.rpc("save_profile_recommendation", {
    target_profile_id: profile.id,
    recommendation_moods: parsed.data.moods,
    recommendation_vibes: parsed.data.vibes,
    ranked_items: rankedItems,
  });
  if (persistError || !persisted) {
    return NextResponse.json(
      { error: { code: "RECOMMENDATION_SAVE_FAILED", message: "The ranked result could not be saved to this profile." } },
      { status: 500 },
    );
  }
  const itemIds = persistedItemIds(persisted);
  const responseRecommendations = recommendations.map((recommendation: Recommendation) => ({
    ...recommendation,
    recommendationItemId: itemIds.get(recommendation.title.id),
  }));

  return NextResponse.json(
    { recommendations: responseRecommendations },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
