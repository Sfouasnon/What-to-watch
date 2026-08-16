-- Prime Video and Paramount+ may expose their allowlisted native schemes
-- directly rather than inside a serialized Android intent URI.

alter table public.offer_launch_targets
  drop constraint offer_launch_targets_target_uri_check;

alter table public.offer_launch_targets
  add constraint offer_launch_targets_target_uri_check check (
    length(target_uri) between 1 and 4096
    and target_uri ~ '^(https?://|intent:|amzn://|pplus://)'
  );

create or replace function public.replace_offer_launch_targets(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  target jsonb;
  target_offer_id uuid;
  source_value text;
  observed_value timestamptz;
  expires_value timestamptz;
  targets_value jsonb;
  platform_value text;
  kind_value text;
  uri_value text;
  package_value text;
  component_value text;
  action_value text;
  content_specific_value boolean;
  incoming_platforms text[];
  processed_offers integer := 0;
  processed_targets integer := 0;
begin
  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;
  if jsonb_array_length(payload) < 1 or jsonb_array_length(payload) > 250 then
    raise exception 'payload must contain between 1 and 250 offer target sets';
  end if;

  for item in select value from jsonb_array_elements(payload)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'each offer target set must be a JSON object';
    end if;

    begin
      target_offer_id := (item ->> 'availability_offer_id')::uuid;
      source_value := item ->> 'external_source';
      observed_value := (item ->> 'observed_at')::timestamptz;
      expires_value := (item ->> 'expires_at')::timestamptz;
      targets_value := item -> 'targets';
    exception when others then
      raise exception 'invalid offer target set: %', sqlerrm;
    end;

    if not exists (select 1 from public.availability_offers where id = target_offer_id) then
      raise exception 'unknown availability_offer_id %', target_offer_id;
    end if;
    if source_value !~ '^[a-z0-9][a-z0-9-]{0,120}$' then
      raise exception 'invalid external_source for %', target_offer_id;
    end if;
    if observed_value is null or expires_value is null or expires_value <= observed_value then
      raise exception 'invalid target freshness window for %', target_offer_id;
    end if;
    if jsonb_typeof(targets_value) <> 'array' or jsonb_array_length(targets_value) > 3 then
      raise exception 'targets must be an array of at most three platform targets for %', target_offer_id;
    end if;

    incoming_platforms := '{}';
    for target in select value from jsonb_array_elements(targets_value)
    loop
      if jsonb_typeof(target) <> 'object' then
        raise exception 'each launch target must be a JSON object';
      end if;

      platform_value := target ->> 'platform';
      kind_value := target ->> 'target_kind';
      uri_value := target ->> 'target_uri';
      package_value := nullif(trim(target ->> 'package_name'), '');
      component_value := nullif(trim(target ->> 'component_name'), '');
      action_value := nullif(trim(target ->> 'action'), '');
      content_specific_value := coalesce((target ->> 'content_specific')::boolean, false);

      if platform_value not in ('web', 'android_tv', 'fire_tv')
        or platform_value = any(incoming_platforms) then
        raise exception 'invalid or duplicate platform for %', target_offer_id;
      end if;
      if kind_value not in ('uri', 'android_intent_uri') then
        raise exception 'invalid target_kind for %', target_offer_id;
      end if;
      if uri_value is null or length(uri_value) not between 1 and 4096
        or uri_value !~ '^(https?://|intent:|amzn://|pplus://)' then
        raise exception 'invalid target_uri for %', target_offer_id;
      end if;
      if package_value is not null and package_value !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$' then
        raise exception 'invalid package_name for %', target_offer_id;
      end if;
      if component_value is not null and length(component_value) not between 1 and 300 then
        raise exception 'invalid component_name for %', target_offer_id;
      end if;
      if action_value is not null and action_value !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$' then
        raise exception 'invalid action for %', target_offer_id;
      end if;

      insert into public.offer_launch_targets (
        availability_offer_id,
        platform,
        target_kind,
        target_uri,
        package_name,
        component_name,
        action,
        content_specific,
        external_source,
        observed_at,
        expires_at,
        source_payload
      ) values (
        target_offer_id,
        platform_value,
        kind_value,
        uri_value,
        package_value,
        component_value,
        action_value,
        content_specific_value,
        source_value,
        observed_value,
        expires_value,
        coalesce(target -> 'source_payload', '{}')
      )
      on conflict (availability_offer_id, platform, external_source)
      do update set
        target_kind = excluded.target_kind,
        target_uri = excluded.target_uri,
        package_name = excluded.package_name,
        component_name = excluded.component_name,
        action = excluded.action,
        content_specific = excluded.content_specific,
        observed_at = excluded.observed_at,
        expires_at = excluded.expires_at,
        source_payload = excluded.source_payload,
        verification_status = case
          when (
            offer_launch_targets.target_kind,
            offer_launch_targets.target_uri,
            offer_launch_targets.package_name,
            offer_launch_targets.component_name,
            offer_launch_targets.action,
            offer_launch_targets.content_specific
          ) is not distinct from (
            excluded.target_kind,
            excluded.target_uri,
            excluded.package_name,
            excluded.component_name,
            excluded.action,
            excluded.content_specific
          ) then offer_launch_targets.verification_status
          else 'unverified'
        end,
        verified_at = case
          when (
            offer_launch_targets.target_kind,
            offer_launch_targets.target_uri,
            offer_launch_targets.package_name,
            offer_launch_targets.component_name,
            offer_launch_targets.action,
            offer_launch_targets.content_specific
          ) is not distinct from (
            excluded.target_kind,
            excluded.target_uri,
            excluded.package_name,
            excluded.component_name,
            excluded.action,
            excluded.content_specific
          ) then offer_launch_targets.verified_at
          else null
        end,
        verification_notes = case
          when (
            offer_launch_targets.target_kind,
            offer_launch_targets.target_uri,
            offer_launch_targets.package_name,
            offer_launch_targets.component_name,
            offer_launch_targets.action,
            offer_launch_targets.content_specific
          ) is not distinct from (
            excluded.target_kind,
            excluded.target_uri,
            excluded.package_name,
            excluded.component_name,
            excluded.action,
            excluded.content_specific
          ) then offer_launch_targets.verification_notes
          else null
        end;

      incoming_platforms := array_append(incoming_platforms, platform_value);
      processed_targets := processed_targets + 1;
    end loop;

    delete from public.offer_launch_targets
    where availability_offer_id = target_offer_id
      and external_source = source_value
      and not (platform = any(incoming_platforms));

    processed_offers := processed_offers + 1;
  end loop;

  return jsonb_build_object(
    'processed_offers', processed_offers,
    'processed_targets', processed_targets
  );
end;
$$;

revoke all on function public.replace_offer_launch_targets(jsonb) from public, anon, authenticated;
grant execute on function public.replace_offer_launch_targets(jsonb) to service_role;
