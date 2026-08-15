create or replace function public.record_availability_refresh_state(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  target_title_id uuid;
  region_value text;
  external_source_value text;
  checked_value timestamptz;
  refresh_value timestamptz;
  status_value text;
  error_value text;
  upserted_count integer := 0;
  row_changed integer := 0;
begin
  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;
  if jsonb_array_length(payload) < 1 or jsonb_array_length(payload) > 250 then
    raise exception 'payload must contain between 1 and 250 refresh states';
  end if;

  for item in select value from jsonb_array_elements(payload)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'each refresh state must be a JSON object';
    end if;

    begin
      target_title_id := (item ->> 'title_id')::uuid;
      region_value := item ->> 'region';
      external_source_value := item ->> 'external_source';
      checked_value := (item ->> 'checked_at')::timestamptz;
      refresh_value := (item ->> 'refresh_after')::timestamptz;
      status_value := item ->> 'last_status';
      error_value := nullif(trim(item ->> 'error_code'), '');
    exception when others then
      raise exception 'invalid refresh-state payload: %', sqlerrm;
    end;

    if not exists (select 1 from public.titles where id = target_title_id) then
      raise exception 'unknown title_id %', target_title_id;
    end if;
    if region_value !~ '^[A-Z]{2}$' then
      raise exception 'invalid region for %', target_title_id;
    end if;
    if external_source_value <> 'tmdb-watch-providers' then
      raise exception 'invalid external_source for %', target_title_id;
    end if;
    if checked_value is null or refresh_value is null or refresh_value <= checked_value then
      raise exception 'invalid refresh window for %', target_title_id;
    end if;
    if status_value not in ('ok', 'empty', 'error') then
      raise exception 'invalid refresh status for %', target_title_id;
    end if;
    if status_value = 'error' and error_value is null then
      raise exception 'error_code is required for failed refresh %', target_title_id;
    end if;
    if status_value <> 'error' and error_value is not null then
      raise exception 'error_code is only valid for failed refresh %', target_title_id;
    end if;
    if length(coalesce(error_value, '')) > 120 then
      raise exception 'error_code is too long for %', target_title_id;
    end if;

    insert into public.availability_refresh_state (
      title_id,
      region,
      external_source,
      checked_at,
      refresh_after,
      last_status,
      error_code
    ) values (
      target_title_id,
      region_value,
      external_source_value,
      checked_value,
      refresh_value,
      status_value,
      error_value
    )
    on conflict (title_id, region, external_source)
    do update set
      checked_at = excluded.checked_at,
      refresh_after = excluded.refresh_after,
      last_status = excluded.last_status,
      error_code = excluded.error_code
    where (
      availability_refresh_state.checked_at,
      availability_refresh_state.refresh_after,
      availability_refresh_state.last_status,
      availability_refresh_state.error_code
    ) is distinct from (
      excluded.checked_at,
      excluded.refresh_after,
      excluded.last_status,
      excluded.error_code
    );
    get diagnostics row_changed = row_count;
    upserted_count := upserted_count + row_changed;
  end loop;

  return jsonb_build_object(
    'processed', jsonb_array_length(payload),
    'changed', upserted_count
  );
end;
$$;

revoke all on function public.record_availability_refresh_state(jsonb) from public, anon, authenticated;
grant execute on function public.record_availability_refresh_state(jsonb) to service_role;
