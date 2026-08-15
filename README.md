# What to Watch

What to Watch is a mobile-first Progressive Web App that turns a viewer’s taste, tonight’s mood, and actual streaming access into a ranked top ten.

**Ten considered picks. One good night.**

The product intentionally avoids an infinite feed and an LLM/chatbot recommendation loop. Its recommendation model is deterministic, explainable, profile-isolated, and tunable.

## Product experience

- Independent household and guest profiles with profile-specific services, region, ratings, questionnaire state, and model version
- Questionnaire-first cold start with 11 plain-language core statements, genre outliers, conditional comedy/horror follow-ups, and adaptive title calibration
- Separate mood and viewing-intent controls, including stand-up as its own medium
- Ten ranked lanes: Best Bet, Close Second, Right Mood, Creator Match, Something Different, Hidden Gem, Go Deeper, Film School Pick, Left Field, and Wild Card
- Personalized match narratives grounded in scoring evidence, cached TMDB cast history, title details, and the viewer’s own ratings
- Mutual profile friendships, a Friend’s Picks vibe, and compact friend context only when it helps choose a title
- Optional 1–4 sentence reactions and multi-friend recommendations after a positive rating, with no inbox, feed, unread count, or notification loop
- Taste dashboard, profile management, streaming controls, and an Algorithm Lab with safe JSON export/import
- Installable iPhone-friendly PWA with safe-area layout and an offline shell

## Architecture

- Next.js 16 App Router, React 19, TypeScript, and CSS
- Vitest recommendation-domain tests
- Supabase Auth helpers and normalized Postgres migrations with Row Level Security
- Server-only TMDB metadata search and region-aware watch-provider endpoints
- Vercel production target

The polished deployed experience starts in an explicit local demo mode so it remains usable without secrets. Demo title/provider records are labeled as demo availability and should not be interpreted as live provider data.

When configured, the server endpoints are:

- `GET /api/tmdb/search?query=arrival&page=1`
- `GET /api/tmdb/watch-providers?mediaType=movie&id=329865&region=US`

Both return `503` with a stable error code when `TMDB_TOKEN` is absent.

## Recommendation model

The production domain lives in `src/lib/recommendation/` and keeps raw and normalized scores separate. It scores normalized title features including:

- director, writer, actor, and cinematographer affinity
- genre, subgenre, mood, viewing intent, decade, country, language, and runtime fit
- canonical/editorial signals and Criterion association
- popularity, novelty, and escalating exploration
- similarity to strongly disliked titles
- subscription/free availability and the exceptional-rental margin

Questionnaire influence follows one centralized exponential decay formula. Observed ratings gain confidence as evidence grows and can override an early questionnaire prior. Explanations are assembled from the same evidence used by the scorer.

The browser experience calls this same domain engine through a data adapter; there is no second UI-side ranking formula. Eleven core statements map explicitly to canonical dimensions. Genre outliers establish strong likes and cautions, while optional 1–7 fine-tuning preserves more nuance. Scripted-comedy and horror follow-ups appear only when the selected genres make them useful. Title calibration then chooses titles that clarify the viewer’s strongest or least-certain preference axes instead of presenting a generic fixed set.

Recommendation copy is composed from the same evidence packet used for ranking. It explains the requested mood, the title’s subgenre/tone/pace, a relevant questionnaire or rating signal, and the title setup. A server-side enrichment job caches principal-cast projects from TMDB combined credits. When possible, the narrative favors a project the viewer personally rated highly; otherwise it uses a recognizable prior credit without making an unsupported quality claim.

Hard gates run before ranking: profile region, subscribed services, ad-supported preference, watched-title exclusion (outside rewatch mode), stand-up separation, and rental policy. Results are unique and capped at ten.

Tonight's mood is a hard content gate. Vibes that promise a concrete catalog subset—rewatch, classic, international, bingeable TV, trending series, director completion, Criterion, film-school, blind-spot, and go-deeper—are also hard gates. Discovery, hidden-gem, surprise, and Friend's Picks remain ranking preferences so they can broaden results without producing an unnecessarily empty list.

Per-title feedback is first-class evidence. Already-seen, not-interested, misclassified, and unavailable feedback excludes that title. Wrong-mood and good-but-wrong-night feedback suppresses it only for the matching tonight context. Too-dark, too-light, too-old, too-long, disliked-actor, and recommendation-quality scores adjust future candidates with the corresponding or similar features.

Friend evidence is calculated in a separate, capped layer. A Friend’s Picks request combines explicit recommendations, high ratings, recency, useful notes, friend count, and compatibility learned only from overlapping ratings. It cannot bypass mood, watched-title, or availability gates, and it never rewrites the viewer’s personal ratings, questionnaire priors, affinities, or model weights. Normal recommendations keep their original ranking while still showing a small friend banner when the selected title happens to have relevant activity.

If no eligible friend evidence exists, Friend’s Picks falls back to the same personal top ten instead of producing an empty social screen.

## Profiles and data safety

`supabase/migrations/0001_initial.sql` defines account-owned profiles and profile-keyed personalization records. `supabase/migrations/0002_friends_social.sql` adds mutual profile friendships, short review notes, explicit recommendations, an internal compatibility cache, privacy-aware contextual activity, and guarded request/accept/decline/remove RPCs.

