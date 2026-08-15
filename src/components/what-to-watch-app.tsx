"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Compass,
  Download,
  Film,
  Home,
  Info,
  Library,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Mic2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Tv,
  Upload,
  UserCheck,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  defaultRecommendationConfig,
  importTunedConfiguration,
  recommendForProfile,
} from "@/lib/recommendation/engine";
import {
  actorOptionsForSubscriptions,
  filterTitlesForFavoriteActors,
  hasProminentActor,
} from "@/lib/recommendation/actor-discovery";
import { mapQuestionnaireAnswers } from "@/lib/recommendation/intake";
import {
  ANSWER_LABELS,
  buildStartingTasteSummary,
  conditionalQuestions,
  CORE_QUESTIONS,
  GENRE_LABELS,
  GENRE_RATING_LABELS,
  GENRES,
  selectCalibrationTitle,
} from "@/lib/recommendation/onboarding";
import type {
  CastContextPerson as EngineCastContextPerson,
  FriendContext as EngineFriendContext,
  Mood as EngineMood,
  RecommendationConfig,
  RecommendationFeedbackReason,
  RecommendationNarrative,
  RecommendationWeights,
  SocialRecommendationInput,
  Title as EngineTitle,
  Vibe as EngineVibe,
} from "@/lib/recommendation/types";

import { ProviderSelector } from "./provider-selector";

type Screen = "home" | "actor" | "results" | "rate" | "taste" | "settings";
type ContentKind = "Movie" | "Series" | "Stand-up";
type AvailabilityType = "subscription" | "free" | "rental";
type RentalMode = "never" | "exceptional" | "always";
type ShareMode = "ratings_and_reviews" | "ratings_only" | "nothing";
type FriendshipStatus = "pending" | "accepted" | "declined" | "blocked";

type ModelWeights = RecommendationWeights;

type Title = {
  id: string;
  name: string;
  year: number;
  kind: ContentKind;
  runtime: string;
  poster: string;
  backdrop: string;
  synopsis: string;
  genres: string[];
  tags: string[];
  primarySubgenre?: string;
  secondarySubgenre?: string;
  toneTags?: string[];
  pacing?: "slow" | "moderate" | "fast";
  director: string;
  writers: string[];
  cinematographer?: string;
  cast: string[];
  castContext?: EngineCastContextPerson[];
  providers: string[];
  availabilityType: AvailabilityType;
  criterion?: boolean;
  canonical?: string[];
  popularity: number;
  baseline: number;
};

type ViewerProfile = {
  id: string;
  name: string;
  avatar: string;
  color: string;
  guest: boolean;
  onboardingCompleted: boolean;
  region: string;
  subscriptions: string[];
  favoriteActors: string[];
  ratings: Record<string, number>;
  questionnaire: Record<string, number>;
  rentalMode: RentalMode;
  modelVersion: number;
  weights?: Partial<ModelWeights>;
  shareWithFriends: ShareMode;
};

type FriendProfile = {
  id: string;
  name: string;
  avatar: string;
  color: string;
  ratings: Record<string, number>;
  ratingDates: Record<string, string>;
  sharing: ShareMode;
};

type Friendship = {
  id: string;
  requesterProfileId: string;
  addresseeProfileId: string;
  status: FriendshipStatus;
  createdAt: string;
  respondedAt?: string;
};

type FriendReviewNote = {
  id: string;
  authorProfileId: string;
  titleId: string;
  rating: number;
  note: string;
  createdAt: string;
};

type FriendRecommendation = {
  id: string;
  senderProfileId: string;
  recipientProfileId: string;
  titleId: string;
  note?: string;
  createdAt: string;
};

type FriendContext = {
  headline: string;
  note?: string;
  rating?: number;
  friendCount: number;
  averageRating?: number;
  explicit: boolean;
};

type Recommendation = {
  rank: number;
  lane: string;
  title: Title;
  match: number;
  explanation: string;
  narrative: RecommendationNarrative;
  rental: boolean;
  friendContext?: FriendContext;
};

type FeedbackEvent = {
  id: string;
  profileId: string;
  titleId: string;
  reason?: RecommendationFeedbackReason | string;
  recommendationScore?: number;
  moods?: string[];
  vibe?: string;
  createdAt: string;
};

type AppStore = {
  profiles: ViewerProfile[];
  feedback: FeedbackEvent[];
  friendProfiles: FriendProfile[];
  friendships: Friendship[];
  friendReviews: FriendReviewNote[];
  friendRecommendations: FriendRecommendation[];
};

const STORAGE_KEY = "what-to-watch:v4";

const DEFAULT_WEIGHTS: ModelWeights = defaultRecommendationConfig.weights;

const moods: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "Comedy", label: "Comedy", icon: Sparkles },
  { id: "Stand-up", label: "Stand-up", icon: Mic2 },
  { id: "Drama", label: "Drama", icon: Film },
  { id: "Thriller", label: "Thriller", icon: Compass },
  { id: "Action", label: "Action", icon: Play },
  { id: "Horror", label: "Horror", icon: Bookmark },
];

const vibes = [
  { id: "Favorite", label: "A familiar favorite", eyebrow: "REWATCH" },
  { id: "Classic", label: "Rediscover a classic", eyebrow: "CANON" },
  { id: "New", label: "Try something new", eyebrow: "DISCOVER" },
  { id: "International", label: "Cinema beyond home", eyebrow: "WORLD" },
  { id: "Binge", label: "Settle in for a series", eyebrow: "BINGE" },
  { id: "Trending", label: "Something in the moment", eyebrow: "NOW" },
  { id: "Hidden", label: "Find a hidden gem", eyebrow: "DEEP CUT" },
  { id: "Director", label: "Complete a director", eyebrow: "AUTEUR" },
  { id: "Criterion", label: "Choose a Criterion pick", eyebrow: "COLLECTION" },
  { id: "FilmSchool", label: "Have a film-school night", eyebrow: "CANON" },
  { id: "BlindSpot", label: "Fill a cinematic blind spot", eyebrow: "CATCH UP" },
  { id: "Deeper", label: "Go deeper on my taste", eyebrow: "AFFINITY" },
  { id: "Friends", label: "Friend’s Picks", eyebrow: "TRUSTED TASTE" },
  { id: "Surprise", label: "Surprise me", eyebrow: "NO RULES" },
];

const fallbackCatalog: Title[] = [
  {
    id: "prisoners",
    name: "Prisoners",
    year: 2013,
    kind: "Movie",
    runtime: "2h 33m",
    poster: "https://image.tmdb.org/t/p/w780/tuZhZ6biFMr5n9YSVuHOJnNL1uU.jpg",
    backdrop: "https://image.tmdb.org/t/p/w780/tuZhZ6biFMr5n9YSVuHOJnNL1uU.jpg",
    synopsis:
      "When two young girls vanish, a desperate father takes matters into his own hands while a detective follows the case's smallest clues.",
    genres: ["Thriller", "Drama", "Crime"],
    tags: ["dark", "slow-burn", "investigative", "moral ambiguity"],
    director: "Denis Villeneuve",
    writers: ["Aaron Guzikowski"],
    cinematographer: "Roger Deakins",
    cast: ["Hugh Jackman", "Jake Gyllenhaal", "Viola Davis"],
    providers: ["Netflix"],
    availabilityType: "subscription",
    popularity: 82,
    baseline: 92,
  },
  {
    id: "handmaiden",
    name: "The Handmaiden",
    year: 2016,
    kind: "Movie",
    runtime: "2h 25m",
    poster: "https://image.tmdb.org/t/p/w780/dLlH4aNHdnmf62umnInL8xPlPzw.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/keEWjA5ykLJo851tIBFdmkxPxxh.jpg",
    synopsis:
      "A pickpocket enters a wealthy household as a handmaiden, only to become entangled in a layered game of desire, deception, and liberation.",
    genres: ["Drama", "Thriller", "Romance"],
    tags: ["international", "twisty", "sensual", "meticulous"],
    director: "Park Chan-wook",
    writers: ["Park Chan-wook", "Chung Seo-kyung"],
    cinematographer: "Chung Chung-hoon",
    cast: ["Kim Min-hee", "Kim Tae-ri", "Ha Jung-woo"],
    providers: ["Prime Video"],
    availabilityType: "rental",
    criterion: true,
    canonical: ["Modern World Cinema"],
    popularity: 70,
    baseline: 95,
  },
  {
    id: "conversation",
    name: "The Conversation",
    year: 1974,
    kind: "Movie",
    runtime: "1h 53m",
    poster: "https://image.tmdb.org/t/p/w780/dHqVBwcv1SGymOpUueRoKzcmdes.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/a35QCr4ajEOjxd57KZybNzDP7L2.jpg",
    synopsis:
      "A surveillance expert becomes consumed by the possibility that a recording he made could lead to murder.",
    genres: ["Thriller", "Drama", "Mystery"],
    tags: ["classic", "paranoia", "slow-burn", "character study"],
    director: "Francis Ford Coppola",
    writers: ["Francis Ford Coppola"],
    cinematographer: "Bill Butler",
    cast: ["Gene Hackman", "John Cazale", "Harrison Ford"],
    providers: ["Criterion Channel"],
    availabilityType: "subscription",
    criterion: true,
    canonical: ["Palme d'Or winners", "1970s American cinema"],
    popularity: 55,
    baseline: 90,
  },
  {
    id: "burning",
    name: "Burning",
    year: 2018,
    kind: "Movie",
    runtime: "2h 28m",
    poster: "https://image.tmdb.org/t/p/w780/AlKlezuaJkP2lDEWbJxYv47GeDf.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/rENYZSx6HFME7YLbbY0qGYayL7F.jpg",
    synopsis:
      "A drifting young man reconnects with a childhood acquaintance and meets the enigmatic stranger who unsettles their fragile bond.",
    genres: ["Drama", "Thriller", "Mystery"],
    tags: ["international", "ambiguous", "slow-burn", "psychological"],
    director: "Lee Chang-dong",
    writers: ["Lee Chang-dong", "Oh Jung-mi"],
    cinematographer: "Hong Kyung-pyo",
    cast: ["Yoo Ah-in", "Steven Yeun", "Jeon Jong-seo"],
    providers: ["Netflix"],
    availabilityType: "subscription",
    canonical: ["21st Century Critics' Picks"],
    popularity: 63,
    baseline: 91,
  },
  {
    id: "arrival",
    name: "Arrival",
    year: 2016,
    kind: "Movie",
    runtime: "1h 56m",
    poster: "https://image.tmdb.org/t/p/w780/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg",
    backdrop: "https://image.tmdb.org/t/p/w780/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg",
    synopsis:
      "A linguist works to understand mysterious visitors whose arrival could either unite humanity or bring it to the brink.",
    genres: ["Drama", "Science Fiction", "Mystery"],
    tags: ["cerebral", "emotional", "nonlinear", "imaginative"],
    director: "Denis Villeneuve",
    writers: ["Eric Heisserer"],
    cinematographer: "Bradford Young",
    cast: ["Amy Adams", "Jeremy Renner", "Forest Whitaker"],
    providers: ["Paramount+"],
    availabilityType: "subscription",
    popularity: 88,
    baseline: 94,
  },
  {
    id: "perfect-days",
    name: "Perfect Days",
    year: 2023,
    kind: "Movie",
    runtime: "2h 4m",
    poster: "https://image.tmdb.org/t/p/w780/mjEk5Wwx6TYVqw29zSaUHclMIgp.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/fGe1ej335XbqN1j9teoDpofpbLX.jpg",
    synopsis:
      "A quiet man in Tokyo finds beauty in routine, music, books, trees, and brief encounters that reveal the depth of his inner life.",
    genres: ["Drama"],
    tags: ["gentle", "international", "meditative", "character study"],
    director: "Wim Wenders",
    writers: ["Wim Wenders", "Takuma Takasaki"],
    cinematographer: "Franz Lustig",
    cast: ["Kōji Yakusho", "Tokio Emoto", "Arisa Nakano"],
    providers: ["Hulu"],
    availabilityType: "subscription",
    criterion: true,
    popularity: 66,
    baseline: 88,
  },
  {
    id: "after-yang",
    name: "After Yang",
    year: 2021,
    kind: "Movie",
    runtime: "1h 36m",
    poster: "https://image.tmdb.org/t/p/w780/qjEuDeKOhA7JqaaqhLSfoS9titb.jpg",
    backdrop: "https://image.tmdb.org/t/p/w780/qjEuDeKOhA7JqaaqhLSfoS9titb.jpg",
    synopsis:
      "When his daughter's beloved android companion stops functioning, a father discovers a life quietly recorded in fragments.",
    genres: ["Drama", "Science Fiction"],
    tags: ["gentle", "cerebral", "emotional", "hidden gem"],
    director: "Kogonada",
    writers: ["Kogonada"],
    cinematographer: "Benjamin Loeb",
    cast: ["Colin Farrell", "Jodie Turner-Smith", "Justin H. Min"],
    providers: ["Apple TV+"],
    availabilityType: "rental",
    popularity: 46,
    baseline: 87,
  },
  {
    id: "blackberry",
    name: "BlackBerry",
    year: 2023,
    kind: "Movie",
    runtime: "2h",
    poster: "https://image.tmdb.org/t/p/w780/neV35lK7em4rIY9QIoH1cruErPA.jpg",
    backdrop: "https://image.tmdb.org/t/p/w780/neV35lK7em4rIY9QIoH1cruErPA.jpg",
    synopsis:
      "The spectacular rise and chaotic fall of the first smartphone is retold as a sharp, restless workplace tragedy.",
    genres: ["Comedy", "Drama", "History"],
    tags: ["dark comedy", "fast", "character study", "based on true events"],
    director: "Matt Johnson",
    writers: ["Matt Johnson", "Matthew Miller"],
    cinematographer: "Jared Raab",
    cast: ["Jay Baruchel", "Glenn Howerton", "Matt Johnson"],
    providers: ["Hulu"],
    availabilityType: "subscription",
    popularity: 58,
    baseline: 86,
  },
  {
    id: "inside",
    name: "Bo Burnham: Inside",
    year: 2021,
    kind: "Stand-up",
    runtime: "1h 27m",
    poster: "https://image.tmdb.org/t/p/w780/ku1UvTWYvhFQbSesOD6zteY7bXT.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/8rft8A9nH43IReybFtYt21ezfMK.jpg",
    synopsis:
      "Written, filmed, and performed in one room, a comedy special becomes an inventive record of isolation, performance, and attention.",
    genres: ["Stand-up"],
    tags: ["musical", "dark", "meta", "satire"],
    director: "Bo Burnham",
    writers: ["Bo Burnham"],
    cinematographer: "Bo Burnham",
    cast: ["Bo Burnham"],
    providers: ["Netflix"],
    availabilityType: "subscription",
    popularity: 78,
    baseline: 91,
  },
  {
    id: "reservation-dogs",
    name: "Reservation Dogs",
    year: 2021,
    kind: "Series",
    runtime: "3 seasons · 25–35m",
    poster: "https://image.tmdb.org/t/p/w780/t6hqwD5oQRGgNrZKN71BQYxteC1.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/4vC3CijGu8g2Z1UobwkJpRQHOVO.jpg",
    synopsis:
      "Four Indigenous teenagers in rural Oklahoma dream of escape while community, grief, and absurdity keep pulling them home.",
    genres: ["Comedy", "Drama"],
    tags: ["character study", "warm", "ensemble", "bingeable"],
    director: "Sterlin Harjo",
    writers: ["Sterlin Harjo", "Taika Waititi"],
    cast: ["Devery Jacobs", "D'Pharaoh Woon-A-Tai", "Paulina Alexis"],
    providers: ["Hulu"],
    availabilityType: "subscription",
    popularity: 62,
    baseline: 90,
  },
  {
    id: "the-bear",
    name: "The Bear",
    year: 2022,
    kind: "Series",
    runtime: "4 seasons · 25–45m",
    poster: "https://image.tmdb.org/t/p/w780/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg",
    backdrop: "https://image.tmdb.org/t/p/w780/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg",
    synopsis:
      "A young chef returns home to run his family's sandwich shop and finds grief, ambition, and a stubborn team packed into one kitchen.",
    genres: ["Drama", "Comedy"],
    tags: ["intense", "character study", "fast", "bingeable"],
    director: "Christopher Storer",
    writers: ["Christopher Storer"],
    cinematographer: "Andrew Wehde",
    cast: ["Jeremy Allen White", "Ayo Edebiri", "Ebon Moss-Bachrach"],
    providers: ["Hulu"],
    availabilityType: "subscription",
    popularity: 94,
    baseline: 92,
  },
  {
    id: "nice-guys",
    name: "The Nice Guys",
    year: 2016,
    kind: "Movie",
    runtime: "1h 56m",
    poster: "https://image.tmdb.org/t/p/w780/clq4So9spa9cXk3MZy2iMdqkxP2.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/oLp6ueqQXNWvWCFwrb6tXDnH0Ye.jpg",
    synopsis:
      "A bruising enforcer and a hapless private eye become unlikely partners in a missing-person case that keeps getting stranger.",
    genres: ["Comedy", "Crime", "Action"],
    tags: ["buddy comedy", "fast", "mystery", "1970s"],
    director: "Shane Black",
    writers: ["Shane Black", "Anthony Bagarozzi"],
    cinematographer: "Philippe Rousselot",
    cast: ["Russell Crowe", "Ryan Gosling", "Angourie Rice"],
    providers: ["Netflix"],
    availabilityType: "subscription",
    popularity: 76,
    baseline: 88,
  },
  {
    id: "nope",
    name: "Nope",
    year: 2022,
    kind: "Movie",
    runtime: "2h 10m",
    poster: "https://image.tmdb.org/t/p/w780/AcKVlWaNVVVFQwro3nLXqPljcYA.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/xRMZikjAHNFebD1FLRqgDZeGV4a.jpg",
    synopsis:
      "Two siblings running a California horse ranch discover something uncanny above their land—and try to capture the impossible image.",
    genres: ["Horror", "Science Fiction", "Thriller"],
    tags: ["spectacle", "cerebral", "creature", "social satire"],
    director: "Jordan Peele",
    writers: ["Jordan Peele"],
    cinematographer: "Hoyte van Hoytema",
    cast: ["Daniel Kaluuya", "Keke Palmer", "Steven Yeun"],
    providers: ["Peacock"],
    availabilityType: "subscription",
    popularity: 84,
    baseline: 89,
  },
  {
    id: "paddington-2",
    name: "Paddington 2",
    year: 2017,
    kind: "Movie",
    runtime: "1h 44m",
    poster: "https://image.tmdb.org/t/p/w780/1OJ9vkD5xPt3skC6KguyXAgagRZ.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/7d6EY00g1c39SGZOoCJ5Py9nNth.jpg",
    synopsis:
      "Paddington searches for the perfect birthday gift, only to be framed by a vain actor with a theatrical plan.",
    genres: ["Comedy", "Family", "Adventure"],
    tags: ["warm", "gentle", "visual comedy", "comfort"],
    director: "Paul King",
    writers: ["Paul King", "Simon Farnaby"],
    cinematographer: "Erik Wilson",
    cast: ["Ben Whishaw", "Hugh Grant", "Sally Hawkins"],
    providers: ["Max"],
    availabilityType: "subscription",
    popularity: 72,
    baseline: 91,
  },
  {
    id: "zodiac",
    name: "Zodiac",
    year: 2007,
    kind: "Movie",
    runtime: "2h 37m",
    poster: "https://image.tmdb.org/t/p/w780/6YmeO4pB7XTh8P8F960O1uA14JO.jpg",
    backdrop: "https://image.tmdb.org/t/p/w780/6YmeO4pB7XTh8P8F960O1uA14JO.jpg",
    synopsis: "A cartoonist, a reporter, and two detectives become consumed by the coded messages and elusive identity of a serial killer.",
    genres: ["Thriller", "Drama", "Crime"],
    tags: ["investigative", "slow-burn", "obsessive", "procedural"],
    director: "David Fincher",
    writers: ["James Vanderbilt"],
    cinematographer: "Harris Savides",
    cast: ["Jake Gyllenhaal", "Mark Ruffalo", "Robert Downey Jr."],
    providers: ["Paramount+"],
    availabilityType: "subscription",
    canonical: ["21st Century Critics' Picks"],
    popularity: 87,
    baseline: 94,
  },
  {
    id: "parasite",
    name: "Parasite",
    year: 2019,
    kind: "Movie",
    runtime: "2h 12m",
    poster: "https://image.tmdb.org/t/p/w780/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/TU9NIjwzjoKPwQHoHshkFcQUCG.jpg",
    synopsis: "A struggling family gradually enters the orbit of a wealthy household, with consequences no one can contain.",
    genres: ["Thriller", "Drama", "Comedy"],
    tags: ["international", "dark comedy", "class", "twisty"],
    director: "Bong Joon Ho",
    writers: ["Bong Joon Ho", "Han Jin-won"],
    cinematographer: "Hong Kyung-pyo",
    cast: ["Song Kang-ho", "Lee Sun-kyun", "Cho Yeo-jeong"],
    providers: ["Max"],
    availabilityType: "subscription",
    criterion: true,
    canonical: ["Palme d'Or winners", "Academy Award Best Picture"],
    popularity: 96,
    baseline: 97,
  },
  {
    id: "grand-budapest",
    name: "The Grand Budapest Hotel",
    year: 2014,
    kind: "Movie",
    runtime: "1h 40m",
    poster: "https://image.tmdb.org/t/p/w780/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/xT98tLqatZPQApyRmlPL12LtiWp.jpg",
    synopsis: "A devoted concierge and his young lobby boy are swept into a battle over a priceless painting and a vanishing Europe.",
    genres: ["Comedy", "Drama", "Adventure"],
    tags: ["dry comedy", "visual craft", "fast", "bittersweet"],
    director: "Wes Anderson",
    writers: ["Wes Anderson"],
    cinematographer: "Robert Yeoman",
    cast: ["Ralph Fiennes", "Tony Revolori", "Saoirse Ronan"],
    providers: ["Disney+"],
    availabilityType: "subscription",
    popularity: 89,
    baseline: 93,
  },
  {
    id: "slow-horses",
    name: "Slow Horses",
    year: 2022,
    kind: "Series",
    runtime: "6 seasons · 42–53m",
    poster: "https://image.tmdb.org/t/p/w780/dnpatlJrEPiDSn5fzgzvxtiSnMo.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/qhXdYysiamRu6moMGMZPQ4oVLvd.jpg",
    synopsis: "A brilliant but irascible spymaster leads a team of disgraced intelligence officers through failures that keep becoming real threats.",
    genres: ["Thriller", "Drama", "Comedy"],
    tags: ["spy", "dry comedy", "bingeable", "character study"],
    director: "James Hawes",
    writers: ["Will Smith", "Mick Herron"],
    cast: ["Gary Oldman", "Jack Lowden", "Kristin Scott Thomas"],
    providers: ["Apple TV+"],
    availabilityType: "subscription",
    popularity: 90,
    baseline: 92,
  },
];

