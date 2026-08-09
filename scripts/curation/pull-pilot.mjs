import fs from "node:fs";

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) {
  console.error("TMDB_TOKEN is not set. Load .env.local before running.");
  process.exit(1);
}

const BASE = "https://api.themoviedb.org/3";
const REGION = "US";

const TARGET_SERVICES = [
  "Netflix",
  "Hulu",
  "Disney Plus",
  "HBO Max",
  "Amazon Prime Video",
  "Apple TV Plus",
  "Paramount Plus",
  "Peacock Premium",
  "Criterion Channel"
];

const PROVIDER_EXACT_NAME_ALIASES = {
  "Netflix": ["Netflix"],
  "Hulu": ["Hulu"],
  "Disney Plus": ["Disney Plus"],
  "HBO Max": ["HBO Max"],
  "Amazon Prime Video": ["Amazon Prime Video"],
  "Apple TV Plus": ["Apple TV"],
  "Paramount Plus": ["Paramount Plus Premium"],
  "Peacock Premium": ["Peacock Premium"],
  "Criterion Channel": ["Criterion Channel"]
};

async function tmdb(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      accept: "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${url.pathname}`);
  }

  return res.json();
}

function normalizeName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findProviderByExactAlias(name, providers) {
  const aliases = PROVIDER_EXACT_NAME_ALIASES[name];

  if (!aliases) {
    throw new Error(`No exact provider aliases configured for ${name}`);
  }

  for (const alias of aliases) {
    const exact = providers.find(p => p.provider_name === alias);
    if (exact) return exact;
  }

  return null;
}

function assertAppleTvPlusResolution(resolved) {
  const appleTvPlus = resolved.find(
    service => service.requested === "Apple TV Plus"
  );
  const aliases = PROVIDER_EXACT_NAME_ALIASES["Apple TV Plus"];
  const isExactAlias = provider =>
    provider !== null && aliases.includes(provider.name);

  if (
    !appleTvPlus ||
    !isExactAlias(appleTvPlus.movie_provider) ||
    !isExactAlias(appleTvPlus.tv_provider)
  ) {
    throw new Error(
      "Apple TV Plus did not resolve to an exact configured alias for both movie and TV; aborting before sample write."
    );
  }
}

async function getProviders(type) {
  const data = await tmdb(`/watch/providers/${type}`, {
    watch_region: REGION,
    language: "en-US"
  });
  return data.results ?? [];
}

async function discover(type, providerId, page = 1) {
  return tmdb(`/discover/${type}`, {
    watch_region: REGION,
    with_watch_providers: providerId,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    include_adult: false,
    language: "en-US",
    page
  });
}

async function enrich(item, type) {
  const append =
    type === "movie"
      ? "credits,keywords"
      : "credits,keywords,content_ratings";

  const detail = await tmdb(`/${type}/${item.id}`, {
    language: "en-US",
    append_to_response: append
  });

  const credits = detail.credits ?? {};
  const crew = credits.crew ?? [];

  const directors = crew
    .filter(x => x.job === "Director")
    .map(x => x.name);

  const writers = crew
    .filter(x =>
      ["Writer", "Screenplay", "Teleplay", "Story"].includes(x.job)
    )
    .map(x => x.name);

  const cinematographers = crew
    .filter(x => x.job === "Director of Photography")
    .map(x => x.name);

  const cast = (credits.cast ?? []).slice(0, 6).map(x => x.name);

  const keywordList =
    detail.keywords?.keywords ??
    detail.keywords?.results ??
    [];

  return {
    tmdb_id: item.id,
    media_type: type,
    title: type === "movie" ? detail.title : detail.name,
    original_title:
      type === "movie" ? detail.original_title : detail.original_name,
    year: Number(
      (type === "movie"
        ? detail.release_date
        : detail.first_air_date
      )?.slice(0, 4) || 0
    ) || null,
    overview: detail.overview || null,
    tmdb_genres: (detail.genres ?? []).map(g => g.name),
    runtime:
      type === "movie"
        ? detail.runtime || null
        : detail.episode_run_time?.[0] || null,
    original_language: detail.original_language || null,
    origin_country:
      type === "movie"
        ? (detail.production_countries ?? []).map(c => c.iso_3166_1)
        : detail.origin_country ?? [],
    popularity: detail.popularity ?? null,
    vote_average: detail.vote_average ?? null,
    vote_count: detail.vote_count ?? null,
    directors,
    writers: [...new Set(writers)],
    cinematographers,
    principal_cast: cast,
    keywords: keywordList.slice(0, 15).map(k => k.name)
  };
}

