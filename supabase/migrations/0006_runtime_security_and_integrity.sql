-- What to Watch: close the final runtime privacy and integrity gaps found by
-- the pre-production audit. This migration keeps profiles as personalization
-- namespaces owned by one authenticated account while ensuring that social
-- discovery never exposes the account-bearing profile row.

drop policy if exists profiles_select_social_connections on public.profiles;

-- Cloud profiles are permanent account profiles. Demo/guest profiles live only
-- in browser storage and must never be inserted into the shared database.
alter table public.profiles
  add constraint profiles_cloud_profiles_not_guest check (is_guest = false) not valid;
alter table public.profiles validate constraint profiles_cloud_profiles_not_guest;

create or replace function public.owns_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = target_profile_id
      and profile.account_id = auth.uid()
  );
$$;

-- The checked helper is used by browser-facing policies. A caller may inspect
-- friendship state only when they own at least one side of the relationship.
create or replace function public.are_friends(
  first_profile_id uuid,
  second_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    public.owns_profile(first_profile_id)
    or public.owns_profile(second_profile_id)
  )
  and first_profile_id <> second_profile_id
  and exists (
    select 1
    from public.friendships friendship
    where friendship.status = 'accepted'
      and (
        (friendship.requester_profile_id = first_profile_id
          and friendship.addressee_profile_id = second_profile_id)
        or
        (friendship.requester_profile_id = second_profile_id
          and friendship.addressee_profile_id = first_profile_id)
      )
  );
$$;

-- This helper formerly powered a broad profiles SELECT policy. The policy is
-- gone; all social identity reads now go through narrow RPC result shapes.
alter function public.can_view_social_profile(uuid)
  set search_path = public, pg_temp;
revoke all on function public.can_view_social_profile(uuid) from authenticated;