let catalog: Title[] = fallbackCatalog;

const seedProfiles: ViewerProfile[] = [
  {
    id: "sam",
    name: "Sam",
    avatar: "S",
    color: "ochre",
    guest: false,
    onboardingCompleted: true,
    region: "US",
    subscriptions: ["Netflix", "Hulu", "Disney+", "Apple TV+", "Prime Video", "Max", "Peacock", "Paramount+", "Criterion Channel"],
    favoriteActors: [],
    ratings: {
      arrival: 10,
      "the-bear": 9,
      "nice-guys": 8,
      nope: 8,
      "paddington-2": 9,
    },
    questionnaire: {
      cerebral: 84,
      darkness: 76,
      ambiguity: 88,
      international: 81,
      novelty: 72,
    },
    rentalMode: "exceptional",
    modelVersion: 3,
    shareWithFriends: "ratings_and_reviews",
  },
  {
    id: "maya",
    name: "Maya",
    avatar: "M",
    color: "plum",
    guest: false,
    onboardingCompleted: true,
    region: "US",
    subscriptions: ["Netflix", "Hulu", "Disney+", "Apple TV+", "Prime Video", "Max", "Peacock", "Paramount+", "Criterion Channel"],
    favoriteActors: [],
    ratings: {
      "perfect-days": 10,
      "reservation-dogs": 9,
      "paddington-2": 8,
      "the-bear": 8,
    },
    questionnaire: {
      cerebral: 68,
      emotional: 87,
      character: 92,
      international: 76,
      darkness: 44,
    },
    rentalMode: "exceptional",
    modelVersion: 2,
    shareWithFriends: "ratings_only",
  },
  {
    id: "guest",
    name: "Guest",
    avatar: "G",
    color: "slate",
    guest: true,
    onboardingCompleted: true,
    region: "US",
    subscriptions: ["Netflix", "Hulu", "Disney+", "Apple TV+", "Prime Video", "Max", "Peacock", "Paramount+", "Criterion Channel"],
    favoriteActors: [],
    ratings: {},
    questionnaire: {},
    rentalMode: "never",
    modelVersion: 1,
    shareWithFriends: "nothing",
  },
];

const seedFriendProfiles: FriendProfile[] = [
  {
    id: "friend-jane",
    name: "Jane",
    avatar: "J",
    color: "olive",
    sharing: "ratings_and_reviews",
    ratings: { arrival: 10, nope: 8, "paddington-2": 9, zodiac: 10, "after-yang": 9, parasite: 10, conversation: 8 },
    ratingDates: { zodiac: "2026-08-08T19:30:00.000Z", "after-yang": "2026-08-04T21:10:00.000Z", parasite: "2026-07-20T20:00:00.000Z" },
  },
  {
    id: "friend-tyler",
    name: "Tyler",
    avatar: "T",
    color: "slate",
    sharing: "ratings_only",
    ratings: { arrival: 6, "the-bear": 7, "nice-guys": 10, nope: 4, "paddington-2": 5, "slow-horses": 9, parasite: 9 },
    ratingDates: { "slow-horses": "2026-08-06T18:20:00.000Z", parasite: "2026-07-30T20:00:00.000Z" },
  },
  {
    id: "friend-chris",
    name: "Chris",
    avatar: "C",
    color: "plum",
    sharing: "ratings_and_reviews",
    ratings: { arrival: 9, "the-bear": 9, "nice-guys": 8, nope: 9, "paddington-2": 8, burning: 9, conversation: 9, blackberry: 8 },
    ratingDates: { burning: "2026-08-07T22:15:00.000Z", conversation: "2026-08-01T19:45:00.000Z", blackberry: "2026-07-28T20:00:00.000Z" },
  },
  {
    id: "friend-nora",
    name: "Nora",
    avatar: "N",
    color: "ochre",
    sharing: "nothing",
    ratings: { "grand-budapest": 10, "perfect-days": 9 },
    ratingDates: { "grand-budapest": "2026-08-03T19:00:00.000Z" },
  },
];

const seedFriendships: Friendship[] = [
  { id: "fs-sam-jane", requesterProfileId: "sam", addresseeProfileId: "friend-jane", status: "accepted", createdAt: "2026-05-14T18:00:00.000Z", respondedAt: "2026-05-14T20:00:00.000Z" },
  { id: "fs-sam-tyler", requesterProfileId: "friend-tyler", addresseeProfileId: "sam", status: "accepted", createdAt: "2026-06-09T18:00:00.000Z", respondedAt: "2026-06-10T18:00:00.000Z" },
  { id: "fs-sam-chris", requesterProfileId: "sam", addresseeProfileId: "friend-chris", status: "accepted", createdAt: "2026-07-01T18:00:00.000Z", respondedAt: "2026-07-01T21:00:00.000Z" },
  { id: "fs-maya-jane", requesterProfileId: "friend-jane", addresseeProfileId: "maya", status: "accepted", createdAt: "2026-06-12T18:00:00.000Z", respondedAt: "2026-06-13T18:00:00.000Z" },
  { id: "fs-maya-tyler", requesterProfileId: "friend-tyler", addresseeProfileId: "maya", status: "pending", createdAt: "2026-08-05T18:00:00.000Z" },
];

const seedFriendReviews: FriendReviewNote[] = [
  { id: "review-jane-zodiac", authorProfileId: "friend-jane", titleId: "zodiac", rating: 10, note: "You’d love how obsessive and detailed this gets. The investigation becomes more interesting than solving the crime.", createdAt: "2026-08-08T19:32:00.000Z" },
  { id: "review-jane-after-yang", authorProfileId: "friend-jane", titleId: "after-yang", rating: 9, note: "Quiet, strange, and much more moving than I expected.", createdAt: "2026-08-04T21:12:00.000Z" },
  { id: "review-chris-burning", authorProfileId: "friend-chris", titleId: "burning", rating: 9, note: "Don’t read anything about it first. It stayed with me for days.", createdAt: "2026-08-07T22:18:00.000Z" },
  { id: "review-chris-conversation", authorProfileId: "friend-chris", titleId: "conversation", rating: 9, note: "Best thing I’ve seen all week.", createdAt: "2026-08-01T19:47:00.000Z" },
];

const seedFriendRecommendations: FriendRecommendation[] = [
  { id: "rec-jane-sam-zodiac", senderProfileId: "friend-jane", recipientProfileId: "sam", titleId: "zodiac", note: "This is completely your kind of procedural obsession.", createdAt: "2026-08-08T19:35:00.000Z" },
  { id: "rec-chris-sam-burning", senderProfileId: "friend-chris", recipientProfileId: "sam", titleId: "burning", note: "Give it time. The uncertainty is the whole point.", createdAt: "2026-08-07T22:20:00.000Z" },
  { id: "rec-tyler-sam-slow-horses", senderProfileId: "friend-tyler", recipientProfileId: "sam", titleId: "slow-horses", createdAt: "2026-08-06T18:25:00.000Z" },
  { id: "rec-jane-maya-after-yang", senderProfileId: "friend-jane", recipientProfileId: "maya", titleId: "after-yang", note: "This has the gentle, human sci-fi feeling you always respond to.", createdAt: "2026-08-04T21:15:00.000Z" },
];

