-- What to Watch: initial production schema
-- Supabase Auth owns identities. `profiles` own every personalization signal.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_key text,
  avatar_url text,
  is_guest boolean not null default false,
  onboarding_completed boolean not null default false,
  region text not null default 'US' check (region ~ '^[A-Z]{2}$'),
  cloned_from_profile_id uuid references public.profiles(id) on delete set null,
  current_model_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_account_id_idx on public.profiles(account_id);

create table public.profile_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  rental_policy text not null default 'exceptional'
    check (rental_policy in ('never', 'exceptional', 'always')),
  allow_free_with_ads boolean not null default true,
  allow_purchase_only boolean not null default false,
  max_runtime_minutes integer check (max_runtime_minutes is null or max_runtime_minutes > 0),
  excluded_content_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.streaming_services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  display_name text not null,
  tmdb_provider_id integer,
  logo_path text,
  website_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index streaming_services_tmdb_provider_idx
  on public.streaming_services(tmdb_provider_id) where tmdb_provider_id is not null;

create table public.profile_streaming_services (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid not null references public.streaming_services(id) on delete restrict,
  subscribed_at timestamptz not null default now(),
  primary key (profile_id, service_id)
);

create index profile_streaming_services_service_idx
  on public.profile_streaming_services(service_id, profile_id);

-- Shared, normalized metadata cache. Clients may read it; only trusted server roles write it.
create table public.titles (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer,
  tmdb_media_type text check (tmdb_media_type in ('movie', 'tv')),
  content_type text not null check (content_type in ('movie', 'tv_series', 'standup_special')),
  name text not null,
  original_name text,
  overview text,
  release_date date,
  end_date date,
  runtime_minutes integer check (runtime_minutes is null or runtime_minutes > 0),
  episode_runtime_minutes integer check (episode_runtime_minutes is null or episode_runtime_minutes > 0),
  season_count integer check (season_count is null or season_count >= 0),
  episode_count integer check (episode_count is null or episode_count >= 0),
  original_language text,
  production_countries text[] not null default '{}',
  poster_path text,
  backdrop_path text,
  popularity numeric,
  vote_average numeric check (vote_average is null or vote_average between 0 and 10),
  vote_count integer check (vote_count is null or vote_count >= 0),
  canonical_score numeric not null default 0 check (canonical_score between 0 and 100),
  bingeability_score numeric check (bingeability_score is null or bingeability_score between 0 and 100),
  external_ids jsonb not null default '{}',
  metadata_source text not null default 'tmdb',
  metadata_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tmdb_id is null) = (tmdb_media_type is null))
);

create unique index titles_tmdb_identity_idx
  on public.titles(tmdb_media_type, tmdb_id) where tmdb_id is not null;
create index titles_name_search_idx on public.titles using gin (to_tsvector('simple', name));
create index titles_release_date_idx on public.titles(release_date desc);
create index titles_content_canonical_idx on public.titles(content_type, canonical_score desc);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer unique,
  name text not null,
  biography text,
  profile_path text,
  external_ids jsonb not null default '{}',
  metadata_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index people_name_search_idx on public.people using gin (to_tsvector('simple', name));

