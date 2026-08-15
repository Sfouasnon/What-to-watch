-- Align the database import boundary with the canonical recommendation engine.
-- The function remains owner-scoped and writes only a new config/model version.
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
    'questionnaireDecay', 'normalization', 'availability', 'explanations',
    'schemaVersion', 'modelVersion'
  ];
  if unexpected <> '{}'::jsonb then
    raise exception 'configuration_contains_unsupported_keys';
  end if;
  if not (new_configuration ? 'weights') or jsonb_typeof(new_configuration->'weights') <> 'object' then
    raise exception 'configuration_weights_required';
  end if;

  unexpected_weights := (new_configuration->'weights') - array[
    'directorAffinity', 'actorAffinity', 'writerAffinity',
    'cinematographerAffinity', 'genreMatch', 'questionnaireMatch',
    'tradeoffMatch', 'feedbackMatch', 'subgenreMatch', 'moodMatch',
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
       or (entry.value #>> '{}')::numeric < -50
       or (entry.value #>> '{}')::numeric > 50
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
