-- Establishes the versioned editorial vocabulary and the data-driven projection
-- from editorial tags to the eight user-facing moods.

alter table public.tags
  add column retired_at timestamptz;

alter table public.tags
  drop constraint tags_category_check;

alter table public.tags
  add constraint tags_category_check check (
    category in (
      'subgenre', 'tone', 'pacing', 'attribute',
      'theme', 'pace', 'structure', 'audience', 'format', 'content', 'other'
    )
  );

insert into public.tags (slug, display_name, category)
values
  ('absurdist-comedy', 'Absurdist Comedy', 'subgenre'),
  ('action-thriller', 'Action Thriller', 'subgenre'),
  ('adult-animation', 'Adult Animation', 'subgenre'),
  ('adventure-action', 'Adventure Action', 'subgenre'),
  ('alien-first-contact', 'Alien First Contact', 'subgenre'),
  ('animated-family', 'Animated Family', 'subgenre'),
  ('anime-action', 'Anime Action', 'subgenre'),
  ('anthology', 'Anthology', 'subgenre'),
  ('biographical-drama', 'Biographical Drama', 'subgenre'),
  ('black-comedy', 'Black Comedy', 'subgenre'),
  ('body-horror', 'Body Horror', 'subgenre'),
  ('buddy-comedy', 'Buddy Comedy', 'subgenre'),
  ('combat-film', 'Combat Film', 'subgenre'),
  ('coming-of-age-drama', 'Coming-of-Age Drama', 'subgenre'),
  ('conspiracy-thriller', 'Conspiracy Thriller', 'subgenre'),
  ('courtroom-crime', 'Courtroom Crime', 'subgenre'),
  ('creature-feature', 'Creature Feature', 'subgenre'),
  ('crime-drama', 'Crime Drama', 'subgenre'),
  ('crime-thriller', 'Crime Thriller', 'subgenre'),
  ('cyberpunk', 'Cyberpunk', 'subgenre'),
  ('dark-comedy', 'Dark Comedy', 'subgenre'),
  ('detective', 'Detective', 'subgenre'),
  ('documentary', 'Documentary', 'subgenre'),
  ('docuseries', 'Docuseries', 'subgenre'),
  ('dramedy', 'Dramedy', 'subgenre'),
  ('dystopian-sci-fi', 'Dystopian Sci-Fi', 'subgenre'),
  ('epic-fantasy', 'Epic Fantasy', 'subgenre'),
  ('erotic-romance', 'Erotic Romance', 'subgenre'),
  ('erotic-thriller', 'Erotic Thriller', 'subgenre'),
  ('espionage-thriller', 'Espionage Thriller', 'subgenre'),
  ('family-drama', 'Family Drama', 'subgenre'),
  ('family-sitcom', 'Family Sitcom', 'subgenre'),
  ('hard-sci-fi', 'Hard Sci-Fi', 'subgenre'),
  ('heist', 'Heist', 'subgenre'),
  ('historical-drama', 'Historical Drama', 'subgenre'),
  ('isekai', 'Isekai', 'subgenre'),
  ('late-night-talk-show', 'Late-Night Talk Show', 'subgenre'),
  ('martial-arts', 'Martial Arts', 'subgenre'),
  ('military-action', 'Military Action', 'subgenre'),
  ('mockumentary', 'Mockumentary', 'subgenre'),
  ('murder-mystery', 'Murder Mystery', 'subgenre'),
  ('music-documentary', 'Music Documentary', 'subgenre'),
  ('mystery-thriller', 'Mystery Thriller', 'subgenre'),
  ('nature-documentary', 'Nature Documentary', 'subgenre'),
  ('neo-noir', 'Neo-Noir', 'subgenre'),
  ('news-satire', 'News Satire', 'subgenre'),
  ('organized-crime', 'Organized Crime', 'subgenre'),
  ('parody-spoof', 'Parody / Spoof', 'subgenre'),
  ('police-procedural', 'Police Procedural', 'subgenre'),
  ('political-drama', 'Political Drama', 'subgenre'),
  ('procedural', 'Procedural', 'subgenre'),
  ('psychological-drama', 'Psychological Drama', 'subgenre'),
  ('psychological-horror', 'Psychological Horror', 'subgenre'),
  ('psychological-thriller', 'Psychological Thriller', 'subgenre'),
  ('relationship-drama', 'Relationship Drama', 'subgenre'),
  ('revenge-thriller', 'Revenge Thriller', 'subgenre'),
  ('romantic-comedy', 'Romantic Comedy', 'subgenre'),
  ('romantic-drama', 'Romantic Drama', 'subgenre'),
  ('satire', 'Satire', 'subgenre'),
  ('science-documentary', 'Science Documentary', 'subgenre'),
  ('sex-comedy', 'Sex Comedy', 'subgenre'),
  ('sitcom', 'Sitcom', 'subgenre'),
  ('sketch-comedy', 'Sketch Comedy', 'subgenre'),
  ('slasher', 'Slasher', 'subgenre'),
  ('soap-serial-drama', 'Soap / Serial Drama', 'subgenre'),
  ('social-drama', 'Social Drama', 'subgenre'),
  ('space-opera', 'Space Opera', 'subgenre'),
  ('sports-drama', 'Sports Drama', 'subgenre'),
  ('stand-up-comedy', 'Stand-Up Comedy', 'subgenre'),
  ('superhero', 'Superhero', 'subgenre'),
  ('supernatural-horror', 'Supernatural Horror', 'subgenre'),
  ('survival-horror', 'Survival Horror', 'subgenre'),
  ('survival-thriller', 'Survival Thriller', 'subgenre'),
  ('sword-and-sorcery', 'Sword and Sorcery', 'subgenre'),
  ('tech-thriller', 'Tech Thriller', 'subgenre'),
  ('tragic-romance', 'Tragic Romance', 'subgenre'),
  ('true-crime-documentary', 'True Crime Documentary', 'subgenre'),
  ('urban-fantasy', 'Urban Fantasy', 'subgenre'),
  ('workplace-comedy', 'Workplace Comedy', 'subgenre'),
  ('workplace-drama', 'Workplace Drama', 'subgenre'),

  ('absurdist', 'Absurdist', 'tone'),
  ('bittersweet', 'Bittersweet', 'tone'),
  ('bleak', 'Bleak', 'tone'),
  ('cerebral', 'Cerebral', 'tone'),
  ('cynical', 'Cynical', 'tone'),
  ('dreamlike', 'Dreamlike', 'tone'),
  ('earnest', 'Earnest', 'tone'),
  ('enigmatic', 'Enigmatic', 'tone'),
  ('gritty', 'Gritty', 'tone'),
  ('meditative', 'Meditative', 'tone'),
  ('melancholic', 'Melancholic', 'tone'),
  ('menacing', 'Menacing', 'tone'),
  ('playful', 'Playful', 'tone'),
  ('raunchy', 'Raunchy', 'tone'),
  ('romantic', 'Romantic', 'tone'),
  ('satirical', 'Satirical', 'tone'),
  ('sentimental', 'Sentimental', 'tone'),
  ('stylized', 'Stylized', 'tone'),
  ('tense', 'Tense', 'tone'),
  ('unsettling', 'Unsettling', 'tone'),
  ('uplifting', 'Uplifting', 'tone'),
  ('visceral', 'Visceral', 'tone'),
  ('warm', 'Warm', 'tone'),
  ('wry', 'Wry', 'tone'),

  ('fast', 'Fast', 'pacing'),
  ('moderate', 'Moderate', 'pacing'),
  ('slow', 'Slow', 'pacing'),

  ('family-friendly', 'Family Friendly', 'attribute'),
  ('international', 'International', 'attribute'),
  ('stand-up', 'Stand-Up', 'attribute')
