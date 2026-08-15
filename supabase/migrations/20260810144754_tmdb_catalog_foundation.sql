-- TMDB catalog + editorial classification foundation.
-- The daily TMDB ID exports are mirrored into a lightweight queue, while hydrated
-- title metadata and editorial classifications remain separate concerns.

-- A regular unique constraint is a better PostgREST/Supabase upsert target than
-- the original partial unique index. PostgreSQL still permits multiple (NULL,NULL)
-- rows, while the existing titles check keeps TMDB identity pairs coherent.
drop index if exists public.titles_tmdb_identity_idx;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.titles'::regclass
      and conname = 'titles_tmdb_identity_unique'
  ) then
    alter table public.titles
      add constraint titles_tmdb_identity_unique unique (tmdb_media_type, tmdb_id);
  end if;
end $$;

create table public.tmdb_catalog_index (
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null check (tmdb_id > 0),
  original_name text,
  popularity numeric,
  adult boolean not null default false,
  video boolean,
  is_active boolean not null default true,
  source_export_date date not null,
  indexed_at timestamptz not null default now(),
  hydration_status text not null default 'pending'
    check (hydration_status in ('pending', 'hydrating', 'hydrated', 'error', 'skipped')),
  hydration_attempts integer not null default 0 check (hydration_attempts >= 0),
  title_id uuid references public.titles(id) on delete set null,
  hydrated_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (media_type, tmdb_id)
);

create index tmdb_catalog_hydration_queue_idx
  on public.tmdb_catalog_index(hydration_status, is_active, adult, popularity desc nulls last, tmdb_id);
create index tmdb_catalog_export_date_idx
  on public.tmdb_catalog_index(media_type, source_export_date desc);
create index tmdb_catalog_title_idx
  on public.tmdb_catalog_index(title_id) where title_id is not null;

-- Denormalized, versioned feature packet used by the editorial classifier. This
-- deliberately matches the evidence shape used by the 100-title pilot so future
-- classifier evaluation compares like with like.
create table public.title_classification_inputs (
  title_id uuid primary key references public.titles(id) on delete cascade,
  overview text,
  tmdb_genres text[] not null default '{}',
  directors text[] not null default '{}',
  writers text[] not null default '{}',
  cinematographers text[] not null default '{}',
  principal_cast text[] not null default '{}',
  keywords text[] not null default '{}',
  source text not null default 'tmdb',
  metadata_version text not null default 'tmdb-classification-input-v1',
  captured_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Editorial semantics are intentionally separate from TMDB metadata. Gold/human
-- classifications can always outrank generated ones without changing title facts.
create table public.title_editorial_classifications (
  title_id uuid primary key references public.titles(id) on delete cascade,
  primary_subgenre text not null,
  secondary_subgenre text,
  tone_tags text[] not null default '{}',
  pacing text check (pacing is null or pacing in ('slow', 'moderate', 'fast')),
  ontology_version text not null,
  classifier_version text,
  confidence numeric not null default 1 check (confidence between 0 and 1),
  source text not null,
  review_status text not null default 'accepted'
    check (review_status in ('gold', 'accepted', 'needs_review', 'rejected')),
  classified_at timestamptz not null default now(),
  source_payload jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  check (secondary_subgenre is null or secondary_subgenre <> primary_subgenre),
  check (cardinality(tone_tags) <= 3)
);

create index title_editorial_review_queue_idx
  on public.title_editorial_classifications(review_status, confidence, classified_at);
create index title_editorial_primary_subgenre_idx
  on public.title_editorial_classifications(primary_subgenre, title_id);

-- The 100-title gold benchmark is an invariant, not merely a convention. A future
-- classifier may upsert canonical classifications by title_id, so prevent an
-- accepted/generated record from accidentally replacing a gold/human decision.
create or replace function public.protect_gold_editorial_classification()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.review_status = 'gold' and new.review_status <> 'gold' then
    raise exception 'Gold editorial classification for title % cannot be replaced by a non-gold classification', old.title_id;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_gold_editorial_classification() from public;

create trigger title_editorial_classifications_protect_gold
  before update on public.title_editorial_classifications
  for each row execute function public.protect_gold_editorial_classification();

create trigger tmdb_catalog_index_set_updated_at before update on public.tmdb_catalog_index
  for each row execute function public.set_updated_at();
create trigger title_classification_inputs_set_updated_at before update on public.title_classification_inputs
  for each row execute function public.set_updated_at();
create trigger title_editorial_classifications_set_updated_at before update on public.title_editorial_classifications
  for each row execute function public.set_updated_at();

-- Internal catalog queue: service_role only. Classification data is shared
-- read-only metadata just like titles/genres/tags.
alter table public.tmdb_catalog_index enable row level security;
revoke all on public.tmdb_catalog_index from anon, authenticated;

alter table public.title_classification_inputs enable row level security;
create policy title_classification_inputs_authenticated_read
  on public.title_classification_inputs for select to authenticated using (true);
revoke all on public.title_classification_inputs from anon;
grant select on public.title_classification_inputs to authenticated;

alter table public.title_editorial_classifications enable row level security;
create policy title_editorial_classifications_authenticated_read
  on public.title_editorial_classifications for select to authenticated using (true);
revoke all on public.title_editorial_classifications from anon;
grant select on public.title_editorial_classifications to authenticated;
