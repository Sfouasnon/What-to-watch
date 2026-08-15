-- What to Watch: quiet, profile-owned social discovery.
-- Friend evidence helps answer "what should I watch tonight?"; this schema
-- intentionally has no feed, inbox, unread state, reactions, or notifications.

alter table public.profiles
  add column share_with_friends text not null default 'ratings_and_reviews'
  check (share_with_friends in ('ratings_and_reviews', 'ratings_only', 'nothing'));

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  addressee_profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_profile_id <> addressee_profile_id),
  check ((status = 'pending' and responded_at is null) or status <> 'pending')
);

create unique index friendships_profile_pair_idx on public.friendships (
  least(requester_profile_id, addressee_profile_id),
  greatest(requester_profile_id, addressee_profile_id)
);
create index friendships_requester_status_idx
  on public.friendships(requester_profile_id, status, created_at desc);
create index friendships_addressee_status_idx
  on public.friendships(addressee_profile_id, status, created_at desc);

create table public.friend_review_notes (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  note text not null check (char_length(trim(note)) between 1 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_profile_id, title_id)
);

create index friend_review_notes_title_author_idx
  on public.friend_review_notes(title_id, author_profile_id);

create table public.friend_recommendations (
  id uuid primary key default gen_random_uuid(),
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  note text check (note is null or char_length(trim(note)) between 1 and 360),
  created_at timestamptz not null default now(),
  check (sender_profile_id <> recipient_profile_id),
  unique (sender_profile_id, recipient_profile_id, title_id)
);

create index friend_recommendations_recipient_title_idx
  on public.friend_recommendations(recipient_profile_id, title_id, created_at desc);
create index friend_recommendations_sender_created_idx
  on public.friend_recommendations(sender_profile_id, created_at desc);

-- This cache is derived only from overlapping ratings. It is internal ranking
-- evidence, not a public score or part of either profile's personal taste model.
create table public.friend_taste_compatibilities (
  profile_low_id uuid not null references public.profiles(id) on delete cascade,
  profile_high_id uuid not null references public.profiles(id) on delete cascade,
  overlap_count integer not null check (overlap_count >= 0),
  compatibility numeric(5,4) not null check (compatibility between 0 and 1),
  calculated_at timestamptz not null default now(),
  primary key (profile_low_id, profile_high_id),
  check (profile_low_id < profile_high_id)
);

create index friend_taste_compatibilities_calculated_idx
  on public.friend_taste_compatibilities(calculated_at desc);

create trigger friend_review_notes_set_updated_at
  before update on public.friend_review_notes
  for each row execute function public.set_updated_at();

create or replace function public.are_friends(first_profile_id uuid, second_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select first_profile_id <> second_profile_id and exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_profile_id = first_profile_id and f.addressee_profile_id = second_profile_id)
        or
        (f.requester_profile_id = second_profile_id and f.addressee_profile_id = first_profile_id)
      )
  );
$$;