on conflict (slug) do update
set display_name = excluded.display_name,
    category = excluded.category,
    retired_at = null;

create table public.moods (
  slug text primary key,
  prompt_label text not null,
  threshold numeric not null check (threshold > 0),
  display_order smallint not null unique check (display_order > 0),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create table public.mood_tag_rules (
  mood_slug text not null references public.moods(slug) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete restrict,
  weight numeric not null check (weight > 0 and weight <= 2),
  primary key (mood_slug, tag_id)
);

create index mood_tag_rules_tag_idx on public.mood_tag_rules(tag_id, mood_slug);

insert into public.moods (slug, prompt_label, threshold, display_order)
values
  ('edge-of-my-seat', 'Keep me on edge', 1.60, 1),
  ('make-me-laugh', 'Make me laugh', 1.50, 2),
  ('comfort-watch', 'Comfort watch', 1.55, 3),
  ('engage-me', 'Engage me', 1.60, 4),
  ('move-me', 'Move me', 1.55, 5),
  ('take-me-somewhere-else', 'Take me somewhere else', 1.55, 6),
  ('scare-me', 'Scare me', 1.55, 7),
  ('fall-in-love', 'Make me fall in love', 1.50, 8);

with rule_groups (mood_slug, weight, tag_slugs) as (
  values
    ('edge-of-my-seat', 1.20, array['action-thriller','conspiracy-thriller','crime-thriller','espionage-thriller','mystery-thriller','psychological-thriller','revenge-thriller','survival-thriller','tech-thriller']),
    ('edge-of-my-seat', 1.05, array['adventure-action','anime-action','heist','martial-arts','military-action','superhero']),
    ('edge-of-my-seat', 0.90, array['detective','police-procedural','organized-crime']),
    ('edge-of-my-seat', 0.85, array['tense','menacing','visceral','unsettling','gritty']),
    ('edge-of-my-seat', 0.55, array['fast','moderate']),

    ('make-me-laugh', 1.20, array['absurdist-comedy','black-comedy','buddy-comedy','dark-comedy','family-sitcom','mockumentary','news-satire','parody-spoof','romantic-comedy','sex-comedy','sitcom','sketch-comedy','stand-up-comedy','workplace-comedy']),
    ('make-me-laugh', 1.00, array['adult-animation','dramedy','late-night-talk-show','satire']),
    ('make-me-laugh', 0.80, array['absurdist','playful','satirical','wry','raunchy']),
    ('make-me-laugh', 0.45, array['warm','uplifting','fast','moderate','stand-up']),

    ('comfort-watch', 1.15, array['animated-family','family-sitcom','romantic-comedy','sitcom','workplace-comedy']),
    ('comfort-watch', 0.95, array['buddy-comedy','coming-of-age-drama','dramedy','family-drama','late-night-talk-show','sports-drama','stand-up-comedy']),
    ('comfort-watch', 0.85, array['earnest','playful','sentimental','uplifting','warm','wry']),
    ('comfort-watch', 0.55, array['bittersweet','moderate','slow','family-friendly','stand-up']),

    ('engage-me', 1.20, array['alien-first-contact','conspiracy-thriller','courtroom-crime','detective','hard-sci-fi','murder-mystery','mystery-thriller','political-drama','procedural','psychological-drama','psychological-thriller','science-documentary','tech-thriller','true-crime-documentary']),
    ('engage-me', 0.95, array['anthology','crime-drama','cyberpunk','dystopian-sci-fi','historical-drama','neo-noir','police-procedural','social-drama']),
    ('engage-me', 0.90, array['cerebral','enigmatic','tense','wry']),
    ('engage-me', 0.50, array['moderate','fast']),

    ('move-me', 1.15, array['biographical-drama','coming-of-age-drama','family-drama','historical-drama','psychological-drama','relationship-drama','romantic-drama','social-drama','sports-drama','tragic-romance','workplace-drama']),
    ('move-me', 0.90, array['dramedy','political-drama','soap-serial-drama']),
    ('move-me', 0.90, array['bittersweet','earnest','melancholic','sentimental','uplifting','warm']),
    ('move-me', 0.70, array['romantic','meditative']),
    ('move-me', 0.45, array['moderate','slow']),

    ('take-me-somewhere-else', 1.20, array['alien-first-contact','cyberpunk','dystopian-sci-fi','epic-fantasy','hard-sci-fi','isekai','space-opera','sword-and-sorcery','urban-fantasy']),
    ('take-me-somewhere-else', 1.00, array['adventure-action','anime-action','historical-drama','martial-arts','nature-documentary']),
    ('take-me-somewhere-else', 0.80, array['dreamlike','enigmatic','stylized','cerebral']),
    ('take-me-somewhere-else', 0.55, array['fast','moderate','international']),

    ('scare-me', 1.30, array['body-horror','creature-feature','psychological-horror','slasher','supernatural-horror','survival-horror']),
    ('scare-me', 0.95, array['psychological-thriller','survival-thriller']),
    ('scare-me', 0.95, array['bleak','menacing','unsettling','visceral']),
    ('scare-me', 0.70, array['gritty','tense']),
    ('scare-me', 0.50, array['fast','moderate']),

    ('fall-in-love', 1.30, array['erotic-romance','romantic-comedy','romantic-drama','tragic-romance']),
    ('fall-in-love', 1.00, array['relationship-drama']),
    ('fall-in-love', 0.80, array['coming-of-age-drama','dramedy','erotic-thriller']),
    ('fall-in-love', 0.95, array['romantic','sentimental','warm']),
    ('fall-in-love', 0.70, array['bittersweet','earnest','playful','uplifting']),
    ('fall-in-love', 0.45, array['moderate','slow'])
), expanded_rules as (
  select rule_groups.mood_slug, rule_groups.weight, unnest(rule_groups.tag_slugs) as tag_slug
  from rule_groups
)
insert into public.mood_tag_rules (mood_slug, tag_id, weight)
select expanded_rules.mood_slug, tags.id, expanded_rules.weight
from expanded_rules
join public.tags on tags.slug = expanded_rules.tag_slug;

-- Materialize the current editorial classification into the general tag link
-- table. The source preserves the role needed to audit the backfill, while the
-- recommendation engine continues to read the authoritative classification row.
insert into public.title_tags (title_id, tag_id, confidence, source)
select classification.title_id, tags.id, 1, 'editorial-primary-subgenre'
from public.title_editorial_classifications classification
join public.tags tags
  on tags.slug = classification.primary_subgenre
 and tags.category = 'subgenre'
on conflict (title_id, tag_id, source) do update
set confidence = excluded.confidence;

insert into public.title_tags (title_id, tag_id, confidence, source)
select classification.title_id, tags.id, 0.6, 'editorial-secondary-subgenre'
from public.title_editorial_classifications classification
join public.tags tags
  on tags.slug = classification.secondary_subgenre
 and tags.category = 'subgenre'
where classification.secondary_subgenre is not null
on conflict (title_id, tag_id, source) do update
set confidence = excluded.confidence;

insert into public.title_tags (title_id, tag_id, confidence, source)
select classification.title_id, tags.id, 1, 'editorial-tone'
from public.title_editorial_classifications classification
cross join lateral unnest(classification.tone_tags) tone_tag
join public.tags tags
  on tags.slug = tone_tag
 and tags.category = 'tone'
on conflict (title_id, tag_id, source) do update
set confidence = excluded.confidence;

insert into public.title_tags (title_id, tag_id, confidence, source)
select classification.title_id, tags.id, 1, 'editorial-pacing'
from public.title_editorial_classifications classification
join public.tags tags
  on tags.slug = classification.pacing
 and tags.category = 'pacing'
where classification.pacing is not null
on conflict (title_id, tag_id, source) do update
set confidence = excluded.confidence;

-- Self-verification 1: every value already used by the editorial gold set must
-- exist in the vocabulary under the correct category. A missing value aborts
-- the whole transaction instead of allowing partial ontology coverage.
do $$
declare
  missing_values text;
begin
  with used_values as (
    select primary_subgenre as slug, 'subgenre' as category
    from public.title_editorial_classifications
    union
    select secondary_subgenre, 'subgenre'
    from public.title_editorial_classifications
    where secondary_subgenre is not null
    union
    select unnest(tone_tags), 'tone'
    from public.title_editorial_classifications
    union
    select pacing, 'pacing'
    from public.title_editorial_classifications
    where pacing is not null
  )
  select string_agg(used_values.category || ':' || used_values.slug, ', ' order by used_values.category, used_values.slug)
  into missing_values
  from used_values
  left join public.tags
    on tags.slug = used_values.slug
   and tags.category = used_values.category
  where tags.id is null;

  if missing_values is not null then
    raise exception 'Ontology vocabulary is missing used values: %', missing_values;
  end if;
end
$$;

-- Self-verification 2: a mood without at least one rule can never qualify a
-- title, so fail the migration rather than expose a dead picker option.
do $$
declare
  empty_moods text;
begin
  with moods_without_rules as (
    select moods.slug, moods.display_order
    from public.moods
    left join public.mood_tag_rules on mood_tag_rules.mood_slug = moods.slug
    where moods.retired_at is null
    group by moods.slug, moods.display_order
    having count(mood_tag_rules.tag_id) = 0
  )
  select string_agg(moods_without_rules.slug, ', ' order by moods_without_rules.display_order)
  into empty_moods
  from moods_without_rules;

  if empty_moods is not null then
    raise exception 'Active moods have no tag rules: %', empty_moods;
  end if;
end
$$;

alter table public.moods enable row level security;
alter table public.mood_tag_rules enable row level security;

create policy moods_public_read
  on public.moods for select to anon, authenticated using (retired_at is null);

create policy mood_tag_rules_public_read
  on public.mood_tag_rules for select to anon, authenticated using (true);

revoke all on table public.moods, public.mood_tag_rules from anon, authenticated, service_role;
grant select on table public.moods, public.mood_tag_rules to anon, authenticated, service_role;
grant select on table public.tags, public.title_tags to service_role;