create table public.title_credits (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.titles(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  department text not null check (department in ('acting', 'directing', 'writing', 'cinematography', 'production', 'other')),
  job text,
  character_name text,
  billing_order integer,
  credited boolean not null default true,
  unique nulls not distinct (title_id, person_id, department, job, character_name)
);

create index title_credits_title_department_idx on public.title_credits(title_id, department);
create index title_credits_person_department_idx on public.title_credits(person_id, department, title_id);

create table public.genres (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  tmdb_movie_genre_id integer,
  tmdb_tv_genre_id integer
);

create table public.title_genres (
  title_id uuid not null references public.titles(id) on delete cascade,
  genre_id uuid not null references public.genres(id) on delete cascade,
  is_primary boolean not null default false,
  confidence numeric not null default 1 check (confidence between 0 and 1),
  primary key (title_id, genre_id)
);

create index title_genres_genre_idx on public.title_genres(genre_id, title_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  category text not null check (category in ('tone', 'theme', 'pace', 'structure', 'audience', 'format', 'content', 'other'))
);

create table public.title_tags (
  title_id uuid not null references public.titles(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  confidence numeric not null default 1 check (confidence between 0 and 1),
  source text not null default 'editorial',
  primary key (title_id, tag_id, source)
);

create index title_tags_tag_idx on public.title_tags(tag_id, title_id);

create table public.curated_lists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  source_name text not null,
  source_url text,
  edition text,
  published_year integer,
  weight numeric not null default 1 check (weight >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.curated_list_entries (
  list_id uuid not null references public.curated_lists(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  rank integer check (rank is null or rank > 0),
  score numeric,
  notes text,
  primary key (list_id, title_id)
);

create index curated_list_entries_title_idx on public.curated_list_entries(title_id, rank);

create table public.criterion_metadata (
  title_id uuid primary key references public.titles(id) on delete cascade,
  collection_member boolean not null default false,
  spine_number integer,
  edition_title text,
  edition_url text,
  edition_checked_at timestamptz,
  -- This is editorial membership only, never Criterion Channel availability.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Availability is a short-lived shared cache. A Criterion edition never creates an offer.
create table public.availability_offers (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.titles(id) on delete cascade,
  service_id uuid references public.streaming_services(id) on delete set null,
  provider_key text not null,
  provider_name text not null,
  region text not null check (region ~ '^[A-Z]{2}$'),
  offer_type text not null check (offer_type in ('subscription', 'free_ad_supported', 'rent', 'buy')),
  deeplink_url text,
  price_amount numeric check (price_amount is null or price_amount >= 0),
  price_currency text check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  quality text,
  external_source text not null,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source_payload jsonb not null default '{}',
  unique (title_id, provider_key, region, offer_type, quality, external_source),
  check (price_amount is null or offer_type in ('rent', 'buy')),
  check (expires_at > checked_at)
);

create index availability_active_lookup_idx
  on public.availability_offers(title_id, region, offer_type, expires_at desc);
create index availability_service_region_idx
  on public.availability_offers(service_id, region, expires_at desc)
  where service_id is not null;

create table public.availability_refresh_state (
  title_id uuid not null references public.titles(id) on delete cascade,
  region text not null check (region ~ '^[A-Z]{2}$'),
  external_source text not null,
  checked_at timestamptz not null,
  refresh_after timestamptz not null,
  last_status text not null check (last_status in ('ok', 'empty', 'error')),
  error_code text,
  primary key (title_id, region, external_source)
);

create index availability_refresh_due_idx on public.availability_refresh_state(refresh_after);

-- Versioned questionnaire catalog.
create table public.questionnaire_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  name text not null,
  estimated_minutes integer not null check (estimated_minutes > 0),
  active boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index questionnaire_one_active_idx
  on public.questionnaire_versions(active) where active;

create table public.questionnaire_dimensions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  description text not null,
  min_value numeric not null default 0,
  max_value numeric not null default 100,
  check (max_value > min_value)
);

create table public.questionnaire_questions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_version_id uuid not null references public.questionnaire_versions(id) on delete cascade,
  code text not null,
  prompt text not null,
  help_text text,
  question_type text not null check (question_type in ('likert_5', 'scale_7', 'forced_choice', 'multi_select', 'genre_matrix')),
  response_schema jsonb not null default '{}',
  reverse_scored boolean not null default false,
  sort_order integer not null,
  required boolean not null default false,
  unique (questionnaire_version_id, code),
  unique (questionnaire_version_id, sort_order)
);

create table public.questionnaire_question_dimensions (
  question_id uuid not null references public.questionnaire_questions(id) on delete cascade,
  dimension_id uuid not null references public.questionnaire_dimensions(id) on delete cascade,
  weight numeric not null default 1 check (weight between -5 and 5 and weight <> 0),
  choice_key text not null default '',
  primary key (question_id, dimension_id, choice_key)
);

-- Personalized cold-start and behavior data.
create table public.questionnaire_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  questionnaire_version_id uuid not null references public.questionnaire_versions(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'skipped', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, profile_id),
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

create index questionnaire_sessions_profile_idx on public.questionnaire_sessions(profile_id, started_at desc);

create table public.questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  question_id uuid not null references public.questionnaire_questions(id) on delete restrict,
  response jsonb not null,
  answered_at timestamptz not null default now(),
  unique (session_id, question_id),
  foreign key (session_id, profile_id)
    references public.questionnaire_sessions(id, profile_id) on delete cascade
);

create index questionnaire_responses_profile_idx on public.questionnaire_responses(profile_id, answered_at);

create table public.profile_dimensions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  dimension_id uuid not null references public.questionnaire_dimensions(id) on delete restrict,
  questionnaire_value numeric check (questionnaire_value between 0 and 100),
  questionnaire_confidence numeric not null default 0 check (questionnaire_confidence between 0 and 1),
  behavioral_value numeric check (behavioral_value between 0 and 100),
  behavioral_confidence numeric not null default 0 check (behavioral_confidence between 0 and 1),
  effective_value numeric check (effective_value between 0 and 100),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, dimension_id)
);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  score smallint not null check (score between 1 and 10),
  watched_state text not null default 'watched' check (watched_state in ('watched', 'partially_watched', 'abandoned')),
  rewatch_count integer not null default 0 check (rewatch_count >= 0),
  source_context text,
  rated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, title_id)
);

