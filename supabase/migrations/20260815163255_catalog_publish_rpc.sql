-- Bounded maintenance RPCs for publishing reviewed editorial classifications
-- and normalized TMDB availability without granting direct table writes to the
-- shared service-role key.

create or replace function public.publish_editorial_classifications(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  target_title_id uuid;
  primary_value text;
  secondary_value text;
  tones text[];
  pace_value text;
  ontology_value text;
  classifier_value text;
  confidence_value numeric;
  source_value text;
  status_value text;
  classified_value timestamptz;
  source_payload_value jsonb;
  changed_count integer := 0;
  row_changed integer := 0;
  accepted_count integer := 0;
  review_count integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and session_user <> 'postgres' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;
  if jsonb_array_length(payload) < 1 or jsonb_array_length(payload) > 250 then
    raise exception 'payload must contain between 1 and 250 classifications';
  end if;

  for item in select value from jsonb_array_elements(payload)
  loop
    begin
      target_title_id := (item ->> 'title_id')::uuid;
      primary_value := item ->> 'primary_subgenre';
      secondary_value := nullif(item ->> 'secondary_subgenre', '');
      tones := array(select jsonb_array_elements_text(item -> 'tone_tags'));
      pace_value := item ->> 'pacing';
      ontology_value := item ->> 'ontology_version';
      classifier_value := item ->> 'classifier_version';
      confidence_value := (item ->> 'confidence')::numeric;
      source_value := item ->> 'source';
      status_value := item ->> 'review_status';
      classified_value := (item ->> 'classified_at')::timestamptz;
      source_payload_value := coalesce(item -> 'source_payload', '{}'::jsonb);
    exception when others then
      raise exception 'invalid classification payload: %', sqlerrm;
    end;

    if not exists (select 1 from public.titles where id = target_title_id) then
      raise exception 'unknown title_id %', target_title_id;
    end if;
    if exists (
      select 1 from public.title_editorial_classifications
      where title_id = target_title_id and review_status = 'gold'
    ) then
      raise exception 'gold classification % cannot be replaced', target_title_id;
    end if;
    if not exists (
      select 1 from public.tags
      where slug = primary_value and category = 'subgenre' and retired_at is null
    ) then
      raise exception 'invalid primary_subgenre % for %', primary_value, target_title_id;
    end if;
    if secondary_value is not null and not exists (
      select 1 from public.tags
      where slug = secondary_value and category = 'subgenre' and retired_at is null
    ) then
      raise exception 'invalid secondary_subgenre % for %', secondary_value, target_title_id;
    end if;
    if secondary_value = primary_value then
      raise exception 'primary and secondary subgenres match for %', target_title_id;
    end if;
    if cardinality(tones) < 2 or cardinality(tones) > 3
      or (select count(distinct tone) from unnest(tones) tone) <> cardinality(tones)
      or exists (
        select 1 from unnest(tones) tone
        where not exists (
          select 1 from public.tags
          where slug = tone and category = 'tone' and retired_at is null
        )
      ) then
      raise exception 'invalid tone_tags for %', target_title_id;
    end if;
    if pace_value not in ('slow', 'moderate', 'fast') then
      raise exception 'invalid pacing % for %', pace_value, target_title_id;
    end if;
    if ontology_value <> '0.1.1' then
      raise exception 'unsupported ontology_version %', ontology_value;
    end if;
    if classifier_value is null or length(classifier_value) > 160 then
      raise exception 'invalid classifier_version for %', target_title_id;
    end if;
    if confidence_value < 0 or confidence_value > 1 then
      raise exception 'invalid confidence for %', target_title_id;
    end if;
    if source_value <> 'llm-assisted-editorial' then
      raise exception 'invalid source %', source_value;
    end if;
    if status_value not in ('accepted', 'needs_review') then
      raise exception 'invalid review_status %', status_value;
    end if;
    if jsonb_typeof(source_payload_value) <> 'object'
      or octet_length(source_payload_value::text) > 12000 then
      raise exception 'invalid source_payload for %', target_title_id;
    end if;

    insert into public.title_editorial_classifications (
      title_id,
      primary_subgenre,
      secondary_subgenre,
      tone_tags,
      pacing,
      ontology_version,
      classifier_version,
      confidence,
      source,
      review_status,
      classified_at,
      source_payload
    ) values (
      target_title_id,
      primary_value,
      secondary_value,
      tones,
      pace_value,
      ontology_value,
      classifier_value,
      confidence_value,
      source_value,
      status_value,
      classified_value,
      source_payload_value
    )
    on conflict (title_id) do update set
      primary_subgenre = excluded.primary_subgenre,
      secondary_subgenre = excluded.secondary_subgenre,
      tone_tags = excluded.tone_tags,
      pacing = excluded.pacing,
      ontology_version = excluded.ontology_version,
      classifier_version = excluded.classifier_version,
      confidence = excluded.confidence,
      source = excluded.source,
      review_status = excluded.review_status,
      classified_at = excluded.classified_at,
      source_payload = excluded.source_payload
    where title_editorial_classifications.review_status <> 'gold'
      and (
        title_editorial_classifications.primary_subgenre,
        title_editorial_classifications.secondary_subgenre,
        title_editorial_classifications.tone_tags,
        title_editorial_classifications.pacing,
        title_editorial_classifications.ontology_version,
        title_editorial_classifications.classifier_version,
        title_editorial_classifications.confidence,
        title_editorial_classifications.source,
        title_editorial_classifications.review_status,
        title_editorial_classifications.classified_at,
        title_editorial_classifications.source_payload
      ) is distinct from (
        excluded.primary_subgenre,
        excluded.secondary_subgenre,
        excluded.tone_tags,
        excluded.pacing,
        excluded.ontology_version,
        excluded.classifier_version,
        excluded.confidence,
        excluded.source,
        excluded.review_status,
        excluded.classified_at,
        excluded.source_payload
      );
    get diagnostics row_changed = row_count;
    changed_count := changed_count + row_changed;
    if status_value = 'accepted' then
      accepted_count := accepted_count + 1;
    else
      review_count := review_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'processed', jsonb_array_length(payload),
    'changed', changed_count,
    'accepted', accepted_count,
    'needs_review', review_count
  );
