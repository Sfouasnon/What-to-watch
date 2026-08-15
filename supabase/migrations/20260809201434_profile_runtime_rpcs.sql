-- What to Watch: guarded runtime boundaries for the browser application.
-- These RPCs keep shared TMDB identity rows server-controlled without requiring
-- a service-role key in the application. Every personalization write remains
-- tied to a profile owned by auth.uid().

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
    where service.id is null
  ) then
    raise exception 'unknown_or_inactive_streaming_service';
  end if;

  delete from public.profile_streaming_services
  where profile_id = target_profile_id;

  insert into public.profile_streaming_services (profile_id, service_id)
  select target_profile_id, service.id
  from public.streaming_services service
  join (select distinct slug from unnest(normalized_slugs) item(slug)) requested
    on requested.slug = service.slug
  where service.active;
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
  if questionnaire_scores is null or jsonb_typeof(questionnaire_scores) <> 'object' then
    raise exception 'invalid_questionnaire_scores';
  end if;
  if (select count(*) from jsonb_each(questionnaire_scores)) > 100 then
    raise exception 'too_many_questionnaire_scores';
  end if;
  if exists (
    select 1
    from jsonb_each(questionnaire_scores) entry
    where jsonb_typeof(entry.value) <> 'number'
       or (entry.value #>> '{}')::numeric < 0
       or (entry.value #>> '{}')::numeric > 100
       or char_length(entry.key) > 80
  ) then
    raise exception 'questionnaire_score_out_of_range';
  end if;

  select id into active_questionnaire_version_id
  from public.questionnaire_versions
  where active
  order by version desc
  limit 1;
  if active_questionnaire_version_id is null then
    raise exception 'active_questionnaire_not_found';
  end if;

  insert into public.questionnaire_sessions (
    profile_id, questionnaire_version_id, status, completed_at
  ) values (
    target_profile_id, active_questionnaire_version_id, 'completed', now()
  ) returning id into new_session_id;

  -- Persist scalar aggregate evidence in the intended profile_dimensions table.
  with normalized as (
    select
      case entry.key
        when 'cerebral' then 'cerebral'
        when 'emotional' then 'emotional-intensity'
        when 'darkness' then 'darkness'
        when 'thrill' then 'thrill'
        when 'imagination' then 'imagination'
        when 'dryComedy' then 'comedy-dry'
        when 'darkComedy' then 'comedy-broad'
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
    select dimension_slug, avg(score) as score
    from normalized
    where dimension_slug is not null
    group by dimension_slug
  )
  insert into public.profile_dimensions (
    profile_id, dimension_id, questionnaire_value,
    questionnaire_confidence, effective_value, updated_at
  )
  select target_profile_id, dimension.id, aggregated.score, 0.6, aggregated.score, now()
  from aggregated
  join public.questionnaire_dimensions dimension
    on dimension.slug = aggregated.dimension_slug
  on conflict (profile_id, dimension_id) do update set
    questionnaire_value = excluded.questionnaire_value,
    questionnaire_confidence = excluded.questionnaire_confidence,
    effective_value = case
      when public.profile_dimensions.behavioral_confidence > 0
        then public.profile_dimensions.effective_value
      else excluded.effective_value
    end,
    updated_at = now();

  -- Store reproducible response records against the versioned questionnaire.
  insert into public.questionnaire_responses (
    profile_id, session_id, question_id, response
  )
  select
    target_profile_id,
    new_session_id,
    question.id,
    case
      when question.code = 'genre_preferences' then jsonb_build_object(
        'scores', coalesce((
          select jsonb_object_agg(substring(entry.key from 7), entry.value)
          from jsonb_each(questionnaire_scores) entry
          where entry.key like 'genre:%'
        ), '{}'::jsonb)
      )
      when question.code in ('choice_pace', 'choice_release', 'choice_familiar') then
        jsonb_build_object(
          'choice', case
            when coalesce((questionnaire_scores ->> ('tradeoff:' ||
              case question.code
                when 'choice_pace' then '0'
                when 'choice_release' then '1'
                else '2'
              end))::numeric, 50) < 50 then 'a' else 'b'
          end
        )
      else jsonb_build_object('profile_snapshot', questionnaire_scores)
    end
  from public.questionnaire_questions question
  where question.questionnaire_version_id = active_questionnaire_version_id;

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
  rating_already_existed boolean;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if external_tmdb_id is null or external_tmdb_id <= 0 then
    raise exception 'invalid_tmdb_id';
  end if;
  if external_media_type is null or external_media_type not in ('movie', 'tv') then
    raise exception 'invalid_tmdb_media_type';
  end if;
  if rating_score is null or rating_score not between 1 and 10 then
    raise exception 'invalid_rating_score';
  end if;
  if rating_source is null or rating_source not in ('onboarding', 'search', 'recommendation', 'import') then
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

  select exists (
    select 1 from public.ratings
    where profile_id = target_profile_id and title_id = resolved_title_id
  ) into rating_already_existed;

  insert into public.ratings (
    profile_id, title_id, score, watched_state, source_context, rated_at
  ) values (
    target_profile_id, resolved_title_id, rating_score, 'watched', rating_source, now()
  )
  on conflict (profile_id, title_id) do update set
    score = excluded.score,
    watched_state = 'watched',
    source_context = excluded.source_context,
    rated_at = now();

  if not rating_already_existed then
    insert into public.watch_history (
      profile_id, title_id, watched_at, completion_percent, source_context
    ) values (
      target_profile_id, resolved_title_id, now(), 100, rating_source
    );
  end if;

  return resolved_title_id;
end;
$$;

-- Persist one ranked result set atomically. The application supplies only
-- profile-scoped scoring output and TMDB identities; shared metadata remains a
-- read-only cache and cannot be poisoned through this boundary.
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
  new_recommendation_id uuid;
  resolved_title_id uuid;
  new_item_id uuid;
  item jsonb;
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
  result_items jsonb := '[]'::jsonb;
begin
  if not public.owns_profile(target_profile_id) then
    raise exception 'profile_not_owned' using errcode = '42501';
  end if;
  if cardinality(coalesce(recommendation_moods, '{}'::text[])) > 2
     or cardinality(coalesce(recommendation_vibes, '{}'::text[])) > 3 then
    raise exception 'invalid_recommendation_context';
  end if;
  if ranked_items is null or jsonb_typeof(ranked_items) <> 'array' then
    raise exception 'invalid_recommendation_items';
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
    coalesce(recommendation_moods, '{}'::text[]),
    coalesce(recommendation_vibes, '{}'::text[]),
    jsonb_build_object('source', 'tmdb', 'region', profile.region)
  from public.profiles profile
  where profile.id = target_profile_id
  returning id into new_recommendation_id;

  for item in select value from jsonb_array_elements(ranked_items)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'invalid_recommendation_item';
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
    item_contributions := coalesce(item -> 'featureContributions', '{}'::jsonb);

    if item_tmdb_id is null or item_tmdb_id <= 0
       or item_media_type is null or item_media_type not in ('movie', 'tv')
       or item_rank is null or item_rank not between 1 and 10
       or item_match is null or item_match not between 0 and 100
       or item_raw_score is null or item_raw_score not between -10000 and 10000
       or item_recommendation_type is null or item_recommendation_type not in (
         'best_bet', 'close_second', 'right_mood', 'creator_match',
         'something_different', 'hidden_gem', 'go_deeper',
         'film_school_pick', 'left_field', 'wild_card'
       )
       or item_availability_class is null or item_availability_class not in (
         'subscription', 'free_ad_supported', 'rent', 'buy', 'unavailable'
       )
       or item_explanation is null
       or char_length(item_explanation) not between 1 and 2000
       or jsonb_typeof(item_contributions) not in ('object', 'array') then
      raise exception 'invalid_recommendation_item_value';
    end if;

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
  if feedback_score is not null and feedback_score not between 1 and 10 then
    raise exception 'invalid_feedback_score';
  end if;
  if feedback_reason is not null and char_length(feedback_reason) > 120 then
    raise exception 'invalid_feedback_reason';
  end if;
  if not exists (
    select 1 from public.recommendation_items item
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
    case when feedback_reason is null then '{}'::text[] else array[feedback_reason] end,
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

revoke all on function public.set_profile_streaming_services(uuid, text[]) from public;
revoke all on function public.set_profile_streaming_services(uuid, text[]) from anon;
revoke all on function public.save_profile_questionnaire(uuid, jsonb) from public;
revoke all on function public.save_profile_questionnaire(uuid, jsonb) from anon;
revoke all on function public.save_profile_rating(uuid, integer, text, smallint, text) from public;
revoke all on function public.save_profile_rating(uuid, integer, text, smallint, text) from anon;
revoke all on function public.save_profile_recommendation(uuid, text[], text[], jsonb) from public;
revoke all on function public.save_profile_recommendation(uuid, text[], text[], jsonb) from anon;
revoke all on function public.save_recommendation_feedback(uuid, uuid, smallint, text) from public;
revoke all on function public.save_recommendation_feedback(uuid, uuid, smallint, text) from anon;

grant execute on function public.set_profile_streaming_services(uuid, text[]) to authenticated;
grant execute on function public.save_profile_questionnaire(uuid, jsonb) to authenticated;
grant execute on function public.save_profile_rating(uuid, integer, text, smallint, text) to authenticated;
grant execute on function public.save_profile_recommendation(uuid, text[], text[], jsonb) to authenticated;
grant execute on function public.save_recommendation_feedback(uuid, uuid, smallint, text) to authenticated;