function migrateCatalogTitleIds(store: AppStore, nextCatalog: readonly Title[]): AppStore {
  const identity = (title: Title) => `${title.name.trim().toLowerCase()}::${title.year}`;
  const nextIdByIdentity = new Map(nextCatalog.map((title) => [identity(title), title.id]));
  const legacyToNext = new Map(
    fallbackCatalog.flatMap((title) => {
      const nextId = nextIdByIdentity.get(identity(title));
      return nextId && nextId !== title.id ? [[title.id, nextId] as const] : [];
    }),
  );
  if (!legacyToNext.size) return store;

  const migrateId = (titleId: string) => legacyToNext.get(titleId) ?? titleId;
  const migrateRecord = <T,>(record: Record<string, T>) => {
    const migrated: Record<string, T> = {};
    for (const [titleId, value] of Object.entries(record)) {
      const nextId = migrateId(titleId);
      if (!(nextId in migrated) || nextId === titleId) migrated[nextId] = value;
    }
    return migrated;
  };

  return {
    ...store,
    profiles: store.profiles.map((profile) => ({ ...profile, ratings: migrateRecord(profile.ratings) })),
    feedback: store.feedback.map((event) => ({ ...event, titleId: migrateId(event.titleId) })),
    friendProfiles: store.friendProfiles.map((friend) => ({
      ...friend,
      ratings: migrateRecord(friend.ratings),
      ratingDates: migrateRecord(friend.ratingDates),
    })),
    friendReviews: store.friendReviews.map((review) => ({ ...review, titleId: migrateId(review.titleId) })),
    friendRecommendations: store.friendRecommendations.map((recommendation) => ({
      ...recommendation,
      titleId: migrateId(recommendation.titleId),
    })),
  };
}

type SocialProfile = Pick<FriendProfile, "id" | "name" | "avatar" | "color" | "ratings"> & {
  sharing: ShareMode;
  ratingDates?: Record<string, string>;
};

type SocialEvidence = {
  score: number;
  context?: FriendContext;
};

function socialProfileById(store: AppStore, id: string): SocialProfile | undefined {
  const friend = store.friendProfiles.find((candidate) => candidate.id === id);
  if (friend) return friend;
  const householdProfile = store.profiles.find((candidate) => candidate.id === id);
  if (!householdProfile) return undefined;
  return {
    id: householdProfile.id,
    name: householdProfile.name,
    avatar: householdProfile.avatar,
    color: householdProfile.color,
    ratings: householdProfile.ratings,
    sharing: householdProfile.shareWithFriends,
  };
}

function acceptedFriendIds(profileId: string, store: AppStore) {
  return store.friendships.flatMap((friendship) => {
    if (friendship.status !== "accepted") return [];
    if (friendship.requesterProfileId === profileId) return [friendship.addresseeProfileId];
    if (friendship.addresseeProfileId === profileId) return [friendship.requesterProfileId];
    return [];
  });
}

function tasteCompatibility(profile: ViewerProfile, friend: SocialProfile) {
  const overlap = Object.keys(profile.ratings).filter((titleId) => typeof friend.ratings[titleId] === "number");
  if (overlap.length < 2) return 0.5;
  const averageDistance = overlap.reduce(
    (sum, titleId) => sum + Math.abs(profile.ratings[titleId] - friend.ratings[titleId]),
    0,
  ) / overlap.length;
  return Math.max(0.2, Math.min(0.98, 1 - averageDistance / 9));
}

function recencySignal(value?: string) {
  if (!value) return 0;
  const ageInDays = Math.max(0, (Date.now() - new Date(value).getTime()) / 86_400_000);
  return Math.max(0, 1 - ageInDays / 120);
}

