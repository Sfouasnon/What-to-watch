// Pure TMDB -> Supabase mapping helpers shared by the catalog hydration scripts.
//
// Everything in this module is factual metadata. Editorial semantics
// (subgenres, tone tags, pacing) are produced by a separate process and must
// never be derived here, so the allowlists below are enforced rather than
// documented: `assertFactualTitleFields` throws if a caller ever tries to write
// a column outside the factual set.

/** Columns on `public.titles` that TMDB hydration is permitted to write. */
export const FACTUAL_TITLE_FIELDS = Object.freeze([
  "name",
  "original_name",
  "overview",
  "release_date",
  "end_date",
  "runtime_minutes",
  "episode_runtime_minutes",
  "season_count",
  "episode_count",
  "original_language",
  "production_countries",
  "poster_path",
  "backdrop_path",
  "popularity",
  "vote_average",
  "vote_count",
  "external_ids",
  "metadata_source",
  "metadata_checked_at",
]);

/**
 * Fields that carry a real-world value which TMDB occasionally omits on a
 * given request. When the fresh payload is null but a value is already
 * persisted, the persisted value wins instead of being blanked out.
 */
export const PRESERVE_WHEN_NULL_FIELDS = Object.freeze([
  "overview",
  "release_date",
  "end_date",
  "runtime_minutes",
  "episode_runtime_minutes",
  "season_count",
  "episode_count",
  "poster_path",
  "backdrop_path",
  "original_language",
]);

/** Tables owned by the editorial pipeline. Hydration never writes to these. */
export const EDITORIAL_TABLES = Object.freeze([
  "title_editorial_classifications",
  "title_classification_inputs",
]);

const FACTUAL_TITLE_FIELD_SET = new Set(FACTUAL_TITLE_FIELDS);

const WRITING_JOBS = new Set(["Writer", "Screenplay", "Teleplay", "Story"]);
const PRODUCTION_JOBS = new Set(["Producer", "Executive Producer"]);
const ENDED_TV_STATUSES = new Set(["Ended", "Canceled", "Cancelled"]);

/** Maximum billed cast members persisted as `acting` credits per title. */
export const MAX_CAST_CREDITS = 20;

export function dateOrNull(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;
}

