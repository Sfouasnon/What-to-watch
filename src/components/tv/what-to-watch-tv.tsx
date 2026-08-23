"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, Play, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppCatalogTitle, AppLaunchTarget } from "@/lib/catalog/recommendation-catalog";
import type { WatchProviderCatalogItem, WatchProviderCatalogResult } from "@/lib/tmdb";
import {
  CURATED_MIXED_ACTOR_SEEDS,
  filterTitlesForFavoriteActors,
  filterTitlesForFavoriteDirectors,
  hasProminentActor,
  leadTitlesForActors,
  representativeTitlesForDirectors,
} from "@/lib/recommendation/actor-discovery";
import { defaultRecommendationConfig, recommendForProfile } from "@/lib/recommendation/engine";
import { assemblePersonRecommendations, canonicalTitleKey, newReleasePool, newReleaseScore, suggestPerson } from "@/lib/recommendation/discovery";
import { mapQuestionnaireAnswers } from "@/lib/recommendation/intake";
import { ANSWER_LABELS, CORE_QUESTIONS } from "@/lib/recommendation/onboarding";
import type { Mood, Profile, Recommendation, Title as EngineTitle, Vibe } from "@/lib/recommendation/types";

import { BrandMark, BrandSting } from "../brand-sting";
import styles from "./what-to-watch-tv.module.css";

const STORAGE_KEY = "what-to-watch:v4";
const TV_PROFILE_KEY = "what-to-watch:tv-profile";
const CHECKED_AT = "2026-08-15T00:00:00.000Z";

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
  rentalMode: "never" | "exceptional" | "always";
  modelVersion: number;
};

type StoredApp = Record<string, unknown> & {
  profiles?: ViewerProfile[];
  friendRecommendations?: Array<{ recipientProfileId?: string; titleId?: string }>;
};
type ContentMode = "both" | "movies" | "tv";
type PeopleRole = "actor" | "director";
type Screen = "profiles" | "create-profile" | "services" | "questionnaire" | "home" | "browse" | "people" | "moods" | "vibes" | "results" | "watch";

type ResultContext = {
  contentMode: ContentMode;
  moods: string[];
  vibe: string;
  favoriteActors?: string[];
  favoriteDirectors?: string[];
  newReleases?: boolean;
};

type PersonOption = {
  key: string;
  name: string;
  poster: string;
  titleName: string;
  evidence: number;
  popularity: number;
};

const MOODS = ["Comedy", "Stand-up", "Drama", "Thriller", "Action", "Horror"] as const;
const VIBES = [
  { id: "Favorite", eyebrow: "REWATCH", label: "A familiar favorite" },
  { id: "Classic", eyebrow: "CANON", label: "Rediscover a classic" },
  { id: "New", eyebrow: "DISCOVER", label: "Try something new" },
  { id: "International", eyebrow: "WORLD", label: "Cinema beyond home" },
  { id: "Binge", eyebrow: "BINGE", label: "Settle in for a series" },
  { id: "Trending", eyebrow: "NOW", label: "Something in the moment" },
  { id: "Hidden", eyebrow: "DEEP CUT", label: "Find a hidden gem" },
  { id: "Surprise", eyebrow: "NO RULES", label: "Surprise me" },
] as const;

const VIBE_MAP: Record<string, Vibe> = {
  Favorite: "rewatch-favorite",
  Classic: "rediscover-classic",
  New: "try-something-new",
  International: "popular-international",
  Binge: "bingeable-tv",
  Trending: "trending-series",
  Hidden: "hidden-gem",
  Surprise: "surprise-me",
  Friends: "friends-picks",
};

const MINIMUM_STING_MS = 3200;
const POPULAR_SERVICES = ["Netflix", "Prime Video", "Hulu", "Disney+", "Max", "Apple TV+", "Peacock", "Paramount+", "Criterion Channel"] as const;
const LEGACY_PROVIDER_NAMES: Record<number, string> = {
  8: "Netflix",
  9: "Prime Video",
  15: "Hulu",
  258: "Criterion Channel",
  337: "Disney+",
  350: "Apple TV+",
  386: "Peacock",
  531: "Paramount+",
  1899: "Max",
  2303: "Paramount+",
};

function providerSelectionName(provider: WatchProviderCatalogItem) {
  return LEGACY_PROVIDER_NAMES[provider.providerId] ?? provider.providerName;
}

const QUESTION_TITLE_NAMES: Record<string, readonly string[]> = {
  cerebral: ["Inception", "Severance", "The Game", "Chinatown"],
  emotional: ["Manchester by the Sea", "Aftersun", "This Is Us", "The Last of Us"],
  darkness: ["Breaking Bad", "The Sopranos", "Sicario", "Nightcrawler"],
  slowPace: ["Better Call Saul", "Perfect Days", "The Power of the Dog", "There Will Be Blood"],
  character: ["Mad Men", "The Bear", "Lady Bird", "Lost in Translation"],
  ambiguity: ["The Leftovers", "Mulholland Drive", "Enemy", "The Sopranos"],
  discovery: ["Coherence", "The Vast of Night", "Patriot", "Rectify"],
  classics: ["12 Angry Men", "Casablanca", "The Twilight Zone", "Columbo"],
  international: ["Parasite", "Dark", "Squid Game", "Pan’s Labyrinth"],
  tvCommitment: ["The Wire", "The Sopranos", "Game of Thrones", "Better Call Saul"],
  binge: ["The Bear", "Beef", "Slow Horses", "Only Murders in the Building"],
};

const normalizeTitleName = (value: string) => value
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const hasUsableArtwork = (title: AppCatalogTitle) => !title.poster.endsWith("/icons/icon-512.png");

function titleMatchesMood(title: AppCatalogTitle, moods: readonly string[]) {
  if (!moods.length) return true;
  const terms = [title.kind, ...title.genres, title.primarySubgenre, title.secondarySubgenre, ...title.tags]
    .filter(Boolean)
    .map((value) => String(value).toLocaleLowerCase().replaceAll("-", " "));
  return moods.some((mood) => {
    const wanted = mood.toLocaleLowerCase().replaceAll("-", " ");
    return wanted === "stand up" ? title.kind === "Stand-up" : terms.some((term) => term.includes(wanted));
  });
}

function contentKindForMode(mode: ContentMode) {
  return mode === "movies" ? "Movie" : mode === "tv" ? "Series" : undefined;
}