create index ratings_profile_score_idx on public.ratings(profile_id, score desc, rated_at desc);
create index ratings_title_idx on public.ratings(title_id, score);

create table public.watch_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  watched_at timestamptz not null,
  completion_percent numeric check (completion_percent is null or completion_percent between 0 and 100),
  season_number integer check (season_number is null or season_number > 0),
  episode_number integer check (episode_number is null or episode_number > 0),
  source_context text,
  created_at timestamptz not null default now()
);

create index watch_history_profile_recent_idx on public.watch_history(profile_id, watched_at desc);
create index watch_history_profile_title_idx on public.watch_history(profile_id, title_id, watched_at desc);

create table public.profile_favorite_people (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  credit_department text not null check (credit_department in ('acting', 'directing', 'writing', 'cinematography')),
  created_at timestamptz not null default now(),
  primary key (profile_id, person_id, credit_department)
);

create table public.taste_affinities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  feature_type text not null check (feature_type in ('person', 'genre', 'tag', 'decade', 'country', 'language', 'runtime', 'franchise', 'content_type')),
  feature_key text not null,
  affinity numeric not null check (affinity between -1 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  mean_rating numeric check (mean_rating is null or mean_rating between 1 and 10),
  source text not null default 'behavioral' check (source in ('questionnaire', 'behavioral', 'blended', 'manual')),
  updated_at timestamptz not null default now(),
  unique (profile_id, feature_type, feature_key)
);

create index taste_affinities_profile_rank_idx
  on public.taste_affinities(profile_id, feature_type, confidence desc, affinity desc);

-- Config and version records are physically separate from all raw history.
create table public.model_configs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  schema_version integer not null default 1 check (schema_version > 0),
  configuration jsonb not null,
  source text not null check (source in ('default', 'local_learning', 'external_import', 'manual', 'rollback')),
  parent_config_id uuid references public.model_configs(id) on delete set null,
  configuration_sha256 text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(configuration) = 'object'),
  unique (id, profile_id)
);

create index model_configs_profile_idx on public.model_configs(profile_id, created_at desc);

create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  config_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'active' check (status in ('active', 'superseded', 'rolled_back')),
  notes text,
  activated_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, profile_id),
  unique (profile_id, version_number),
  foreign key (config_id, profile_id) references public.model_configs(id, profile_id) on delete restrict
);

create unique index model_versions_one_active_idx
  on public.model_versions(profile_id) where status = 'active';

alter table public.profiles
  add constraint profiles_current_model_version_fk
  foreign key (current_model_version_id, id)
  references public.model_versions(id, profile_id)
  deferrable initially deferred;

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  model_version_id uuid,
  moods text[] not null default '{}',
  vibes text[] not null default '{}',
  request_context jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  unique (id, profile_id),
  foreign key (model_version_id, profile_id)
    references public.model_versions(id, profile_id) on delete restrict
);

create index recommendations_profile_recent_idx on public.recommendations(profile_id, generated_at desc);

create table public.recommendation_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recommendation_id uuid not null,
  title_id uuid not null references public.titles(id) on delete restrict,
  recommendation_type text not null check (recommendation_type in (
    'best_bet', 'close_second', 'right_mood', 'creator_match',
    'something_different', 'hidden_gem', 'go_deeper',
    'film_school_pick', 'left_field', 'wild_card'
  )),
  rank smallint not null check (rank between 1 and 10),
  raw_score numeric not null,
  normalized_match smallint not null check (normalized_match between 0 and 100),
  availability_class text not null check (availability_class in ('subscription', 'free_ad_supported', 'rent', 'buy', 'unavailable')),
  explanation text not null,
  feature_contributions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, profile_id),
  unique (recommendation_id, recommendation_type),
  unique (recommendation_id, rank),
  foreign key (recommendation_id, profile_id)
    references public.recommendations(id, profile_id) on delete cascade
);

create index recommendation_items_profile_title_idx on public.recommendation_items(profile_id, title_id, created_at desc);

create table public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  recommendation_item_id uuid not null,
  recommendation_score smallint check (recommendation_score is null or recommendation_score between 1 and 10),
  quick_feedback text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recommendation_item_id),
  foreign key (recommendation_item_id, profile_id)
    references public.recommendation_items(id, profile_id) on delete cascade
);