function positiveIntegerOrNull(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function nonNegativeIntegerOrNull(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

/**
 * Throws when a row destined for `public.titles` carries a column outside the
 * factual allowlist. This is the guard that keeps a hydration run from ever
 * mutating editorial or scoring columns such as `canonical_score`.
 */
export function assertFactualTitleFields(row) {
  const offending = Object.keys(row).filter((field) => !FACTUAL_TITLE_FIELD_SET.has(field));
  if (offending.length) {
    throw new Error(`Hydration attempted to write non-factual title columns: ${offending.join(", ")}`);
  }
  return row;
}

/**
 * Maps a TMDB movie/tv detail payload onto the factual columns of
 * `public.titles`. Identity columns are intentionally excluded: the caller
 * already resolved the row and updates it by primary key.
 */
export function factualTitleFields(detail, mediaType, checkedAt = new Date().toISOString()) {
  const isMovie = mediaType === "movie";

  const row = {
    name: (isMovie ? detail.title : detail.name) ?? null,
    original_name: (isMovie ? detail.original_title : detail.original_name) || null,
    overview: detail.overview || null,
    release_date: dateOrNull(isMovie ? detail.release_date : detail.first_air_date),
    end_date: !isMovie && ENDED_TV_STATUSES.has(detail.status)
      ? dateOrNull(detail.last_air_date)
      : null,
    runtime_minutes: isMovie ? positiveIntegerOrNull(detail.runtime) : null,
    episode_runtime_minutes: isMovie ? null : positiveIntegerOrNull(detail.episode_run_time?.[0]),
    season_count: isMovie ? null : nonNegativeIntegerOrNull(detail.number_of_seasons),
    episode_count: isMovie ? null : nonNegativeIntegerOrNull(detail.number_of_episodes),
    original_language: detail.original_language || null,
    production_countries: isMovie
      ? (detail.production_countries ?? []).map((country) => country.iso_3166_1).filter(Boolean)
      : (detail.origin_country ?? []).filter(Boolean),
    poster_path: detail.poster_path || null,
    backdrop_path: detail.backdrop_path || null,
    popularity: Number.isFinite(detail.popularity) ? detail.popularity : null,
    vote_average: Number.isFinite(detail.vote_average) ? detail.vote_average : null,
    vote_count: nonNegativeIntegerOrNull(detail.vote_count),
    external_ids: detail.external_ids ?? {},
    metadata_source: "tmdb",
    metadata_checked_at: checkedAt,
  };

  if (!row.name) {
    throw new Error("TMDB detail payload is missing a title name.");
  }

  return assertFactualTitleFields(row);
}

/**
 * Drops fields whose fresh value is null while the persisted row already holds
 * a value, so a sparse TMDB response never erases good metadata.
 */
export function mergePreservingExisting(fresh, existing) {
  if (!existing) return { ...fresh };
  const merged = { ...fresh };
  for (const field of PRESERVE_WHEN_NULL_FIELDS) {
    if (merged[field] === null && existing[field] !== null && existing[field] !== undefined) {
      delete merged[field];
    }
  }
  return merged;
}

function creditKey(credit) {
  return JSON.stringify([credit.person_tmdb_id, credit.department, credit.job, credit.character_name]);
}

/**
 * Normalizes a TMDB detail payload's `credits` (plus `created_by` on series)
 * into `public.people` and `public.title_credits` shapes.
 *
 * Departments are constrained to the values allowed by the `title_credits`
 * check constraint. Duplicate rows are collapsed on the same tuple the table's
 * unique constraint uses, so the result can be inserted as-is.
 */
export function normalizeCredits(detail, mediaType) {
  const cast = detail.credits?.cast ?? [];
  const crew = detail.credits?.crew ?? [];
  const creators = mediaType === "tv" ? detail.created_by ?? [] : [];

  const peopleByTmdbId = new Map();
  const credits = [];
  const seen = new Set();

  const rememberPerson = (person) => {
    if (!Number.isInteger(person?.id) || person.id <= 0 || !person?.name) return false;
    const existing = peopleByTmdbId.get(person.id);
    peopleByTmdbId.set(person.id, {
      tmdb_id: person.id,
      name: person.name,
      profile_path: person.profile_path || existing?.profile_path || null,
    });
    return true;
  };

  const addCredit = (person, department, job, characterName, billingOrder) => {
    if (!rememberPerson(person)) return;
    const credit = {
      person_tmdb_id: person.id,
      department,
      job: job ?? null,
      character_name: characterName || null,
      billing_order: Number.isInteger(billingOrder) ? billingOrder : null,
    };
    const key = creditKey(credit);
    if (seen.has(key)) return;
    seen.add(key);
    credits.push(credit);
  };

  cast
    .slice()
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_CAST_CREDITS)
    .forEach((member, index) => {
      addCredit(member, "acting", "Actor", member.character, member.order ?? index);
    });

  for (const creator of creators) {
    addCredit(creator, "writing", "Creator", null, null);
  }

  for (const member of crew) {
    if (member.job === "Director") addCredit(member, "directing", "Director", null, null);
    else if (WRITING_JOBS.has(member.job)) addCredit(member, "writing", member.job, null, null);
    else if (member.job === "Director of Photography") addCredit(member, "cinematography", member.job, null, null);
    else if (PRODUCTION_JOBS.has(member.job)) addCredit(member, "production", member.job, null, null);
  }

  return { people: [...peopleByTmdbId.values()], credits };
}

/** TMDB genre ids are namespaced by media type in the `genres` lookup table. */
export function genreLookupKey(mediaType, tmdbGenreId) {
  return `${mediaType}:${tmdbGenreId}`;
}