create or replace function public.set_profile_streaming_services(
  target_profile_id uuid,
  service_slugs text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_slugs text[] := coalesce(service_slugs, '{}'::text[]);
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if cardinality(normalized_slugs) > 50 then
    raise exception 'too_many_streaming_services';
  end if;
  if exists (
    select 1
    from unnest(normalized_slugs) requested(slug)
    left join public.streaming_services service
      on service.slug = requested.slug and service.active
    where requested.slug is null or service.id is null
  ) then
    raise exception 'unknown_or_inactive_streaming_service';
  end if;

  -- Apply a diff so an unchanged subscription keeps its original timestamp.
  delete from public.profile_streaming_services link
  where link.profile_id = target_profile_id
    and not exists (
      select 1
      from public.streaming_services service
      join (
        select distinct slug
        from unnest(normalized_slugs) requested(slug)
      ) requested on requested.slug = service.slug
      where service.id = link.service_id and service.active
    );

  insert into public.profile_streaming_services (profile_id, service_id)
  select target_profile_id, service.id
  from public.streaming_services service
  join (
    select distinct slug
    from unnest(normalized_slugs) requested(slug)
  ) requested on requested.slug = service.slug
  where service.active
  on conflict (profile_id, service_id) do nothing;
end;
$$;

create or replace function public.save_profile_questionnaire(
  target_profile_id uuid,
  questionnaire_scores jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_questionnaire_version_id uuid;
  new_session_id uuid;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if questionnaire_scores is null
     or jsonb_typeof(questionnaire_scores) <> 'object'
     or questionnaire_scores = '{}'::jsonb then
    raise exception 'invalid_questionnaire_scores';
  end if;
  if octet_length(questionnaire_scores::text) > 32768
     or (select count(*) from jsonb_each(questionnaire_scores)) > 50 then
    raise exception 'questionnaire_payload_too_large';
  end if;
  if exists (
    select 1
    from jsonb_each(questionnaire_scores) entry
    where jsonb_typeof(entry.value) <> 'number'
       or (entry.value #>> '{}')::numeric < 0
       or (entry.value #>> '{}')::numeric > 100
       or entry.key not in (
         'cerebral', 'emotional', 'darkness', 'thrill', 'imagination',
         'dryComedy', 'darkComedy', 'standup', 'character', 'realism',
         'ambiguity', 'slowPace', 'novelty', 'discovery', 'classics',
         'international', 'horror', 'gore', 'rewatch', 'tvCommitment',
         'binge', 'tradeoff:0', 'tradeoff:1', 'tradeoff:2',
         'genre:Drama', 'genre:Crime', 'genre:Thriller', 'genre:Mystery',
         'genre:Action', 'genre:Adventure', 'genre:Science Fiction',
         'genre:Fantasy', 'genre:Horror', 'genre:Romance', 'genre:Comedy',
         'genre:Dark Comedy', 'genre:Satire', 'genre:Animation',
         'genre:Documentary', 'genre:Historical', 'genre:War',
         'genre:Western', 'genre:Musical', 'genre:Family', 'genre:Stand-up'
       )
  ) then
    raise exception 'invalid_questionnaire_score';
  end if;

  select version.id
  into active_questionnaire_version_id
  from public.questionnaire_versions version
  where version.active
  order by version.version desc
  limit 1;
  if active_questionnaire_version_id is null then
    raise exception 'active_questionnaire_not_found';
  end if;

  insert into public.questionnaire_sessions (
    profile_id, questionnaire_version_id, status, completed_at
  ) values (
    target_profile_id, active_questionnaire_version_id, 'completed', now()
  ) returning id into new_session_id;

  -- A retake replaces the questionnaire portion of the prior. Behavioral
  -- evidence remains, and the effective value falls back to that evidence.
  with supplied_dimensions as (
    select distinct dimension.id
    from jsonb_each(questionnaire_scores) entry
    join public.questionnaire_dimensions dimension
      on dimension.slug = case entry.key
        when 'cerebral' then 'cerebral'
        when 'emotional' then 'emotional-intensity'
        when 'darkness' then 'darkness'
        when 'darkComedy' then 'darkness'
        when 'thrill' then 'thrill'
        when 'imagination' then 'imagination'
        when 'dryComedy' then 'comedy-dry'
        when 'standup' then 'standup'
        when 'character' then 'character'
        when 'realism' then 'realism'
        when 'ambiguity' then 'ambiguity'
        when 'slowPace' then 'slow-pace'
        when 'novelty' then 'novelty'
        when 'discovery' then 'discovery'
        when 'classics' then 'classic-openness'
        when 'international' then 'international'
        when 'horror' then 'horror'
        when 'gore' then 'horror'
        when 'rewatch' then 'rewatch'
        when 'tvCommitment' then 'tv-commitment'
        when 'binge' then 'binge'
      end
  )
  update public.profile_dimensions stored
  set questionnaire_value = null,
      questionnaire_confidence = 0,
      effective_value = case
        when stored.behavioral_confidence > 0 then stored.behavioral_value
        else null
      end,
      updated_at = now()
  where stored.profile_id = target_profile_id
    and not exists (
      select 1 from supplied_dimensions supplied
      where supplied.id = stored.dimension_id
    );

  delete from public.profile_dimensions stored
  where stored.profile_id = target_profile_id
    and stored.questionnaire_value is null
    and stored.questionnaire_confidence = 0
    and stored.behavioral_value is null
    and stored.behavioral_confidence = 0;

  with normalized as (
    select
      case entry.key
        when 'cerebral' then 'cerebral'
        when 'emotional' then 'emotional-intensity'
        when 'darkness' then 'darkness'
        when 'darkComedy' then 'darkness'
        when 'thrill' then 'thrill'
        when 'imagination' then 'imagination'
        when 'dryComedy' then 'comedy-dry'
        when 'standup' then 'standup'
        when 'character' then 'character'
        when 'realism' then 'realism'
        when 'ambiguity' then 'ambiguity'
        when 'slowPace' then 'slow-pace'
        when 'novelty' then 'novelty'
        when 'discovery' then 'discovery'
        when 'classics' then 'classic-openness'
        when 'international' then 'international'
        when 'horror' then 'horror'
        when 'gore' then 'horror'
        when 'rewatch' then 'rewatch'
        when 'tvCommitment' then 'tv-commitment'
        when 'binge' then 'binge'
      end as dimension_slug,
      (entry.value #>> '{}')::numeric as score
    from jsonb_each(questionnaire_scores) entry
  ), aggregated as (
    select normalized.dimension_slug, avg(normalized.score) as score
    from normalized
    where normalized.dimension_slug is not null
    group by normalized.dimension_slug
  )
  insert into public.profile_dimensions (
    profile_id, dimension_id, questionnaire_value,
    questionnaire_confidence, effective_value, updated_at
  )
  select
    target_profile_id,
    dimension.id,
    aggregated.score,
    0.6,
    aggregated.score,
    now()
  from aggregated
  join public.questionnaire_dimensions dimension
    on dimension.slug = aggregated.dimension_slug
  on conflict (profile_id, dimension_id) do update set
    questionnaire_value = excluded.questionnaire_value,
    questionnaire_confidence = excluded.questionnaire_confidence,
    effective_value = case
      when public.profile_dimensions.behavioral_value is not null
       and public.profile_dimensions.behavioral_confidence > 0 then
        (
          excluded.questionnaire_value * excluded.questionnaire_confidence
          + public.profile_dimensions.behavioral_value
            * public.profile_dimensions.behavioral_confidence
        ) / (
          excluded.questionnaire_confidence
          + public.profile_dimensions.behavioral_confidence
        )
      else excluded.questionnaire_value
    end,
    updated_at = now();

  -- Store only answers the prototype actually collected. Normalized values are
  -- marked explicitly and never masquerade as raw 1..5 questionnaire answers.
  with scalar_mapping(input_key, question_code) as (
    values
      ('cerebral', 'cerebral_attention'),
      ('emotional', 'emotional_heavy'),
      ('darkness', 'dark_morality'),
      ('thrill', 'thrill_tension'),
      ('imagination', 'imagination_worlds'),
      ('dryComedy', 'comedy_dry'),
      ('darkComedy', 'comedy_cringe'),
      ('standup', 'standup_interest'),
      ('character', 'character_simple'),
      ('realism', 'realism_grounded'),
      ('ambiguity', 'ambiguity_endings'),
      ('slowPace', 'slow_patience'),
      ('novelty', 'novelty_unknown'),
      ('discovery', 'discovery_indie'),
      ('classics', 'classic_old'),
      ('international', 'international_subtitles'),
      ('horror', 'horror_supernatural'),
      ('gore', 'horror_gore'),
      ('rewatch', 'rewatch_favorites'),
      ('tvCommitment', 'tv_long'),
      ('binge', 'binge_sessions')
  )
  insert into public.questionnaire_responses (
    profile_id, session_id, question_id, response
  )
  select
    target_profile_id,
    new_session_id,
    question.id,
    jsonb_build_object(
      'normalizedScore', entry.value,
      'scale', jsonb_build_object('min', 0, 'max', 100),
      'source', 'prototype_aggregate_v1'
    )
  from scalar_mapping mapping
  join jsonb_each(questionnaire_scores) entry
    on entry.key = mapping.input_key
  join public.questionnaire_questions question
    on question.questionnaire_version_id = active_questionnaire_version_id
   and question.code = mapping.question_code;

  insert into public.questionnaire_responses (
    profile_id, session_id, question_id, response
  )
  select
    target_profile_id,
    new_session_id,
    question.id,
    jsonb_build_object(
      'scores', (
        select jsonb_object_agg(
          case entry.key
            when 'genre:Drama' then 'drama'
            when 'genre:Crime' then 'crime'
            when 'genre:Thriller' then 'thriller'
            when 'genre:Mystery' then 'mystery'
            when 'genre:Action' then 'action'
            when 'genre:Adventure' then 'adventure'
            when 'genre:Science Fiction' then 'science-fiction'
            when 'genre:Fantasy' then 'fantasy'
            when 'genre:Horror' then 'horror'
            when 'genre:Romance' then 'romance'
            when 'genre:Comedy' then 'comedy'
            when 'genre:Dark Comedy' then 'dark-comedy'
            when 'genre:Satire' then 'satire'
            when 'genre:Animation' then 'animation'
            when 'genre:Documentary' then 'documentary'
            when 'genre:Historical' then 'historical'
            when 'genre:War' then 'war'
            when 'genre:Western' then 'western'
            when 'genre:Musical' then 'musical'
            when 'genre:Family' then 'family'
            when 'genre:Stand-up' then 'stand-up'
          end,
          entry.value
        )
        from jsonb_each(questionnaire_scores) entry
        where entry.key like 'genre:%'
      ),
      'scale', jsonb_build_object('min', 0, 'max', 100),
      'source', 'prototype_genre_matrix_v1'
    )
  from public.questionnaire_questions question
  where question.questionnaire_version_id = active_questionnaire_version_id
    and question.code = 'genre_preferences'
    and exists (
      select 1
      from jsonb_each(questionnaire_scores) entry
      where entry.key like 'genre:%'
    );

  with tradeoff_mapping(input_key, question_code) as (
    values
      ('tradeoff:0', 'choice_pace'),
      ('tradeoff:1', 'choice_release'),
      ('tradeoff:2', 'choice_familiar')
  )
  insert into public.questionnaire_responses (
    profile_id, session_id, question_id, response
  )
  select
    target_profile_id,
    new_session_id,
    question.id,
    jsonb_build_object(
      'choice', case
        when (entry.value #>> '{}')::numeric < 50 then 'a'
        else 'b'
      end,
      'normalizedScore', entry.value,
      'source', 'prototype_forced_choice_v1'
    )
  from tradeoff_mapping mapping
  join jsonb_each(questionnaire_scores) entry
    on entry.key = mapping.input_key
  join public.questionnaire_questions question
    on question.questionnaire_version_id = active_questionnaire_version_id
   and question.code = mapping.question_code;

  update public.profiles
  set onboarding_completed = true
  where id = target_profile_id;

  return new_session_id;
end;
$$;

create or replace function public.save_profile_rating(
  target_profile_id uuid,
  external_tmdb_id integer,
  external_media_type text,
  rating_score smallint,
  rating_source text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_title_id uuid;
  rating_was_inserted boolean := false;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if external_tmdb_id is null
     or external_tmdb_id <= 0
     or external_tmdb_id > 100000000 then
    raise exception 'invalid_tmdb_id';
  end if;
  if external_media_type is null
     or external_media_type not in ('movie', 'tv') then
    raise exception 'invalid_tmdb_media_type';
  end if;
  if rating_score is null or rating_score not between 1 and 10 then
    raise exception 'invalid_rating_score';
  end if;
  if rating_source is null
     or rating_source not in ('onboarding', 'search', 'recommendation', 'import') then
    raise exception 'invalid_rating_source';
  end if;

  insert into public.titles (
    tmdb_id, tmdb_media_type, content_type, name, metadata_source
  ) values (
    external_tmdb_id,
    external_media_type,
    case when external_media_type = 'movie' then 'movie' else 'tv_series' end,
    format('TMDB %s %s', external_media_type, external_tmdb_id),
    'tmdb_identity'
  )
  on conflict (tmdb_media_type, tmdb_id) where tmdb_id is not null
  do update set tmdb_id = excluded.tmdb_id
  returning id into resolved_title_id;

  if not exists (
    select 1
    from public.ratings rating
    where rating.profile_id = target_profile_id
      and rating.title_id = resolved_title_id
  ) and (
    select count(*) from public.ratings rating
    where rating.profile_id = target_profile_id
  ) >= 5000 then
    raise exception 'profile_rating_limit_reached';
  end if;

  -- DO NOTHING distinguishes the one winning first insert from concurrent
  -- updates, so only that insert appends a watched-history event.
  insert into public.ratings (
    profile_id, title_id, score, watched_state, source_context, rated_at
  ) values (
    target_profile_id, resolved_title_id, rating_score,
    'watched', rating_source, now()
  )
  on conflict (profile_id, title_id) do nothing
  returning true into rating_was_inserted;

  if coalesce(rating_was_inserted, false) then
    insert into public.watch_history (
      profile_id, title_id, watched_at, completion_percent, source_context
    ) values (
      target_profile_id, resolved_title_id, now(), 100, rating_source
    );
  else
    update public.ratings
    set score = rating_score,
        watched_state = 'watched',
        source_context = rating_source,
        rated_at = now()
    where profile_id = target_profile_id
      and title_id = resolved_title_id;
  end if;

  return resolved_title_id;
end;
$$;

create or replace function public.save_profile_recommendation(
  target_profile_id uuid,
  recommendation_moods text[],
  recommendation_vibes text[],
  ranked_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_moods text[] := coalesce(recommendation_moods, '{}'::text[]);
  normalized_vibes text[] := coalesce(recommendation_vibes, '{}'::text[]);
  new_recommendation_id uuid;
  resolved_title_id uuid;
  new_item_id uuid;
  item jsonb;
  contribution jsonb;
  item_count integer;
  item_tmdb_id integer;
  item_media_type text;
  item_recommendation_type text;
  item_rank smallint;
  item_raw_score numeric;
  item_match smallint;
  item_availability_class text;
  item_explanation text;
  item_contributions jsonb;
  item_identity text;
  seen_identities text[] := '{}'::text[];
  result_items jsonb := '[]'::jsonb;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if cardinality(normalized_moods) > 2
     or cardinality(normalized_vibes) > 3
     or cardinality(normalized_moods) <> (
       select count(distinct mood) from unnest(normalized_moods) mood
     )
     or cardinality(normalized_vibes) <> (
       select count(distinct vibe) from unnest(normalized_vibes) vibe
     )
     or exists (
       select 1 from unnest(normalized_moods) mood
       where mood is null or mood not in (
         'comedy', 'stand-up', 'drama', 'thriller', 'action', 'horror'
       )
     )
     or exists (
       select 1 from unnest(normalized_vibes) vibe
       where vibe is null or vibe not in (
         'rewatch-favorite', 'rediscover-classic', 'try-something-new',
         'popular-international', 'bingeable-tv', 'trending-series',
         'hidden-gem', 'surprise-me', 'complete-director',
         'criterion-pick', 'film-school-night', 'blind-spot',
         'go-deeper', 'friends-picks'
       )
     ) then
    raise exception 'invalid_recommendation_context';
  end if;
  if ranked_items is null or jsonb_typeof(ranked_items) <> 'array' then
    raise exception 'invalid_recommendation_items';
  end if;
  if octet_length(ranked_items::text) > 131072 then
    raise exception 'recommendation_payload_too_large';
  end if;

  item_count := jsonb_array_length(ranked_items);
  if item_count < 1 or item_count > 10 then
    raise exception 'invalid_recommendation_item_count';
  end if;

  insert into public.recommendations (
    profile_id, model_version_id, moods, vibes, request_context
  )
  select
    profile.id,
    profile.current_model_version_id,
    normalized_moods,
    normalized_vibes,
    jsonb_build_object('source', 'tmdb', 'region', profile.region)
  from public.profiles profile
  where profile.id = target_profile_id
  returning id into new_recommendation_id;

  for item in select value from jsonb_array_elements(ranked_items)
  loop
    if jsonb_typeof(item) <> 'object'
       or item - array[
         'tmdbId', 'mediaType', 'recommendationType', 'rank', 'rawScore',
         'matchScore', 'availabilityClass', 'explanation',
         'featureContributions'
       ] <> '{}'::jsonb
       or jsonb_typeof(item -> 'tmdbId') <> 'number'
       or jsonb_typeof(item -> 'mediaType') <> 'string'
       or jsonb_typeof(item -> 'recommendationType') <> 'string'
       or jsonb_typeof(item -> 'rank') <> 'number'
       or jsonb_typeof(item -> 'rawScore') <> 'number'
       or jsonb_typeof(item -> 'matchScore') <> 'number'
       or jsonb_typeof(item -> 'availabilityClass') <> 'string'
       or jsonb_typeof(item -> 'explanation') <> 'string'
       or (
         item ? 'featureContributions'
         and jsonb_typeof(item -> 'featureContributions') <> 'array'
       ) then
      raise exception 'invalid_recommendation_item_shape';
    end if;

    begin
      item_tmdb_id := (item ->> 'tmdbId')::integer;
      item_rank := (item ->> 'rank')::smallint;
      item_raw_score := (item ->> 'rawScore')::numeric;
      item_match := (item ->> 'matchScore')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_recommendation_item_number';
    end;

    item_media_type := item ->> 'mediaType';
    item_recommendation_type := item ->> 'recommendationType';
    item_availability_class := item ->> 'availabilityClass';
    item_explanation := item ->> 'explanation';
    item_contributions := coalesce(item -> 'featureContributions', '[]'::jsonb);
    item_identity := item_media_type || ':' || item_tmdb_id::text;

    if item_tmdb_id is null or item_tmdb_id <= 0 or item_tmdb_id > 100000000
       or item_media_type not in ('movie', 'tv')
       or item_rank is null or item_rank not between 1 and item_count
       or item_match is null or item_match not between 0 and 100
       or item_raw_score is null or item_raw_score not between -10000 and 10000
       or item_recommendation_type not in (
         'best_bet', 'close_second', 'right_mood', 'creator_match',
         'something_different', 'hidden_gem', 'go_deeper',
         'film_school_pick', 'left_field', 'wild_card'
       )
       or item_availability_class not in (
         'subscription', 'free_ad_supported', 'rent', 'buy', 'unavailable'
       )
       or char_length(item_explanation) not between 1 and 2000
       or jsonb_array_length(item_contributions) > 64
       or octet_length(item_contributions::text) > 32768
       or item_identity = any(seen_identities) then
      raise exception 'invalid_recommendation_item_value';
    end if;

    for contribution in select value from jsonb_array_elements(item_contributions)
    loop
      if jsonb_typeof(contribution) <> 'object'
         or contribution - array['feature', 'value', 'evidence'] <> '{}'::jsonb
         or not (contribution ? 'feature')
         or not (contribution ? 'value')
         or jsonb_typeof(contribution -> 'feature') <> 'string'
         or jsonb_typeof(contribution -> 'value') <> 'number'
         or char_length(contribution ->> 'feature') not between 1 and 80
         or (contribution ->> 'value')::numeric not between -10000 and 10000
         or (
           contribution ? 'evidence'
           and jsonb_typeof(contribution -> 'evidence') not in ('string', 'null')
         )
         or char_length(coalesce(contribution ->> 'evidence', '')) > 500 then
        raise exception 'invalid_recommendation_contribution';
      end if;
    end loop;

    seen_identities := array_append(seen_identities, item_identity);

    insert into public.titles (
      tmdb_id, tmdb_media_type, content_type, name, metadata_source
    ) values (
      item_tmdb_id,
      item_media_type,
      case when item_media_type = 'movie' then 'movie' else 'tv_series' end,
      format('TMDB %s %s', item_media_type, item_tmdb_id),
      'tmdb_identity'
    )
    on conflict (tmdb_media_type, tmdb_id) where tmdb_id is not null
    do update set tmdb_id = excluded.tmdb_id
    returning id into resolved_title_id;

    insert into public.recommendation_items (
      profile_id, recommendation_id, title_id, recommendation_type, rank,
      raw_score, normalized_match, availability_class, explanation,
      feature_contributions
    ) values (
      target_profile_id, new_recommendation_id, resolved_title_id,
      item_recommendation_type, item_rank, item_raw_score, item_match,
      item_availability_class, item_explanation, item_contributions
    ) returning id into new_item_id;

    result_items := result_items || jsonb_build_array(jsonb_build_object(
      'tmdbId', item_tmdb_id,
      'mediaType', item_media_type,
      'recommendationItemId', new_item_id
    ));
  end loop;

  return jsonb_build_object(
    'recommendationId', new_recommendation_id,
    'items', result_items
  );
end;
$$;

create or replace function public.save_recommendation_feedback(
  target_profile_id uuid,
  target_recommendation_item_id uuid,
  feedback_score smallint default null,
  feedback_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_feedback_id uuid;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if feedback_score is null and nullif(trim(feedback_reason), '') is null then
    raise exception 'feedback_value_required';
  end if;
  if feedback_score is not null and feedback_score not between 1 and 10 then
    raise exception 'invalid_feedback_score';
  end if;
  if feedback_reason is not null
     and char_length(trim(feedback_reason)) not between 1 and 120 then
    raise exception 'invalid_feedback_reason';
  end if;
  if not exists (
    select 1
    from public.recommendation_items item
    where item.id = target_recommendation_item_id
      and item.profile_id = target_profile_id
  ) then
    raise exception 'recommendation_item_not_owned' using errcode = '42501';
  end if;

  insert into public.recommendation_feedback (
    profile_id, recommendation_item_id, recommendation_score,
    quick_feedback, notes
  ) values (
    target_profile_id,
    target_recommendation_item_id,
    feedback_score,
    case
      when feedback_reason is null then '{}'::text[]
      else array[trim(feedback_reason)]
    end,
    null
  )
  on conflict (recommendation_item_id) do update set
    recommendation_score = excluded.recommendation_score,
    quick_feedback = excluded.quick_feedback,
    updated_at = now()
  where public.recommendation_feedback.profile_id = target_profile_id
  returning id into saved_feedback_id;

  if saved_feedback_id is null then
    raise exception 'recommendation_feedback_profile_mismatch' using errcode = '42501';
  end if;
  return saved_feedback_id;
end;
$$;

create or replace function public.request_friendship(
  requester_profile_id uuid,
  target_profile_id uuid
)
returns public.friendships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  friendship public.friendships;
  pair_key text;
begin
  if not public.owns_profile(request_friendship.requester_profile_id) then
    raise exception 'requester_profile_not_owned' using errcode = '42501';
  end if;
  if request_friendship.requester_profile_id = request_friendship.target_profile_id then
    raise exception 'profile_cannot_friend_itself';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = request_friendship.target_profile_id
      and profile.is_guest = false
  ) then
    raise exception 'target_profile_not_found';
  end if;

  pair_key := least(
    request_friendship.requester_profile_id,
    request_friendship.target_profile_id
  )::text || ':' || greatest(
    request_friendship.requester_profile_id,
    request_friendship.target_profile_id
  )::text;
  perform pg_advisory_xact_lock(hashtextextended(pair_key, 0));

  select existing.*
  into friendship
  from public.friendships existing
  where least(existing.requester_profile_id, existing.addressee_profile_id)
      = least(
        request_friendship.requester_profile_id,
        request_friendship.target_profile_id
      )
    and greatest(existing.requester_profile_id, existing.addressee_profile_id)
      = greatest(
        request_friendship.requester_profile_id,
        request_friendship.target_profile_id
      )
  for update;

  if friendship.id is null then
    insert into public.friendships (
      requester_profile_id, addressee_profile_id
    ) values (
      request_friendship.requester_profile_id,
      request_friendship.target_profile_id
    ) returning * into friendship;
  elsif friendship.status = 'declined' then
    raise exception 'friendship_previously_declined';
  end if;

  return friendship;
end;
$$;

create or replace function public.respond_to_friendship(
  target_friendship_id uuid,
  accept_request boolean
)
returns public.friendships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  friendship public.friendships;
begin
  if accept_request is null then
    raise exception 'friendship_response_required';
  end if;

  select existing.*
  into friendship
  from public.friendships existing
  where existing.id = target_friendship_id
  for update;

  if friendship.id is null then
    raise exception 'friendship_not_found';
  end if;
  if friendship.status <> 'pending' then
    raise exception 'friendship_not_pending';
  end if;
  if not public.owns_profile(friendship.addressee_profile_id) then
    raise exception 'friendship_response_not_authorized' using errcode = '42501';
  end if;

  update public.friendships
  set status = case when accept_request then 'accepted' else 'declined' end,
      responded_at = now()
  where id = target_friendship_id
  returning * into friendship;

  return friendship;
end;
$$;

create or replace function public.search_friend_profiles(
  viewer_profile_id uuid,
  search_text text
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_key text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_search text := trim(coalesce(search_text, ''));
  literal_search text;
  escaped_search text;
begin
  if not public.owns_profile(viewer_profile_id) then
    raise exception 'viewer_profile_not_owned' using errcode = '42501';
  end if;

  literal_search := replace(
    replace(replace(normalized_search, chr(92), ''), '%', ''),
    '_', ''
  );
  if char_length(trim(literal_search)) < 2 or char_length(normalized_search) > 80 then
    return;
  end if;

  escaped_search := replace(normalized_search, chr(92), chr(92) || chr(92));
  escaped_search := replace(escaped_search, '%', chr(92) || '%');
  escaped_search := replace(escaped_search, '_', chr(92) || '_');

  return query
  select profile.id, profile.display_name, profile.avatar_key, profile.avatar_url
  from public.profiles profile
  where profile.id <> viewer_profile_id
    and profile.is_guest = false
    and profile.display_name ilike '%' || escaped_search || '%' escape E'\\'
  order by profile.display_name
  limit 20;
end;
$$;

create or replace function public.clone_profile_settings(
  source_profile_id uuid,
  new_display_name text,
  new_avatar_key text default null,
  create_as_guest boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cloned public.profiles;
begin
  if not public.owns_profile(source_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if coalesce(create_as_guest, false) then
    raise exception 'guest_profiles_are_browser_local';
  end if;
  if char_length(trim(coalesce(new_display_name, ''))) not between 1 and 40
     or char_length(coalesce(new_avatar_key, '')) > 80 then
    raise exception 'invalid_profile_identity';
  end if;

  insert into public.profiles (
    account_id, display_name, avatar_key, is_guest, onboarding_completed,
    region, cloned_from_profile_id
  )
  select
    auth.uid(), trim(new_display_name), new_avatar_key, false, false,
    source.region, source.id
  from public.profiles source
  where source.id = source_profile_id
  returning * into cloned;

  insert into public.profile_settings (
    profile_id, rental_policy, allow_free_with_ads, allow_purchase_only,
    max_runtime_minutes, excluded_content_tags
  )
  select
    cloned.id, settings.rental_policy, settings.allow_free_with_ads,
    settings.allow_purchase_only, settings.max_runtime_minutes,
    settings.excluded_content_tags
  from public.profile_settings settings
  where settings.profile_id = source_profile_id
  on conflict (profile_id) do update set
    rental_policy = excluded.rental_policy,
    allow_free_with_ads = excluded.allow_free_with_ads,
    allow_purchase_only = excluded.allow_purchase_only,
    max_runtime_minutes = excluded.max_runtime_minutes,
    excluded_content_tags = excluded.excluded_content_tags;

  insert into public.profile_streaming_services (profile_id, service_id)
  select cloned.id, link.service_id
  from public.profile_streaming_services link
  where link.profile_id = source_profile_id;

  return cloned;
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  new_config public.model_configs;
  new_version public.model_versions;
  next_version integer;
  unexpected jsonb;
  unexpected_weights jsonb;
  actual_sha256 text;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if config_schema_version is null
     or config_schema_version not between 1 and 1000
     or new_configuration is null
     or jsonb_typeof(new_configuration) <> 'object'
     or octet_length(new_configuration::text) > 65536 then
    raise exception 'invalid_configuration';
  end if;
  if expected_sha256 is not null
     and expected_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'invalid_configuration_sha256';
  end if;

  unexpected := new_configuration - array[
    'weights', 'thresholds', 'exploration', 'featureBehavior', 'priorDecay',
    'availability', 'explanations', 'schemaVersion'
  ];
  if unexpected <> '{}'::jsonb then
    raise exception 'configuration_contains_unsupported_keys';
  end if;
  if not (new_configuration ? 'weights')
     or jsonb_typeof(new_configuration -> 'weights') <> 'object' then
    raise exception 'configuration_weights_required';
  end if;

  unexpected_weights := (new_configuration -> 'weights') - array[
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
    select 1
    from jsonb_each(new_configuration -> 'weights') entry
    where jsonb_typeof(entry.value) <> 'number'
       or (entry.value #>> '{}')::numeric < -5
       or (entry.value #>> '{}')::numeric > 5
  ) then
    raise exception 'configuration_weight_out_of_range';
  end if;

  actual_sha256 := encode(
    digest(convert_to(new_configuration::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if expected_sha256 is not null
     and lower(expected_sha256) <> actual_sha256 then
    raise exception 'configuration_sha256_mismatch';
  end if;

  -- Lock the profile so concurrent imports cannot allocate the same version.
  perform 1
  from public.profiles profile
  where profile.id = target_profile_id
  for update;

  select coalesce(max(version.version_number), 0) + 1
  into next_version
  from public.model_versions version
  where version.profile_id = target_profile_id;

  insert into public.model_configs (
    profile_id, name, schema_version, configuration, source,
    configuration_sha256
  ) values (
    target_profile_id,
    left(coalesce(nullif(trim(config_name), ''), 'Imported configuration'), 80),
    config_schema_version,
    new_configuration,
    'external_import',
    actual_sha256
  ) returning * into new_config;

  update public.model_versions
  set status = 'superseded', ended_at = now()
  where profile_id = target_profile_id and status = 'active';

  insert into public.model_versions (
    profile_id, config_id, version_number, status
  ) values (
    target_profile_id, new_config.id, next_version, 'active'
  ) returning * into new_version;

  update public.profiles
  set current_model_version_id = new_version.id
  where id = target_profile_id;

  insert into public.model_import_audit (
    profile_id, model_version_id, configuration_sha256
  ) values (
    target_profile_id, new_version.id, actual_sha256
  );

  return new_version;
end;
$$;

-- Remaining SECURITY DEFINER functions keep their existing guarded bodies but
-- explicitly place pg_temp last so temporary objects cannot shadow public ones.
alter function public.remove_friendship(uuid)
  set search_path = public, pg_temp;
alter function public.get_friend_title_activity(uuid, uuid)
  set search_path = public, pg_temp;
alter function public.recalculate_friend_taste_compatibility(uuid, uuid)
  set search_path = public, pg_temp;
alter function public.initialize_profile_settings()
  set search_path = public, pg_temp;

-- Restore the deliberate API surface after CREATE OR REPLACE operations.
revoke all on function public.owns_profile(uuid) from public, anon;
revoke all on function public.are_friends(uuid, uuid) from public, anon;
revoke all on function public.set_profile_streaming_services(uuid, text[]) from public, anon;
revoke all on function public.save_profile_questionnaire(uuid, jsonb) from public, anon;
revoke all on function public.save_profile_rating(uuid, integer, text, smallint, text) from public, anon;
revoke all on function public.save_profile_recommendation(uuid, text[], text[], jsonb) from public, anon;
revoke all on function public.save_recommendation_feedback(uuid, uuid, smallint, text) from public, anon;
revoke all on function public.request_friendship(uuid, uuid) from public, anon;
revoke all on function public.respond_to_friendship(uuid, boolean) from public, anon;
revoke all on function public.search_friend_profiles(uuid, text) from public, anon;
revoke all on function public.clone_profile_settings(uuid, text, text, boolean) from public, anon;
revoke all on function public.import_model_configuration(uuid, text, integer, jsonb, text) from public, anon;

grant execute on function public.owns_profile(uuid) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.set_profile_streaming_services(uuid, text[]) to authenticated;
grant execute on function public.save_profile_questionnaire(uuid, jsonb) to authenticated;
grant execute on function public.save_profile_rating(uuid, integer, text, smallint, text) to authenticated;
grant execute on function public.save_profile_recommendation(uuid, text[], text[], jsonb) to authenticated;
grant execute on function public.save_recommendation_feedback(uuid, uuid, smallint, text) to authenticated;
grant execute on function public.request_friendship(uuid, uuid) to authenticated;
grant execute on function public.respond_to_friendship(uuid, boolean) to authenticated;
grant execute on function public.search_friend_profiles(uuid, text) to authenticated;
grant execute on function public.clone_profile_settings(uuid, text, text, boolean) to authenticated;
grant execute on function public.import_model_configuration(uuid, text, integer, jsonb, text) to authenticated;
