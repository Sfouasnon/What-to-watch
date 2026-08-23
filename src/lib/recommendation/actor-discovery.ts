export type ActorDiscoveryTitle = {
  id?: string;
  tmdbId?: number | string | null;
  name?: string;
  kind?: string;
  year?: number | null;
  cast: readonly string[];
  castContext?: readonly { name: string; billingOrder?: number | null }[];
  director?: string;
  directors?: readonly string[];
  providers: readonly string[];
  availabilityType: "subscription" | "free" | "rental";
};

export type DirectorDiscoveryTitle = ActorDiscoveryTitle;

export type ActorOption = {
  name: string;
  availableTitleCount: number;
};

type ActorArtworkTitle = ActorDiscoveryTitle & {
  poster?: string | null;
  popularity?: number | null;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const PROMINENT_BILLING_CUTOFF = 10;

/**
 * These are deliberately mixed and only act as a presentation seed. A name
 * is included only when it exists in the viewer's available catalog; the
 * remaining slots are filled from catalog evidence below.
 */
export const CURATED_MIXED_ACTOR_SEEDS = [
  "Viola Davis",
  "Cate Blanchett",
  "Saoirse Ronan",
  "Tilda Swinton",
  "Frances McDormand",
  "Denzel Washington",
  "Daniel Kaluuya",
  "Oscar Isaac",
  "Mahershala Ali",
  "Toshiro Mifune",
  "Amy Adams",
  "Jake Gyllenhaal",
  "Jodie Foster",
  "Ralph Fiennes",
  "Samuel L. Jackson",
  "Tony Leung",
] as const;

function isIncludedWithSubscription(
  title: ActorDiscoveryTitle,
  subscriptions: readonly string[],
) {
  // Questionnaire-only profiles may not have configured services yet. In that
  // case, search the published catalog and defer provider narrowing until the
  // viewer adds subscriptions instead of presenting an empty people index.
  if (!subscriptions.length) return true;
  if (title.availabilityType !== "subscription") return false;
  const subscribed = new Set(subscriptions.map(normalize));
  return title.providers.some((provider) => subscribed.has(normalize(provider)));
}

export function hasProminentActor(title: ActorDiscoveryTitle, actor: string) {
  const target = normalize(actor);
  if (!target) return false;
  if (title.castContext?.length) {
    return title.castContext.some((person) =>
      normalize(person.name) === target
      && (person.billingOrder === undefined || person.billingOrder === null || person.billingOrder <= PROMINENT_BILLING_CUTOFF),
    );
  }
  return title.cast.some((castMember) => normalize(castMember) === target);
}

function billingOrderForActor(title: ActorDiscoveryTitle, actor: string) {
  const target = normalize(actor);
  const match = title.castContext?.find((person) => normalize(person.name) === target);
  return typeof match?.billingOrder === "number" && Number.isFinite(match.billingOrder)
    ? match.billingOrder
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Chooses artwork from the title where each requested actor is billed most
 * prominently. Popularity and a stable title key only break billing ties.
 */
export function leadTitlesForActors<T extends ActorArtworkTitle>(
  titles: readonly T[],
  actors: readonly string[],
) {
  const requestedNames = new Map(actors.map((name) => [normalize(name), name]));
  const selected = new Map<string, T>();

  for (const title of titles) {
    for (const actor of title.cast) {
      const key = normalize(actor);
      if (!requestedNames.has(key) || !hasProminentActor(title, actor)) continue;
      const current = selected.get(key);
      if (!current) {
        selected.set(key, title);
        continue;
      }

      const order = billingOrderForActor(title, actor);
      const currentOrder = billingOrderForActor(current, actor);
      const popularity = typeof title.popularity === "number" ? title.popularity : 0;
      const currentPopularity = typeof current.popularity === "number" ? current.popularity : 0;
      const stableKey = `${normalize(title.name ?? title.id ?? "")}:${title.year ?? ""}`;
      const currentStableKey = `${normalize(current.name ?? current.id ?? "")}:${current.year ?? ""}`;
      if (
        order < currentOrder
        || (order === currentOrder && popularity > currentPopularity)
        || (order === currentOrder && popularity === currentPopularity && stableKey < currentStableKey)
      ) selected.set(key, title);
    }
  }

  return new Map(
    [...selected].map(([key, title]) => [requestedNames.get(key) ?? key, title] as const),
  );
}

/**
 * Picks a representative film for each director option. Directors do not
 * have a billing order, so the most popular available title is the stable
 * presentation choice. The optional poster field lets callers render this
 * directly without changing the discovery/filtering contract.
 */
export function representativeTitlesForDirectors<T extends ActorArtworkTitle>(
  titles: readonly T[],
  directors: readonly string[],
) {
  const requestedNames = new Map(directors.map((name) => [normalize(name), name]));
  const selected = new Map<string, T>();

  for (const title of titles) {
    for (const director of directorNames(title)) {
      const key = normalize(director);
      if (!requestedNames.has(key)) continue;
      const current = selected.get(key);
      if (!current || compareArtworkTitles(title, current) < 0) selected.set(key, title);
    }
  }

  return new Map(
    [...selected].map(([key, title]) => [requestedNames.get(key) ?? key, title] as const),
  );
}

export function filterTitlesForFavoriteActors<T extends ActorDiscoveryTitle>(
  titles: readonly T[],
  actors: readonly string[],
  subscriptions: readonly string[],
): T[] {
  const selected = [...new Set(actors.map(normalize).filter(Boolean))];
  if (!selected.length) return [];

  return titles.filter((title) =>
    isIncludedWithSubscription(title, subscriptions)
    && selected.some((actor) => hasProminentActor(title, actor)),
  );
}

export function actorOptionsForSubscriptions(
  titles: readonly ActorDiscoveryTitle[],
  subscriptions: readonly string[],
): ActorOption[] {
  const counts = new Map<string, ActorOption>();
  const titleKeysByActor = new Map<string, Set<string>>();

  for (const title of titles) {
    if (!isIncludedWithSubscription(title, subscriptions)) continue;
    const titleKey = title.tmdbId !== undefined && title.tmdbId !== null
      ? `tmdb:${title.tmdbId}`
      : `${normalize(title.name ?? title.id ?? "")}:${title.year ?? ""}:${normalize(title.kind ?? "")}`;
    for (const name of new Set(title.cast.map((actor) => actor.trim()).filter(Boolean))) {
      if (!hasProminentActor(title, name)) continue;
      const key = normalize(name);
      const titleKeys = titleKeysByActor.get(key) ?? new Set<string>();
      if (titleKeys.has(titleKey)) continue;
      titleKeys.add(titleKey);
      titleKeysByActor.set(key, titleKeys);
      const current = counts.get(key);
      counts.set(key, {
        name: current?.name ?? name,
        availableTitleCount: (current?.availableTitleCount ?? 0) + 1,
      });
    }
  }

  return [...counts.values()].sort((left, right) =>
    right.availableTitleCount - left.availableTitleCount || left.name.localeCompare(right.name),
  );
}

export function defaultActorOptionsForSubscriptions(
  titles: readonly ActorDiscoveryTitle[],
  subscriptions: readonly string[],
  limit = 10,
) {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!safeLimit) return [];
  const all = actorOptionsForSubscriptions(titles, subscriptions);
  const byName = new Map(all.map((option) => [normalize(option.name), option]));
  const seeded = CURATED_MIXED_ACTOR_SEEDS
    .map((name) => byName.get(normalize(name)))
    .filter((option): option is ActorOption => Boolean(option));
  const seededNames = new Set(seeded.map((option) => normalize(option.name)));
  return [...seeded, ...all.filter((option) => !seededNames.has(normalize(option.name)))].slice(0, safeLimit);
}

function directorNames(title: DirectorDiscoveryTitle) {
  return [...new Set([
    ...(title.directors ?? []),
    ...(title.director ? [title.director] : []),
  ].map((director) => director.trim()).filter((director) => Boolean(director) && normalize(director) !== "unknown director"))];
}

function compareArtworkTitles(left: ActorArtworkTitle, right: ActorArtworkTitle) {
  const leftHasPoster = Boolean(left.poster);
  const rightHasPoster = Boolean(right.poster);
  if (leftHasPoster !== rightHasPoster) return leftHasPoster ? -1 : 1;
  const leftPopularity = typeof left.popularity === "number" ? left.popularity : 0;
  const rightPopularity = typeof right.popularity === "number" ? right.popularity : 0;
  if (leftPopularity !== rightPopularity) return rightPopularity - leftPopularity;
  const leftKey = `${normalize(left.name ?? left.id ?? "")}:${left.year ?? ""}`;
  const rightKey = `${normalize(right.name ?? right.id ?? "")}:${right.year ?? ""}`;
  return leftKey.localeCompare(rightKey);
}

export function hasProminentDirector(title: DirectorDiscoveryTitle, director: string) {
  const target = normalize(director);
  return Boolean(target) && directorNames(title).some((name) => normalize(name) === target);
}

export function filterTitlesForFavoriteDirectors<T extends DirectorDiscoveryTitle>(
  titles: readonly T[],
  directors: readonly string[],
  subscriptions: readonly string[],
): T[] {
  const selected = [...new Set(directors.map(normalize).filter(Boolean))];
  if (!selected.length) return [];
  return titles.filter((title) =>
    isIncludedWithSubscription(title, subscriptions)
    && selected.some((director) => hasProminentDirector(title, director)),
  );
}

export function directorOptionsForSubscriptions(
  titles: readonly DirectorDiscoveryTitle[],
  subscriptions: readonly string[],
): ActorOption[] {
  const counts = new Map<string, ActorOption>();
  const titleKeysByDirector = new Map<string, Set<string>>();
  for (const title of titles) {
    if (!isIncludedWithSubscription(title, subscriptions)) continue;
    const titleKey = title.tmdbId !== undefined && title.tmdbId !== null
      ? `tmdb:${title.tmdbId}`
      : `${normalize(title.name ?? title.id ?? "")}:${title.year ?? ""}:${normalize(title.kind ?? "")}`;
    for (const name of directorNames(title)) {
      const key = normalize(name);
      const titleKeys = titleKeysByDirector.get(key) ?? new Set<string>();
      if (titleKeys.has(titleKey)) continue;
      titleKeys.add(titleKey);
      titleKeysByDirector.set(key, titleKeys);
      const current = counts.get(key);
      counts.set(key, {
        name: current?.name ?? name,
        availableTitleCount: (current?.availableTitleCount ?? 0) + 1,
      });
    }
  }
  return [...counts.values()].sort((left, right) =>
    right.availableTitleCount - left.availableTitleCount || left.name.localeCompare(right.name),
  );
}

export { PROMINENT_BILLING_CUTOFF };
