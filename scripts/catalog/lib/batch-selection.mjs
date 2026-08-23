const identity = (item) => `${item.mediaType}:${item.tmdbId}`;

const asFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const releaseDate = (item, mediaType) => mediaType === "movie"
  ? item.release_date
  : item.first_air_date;

export function normalizeDiscoverCandidate(item, mediaType, source) {
  const date = releaseDate(item, mediaType);
  const year = Number.parseInt(String(date ?? "").slice(0, 4), 10);
  return {
    mediaType,
    tmdbId: Number(item.id),
    name: mediaType === "movie" ? item.title : item.name,
    originalName: mediaType === "movie" ? item.original_title : item.original_name,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : null,
    year: Number.isInteger(year) ? year : null,
    overview: typeof item.overview === "string" ? item.overview.trim() : "",
    genreIds: [...new Set((item.genre_ids ?? []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b),
    originalLanguage: item.original_language || null,
    popularity: asFiniteNumber(item.popularity),
    voteAverage: asFiniteNumber(item.vote_average),
    voteCount: Math.max(0, Math.trunc(asFiniteNumber(item.vote_count))),
    posterPath: item.poster_path || null,
    adult: item.adult === true,
    video: mediaType === "movie" ? item.video === true : false,
    discoverySources: [source],
  };
}

export function mergeCandidatePools(pools) {
  const merged = new Map();
  for (const pool of pools) {
    for (const candidate of pool) {
      const key = identity(candidate);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...candidate, discoverySources: [...candidate.discoverySources] });
        continue;
      }
      existing.discoverySources = [...new Set([...existing.discoverySources, ...candidate.discoverySources])].sort();
      if (candidate.voteCount > existing.voteCount) {
        merged.set(key, { ...candidate, discoverySources: existing.discoverySources });
      }
    }
  }
  return [...merged.values()];
}

function decade(year) {
  if (!Number.isInteger(year)) return "unknown";
  if (year < 1960) return "pre-1960";
  return `${Math.floor(year / 10) * 10}s`;
}

function baseScore(candidate) {
  return Math.log10(candidate.voteCount + 1) * 24
    + candidate.voteAverage * 3
    + Math.log10(candidate.popularity + 1) * 5;
}

export function selectDiversifiedCandidates(candidates, target, {
  excludedIdentities = new Set(),
  minimumVotes = 200,
  minimumOverviewLength = 40,
  minimumReleaseDate = null,
  maximumReleaseDate = null,
} = {}) {
  if (!Number.isInteger(target) || target < 1) throw new Error("target must be a positive integer");

  const eligible = candidates.filter((candidate) =>
    !excludedIdentities.has(identity(candidate))
    && Number.isInteger(candidate.tmdbId)
    && candidate.tmdbId > 0
    && !candidate.adult
    && !candidate.video
    && candidate.voteCount >= minimumVotes
    && candidate.overview.length >= minimumOverviewLength
    && candidate.releaseDate
    && (!minimumReleaseDate || candidate.releaseDate >= minimumReleaseDate)
    && (!maximumReleaseDate || candidate.releaseDate <= maximumReleaseDate)
    && candidate.posterPath
    && candidate.genreIds.length > 0,
  );

  const remaining = new Map(eligible.map((candidate) => [identity(candidate), candidate]));
  const genreCounts = new Map();
  const decadeCounts = new Map();
  const languageCounts = new Map();
  const selected = [];

  while (selected.length < target && remaining.size > 0) {
    let winner = null;
    let winnerScore = Number.NEGATIVE_INFINITY;

    for (const candidate of remaining.values()) {
      const genreBonus = candidate.genreIds
        .map((genreId) => 10 / Math.sqrt((genreCounts.get(genreId) ?? 0) + 1))
        .reduce((sum, value) => sum + value, 0) / candidate.genreIds.length;
      const decadeBonus = 7 / Math.sqrt((decadeCounts.get(decade(candidate.year)) ?? 0) + 1);
      const languageBonus = 3 / Math.sqrt((languageCounts.get(candidate.originalLanguage ?? "unknown") ?? 0) + 1);
      const score = baseScore(candidate) + genreBonus + decadeBonus + languageBonus;

      if (score > winnerScore || (score === winnerScore && candidate.tmdbId < winner.tmdbId)) {
        winner = candidate;
        winnerScore = score;
      }
    }

    if (!winner) break;
    remaining.delete(identity(winner));
    selected.push({ ...winner, selectionRank: selected.length + 1, selectionScore: Number(winnerScore.toFixed(4)) });
    for (const genreId of winner.genreIds) genreCounts.set(genreId, (genreCounts.get(genreId) ?? 0) + 1);
    const decadeKey = decade(winner.year);
    decadeCounts.set(decadeKey, (decadeCounts.get(decadeKey) ?? 0) + 1);
    const languageKey = winner.originalLanguage ?? "unknown";
    languageCounts.set(languageKey, (languageCounts.get(languageKey) ?? 0) + 1);
  }

  if (selected.length !== target) {
    throw new Error(`Only ${selected.length} eligible candidates were available for a target of ${target}.`);
  }
  return selected;
}

