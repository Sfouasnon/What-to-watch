-- TMDB provider 350 is currently named "Apple TV". Normalize it to the
-- subscription service key used by profiles, device contracts, and the
-- streaming service registry. "Apple TV Store" remains a separate provider.

do $$
declare
  apple_tv_plus_service_id uuid;
begin
  select id into apple_tv_plus_service_id
  from public.streaming_services
  where slug = 'apple-tv-plus' and active;

  if apple_tv_plus_service_id is null then
    raise exception 'active apple-tv-plus streaming service is required';
  end if;

  update public.availability_offers
  set
    provider_key = 'apple-tv-plus',
    provider_name = 'Apple TV+',
    service_id = apple_tv_plus_service_id
  where provider_key = 'apple-tv';
end;
$$;
