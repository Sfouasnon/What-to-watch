export type ActorDiscoveryTitle = {
  cast: readonly string[];
  providers: readonly string[];
  availabilityType: "subscription" | "free" | "rental";
};

export type ActorOption = {
  name: string;
  availableTitleCount: number;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

function isIncludedWithSubscription(
  title: ActorDiscoveryTitle,
  subscriptions: readonly string[],
) {
  if (title.availabilityType !== "subscription") return false;
  const subscribed = new Set(subscriptions.map(normalize));
  return title.providers.some((provider) => subscribed.has(normalize(provider)));
}

export function hasProminentActor(title: ActorDiscoveryTitle, actor: string) {
  const target = normalize(actor);
  return Boolean(target) && title.cast.some((castMember) => normalize(castMember) === target);
}

export function filterTitlesForFavoriteActors<T extends ActorDiscoveryTitle>(
  titles: readonly T[],
  actors: readonly string[],
  subscriptions: readonly string[],
): T[] {
  const selected = [...new Set(actors.map(normalize).filter(Boolean))];
  if (!selected.length || !subscriptions.length) return [];

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

  for (const title of titles) {
    if (!isIncludedWithSubscription(title, subscriptions)) continue;
    for (const name of new Set(title.cast.map((actor) => actor.trim()).filter(Boolean))) {
      const key = normalize(name);
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