function friendEvidence(profile: ViewerProfile, titleId: string, store: AppStore): SocialEvidence {
  const friendIds = new Set(acceptedFriendIds(profile.id, store));
  const activity = [...friendIds].flatMap((friendId) => {
    const friend = socialProfileById(store, friendId);
    if (!friend) return [];
    const recommendation = store.friendRecommendations
      .filter((item) => item.senderProfileId === friendId && item.recipientProfileId === profile.id && item.titleId === titleId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const rating = friend.sharing === "nothing" ? undefined : friend.ratings[titleId];
    const review = friend.sharing === "ratings_and_reviews"
      ? store.friendReviews
        .filter((item) => item.authorProfileId === friendId && item.titleId === titleId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
    const positiveRating = typeof rating === "number" && rating >= 8;
    if (!recommendation && !positiveRating) return [];
    const compatibility = tasteCompatibility(profile, friend);
    const ratingStrength = positiveRating ? (rating - 7) * 1.45 : 0;
    const explicitStrength = recommendation ? 6.5 : 0;
    const noteStrength = recommendation?.note || review?.note ? 1.5 : 0;
    const recent = recencySignal(recommendation?.createdAt ?? review?.createdAt ?? friend.ratingDates?.[titleId]);
    return [{ friend, rating, review, recommendation, strength: (ratingStrength + explicitStrength + noteStrength + recent * 1.5) * (0.68 + compatibility * 0.52) }];
  });

  if (!activity.length) return { score: 0 };
  const explicitWithNote = activity
    .filter((item) => item.recommendation?.note)
    .sort((a, b) => (b.recommendation?.createdAt ?? "").localeCompare(a.recommendation?.createdAt ?? ""))[0];
  const reviewWithNote = activity
    .filter((item) => item.review?.note)
    .sort((a, b) => (b.review?.createdAt ?? "").localeCompare(a.review?.createdAt ?? ""))[0];
  const explicit = activity.find((item) => item.recommendation);
  const highlighted = explicitWithNote ?? reviewWithNote ?? explicit ?? activity.sort((a, b) => b.strength - a.strength)[0];
  const ratings = activity.map((item) => item.rating).filter((rating): rating is number => typeof rating === "number");
  const averageRating = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : undefined;
  const friendCount = activity.length;
  const isExplicit = Boolean(highlighted.recommendation);
  const headline = isExplicit
    ? `${highlighted.friend.name} picked this for you`
    : friendCount > 1
      ? `${friendCount} friends liked this`
      : highlighted.rating === 10
        ? `${highlighted.friend.name} loved this`
        : `${highlighted.friend.name} also enjoyed this`;
  return {
    score: Math.min(20, activity.reduce((sum, item) => sum + item.strength, 0) + Math.max(0, friendCount - 1) * 1.25),
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

const UI_VIBE_TO_ENGINE: Record<string, EngineVibe> = {
  Favorite: "rewatch-favorite",
  Classic: "rediscover-classic",
  New: "try-something-new",
  International: "popular-international",
  Binge: "bingeable-tv",
  Trending: "trending-series",
  Hidden: "hidden-gem",
  Director: "complete-director",
  Criterion: "criterion-pick",
  FilmSchool: "film-school-night",
  BlindSpot: "blind-spot",
  Deeper: "go-deeper",
  Friends: "friends-picks",
  Surprise: "surprise-me",
};

const FEEDBACK_OPTIONS: ReadonlyArray<{ label: string; reason: RecommendationFeedbackReason }> = [
  { label: "Already seen", reason: "already-seen" },
  { label: "Not interested", reason: "not-interested" },
  { label: "Wrong mood", reason: "wrong-mood" },
  { label: "Too dark", reason: "too-dark" },
  { label: "Too light", reason: "too-light" },
  { label: "Too old", reason: "too-old" },
  { label: "Too long", reason: "too-long" },
  { label: "Don't like this actor", reason: "disliked-actor" },
  { label: "Not really this genre", reason: "misclassified" },
  { label: "Not actually available", reason: "not-available" },
  { label: "Good suggestion, wrong night", reason: "good-wrong-night" },
];

function parseRuntime(runtime: string): number | undefined {
  const hours = Number(runtime.match(/(\d+)h/)?.[1] ?? 0);
  const minuteRange = runtime.match(/(\d+)[–-](\d+)m/);
  const minutes = minuteRange
    ? (Number(minuteRange[1]) + Number(minuteRange[2])) / 2
    : Number(runtime.match(/(\d+)m/)?.[1] ?? 0);
  const total = hours * 60 + minutes;
  return total || undefined;
}

function toEngineTitle(title: Title, region: string): EngineTitle {
  const runtimeMinutes = parseRuntime(title.runtime);
  const international = title.tags.includes("international");
  const seasons = Number(title.runtime.match(/(\d+) seasons?/)?.[1] ?? 0) || undefined;
  return {
    id: title.id,
    name: title.name,
    year: title.year,
    contentType: title.kind === "Movie" ? "movie" : title.kind === "Series" ? "series" : "stand-up",
    synopsis: title.synopsis,
    runtimeMinutes: title.kind === "Series" ? undefined : runtimeMinutes,
    episodeRuntimeMinutes: title.kind === "Series" ? runtimeMinutes : undefined,
    seasons,
    completed: title.kind === "Series" ? seasons !== undefined : undefined,
    serialized: title.kind === "Series" ? title.tags.includes("bingeable") : undefined,
    genres: title.genres,
    primarySubgenre: title.primarySubgenre,
    secondarySubgenre: title.secondarySubgenre,
    subgenres: title.primarySubgenre
      ? [title.primarySubgenre, title.secondarySubgenre].filter((value): value is string => Boolean(value))
      : title.tags,
    toneTags: title.toneTags ?? title.tags,
    themes: [],
    pacing: title.pacing ?? (title.tags.some((tag) => ["fast", "propulsive"].includes(tag))
      ? "fast"
      : title.tags.some((tag) => ["slow-burn", "meditative"].includes(tag))
        ? "slow"
        : "moderate"),
    countries: [international ? "International" : region],
    languages: [international ? "international" : "en"],
    directors: [title.director],
    writers: title.writers,
    cinematographers: title.cinematographer ? [title.cinematographer] : [],
    actors: title.cast,
    castContext: title.castContext,
    canonicalScore: title.baseline,
    canonicalMemberships: (title.canonical ?? []).map((list) => ({ list, source: "demo", version: "1" })),
    criterionCollection: Boolean(title.criterion),
    popularity: title.popularity,
    trendingScore: title.popularity,
    availability: title.providers.map((serviceId) => ({
      serviceId,
      region,
      kind: title.availabilityType,
      checkedAt: "2026-08-13T00:00:00.000Z",
      source: "demo",
    })),
    posterUrl: title.poster,
    backdropUrl: title.backdrop,
  };
}

function toSocialInput(store: AppStore, activeProfileId: string): SocialRecommendationInput {
  const profiles: SocialProfile[] = [
    ...store.friendProfiles,
    ...store.profiles.filter((profile) => profile.id !== activeProfileId).map((profile) => ({
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      color: profile.color,
      ratings: profile.ratings,
      ratingDates: {},
      sharing: profile.shareWithFriends,
    })),
  ];
  return {
    friendProfiles: profiles.map((friend) => ({
      profileId: friend.id,
      displayName: friend.name,
      shareWithFriends: friend.sharing,
      ratings: Object.entries(friend.ratings).map(([titleId, score]) => ({
        titleId,
        score,
        watched: true,
        ratedAt: friend.ratingDates?.[titleId] ?? "2026-01-01T00:00:00.000Z",
      })),
    })),
    friendships: store.friendships.map((friendship) => ({
      requesterProfileId: friendship.requesterProfileId,
      addresseeProfileId: friendship.addresseeProfileId,
      status: friendship.status === "blocked" ? "declined" : friendship.status,
    })),
    reviews: store.friendReviews.map((review) => ({
      authorProfileId: review.authorProfileId,
      titleId: review.titleId,
      note: review.note,
      createdAt: review.createdAt,
    })),
    recommendations: store.friendRecommendations.map((recommendation) => ({
      senderProfileId: recommendation.senderProfileId,
      recipientProfileId: recommendation.recipientProfileId,
      titleId: recommendation.titleId,
      note: recommendation.note,
      createdAt: recommendation.createdAt,
    })),
  };
}

function normalizedFeedbackReason(reason?: string): RecommendationFeedbackReason | undefined {
  if (!reason) return undefined;
  return FEEDBACK_OPTIONS.find((option) => option.label === reason || option.reason === reason)?.reason;
}

function buildRecommendations(
  profile: ViewerProfile,
  selectedMoods: string[],
  selectedVibe: string,
  store: AppStore,
  options: { favoriteActors?: readonly string[]; excludeTitleIds?: readonly string[]; limit?: number } = {},
): Recommendation[] {
  const sourceCatalog = options.favoriteActors?.length
    ? filterTitlesForFavoriteActors(catalog, options.favoriteActors, profile.subscriptions)
    : catalog;
  const engineCatalog = sourceCatalog.map((title) => toEngineTitle(title, profile.region));
  const config: RecommendationConfig = {
    ...defaultRecommendationConfig,
    modelVersion: String(profile.modelVersion),
    weights: { ...defaultRecommendationConfig.weights, ...profile.weights },
  };
  const engineProfile = {
    id: profile.id,
    accountId: profile.id,
    displayName: profile.name,
    avatar: profile.avatar,
    createdAt: "2026-01-01T00:00:00.000Z",
    onboardingCompleted: profile.onboardingCompleted,
    guest: profile.guest,
    region: profile.region,
    modelVersion: String(profile.modelVersion),
    subscriptions: profile.subscriptions,
    rentalMode: profile.rentalMode,
    allowAdSupported: true,
    ratings: Object.entries(profile.ratings).map(([titleId, score]) => ({
      titleId,
      score,
      watched: true,
      ratedAt: "2026-01-01T00:00:00.000Z",
      source: "search" as const,
    })),
    questionnaire: mapQuestionnaireAnswers(profile.questionnaire),
    favoritePeople: { actors: profile.favoriteActors, directors: [], writers: [], cinematographers: [] },
  };
  const recommendations = recommendForProfile({
    profile: engineProfile,
    catalog: engineCatalog,
    moods: selectedMoods.map((mood) => mood.toLowerCase() as EngineMood),
    vibes: [UI_VIBE_TO_ENGINE[selectedVibe] ?? "surprise-me"],
    config,
    limit: options.limit,
    excludeTitleIds: options.excludeTitleIds,
    social: toSocialInput(store, profile.id),
    feedback: store.feedback.map((item) => ({
      profileId: item.profileId,
      titleId: item.titleId,
      modelVersion: String(profile.modelVersion),
      reason: normalizedFeedbackReason(item.reason),
      recommendationScore: item.recommendationScore,
      context: {
        moods: item.moods?.map((mood) => mood.toLowerCase() as EngineMood),
        vibes: item.vibe ? [UI_VIBE_TO_ENGINE[item.vibe] ?? "surprise-me"] : undefined,
      },
      createdAt: item.createdAt,
    })),
  });
  return recommendations.flatMap((recommendation) => {
    const title = titleById(recommendation.title.id);
    if (!title) return [];
    return [{
      rank: recommendation.rank,
      lane: recommendation.lane,
      title,
      match: recommendation.matchScore,
      explanation: recommendation.explanation,
      narrative: recommendation.narrative,
      rental: recommendation.requiresPayment && title.availabilityType === "rental",
      friendContext: recommendation.friendContext as EngineFriendContext | undefined,
    } satisfies Recommendation];
  });
}

function displayProvider(profile: ViewerProfile, title: Title) {
  const included = title.providers.find((provider) => profile.subscriptions.includes(provider));
  if (included && title.availabilityType === "subscription") return { label: "Streaming availability", provider: included };
  if (title.availabilityType === "rental") return { label: "Rental option", provider: title.providers[0] };
  return { label: "Check availability", provider: title.providers[0] };
}

function titleById(id: string) {
  return catalog.find((title) => title.id === id);
}

function ProfileAvatar({ profile, large = false }: { profile: ViewerProfile; large?: boolean }) {
  return (
    <span className={`profile-avatar profile-avatar--${profile.color} ${large ? "profile-avatar--large" : ""}`}>
      {profile.avatar}
    </span>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__mark">W</span>
      {!compact && <span className="brand__name">WHAT TO WATCH</span>}
    </div>
  );
}

function Poster({ title, priority = false }: { title: Title; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`poster ${failed ? "poster--failed" : ""}`}>
      {!failed ? (
        <Image
          src={title.poster}
          alt={`${title.name} poster`}
          fill
          sizes="(max-width: 700px) 86vw, 360px"
          priority={priority}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="poster__fallback">
          <span>{title.name}</span>
          <small>{title.year}</small>
        </div>
      )}
      <span className="poster__grain" aria-hidden="true" />
    </div>
  );
}

function BottomNav({ screen, onChange }: { screen: Screen; onChange: (screen: Screen) => void }) {
  const items: { screen: Screen; label: string; icon: LucideIcon }[] = [
    { screen: "home", label: "Tonight", icon: Home },
    { screen: "rate", label: "Rate", icon: Star },
    { screen: "taste", label: "My Taste", icon: BarChart3 },
    { screen: "settings", label: "Settings", icon: Settings },
  ];
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.screen === screen || (["actor", "results"].includes(screen) && item.screen === "home");
        return (
          <button key={item.screen} className={active ? "is-active" : ""} onClick={() => onChange(item.screen)}>
            <Icon size={20} strokeWidth={active ? 2.2 : 1.7} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ProfilePicker({
  profiles,
  onSelect,
  onCreate,
  onEdit,
}: {
  profiles: ViewerProfile[];
  onSelect: (profile: ViewerProfile) => void;
  onCreate: () => void;
  onEdit: () => void;
}) {
  return (
    <main className="profile-picker">
      <div className="profile-picker__top"><Logo /></div>
      <div className="profile-picker__content">
        <p className="kicker">YOUR HOUSEHOLD</p>
        <h1>Who&apos;s watching?</h1>
        <p className="profile-picker__intro">Each profile keeps its own history, subscriptions, and taste.</p>
        <div className="profile-grid">
          {profiles.map((profile) => (
            <button className="profile-card" key={profile.id} onClick={() => onSelect(profile)}>
              <ProfileAvatar profile={profile} large />
              <strong>{profile.name}</strong>
              <span>{profile.guest ? "Private guest session" : `${Object.keys(profile.ratings).length} ratings`}</span>
            </button>
          ))}
          <button className="profile-card profile-card--create" onClick={onCreate}>
            <span className="profile-add"><Plus size={28} /></span>
            <strong>Create profile</strong>
            <span>Start a fresh taste model</span>
          </button>
        </div>
        <button className="text-button profile-picker__edit" onClick={onEdit}>
          <UsersRound size={16} /> Manage profiles
        </button>
      </div>
      <p className="profile-picker__privacy"><LockKeyhole size={13} /> Profiles never influence one another.</p>
    </main>
  );
}

function ProfileEditor({
  profiles,
  mode,
  onClose,
  onSave,
  onUpdate,
  onDelete,
}: {
  profiles: ViewerProfile[];
  mode: "create" | "manage";
  onClose: () => void;
  onSave: (profile: ViewerProfile) => void;
  onUpdate: (profile: ViewerProfile) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [guest, setGuest] = useState(false);
  const create = () => {
    const source = profiles.find((profile) => profile.id === cloneFrom);
    const value = name.trim() || "New profile";
    onSave({
      id: `${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      name: value,
      avatar: value.slice(0, 1).toUpperCase(),
      color: ["ochre", "plum", "slate", "olive"][profiles.length % 4],
      guest,
      onboardingCompleted: false,
      region: source?.region ?? "US",
      subscriptions: source ? [...source.subscriptions] : [],
      favoriteActors: [],
      ratings: {},
      questionnaire: {},
      rentalMode: source?.rentalMode ?? "exceptional",
      modelVersion: 1,
      shareWithFriends: "ratings_and_reviews",
    });
  };
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={mode === "create" ? "Create profile" : "Manage profiles"}>
      <div className="sheet profile-editor">
        <div className="sheet__header">
          <div><p className="kicker">PROFILES</p><h2>{mode === "create" ? "Create a profile" : "Manage profiles"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {mode === "create" ? (
          <div className="profile-form">
            <label>Display name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Who is this for?" /></label>
            <label>Start with household settings<select value={cloneFrom} onChange={(event) => setCloneFrom(event.target.value)}><option value="">Start fresh</option>{profiles.filter((profile) => !profile.guest).map((profile) => <option key={profile.id} value={profile.id}>Copy {profile.name}&apos;s services and region</option>)}</select></label>
            <p className="form-note"><ShieldCheck size={16} /> Ratings, taste, and history are never copied.</p>
            <label className="toggle-row"><span><strong>Guest profile</strong><small>Does not train anyone else&apos;s model.</small></span><button type="button" className={`switch ${guest ? "is-on" : ""}`} onClick={() => setGuest(!guest)} aria-pressed={guest}><span /></button></label>
            <button className="primary-button" onClick={create} disabled={!name.trim()}>Continue <ChevronRight size={18} /></button>
          </div>
        ) : (
          <div className="manage-list">
            {profiles.map((profile) => (
              <div className="manage-row" key={profile.id}>
                <ProfileAvatar profile={profile} />
                <div><input className="manage-name-input" defaultValue={profile.name} aria-label={`Edit ${profile.name}'s name`} onBlur={(event) => { const nextName = event.target.value.trim(); if (nextName && nextName !== profile.name) onUpdate({ ...profile, name: nextName, avatar: nextName.slice(0, 1).toUpperCase() }); else event.target.value = profile.name; }} /><small>{profile.guest ? "Guest" : `${profile.subscriptions.length} services · Model v${profile.modelVersion}`}</small></div>
                <button className="icon-button" onClick={() => onDelete(profile.id)} aria-label={`Delete ${profile.name}`}><X size={18} /></button>
              </div>
            ))}
            <button className="secondary-button" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Onboarding({ profile, onChange, onFinish }: { profile: ViewerProfile; onChange: (profile: ViewerProfile) => void; onFinish: () => void }) {
  const [step, setStep] = useState<"welcome" | "services" | "questionnaire" | "genreLoves" | "genreAvoids" | "genreFineTune" | "conditional" | "calibrate" | "searchTitles" | "summary">("welcome");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [soughtGenres, setSoughtGenres] = useState<string[]>([]);
  const [avoidedGenres, setAvoidedGenres] = useState<string[]>([]);
  const [genreAnswers, setGenreAnswers] = useState<Record<string, number>>(
    Object.fromEntries(GENRES.map((genre) => [genre, 4])),
  );
  const [genreIndex, setGenreIndex] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>(profile.ratings);
  const [calibrationRatedIds, setCalibrationRatedIds] = useState<string[]>([]);
  const [calibrationAskedIds, setCalibrationAskedIds] = useState<string[]>([]);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [titleSearch, setTitleSearch] = useState("");
  const followUpQuestions = useMemo(
    () => conditionalQuestions(soughtGenres, genreAnswers),
    [genreAnswers, soughtGenres],
  );
  const activeQuestions = step === "conditional" ? followUpQuestions : CORE_QUESTIONS;
  const questionnaireScores = useMemo(
    () => Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, Math.round((value - 1) * 25)])),
    [answers],
  );
  const summary = useMemo(
    () => buildStartingTasteSummary(questionnaireScores, genreAnswers),
    [genreAnswers, questionnaireScores],
  );
  const excludedCalibrationIds = new Set([
    ...Object.keys(profile.ratings),
    ...calibrationAskedIds,
    ...skippedIds,
  ]);
  const calibrationTitle = calibrationRatedIds.length >= 8 ? undefined : selectCalibrationTitle(catalog, {
    targetGenres: [...soughtGenres, ...avoidedGenres],
    excludedIds: excludedCalibrationIds,
    askedTitles: calibrationAskedIds.map((id) => catalog.find((title) => title.id === id)).filter((title): title is Title => Boolean(title)),
  }) as Title | undefined;
  const progress = step === "welcome" ? 5
    : step === "services" ? 13
      : step === "questionnaire" ? 18 + (questionIndex / CORE_QUESTIONS.length) * 34
        : step === "genreLoves" ? 56
          : step === "genreAvoids" || step === "genreFineTune" ? 65
            : step === "conditional" ? 70 + (questionIndex / Math.max(followUpQuestions.length, 1)) * 10
              : step === "calibrate" || step === "searchTitles" ? 84
                : 100;
  const genreOutlierScores = () => Object.fromEntries(GENRES.map((genre) => [
      genre,
      soughtGenres.includes(genre) ? 7 : avoidedGenres.includes(genre) ? 1 : 4,
    ]));
  const continueAfterGenres = (nextGenreAnswers: Record<string, number>) => {
    setGenreAnswers(nextGenreAnswers);
    setQuestionIndex(0);
    setStep(conditionalQuestions(soughtGenres, nextGenreAnswers).length ? "conditional" : "calibrate");
  };
  const answerQuestion = (score: number) => {
    const question = activeQuestions[questionIndex];
    if (!question) return;
    setAnswers((current) => ({ ...current, [question.id]: score }));
    if (questionIndex < activeQuestions.length - 1) setQuestionIndex((index) => index + 1);
    else {
      setQuestionIndex(0);
      setStep(step === "questionnaire" ? "genreLoves" : "calibrate");
    }
  };
  const toggleGenre = (genre: string, selected: string[], setter: (genres: string[]) => void) => {
    if (selected.includes(genre)) setter(selected.filter((item) => item !== genre));
    else if (selected.length < 5) setter([...selected, genre]);
  };
  const rateCalibrationTitle = (title: Title, score: number) => {
    setRatings((current) => ({ ...current, [title.id]: score }));
    setCalibrationRatedIds((current) => current.includes(title.id) ? current : [...current, title.id]);
    setCalibrationAskedIds((current) => current.includes(title.id) ? current : [...current, title.id]);
    setTitleSearch("");
    setStep("calibrate");
  };
  const skipCalibrationTitle = () => {
    if (!calibrationTitle) return;
    setSkippedIds((current) => [...current, calibrationTitle.id]);
    setCalibrationAskedIds((current) => [...current, calibrationTitle.id]);
  };
  const finish = () => {
    const storedScores = { ...questionnaireScores };
    GENRES.forEach((genre) => { storedScores[`genre:${genre}`] = Math.round(((genreAnswers[genre] ?? 4) - 1) * (100 / 6)); });
    onChange({ ...profile, questionnaire: storedScores, ratings, onboardingCompleted: true });
    onFinish();
  };
  return (
    <main className="onboarding">
      <header className="onboarding__header"><Logo compact /><span>PROFILE FOR {profile.name.toUpperCase()}</span><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></header>
      {step === "welcome" && (
        <section className="onboarding-panel onboarding-welcome">
          <span className="onboarding-orbit"><Sparkles size={28} /></span>
          <p className="kicker">A BETTER STARTING POINT</p>
          <h1>Build your taste profile.</h1>
          <p>Tell us what you seek out, answer a few plain-language questions, and rate a handful of titles chosen for your taste.</p>
          <div className="onboarding-time"><Clock3 size={17} /><span><strong>About 4–6 minutes</strong><small>You can skip any part and refine it later.</small></span></div>
          <button className="primary-button" onClick={() => setStep("services")}>Let&apos;s begin <ChevronRight size={18} /></button>
          <button className="text-button" onClick={() => { onChange({ ...profile, onboardingCompleted: true }); onFinish(); }}>Skip for now</button>
        </section>
      )}
      {step === "services" && (
        <section className="onboarding-panel">
          <p className="kicker">STEP 1</p><h1>Where do you watch?</h1><p className="lede">Choose the services available to {profile.name}. We use these as a hard filter before recommending.</p>
          <ProviderSelector
            region={profile.region}
            selected={profile.subscriptions}
            onChange={(subscriptions) => onChange({ ...profile, subscriptions })}
          />
          <div className="onboarding-actions"><button className="text-button" onClick={() => setStep("welcome")}><ArrowLeft size={16} /> Back</button><button className="primary-button" onClick={() => { setQuestionIndex(0); setStep("questionnaire"); }}>Build my taste <ChevronRight size={18} /></button></div>
        </section>
      )}
      {(step === "questionnaire" || step === "conditional") && activeQuestions[questionIndex] && (
        <section className="onboarding-panel question-panel">
          <div className="question-count"><span>{questionIndex + 1} / {activeQuestions.length}</span><button className="text-button" onClick={() => { setQuestionIndex(0); setStep(step === "questionnaire" ? "genreLoves" : "calibrate"); }}>Skip questions</button></div>
          <p className="kicker">{step === "questionnaire" ? "WHAT PULLS YOU IN?" : "A LITTLE MORE DETAIL"}</p>
          <p className="question-support">Choose what usually feels like you—not what you want to watch tonight.</p>
          <h2>{activeQuestions[questionIndex].prompt}</h2>
          <p className="question-example">{activeQuestions[questionIndex].example}</p>
          <div className="answer-scale" role="radiogroup" aria-label="How much this sounds like you">
            {ANSWER_LABELS.map((label, index) => <button key={label} role="radio" className={answers[activeQuestions[questionIndex].id] === index + 1 ? "is-active" : ""} onClick={() => answerQuestion(index + 1)} aria-checked={answers[activeQuestions[questionIndex].id] === index + 1}><span>{index + 1}</span><strong>{label}</strong></button>)}
          </div>
          <p className="question-note">Haven’t seen the examples? Just answer based on the statement.</p>
          <button className="text-button question-back" onClick={() => questionIndex > 0 ? setQuestionIndex((index) => index - 1) : setStep(step === "questionnaire" ? "services" : "genreAvoids")}><ArrowLeft size={16} /> Previous</button>
        </section>
      )}
      {step === "genreLoves" && (
        <GenreOutlierStep
          kicker="YOUR GENRE BASELINE"
          title="What do you actively look for?"
          copy="Choose up to five. These become strong starting signals; everything else stays neutral."
          selected={soughtGenres}
          disabled={[]}
          onToggle={(genre) => toggleGenre(genre, soughtGenres, setSoughtGenres)}
        >
          <div className="onboarding-actions"><button className="text-button" onClick={() => { setQuestionIndex(CORE_QUESTIONS.length - 1); setStep("questionnaire"); }}><ArrowLeft size={16} /> Back</button><button className="primary-button" onClick={() => setStep("genreAvoids")}>Continue <ChevronRight size={18} /></button></div>
        </GenreOutlierStep>
      )}
      {step === "genreAvoids" && (
        <GenreOutlierStep
          kicker="YOUR GENRE BASELINE"
          title="What do you usually avoid?"
          copy="Choose up to five. We’ll use these as cautions, not permanent bans."
          selected={avoidedGenres}
          disabled={soughtGenres}
          onToggle={(genre) => toggleGenre(genre, avoidedGenres, setAvoidedGenres)}
        >
          <div className="onboarding-actions stacked-actions"><button className="text-button" onClick={() => setStep("genreLoves")}><ArrowLeft size={16} /> Back</button><div><button className="secondary-button" onClick={() => { setGenreAnswers(genreOutlierScores()); setGenreIndex(0); setStep("genreFineTune"); }}>Fine-tune genres</button><button className="primary-button" onClick={() => continueAfterGenres(genreOutlierScores())}>Continue <ChevronRight size={18} /></button></div></div>
        </GenreOutlierStep>
      )}
      {step === "genreFineTune" && (
        <section className="onboarding-panel question-panel">
          <div className="question-count"><span>{genreIndex + 1} / {GENRES.length}</span><button className="text-button" onClick={() => continueAfterGenres(genreAnswers)}>Finish fine-tuning</button></div>
          <p className="kicker">FINE-TUNE YOUR GENRES</p><h2>{GENRE_LABELS[GENRES[genreIndex]]}</h2>
          <div className="genre-answer-scale" role="radiogroup" aria-label={`${GENRE_LABELS[GENRES[genreIndex]]} preference`}>
            {GENRE_RATING_LABELS.map((label, index) => <button key={label} role="radio" className={genreAnswers[GENRES[genreIndex]] === index + 1 ? "is-active" : ""} aria-checked={genreAnswers[GENRES[genreIndex]] === index + 1} onClick={() => { const next = { ...genreAnswers, [GENRES[genreIndex]]: index + 1 }; setGenreAnswers(next); if (genreIndex < GENRES.length - 1) setGenreIndex((current) => current + 1); else continueAfterGenres(next); }}><span>{index + 1}</span><strong>{label}</strong></button>)}
          </div>
          {genreIndex > 0 && <button className="text-button question-back" onClick={() => setGenreIndex((index) => index - 1)}><ArrowLeft size={16} /> Previous</button>}
        </section>
      )}
      {step === "calibrate" && (
        <section className="onboarding-panel calibration-panel">
          <p className="kicker">A FEW USEFUL RATINGS</p><h1>Help us sharpen the picture.</h1><p className="lede">Each title is chosen to clarify the preferences you just shared. Four to six useful ratings is plenty.</p>
          {calibrationTitle ? (
            <div className="calibration-card">
              <div className="calibration-poster"><Image src={calibrationTitle.poster} alt={`Poster for ${calibrationTitle.name}`} fill sizes="180px" /></div>
              <div><p className="kicker">RATE 1–10</p><h2>{calibrationTitle.name}</h2><p>{calibrationTitle.year} · {calibrationTitle.kind} · {calibrationTitle.genres.join(", ")}</p><RatingPicker value={ratings[calibrationTitle.id]} onRate={(score) => rateCalibrationTitle(calibrationTitle, score)} /></div>
            </div>
          ) : <div className="calibration-empty"><Check size={24} /><strong>That’s enough signal for now.</strong></div>}
          <div className="calibration-options">
            {calibrationTitle && <><button className="secondary-button" onClick={skipCalibrationTitle}>Haven&apos;t seen it</button><button className="secondary-button" onClick={skipCalibrationTitle}>Don&apos;t remember it well enough</button></>}
            <button className="secondary-button" onClick={() => setStep("searchTitles")}><Search size={16} /> Search for something I&apos;ve seen</button>
          </div>
          <div className="onboarding-actions"><span className="rating-count"><strong>{calibrationRatedIds.length}</strong> useful rating{calibrationRatedIds.length === 1 ? "" : "s"}</span><button className="primary-button" onClick={() => setStep("summary")}>{calibrationRatedIds.length >= 4 ? "See my starting taste" : "Finish for now"} <ChevronRight size={18} /></button></div>
        </section>
      )}
      {step === "searchTitles" && (
        <section className="onboarding-panel title-search-panel">
          <p className="kicker">CHOOSE SOMETHING YOU KNOW</p><h1>Search for a title.</h1><p className="lede">Pick a movie, series, or stand-up special you remember well enough to rate.</p>
          <label className="calibration-search"><Search size={18} /><input autoFocus value={titleSearch} onChange={(event) => setTitleSearch(event.target.value)} placeholder="Start typing a title" /></label>
          <div className="calibration-list">
            {titleSearch.trim().length >= 2 && catalog.filter((title) => title.name.toLowerCase().includes(titleSearch.trim().toLowerCase()) && !calibrationRatedIds.includes(title.id)).slice(0, 8).map((title) => <CompactRatingRow key={title.id} title={title} value={ratings[title.id]} onRate={(score) => rateCalibrationTitle(title, score)} />)}
          </div>
          <div className="onboarding-actions"><button className="text-button" onClick={() => setStep("calibrate")}><ArrowLeft size={16} /> Back</button></div>
        </section>
      )}
      {step === "summary" && (
        <section className="onboarding-panel onboarding-summary">
          <span className="summary-ring"><Check size={27} /></span><p className="kicker">YOUR STARTING TASTE</p><h1>{summary.headline}</h1><p>{summary.description}</p>
          {summary.tags.length > 0 && <div className="taste-tags">{summary.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          <p className="form-note"><Info size={16} /> These are starting assumptions. Every rating makes them more personal.</p>
          <button className="primary-button" onClick={finish}>Find something tonight <ChevronRight size={18} /></button>
        </section>
      )}
    </main>
  );
}

function GenreOutlierStep({
  kicker,
  title,
  copy,
  selected,
  disabled,
  onToggle,
  children,
}: {
  kicker: string;
  title: string;
  copy: string;
  selected: string[];
  disabled: string[];
  onToggle: (genre: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="onboarding-panel genre-panel">
      <p className="kicker">{kicker}</p><h1>{title}</h1><p className="lede">{copy}</p>
      <div className="genre-selection-count">{selected.length} / 5 selected</div>
      <div className="genre-chip-grid">
        {GENRES.map((genre) => <button key={genre} type="button" disabled={disabled.includes(genre)} className={selected.includes(genre) ? "is-active" : ""} onClick={() => onToggle(genre)} aria-pressed={selected.includes(genre)}><span>{GENRE_LABELS[genre]}</span>{selected.includes(genre) && <Check size={15} />}</button>)}
      </div>
      {children}
    </section>
  );
}

function CompactRatingRow({ title, value, onRate }: { title: Title; value?: number; onRate: (score: number) => void }) {
  return (
    <div className="compact-rating-row">
      <div className="rating-thumb"><Image src={title.poster} alt="" fill sizes="48px" /></div>
      <div className="compact-rating-row__title"><strong>{title.name}</strong><span>{title.year} · {title.kind}</span></div>
      <RatingPicker value={value} onRate={onRate} compact />
    </div>
  );
}

function RatingPicker({ value, onRate, compact = false }: { value?: number; onRate: (score: number) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (compact && !open && !value) return <button className="rate-pill" onClick={() => setOpen(true)}><Star size={15} /> Rate</button>;
  if (compact && !open && value) return <button className="rating-value" onClick={() => setOpen(true)}>{value}<span>/10</span></button>;
  return (
    <div className="rating-picker" role="radiogroup" aria-label="Rating from 1 to 10">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => <button key={score} className={value === score ? "is-active" : ""} onClick={() => { onRate(score); setOpen(false); }} aria-label={`Rate ${score} out of 10`}>{score}</button>)}
    </div>
  );
}

function AppHeader({ profile, onProfiles, onMenu }: { profile: ViewerProfile; onProfiles: () => void; onMenu?: () => void }) {
  return (
    <header className="app-header">
      <button className="header-menu" onClick={onMenu} aria-label="Open menu"><Menu size={20} /></button>
      <Logo />
      <button className="profile-chip" onClick={onProfiles}><ProfileAvatar profile={profile} /><span>{profile.name}</span><ChevronDown size={14} /></button>
    </header>
  );
}

function HomeScreen({
  profile,
  selectedMoods,
  setSelectedMoods,
  selectedVibe,
  setSelectedVibe,
  onFind,
  onActorFind,
}: {
  profile: ViewerProfile;
  selectedMoods: string[];
  setSelectedMoods: (moods: string[]) => void;
  selectedVibe: string;
  setSelectedVibe: (vibe: string) => void;
  onFind: () => void;
  onActorFind: () => void;
}) {
  const ratingCount = Object.keys(profile.ratings).length;
  return (
    <main className="home-screen page-content">
      <div className="home-intro">
        <p className="kicker">TONIGHT · {profile.name.toUpperCase()}</p>
        <h1>What are you<br />in the mood for?</h1>
        <p>Pick one or two. We&apos;ll do the rest.</p>
      </div>
      <section className="choice-section" aria-labelledby="mood-heading">
        <div className="section-heading"><div><p className="section-number">01</p><h2 id="mood-heading">Choose a mood</h2></div><span>{selectedMoods.length}/2</span></div>
        <div className="mood-grid">
          {moods.map((mood) => {
            const Icon = mood.icon;
            const active = selectedMoods.includes(mood.id);
            return <button key={mood.id} className={`mood-chip ${active ? "is-active" : ""}`} onClick={() => setSelectedMoods(active ? selectedMoods.filter((item) => item !== mood.id) : selectedMoods.length < 2 ? [...selectedMoods, mood.id] : [selectedMoods[1], mood.id])}><Icon size={18} /><span>{mood.label}</span>{active && <Check size={15} />}</button>;
          })}
        </div>
      </section>
      <section className="choice-section vibe-section" aria-labelledby="vibe-heading">
        <div className="section-heading"><div><p className="section-number">02</p><h2 id="vibe-heading">What kind of night?</h2></div><button className="text-button" onClick={() => setSelectedVibe("")}>Clear</button></div>
        <div className="vibe-scroll">
          {vibes.map((vibe) => <button key={vibe.id} className={`vibe-card ${selectedVibe === vibe.id ? "is-active" : ""}`} onClick={() => setSelectedVibe(vibe.id)}><span>{vibe.eyebrow}</span><strong>{vibe.label}</strong><ChevronRight size={16} /></button>)}
        </div>
      </section>
      <button className="find-button" onClick={onFind}><span><Sparkles size={19} /> Find something</span><small>{ratingCount > 0 ? `Tuned from ${ratingCount} ratings` : "Using your starting taste"}</small></button>
      <button className="actor-find-button" onClick={onActorFind}>
        <span className="actor-find-button__icon"><UserCheck size={21} /></span>
        <span><strong>Find something with your favorite actor</strong><small>Prominent roles available on your services</small></span>
        <ChevronRight size={18} />
      </button>
      <div className="home-trust"><ShieldCheck size={15} /><p><strong>No chatbot. No taste feed.</strong> Ten considered picks from an explainable model.</p></div>
    </main>
  );
}

function ActorDiscoveryScreen({
  profile,
  onChange,
  onFind,
  onBack,
}: {
  profile: ViewerProfile;
  onChange: (actors: string[]) => void;
  onFind: (actors: string[]) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = actorOptionsForSubscriptions(catalog, profile.subscriptions);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const suggestions = options
    .filter((option) => !normalizedQuery || option.name.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, normalizedQuery ? 12 : 8);
  const toggleActor = (name: string) => {
    const selected = profile.favoriteActors.some((actor) => actor.toLocaleLowerCase() === name.toLocaleLowerCase());
    onChange(selected
      ? profile.favoriteActors.filter((actor) => actor.toLocaleLowerCase() !== name.toLocaleLowerCase())
      : [...profile.favoriteActors, name]);
  };

  return (
    <main className="actor-screen page-content">
      <div className="subpage-heading actor-screen__heading">
        <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>
        <div><p className="kicker">CAST-LED DISCOVERY</p><h1>Who do you want to watch?</h1></div>
      </div>
      <p className="actor-screen__intro">Choose one or more favorites. We&apos;ll only show movies and series where they have a prominent role and the title is included with one of {profile.name}&apos;s services.</p>

      {profile.favoriteActors.length > 0 && (
        <section className="actor-selection" aria-labelledby="favorite-actors-heading">
          <div className="section-heading"><div><p className="section-number">01</p><h2 id="favorite-actors-heading">Your favorite actors</h2></div><span>{profile.favoriteActors.length} selected</span></div>
          <div className="actor-chips">
            {profile.favoriteActors.map((actor) => <button key={actor} onClick={() => toggleActor(actor)}>{actor}<X size={14} aria-hidden="true" /><span className="visually-hidden">Remove</span></button>)}
          </div>
        </section>
      )}

      <section className="actor-search-section" aria-labelledby="actor-search-heading">
        <div className="section-heading"><div><p className="section-number">{profile.favoriteActors.length ? "02" : "01"}</p><h2 id="actor-search-heading">Search actors</h2></div><span>Prominent cast only</span></div>
        <label className="actor-search">
          <Search size={19} aria-hidden="true" />
          <span className="visually-hidden">Actor name</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try Samuel L. Jackson" autoComplete="off" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear actor search"><X size={16} /></button>}
        </label>
        <div className="actor-suggestions" aria-live="polite">
          {suggestions.map((option) => {
            const selected = profile.favoriteActors.some((actor) => actor.toLocaleLowerCase() === option.name.toLocaleLowerCase());
            return (
              <button key={option.name} className={selected ? "is-active" : ""} onClick={() => toggleActor(option.name)}>
                <span className="actor-suggestion__avatar">{option.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
                <span><strong>{option.name}</strong><small>{option.availableTitleCount} prominent role{option.availableTitleCount === 1 ? "" : "s"} on your services</small></span>
                {selected ? <Check size={17} /> : <Plus size={17} />}
              </button>
            );
          })}
          {!suggestions.length && <div className="actor-empty"><Search size={22} /><strong>No available prominent roles found</strong><p>Try another actor or update your subscribed services.</p></div>}
        </div>
      </section>

      <button className="find-button actor-results-button" disabled={!profile.favoriteActors.length} onClick={() => onFind(profile.favoriteActors)}>
        <span><UserCheck size={19} /> Show available titles</span>
        <small>{profile.favoriteActors.length ? `Featuring ${profile.favoriteActors.join(", ")}` : "Choose at least one actor"}</small>
      </button>
      <div className="actor-screen__note"><ShieldCheck size={15} /><p>“Prominent” means the actor is in the catalog&apos;s principal cast, not a cameo or incidental credit.</p></div>
    </main>
  );
}

function ResultsScreen({ profile, recommendations, focusActors = [], page = 0, hasMore = false, onMore, onBack, onDetails, onFeedback }: { profile: ViewerProfile; recommendations: Recommendation[]; focusActors?: string[]; page?: number; hasMore?: boolean; onMore: () => void; onBack: () => void; onDetails: (title: Title) => void; onFeedback: (message: string, title?: Title) => void }) {
  const actorFocused = focusActors.length > 0;
  const heading = page > 0 ? "Ten more for tonight." : recommendations.length === 10 ? "Here’s your top ten." : `${recommendations.length} picks fit tonight.`;
  return (
    <main className="results-screen page-content">
      <div className="results-heading"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button><div><p className="kicker">{actorFocused ? `${recommendations.length} ON YOUR SERVICES · PROMINENT ROLES` : page > 0 ? `ANOTHER ${recommendations.length} · ONE GOOD NIGHT` : `TOP ${recommendations.length} · ONE GOOD NIGHT`}</p><h1>{actorFocused ? `With ${focusActors.join(" or ")}.` : heading}</h1></div><button className="icon-button" onClick={onBack} aria-label={actorFocused ? "Change actors" : "Adjust choices"}><RefreshCw size={18} /></button></div>
      <div className="recommendation-stack">
        {recommendations.map((recommendation, index) => <RecommendationCard key={recommendation.title.id} profile={profile} recommendation={recommendation} priority={index === 0} focusActors={focusActors} onDetails={onDetails} onFeedback={onFeedback} />)}
        {!recommendations.length && <div className="results-empty"><UserCheck size={28} /><h2>Nothing prominent is included right now.</h2><p>Try another favorite actor or update your services. Rentals and incidental credits stay out of this list.</p><button className="secondary-button" onClick={onBack}>Choose another actor</button></div>}
        {hasMore && <button className="secondary-button another-ten-button" onClick={onMore}>Another 10 <RefreshCw size={16} /></button>}
      </div>
      <p className="availability-disclaimer"><Info size={14} /> Provider labels use demo seed data until a TMDB key is connected. The production data layer rechecks region and availability type.</p>
    </main>
  );
}

function RecommendationCard({ profile, recommendation, priority, focusActors = [], onDetails, onFeedback }: { profile: ViewerProfile; recommendation: Recommendation; priority: boolean; focusActors?: string[]; onDetails: (title: Title) => void; onFeedback: (message: string, title?: Title) => void }) {
  const { title } = recommendation;
  const availability = displayProvider(profile, title);
  const matchedActors = focusActors.filter((actor) => hasProminentActor(title, actor));
  return (
    <article className={`recommendation-card ${priority ? "recommendation-card--hero" : ""}`}>
      <div className="recommendation-card__label"><span>#{String(recommendation.rank).padStart(2, "0")} · {recommendation.lane}</span><small>{recommendation.narrative.header}</small></div>
      <button className="recommendation-card__poster" onClick={() => onDetails(title)} aria-label={`Open details for ${title.name}`}><Poster title={title} priority={priority} /><span className="match-badge"><strong>{recommendation.match}%</strong><small>MATCH</small></span>{recommendation.rental && <span className="rental-banner">WORTH RENTING</span>}</button>
      <div className="recommendation-card__body">
        <div className="title-meta"><span>{title.year}</span><span>{title.kind}</span><span>{title.runtime}</span></div>
        <div className="title-row"><h2>{title.name}</h2><button className="icon-button" onClick={() => onFeedback("Saved to your watchlist")} aria-label="Save"><Bookmark size={19} /></button></div>
        {matchedActors.length > 0 && <div className="actor-match"><UserCheck size={16} /><span><strong>Prominent role</strong> · {matchedActors.join(", ")}</span></div>}
        <div className="recommendation-story">
          <h3>{recommendation.narrative.heading}</h3>
          <p className="recommendation-reason">{recommendation.narrative.fit}</p>
          {recommendation.narrative.cast && <p className="recommendation-cast">{recommendation.narrative.cast}</p>}
          <p className="recommendation-setup"><strong>The setup</strong>{recommendation.narrative.setup}</p>
        </div>
        <div className="availability-row"><span className="provider-mark">{availability.provider.slice(0, 2)}</span><div><small>{availability.label}</small><strong>{availability.provider}</strong></div>{recommendation.rental && <span className="rental-note">Rental</span>}</div>
        {recommendation.friendContext && <FriendBanner context={recommendation.friendContext} />}
        <div className="card-actions"><button className="secondary-button" onClick={() => onDetails(title)}>Details</button><button className="ghost-button" onClick={() => onFeedback("Not interested", title)}>Not interested</button><button className="more-button" onClick={() => onFeedback("Tell us how this pick landed", title)} aria-label="More feedback"><MoreHorizontal size={20} /></button></div>
      </div>
    </article>
  );
}

function FriendBanner({ context }: { context: FriendContext }) {
  const ratingLabel = context.friendCount > 1 && context.averageRating
    ? `Average ${context.averageRating.toFixed(1)}/10`
    : context.rating
      ? `${context.rating}/10`
      : context.explicit
        ? "Recommended personally"
        : undefined;
  return (
    <aside className="friend-banner" aria-label="Friend context">
      <MessageSquareText size={17} />
      <div>
        <strong>{context.headline}</strong>
        {context.note && <p>&ldquo;{context.note}&rdquo;</p>}
        {ratingLabel && <small>{ratingLabel}</small>}
      </div>
    </aside>
  );
}

function DetailsSheet({ profile, title, friendContext, onClose, onPerson, onRate, onRecommend }: { profile: ViewerProfile; title: Title; friendContext?: FriendContext; onClose: () => void; onPerson: (person: string) => void; onRate: (score: number) => void; onRecommend: () => void }) {
  const availability = displayProvider(profile, title);
  return (
    <div className="modal-scrim modal-scrim--full" role="dialog" aria-modal="true" aria-label={`${title.name} details`}>
      <article className="details-sheet">
        <div className="details-hero">
          <Image className="details-backdrop" src={title.backdrop} alt="" fill sizes="100vw" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <div className="details-hero__shade" /><button className="icon-button details-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
          <div className="details-hero__content"><p className="kicker">{title.kind.toUpperCase()} · {title.year}</p><h1>{title.name}</h1><div className="title-meta"><span>{title.runtime}</span>{title.genres.slice(0, 2).map((genre) => <span key={genre}>{genre}</span>)}</div></div>
        </div>
        <div className="details-body">
          <div className="details-rating"><div><span>Your rating</span><strong>{profile.ratings[title.id] ? `${profile.ratings[title.id]}/10` : "Not rated"}</strong></div><RatingPicker value={profile.ratings[title.id]} onRate={onRate} /></div>
          <p className="details-synopsis">{title.synopsis}</p>
          <div className="details-availability"><span className="provider-mark">{availability.provider.slice(0, 2)}</span><div><small>{availability.label}</small><strong>{availability.provider}</strong></div>{title.availabilityType === "rental" && <span className="rental-note">Rental</span>}</div>
          {friendContext && <FriendBanner context={friendContext} />}
          <dl className="credits-list"><div><dt>Director</dt><dd><button onClick={() => onPerson(title.director)}>{title.director}</button></dd></div><div><dt>Written by</dt><dd>{title.writers.map((writer) => <button key={writer} onClick={() => onPerson(writer)}>{writer}</button>)}</dd></div>{title.cinematographer && <div><dt>Cinematography</dt><dd><button onClick={() => onPerson(title.cinematographer!)}>{title.cinematographer}</button></dd></div>}<div><dt>Featuring</dt><dd>{title.cast.map((actor) => <button key={actor} onClick={() => onPerson(actor)}>{actor}</button>)}</dd></div></dl>
          {(title.criterion || title.canonical?.length) && <div className="editorial-signals">{title.criterion && <span>Criterion associated</span>}{title.canonical?.map((list) => <span key={list}>{list}</span>)}</div>}
          {(profile.ratings[title.id] ?? 0) >= 8 && <button className="secondary-button details-recommend" onClick={onRecommend}><Send size={16} /> Recommend to a friend</button>}
          <button className="primary-button details-primary" onClick={() => onClose()}><Play size={17} /> Keep this pick</button>
          <p className="tmdb-note">Metadata and images supplied by TMDB. Watch-provider data may be supplied by JustWatch. Neither service endorses this app.</p>
        </div>
      </article>
    </div>
  );
}

function PersonSheet({ person, profile, onClose, onTitle }: { person: string; profile: ViewerProfile; onClose: () => void; onTitle: (title: Title) => void }) {
  const titles = catalog.filter((title) => title.director === person || title.writers.includes(person) || title.cinematographer === person || title.cast.includes(person));
  const seen = titles.filter((title) => profile.ratings[title.id]);
  const average = seen.length ? seen.reduce((sum, title) => sum + profile.ratings[title.id], 0) / seen.length : 0;
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={`${person} filmography`}>
      <div className="sheet person-sheet">
        <div className="sheet__header"><div><p className="kicker">FILMOGRAPHY</p><h2>{person}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        <div className="person-affinity"><span>{seen.length ? Math.min(96, Math.round(62 + average * 3.4)) : 50}%</span><div><strong>{seen.length ? "Strong affinity" : "Not enough evidence yet"}</strong><small>{seen.length} of {titles.length} catalog titles seen{seen.length ? ` · ${average.toFixed(1)} average` : ""}</small></div></div>
        <div className="filmography-list">{titles.map((title) => <button key={title.id} onClick={() => onTitle(title)}><span>{title.year}</span><strong>{title.name}</strong><small>{profile.ratings[title.id] ? `${profile.ratings[title.id]}/10` : "Unseen"}</small><ChevronRight size={16} /></button>)}</div>
      </div>
    </div>
  );
}

function RateScreen({ profile, onRate, onDetails }: { profile: ViewerProfile; onRate: (id: string, score: number) => void; onDetails: (title: Title) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "rated">("all");
  const filtered = catalog.filter((title) => title.name.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || profile.ratings[title.id]));
  return (
    <main className="rate-screen page-content">
      <div className="page-heading"><p className="kicker">TEACH THE MODEL</p><h1>Rate what you&apos;ve seen.</h1><p>Every real rating matters more than a questionnaire answer.</p></div>
      <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search movies and shows you've seen" aria-label="Search titles" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button>}</div>
      <div className="filter-row"><button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All titles <span>{catalog.length}</span></button><button className={filter === "rated" ? "is-active" : ""} onClick={() => setFilter("rated")}>My ratings <span>{Object.keys(profile.ratings).length}</span></button></div>
      <div className="rating-list">
        {filtered.map((title) => (
          <article className="rating-row" key={title.id}>
            <button className="rating-row__title" onClick={() => onDetails(title)}><span className="rating-thumb"><Image src={title.poster} alt="" fill sizes="54px" /></span><span><strong>{title.name}</strong><small>{title.year} · {title.kind} · {title.runtime}</small></span></button>
            <RatingPicker value={profile.ratings[title.id]} onRate={(score) => onRate(title.id, score)} compact />
          </article>
        ))}
        {!filtered.length && <div className="empty-state"><Search size={24} /><strong>No matching title in the catalog</strong><p>Try a different title or clear the current filter.</p></div>}
      </div>
    </main>
  );
}

function TasteScreen({ profile, onRate }: { profile: ViewerProfile; onRate: () => void }) {
  const ratedTitles = Object.entries(profile.ratings).map(([id, score]) => ({ title: titleById(id), score })).filter((item): item is { title: Title; score: number } => Boolean(item.title));
  const average = ratedTitles.length ? ratedTitles.reduce((sum, item) => sum + item.score, 0) / ratedTitles.length : 0;
  const genreScores = new Map<string, number[]>();
  ratedTitles.forEach(({ title, score }) => title.genres.forEach((genre) => genreScores.set(genre, [...(genreScores.get(genre) ?? []), score])));
  const topGenres = [...genreScores.entries()].filter(([, scores]) => scores.length >= 2).sort((a, b) => b[1].reduce((s, n) => s + n, 0) / b[1].length - a[1].reduce((s, n) => s + n, 0) / a[1].length).slice(0, 3);
  const topDirectors = ratedTitles.filter((item) => item.score >= 8).map((item) => item.title.director).filter((name, index, items) => items.indexOf(name) === index).slice(0, 3);
  const confidence = Math.min(92, 26 + ratedTitles.length * 7);
  return (
    <main className="taste-screen page-content">
      <div className="page-heading"><p className="kicker">MODEL V{profile.modelVersion}</p><h1>Your taste, in focus.</h1><p>Patterns appear only after there is enough evidence to trust them.</p></div>
      <section className="taste-overview"><div className="confidence-ring" style={{ "--confidence": `${confidence * 3.6}deg` } as React.CSSProperties}><span>{confidence}%</span><small>MODEL<br />CONFIDENCE</small></div><div><strong>{ratedTitles.length} titles rated</strong><span>{average ? `${average.toFixed(1)} average rating` : "Start with a few ratings"}</span><p>{ratedTitles.length < 10 ? "The questionnaire is still helping shape early picks." : "Observed behavior is now the strongest signal."}</p></div></section>
      <section className="taste-section"><div className="taste-section__heading"><p className="section-number">01</p><h2>You tend to love</h2></div><div className="love-list">{topGenres.length ? topGenres.map(([genre, scores]) => <div key={genre}><span>{genre}</span><strong>{(scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)}</strong><small>{scores.length} ratings</small></div>) : <p className="insufficient">Rate at least two titles in a genre to reveal a reliable pattern.</p>}</div></section>
      <section className="taste-section"><div className="taste-section__heading"><p className="section-number">02</p><h2>Creator signals</h2></div>{topDirectors.length ? <div className="creator-list">{topDirectors.map((director, index) => <div key={director}><span className="creator-rank">0{index + 1}</span><div><strong>{director}</strong><small>Positive director affinity</small></div><span className="affinity-bar"><i style={{ width: `${84 - index * 9}%` }} /></span></div>)}</div> : <p className="insufficient">Strong creator patterns need more highly rated work.</p>}</section>
      <section className="taste-section pattern-card"><p className="kicker">AN EARLY PATTERN</p><h2>Craft matters to you.</h2><p>Your higher-rated picks lean toward precise visual direction and character-first storytelling. We&apos;ll keep testing that signal.</p><span>Based on {Math.max(2, ratedTitles.filter((item) => item.score >= 8).length)} high ratings</span></section>
      <button className="secondary-button taste-cta" onClick={onRate}><Star size={17} /> Add more ratings</button>
    </main>
  );
}

function SocialAvatar({ profile }: { profile: SocialProfile }) {
  return <span className={`profile-avatar profile-avatar--${profile.color}`}>{profile.avatar}</span>;
}

function FriendsSettingsContent({ acceptedFriends, incomingRequests, outgoingIds, suggestedFriends, store, onFriendship }: { acceptedFriends: SocialProfile[]; incomingRequests: Friendship[]; outgoingIds: Set<string>; suggestedFriends: FriendProfile[]; store: AppStore; onFriendship: (friendId: string, action: "request" | "accept" | "decline" | "remove") => void }) {
  return (
    <>
      <p className="settings-intro">Friends can sharpen a pick when their taste overlaps with yours. There is no feed to check and no recommendation inbox.</p>
      {incomingRequests.length > 0 && <section className="friend-settings-section"><p className="kicker">REQUESTS</p>{incomingRequests.map((request) => { const friend = socialProfileById(store, request.requesterProfileId); return friend ? <div className="friend-settings-row" key={request.id}><SocialAvatar profile={friend} /><span><strong>{friend.name}</strong><small>Would like to connect</small></span><div className="friend-row-actions"><button onClick={() => onFriendship(friend.id, "decline")}>Decline</button><button className="is-primary" onClick={() => onFriendship(friend.id, "accept")}>Accept</button></div></div> : null; })}</section>}
      <section className="friend-settings-section"><p className="kicker">YOUR FRIENDS</p>{acceptedFriends.length ? acceptedFriends.map((friend) => <div className="friend-settings-row" key={friend.id}><SocialAvatar profile={friend} /><span><strong>{friend.name}</strong><small>Taste overlap quietly informs relevant picks</small></span><button className="friend-remove-button" onClick={() => onFriendship(friend.id, "remove")} aria-label={`Remove ${friend.name} as a friend`}><X size={15} /></button></div>) : <p className="social-empty">No friends yet. Add someone whose recommendations you trust.</p>}</section>
      {suggestedFriends.length > 0 && <section className="friend-settings-section"><p className="kicker">PEOPLE YOU MAY KNOW</p>{suggestedFriends.map((friend) => <div className="friend-settings-row" key={friend.id}><SocialAvatar profile={friend} /><span><strong>{friend.name}</strong><small>{outgoingIds.has(friend.id) ? "Request sent" : "Connect profiles, not account-wide taste"}</small></span><button className="friend-add-button" disabled={outgoingIds.has(friend.id)} onClick={() => onFriendship(friend.id, "request")}><UserPlus size={16} />{outgoingIds.has(friend.id) ? "Pending" : "Add"}</button></div>)}</section>}
      <div className="safety-note"><ShieldCheck size={18} /><p><strong>Discovery only.</strong> Friend activity appears only beside a relevant title or inside Friend&apos;s Picks.</p></div>
    </>
  );
}

function PrivacySettingsContent({ profile, onChange }: { profile: ViewerProfile; onChange: (profile: ViewerProfile) => void }) {
  const options: Array<{ id: ShareMode; label: string; detail: string }> = [
    { id: "ratings_and_reviews", label: "Ratings + short reviews", detail: "Friends can see your score and personal note when a title is relevant." },
    { id: "ratings_only", label: "Ratings only", detail: "Friends can see your score, never your review text." },
    { id: "nothing", label: "Nothing", detail: "Hide all general rating and review activity." },
  ];
  return (
    <>
      <div className="privacy-lock"><LockKeyhole size={28} /></div>
      <h3 className="settings-feature-title">Your taste stays yours.</h3>
      <p className="settings-intro">Choose the small part of your activity that accepted friends can see.</p>
      <fieldset className="share-options"><legend>Share with friends</legend>{options.map((option) => <button type="button" key={option.id} className={profile.shareWithFriends === option.id ? "is-active" : ""} aria-pressed={profile.shareWithFriends === option.id} onClick={() => onChange({ ...profile, shareWithFriends: option.id })}><span><strong>{option.label}</strong><small>{option.detail}</small></span>{profile.shareWithFriends === option.id && <Check size={16} />}</button>)}</fieldset>
      <p className="privacy-exception"><Send size={16} /><span>An explicit recommendation you send remains visible to that recipient, regardless of this setting.</span></p>
      <div className="privacy-list"><div><ShieldCheck size={18} /><span><strong>Never shared</strong><small>Questionnaire answers, raw taste model, weights, recommendation history, and private settings stay private.</small></span></div><div><Library size={18} /><span><strong>Raw history protection</strong><small>Configuration imports cannot alter the evidence behind your taste.</small></span></div><div><CircleUserRound size={18} /><span><strong>Profile ownership</strong><small>Friendships and activity belong to individual profiles, not whole accounts.</small></span></div></div>
    </>
  );
}

function SettingsScreen({ profile, feedback, store, onChange, onProfiles, onToast, onFriendship }: { profile: ViewerProfile; feedback: FeedbackEvent[]; store: AppStore; onChange: (profile: ViewerProfile) => void; onProfiles: () => void; onToast: (message: string) => void; onFriendship: (friendId: string, action: "request" | "accept" | "decline" | "remove") => void }) {
  const router = useRouter();
  const [section, setSection] = useState<"main" | "services" | "friends" | "algorithm" | "privacy" | "attributions">("main");
  const importRef = useRef<HTMLInputElement>(null);
  const acceptedIds = new Set(acceptedFriendIds(profile.id, store));
  const acceptedFriends = [...acceptedIds].flatMap((id) => {
    const friend = socialProfileById(store, id);
    return friend ? [friend] : [];
  });
  const incomingRequests = store.friendships.filter((item) => item.status === "pending" && item.addresseeProfileId === profile.id);
  const outgoingIds = new Set(store.friendships.filter((item) => item.status === "pending" && item.requesterProfileId === profile.id).map((item) => item.addresseeProfileId));
  const connectedIds = new Set(store.friendships.flatMap((item) => item.requesterProfileId === profile.id ? [item.addresseeProfileId] : item.addresseeProfileId === profile.id ? [item.requesterProfileId] : []));
  const suggestedFriends = store.friendProfiles.filter((friend) => !connectedIds.has(friend.id));
  const exportData = () => {
    const payload = { schemaVersion: 1, profileId: profile.id, modelVersion: profile.modelVersion, weights: { ...DEFAULT_WEIGHTS, ...profile.weights }, ratingStatistics: { count: Object.keys(profile.ratings).length }, ratings: profile.ratings, questionnairePrior: profile.questionnaire, feedbackCount: feedback.length, immutableHistory: true };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${profile.name.toLowerCase()}-taste-model-v${profile.modelVersion}.json`; anchor.click(); URL.revokeObjectURL(url); onToast("Taste package exported");
  };
  const importConfig = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (parsed.schemaVersion !== 1 || !parsed.weights || typeof parsed.weights !== "object") throw new Error("Missing weights");
      const rawWeights = parsed.weights as Record<string, unknown>;
      const hasSupportedWeight = Object.keys(DEFAULT_WEIGHTS).some(
        (key) => typeof rawWeights[key] === "number" && Number.isFinite(rawWeights[key]),
      );
      if (!hasSupportedWeight) throw new Error("No supported weights");
      const currentConfig: RecommendationConfig = {
        ...defaultRecommendationConfig,
        modelVersion: String(profile.modelVersion),
        weights: { ...defaultRecommendationConfig.weights, ...profile.weights },
      };
      const imported = importTunedConfiguration(parsed, currentConfig);
      onChange({ ...profile, weights: imported.weights, modelVersion: profile.modelVersion + 1 });
      onToast(`Configuration imported as model v${profile.modelVersion + 1}. Raw history was untouched.`);
    } catch { onToast("That file is not a valid tuning configuration"); }
  };
  if (section === "services") return (
    <SettingsSubpage title="Streaming services" onBack={() => setSection("main")}>
      <p className="settings-intro">Availability is filtered for this profile only. The service catalog follows {profile.region}.</p>
      <ProviderSelector
        region={profile.region}
        selected={profile.subscriptions}
        onChange={(subscriptions) => onChange({ ...profile, subscriptions })}
        mode="list"
      />
    </SettingsSubpage>
  );
  if (section === "friends") return <SettingsSubpage title="Friends" onBack={() => setSection("main")}><FriendsSettingsContent acceptedFriends={acceptedFriends} incomingRequests={incomingRequests} outgoingIds={outgoingIds} suggestedFriends={suggestedFriends} store={store} onFriendship={onFriendship} /></SettingsSubpage>;
  if (section === "algorithm") return <SettingsSubpage title="Algorithm Lab" onBack={() => setSection("main")}><p className="settings-intro">Tune the model without ever rewriting your ratings or watch history.</p><div className="model-card"><div><p className="kicker">CURRENT</p><h3>Model v{profile.modelVersion}</h3><span>Deterministic · profile isolated</span></div><strong>{Object.keys(profile.ratings).length}<small> ratings</small></strong></div><div className="performance-grid"><div><strong>{feedback.length}</strong><span>Feedback events</span></div><div><strong>{Object.keys(profile.questionnaire).length}</strong><span>Taste signals</span></div><div><strong>10</strong><span>Ranked lanes</span></div></div><button className="settings-action" onClick={exportData}><span><Download size={18} /><span><strong>Export training package</strong><small>Ratings, predictions, signals, and current weights</small></span></span><ChevronRight size={17} /></button><button className="settings-action" onClick={() => importRef.current?.click()}><span><Upload size={18} /><span><strong>Import tuned configuration</strong><small>Only approved weights and thresholds can change</small></span></span><ChevronRight size={17} /></button><input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => importConfig(event.target.files?.[0])} /><div className="safety-note"><ShieldCheck size={18} /><p><strong>History safety is enforced.</strong> Imported files cannot overwrite ratings, watched history, recommendation history, or raw feedback.</p></div></SettingsSubpage>;
  if (section === "privacy") return <SettingsSubpage title="Privacy" onBack={() => setSection("main")}><PrivacySettingsContent profile={profile} onChange={onChange} /></SettingsSubpage>;
  if (section === "attributions") return <SettingsSubpage title="Attributions" onBack={() => setSection("main")}><div className="attribution-card"><a className="attribution-logo-link" href="https://www.themoviedb.org" target="_blank" rel="noreferrer" aria-label="Visit The Movie Database"><Image className="tmdb-attribution-logo" src="/brand/tmdb-blue-square.svg" alt="The Movie Database (TMDB)" width={185} height={133} /></a><p>This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. Title metadata, posters, and related imagery may be supplied by TMDB.</p></div><div className="attribution-card"><strong>JustWatch</strong><p>Watch-provider data exposed through TMDB may be powered by JustWatch. Availability can change and should be rechecked before viewing.</p></div><p className="settings-intro">What to Watch is an independent application and does not claim endorsement from any streaming service or editorial collection.</p></SettingsSubpage>;
  const rows = [
    { label: "Account", detail: "Sign in or continue in demo", icon: CircleUserRound, action: () => router.push("/account") },
    { label: "Profiles", detail: profile.guest ? "Guest" : "Household", icon: UsersRound, action: onProfiles },
    { label: "Streaming services", detail: `${profile.subscriptions.length} selected`, icon: Tv, action: () => setSection("services") },
    { label: "Friends", detail: acceptedFriends.length ? `${acceptedFriends.length} connected` : "Discovery without a feed", icon: UserCheck, action: () => setSection("friends") },
    { label: "Algorithm Lab", detail: `Model v${profile.modelVersion}`, icon: BarChart3, action: () => setSection("algorithm") },
    { label: "Privacy", detail: "No LLM · no analytics", icon: LockKeyhole, action: () => setSection("privacy") },
    { label: "Attributions", detail: "TMDB · JustWatch", icon: Info, action: () => setSection("attributions") },
  ];
  return (
    <main className="settings-screen page-content"><div className="page-heading"><p className="kicker">{profile.name.toUpperCase()}&apos;S PROFILE</p><h1>Settings.</h1><p>Subscriptions and taste stay separate for every viewer.</p></div><section className="settings-group"><h2>Viewing</h2><label className="setting-select"><span><strong>Region</strong><small>Used for provider availability</small></span><select value={profile.region} onChange={(event) => onChange({ ...profile, region: event.target.value })}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="AU">Australia</option></select></label><div className="rental-setting"><div><strong>Rental recommendations</strong><small>When should paid picks appear?</small></div>{(["never", "exceptional", "always"] as RentalMode[]).map((mode) => <button key={mode} className={profile.rentalMode === mode ? "is-active" : ""} onClick={() => onChange({ ...profile, rentalMode: mode })}><span>{mode === "never" ? "Never" : mode === "exceptional" ? "Only exceptional matches" : "Always consider"}</span>{profile.rentalMode === mode && <Check size={14} />}</button>)}</div></section><section className="settings-group"><h2>Account & data</h2>{rows.map((row) => { const Icon = row.icon; return <button className="settings-row" key={row.label} onClick={row.action}><Icon size={18} /><span><strong>{row.label}</strong><small>{row.detail}</small></span><ChevronRight size={17} /></button>; })}<button className="settings-row" onClick={exportData}><Download size={18} /><span><strong>Export taste data</strong><small>Portable JSON</small></span><ChevronRight size={17} /></button></section>{profile.guest && <button className="secondary-button convert-button" onClick={() => { onChange({ ...profile, guest: false }); onToast("Guest converted to a permanent profile"); }}>Convert guest profile</button>}<p className="app-version">WHAT TO WATCH · SOCIAL DISCOVERY</p></main>
  );
}

function SettingsSubpage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return <main className="settings-screen page-content settings-subpage"><div className="subpage-heading"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button><h1>{title}</h1></div>{children}</main>;
}

function PostRatingSheet({ title, rating, friends, initialReview, onClose, onSave }: { title: Title; rating: number; friends: SocialProfile[]; initialReview?: string; onClose: () => void; onSave: (value: { review: string; recipientIds: string[]; note: string }) => void }) {
  const [review, setReview] = useState(initialReview ?? "");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const reviewSentenceCount = review.trim() ? Math.max(1, review.trim().split(/[.!?]+(?:\s+|$)/).filter(Boolean).length) : 0;
  const reviewIsTooLong = reviewSentenceCount > 4;
  const toggleFriend = (friendId: string) => setRecipientIds((current) => current.includes(friendId) ? current.filter((id) => id !== friendId) : [...current, friendId]);
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={`Share your reaction to ${title.name}`}>
      <div className="sheet post-rating-sheet">
        <div className="sheet__header"><div><p className="kicker">YOU RATED IT {rating}/10</p><h2>A good one. Pass it on?</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        <p className="settings-intro">A short personal reaction can help a friend decide when this title fits their night. Everything here is optional.</p>
        <label className="social-textarea"><span><MessageSquareText size={16} /><strong>Add a short review</strong><small>Keep it personal—one to four sentences.</small></span><textarea value={review} maxLength={360} onChange={(event) => setReview(event.target.value)} placeholder="Best thing I’ve seen all week. Don’t read anything about it first." /><small className={reviewIsTooLong ? "is-error" : ""}>{reviewSentenceCount || 0}/4 sentences · {review.length}/360</small></label>
        {friends.length > 0 && <fieldset className="friend-picker"><legend><Send size={16} /> Recommend to a friend</legend>{friends.map((friend) => { const active = recipientIds.includes(friend.id); return <button type="button" key={friend.id} className={active ? "is-active" : ""} onClick={() => toggleFriend(friend.id)} aria-pressed={active}><SocialAvatar profile={friend} /><span><strong>{friend.name}</strong><small>{active ? "Will receive this when it’s useful" : "Select"}</small></span>{active && <Check size={16} />}</button>; })}</fieldset>}
        {recipientIds.length > 0 && <label className="social-textarea social-textarea--note"><span><strong>Personal note</strong><small>Optional, and visible only to the friends you selected.</small></span><textarea value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} placeholder="This feels exactly like your kind of movie." /><small>{note.length}/240</small></label>}
        <div className="social-no-inbox"><ShieldCheck size={16} /><p><strong>No inbox or notification is created.</strong> Your recommendation appears only when this title is contextually useful.</p></div>
        <div className="post-rating-actions"><button className="text-button" onClick={onClose}>Not now</button><button className="primary-button" disabled={reviewIsTooLong || (!review.trim() && recipientIds.length === 0)} onClick={() => onSave({ review: review.trim(), recipientIds, note: note.trim() })}>Save{recipientIds.length ? " & recommend" : " note"} <ChevronRight size={17} /></button></div>
      </div>
    </div>
  );
}

function FeedbackSheet({ title, onClose, onSubmit }: { title?: Title; onClose: () => void; onSubmit: (value: { reason?: RecommendationFeedbackReason; recommendationScore?: number; label: string }) => void }) {
  return <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Recommendation feedback"><div className="sheet feedback-sheet"><div className="sheet__header"><div><p className="kicker">HELP THE NEXT PICK</p><h2>{title ? `How did ${title.name} land?` : "Tell us more"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div><div className="feedback-grid">{FEEDBACK_OPTIONS.map((option) => <button key={option.reason} onClick={() => onSubmit({ ...option })}>{option.label}<ChevronRight size={15} /></button>)}</div><div className="recommendation-score"><strong>How good was this recommendation?</strong><RatingPicker onRate={(recommendationScore) => onSubmit({ recommendationScore, label: `Recommendation rated ${recommendationScore}/10` })} /></div></div></div>;
}

export function WhatToWatchApp() {
  const [store, setStore] = useState<AppStore>({ profiles: seedProfiles, feedback: [], friendProfiles: seedFriendProfiles, friendships: seedFriendships, friendReviews: seedFriendReviews, friendRecommendations: seedFriendRecommendations });
  const [hydrated, setHydrated] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [showProfiles, setShowProfiles] = useState(true);
  const [profileEditor, setProfileEditor] = useState<"create" | "manage" | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [selectedVibe, setSelectedVibe] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [seenRecommendationIds, setSeenRecommendationIds] = useState<string[]>([]);
  const [hasMoreRecommendations, setHasMoreRecommendations] = useState(false);
  const [resultPage, setResultPage] = useState(0);
  const [resultActors, setResultActors] = useState<string[]>([]);
  const [detailsTitle, setDetailsTitle] = useState<Title | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [feedbackTitle, setFeedbackTitle] = useState<Title | undefined>();
  const [showFeedback, setShowFeedback] = useState(false);
  const [postRating, setPostRating] = useState<{ title: Title; rating: number } | null>(null);
  const [toast, setToast] = useState("");
  const [, forceCatalogRender] = useState(0);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<AppStore>;
          if (Array.isArray(parsed.profiles)) setStore({
            profiles: parsed.profiles.map((savedProfile) => ({
              ...savedProfile,
              favoriteActors: Array.isArray(savedProfile.favoriteActors) ? savedProfile.favoriteActors : [],
              shareWithFriends: savedProfile.shareWithFriends ?? "ratings_and_reviews",
            })),
            feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
            friendProfiles: Array.isArray(parsed.friendProfiles) ? parsed.friendProfiles : seedFriendProfiles,
            friendships: Array.isArray(parsed.friendships) ? parsed.friendships : seedFriendships,
            friendReviews: Array.isArray(parsed.friendReviews) ? parsed.friendReviews : seedFriendReviews,
            friendRecommendations: Array.isArray(parsed.friendRecommendations) ? parsed.friendRecommendations : seedFriendRecommendations,
          });
        }
      } catch { /* Keep safe seed state if local storage is unavailable. */ }
      setHydrated(true);
    }, 0);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => window.clearTimeout(initialize);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    fetch("/api/catalog/recommendation-titles", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
        return response.json() as Promise<{ source?: string; titleCount?: number; titles?: Title[] }>;
      })
      .then((payload) => {
        if (
          !Array.isArray(payload.titles)
          || !Number.isInteger(payload.titleCount)
          || (payload.titleCount ?? 0) < 100
          || payload.titles.length !== payload.titleCount
        ) {
          throw new Error("Catalog payload is incomplete");
        }
        catalog = payload.titles;
        setStore((current) => migrateCatalogTitleIds(current, payload.titles ?? []));
        forceCatalogRender((value) => value + 1);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Keep the reviewed demo catalog as a safe fallback if the remote catalog is unavailable.
      });
    return () => controller.abort();
  }, [hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }, [store, hydrated]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2800); return () => window.clearTimeout(timer); }, [toast]);

  const profile = store.profiles.find((item) => item.id === activeProfileId) ?? null;
  const updateProfile = (next: ViewerProfile) => setStore((current) => ({ ...current, profiles: current.profiles.map((item) => item.id === next.id ? next : item) }));
  const chooseProfile = (next: ViewerProfile) => { setActiveProfileId(next.id); setShowProfiles(false); setScreen("home"); };
  const addProfile = (next: ViewerProfile) => { setStore((current) => ({ ...current, profiles: [...current.profiles, next] })); setActiveProfileId(next.id); setProfileEditor(null); setShowProfiles(false); };
  const deleteProfile = (id: string) => { if (store.profiles.length <= 1) { setToast("Keep at least one profile"); return; } setStore((current) => ({ ...current, profiles: current.profiles.filter((item) => item.id !== id), feedback: current.feedback.filter((item) => item.profileId !== id), friendships: current.friendships.filter((item) => item.requesterProfileId !== id && item.addresseeProfileId !== id), friendReviews: current.friendReviews.filter((item) => item.authorProfileId !== id), friendRecommendations: current.friendRecommendations.filter((item) => item.senderProfileId !== id && item.recipientProfileId !== id) })); if (activeProfileId === id) { setActiveProfileId(null); setShowProfiles(true); } };
  const rate = (id: string, score: number) => { if (!profile) return; const title = titleById(id); updateProfile({ ...profile, ratings: { ...profile.ratings, [id]: score } }); setToast(`${title?.name ?? "Title"} rated ${score}/10`); if (title && score >= 8) setPostRating({ title, rating: score }); };
  const showRecommendationPage = (result: Recommendation[], actors: string[] = [], page = 0) => {
    const visible = result.slice(0, 10);
    setResultActors(actors);
    setRecommendations(visible);
    setSeenRecommendationIds((current) => page === 0 ? visible.map((item) => item.title.id) : [...current, ...visible.map((item) => item.title.id)]);
    setHasMoreRecommendations(result.length > 10);
    setResultPage(page);
    setScreen("results");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const find = () => {
    if (!profile) return;
    showRecommendationPage(buildRecommendations(profile, selectedMoods, selectedVibe || "Surprise", store, { limit: 11 }));
  };
  const findWithActors = (actors: string[]) => {
    if (!profile) return;
    const favoriteActors = [...new Set(actors.map((actor) => actor.trim()).filter(Boolean))];
    const nextProfile = { ...profile, favoriteActors };
    updateProfile(nextProfile);
    showRecommendationPage(buildRecommendations(nextProfile, [], "Surprise", store, { favoriteActors, limit: 11 }), favoriteActors);
  };
  const anotherTen = () => {
    if (!profile) return;
    const result = buildRecommendations(profile, resultActors.length ? [] : selectedMoods, resultActors.length ? "Surprise" : selectedVibe || "Surprise", store, {
      favoriteActors: resultActors,
      excludeTitleIds: seenRecommendationIds,
      limit: 11,
    });
    if (!result.length) { setHasMoreRecommendations(false); return; }
    showRecommendationPage(result, resultActors, resultPage + 1);
  };
  const recordFeedback = (title: Title, value: { reason?: RecommendationFeedbackReason; recommendationScore?: number; label: string }) => {
    if (!profile) return;
    const event: FeedbackEvent = {
      id: crypto.randomUUID(),
      profileId: profile.id,
      titleId: title.id,
      reason: value.reason,
      recommendationScore: value.recommendationScore,
      moods: resultActors.length ? [] : [...selectedMoods],
      vibe: resultActors.length ? "Surprise" : selectedVibe || "Surprise",
      createdAt: new Date().toISOString(),
    };
    setStore((current) => ({ ...current, feedback: [...current.feedback, event] }));
    setRecommendations((current) => current.filter((recommendation) => recommendation.title.id !== title.id));
    setToast(`Feedback saved: ${value.label}`);
  };
  const feedback = (message: string, title?: Title) => {
    if (title && message === "Not interested" && profile) {
      recordFeedback(title, { reason: "not-interested", label: "Not interested" });
      return;
    }
    if (title) { setFeedbackTitle(title); setShowFeedback(true); } else setToast(message);
  };
  const changeFriendship = (friendId: string, action: "request" | "accept" | "decline" | "remove") => {
    if (!profile) return;
    const timestamp = new Date().toISOString();
    setStore((current) => {
      if (action === "remove") return { ...current, friendships: current.friendships.filter((item) => !((item.requesterProfileId === profile.id && item.addresseeProfileId === friendId) || (item.requesterProfileId === friendId && item.addresseeProfileId === profile.id))) };
      if (action === "request") {
        const existing = current.friendships.find((item) => (item.requesterProfileId === profile.id && item.addresseeProfileId === friendId) || (item.requesterProfileId === friendId && item.addresseeProfileId === profile.id));
        if (existing) return { ...current, friendships: current.friendships.map((item) => item.id === existing.id ? { ...item, requesterProfileId: profile.id, addresseeProfileId: friendId, status: "pending", createdAt: timestamp, respondedAt: undefined } : item) };
        return { ...current, friendships: [...current.friendships, { id: crypto.randomUUID(), requesterProfileId: profile.id, addresseeProfileId: friendId, status: "pending", createdAt: timestamp }] };
      }
      return { ...current, friendships: current.friendships.map((item) => item.status === "pending" && item.requesterProfileId === friendId && item.addresseeProfileId === profile.id ? { ...item, status: action === "accept" ? "accepted" : "declined", respondedAt: timestamp } : item) };
    });
    setToast(action === "request" ? "Friend request sent" : action === "accept" ? "Friend added" : action === "remove" ? "Friend removed" : "Request declined");
  };
  const saveSocialReaction = ({ review, recipientIds, note }: { review: string; recipientIds: string[]; note: string }) => {
    if (!profile || !postRating) return;
    const timestamp = new Date().toISOString();
    setStore((current) => {
      const existingReviews = review ? current.friendReviews.filter((item) => !(item.authorProfileId === profile.id && item.titleId === postRating.title.id)) : current.friendReviews;
      const friendReviews = review ? [...existingReviews, { id: crypto.randomUUID(), authorProfileId: profile.id, titleId: postRating.title.id, rating: postRating.rating, note: review, createdAt: timestamp }] : existingReviews;
      const recipientSet = new Set(recipientIds);
      const retainedRecommendations = current.friendRecommendations.filter((item) => !(item.senderProfileId === profile.id && item.titleId === postRating.title.id && recipientSet.has(item.recipientProfileId)));
      const friendRecommendations = [...retainedRecommendations, ...recipientIds.map((recipientProfileId) => ({ id: crypto.randomUUID(), senderProfileId: profile.id, recipientProfileId, titleId: postRating.title.id, note: note || undefined, createdAt: timestamp }))];
      return { ...current, friendReviews, friendRecommendations };
    });
    setPostRating(null);
    setToast(recipientIds.length ? `Recommended to ${recipientIds.length} friend${recipientIds.length === 1 ? "" : "s"}` : "Review saved");
  };

  if (!hydrated) return <div className="app-loading"><Logo /><span /></div>;
  if (showProfiles || !profile) return <><ProfilePicker profiles={store.profiles} onSelect={chooseProfile} onCreate={() => setProfileEditor("create")} onEdit={() => setProfileEditor("manage")} />{profileEditor && <ProfileEditor profiles={store.profiles} mode={profileEditor} onClose={() => setProfileEditor(null)} onSave={addProfile} onUpdate={updateProfile} onDelete={deleteProfile} />}{toast && <div className="toast"><Check size={16} />{toast}</div>}</>;
  if (!profile.onboardingCompleted) return <Onboarding profile={profile} onChange={updateProfile} onFinish={() => setScreen("home")} />;

  return (
    <div className="app-shell">
      <AppHeader profile={profile} onProfiles={() => setShowProfiles(true)} onMenu={() => setScreen("settings")} />
      {screen === "home" && <HomeScreen profile={profile} selectedMoods={selectedMoods} setSelectedMoods={setSelectedMoods} selectedVibe={selectedVibe} setSelectedVibe={setSelectedVibe} onFind={find} onActorFind={() => setScreen("actor")} />}
      {screen === "actor" && <ActorDiscoveryScreen profile={profile} onChange={(favoriteActors) => updateProfile({ ...profile, favoriteActors })} onFind={findWithActors} onBack={() => setScreen("home")} />}
      {screen === "results" && <ResultsScreen profile={profile} recommendations={recommendations} focusActors={resultActors} page={resultPage} hasMore={hasMoreRecommendations} onMore={anotherTen} onBack={() => setScreen(resultActors.length ? "actor" : "home")} onDetails={setDetailsTitle} onFeedback={feedback} />}
      {screen === "rate" && <RateScreen profile={profile} onRate={rate} onDetails={setDetailsTitle} />}
      {screen === "taste" && <TasteScreen profile={profile} onRate={() => setScreen("rate")} />}
      {screen === "settings" && <SettingsScreen profile={profile} feedback={store.feedback.filter((item) => item.profileId === profile.id)} store={store} onChange={updateProfile} onProfiles={() => setProfileEditor("manage")} onToast={setToast} onFriendship={changeFriendship} />}
      <BottomNav screen={screen} onChange={(next) => { setScreen(next); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      {detailsTitle && <DetailsSheet profile={profile} title={detailsTitle} friendContext={friendEvidence(profile, detailsTitle.id, store).context} onClose={() => setDetailsTitle(null)} onPerson={(name) => { setPerson(name); setDetailsTitle(null); }} onRate={(score) => rate(detailsTitle.id, score)} onRecommend={() => setPostRating({ title: detailsTitle, rating: profile.ratings[detailsTitle.id] })} />}
      {person && <PersonSheet person={person} profile={profile} onClose={() => setPerson(null)} onTitle={(title) => { setPerson(null); setDetailsTitle(title); }} />}
      {profileEditor && <ProfileEditor profiles={store.profiles} mode={profileEditor} onClose={() => setProfileEditor(null)} onSave={addProfile} onUpdate={updateProfile} onDelete={deleteProfile} />}
      {showFeedback && <FeedbackSheet title={feedbackTitle} onClose={() => setShowFeedback(false)} onSubmit={(value) => {
        if (feedbackTitle) recordFeedback(feedbackTitle, value);
        setShowFeedback(false);
      }} />}
      {postRating && <PostRatingSheet title={postRating.title} rating={postRating.rating} friends={acceptedFriendIds(profile.id, store).flatMap((id) => { const friend = socialProfileById(store, id); return friend ? [friend] : []; })} initialReview={store.friendReviews.find((item) => item.authorProfileId === profile.id && item.titleId === postRating.title.id)?.note} onClose={() => setPostRating(null)} onSave={saveSocialReaction} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}
