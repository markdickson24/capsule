-- QR scan-to-join preview.
--
-- The `capsules` SELECT policy is membership-gated (a user can only read a
-- capsule they already belong to), so the QR scanner's pre-join preview read
-- returned nothing for non-members and the scanner reported the capsule
-- "doesn't exist or the invite has expired" — for exactly the people meant to
-- join. This SECURITY DEFINER RPC returns the minimal, non-sensitive preview a
-- non-member needs, gated only by possession of the (unguessable) capsule UUID
-- — the same trust model as the QR / capsule://join deep link. Mirrors the
-- existing capsule_media_count / tally_superlatives pattern.

create or replace function public.capsule_join_preview(p_capsule_id uuid)
returns table (
  id uuid,
  title text,
  owner_name text,
  owner_avatar text,
  member_count bigint,
  already_member boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.title,
    u.display_name,
    u.avatar_url,
    (select count(*) from capsule_members m
       where m.capsule_id = c.id and m.joined_at is not null),
    exists (select 1 from capsule_members m2
       where m2.capsule_id = c.id and m2.user_id = auth.uid())
  from capsules c
  join users u on u.id = c.owner_id
  where c.id = p_capsule_id;
$$;

grant execute on function public.capsule_join_preview(uuid) to authenticated;
