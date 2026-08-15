create table public.title_cast_context_cache (
  title_id uuid primary key references public.titles(id) on delete cascade,
  source text not null default 'tmdb',
  cache_version text not null,
  checked_at timestamptz not null,
  cast_context jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(cast_context) = 'array')
);

alter table public.title_cast_context_cache enable row level security;
revoke all on table public.title_cast_context_cache from anon, authenticated;
grant select, insert, update on table public.title_cast_context_cache to service_role;

insert into public.title_cast_context_cache (
  title_id,
  source,
  cache_version,
  checked_at,
  cast_context
)
select
  title_id,
  'tmdb',
  coalesce(raw_payload->>'cast_context_version', 'tmdb-combined-credits-v1'),
  coalesce((raw_payload->>'cast_context_checked_at')::timestamptz, now()),
  raw_payload->'cast_context'
from public.title_classification_inputs
where jsonb_typeof(raw_payload->'cast_context') = 'array'
on conflict (title_id) do update set
  source = excluded.source,
  cache_version = excluded.cache_version,
  checked_at = excluded.checked_at,
  cast_context = excluded.cast_context,
  updated_at = now();

update public.title_classification_inputs
set raw_payload = raw_payload
  - 'cast_context_version'
  - 'cast_context_checked_at'
  - 'cast_context'
where raw_payload ?| array['cast_context_version', 'cast_context_checked_at', 'cast_context'];

revoke update, delete, truncate on table public.title_classification_inputs from service_role;
