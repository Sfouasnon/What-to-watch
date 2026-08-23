export type DiscoveryTitle = {
  id: string;
  tmdbId?: number | string | null;
  name?: string;
  kind: "Movie" | "Series" | "Stand-up";
  year: number;
  releaseDate?: string | null;
  popularity: number;
  director: string;
  cast: string[];
};

import type { Recommendation, PersonMatchKind } from "./types";

export type CanonicalTitleIdentity = {
  id?: string;
  tmdbId?: number | string | null;
  name?: string;
  kind?: string;
  year?: number | null;
};

export function normalizeTitleIdentity(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLocaleLowerCase()
    .trim();
}

/**
 * Uses TMDB identity whenever available and falls back to a stable display
 * identity so duplicate catalog rows cannot produce repeated cards.
 */
export function canonicalTitleKey(title: CanonicalTitleIdentity) {
  const kind = normalizeTitleIdentity(title.kind ?? "unknown") || "unknown";
  if (title.tmdbId !== undefined && title.tmdbId !== null && String(title.tmdbId).trim()) {
    return `${kind}:tmdb:${String(title.tmdbId).trim()}`;
  }
  const name = normalizeTitleIdentity(title.name ?? title.id ?? "unknown") || "unknown";
  return `${kind}:name:${name}:${title.year ?? "unknown"}`;
}

export function dedupeTitles<T extends CanonicalTitleIdentity>(titles: readonly T[]) {
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = canonicalTitleKey(title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Joins a person-led result set without allowing generic fill-ins to look like
 * credited matches. Callers provide exact results first and a separately
 * scored, taste-similar pool for the inspired remainder.
 */
export function assemblePersonRecommendations(
  exact: readonly Recommendation[],
  inspired: readonly Recommendation[],
  options: { person: string; role: "actor" | "director"; limit?: number },
) {
  const limit = Math.max(0, Math.floor(options.limit ?? 10));
  const seen = new Set<string>();
  const mark = (items: readonly Recommendation[], kind: PersonMatchKind) => items.flatMap((item) => {
    const key = canonicalTitleKey(item.title);
    if (seen.has(key)) return [];
    seen.add(key);
    const note = kind === "inspired"
      ? options.role === "director"
        ? `Not directed by ${options.person}, but aligned with films directed by ${options.person}.`
        : `Not featuring ${options.person}, but reminiscent of ${options.person}'s work.`
      : undefined;
    return [{
      ...item,
      personMatch: { kind, person: options.person, role: options.role, note },
    }];
  });
  return [...mark(exact, "exact"), ...mark(inspired, "inspired")]
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

type PersonRole = "actor" | "director";

const DAY_MS = 86_400_000;

function releasedAt(title: DiscoveryTitle) {
  const exact = title.releaseDate ? Date.parse(`${title.releaseDate}T00:00:00Z`) : Number.NaN;
  if (Number.isFinite(exact)) return exact;
  return Date.UTC(title.year, 0, 1);
}

export function newReleaseRecency(title: DiscoveryTitle, now = Date.now(), windowDays = 120) {
  const ageDays = (now - releasedAt(title)) / DAY_MS;
  if (ageDays < 0) return 0;
  return Math.max(0, 1 - ageDays / windowDays);
}

export function newReleasePool<T extends DiscoveryTitle>(titles: readonly T[], now = Date.now()) {
  const released = titles.filter((title) => releasedAt(title) <= now);
  const within = (days: number) => released.filter((title) => now - releasedAt(title) <= days * DAY_MS);
  const pool = within(120).length ? within(120) : within(365).length ? within(365) : released;
  return [...pool].sort((a, b) =>
    releasedAt(b) - releasedAt(a) || b.popularity - a.popularity || a.id.localeCompare(b.id),
  );
}

export function newReleaseScore(title: DiscoveryTitle, personalizedMatch: number, now = Date.now()) {
  const recencyBoost = newReleaseRecency(title, now) * 7;
  const popularityBoost = Math.max(0, Math.min(1, title.popularity / 100)) * 3;
  return personalizedMatch + recencyBoost + popularityBoost;
}

export function suggestPerson<T extends DiscoveryTitle>(
  role: PersonRole,
  ratings: Readonly<Record<string, number>>,
  catalog: readonly T[],
  fallbackTitles: readonly T[],
) {
  const scores = new Map<string, { score: number; evidence: number; popularity: number }>();
  for (const title of catalog) {
    const rating = ratings[title.id];
    if (typeof rating !== "number") continue;
    const people = role === "actor" ? title.cast : [title.director];
    for (const person of people) {
      if (!person || person === "Unknown director") continue;
      const current = scores.get(person) ?? { score: 0, evidence: 0, popularity: 0 };
      current.score += (rating - 5.5) / 4.5;
      current.evidence += 1;
      current.popularity = Math.max(current.popularity, title.popularity);
      scores.set(person, current);
    }
  }

  const learned = [...scores.entries()]
    .filter(([, value]) => value.score > 0)
    .sort((a, b) => b[1].score - a[1].score || b[1].evidence - a[1].evidence || b[1].popularity - a[1].popularity || a[0].localeCompare(b[0]))[0]?.[0];
  if (learned) return learned;

  for (const title of fallbackTitles) {
    const person = role === "actor" ? title.cast[0] : title.director;
    if (person && person !== "Unknown director") return person;
  }
  return undefined;
}
