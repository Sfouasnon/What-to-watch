"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppCatalogTitle, AppLaunchTarget } from "@/lib/catalog/recommendation-catalog";
import { defaultRecommendationConfig, recommendForProfile } from "@/lib/recommendation/engine";
import { mapQuestionnaireAnswers } from "@/lib/recommendation/intake";
import { ANSWER_LABELS, CORE_QUESTIONS } from "@/lib/recommendation/onboarding";
import type { Mood, Profile, Recommendation, Title as EngineTitle, Vibe } from "@/lib/recommendation/types";

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

type StoredApp = Record<string, unknown> & { profiles?: ViewerProfile[] };
type Screen = "profiles" | "create-profile" | "services" | "questionnaire" | "moods" | "vibes" | "results" | "watch";

const MOODS = ["Comedy", "Stand-up", "Drama", "Thriller", "Action", "Horror"] as const;
const POPULAR_SERVICES = ["Netflix", "Prime Video", "Hulu", "Disney+", "Max", "Apple TV+", "Paramount+", "Peacock", "Criterion Channel"] as const;
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
};

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

function toEngineProfile(profile: ViewerProfile): Profile {
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
    favoritePeople: { actors: profile.favoriteActors ?? [], directors: [], writers: [], cinematographers: [] },
  };
}