async function main() {
  const movieProviders = await getProviders("movie");
  const tvProviders = await getProviders("tv");

  const resolved = [];

  for (const requested of TARGET_SERVICES) {
    const movie = findProviderByExactAlias(requested, movieProviders);
    const tv = findProviderByExactAlias(requested, tvProviders);

    resolved.push({
      requested,
      movie_provider: movie
        ? { id: movie.provider_id, name: movie.provider_name }
        : null,
      tv_provider: tv
        ? { id: tv.provider_id, name: tv.provider_name }
        : null
    });
  }

  console.log("Resolved providers:");
  console.table(resolved);
  assertAppleTvPlusResolution(resolved);

  const pool = new Map();

  // Pull more than needed, because provider catalogs overlap heavily.
  for (const service of resolved) {
    for (const type of ["movie", "tv"]) {
      const provider =
        type === "movie" ? service.movie_provider : service.tv_provider;

      if (!provider) continue;

      for (const page of [1, 2]) {
        const data = await discover(type, provider.id, page);

        for (const item of data.results ?? []) {
          const key = `${type}:${item.id}`;

          if (!pool.has(key)) {
            pool.set(key, {
              item,
              type,
              providers: new Set()
            });
          }

          pool.get(key).providers.add(provider.name);
        }
      }
    }
  }

  const movies = [...pool.values()]
    .filter(x => x.type === "movie")
    .sort((a, b) => (b.item.popularity ?? 0) - (a.item.popularity ?? 0));

  const tv = [...pool.values()]
    .filter(x => x.type === "tv")
    .sort((a, b) => (b.item.popularity ?? 0) - (a.item.popularity ?? 0));

  // Diversified round-robin by provider rather than simply top 50 popularity.
  function diversifiedPick(items, target) {
    const picked = [];
    const used = new Set();

    while (picked.length < target) {
      let addedThisRound = false;

      for (const service of TARGET_SERVICES) {
        const candidate = items.find(x => {
          const key = `${x.type}:${x.item.id}`;
          return (
            !used.has(key) &&
            [...x.providers].some(p =>
              normalizeName(p).includes(
                normalizeName(service).slice(0, 5)
              )
            )
          );
        });

        if (candidate) {
          const key = `${candidate.type}:${candidate.item.id}`;
          used.add(key);
          picked.push(candidate);
          addedThisRound = true;
          if (picked.length >= target) break;
        }
      }

      if (!addedThisRound) {
        const next = items.find(
          x => !used.has(`${x.type}:${x.item.id}`)
        );
        if (!next) break;
        used.add(`${next.type}:${next.item.id}`);
        picked.push(next);
      }
    }

    return picked;
  }

  const selected = [
    ...diversifiedPick(movies, 50),
    ...diversifiedPick(tv, 50)
  ];

  const output = [];

  for (let i = 0; i < selected.length; i++) {
    const x = selected[i];
    process.stdout.write(
      `\rEnriching ${i + 1}/${selected.length}...`
    );

    const metadata = await enrich(x.item, x.type);

    output.push({
      ...metadata,
      sampled_streaming_providers: [...x.providers].sort()
    });
  }

  console.log("\nDone.");

  const packet = {
    schema_version: "curation-pilot-1",
    region: REGION,
    generated_at: new Date().toISOString(),
    title_count: output.length,
    provider_resolution: resolved,
    titles: output
  };

  fs.writeFileSync(
    "curation/pilot/sample-100.json",
    JSON.stringify(packet, null, 2)
  );

  fs.writeFileSync(
    "curation/pilot/provider-resolution.json",
    JSON.stringify(resolved, null, 2)
  );

  console.log(
    `Wrote ${output.length} titles to curation/pilot/sample-100.json`
  );
}

main().catch(err => {
  console.error("\nPilot pull failed:", err);
  process.exit(1);
});