export function buildHydrationBatches(movieTitles, tvTitles, batchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer");
  const total = movieTitles.length + tvTitles.length;
  const batchCount = Math.ceil(total / batchSize);
  const batches = [];
  let movieIndex = 0;
  let tvIndex = 0;

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const remainingTotal = total - movieIndex - tvIndex;
    const currentSize = Math.min(batchSize, remainingTotal);
    const remainingMovies = movieTitles.length - movieIndex;
    const remainingTv = tvTitles.length - tvIndex;
    const movieShare = remainingMovies / Math.max(1, remainingMovies + remainingTv);
    let movieCount = Math.round(currentSize * movieShare);
    movieCount = Math.min(remainingMovies, Math.max(0, movieCount));
    let tvCount = currentSize - movieCount;
    if (tvCount > remainingTv) {
      movieCount += tvCount - remainingTv;
      tvCount = remainingTv;
    }

    const movies = movieTitles.slice(movieIndex, movieIndex + movieCount);
    const television = tvTitles.slice(tvIndex, tvIndex + tvCount);
    movieIndex += movieCount;
    tvIndex += tvCount;

    const titles = [];
    for (let index = 0; index < Math.max(movies.length, television.length); index += 1) {
      if (movies[index]) titles.push(movies[index]);
      if (television[index]) titles.push(television[index]);
    }

    batches.push({
      batchNumber: batchIndex + 1,
      titleCount: titles.length,
      movieCount: movies.length,
      tvCount: television.length,
      titles,
    });
  }

  return batches;
}

export function validateHydrationManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== "catalog-hydration-manifest-v1") errors.push("Unexpected schemaVersion.");
  if (!Array.isArray(manifest?.batches) || manifest.batches.length === 0) errors.push("Manifest has no batches.");

  const identities = new Set();
  let countedTitles = 0;
  for (const batch of manifest?.batches ?? []) {
    if (!Number.isInteger(batch.batchNumber) || batch.batchNumber < 1) errors.push("Invalid batch number.");
    if (!Array.isArray(batch.titles) || batch.titles.length !== batch.titleCount) {
      errors.push(`Batch ${batch.batchNumber ?? "?"} titleCount does not match its titles.`);
      continue;
    }
    countedTitles += batch.titles.length;
    for (const title of batch.titles) {
      const key = `${title.mediaType}:${title.tmdbId}`;
      if (!['movie', 'tv'].includes(title.mediaType) || !Number.isInteger(title.tmdbId) || title.tmdbId < 1) {
        errors.push(`Invalid title identity ${key}.`);
      }
      if (identities.has(key)) errors.push(`Duplicate title identity ${key}.`);
      if (manifest?.selector?.minimumReleaseDate && title.releaseDate < manifest.selector.minimumReleaseDate) {
        errors.push(`Title ${key} predates selector minimumReleaseDate.`);
      }
      if (manifest?.selector?.maximumReleaseDate && title.releaseDate > manifest.selector.maximumReleaseDate) {
        errors.push(`Title ${key} exceeds selector maximumReleaseDate.`);
      }
      identities.add(key);
    }
  }
  if (manifest?.titleCount !== countedTitles) errors.push("Manifest titleCount does not match its batches.");
  return errors;
}
