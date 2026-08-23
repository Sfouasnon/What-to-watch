export const CONTENT_TYPES = ["movie", "series", "stand-up"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const MOODS = ["comedy", "stand-up", "drama", "thriller", "action", "horror"] as const;
export type Mood = (typeof MOODS)[number];

export const VIBES = [
  "rewatch-favorite",
  "rediscover-classic",
  "try-something-new",
  "popular-international",
  "bingeable-tv",
  "trending-series",
  "hidden-gem",
  "surprise-me",
  "complete-director",
  "criterion-pick",
  "film-school-night",
  "blind-spot",
  "go-deeper",
  "friends-picks",
] as const;
export type Vibe = (typeof VIBES)[number];

export type RentalMode = "never" | "exceptional" | "always";
export type AvailabilityKind = "subscription" | "free" | "rental" | "purchase";
export const RECOMMENDATION_LANES = [
  "Best Bet",
  "Close Second",
  "Right Mood",
  "Creator Match",
  "Something Different",
  "Hidden Gem",
  "Go Deeper",
  "Film School Pick",
  "Left Field",
  "Wild Card",
] as const;
export type RecommendationLane = (typeof RECOMMENDATION_LANES)[number];

export interface StreamingService {
  id: string;
  name: string;
  shortName: string;
  kind: "subscription" | "free" | "marketplace";
  color: string;
}

export interface AvailabilityOption {
  serviceId: string;
  region: string;
  kind: AvailabilityKind;
  checkedAt: string;
  source: "demo" | "tmdb" | "watchmode" | "manual";
  price?: number;
  currency?: string;
  deepLink?: string;
}

export interface CanonicalMembership {
  list: string;
  source: string;
  version: string;
  position?: number;
}

export interface CastReferenceCredit {
  externalId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  name: string;
  year: number;
  character?: string | null;
  billingOrder?: number | null;
  popularity: number;
  voteCount: number;
}

export interface CastContextPerson {
  tmdbPersonId: number;
  name: string;
  character?: string | null;
  billingOrder: number;
  references: CastReferenceCredit[];
}

export interface Title {
  id: string;
  name: string;
  year: number;
  contentType: ContentType;
  synopsis: string;
  runtimeMinutes?: number;
  episodeRuntimeMinutes?: number;
  seasons?: number;
  completed?: boolean;
  serialized?: boolean;
  genres: string[];
  primarySubgenre?: string;
  secondarySubgenre?: string;
  subgenres: string[];
  toneTags: string[];
  themes: string[];
  pacing: "slow" | "moderate" | "fast";
  countries: string[];
  languages: string[];
  directors: string[];
  writers: string[];
  cinematographers: string[];
  actors: string[];
  castContext?: CastContextPerson[];
  canonicalScore: number;
  canonicalMemberships: CanonicalMembership[];
  criterionCollection: boolean;
  criterionEdition?: string;
  popularity: number;
  trendingScore: number;
  availability: AvailabilityOption[];
  posterUrl?: string;
  backdropUrl?: string;
}

export interface Rating {
  titleId: string;
  score: number;
  watched: boolean;
  ratedAt: string;
  lastWatchedAt?: string;
  rewatchCount?: number;
  source?: "onboarding" | "search" | "recommendation" | "import";
}

export type QuestionnaireDimension =
  | "cerebral"
  | "emotionalIntensity"
  | "darknessTolerance"
  | "thrill"
  | "imagination"
  | "comedy"
  | "dryComedy"
  | "darkComedy"
  | "broadComedy"
  | "standUp"
  | "characterOrientation"
  | "realism"
  | "ambiguityTolerance"
  | "slowPacing"
  | "novelty"
  | "discovery"
  | "classicOpenness"
  | "internationalOpenness"
  | "horrorTolerance"
  | "psychologicalHorror"
  | "goreTolerance"
  | "rewatchOrientation"
  | "televisionCommitment"
  | "bingePreference";

export type QuestionnaireKind = "agreement" | "forced-choice" | "genre-matrix";

export interface QuestionnaireQuestion {
  id: string;
  kind: QuestionnaireKind;
  prompt: string;
  dimension?: QuestionnaireDimension;
  reverse?: boolean;
  choices?: Array<{
    id: string;
    label: string;
    signals: Partial<Record<QuestionnaireDimension, number>>;
  }>;
  genres?: string[];
}

export interface QuestionnaireProfile {
  completedAt?: string;
  dimensionScores: Partial<Record<QuestionnaireDimension, number>>;
  genreScores: Record<string, number>;
  tradeoffScores?: Partial<Record<"pace" | "release" | "familiarity", number>>;
}

export interface FavoritePeople {
  actors: string[];
  directors: string[];
  writers: string[];
  cinematographers: string[];
}

export interface Profile {
  id: string;
  accountId: string;
  displayName: string;
  avatar: string;
  createdAt: string;
  onboardingCompleted: boolean;
  guest: boolean;
  region: string;
  modelVersion: string;
  subscriptions: string[];
  rentalMode: RentalMode;
  allowAdSupported: boolean;
  ratings: Rating[];
  questionnaire?: QuestionnaireProfile;
  favoritePeople: FavoritePeople;
}

export type RecommendationFeedbackReason =
  | "already-seen"
  | "not-interested"
  | "wrong-mood"
  | "too-dark"
  | "too-light"
  | "too-old"
  | "too-long"
  | "disliked-actor"
  | "misclassified"
  | "not-available"
  | "good-wrong-night";

export interface RecommendationFeedback {
  profileId: string;
  titleId: string;
  modelVersion: string;
  recommendationScore?: number;
  reason?: RecommendationFeedbackReason;
  context?: {
    moods?: Mood[];
    vibes?: Vibe[];
  };
  createdAt: string;
}

export interface RecommendationWeights {
  directorAffinity: number;
  actorAffinity: number;
  writerAffinity: number;
  cinematographerAffinity: number;
  genreMatch: number;
  questionnaireMatch: number;
  tradeoffMatch: number;
  feedbackMatch: number;
  subgenreMatch: number;
  moodMatch: number;
  vibeMatch: number;
  decadeAffinity: number;
  countryAffinity: number;
  languageAffinity: number;
  runtimeAffinity: number;
  canonicalScore: number;
  criterionBonus: number;
  popularitySignal: number;
  noveltyBonus: number;
  explorationBonus: number;
  dislikedSimilarityPenalty: number;
  availabilityPreference: number;
}

export interface RecommendationThresholds {
  stronglyLikedRating: number;
  stronglyDislikedRating: number;
  creatorMinimumEvidence: number;
  rentalExceptionalMargin: number;
  rentalExceptionalAbsoluteScore: number;
  canonicalMinimum: number;
  trendingMinimum: number;
  maxRecommendations: number;
}

export interface QuestionnaireDecayConfig {
  initialWeight: number;
  minimumWeight: number;
  decayRatings: number;
  behavioralEvidenceScale: number;
}

export interface RecommendationConfig {
  schemaVersion: 1;
  modelVersion: string;
  weights: RecommendationWeights;
  thresholds: RecommendationThresholds;
  exploration: Record<RecommendationLane, number>;
  questionnaireDecay: QuestionnaireDecayConfig;
  normalization: {
    midpoint: number;
    scale: number;
    minimumDisplayMatch: number;
    maximumDisplayMatch: number;
  };
}

export interface FeatureContribution {
  feature: string;
  value: number;
  evidence?: string;
}

export interface RecommendationNarrative {
  header: string;
  heading: string;
  fit: string;
  cast?: string;
  setup: string;
}

export type PersonMatchKind = "exact" | "inspired";

export interface PersonMatchProvenance {
  kind: PersonMatchKind;
  person: string;
  role: "actor" | "director";
  note?: string;
}

export interface Recommendation {
  rank: number;
  lane: RecommendationLane;
  title: Title;
  rawScore: number;
  normalizedScore: number;
  matchScore: number;
  explanation: string;
  narrative: RecommendationNarrative;
  evidence: string[];
  contributions: FeatureContribution[];
  availability: AvailabilityOption[];
  primaryAvailability: AvailabilityOption;
  requiresPayment: boolean;
  modelVersion: string;
  friendContext?: FriendContext;
  /** Present when a person-led lane distinguishes credited matches from inspired picks. */
  personMatch?: PersonMatchProvenance;
}

export type FriendShareMode = "ratings_and_reviews" | "ratings_only" | "nothing";

export interface FriendProfileSnapshot {
  profileId: string;
  displayName: string;
  ratings: Rating[];
  shareWithFriends: FriendShareMode;
}

export interface FriendshipSignal {
  requesterProfileId: string;
  addresseeProfileId: string;
  status: "pending" | "accepted" | "declined";
}

export interface FriendReviewSignal {
  authorProfileId: string;
  titleId: string;
  note: string;
  createdAt: string;
}

export interface ExplicitFriendRecommendation {
  senderProfileId: string;
  recipientProfileId: string;
  titleId: string;
  note?: string;
  createdAt: string;
}

export interface SocialRecommendationInput {
  friendProfiles: FriendProfileSnapshot[];
  friendships: FriendshipSignal[];
  reviews: FriendReviewSignal[];
  recommendations: ExplicitFriendRecommendation[];
  now?: string;
}

export interface FriendContext {
  headline: string;
  note?: string;
  rating?: number;
  friendCount: number;
  averageRating?: number;
  explicit: boolean;
}

export interface RecommendForProfileInput {
  profile: Profile;
  catalog: readonly Title[];
  moods?: readonly Mood[];
  vibes?: readonly Vibe[];
  lane?: RecommendationLane;
  config?: RecommendationConfig;
  limit?: number;
  excludeTitleIds?: readonly string[];
  social?: SocialRecommendationInput;
  feedback?: readonly RecommendationFeedback[];
}

export interface PreferenceBlendInput {
  behavioralPreference?: number;
  behavioralEvidence?: number;
  questionnairePreference?: number;
  ratingCount: number;
  config?: QuestionnaireDecayConfig;
}