create index recommendation_feedback_profile_idx on public.recommendation_feedback(profile_id, created_at desc);

create table public.availability_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  recommendation_item_id uuid,
  service_id uuid references public.streaming_services(id) on delete set null,
  region text not null check (region ~ '^[A-Z]{2}$'),
  report_type text not null default 'not_available' check (report_type in ('not_available', 'wrong_offer_type', 'wrong_price', 'other')),
  details text,
  created_at timestamptz not null default now(),
  foreign key (recommendation_item_id, profile_id)
    references public.recommendation_items(id, profile_id)
    on delete set null (recommendation_item_id)
);

create index availability_reports_profile_idx on public.availability_reports(profile_id, created_at desc);
create index availability_reports_title_region_idx on public.availability_reports(title_id, region, created_at desc);

create table public.algorithm_performance_metrics (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  model_version_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  evaluated_count integer not null default 0 check (evaluated_count >= 0),
  average_recommendation_score numeric check (average_recommendation_score is null or average_recommendation_score between 1 and 10),
  mean_absolute_error numeric check (mean_absolute_error is null or mean_absolute_error >= 0),
  high_confidence_misses integer not null default 0 check (high_confidence_misses >= 0),
  breakdowns jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (model_version_id, profile_id)
    references public.model_versions(id, profile_id) on delete cascade,
  check (period_end > period_start)
);

create index algorithm_metrics_profile_version_idx
  on public.algorithm_performance_metrics(profile_id, model_version_id, period_end desc);

create table public.model_import_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  model_version_id uuid not null,
  configuration_sha256 text,
  imported_at timestamptz not null default now(),
  foreign key (model_version_id, profile_id)
    references public.model_versions(id, profile_id) on delete restrict
);

create index model_import_audit_profile_idx on public.model_import_audit(profile_id, imported_at desc);

-- Ownership is resolved once here so all profile-owned policies use the same rule.
create or replace function public.owns_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target_profile_id and p.account_id = auth.uid()
  );
$$;

revoke all on function public.owns_profile(uuid) from public;
grant execute on function public.owns_profile(uuid) to authenticated;

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated
  using (account_id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (account_id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (account_id = auth.uid()) with check (account_id = auth.uid());
create policy profiles_delete_own on public.profiles for delete to authenticated
  using (account_id = auth.uid());

-- Read-only service/catalog data. Trusted backend/service_role owns refreshes.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'streaming_services', 'titles', 'people', 'title_credits', 'genres',
    'title_genres', 'tags', 'title_tags', 'curated_lists',
    'curated_list_entries', 'criterion_metadata', 'availability_offers',
    'availability_refresh_state', 'questionnaire_versions',
    'questionnaire_dimensions', 'questionnaire_questions',
    'questionnaire_question_dimensions'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      table_name || '_authenticated_read', table_name
    );
  end loop;
end $$;

-- Most profile-owned records are explicitly editable by their owner.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profile_settings', 'profile_streaming_services', 'questionnaire_sessions',
    'questionnaire_responses', 'profile_dimensions', 'ratings', 'watch_history',
    'profile_favorite_people', 'taste_affinities', 'algorithm_performance_metrics'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.owns_profile(profile_id)) with check (public.owns_profile(profile_id))',
      table_name || '_owner_all', table_name
    );
  end loop;
end $$;

-- Configuration/version rows are readable by owners but can only be created or
-- activated through validated server/RPC boundaries below.
do $$
declare table_name text;
begin
  foreach table_name in array array['model_configs', 'model_versions']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.owns_profile(profile_id))',
      table_name || '_owner_read', table_name
    );
  end loop;
end $$;

-- Raw recommendation, feedback, and availability-report history is append-only
-- from clients. Explicit deletion can be exposed later through a guarded RPC.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'recommendations', 'recommendation_items',
    'recommendation_feedback', 'availability_reports'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.owns_profile(profile_id))',
      table_name || '_owner_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.owns_profile(profile_id))',
      table_name || '_owner_append', table_name
    );
  end loop;
end $$;

alter table public.model_import_audit enable row level security;
create policy model_import_audit_owner_read on public.model_import_audit
  for select to authenticated using (public.owns_profile(profile_id));