function uniqueTvPicks<T extends { title: AppCatalogTitle }>(picks: readonly T[]) {
  const seen = new Set<string>();
  return picks.filter((pick) => {
    const key = canonicalTitleKey(pick.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function personOptions(
  catalog: readonly AppCatalogTitle[],
  profile: ViewerProfile,
  role: PeopleRole,
  mode: ContentMode,
  query: string,
) {
  const wantedKind = contentKindForMode(mode);
  const normalizedQuery = normalizeTitleName(query);
  const subscriptions = new Set(profile.subscriptions.map((provider) => provider.toLocaleLowerCase()));
  const people = new Map<string, PersonOption>();
  const eligibleTitles: AppCatalogTitle[] = [];
  for (const title of catalog) {
    if (wantedKind && title.kind !== wantedKind) continue;
    if (profile.ratings[title.id] !== undefined) continue;
    if (subscriptions.size && (title.availabilityType !== "subscription" || !title.providers.some((provider) => subscriptions.has(provider.toLocaleLowerCase())))) continue;
    if (!hasUsableArtwork(title)) continue;
    eligibleTitles.push(title);
    const names = role === "actor" ? title.cast : [title.director];
    for (const name of names) {
      if (!name || name === "Unknown director" || (role === "actor" && !hasProminentActor(title, name))) continue;
      const key = normalizeTitleName(name);
      if (!key || (normalizedQuery && !key.includes(normalizedQuery))) continue;
      const existing = people.get(key);
      if (!existing) {
        people.set(key, {
          key,
          name,
          poster: title.poster,
          titleName: title.name,
          evidence: 1,
          popularity: title.popularity,
        });
        continue;
      }
      const hadHigherPopularity = title.popularity > existing.popularity;
      existing.evidence += 1;
      existing.popularity = Math.max(existing.popularity, title.popularity);
      if (hadHigherPopularity) {
        existing.poster = title.poster;
        existing.titleName = title.name;
      }
    }
  }
  const suggested = suggestPerson(role, profile.ratings, catalog, catalog.filter((title) => !wantedKind || title.kind === wantedKind));
  const ranked = [...people.values()]
    .sort((a, b) => (suggested && a.key === normalizeTitleName(suggested) ? -1 : suggested && b.key === normalizeTitleName(suggested) ? 1 : b.evidence - a.evidence || b.popularity - a.popularity || a.name.localeCompare(b.name)));
  const seedOrder = new Map(CURATED_MIXED_ACTOR_SEEDS.map((name, index) => [normalizeTitleName(name), index]));
  const options = (role === "actor" && !normalizedQuery
    ? [...ranked].sort((a, b) => (seedOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (seedOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER) || ranked.indexOf(a) - ranked.indexOf(b))
    : ranked)
    .slice(0, 10);
  if (role === "director") {
    const representativeTitles = representativeTitlesForDirectors(eligibleTitles, options.map((option) => option.name));
    return options.map((option) => {
      const representativeTitle = representativeTitles.get(option.name);
      return representativeTitle ? { ...option, poster: representativeTitle.poster, titleName: representativeTitle.name } : option;
    });
  }
  const leadTitles = leadTitlesForActors(eligibleTitles, options.map((option) => option.name));
  return options.map((option) => {
    const leadTitle = leadTitles.get(option.name);
    return leadTitle ? { ...option, poster: leadTitle.poster, titleName: leadTitle.name } : option;
  });
}

function toEngineTitle(title: AppCatalogTitle, region: string): EngineTitle {
  const runtimeMinutes = Number(title.runtime.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/)?.slice(1).reduce((sum, part, index) => sum + Number(part ?? 0) * (index === 0 ? 60 : 1), 0)) || undefined;
  const watchOptions: AppCatalogTitle["watchOptions"] = title.watchOptions.length
    ? title.watchOptions
    : title.providers.map((provider) => ({ provider, offerType: "subscription" as const }));
  return {
    id: title.id,
    name: title.name,
    year: title.year,
    contentType: title.kind === "Movie" ? "movie" : title.kind === "Series" ? "series" : "stand-up",
    synopsis: title.synopsis,
    runtimeMinutes: title.kind === "Series" ? undefined : runtimeMinutes,
    episodeRuntimeMinutes: title.kind === "Series" ? runtimeMinutes : undefined,
    genres: title.genres,
    primarySubgenre: title.primarySubgenre,
    secondarySubgenre: title.secondarySubgenre,
    subgenres: [title.primarySubgenre, title.secondarySubgenre].filter((value): value is string => Boolean(value)),
    toneTags: title.toneTags,
    themes: [],
    pacing: title.pacing,
    countries: title.tags.includes("international") ? ["International"] : [region],
    languages: title.tags.includes("international") ? ["international"] : ["en"],
    directors: [title.director],
    writers: title.writers,
    cinematographers: title.cinematographer ? [title.cinematographer] : [],
    actors: title.cast,
    castContext: title.castContext,
    canonicalScore: title.canonicalScore,
    canonicalMemberships: (title.canonical ?? []).map((list) => ({
      list,
      source: list.startsWith("Rotten Tomatoes all-time #") ? "Rotten Tomatoes" : "catalog",
      version: "2026-08-15",
    })),
    criterionCollection: Boolean(title.criterion),
    popularity: title.popularity,
    trendingScore: title.popularity,
    availability: watchOptions.map((option) => ({
      serviceId: option.provider,
      region,
      kind: option.offerType === "purchase" ? "purchase" : option.offerType,
      checkedAt: CHECKED_AT,
      source: "tmdb",
    })),
    posterUrl: title.poster,
    backdropUrl: title.backdrop,
  };
}

function toEngineProfile(profile: ViewerProfile, favoriteActors: readonly string[] = [], favoriteDirectors: readonly string[] = []): Profile {
  return {
    id: profile.id,
    accountId: profile.id,
    displayName: profile.name,
    avatar: profile.avatar,
    createdAt: CHECKED_AT,
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
      ratedAt: CHECKED_AT,
      source: "search" as const,
    })),
    questionnaire: mapQuestionnaireAnswers(profile.questionnaire),
    favoritePeople: {
      actors: favoriteActors.length ? [...favoriteActors] : profile.favoriteActors ?? [],
      directors: [...favoriteDirectors],
      writers: [],
      cinematographers: [],
    },
  };
}

function buildRecommendations(
  catalog: AppCatalogTitle[],
  profile: ViewerProfile,
  moods: readonly string[],
  vibe: string,
  excludeTitleIds: readonly string[] = [],
  options: {
    contentKind?: "Movie" | "Series";
    favoriteActors?: readonly string[];
    favoriteDirectors?: readonly string[];
    newReleases?: boolean;
    limit?: number;
    strictPeople?: boolean;
    onlyTitleIds?: readonly string[];
  } = {},
) {
  let sourceCatalog = catalog;
  if (options.onlyTitleIds?.length) {
    const allowed = new Set(options.onlyTitleIds);
    sourceCatalog = sourceCatalog.filter((title) => allowed.has(title.id));
  }
  if (options.contentKind) sourceCatalog = sourceCatalog.filter((title) => title.kind === options.contentKind);
  const strictPeople = options.strictPeople ?? true;
  if (strictPeople && options.favoriteActors?.length) sourceCatalog = filterTitlesForFavoriteActors(sourceCatalog, options.favoriteActors, profile.subscriptions);
  if (strictPeople && options.favoriteDirectors?.length) sourceCatalog = filterTitlesForFavoriteDirectors(sourceCatalog, options.favoriteDirectors, profile.subscriptions);
  if (options.newReleases) sourceCatalog = newReleasePool(sourceCatalog);
  const titleById = new Map(sourceCatalog.map((title) => [title.id, title]));
  const mapped = recommendForProfile({
    profile: toEngineProfile(profile, options.favoriteActors, options.favoriteDirectors),
    catalog: sourceCatalog.map((title) => toEngineTitle(title, profile.region)),
    moods: moods.map((mood) => mood.toLowerCase() as Mood),
    vibes: [VIBE_MAP[vibe] ?? "surprise-me"],
    config: { ...defaultRecommendationConfig, modelVersion: String(profile.modelVersion) },
    excludeTitleIds,
    limit: options.limit ?? 11,
  }).flatMap((recommendation) => {
    const title = titleById.get(recommendation.title.id);
    return title ? [{ recommendation, title }] : [];
  });
  if (!options.newReleases) return mapped;
  return mapped.sort((a, b) =>
    newReleaseScore(b.title, b.recommendation.matchScore) - newReleaseScore(a.title, a.recommendation.matchScore)
    || a.title.name.localeCompare(b.title.name),
  );
}

function buildPersonRecommendations(
  catalog: AppCatalogTitle[],
  profile: ViewerProfile,
  context: ResultContext,
  excludeTitleIds: readonly string[],
) {
  const role = context.favoriteActors?.length ? "actor" : "director";
  const person = (role === "actor" ? context.favoriteActors : context.favoriteDirectors)?.[0];
  if (!person) return [];
  const sharedOptions = {
    contentKind: contentKindForMode(context.contentMode),
    favoriteActors: role === "actor" ? [person] : undefined,
    favoriteDirectors: role === "director" ? [person] : undefined,
    limit: 11,
  } as const;
  const exact = buildRecommendations(catalog, profile, context.moods, context.vibe, excludeTitleIds, sharedOptions);
  const inspired = buildRecommendations(
    catalog,
    profile,
    context.moods,
    context.vibe,
    [...excludeTitleIds, ...exact.map((item) => item.title.id)],
    { ...sharedOptions, strictPeople: false },
  );
  const titles = new Map([...exact, ...inspired].map((item) => [item.title.id, item.title]));
  return assemblePersonRecommendations(
    exact.map((item) => item.recommendation),
    inspired.map((item) => item.recommendation),
    { person, role, limit: 11 },
  ).flatMap((recommendation) => {
    const title = titles.get(recommendation.title.id);
    return title ? [{ recommendation, title }] : [];
  });
}

type TvPick = ReturnType<typeof buildRecommendations>[number];

type TvDiscoveryContent = {
  movieAndTv: TvPick[];
  movie?: TvPick;
  series?: TvPick;
  vibe: TvPick[];
  actor?: { name: string; picks: TvPick[] };
  director?: { name: string; picks: TvPick[] };
  newReleases: TvPick[];
  newReleasePreview: TvPick[];
  fallback: TvPick[];
};

function buildTvDiscoveryContent(catalog: AppCatalogTitle[], profile: ViewerProfile): TvDiscoveryContent {
  const movies = buildRecommendations(catalog, profile, [], "Surprise", [], { contentKind: "Movie", limit: 4 });
  const series = buildRecommendations(catalog, profile, [], "Surprise", [], { contentKind: "Series", limit: 4 });
  const fallback = uniqueTvPicks(buildRecommendations(catalog, profile, [], "Surprise", [], { limit: 24 }));
  const fallbackTitles = uniqueTvPicks([...movies, ...series, ...fallback]).map((item) => item.title);
  const actorName = profile.favoriteActors[0]
    ?? personOptions(catalog, profile, "actor", "both", "")[0]?.name
    ?? suggestPerson("actor", profile.ratings, catalog, fallbackTitles);
  const directorName = personOptions(catalog, profile, "director", "both", "")[0]?.name
    ?? suggestPerson("director", profile.ratings, catalog, fallbackTitles);
  const actorPicks = actorName
    ? buildRecommendations(catalog, profile, [], "Surprise", [], { favoriteActors: [actorName], limit: 10 })
    : [];
  const directorPicks = directorName
    ? buildRecommendations(catalog, profile, [], "Surprise", [], { favoriteDirectors: [directorName], limit: 10 })
    : [];
  const newReleases = buildRecommendations(catalog, profile, [], "New", [], { newReleases: true, limit: 10 });
  const newMovie = newReleases.find((item) => item.title.kind === "Movie");
  const newSeries = newReleases.find((item) => item.title.kind === "Series");
  const newReleasePreview = [newMovie, newSeries].filter((item): item is TvPick => Boolean(item));

  const movieAndTv = uniqueTvPicks([movies[0], series[0], ...fallback].filter((item): item is TvPick => Boolean(item)))
    .slice(0, 2)
    .map((item, index) => ({ ...item, recommendation: { ...item.recommendation, rank: index + 1 } }));

  return {
    movieAndTv,
    movie: movies[1] ?? movies[0],
    series: series[1] ?? series[0],
    vibe: [movies[2] ?? movies[0], series[2] ?? series[0]].filter((item): item is TvPick => Boolean(item)),
    ...(actorName ? { actor: { name: actorName, picks: actorPicks } } : {}),
    ...(directorName ? { director: { name: directorName, picks: directorPicks } } : {}),
    newReleases,
    newReleasePreview: newReleasePreview.length ? newReleasePreview : newReleases.slice(0, 2),
    fallback,
  };
}

function focusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("[data-tv-focus]:not([disabled])")].filter((element) => element.offsetParent !== null);
}

