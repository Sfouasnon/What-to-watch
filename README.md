# What to Watch

What to Watch is a mobile-first Progressive Web App that turns a viewer’s taste, tonight’s mood, and actual streaming access into a ranked top ten.

**Ten considered picks. One good night.**

The product intentionally avoids an infinite feed and an LLM/chatbot recommendation loop. Its recommendation model is deterministic, explainable, profile-isolated, and tunable.

## Product experience

- Independent household and guest profiles with profile-specific services, region, ratings, questionnaire state, and model version
- Original cold-start flow with 21 taste statements, a 21-genre matrix, three forced choices, and title calibration
- Separate mood and viewing-intent controls, including stand-up as its own medium
- Ten ranked lanes: Best Bet, Close Second, Right Mood, Creator Match, Something Different, Hidden Gem, Go Deeper, Film School Pick, Left Field, and Wild Card
- Clear match explanations, provider/rental labels, title details, credits, people filmographies, ratings, and structured recommendation feedback
- Mutual profile friendships, a Friend’s Picks vibe, and compact friend context only when it helps choose a title
- Optional 1–4 sentence reactions and multi-friend recommendations after a positive rating, with no inbox, feed, unread count, or notification loop
- Taste dashboard, profile management, streaming controls, and an Algorithm Lab with safe JSON export/import
- Installable iPhone-friendly PWA with safe-area layout and an offline shell

## Architecture

- Next.js 16 App Router, React 19, TypeScript, and CSS
- Vitest recommendation-domain tests
- Supabase Auth helpers and normalized Postgres migrations with Row Level Security
- Server-only TMDB search, details/credits, candidate generation, and region-aware availability
- Vercel production target

Without a Supabase session the app stays in explicit browser-local demo mode. Signed-in profiles use Supabase for profiles, settings, questionnaire evidence, ratings/history, recommendations, and feedback; their recommendation candidates and metadata come from TMDB rather than the demo catalog.

When configured, the server endpoints are:

- `GET /api/tmdb/search?query=arrival&page=1`
- `GET /api/tmdb/title?mediaType=movie&id=329865&region=US`
- `GET /api/tmdb/watch-providers?mediaType=movie&id=329865&region=US`
- `POST /api/recommendations` (authenticated, profile-scoped)

The live TMDB endpoints return `503` with a stable error code when `TMDB_TOKEN` is absent.

## Recommendation model

The production domain lives in `src/lib/recommendation/` and keeps raw and normalized scores separate. It scores normalized title features including:

- director, writer, actor, and cinematographer affinity
- genre, subgenre, mood, viewing intent, decade, country, language, and runtime fit
- canonical/editorial signals and Criterion association
- popularity, novelty, and escalating exploration
- similarity to strongly disliked titles
- subscription/free availability and the exceptional-rental margin

Questionnaire influence follows one centralized exponential decay formula. Observed ratings gain confidence as evidence grows and can override an early questionnaire prior. Explanations are assembled from the same evidence used by the scorer.

Hard gates run before ranking: profile region, subscribed services, ad-supported preference, watched-title exclusion (outside rewatch mode), stand-up separation, and rental policy. Results are unique and capped at ten.

Friend evidence is calculated in a separate, capped layer. A Friend’s Picks request combines explicit recommendations, high ratings, recency, useful notes, friend count, and compatibility learned only from overlapping ratings. It cannot bypass mood, watched-title, or availability gates, and it never rewrites the viewer’s personal ratings, questionnaire priors, affinities, or model weights. Normal recommendations keep their original ranking while still showing a small friend banner when the selected title happens to have relevant activity.

If no eligible friend evidence exists, Friend’s Picks falls back to the same personal top ten instead of producing an empty social screen.

## Profiles and data safety

`supabase/migrations/0001_initial.sql` defines account-owned profiles and profile-keyed personalization records. `0002_friends_social.sql` adds profile friendships and privacy-aware social evidence. `0003_profile_runtime_rpcs.sql` adds guarded browser-write boundaries for services, questionnaire data, ratings, recommendations, and feedback. `0004_security_hardening.sql` removes browser execution from trigger-only functions, `0005_api_table_grants.sql` replaces unsafe default table privileges with RLS-governed authenticated DML, `0006_runtime_security_and_integrity.sql` hardens social-profile privacy, questionnaire retakes, TMDB identity writes, and runtime payload validation, and `0007_social_compatibility_service_fix.sql` preserves the service-only friendship compatibility refresh behind the hardened caller checks.

The schema includes normalized titles, people/credits, genres/tags, curated lists, Criterion metadata, expiring provider offers, ratings, watch history, questionnaire versions/responses, affinities, recommendation events/items/feedback, model versions, and performance metrics.

Algorithm imports accept only allow-listed, range-checked configuration fields. They create a new configuration/model version and cannot accept ratings, watch history, recommendation history, or raw feedback as parameters. Cloning a profile copies household access/settings only—not taste or history.

Each profile chooses one sharing mode: `ratings_and_reviews`, `ratings_only`, or `nothing`. Raw ratings and reviews remain owner-only tables; a guarded title-context RPC reveals only fields permitted by the source profile’s setting. An explicit recommendation remains visible to its intended recipient regardless of general sharing, while questionnaire answers, raw model data, weights, recommendation history, and private viewing settings are never social fields.

The browser-local demo seeds a few friend profiles so the interaction can be evaluated without a configured backend. It never reads or writes authenticated profile data.

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
```

`TMDB_TOKEN` is server-only. Never expose it through a `NEXT_PUBLIC_` variable. The application does not require or use a Supabase service-role key.

## Supabase setup

Create or choose a dedicated Supabase project, then apply all migrations in order using the Supabase dashboard, connector, or CLI:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Add the project URL and publishable/anon key to local and Vercel environment variables. In Supabase Auth URL Configuration, allow `/auth/callback` for localhost and the eventual production origin. `/account` then enables passwordless email sign-in; without those variables it clearly identifies browser-local demo mode.

## Quality gate

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The deterministic suite covers strict service/region gating, marketplace-versus-subscription distinctions, exceptional rentals, stand-up separation, watched/rewatch behavior, creator and dislike learning, prior decay, profile isolation, Criterion semantics, canonical modes, exact top-ten lanes/uniqueness, explanations, raw/normalized scores, serializability, config-import safety, friend privacy, explicit recommendations, overlap-weighted influence, no-evidence fallback, social hard-gate enforcement, and TMDB movie/TV/provider normalization. Live catalog observations are run separately because availability changes.

## Deploy to Vercel

```bash
vercel --prod
```

Configure the same environment variables in the Vercel project before enabling live Supabase/TMDB behavior. The app builds and runs without them in safe demo mode.

## PWA and offline behavior

The manifest, branded 180/192/512 icons, and service worker are in `public/`. The service worker caches the app shell and same-origin assets after use, applies a navigation fallback, and intentionally bypasses API and cross-origin requests so metadata/availability errors are never disguised as current data.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Watch-provider data exposed through TMDB may be powered by JustWatch. Provider availability changes over time and should be rechecked before viewing.