-- Creates only a new configuration/version. Historical tables are not parameters
-- and are never updated by this import boundary.
create or replace function public.import_model_configuration(
  target_profile_id uuid,
  config_name text,
  config_schema_version integer,
  new_configuration jsonb,
  expected_sha256 text default null
)
returns public.model_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  new_config public.model_configs;
  new_version public.model_versions;
  next_version integer;
  unexpected jsonb;
  unexpected_weights jsonb;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if config_schema_version < 1 or jsonb_typeof(new_configuration) <> 'object' then
    raise exception 'invalid_configuration';
  end if;

  unexpected := new_configuration - array[
    'weights', 'thresholds', 'exploration', 'featureBehavior', 'priorDecay',
    'availability', 'explanations', 'schemaVersion'
  ];
  if unexpected <> '{}'::jsonb then
    raise exception 'configuration_contains_unsupported_keys';
  end if;
  if not (new_configuration ? 'weights') or jsonb_typeof(new_configuration->'weights') <> 'object' then
    raise exception 'configuration_weights_required';
  end if;

  unexpected_weights := (new_configuration->'weights') - array[
    'directorAffinity', 'actorAffinity', 'writerAffinity',
    'cinematographerAffinity', 'genreMatch', 'subgenreMatch', 'moodMatch',
    'vibeMatch', 'decadeAffinity', 'countryAffinity', 'languageAffinity',
    'runtimeAffinity', 'canonicalScore', 'canonicalSignal', 'criterionBonus',
    'popularitySignal', 'noveltyBonus', 'explorationBonus',
    'dislikedSimilarityPenalty', 'dislikedPenalty',
    'availabilityPreference', 'questionnairePrior'
  ];
  if unexpected_weights <> '{}'::jsonb then
    raise exception 'configuration_contains_unsupported_weights';
  end if;
  if exists (
    select 1 from jsonb_each(new_configuration->'weights') entry
    where jsonb_typeof(entry.value) <> 'number'
       or (entry.value #>> '{}')::numeric < -5
       or (entry.value #>> '{}')::numeric > 5
  ) then
    raise exception 'configuration_weight_out_of_range';
  end if;

  select coalesce(max(version_number), 0) + 1
    into next_version from public.model_versions where profile_id = target_profile_id;

  insert into public.model_configs (
    profile_id, name, schema_version, configuration, source, configuration_sha256
  ) values (
    target_profile_id, left(coalesce(nullif(trim(config_name), ''), 'Imported configuration'), 80),
    config_schema_version, new_configuration, 'external_import', expected_sha256
  ) returning * into new_config;

  update public.model_versions
    set status = 'superseded', ended_at = now()
    where profile_id = target_profile_id and status = 'active';

  insert into public.model_versions (profile_id, config_id, version_number, status)
    values (target_profile_id, new_config.id, next_version, 'active')
    returning * into new_version;

  update public.profiles set current_model_version_id = new_version.id
    where id = target_profile_id;

  insert into public.model_import_audit (
    profile_id, model_version_id, configuration_sha256
  ) values (target_profile_id, new_version.id, expected_sha256);

  return new_version;
end;
$$;

revoke all on function public.import_model_configuration(uuid, text, integer, jsonb, text) from public;
grant execute on function public.import_model_configuration(uuid, text, integer, jsonb, text) to authenticated;

-- Household convenience: copies access/settings only, never taste or history.
create or replace function public.clone_profile_settings(
  source_profile_id uuid,
  new_display_name text,
  new_avatar_key text default null,
  create_as_guest boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare cloned public.profiles;
begin
  if not public.owns_profile(source_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;

  insert into public.profiles (
    account_id, display_name, avatar_key, is_guest, onboarding_completed, region,
    cloned_from_profile_id
  )
  select auth.uid(), new_display_name, new_avatar_key, create_as_guest, false, region, id
  from public.profiles where id = source_profile_id
  returning * into cloned;

  insert into public.profile_settings (
    profile_id, rental_policy, allow_free_with_ads, allow_purchase_only,
    max_runtime_minutes, excluded_content_tags
  )
  select cloned.id, rental_policy, allow_free_with_ads, allow_purchase_only,
    max_runtime_minutes, excluded_content_tags
  from public.profile_settings where profile_id = source_profile_id
  on conflict (profile_id) do update set
    rental_policy = excluded.rental_policy,
    allow_free_with_ads = excluded.allow_free_with_ads,
    allow_purchase_only = excluded.allow_purchase_only,
    max_runtime_minutes = excluded.max_runtime_minutes,
    excluded_content_tags = excluded.excluded_content_tags;

  insert into public.profile_streaming_services (profile_id, service_id)
  select cloned.id, service_id from public.profile_streaming_services
  where profile_id = source_profile_id;

  return cloned;
end;
$$;

revoke all on function public.clone_profile_settings(uuid, text, text, boolean) from public;
grant execute on function public.clone_profile_settings(uuid, text, text, boolean) to authenticated;

-- Keep timestamps coherent.
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profile_settings_set_updated_at before update on public.profile_settings
  for each row execute function public.set_updated_at();
create trigger streaming_services_set_updated_at before update on public.streaming_services
  for each row execute function public.set_updated_at();
create trigger titles_set_updated_at before update on public.titles
  for each row execute function public.set_updated_at();
create trigger people_set_updated_at before update on public.people
  for each row execute function public.set_updated_at();
create trigger curated_lists_set_updated_at before update on public.curated_lists
  for each row execute function public.set_updated_at();
create trigger criterion_metadata_set_updated_at before update on public.criterion_metadata
  for each row execute function public.set_updated_at();
create trigger ratings_set_updated_at before update on public.ratings
  for each row execute function public.set_updated_at();
create trigger recommendation_feedback_set_updated_at before update on public.recommendation_feedback
  for each row execute function public.set_updated_at();

-- Non-user-owned seed catalog.
insert into public.streaming_services (slug, display_name, tmdb_provider_id, sort_order) values
  ('netflix', 'Netflix', 8, 10),
  ('hulu', 'Hulu', 15, 20),
  ('disney-plus', 'Disney+', 337, 30),
  ('apple-tv-plus', 'Apple TV+', 350, 40),
  ('prime-video', 'Amazon Prime Video', 9, 50),
  ('max', 'Max', 1899, 60),
  ('peacock', 'Peacock', 386, 70),
  ('paramount-plus', 'Paramount+', 531, 80),
  ('criterion-channel', 'Criterion Channel', 258, 90)
on conflict (slug) do update set
  display_name = excluded.display_name,
  tmdb_provider_id = excluded.tmdb_provider_id,
  sort_order = excluded.sort_order;

insert into public.genres (slug, display_name, tmdb_movie_genre_id, tmdb_tv_genre_id) values
  ('action', 'Action', 28, 10759), ('adventure', 'Adventure', 12, 10759),
  ('animation', 'Animation', 16, 16), ('comedy', 'Comedy', 35, 35),
  ('crime', 'Crime', 80, 80), ('documentary', 'Documentary', 99, 99),
  ('drama', 'Drama', 18, 18), ('family', 'Family', 10751, 10751),
  ('fantasy', 'Fantasy', 14, 10765), ('history', 'History', 36, null),
  ('horror', 'Horror', 27, null), ('music', 'Music', 10402, null),
  ('mystery', 'Mystery', 9648, 9648), ('romance', 'Romance', 10749, null),
  ('science-fiction', 'Science Fiction', 878, 10765), ('thriller', 'Thriller', 53, null),
  ('war', 'War', 10752, 10768), ('western', 'Western', 37, 37),
  ('stand-up', 'Stand-Up', null, null), ('dark-comedy', 'Dark Comedy', null, null),
  ('satire', 'Satire', null, null)
on conflict (slug) do nothing;

insert into public.questionnaire_versions (
  id, version, name, estimated_minutes, active, published_at
) values (
  '10000000-0000-4000-8000-000000000001', 1, 'Build Your Taste Profile', 7, true, now()
) on conflict (version) do nothing;

insert into public.questionnaire_dimensions (slug, display_name, description) values
  ('cerebral', 'Thought-provoking stories', 'Interest in cognitive complexity and ideas.'),
  ('emotional-intensity', 'Emotional intensity', 'Appetite for emotionally powerful stories.'),
  ('darkness', 'Darker themes', 'Comfort with bleakness and moral ambiguity, separate from horror.'),
  ('thrill', 'Energy and suspense', 'Interest in tension, action, pace, and spectacle.'),
  ('imagination', 'Imaginative worlds', 'Interest in speculative, surreal, and fantastical storytelling.'),
  ('comedy-dry', 'Dry comedy', 'Interest in understated and deadpan comedy.'),
  ('comedy-broad', 'Broad comedy', 'Interest in big, physical, and accessible comedy.'),
  ('standup', 'Stand-up', 'Interest in stand-up as its own form.'),
  ('character', 'Character focus', 'Preference for character-led over plot-led storytelling.'),
  ('realism', 'Grounded stories', 'Preference for realism relative to escapism.'),
  ('ambiguity', 'Open interpretation', 'Comfort with ambiguity and unresolved stories.'),
  ('slow-pace', 'Slow-burn pacing', 'Comfort with patient pacing, independent of complexity.'),
  ('novelty', 'Something new', 'Preference for unfamiliar choices over familiar comfort.'),
  ('discovery', 'Discovery', 'Interest in independent, obscure, or less-mainstream work.'),
  ('classic-openness', 'Classic cinema', 'Openness to films from earlier eras.'),
  ('international', 'International cinema', 'Openness to subtitles and unfamiliar countries.'),
  ('horror', 'Horror', 'Interest and tolerance for horror specifically.'),
  ('rewatch', 'Rewatching', 'Interest in revisiting favorites.'),
  ('tv-commitment', 'Series commitment', 'Tolerance for long and multi-season series.'),
  ('binge', 'Binge watching', 'Preference for watching several episodes together.')
on conflict (slug) do nothing;

-- All items are original prompts. Scale answers use 1..5 unless the schema says otherwise.
insert into public.questionnaire_questions (
  questionnaire_version_id, code, prompt, question_type, response_schema, sort_order
) values
  ('10000000-0000-4000-8000-000000000001','cerebral_after','I enjoy stories that keep unfolding in my mind after they end.','likert_5','{"min":1,"max":5}',1),
  ('10000000-0000-4000-8000-000000000001','cerebral_attention','I like mysteries that reward close attention to small details.','likert_5','{"min":1,"max":5}',2),
  ('10000000-0000-4000-8000-000000000001','emotional_heavy','I am open to an emotionally heavy watch when the payoff feels earned.','likert_5','{"min":1,"max":5}',3),
  ('10000000-0000-4000-8000-000000000001','emotional_catharsis','A story that leaves me teary can be exactly what I want.','likert_5','{"min":1,"max":5}',4),
  ('10000000-0000-4000-8000-000000000001','dark_morality','Morally complicated characters make a story more interesting to me.','likert_5','{"min":1,"max":5}',5),
  ('10000000-0000-4000-8000-000000000001','dark_bleak','I can enjoy a bleak story without needing it to become uplifting.','likert_5','{"min":1,"max":5}',6),
  ('10000000-0000-4000-8000-000000000001','thrill_tension','Sustained tension is one of the things I most enjoy on screen.','likert_5','{"min":1,"max":5}',7),
  ('10000000-0000-4000-8000-000000000001','thrill_spectacle','Large-scale action and spectacle can carry a movie for me.','likert_5','{"min":1,"max":5}',8),
  ('10000000-0000-4000-8000-000000000001','imagination_worlds','I am drawn to stories set in strange or invented worlds.','likert_5','{"min":1,"max":5}',9),
  ('10000000-0000-4000-8000-000000000001','imagination_surreal','I enjoy movies that bend reality or use surreal imagery.','likert_5','{"min":1,"max":5}',10),
  ('10000000-0000-4000-8000-000000000001','comedy_dry','Deadpan humor usually works for me.','likert_5','{"min":1,"max":5}',11),
  ('10000000-0000-4000-8000-000000000001','comedy_broad','I enjoy broad, physical, or deliberately silly comedy.','likert_5','{"min":1,"max":5}',12),
  ('10000000-0000-4000-8000-000000000001','comedy_cringe','I can enjoy comedy built around awkwardness and discomfort.','likert_5','{"min":1,"max":5}',13),
  ('10000000-0000-4000-8000-000000000001','standup_interest','I regularly choose stand-up specials as their own kind of watch.','likert_5','{"min":1,"max":5}',14),
  ('10000000-0000-4000-8000-000000000001','standup_styles','Which stand-up styles appeal to you?','multi_select','{"options":["observational","storytelling","political-social","dark","absurdist","clean","provocative"]}',15),
  ('10000000-0000-4000-8000-000000000001','character_simple','Fascinating characters can make a simple plot completely satisfying.','likert_5','{"min":1,"max":5}',16),
  ('10000000-0000-4000-8000-000000000001','realism_grounded','Stories grounded in everyday reality are often more compelling to me.','likert_5','{"min":1,"max":5}',17),
  ('10000000-0000-4000-8000-000000000001','ambiguity_endings','I am comfortable when an ending leaves important questions open.','likert_5','{"min":1,"max":5}',18),
  ('10000000-0000-4000-8000-000000000001','slow_patience','A patient slow burn can be more rewarding than a fast start.','likert_5','{"min":1,"max":5}',19),
  ('10000000-0000-4000-8000-000000000001','novelty_unknown','I like choosing titles I knew almost nothing about beforehand.','likert_5','{"min":1,"max":5}',20),
  ('10000000-0000-4000-8000-000000000001','discovery_indie','I actively seek independent or under-the-radar films.','likert_5','{"min":1,"max":5}',21),
  ('10000000-0000-4000-8000-000000000001','classic_old','Black-and-white or older filmmaking styles do not put me off.','likert_5','{"min":1,"max":5}',22),
  ('10000000-0000-4000-8000-000000000001','international_subtitles','Subtitles do not make me less likely to choose something.','likert_5','{"min":1,"max":5}',23),
  ('10000000-0000-4000-8000-000000000001','international_cultures','I enjoy films from countries and cultures unfamiliar to me.','likert_5','{"min":1,"max":5}',24),
  ('10000000-0000-4000-8000-000000000001','horror_supernatural','Supernatural horror is something I actively seek out.','likert_5','{"min":1,"max":5}',25),
  ('10000000-0000-4000-8000-000000000001','horror_gore','Graphic gore or body horror does not automatically rule out a title.','likert_5','{"min":1,"max":5}',26),
  ('10000000-0000-4000-8000-000000000001','rewatch_favorites','Revisiting a favorite often sounds better than gambling on something new.','likert_5','{"min":1,"max":5}',27),
  ('10000000-0000-4000-8000-000000000001','tv_long','I am happy to start a show that already has several seasons.','likert_5','{"min":1,"max":5}',28),
  ('10000000-0000-4000-8000-000000000001','tv_serialized','I prefer serialized television where episodes build directly on each other.','likert_5','{"min":1,"max":5}',29),
  ('10000000-0000-4000-8000-000000000001','binge_sessions','When a series clicks, I usually want several episodes at once.','likert_5','{"min":1,"max":5}',30),
  ('10000000-0000-4000-8000-000000000001','choice_pace','Which sounds better tonight?','forced_choice','{"a":"A beautifully made slow-burn mystery","b":"A propulsive thriller that grabs me immediately"}',31),
  ('10000000-0000-4000-8000-000000000001','choice_release','Which sounds better tonight?','forced_choice','{"a":"A critically acclaimed movie I somehow missed","b":"A new release everyone is talking about"}',32),
  ('10000000-0000-4000-8000-000000000001','choice_familiar','Which sounds better tonight?','forced_choice','{"a":"A familiar favorite","b":"Something I have never heard of"}',33),
  ('10000000-0000-4000-8000-000000000001','genre_preferences','How much do you generally enjoy each of these?','genre_matrix','{"min":1,"max":7,"genres":["drama","crime","thriller","mystery","action","adventure","science-fiction","fantasy","horror","romance","comedy","dark-comedy","satire","animation","documentary","historical","war","western","musical","family","stand-up"]}',34),
  ('10000000-0000-4000-8000-000000000001','exclusions','Are there any kinds of content you want excluded?','multi_select','{"options":["graphic-gore","jump-scares","sexual-violence","animal-harm","child-harm","none"]}',35)
on conflict (questionnaire_version_id, code) do nothing;

-- Map scalar items to dimensions; forced choices and matrices are interpreted by
-- the application using their explicit response schemas.
insert into public.questionnaire_question_dimensions (question_id, dimension_id, weight)
select q.id, d.id, 1
from public.questionnaire_questions q
join public.questionnaire_dimensions d on d.slug = case
  when q.code like 'cerebral_%' then 'cerebral'
  when q.code like 'emotional_%' then 'emotional-intensity'
  when q.code like 'dark_%' then 'darkness'
  when q.code like 'thrill_%' then 'thrill'
  when q.code like 'imagination_%' then 'imagination'
  when q.code = 'comedy_dry' then 'comedy-dry'
  when q.code in ('comedy_broad','comedy_cringe') then 'comedy-broad'
  when q.code like 'standup_%' then 'standup'
  when q.code = 'character_simple' then 'character'
  when q.code = 'realism_grounded' then 'realism'
  when q.code = 'ambiguity_endings' then 'ambiguity'
  when q.code = 'slow_patience' then 'slow-pace'
  when q.code = 'novelty_unknown' then 'novelty'
  when q.code = 'discovery_indie' then 'discovery'
  when q.code = 'classic_old' then 'classic-openness'
  when q.code like 'international_%' then 'international'
  when q.code like 'horror_%' then 'horror'
  when q.code = 'rewatch_favorites' then 'rewatch'
  when q.code like 'tv_%' then 'tv-commitment'
  when q.code = 'binge_sessions' then 'binge'
end
where q.questionnaire_version_id = '10000000-0000-4000-8000-000000000001'
  and q.code not in ('standup_styles','choice_pace','choice_release','choice_familiar','genre_preferences','exclusions')
on conflict do nothing;

-- New profiles always receive explicit settings. This trigger is intentionally
-- small; it creates no taste data and therefore cannot leak across profiles.
create or replace function public.initialize_profile_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile_settings(profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

create trigger profiles_initialize_settings
  after insert on public.profiles
  for each row execute function public.initialize_profile_settings();