function useTvNavigation(
  screen: Screen,
  ready: boolean,
  onBack: () => void,
  onHorizontal?: (direction: -1 | 1) => void,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef(onBack);
  const horizontalRef = useRef(onHorizontal);

  useEffect(() => {
    backRef.current = onBack;
    horizontalRef.current = onHorizontal;
  }, [onBack, onHorizontal]);

  useEffect(() => {
    if (!ready) return;
    const root = rootRef.current;
    if (!root) return;
    const initialFocus = window.requestAnimationFrame(() => focusableElements(root)[0]?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (["Escape", "Backspace", "BrowserBack"].includes(event.key)) {
        event.preventDefault();
        backRef.current();
        return;
      }
      if (event.key === "Enter" && active?.matches("[data-tv-focus]")) {
        event.preventDefault();
        if (!event.repeat) active.click();
        return;
      }
      if (horizontalRef.current && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        horizontalRef.current(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const controls = focusableElements(root);
      if (!controls.length) return;
      if (!active || !controls.includes(active)) {
        controls[0].focus();
        return;
      }
      const current = active.getBoundingClientRect();
      const currentX = current.left + current.width / 2;
      const currentY = current.top + current.height / 2;
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const candidate = controls
        .filter((element) => element !== active)
        .map((element) => {
          const box = element.getBoundingClientRect();
          const dx = box.left + box.width / 2 - currentX;
          const dy = box.top + box.height / 2 - currentY;
          const primary = vertical ? dy : dx;
          const secondary = vertical ? dx : dy;
          return { element, primary, score: Math.abs(primary) + Math.abs(secondary) * 2.5 };
        })
        .filter((item) => item.primary * direction > 4)
        .sort((a, b) => a.score - b.score)[0]?.element;
      if (!candidate) return;
      candidate.focus({ preventScroll: true });
      candidate.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(initialFocus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ready, screen]);

  return rootRef;
}

function safeHttpUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function launchWatchTarget(target: AppLaunchTarget | undefined) {
  const nativeBridge = (window as Window & {
    WhatToWatchNative?: {
      openExternal: (url: string) => void;
      openLaunchTarget: (payload: string) => void;
    };
  }).WhatToWatchNative;
  if (target && nativeBridge) {
    nativeBridge.openLaunchTarget(JSON.stringify(target));
    return true;
  }
  const browserUrl = safeHttpUrl(target?.platform === "web" ? target.targetUri : target?.webUrl);
  if (!browserUrl) return false;
  if (nativeBridge) nativeBridge.openExternal(browserUrl);
  else window.location.assign(browserUrl);
  return true;
}

function TvDiscoveryCard({
  eyebrow,
  title,
  description,
  picks,
  onSelect,
}: {
  eyebrow: string;
  title: string;
  description: string;
  picks: TvPick[];
  onSelect: () => void;
}) {
  return (
    <button data-tv-focus className={styles.discoveryCard} onClick={onSelect}>
      <span className={`${styles.discoveryPosters} ${picks.length > 1 ? styles.discoveryPostersPair : ""}`} aria-hidden="true">
        {picks.slice(0, 2).map((pick) => <span className={styles.discoveryPoster} key={pick.title.id}><Image src={pick.title.poster} alt="" fill sizes="18vw" quality={90} /></span>)}
        <span className={styles.discoveryShade} />
      </span>
      <span className={styles.discoveryCopy}><small>{eyebrow}</small><strong>{title}</strong><span>{description}</span></span>
      <ArrowRight className={styles.discoveryArrow} />
    </button>
  );
}

export function WhatToWatchTv() {
  const storedAppRef = useRef<StoredApp>({});
  const [catalog, setCatalog] = useState<AppCatalogTitle[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<WatchProviderCatalogItem[]>([]);
  const [profiles, setProfiles] = useState<ViewerProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [screen, setScreen] = useState<Screen>("profiles");
  const [contentMode, setContentMode] = useState<ContentMode>("both");
  const [peopleRole, setPeopleRole] = useState<PeopleRole>("actor");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [draftProfile, setDraftProfile] = useState<ViewerProfile | null>(null);
  const [serviceReturn, setServiceReturn] = useState<"questionnaire" | "home">("questionnaire");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, number>>({});
  const [moods, setMoods] = useState<string[]>([]);
  const [vibe, setVibe] = useState("Surprise");
  const [results, setResults] = useState<Array<{ recommendation: Recommendation; title: AppCatalogTitle }>>([]);
  const [resultIndex, setResultIndex] = useState(0);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [resultContext, setResultContext] = useState<ResultContext | null>(null);
  const [watchNotice, setWatchNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const profile = profiles.find((item) => item.id === profileId);
  const moodCoverage = useMemo(() => new Map(MOODS.map((mood) => [
    mood,
    catalog.filter((title) => titleMatchesMood(title, [mood])).length,
  ])), [catalog]);
  const discovery = useMemo(
    () => profile ? buildTvDiscoveryContent(catalog, profile) : null,
    [catalog, profile],
  );
  const serviceOptions = useMemo(() => {
    const available = new Set(catalog.flatMap((title) => title.providers).filter(Boolean));
    const preferredOrder = new Map(POPULAR_SERVICES.map((service, index) => [service.toLocaleLowerCase(), index]));
    const liveBySelectionName = new Map(providerCatalog.map((provider) => [providerSelectionName(provider).toLocaleLowerCase(), provider]));
    const names = new Set([
      ...POPULAR_SERVICES,
      ...available,
      ...providerCatalog.slice(0, 24).map(providerSelectionName),
    ]);
    return [...names]
      .map((name) => ({ name, provider: liveBySelectionName.get(name.toLocaleLowerCase()) }))
      .sort((left, right) =>
        (preferredOrder.get(left.name.toLocaleLowerCase()) ?? left.provider?.displayPriority ?? Number.MAX_SAFE_INTEGER)
        - (preferredOrder.get(right.name.toLocaleLowerCase()) ?? right.provider?.displayPriority ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name),
      );
  }, [catalog, providerCatalog]);
  const goBack = useCallback(() => {
    if (screen === "watch") setScreen("results");
    else if (screen === "results") setScreen("browse");
    else if (screen === "vibes") setScreen("moods");
    else if (screen === "moods") setScreen("home");
    else if (screen === "people") setScreen("browse");
    else if (screen === "browse") setScreen("home");
    else if (screen === "home") setScreen("profiles");
    else if (screen === "questionnaire" && questionIndex > 0) setQuestionIndex((current) => current - 1);
    else if (screen === "questionnaire") setScreen("services");
    else if (screen === "services") setScreen(serviceReturn === "home" ? "home" : "create-profile");
    else setScreen("profiles");
  }, [questionIndex, screen, serviceReturn]);

  useEffect(() => {
    const controller = new AbortController();
    const initialize = window.setTimeout(() => {
      const stingStartedAt = window.performance.now();
      let storedProfiles: ViewerProfile[] = [];
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredApp;
        storedAppRef.current = stored;
        storedProfiles = (stored.profiles ?? []).filter((item) => item.onboardingCompleted);
        setProfiles(storedProfiles);
        const preferred = localStorage.getItem(TV_PROFILE_KEY);
        if (preferred && storedProfiles.some((item) => item.id === preferred)) setProfileId(preferred);
      } catch { /* A profile can still be created in the web setup flow. */ }

      fetch("/api/catalog/recommendation-titles", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
          return response.json() as Promise<{ titleCount: number; titles: AppCatalogTitle[] }>;
        })
        .then(async (payload) => {
          if (!Array.isArray(payload.titles) || payload.titles.length !== payload.titleCount) throw new Error("Catalog payload is incomplete");
          const remainingStingTime = Math.max(0, MINIMUM_STING_MS - (window.performance.now() - stingStartedAt));
          if (remainingStingTime) await new Promise((resolve) => window.setTimeout(resolve, remainingStingTime));
          setCatalog(payload.titles);
          if (!storedProfiles.length) {
            setProfiles([{ id: "tv-guest", name: "TV Guest", avatar: "T", color: "ochre", guest: true, onboardingCompleted: true, region: "US", subscriptions: [], favoriteActors: [], ratings: {}, questionnaire: {}, rentalMode: "never", modelVersion: 1 }]);
          }
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setError("The catalog could not be loaded. Check the television connection and try again.");
          setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(initialize);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const region = draftProfile?.region ?? profile?.region ?? "US";
    fetch(`/api/tmdb/providers?region=${encodeURIComponent(region)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Provider catalog returned ${response.status}`);
        return response.json() as Promise<WatchProviderCatalogResult>;
      })
      .then((payload) => setProviderCatalog(payload.providers))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setProviderCatalog([]);
      });
    return () => controller.abort();
  }, [draftProfile?.region, profile?.region]);

  const chooseProfile = (next: ViewerProfile) => {
    setProfileId(next.id);
    localStorage.setItem(TV_PROFILE_KEY, next.id);
    setScreen("home");
  };
  const persistProfiles = (nextProfiles: ViewerProfile[]) => {
    const nextStore: StoredApp = { ...storedAppRef.current, profiles: nextProfiles };
    storedAppRef.current = nextStore;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
    setProfiles(nextProfiles);
  };
  const startProfile = () => {
    const ordinal = profiles.length + 1;
    setDraftProfile({
      id: `tv-profile-${Date.now()}`,
      name: `Profile ${ordinal}`,
      avatar: "P",
      color: ["ochre", "plum", "slate", "olive"][profiles.length % 4],
      guest: false,
      onboardingCompleted: false,
      region: "US",
      subscriptions: [],
      favoriteActors: [],
      ratings: {},
      questionnaire: {},
      rentalMode: "exceptional",
      modelVersion: 1,
    });
    setQuestionAnswers({});
    setQuestionIndex(0);
    setServiceReturn("questionnaire");
    setScreen("create-profile");
  };
  const updateDraftName = (name: string) => setDraftProfile((current) => current ? {
    ...current,
    name,
    avatar: name.trim().slice(0, 1).toUpperCase() || "P",
  } : current);
  const editServices = () => {
    if (!profile) return;
    setDraftProfile({ ...profile, subscriptions: [...profile.subscriptions] });
    setServiceReturn("home");
    setScreen("services");
  };
  const toggleDraftService = (service: string) => setDraftProfile((current) => current ? {
    ...current,
    subscriptions: current.subscriptions.includes(service)
      ? current.subscriptions.filter((item) => item !== service)
      : [...current.subscriptions, service],
  } : current);
  const continueFromServices = () => {
    if (!draftProfile) return;
    if (serviceReturn === "questionnaire") {
      setScreen("questionnaire");
      return;
    }
    persistProfiles(profiles.map((item) => item.id === draftProfile.id ? draftProfile : item));
    setDraftProfile(null);
    setScreen("home");
  };
  const finishQuestionnaire = (answers: Record<string, number>) => {
    if (!draftProfile) return;
    const questionnaire = Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, Math.round((value - 1) * 25)]));
    const completed = { ...draftProfile, questionnaire, onboardingCompleted: true };
    persistProfiles([...profiles, completed]);
    setDraftProfile(null);
    chooseProfile(completed);
  };
  const answerQuestion = (score: number) => {
    const question = CORE_QUESTIONS[questionIndex];
    if (!question) return;
    const nextAnswers = { ...questionAnswers, [question.id]: score };
    setQuestionAnswers(nextAnswers);
    if (questionIndex < CORE_QUESTIONS.length - 1) setQuestionIndex((current) => current + 1);
    else finishQuestionnaire(nextAnswers);
  };
  const toggleMood = (mood: string) => setMoods((current) => current.includes(mood) ? current.filter((item) => item !== mood) : current.length < 2 ? [...current, mood] : [current[1], mood]);
  const openBrowse = (mode: ContentMode) => {
    setContentMode(mode);
    setPeopleQuery("");
    setScreen("browse");
  };
  const openPeople = (role: PeopleRole) => {
    setPeopleRole(role);
    setPeopleQuery("");
    setScreen("people");
  };
  const findTitles = (exclude: readonly string[] = [], requestedVibe = vibe, overrides: Partial<ResultContext> = {}) => {
    if (!profile) return;
    const context: ResultContext = {
      contentMode: overrides.contentMode ?? contentMode,
      moods: overrides.moods ?? moods,
      vibe: overrides.vibe ?? requestedVibe,
      ...(overrides.favoriteActors ? { favoriteActors: overrides.favoriteActors } : {}),
      ...(overrides.favoriteDirectors ? { favoriteDirectors: overrides.favoriteDirectors } : {}),
      ...(overrides.newReleases ? { newReleases: true } : {}),
    };
    const picks = context.favoriteActors?.length || context.favoriteDirectors?.length
      ? buildPersonRecommendations(catalog, profile, context, exclude)
      : buildRecommendations(catalog, profile, context.moods, context.vibe, exclude, {
        contentKind: contentKindForMode(context.contentMode),
        newReleases: context.newReleases,
        limit: 11,
      });
    const uniquePicks = uniqueTvPicks(picks);
    setResults(uniquePicks.slice(0, 10));
    setResultIndex(0);
    setHasMore(uniquePicks.length > 10);
    setResultContext(context);
    setSeenIds((current) => exclude.length ? [...current, ...uniquePicks.slice(0, 10).map((item) => item.title.id)] : uniquePicks.slice(0, 10).map((item) => item.title.id));
    setScreen("results");
  };
  const findFriendTitles = () => {
    if (!profile) return;
    const friendTitleIds = (storedAppRef.current.friendRecommendations ?? [])
      .filter((item) => item.recipientProfileId === profile.id && item.titleId)
      .map((item) => item.titleId as string);
    const context: ResultContext = { contentMode, moods: [], vibe: "Friends" };
    const direct = friendTitleIds.length
      ? buildRecommendations(catalog, profile, [], "Friends", [], { onlyTitleIds: friendTitleIds, limit: 11 })
      : [];
    const fill = buildRecommendations(catalog, profile, [], "Friends", direct.map((item) => item.title.id), {
      contentKind: contentKindForMode(contentMode),
      limit: 11,
    });
    const picks = uniqueTvPicks([...direct, ...fill]).slice(0, 11);
    setResults(picks.slice(0, 10));
    setResultIndex(0);
    setHasMore(picks.length > 10);
    setResultContext(context);
    setSeenIds(picks.slice(0, 10).map((item) => item.title.id));
    setScreen("results");
  };
  const changeResult = (direction: -1 | 1) => {
    if (direction === 1 && resultIndex === results.length - 1 && hasMore) {
      findTitles(seenIds, resultContext?.vibe ?? vibe, resultContext ?? undefined);
      return;
    }
    setResultIndex((current) => Math.min(results.length - 1, Math.max(0, current + direction)));
  };
  const rootRef = useTvNavigation(screen, !loading && !error, goBack, screen === "results" ? changeResult : undefined);

  const result = results[resultIndex];
  const displayWatchOptions = useMemo(() => {
    if (!result) return [];
    const options: AppCatalogTitle["watchOptions"] = result.title.watchOptions.length
      ? result.title.watchOptions
      : result.title.providers.map((provider) => ({ provider, offerType: "subscription" as const }));
    return [...options].sort((a, b) => {
      const aIncluded = profile?.subscriptions.includes(a.provider) ? 1 : 0;
      const bIncluded = profile?.subscriptions.includes(b.provider) ? 1 : 0;
      return bIncluded - aIncluded || a.provider.localeCompare(b.provider);
    });
  }, [profile?.subscriptions, result]);
  const exactWatch = displayWatchOptions.find((option) =>
    option.launchTarget && profile?.subscriptions.includes(option.provider),
  );
  const availableProviders = useMemo(() => result?.title.providers.filter((provider) => profile?.subscriptions.includes(provider)) ?? [], [profile?.subscriptions, result]);
  const vibePreviewTitles = useMemo(() => {
    if (!profile || !moods.length) return new Map<string, AppCatalogTitle>();
    const used = new Set<string>();
    const artworkCatalog = catalog.filter(hasUsableArtwork);
    const fallbacks = [
      ...artworkCatalog.filter((title) => titleMatchesMood(title, moods)),
      ...artworkCatalog.filter((title) => !titleMatchesMood(title, moods)),
    ]
      .sort((a, b) => b.baseline - a.baseline || b.popularity - a.popularity);
    const previews = new Map<string, AppCatalogTitle>();
    for (const item of VIBES) {
      const recommendations = buildRecommendations(catalog, profile, moods, item.id)
        .map(({ title }) => title)
        .filter(hasUsableArtwork);
      const preview = recommendations.find((title) => !used.has(title.id))
        ?? fallbacks.find((title) => !used.has(title.id));
      if (!preview) continue;
      used.add(preview.id);
      previews.set(item.id, preview);
    }
    return previews;
  }, [catalog, moods, profile]);
  const questionVisualsById = useMemo(() => {
    const byName = new Map(catalog.map((title) => [normalizeTitleName(title.name), title]));
    const artworkCatalog = catalog.filter(hasUsableArtwork);
    const used = new Set<string>();
    const assigned = new Map<string, AppCatalogTitle[]>();
    CORE_QUESTIONS.forEach((question, index) => {
      const preferred = (QUESTION_TITLE_NAMES[question.id] ?? [])
        .map((name) => byName.get(normalizeTitleName(name)))
        .filter((title): title is AppCatalogTitle => Boolean(title && hasUsableArtwork(title) && !used.has(canonicalTitleKey(title))));
      const offset = (index * 17) % Math.max(artworkCatalog.length, 1);
      const fillers = [...artworkCatalog.slice(offset), ...artworkCatalog.slice(0, offset)]
        .filter((title) => !used.has(canonicalTitleKey(title)));
      const picks = uniqueTvPicks([...preferred, ...fillers].map((title) => ({ title })))
        .slice(0, 2)
        .map((item) => item.title);
      picks.forEach((title) => used.add(canonicalTitleKey(title)));
      assigned.set(question.id, picks);
    });
    return assigned;
  }, [catalog]);
  const questionVisuals = useMemo(
    () => questionVisualsById.get(CORE_QUESTIONS[questionIndex]?.id ?? "") ?? [],
    [questionIndex, questionVisualsById],
  );
  const people = useMemo(
    () => profile ? personOptions(catalog, profile, peopleRole, contentMode, peopleQuery) : [],
    [catalog, contentMode, peopleQuery, peopleRole, profile],
  );
  const discoveryPreview = useMemo(() => {
    if (!discovery) return null;
    const used = new Set<string>();
    const take = (picks: readonly TvPick[], count = 2) => {
      const preview: TvPick[] = [];
      for (const pick of uniqueTvPicks(picks)) {
        const key = canonicalTitleKey(pick.title);
        if (used.has(key)) continue;
        used.add(key);
        preview.push(pick);
        if (preview.length === count) break;
      }
      return preview;
    };
    return {
      movieAndTv: take(discovery.movieAndTv),
      movie: take(discovery.movie ? [discovery.movie] : [], 1)[0],
      series: take(discovery.series ? [discovery.series] : [], 1)[0],
      actor: take([...(discovery.actor?.picks ?? []), ...discovery.fallback], 1),
      director: take([...(discovery.director?.picks ?? []), ...discovery.fallback], 1),
      vibe: take([...discovery.vibe, ...discovery.fallback]),
      newReleases: take([...discovery.newReleasePreview, ...discovery.fallback]),
    };
  }, [discovery]);

  useEffect(() => {
    const sources = [
      ...questionVisuals.map((title) => title.poster),
      ...[...vibePreviewTitles.values()].map((title) => title.backdrop),
      ...(discovery ? [
        ...discovery.movieAndTv,
        ...(discovery.movie ? [discovery.movie] : []),
        ...(discovery.series ? [discovery.series] : []),
        ...discovery.vibe,
        ...(discovery.actor?.picks.slice(0, 1) ?? []),
        ...(discovery.director?.picks.slice(0, 1) ?? []),
        ...discovery.newReleasePreview,
      ].map((item) => item.title.poster) : []),
      ...results.flatMap((item) => [item.title.poster, item.title.backdrop]),
    ];
    const images = sources.map((source) => {
      const image = new window.Image();
      image.src = source;
      return image;
    });
    return () => images.forEach((image) => { image.src = ""; });
  }, [discovery, questionVisuals, resultIndex, results, vibePreviewTitles]);

  return (
    <div className={styles.root} ref={rootRef}>
      {!loading ? <header className={styles.header}>
        <div className={styles.brand}>
          <BrandMark className={styles.brandMark} markSize={46} />
          <strong>WHAT TO WATCH</strong>
        </div>
        <div className={styles.remoteHint}>D-PAD TO MOVE · SELECT TO CHOOSE · BACK TO RETURN</div>
      </header> : null}

      {loading ? (
        <BrandSting className={styles.sting} markSize={220} />
      ) : null}
      {error ? <main className={styles.center}><h1>We lost the catalog.</h1><p>{error}</p><button data-tv-focus onClick={() => window.location.reload()}><RefreshCw /> Try again</button></main> : null}

      {!loading && !error && screen === "profiles" ? (
        <main className={styles.choiceScreen}>
          <p className={styles.kicker}>WHO IS WATCHING?</p>
          <h1>Choose a profile.</h1>
          <div className={styles.profileGrid}>
            {profiles.map((item) => <button data-tv-focus key={item.id} className={styles.profileCard} onClick={() => chooseProfile(item)}><span>{item.avatar}</span><strong>{item.name}</strong><small>{item.subscriptions.length} services</small></button>)}
            <button data-tv-focus className={`${styles.profileCard} ${styles.createProfileCard}`} onClick={startProfile}><span><Plus size={54} /></span><strong>Start a new profile</strong><small>Build a fresh taste model</small></button>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "create-profile" && draftProfile ? (
        <main className={`${styles.choiceScreen} ${styles.profileSetupScreen}`}>
          <p className={styles.kicker}>NEW PROFILE</p>
          <h1>Who is watching?</h1>
          <p className={styles.lede}>Select the name field to use the television keyboard, or keep the suggested name.</p>
          <label className={styles.nameField}>Profile name<input data-tv-focus value={draftProfile.name} onChange={(event) => updateDraftName(event.target.value)} maxLength={28} /></label>
          <div className={styles.actionRow}>
            <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("profiles")}><ArrowLeft /> Cancel</button>
            <button data-tv-focus className={styles.primaryAction} disabled={!draftProfile.name.trim()} onClick={() => setScreen("services")}>Choose streaming services <ArrowRight /></button>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "services" && draftProfile ? (
        <main className={`${styles.choiceScreen} ${styles.serviceScreen}`}>
          <p className={styles.kicker}>YOUR STREAMING SERVICES</p>
          <h1>What do you subscribe to?</h1>
          <p className={styles.lede}>Choose any services you use. These selections decide which titles can open with Watch Now.</p>
          <div className={`${styles.serviceGrid} ${styles.serviceGridExpanded}`} role="group" aria-label="Streaming services">
            {serviceOptions.map(({ name, provider }) => {
              const selected = draftProfile.subscriptions.includes(name);
              return <button data-tv-focus type="button" key={name} className={selected ? styles.selected : ""} aria-pressed={selected} onClick={() => toggleDraftService(name)}>
                <span className={styles.serviceIdentity}>
                  <span className={styles.serviceLogo} aria-hidden="true">
                    {provider?.logoUrl ? <Image src={provider.logoUrl} alt="" width={54} height={54} quality={90} /> : <strong>{name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</strong>}
                  </span>
                  <strong>{provider?.providerName ?? name}</strong>
                </span>
                {selected ? <Check /> : <Plus />}
              </button>;
            })}
          </div>
          <div className={styles.actionRow}>
            <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen(serviceReturn === "home" ? "home" : "create-profile")}><ArrowLeft /> Back</button>
            <button data-tv-focus className={styles.primaryAction} onClick={continueFromServices}>{serviceReturn === "home" ? "Save services" : "Start questionnaire"} <ArrowRight /></button>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "questionnaire" && draftProfile && CORE_QUESTIONS[questionIndex] ? (
        <main className={`${styles.choiceScreen} ${styles.questionScreen}`}>
          <div className={styles.questionDeck} aria-hidden="true">
            {questionVisuals.map((title) => <div className={styles.questionPoster} key={title.id}><Image src={title.poster} alt="" fill sizes="22vw" quality={90} priority={questionIndex === 0} /></div>)}
            <span className={styles.questionDeckFade} />
          </div>
          <div className={styles.questionContent}>
            <p className={styles.kicker}>TASTE QUESTION {questionIndex + 1} OF {CORE_QUESTIONS.length}</p>
            <h1>{CORE_QUESTIONS[questionIndex].prompt}</h1>
            <p className={styles.questionExample}>{CORE_QUESTIONS[questionIndex].example}</p>
            <div className={styles.answerRail} role="radiogroup" aria-label="How much this sounds like you">
              {ANSWER_LABELS.map((label, index) => <button data-tv-focus key={label} role="radio" aria-checked={questionAnswers[CORE_QUESTIONS[questionIndex].id] === index + 1} className={questionAnswers[CORE_QUESTIONS[questionIndex].id] === index + 1 ? styles.selected : ""} onClick={() => answerQuestion(index + 1)}><span>{index + 1}</span><strong>{label}</strong></button>)}
            </div>
            <p className={styles.remoteInstruction}>Select an answer to move automatically to the next question.</p>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "home" && profile && discovery && discoveryPreview ? (
        <main className={`${styles.discoveryScreen} ${styles.formatScreen}`}>
          <div className={styles.discoveryIntro}><p className={styles.kicker}>TONIGHT · {profile.name.toUpperCase()}</p><h1>Find your way in.</h1><p>Start broad, follow a person, or set the mood.</p></div>
          <section className={styles.discoveryGroup} aria-labelledby="tv-search-by">
            <div className={styles.discoveryHeading}><span>01</span><h2 id="tv-search-by">You search by</h2></div>
            <div className={styles.discoveryPrimaryGrid}>
              <TvDiscoveryCard eyebrow="ONE OF EACH" title="Movies & TV" description="A movie and a series chosen for you." picks={discoveryPreview.movieAndTv} onSelect={() => openBrowse("both")} />
              <TvDiscoveryCard eyebrow="FEATURE" title="Movies" description="Choose a movie, then browse by taste." picks={discoveryPreview.movie ? [discoveryPreview.movie] : []} onSelect={() => openBrowse("movies")} />
              <TvDiscoveryCard eyebrow="SERIES" title="TV" description="Choose a series, then browse by taste." picks={discoveryPreview.series ? [discoveryPreview.series] : []} onSelect={() => openBrowse("tv")} />
            </div>
          </section>
          <section className={styles.discoveryGroup} aria-labelledby="tv-more-for-you">
            <div className={styles.discoveryHeading}><span>02</span><h2 id="tv-more-for-you">More for you</h2></div>
            <div className={styles.discoveryToolsGrid}>
              <TvDiscoveryCard eyebrow="PERSONALIZED" title="Suggestions" description="Ten picks shaped by your questionnaire, ratings, and feedback." picks={discoveryPreview.vibe} onSelect={() => findTitles([], "Surprise")} />
              <TvDiscoveryCard eyebrow="TRUSTED TASTE" title="Friend's Picks" description="Friend recommendations first, followed by titles shaped by shared taste." picks={discoveryPreview.movieAndTv} onSelect={findFriendTitles} />
            </div>
          </section>
          <div className={styles.actionRow}><button data-tv-focus className={styles.secondaryAction} onClick={editServices}>Streaming services</button></div>
        </main>
      ) : null}

      {!loading && !error && screen === "browse" && profile && discovery && discoveryPreview ? (
        <main className={`${styles.discoveryScreen} ${styles.browseScreen}`}>
          <div className={styles.discoveryIntro}><p className={styles.kicker}>02 · {contentMode === "both" ? "MOVIES + TV" : contentMode === "movies" ? "MOVIES" : "TV"}</p><h1>Browse your way in.</h1><p>Search by a person, set a vibe, or see what is new.</p></div>
          <section className={styles.discoveryGroup} aria-labelledby="tv-browse-by">
            <div className={styles.discoveryHeading}><span>01</span><h2 id="tv-browse-by">Choose a path</h2></div>
            <div className={styles.discoverySecondaryGrid}>
              <TvDiscoveryCard eyebrow="BY ACTOR" title="By Actor" description="Search or choose a performer matched to your taste." picks={discoveryPreview.actor} onSelect={() => openPeople("actor")} />
              <TvDiscoveryCard eyebrow="BY DIRECTOR" title="By Director" description="Search or choose a filmmaker matched to your taste." picks={discoveryPreview.director} onSelect={() => openPeople("director")} />
              <TvDiscoveryCard eyebrow="MOVIE + TV" title="By Vibe" description="Make me laugh, scare me, surprise me, and more." picks={discoveryPreview.vibe} onSelect={() => setScreen("moods")} />
              <TvDiscoveryCard eyebrow="RECENT + POPULAR" title="New Releases" description="Fresh TMDB releases, filtered for you." picks={discoveryPreview.newReleases} onSelect={() => findTitles([], "New", { newReleases: true })} />
            </div>
          </section>
          <div className={styles.actionRow}><button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("home")}><ArrowLeft /> Change format</button></div>
        </main>
      ) : null}

      {!loading && !error && screen === "people" && profile ? (
        <main className={`${styles.choiceScreen} ${styles.peopleScreen}`}>
          <p className={styles.kicker}>BROWSE BY {peopleRole.toUpperCase()} · {contentMode === "both" ? "MOVIES + TV" : contentMode === "movies" ? "MOVIES" : "TV"}</p>
          <h1>Choose {peopleRole === "actor" ? "an actor" : "a director"}.</h1>
          <p className={styles.lede}>Search by name or choose from ten people matched to this profile.</p>
          <label className={styles.nameField}>
            Search {peopleRole}
            <input
              data-tv-focus
              value={peopleQuery}
              placeholder={`Type ${peopleRole === "actor" ? "an actor" : "a director"} name`}
              onChange={(event) => setPeopleQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const first = people[0];
                if (first) findTitles([], "Surprise", peopleRole === "actor" ? { favoriteActors: [first.name], moods: [] } : { favoriteDirectors: [first.name], moods: [] });
              }}
            />
          </label>
          {people.length ? (
            <div className={styles.peopleGrid}>
              {people.map((person) => <button
                data-tv-focus
                type="button"
                key={person.key}
                onClick={() => findTitles([], "Surprise", peopleRole === "actor" ? { favoriteActors: [person.name], moods: [] } : { favoriteDirectors: [person.name], moods: [] })}
                className={styles.personCard}
              >
                <span className={styles.personPoster}><Image src={person.poster} alt="" fill sizes="18vw" quality={90} /></span>
                <span className={styles.personCopy}><strong>{person.name}</strong><small>From {person.titleName}</small><em>SELECT FOR 10 PICKS</em></span>
              </button>)}
            </div>
          ) : <p className={styles.lede}>No matching person in the current catalog. Try another name.</p>}
          <div className={styles.actionRow}><button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("browse")}><ArrowLeft /> Back to browse</button></div>
        </main>
      ) : null}

      {!loading && !error && screen === "moods" ? (
        <main className={styles.choiceScreen}>
          <p className={styles.kicker}>TONIGHT · {profile?.name.toUpperCase()}</p>
          <h1>What are you in the mood for?</h1>
          <p className={styles.lede}>Choose one or two.</p>
          <div className={styles.moodGrid}>
            {MOODS.map((mood) => {
              const available = (moodCoverage.get(mood) ?? 0) > 0;
              return <button data-tv-focus type="button" aria-pressed={moods.includes(mood)} key={mood} className={moods.includes(mood) ? styles.selected : ""} onClick={() => toggleMood(mood)}><span><strong>{mood}</strong>{!available ? <small>No exact specials yet · nearby matches will fill the ten</small> : null}</span>{moods.includes(mood) ? <Check /> : null}</button>;
            })}
          </div>
          <button data-tv-focus type="button" className={styles.primaryAction} disabled={!moods.length} onClick={() => setScreen("vibes")}>Choose the kind of night <ArrowRight /></button>
        </main>
      ) : null}

      {!loading && !error && screen === "vibes" ? (
        <main className={styles.choiceScreen}>
          <p className={styles.kicker}>STEP TWO</p>
          <h1>What kind of night?</h1>
          <p className={styles.lede}>Move left and right. Select one card and recommendations begin immediately.</p>
          <div className={styles.vibeRail}>
            {VIBES.map((item) => {
              const preview = vibePreviewTitles.get(item.id);
              return <button data-tv-focus key={item.id} className={styles.vibeCard} onClick={() => { setVibe(item.id); findTitles([], item.id); }}>
                {preview ? <Image className={styles.vibeImage} src={preview.backdrop} alt="" fill sizes="330px" quality={90} /> : null}
                <span className={styles.vibeShade} />
                <small>{item.eyebrow}</small><strong>{item.label}</strong>
                {preview ? <em>Inspired by {preview.name}</em> : null}
              </button>;
            })}
          </div>
          <div className={styles.actionRow}>
            <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("moods")}><ArrowLeft /> Change mood</button>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "results" && result ? (
        <main className={styles.resultsScreen}>
          <div className={styles.resultArt}>
            <Image className={styles.backdrop} src={result.title.backdrop} alt="" fill sizes="56vw" quality={90} loading="eager" />
            <div className={styles.backdropShade} />
          </div>
          <div className={styles.resultCopy}>
            <p className={styles.kicker}>#{String(resultIndex + 1).padStart(2, "0")} · {result.recommendation.lane}</p>
            <h1>{result.title.name}</h1>
            <p className={styles.metadata}>{result.title.year} · {result.title.kind} · {result.title.runtime} · {result.recommendation.matchScore}% MATCH</p>
            <p className={styles.synopsis}>{result.title.synopsis}</p>
            {result.recommendation.personMatch?.kind === "inspired" && result.recommendation.personMatch.note ? <p className={styles.personMatchNote}>{result.recommendation.personMatch.note}</p> : null}
            <div className={styles.tags}>{[result.title.primarySubgenre, result.title.secondarySubgenre, ...result.title.toneTags].filter(Boolean).slice(0, 5).map((tag) => <span key={tag}>{tag?.replaceAll("-", " ")}</span>)}</div>
            <p className={styles.providerLine}>{availableProviders.length ? `Available with ${availableProviders.join(" · ")}` : "No included provider is currently known"}</p>
            <div className={`${styles.actionRow} ${styles.resultsActions}`}>
              <button data-tv-focus className={styles.primaryAction} onClick={() => {
                if (!exactWatch || !launchWatchTarget(exactWatch.launchTarget)) {
                  setWatchNotice("");
                  setScreen("watch");
                }
              }}><Play fill="currentColor" />Watch Now</button>
              <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("home")}><ArrowLeft /> Change search</button>
              {resultIndex === results.length - 1 && hasMore ? <button data-tv-focus className={styles.secondaryAction} onClick={() => findTitles(seenIds, resultContext?.vibe ?? vibe, resultContext ?? undefined)}><RefreshCw /> Another ten</button> : null}
            </div>
          </div>
          <div className={styles.deckNav}>
            <button data-tv-focus disabled={resultIndex === 0} onClick={() => changeResult(-1)}><ArrowLeft /> PREVIOUS</button>
            <strong>{resultIndex + 1} / {results.length}</strong>
            <button data-tv-focus disabled={resultIndex === results.length - 1 && !hasMore} onClick={() => changeResult(1)}>{resultIndex === results.length - 1 && hasMore ? "ANOTHER TEN" : "NEXT"} <ArrowRight /></button>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "results" && !result ? (
        <main className={styles.center}>
          <h1>No eligible titles yet.</h1>
          <p>The current catalog does not have a classified title for this choice. Nothing has been silently substituted.</p>
          <button data-tv-focus onClick={() => setScreen("home")}><ArrowLeft /> Change search</button>
        </main>
      ) : null}

      {!loading && !error && screen === "watch" && result ? (
        <main className={styles.watchScreen}>
          <Image className={styles.watchBackdrop} src={result.title.backdrop} alt="" fill sizes="100vw" quality={90} loading="eager" />
          <div className={styles.watchShade} />
          <section className={styles.watchPanel}>
            <p className={styles.kicker}>WHERE TO WATCH</p>
            <h1>{result.title.name}</h1>
            <p className={styles.lede}>Your subscribed services appear first. A verified title link opens automatically when one is available.</p>
            <div className={styles.providerCards}>
              {displayWatchOptions.map((option) => {
                const included = profile?.subscriptions.includes(option.provider);
                return <button data-tv-focus className={styles.providerCard} key={`${option.provider}-${option.offerType}`} onClick={() => {
                  if (!launchWatchTarget(option.launchTarget)) {
                    setWatchNotice(`${option.provider} reports this title in the United States, but an exact Fire TV title link has not been verified yet.`);
                  }
                }}><span>{included ? "YOUR SERVICE" : option.offerType.replaceAll("_", " ")}</span><strong>{option.provider}</strong><small>{option.launchTarget ? "Select to open the verified title target" : included ? "Available in this profile · direct launch pending" : "Not included in this profile"}</small></button>;
              })}
            </div>
            {watchNotice ? <p className={styles.watchNotice} role="status">{watchNotice}</p> : null}
            <div className={styles.actionRow}>
              <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("results")}><ArrowLeft /> Back to title</button>
            </div>
          </section>
        </main>
      ) : null}
    </div>
  );
}