The schema includes normalized titles, people/credits, genres/tags, curated lists, Criterion metadata, expiring provider offers, ratings, watch history, questionnaire versions/responses, affinities, recommendation events/items/feedback, model versions, and performance metrics.

Algorithm imports accept only allow-listed, range-checked configuration fields. They create a new configuration/model version and cannot accept ratings, watch history, recommendation history, or raw feedback as parameters. Cloning a profile copies household access/settings only—not taste or history.

Each profile chooses one sharing mode: `ratings_and_reviews`, `ratings_only`, or `nothing`. Raw ratings and reviews remain owner-only tables; a guarded title-context RPC reveals only fields permitted by the source profile’s setting. An explicit recommendation remains visible to its intended recipient regardless of general sharing, while questionnaire answers, raw model data, weights, recommendation history, and private viewing settings are never social fields.

The browser-local demo seeds a few friend profiles so the complete interaction can be evaluated without a configured backend. Production persistence requires applying both Supabase migrations and configuring Auth; the repository does not claim that a live Supabase project is already connected.

## Local setup

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
TMDB_TOKEN=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=
```

`TMDB_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are server-only. Never expose them through a `NEXT_PUBLIC_` variable.

## Supabase setup

Create or choose a dedicated Supabase project, then apply the migration using the Supabase dashboard, connector, or CLI:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Add the project URL and publishable/anon key to local and Vercel environment variables. `/account` then enables passwordless email sign-in; without those variables it clearly identifies browser-local demo mode.

## Catalog pipeline

All catalog scripts require `TMDB_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`, and hydration additionally requires `supabase/migrations/20260811190840_catalog_hydration_grants.sql`. Supabase checks PostgreSQL object grants before RLS, and the service-role key bypasses RLS but never object grants, so without that migration the hydrator stops on its first write with an explicit pointer to it.

```bash
npm run catalog:seed-gold      # 100 pilot titles + gold editorial classifications
npm run catalog:hydrate-gold   # factual TMDB metadata, artwork, and normalized credits
npm run catalog:validate-gold  # assert the gold benchmark is intact
```

`catalog:seed-gold` establishes identity and editorial truth from `curation/`. `catalog:hydrate-gold` then fills in what the pilot sample never carried: posters and backdrops, release and end dates, runtimes, season/episode counts, external ids, refreshed genre links, and normalized `people`/`title_credits` rows.

The two concerns stay strictly separated:

- Hydration writes only the factual allowlist in `scripts/catalog/lib/tmdb-mapping.mjs`. Writing any other column on `titles` throws before a request is sent.
- Hydration never writes `title_editorial_classifications`. The script snapshots the gold rows before it runs and re-compares afterwards, failing the run on any drift. The database enforces the same rule independently through the `protect_gold_editorial_classification` trigger.
- Hydration never rewrites `title_classification_inputs`. That packet is the frozen evidence the gold labels were derived from, so refreshing it would change the benchmark's provenance.
- Migration 0005 grants `service_role` DML on the factual tables only. Both editorial tables keep `select` and nothing else, so the separation holds at the object-privilege level even if the application-side guards were bypassed.

A sparse TMDB response never blanks good metadata: when a fresh value is null and a value is already persisted, the persisted value is kept.

```bash
npm run catalog:hydrate-gold -- --dry-run              # report without writing
npm run catalog:hydrate-gold -- --media-type=tv        # series only
npm run catalog:hydrate-gold -- --limit=10 --delay-ms=250
```

`scripts/catalog/hydrate-tmdb.mjs` remains the queue-driven hydrator for the wider TMDB catalog index; `hydrate-gold-100.mjs` targets the pilot 100 by identity instead.

To preview and then write the bounded cast-history cache for up to 100 gold titles:

```bash
node --env-file=.env.local scripts/catalog/enrich-cast-context.mjs --limit=3
node --env-file=.env.local scripts/catalog/enrich-cast-context.mjs --limit=100 --write
```

The job stores only six principal cast members and at most eight ranked released credits per person in the server-only `title_cast_context_cache`. Classification input packets stay append-only and are never rewritten by cache refreshes.

## Quality gate

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test suite covers strict service/region gating, marketplace-versus-subscription distinctions, exceptional rentals, stand-up separation, watched/rewatch behavior, creator and dislike learning, prior decay, profile isolation, Criterion semantics, canonical modes, exact top-ten lanes/uniqueness, explanations, raw/normalized scores, serializability, config-import safety, friend privacy, explicit recommendations, overlap-weighted influence, no-evidence fallback, and social hard-gate enforcement.

## Deploy to Vercel

```bash
vercel --prod
```

Configure the same environment variables in the Vercel project before enabling live Supabase/TMDB behavior. The app builds and runs without them in safe demo mode.

## PWA and offline behavior

The manifest, branded 180/192/512 icons, and service worker are in `public/`. The service worker caches the app shell and same-origin assets after use, applies a navigation fallback, and intentionally bypasses API and cross-origin requests so metadata/availability errors are never disguised as current data.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Watch-provider data exposed through TMDB may be powered by JustWatch. Provider availability changes over time and should be rechecked before viewing.
