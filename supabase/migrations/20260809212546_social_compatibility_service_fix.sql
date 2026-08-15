-- The browser-facing are_friends helper now requires ownership of one side.
-- This service-only derived-cache refresher therefore performs its own direct
-- accepted-friendship check before recalculating compatibility.
create or replace function public.recalculate_friend_taste_compatibility(
  first_profile_id uuid,
  second_profile_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  low_id uuid := least(first_profile_id, second_profile_id);
  high_id uuid := greatest(first_profile_id, second_profile_id);
  overlap integer;
  raw_compatibility numeric;
  shrunk_compatibility numeric;
begin
  if first_profile_id = second_profile_id
     or not exists (
       select 1
       from public.friendships friendship
       where friendship.status = 'accepted'
         and (
           (
             friendship.requester_profile_id = first_profile_id
             and friendship.addressee_profile_id = second_profile_id
           )
           or
           (
             friendship.requester_profile_id = second_profile_id
             and friendship.addressee_profile_id = first_profile_id
           )
         )
     ) then
    raise exception 'accepted_friendship_required';
  end if;

  select
    count(*)::integer,
    1 - avg(abs(first_rating.score - second_rating.score)) / 9.0
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
    profile_low_id, profile_high_id, overlap_count, compatibility,
    calculated_at
  ) values (
    low_id, high_id, overlap, shrunk_compatibility, now()
  )
  on conflict (profile_low_id, profile_high_id) do update set
    overlap_count = excluded.overlap_count,
    compatibility = excluded.compatibility,
    calculated_at = excluded.calculated_at;

  return shrunk_compatibility;
end;
$$;

revoke all on function public.recalculate_friend_taste_compatibility(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.recalculate_friend_taste_compatibility(uuid, uuid)
  to service_role;