end;
$$;

revoke all on function public.publish_editorial_classifications(jsonb) from public, anon, authenticated;
grant execute on function public.publish_editorial_classifications(jsonb) to service_role;

create or replace function public.replace_catalog_availability(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  offer jsonb;
  target_title_id uuid;
  region_value text;
  checked_value timestamptz;
  expires_value timestamptz;
  provider_key_value text;
  provider_name_value text;
  offer_type_value text;
  service_slug_value text;
  service_id_value uuid;
  deleted_count integer := 0;
  upserted_count integer := 0;
  row_changed integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and session_user <> 'postgres' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;
  if jsonb_array_length(payload) < 1 or jsonb_array_length(payload) > 250 then
    raise exception 'payload must contain between 1 and 250 titles';
  end if;

  for item in select value from jsonb_array_elements(payload)
  loop
    begin
      target_title_id := (item ->> 'title_id')::uuid;
      region_value := item ->> 'region';
      checked_value := (item ->> 'checked_at')::timestamptz;
      expires_value := (item ->> 'expires_at')::timestamptz;
    exception when others then
      raise exception 'invalid availability payload: %', sqlerrm;
    end;
    if not exists (select 1 from public.titles where id = target_title_id) then
      raise exception 'unknown title_id %', target_title_id;
    end if;
    if region_value !~ '^[A-Z]{2}$' or expires_value <= checked_value then
      raise exception 'invalid availability window for %', target_title_id;
    end if;
    if jsonb_typeof(coalesce(item -> 'offers', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(item -> 'offers', '[]'::jsonb)) > 100 then
      raise exception 'invalid offers for %', target_title_id;
    end if;

    delete from public.availability_offers existing
    where existing.title_id = target_title_id
      and existing.region = region_value
      and existing.external_source = 'tmdb-watch-providers'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(item -> 'offers', '[]'::jsonb)) incoming
        where incoming ->> 'provider_key' = existing.provider_key
          and incoming ->> 'offer_type' = existing.offer_type
      );
    get diagnostics row_changed = row_count;
    deleted_count := deleted_count + row_changed;

    for offer in select value from jsonb_array_elements(coalesce(item -> 'offers', '[]'::jsonb))
    loop
      provider_key_value := offer ->> 'provider_key';
      provider_name_value := offer ->> 'provider_name';
      offer_type_value := offer ->> 'offer_type';
      service_slug_value := nullif(offer ->> 'service_slug', '');
      if provider_key_value !~ '^[a-z0-9][a-z0-9-]{0,120}$'
        or provider_name_value is null or length(trim(provider_name_value)) not between 1 and 160
        or offer_type_value not in ('subscription', 'free_ad_supported', 'rent', 'buy') then
        raise exception 'invalid offer for %', target_title_id;
      end if;
      service_id_value := null;
      select id into service_id_value
      from public.streaming_services
      where slug = service_slug_value and active;

      insert into public.availability_offers (
        title_id,
        service_id,
        provider_key,
        provider_name,
        region,
        offer_type,
        quality,
        external_source,
        checked_at,
        expires_at,
        source_payload
      ) values (
        target_title_id,
        service_id_value,
        provider_key_value,
        trim(provider_name_value),
        region_value,
        offer_type_value,
        'unknown',
        'tmdb-watch-providers',
        checked_value,
        expires_value,
        jsonb_build_object('publisher', 'catalog-release-v1')
      )
      on conflict (title_id, provider_key, region, offer_type, quality, external_source)
      do update set
        service_id = excluded.service_id,
        provider_name = excluded.provider_name,
        checked_at = excluded.checked_at,
        expires_at = excluded.expires_at,
        source_payload = excluded.source_payload
      where (
        availability_offers.service_id,
        availability_offers.provider_name,
        availability_offers.checked_at,
        availability_offers.expires_at,
        availability_offers.source_payload
      ) is distinct from (
        excluded.service_id,
        excluded.provider_name,
        excluded.checked_at,
        excluded.expires_at,
        excluded.source_payload
      );
      get diagnostics row_changed = row_count;
      upserted_count := upserted_count + row_changed;
    end loop;
  end loop;

  return jsonb_build_object(
    'processed_titles', jsonb_array_length(payload),
    'changed_offers', upserted_count,
    'deleted_offers', deleted_count
  );
end;
$$;

revoke all on function public.replace_catalog_availability(jsonb) from public, anon, authenticated;
grant execute on function public.replace_catalog_availability(jsonb) to service_role;

grant select on table public.availability_offers to service_role;
