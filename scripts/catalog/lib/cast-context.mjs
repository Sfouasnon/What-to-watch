const normalizeMediaType = (value) => value === "movie" || value === "tv" ? value : null;

const releaseYear = (credit) => {
  const date = credit.release_date ?? credit.first_air_date;
  const year = Number.parseInt(String(date ?? "").slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
};

const creditName = (credit) => credit.title ?? credit.name ?? null;

const referenceScore = (credit) => {
  const voteCount = Math.max(0, Number(credit.vote_count) || 0);
  const popularity = Math.max(0, Number(credit.popularity) || 0);
  const voteAverage = Math.max(0, Number(credit.vote_average) || 0);
  const billingOrder = Number.isInteger(credit.order) ? credit.order : 20;
  const episodeCount = Math.max(0, Number(credit.episode_count) || 0);
  const prominence = Math.max(0, 40 - billingOrder * 4);
  return Math.log10(voteCount + 1) * 22 + popularity * 0.12 + voteAverage * 1.5 + prominence + Math.min(30, episodeCount * 0.6);
};

export function rankReferenceCredits(
  credits,
  { currentTmdbId, currentMediaType, limit = 8, maximumYear = new Date().getUTCFullYear() } = {},
) {
  const unique = new Map();
  for (const credit of credits ?? []) {
    const mediaType = normalizeMediaType(credit.media_type);
    const name = creditName(credit);
    const year = releaseYear(credit);
    if (!mediaType || !name || credit.adult === true || year === null || year > maximumYear) continue;
    if (Number(credit.id) === Number(currentTmdbId) && mediaType === currentMediaType) continue;
    if ((Number(credit.vote_count) || 0) < 20 && (Number(credit.popularity) || 0) < 5) continue;
    const billingOrder = Number.isInteger(credit.order) ? credit.order : 20;
    const episodeCount = Math.max(0, Number(credit.episode_count) || 0);
    if (mediaType === "movie" && billingOrder > 20) continue;
    if (mediaType === "tv" && episodeCount > 0 && episodeCount < 3 && billingOrder > 10) continue;

    const key = `${mediaType}:${credit.id}`;
    const candidate = {
      externalId: `tmdb:${key}`,
      tmdbId: Number(credit.id),
      mediaType,
      name,
      year,
      character: typeof credit.character === "string" && credit.character.trim() ? credit.character.trim() : null,
      billingOrder: Number.isInteger(credit.order) ? credit.order : null,
      popularity: Number(credit.popularity) || 0,
      voteCount: Number(credit.vote_count) || 0,
      score: referenceScore(credit),
    };
    const existing = unique.get(key);
    if (!existing || candidate.score > existing.score) unique.set(key, candidate);
  }

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.voteCount - a.voteCount || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
    .map((credit) => ({
      externalId: credit.externalId,
      tmdbId: credit.tmdbId,
      mediaType: credit.mediaType,
      name: credit.name,
      year: credit.year,
      character: credit.character,
      billingOrder: credit.billingOrder,
      popularity: credit.popularity,
      voteCount: credit.voteCount,
    }));
}

export function buildCastContext(cast, combinedCreditsByPerson, options = {}) {
  return (cast ?? []).slice(0, options.castLimit ?? 6).map((person, billingOrder) => ({
    tmdbPersonId: Number(person.id),
    name: person.name,
    character: typeof person.character === "string" && person.character.trim() ? person.character.trim() : null,
    billingOrder: Number.isInteger(person.order) ? person.order : billingOrder,
    references: rankReferenceCredits(combinedCreditsByPerson.get(Number(person.id)) ?? [], {
      currentTmdbId: options.currentTmdbId,
      currentMediaType: options.currentMediaType,
      limit: options.referenceLimit ?? 8,
      maximumYear: options.maximumYear,
    }),
  }));
}
