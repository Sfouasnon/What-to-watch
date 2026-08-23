-- Add the v0.3.0 aggregate-review vocabulary, project it into the existing
-- mood rules, and allow the bounded service-role publisher to accept v0.3.0.

insert into public.tags (slug, display_name, category)
values
  ('family-comedy', 'Family Comedy', 'subgenre'),
  ('slapstick-comedy', 'Slapstick Comedy', 'subgenre'),
  ('biographical-drama', 'Biographical Drama', 'subgenre'),
  ('medical-drama', 'Medical Drama', 'subgenre'),
  ('true-crime-drama', 'True Crime Drama', 'subgenre'),
  ('supernatural-thriller', 'Supernatural Thriller', 'subgenre'),
  ('fantasy-comedy', 'Fantasy / Supernatural Comedy', 'subgenre'),
  ('concert-film', 'Concert Film / Music Performance', 'subgenre'),
  ('anxious', 'Anxious', 'tone'),
  ('sensual', 'Sensual', 'tone'),
  ('candid', 'Candid', 'tone'),
  ('exuberant', 'Exuberant', 'tone'),
  ('nostalgic', 'Nostalgic', 'tone')
on conflict (slug) do update
set display_name = excluded.display_name,
    category = excluded.category,
    retired_at = null;

with rules (mood_slug, weight, tag_slug) as (
  values
    ('edge-of-my-seat', 1.20::numeric, 'supernatural-thriller'),
    ('edge-of-my-seat', 0.85::numeric, 'anxious'),
    ('make-me-laugh', 1.20::numeric, 'family-comedy'),
    ('make-me-laugh', 1.20::numeric, 'slapstick-comedy'),
    ('make-me-laugh', 1.20::numeric, 'fantasy-comedy'),
    ('comfort-watch', 1.15::numeric, 'family-comedy'),
    ('comfort-watch', 0.95::numeric, 'fantasy-comedy'),
    ('comfort-watch', 0.85::numeric, 'nostalgic'),
    ('engage-me', 1.20::numeric, 'medical-drama'),
    ('engage-me', 1.20::numeric, 'true-crime-drama'),
    ('engage-me', 0.95::numeric, 'biographical-drama'),
    ('engage-me', 0.90::numeric, 'candid'),
    ('move-me', 1.15::numeric, 'biographical-drama'),
    ('move-me', 1.15::numeric, 'medical-drama'),
    ('move-me', 0.90::numeric, 'concert-film'),
    ('move-me', 0.90::numeric, 'candid'),
    ('move-me', 0.90::numeric, 'nostalgic'),
    ('take-me-somewhere-else', 1.20::numeric, 'fantasy-comedy'),
    ('take-me-somewhere-else', 1.00::numeric, 'concert-film'),
    ('take-me-somewhere-else', 0.80::numeric, 'exuberant'),
    ('scare-me', 0.95::numeric, 'supernatural-thriller'),
    ('scare-me', 0.70::numeric, 'anxious'),
    ('fall-in-love', 0.95::numeric, 'sensual'),
    ('fall-in-love', 0.70::numeric, 'nostalgic')
)
insert into public.mood_tag_rules (mood_slug, tag_id, weight)
select rules.mood_slug, tags.id, rules.weight
from rules
join public.tags on tags.slug = rules.tag_slug
on conflict (mood_slug, tag_id) do update
set weight = excluded.weight;

-- Preserve the audited publisher body and change only its explicit ontology
-- allow-list. Fail closed if the installed body is not the expected v0.2.0 form.
do $migration$
declare
  function_definition text;
  old_gate constant text := 'if ontology_value not in (''0.1.1'', ''0.2.0'') then';
  new_gate constant text := 'if ontology_value not in (''0.1.1'', ''0.2.0'', ''0.3.0'') then';
begin
  select pg_get_functiondef('public.publish_editorial_classifications(jsonb)'::regprocedure)
  into function_definition;

  if function_definition is null or position(old_gate in function_definition) = 0 then
    raise exception 'publish_editorial_classifications ontology gate does not match expected v0.2.0 definition';
  end if;

  execute replace(function_definition, old_gate, new_gate);
end
$migration$;

revoke all on function public.publish_editorial_classifications(jsonb) from public, anon, authenticated;
grant execute on function public.publish_editorial_classifications(jsonb) to service_role;

do $verification$
declare
  missing_tags text;
  unmapped_tags text;
  function_definition text;
begin
  with required_tags(slug, category) as (
    values
      ('family-comedy', 'subgenre'), ('slapstick-comedy', 'subgenre'),
      ('biographical-drama', 'subgenre'), ('medical-drama', 'subgenre'),
      ('true-crime-drama', 'subgenre'), ('supernatural-thriller', 'subgenre'),
      ('fantasy-comedy', 'subgenre'), ('concert-film', 'subgenre'),
      ('anxious', 'tone'), ('sensual', 'tone'), ('candid', 'tone'),
      ('exuberant', 'tone'), ('nostalgic', 'tone')
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
    raise exception 'ontology v0.3.0 tags missing after migration: %', missing_tags;
  end if;

  with required_tags(slug) as (
    values
      ('family-comedy'), ('slapstick-comedy'), ('biographical-drama'),
      ('medical-drama'), ('true-crime-drama'), ('supernatural-thriller'),
      ('fantasy-comedy'), ('concert-film'), ('anxious'), ('sensual'),
      ('candid'), ('exuberant'), ('nostalgic')
  )
  select string_agg(required_tags.slug, ', ' order by required_tags.slug)
  into unmapped_tags
  from required_tags
  join public.tags on tags.slug = required_tags.slug
  where not exists (
    select 1
    from public.mood_tag_rules
    where mood_tag_rules.tag_id = tags.id
  );

  if unmapped_tags is not null then
    raise exception 'ontology v0.3.0 contains tags without mood rules: %', unmapped_tags;
  end if;

  select pg_get_functiondef('public.publish_editorial_classifications(jsonb)'::regprocedure)
  into function_definition;
  if position('0.3.0' in function_definition) = 0 then
    raise exception 'publisher does not allow ontology v0.3.0';
  end if;
end
$verification$;
