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
  providerId?: number;
  providerName?: string;
  logoUrl?: string | null;
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

export interface EditorialFeatures {
  primarySubgenre: string;
  secondarySubgenre?: string;
  primaryFamily: string;
  secondaryFamily?: string;
  ontologyVersion: string;
  source: "gold-set";
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
  subgenres: string[];
  toneTags: string[];
  themes: string[];
  pacing: "slow" | "moderate" | "fast";
  editorial?: EditorialFeatures;
  countries: string[];
  languages: string[];
  directors: string[];
  writers: string[];
  cinematographers: string[];
  actors: string[];
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
  | "rewatchOrientation";
