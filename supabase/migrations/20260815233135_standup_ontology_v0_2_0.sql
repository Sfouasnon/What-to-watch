-- Add the v0.2.0 stand-up vocabulary and allow the bounded service-role
-- publisher to accept either the existing v0.1.1 rows or new v0.2.0 rows.

insert into public.tags (slug, display_name, category)
values
  ('standup-observational', 'Observational Stand-Up', 'subgenre'),
  ('standup-storytelling', 'Storytelling Stand-Up', 'subgenre'),
  ('standup-satirical', 'Satirical Stand-Up', 'subgenre'),
  ('standup-dark', 'Dark Stand-Up', 'subgenre'),
  ('standup-deadpan', 'Deadpan Stand-Up', 'subgenre'),
  ('standup-absurdist', 'Absurdist Stand-Up', 'subgenre'),
  ('standup-raunchy', 'Raunchy Stand-Up', 'subgenre'),
  ('standup-one-liner', 'One-Liner Stand-Up', 'subgenre'),
  ('standup-alternative', 'Alternative Stand-Up', 'subgenre'),
  ('standup-character', 'Character Stand-Up', 'subgenre'),
  ('standup-musical', 'Musical Stand-Up', 'subgenre'),
  ('standup-clean', 'Clean Stand-Up', 'subgenre'),
  ('standup-prop-comedy', 'Prop Comedy', 'subgenre'),
  ('standup-impressions', 'Impressions', 'subgenre'),
  ('thoughtful', 'Thoughtful', 'tone'),
  ('inventive', 'Inventive', 'tone'),
  ('surprising', 'Surprising', 'tone')
on conflict (slug) do update
set display_name = excluded.display_name,
    category = excluded.category,
    retired_at = null;

with rules (mood_slug, weight, tag_slug) as (
  select 'make-me-laugh', 1.20::numeric, unnest(array[
    'standup-observational', 'standup-storytelling', 'standup-satirical',
    'standup-dark', 'standup-deadpan', 'standup-absurdist', 'standup-raunchy',
    'standup-one-liner', 'standup-alternative', 'standup-character',
    'standup-musical', 'standup-clean', 'standup-prop-comedy', 'standup-impressions'
  ])
  union all
  values
    ('make-me-laugh', 0.80::numeric, 'inventive'),
    ('make-me-laugh', 0.80::numeric, 'surprising'),
    ('engage-me', 0.90::numeric, 'thoughtful')
)
insert into public.mood_tag_rules (mood_slug, tag_id, weight)
select rules.mood_slug, tags.id, rules.weight
from rules
join public.tags on tags.slug = rules.tag_slug
on conflict (mood_slug, tag_id) do update
set weight = excluded.weight;

-- Preserve the existing, audited publisher body and change only its explicit
-- ontology allow-list. Fail closed if the prior function is not the version
-- this migration expects instead of applying an ambiguous textual rewrite.
do $migration$
declare
  function_definition text;
  old_gate constant text := 'if ontology_value <> ''0.1.1'' then';
  new_gate constant text := 'if ontology_value not in (''0.1.1'', ''0.2.0'') then';
begin
  select pg_get_functiondef('public.publish_editorial_classifications(jsonb)'::regprocedure)
  into function_definition;

  if function_definition is null or position(old_gate in function_definition) = 0 then
    raise exception 'publish_editorial_classifications ontology gate does not match expected v0.1.1 definition';
  end if;

  execute replace(function_definition, old_gate, new_gate);
end
$migration$;

revoke all on function public.publish_editorial_classifications(jsonb) from public, anon, authenticated;
grant execute on function public.publish_editorial_classifications(jsonb) to service_role;

do $verification$
declare
  missing_tags text;
  function_definition text;
begin
  with required_tags(slug, category) as (
    values
      ('standup-observational', 'subgenre'), ('standup-storytelling', 'subgenre'),
      ('standup-satirical', 'subgenre'), ('standup-dark', 'subgenre'),
      ('standup-deadpan', 'subgenre'), ('standup-absurdist', 'subgenre'),
      ('standup-raunchy', 'subgenre'), ('standup-one-liner', 'subgenre'),
      ('standup-alternative', 'subgenre'), ('standup-character', 'subgenre'),
      ('standup-musical', 'subgenre'), ('standup-clean', 'subgenre'),
      ('standup-prop-comedy', 'subgenre'), ('standup-impressions', 'subgenre'),
      ('thoughtful', 'tone'), ('inventive', 'tone'), ('surprising', 'tone')
  )
  select string_agg(required_tags.category || ':' || required_tags.slug, ', ' order by required_tags.slug)
  into missing_tags
  from required_tags
  left join public.tags
    on tags.slug = required_tags.slug
   and tags.category = required_tags.category
   and tags.retired_at is null
  where tags.id is null;

  if missing_tags is not null then
    raise exception 'stand-up ontology tags missing after migration: %', missing_tags;
  end if;

  select pg_get_functiondef('public.publish_editorial_classifications(jsonb)'::regprocedure)
  into function_definition;
  if position('0.2.0' in function_definition) = 0 then
    raise exception 'publisher does not allow ontology v0.2.0';
  end if;
end
$verification$;