function buildRecommendations(
  catalog: AppCatalogTitle[],
  profile: ViewerProfile,
  moods: readonly string[],
  vibe: string,
  excludeTitleIds: readonly string[] = [],
) {
  const titleById = new Map(catalog.map((title) => [title.id, title]));
  return recommendForProfile({
    profile: toEngineProfile(profile),
    catalog: catalog.map((title) => toEngineTitle(title, profile.region)),
    moods: moods.map((mood) => mood.toLowerCase() as Mood),
    vibes: [VIBE_MAP[vibe] ?? "surprise-me"],
    config: { ...defaultRecommendationConfig, modelVersion: String(profile.modelVersion) },
    excludeTitleIds,
    limit: 11,
  }).flatMap((recommendation) => {
    const title = titleById.get(recommendation.title.id);
    return title ? [{ recommendation, title }] : [];
  });
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
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (["Escape", "Backspace", "BrowserBack"].includes(event.key)) {
        event.preventDefault();
        backRef.current();
        return;
      }
      if (event.key === "Enter" && active?.matches("[data-tv-focus]")) {
        event.preventDefault();
        active.click();
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

export function WhatToWatchTv() {
  const storedAppRef = useRef<StoredApp>({});
  const [catalog, setCatalog] = useState<AppCatalogTitle[]>([]);
  const [profiles, setProfiles] = useState<ViewerProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [screen, setScreen] = useState<Screen>("profiles");
  const [draftProfile, setDraftProfile] = useState<ViewerProfile | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, number>>({});
  const [moods, setMoods] = useState<string[]>([]);
  const [vibe, setVibe] = useState("Surprise");
  const [results, setResults] = useState<Array<{ recommendation: Recommendation; title: AppCatalogTitle }>>([]);
  const [resultIndex, setResultIndex] = useState(0);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [expandedServices, setExpandedServices] = useState(false);
  const [watchNotice, setWatchNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const profile = profiles.find((item) => item.id === profileId);
  const allProviderOptions = useMemo(() => {
    const providers = new Set(catalog.flatMap((title) => title.providers));
    return [
      ...POPULAR_SERVICES.filter((provider) => providers.has(provider)),
      ...[...providers].filter((provider) => !POPULAR_SERVICES.includes(provider as (typeof POPULAR_SERVICES)[number])).sort((a, b) => a.localeCompare(b)),
    ];
  }, [catalog]);
  const visibleProviderOptions = useMemo(() => {
    if (expandedServices) return allProviderOptions;
    const selected = draftProfile?.subscriptions ?? [];
    return [...new Set([...POPULAR_SERVICES, ...selected])];
  }, [allProviderOptions, draftProfile?.subscriptions, expandedServices]);
  const moodCoverage = useMemo(() => new Map(MOODS.map((mood) => [
    mood,
    catalog.filter((title) => titleMatchesMood(title, [mood])).length,
  ])), [catalog]);
  const goBack = useCallback(() => {
    if (screen === "watch") setScreen("results");
    else if (screen === "results") setScreen("vibes");
    else if (screen === "vibes") setScreen("moods");
    else if (screen === "moods") setScreen("profiles");
    else if (screen === "questionnaire" && questionIndex > 0) setQuestionIndex((current) => current - 1);
    else if (screen === "questionnaire") setScreen("services");
    else if (screen === "services") setScreen("create-profile");
    else setScreen("profiles");
  }, [questionIndex, screen]);

  useEffect(() => {
    const controller = new AbortController();
    const initialize = window.setTimeout(() => {
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
        .then((payload) => {
          if (!Array.isArray(payload.titles) || payload.titles.length !== payload.titleCount) throw new Error("Catalog payload is incomplete");
          setCatalog(payload.titles);
          if (!storedProfiles.length) {
            const subscriptions = [...new Set(payload.titles.flatMap((title) => title.providers))];
            setProfiles([{ id: "tv-guest", name: "TV Guest", avatar: "T", color: "ochre", guest: true, onboardingCompleted: true, region: "US", subscriptions, favoriteActors: [], ratings: {}, questionnaire: {}, rentalMode: "never", modelVersion: 1 }]);
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

  const chooseProfile = (next: ViewerProfile) => {
    setProfileId(next.id);
    localStorage.setItem(TV_PROFILE_KEY, next.id);
    setScreen("moods");
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
    setExpandedServices(false);
    setScreen("create-profile");
  };
  const updateDraftName = (name: string) => setDraftProfile((current) => current ? {
    ...current,
    name,
    avatar: name.trim().slice(0, 1).toUpperCase() || "P",
  } : current);
  const toggleDraftProvider = (provider: string) => setDraftProfile((current) => current ? {
    ...current,
    subscriptions: current.subscriptions.includes(provider)
      ? current.subscriptions.filter((item) => item !== provider)
      : [...current.subscriptions, provider],
  } : current);
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
  const findTitles = (exclude: readonly string[] = [], requestedVibe = vibe) => {
    if (!profile) return;
    const picks = buildRecommendations(catalog, profile, moods, requestedVibe, exclude);
    setResults(picks.slice(0, 10));
    setResultIndex(0);
    setHasMore(picks.length > 10);
    setSeenIds((current) => exclude.length ? [...current, ...picks.slice(0, 10).map((item) => item.title.id)] : picks.slice(0, 10).map((item) => item.title.id));
    setScreen("results");
  };

  const changeResult = (direction: -1 | 1) => {
    if (direction === 1 && resultIndex === results.length - 1 && hasMore) {
      findTitles(seenIds);
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
  const questionVisuals = useMemo(() => {
    const question = CORE_QUESTIONS[questionIndex];
    if (!question) return [];
    const byName = new Map(catalog.map((title) => [normalizeTitleName(title.name), title]));
    const exact = (QUESTION_TITLE_NAMES[question.id] ?? [])
      .map((name) => byName.get(normalizeTitleName(name)))
      .filter((title): title is AppCatalogTitle => Boolean(title && hasUsableArtwork(title)));
    if (exact.length >= 3) return exact.slice(0, 4);
    const exactIds = new Set(exact.map((title) => title.id));
    const offset = (questionIndex * 17) % Math.max(catalog.length, 1);
    const fillers = [...catalog.slice(offset), ...catalog.slice(0, offset)]
      .filter((title) => hasUsableArtwork(title) && !exactIds.has(title.id));
    return [...exact, ...fillers].slice(0, 4);
  }, [catalog, questionIndex]);

  useEffect(() => {
    const sources = [
      ...questionVisuals.map((title) => title.poster),
      ...[...vibePreviewTitles.values()].map((title) => title.backdrop),
    ];
    const images = sources.map((source) => {
      const image = new window.Image();
      image.src = source;
      return image;
    });
    return () => images.forEach((image) => { image.src = ""; });
  }, [questionVisuals, vibePreviewTitles]);

  return (
    <div className={styles.root} ref={rootRef}>
      <header className={styles.header}>
        <div className={styles.brand}><span>W</span><strong>WHAT TO WATCH</strong></div>
        <div className={styles.remoteHint}>D-PAD TO MOVE · SELECT TO CHOOSE · BACK TO RETURN</div>
      </header>

      {loading ? <main className={styles.center}><Sparkles size={46} /><h1>Loading your catalog…</h1></main> : null}
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
            <button data-tv-focus className={styles.primaryAction} disabled={!draftProfile.name.trim()} onClick={() => setScreen("services")}>Choose services <ArrowRight /></button>
          </div>
        </main>
      ) : null}

      {!loading && !error && screen === "services" && draftProfile ? (
        <main className={`${styles.choiceScreen} ${styles.serviceScreen}`}>
          <p className={styles.kicker}>PROFILE SETUP · STEP 1</p>
          <h1>Where do you watch?</h1>
          <p className={styles.lede}>Choose every service included in this profile. Start with the popular services or open the full list of {allProviderOptions.length}.</p>
          <div className={`${styles.serviceGrid} ${expandedServices ? styles.serviceGridExpanded : ""}`}>
            {visibleProviderOptions.map((provider) => <button data-tv-focus key={provider} className={draftProfile.subscriptions.includes(provider) ? styles.selected : ""} onClick={() => toggleDraftProvider(provider)}><strong>{provider}</strong>{draftProfile.subscriptions.includes(provider) ? <Check /> : null}</button>)}
          </div>
          <div className={styles.actionRow}>
            <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("create-profile")}><ArrowLeft /> Back</button>
            <button data-tv-focus className={styles.secondaryAction} onClick={() => setExpandedServices((current) => !current)}>{expandedServices ? <ChevronUp /> : <ChevronDown />}{expandedServices ? "Show popular services" : `Show all ${allProviderOptions.length} services`}</button>
            <button data-tv-focus className={styles.primaryAction} disabled={!draftProfile.subscriptions.length} onClick={() => setScreen("questionnaire")}>Start questionnaire <ArrowRight /></button>
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

      {!loading && !error && screen === "moods" ? (
        <main className={styles.choiceScreen}>
          <p className={styles.kicker}>TONIGHT · {profile?.name.toUpperCase()}</p>
          <h1>What are you in the mood for?</h1>
          <p className={styles.lede}>Choose one or two.</p>
          <div className={styles.moodGrid}>
            {MOODS.map((mood) => {
              const available = (moodCoverage.get(mood) ?? 0) > 0;
              return <button data-tv-focus key={mood} className={moods.includes(mood) ? styles.selected : ""} onClick={() => toggleMood(mood)}><Sparkles /><span><strong>{mood}</strong>{!available ? <small>No exact specials yet · nearby matches will fill the ten</small> : null}</span>{moods.includes(mood) ? <Check /> : null}</button>;
            })}
          </div>
          <button data-tv-focus className={styles.primaryAction} disabled={!moods.length} onClick={() => setScreen("vibes")}>Choose the kind of night <ArrowRight /></button>
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
            <div className={styles.tags}>{[result.title.primarySubgenre, result.title.secondarySubgenre, ...result.title.toneTags].filter(Boolean).slice(0, 5).map((tag) => <span key={tag}>{tag?.replaceAll("-", " ")}</span>)}</div>
            <p className={styles.providerLine}>{availableProviders.length ? `Available with ${availableProviders.join(" · ")}` : "No included provider is currently known"}</p>
            <div className={`${styles.actionRow} ${styles.resultsActions}`}>
              <button data-tv-focus className={styles.primaryAction} onClick={() => {
                if (!exactWatch || !launchWatchTarget(exactWatch.launchTarget)) {
                  setWatchNotice("");
                  setScreen("watch");
                }
              }}><Play fill="currentColor" />{exactWatch ? `Watch on ${exactWatch.provider}` : "Where to watch"}</button>
              <button data-tv-focus className={styles.secondaryAction} onClick={() => setScreen("vibes")}><ArrowLeft /> Change tonight</button>
              {resultIndex === results.length - 1 && hasMore ? <button data-tv-focus className={styles.secondaryAction} onClick={() => findTitles(seenIds)}><RefreshCw /> Another ten</button> : null}
            </div>
          </div>
          <div className={styles.deckNav}><span><ArrowLeft /> PREVIOUS</span><strong>{resultIndex + 1} / {results.length}</strong><span>{resultIndex === results.length - 1 && hasMore ? "ANOTHER TEN" : "NEXT"} <ArrowRight /></span></div>
        </main>
      ) : null}

      {!loading && !error && screen === "results" && !result ? (
        <main className={styles.center}>
          <h1>No eligible titles yet.</h1>
          <p>The current catalog does not have a classified title for this choice. Nothing has been silently substituted.</p>
          <button data-tv-focus onClick={() => setScreen("moods")}><ArrowLeft /> Change the mood</button>
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