create or replace function public.can_view_social_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.owns_profile(target_profile_id) or exists (
    select 1
    from public.friendships f
    where f.status in ('pending', 'accepted')
      and (
        (f.requester_profile_id = target_profile_id and public.owns_profile(f.addressee_profile_id))
        or
        (f.addressee_profile_id = target_profile_id and public.owns_profile(f.requester_profile_id))
      )
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
revoke all on function public.can_view_social_profile(uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.can_view_social_profile(uuid) to authenticated;

alter table public.friendships enable row level security;
alter table public.friend_review_notes enable row level security;
alter table public.friend_recommendations enable row level security;
alter table public.friend_taste_compatibilities enable row level security;

-- The participants may read a friendship. State transitions happen only
-- through the guarded RPCs below so a requester cannot accept their own request.
create policy friendships_participant_read on public.friendships
  for select to authenticated
  using (
    public.owns_profile(requester_profile_id)
    or public.owns_profile(addressee_profile_id)
  );

create policy profiles_select_social_connections on public.profiles
  for select to authenticated
  using (public.can_view_social_profile(id));

-- Notes remain owner-writeable but are not directly friend-readable. The
-- privacy-aware title activity RPC below exposes only the permitted fields.
create policy friend_review_notes_owner_all on public.friend_review_notes
  for all to authenticated
  using (public.owns_profile(author_profile_id))
  with check (
    public.owns_profile(author_profile_id)
    and exists (
      select 1 from public.ratings rating
      where rating.profile_id = author_profile_id
        and rating.title_id = friend_review_notes.title_id
    )
  );

-- Explicit recommendations are intentionally separate from general activity
-- privacy: sender and intended recipient can read them even when ratings are
-- hidden. Only an accepted friend may be selected as a recipient.
create policy friend_recommendations_participant_read on public.friend_recommendations
  for select to authenticated
  using (
    public.owns_profile(sender_profile_id)
    or public.owns_profile(recipient_profile_id)
  );
create policy friend_recommendations_sender_insert on public.friend_recommendations
  for insert to authenticated
  with check (
    public.owns_profile(sender_profile_id)
    and public.are_friends(sender_profile_id, recipient_profile_id)
    and exists (
      select 1 from public.ratings rating
      where rating.profile_id = sender_profile_id
        and rating.title_id = friend_recommendations.title_id
        and rating.score >= 8
    )
  );
create policy friend_recommendations_sender_update on public.friend_recommendations
  for update to authenticated
  using (public.owns_profile(sender_profile_id))
  with check (
    public.owns_profile(sender_profile_id)
    and public.are_friends(sender_profile_id, recipient_profile_id)
    and exists (
      select 1 from public.ratings rating
      where rating.profile_id = sender_profile_id
        and rating.title_id = friend_recommendations.title_id
        and rating.score >= 8
    )
  );
create policy friend_recommendations_sender_delete on public.friend_recommendations
  for delete to authenticated
  using (public.owns_profile(sender_profile_id));

create or replace function public.request_friendship(
  requester_profile_id uuid,
  target_profile_id uuid
)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  friendship public.friendships;
begin
  if not public.owns_profile(requester_profile_id) then
    raise exception 'Not authorized for requester profile';
  end if;
  if requester_profile_id = target_profile_id then
    raise exception 'A profile cannot friend itself';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_profile_id) then
    raise exception 'Target profile not found';
  end if;

  select f.* into friendship
  from public.friendships f
  where least(f.requester_profile_id, f.addressee_profile_id) = least(requester_profile_id, target_profile_id)
    and greatest(f.requester_profile_id, f.addressee_profile_id) = greatest(requester_profile_id, target_profile_id)
  for update;

  if friendship.id is null then
    insert into public.friendships (requester_profile_id, addressee_profile_id)
    values (requester_profile_id, target_profile_id)
    returning * into friendship;
  elsif friendship.status <> 'accepted' then
    update public.friendships
    set requester_profile_id = request_friendship.requester_profile_id,
        addressee_profile_id = request_friendship.target_profile_id,
        status = 'pending',
        created_at = now(),
        responded_at = null
    where id = friendship.id
    returning * into friendship;
  end if;

  return friendship;
end;
$$;

create or replace function public.respond_to_friendship(
  target_friendship_id uuid,
  accept_request boolean
)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  friendship public.friendships;
begin
  select f.* into friendship
  from public.friendships f
  where f.id = target_friendship_id
  for update;

  if friendship.id is null then
    raise exception 'Friendship not found';
  end if;
  if friendship.status <> 'pending' then
    raise exception 'Friendship is not pending';
  end if;
  if not public.owns_profile(friendship.addressee_profile_id) then
    raise exception 'Only the requested profile may respond';
  end if;

  update public.friendships
  set status = case when accept_request then 'accepted' else 'declined' end,
      responded_at = now()
  where id = target_friendship_id
  returning * into friendship;

  return friendship;
end;
$$;

create or replace function public.remove_friendship(target_friendship_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  friendship public.friendships;
begin
  select f.* into friendship
  from public.friendships f
  where f.id = target_friendship_id
  for update;

  if friendship.id is null then
    return false;
  end if;
  if not (
    public.owns_profile(friendship.requester_profile_id)
    or public.owns_profile(friendship.addressee_profile_id)
  ) then
    raise exception 'Not authorized for friendship';
  end if;

  delete from public.friendships where id = target_friendship_id;
  return true;
end;
$$;

-- Minimal profile lookup for connection setup. Account IDs and all taste data
-- are intentionally absent from the result.
create or replace function public.search_friend_profiles(
  viewer_profile_id uuid,
  search_text text
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_key text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.owns_profile(viewer_profile_id) then
    raise exception 'Not authorized for viewer profile';
  end if;
  if char_length(trim(search_text)) < 2 then
    return;
  end if;

  return query
  select p.id, p.display_name, p.avatar_key, p.avatar_url
  from public.profiles p
  where p.id <> viewer_profile_id
    and p.is_guest = false
    and p.display_name ilike '%' || trim(search_text) || '%'
  order by p.display_name
  limit 20;
end;
$$;

-- Contextual friend evidence for one title. General ratings and reviews obey
-- the source profile's sharing mode; an explicit recommendation does not.
create or replace function public.get_friend_title_activity(
  viewer_profile_id uuid,
  target_title_id uuid
)
returns table (
  friend_profile_id uuid,
  friend_display_name text,
  friend_avatar_key text,
  friend_avatar_url text,
  friend_rating smallint,
  rating_at timestamptz,
  review_note text,
  explicitly_recommended boolean,
  recommendation_note text,
  recommendation_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.owns_profile(viewer_profile_id) then
    raise exception 'Not authorized for viewer profile';
  end if;

  return query
  select
    friend.id,
    friend.display_name,
    friend.avatar_key,
    friend.avatar_url,
    case when friend.share_with_friends <> 'nothing' then rating.score end,
    case when friend.share_with_friends <> 'nothing' then rating.rated_at end,
    case when friend.share_with_friends = 'ratings_and_reviews' then review.note end,
    recommendation.id is not null,
    recommendation.note,
    recommendation.created_at
  from public.friendships friendship
  join public.profiles friend on friend.id = case
    when friendship.requester_profile_id = viewer_profile_id then friendship.addressee_profile_id
    else friendship.requester_profile_id
  end
  left join public.ratings rating
    on rating.profile_id = friend.id and rating.title_id = target_title_id
  left join public.friend_review_notes review
    on review.author_profile_id = friend.id and review.title_id = target_title_id
  left join public.friend_recommendations recommendation
    on recommendation.sender_profile_id = friend.id
   and recommendation.recipient_profile_id = viewer_profile_id
   and recommendation.title_id = target_title_id
  where friendship.status = 'accepted'
    and viewer_profile_id in (friendship.requester_profile_id, friendship.addressee_profile_id)
    and (
      recommendation.id is not null
      or (friend.share_with_friends <> 'nothing' and rating.score >= 8)
    )
  order by recommendation.created_at desc nulls last, rating.rated_at desc nulls last;
end;
$$;

-- Recalculate overlap with shrinkage toward neutral until enough shared ratings
-- exist. This function and its table remain server-only ranking infrastructure.
create or replace function public.recalculate_friend_taste_compatibility(
  first_profile_id uuid,
  second_profile_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  low_id uuid := least(first_profile_id, second_profile_id);
  high_id uuid := greatest(first_profile_id, second_profile_id);
  overlap integer;
  raw_compatibility numeric;
  shrunk_compatibility numeric;
begin
  if first_profile_id = second_profile_id or not public.are_friends(first_profile_id, second_profile_id) then
    raise exception 'Accepted friendship required';
  end if;

  select count(*)::integer, 1 - avg(abs(first_rating.score - second_rating.score)) / 9.0
  into overlap, raw_compatibility
  from public.ratings first_rating
  join public.ratings second_rating
    on second_rating.title_id = first_rating.title_id
   and second_rating.profile_id = second_profile_id
  where first_rating.profile_id = first_profile_id;

  raw_compatibility := coalesce(raw_compatibility, 0.5);
  shrunk_compatibility := greatest(0, least(1,
    0.5 + (raw_compatibility - 0.5) * least(1, overlap / 8.0)
  ));

  insert into public.friend_taste_compatibilities (
    profile_low_id, profile_high_id, overlap_count, compatibility, calculated_at
  ) values (low_id, high_id, overlap, shrunk_compatibility, now())
  on conflict (profile_low_id, profile_high_id) do update set
    overlap_count = excluded.overlap_count,
    compatibility = excluded.compatibility,
    calculated_at = excluded.calculated_at;

  return shrunk_compatibility;
end;
$$;

revoke all on function public.request_friendship(uuid, uuid) from public;
revoke all on function public.respond_to_friendship(uuid, boolean) from public;
revoke all on function public.remove_friendship(uuid) from public;
revoke all on function public.search_friend_profiles(uuid, text) from public;
revoke all on function public.get_friend_title_activity(uuid, uuid) from public;
revoke all on function public.recalculate_friend_taste_compatibility(uuid, uuid) from public;

grant execute on function public.request_friendship(uuid, uuid) to authenticated;
grant execute on function public.respond_to_friendship(uuid, boolean) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.search_friend_profiles(uuid, text) to authenticated;
grant execute on function public.get_friend_title_activity(uuid, uuid) to authenticated;
grant execute on function public.recalculate_friend_taste_compatibility(uuid, uuid) to service_role;
