-- capsule_join_preview reported `already_member = true` for ANY capsule_members
-- row, including a *pending* invite (joined_at is null). The same function's
-- member_count already filtered on joined_at, so it contradicted itself.
--
-- Effect: an owner invites you from InviteModal (pending row) and also shows you
-- the QR at the event — a completely normal combination. You scan, the sheet
-- says "Already a member", and the only button is Done. You cannot join, and
-- nothing explains why.
--
-- Fixing it needs a third state rather than a boolean, because capsule_members
-- has UNIQUE (capsule_id, user_id): a pending row can't be joined with an
-- INSERT (23505), it has to be an UPDATE setting joined_at. The client is
-- granted exactly that column, so it can do this without a definer RPC.
--
-- Adding a column changes the return type, so CREATE OR REPLACE is not usable —
-- this is a DROP + CREATE. ⚠️ A signature-changing drop+create silently RESETS
-- THE FUNCTION ACL, so the grants below are mandatory, not decorative: without
-- them every caller (app + the /join/* edge function) breaks with permission
-- denied.

drop function if exists public.capsule_join_preview(uuid);

create function public.capsule_join_preview(p_capsule_id uuid)
returns table (
  id uuid,
  title text,
  owner_name text,
  owner_avatar text,
  member_count bigint,
  already_member boolean,
  is_pending boolean
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
    -- Joined for real. Pending no longer counts.
    exists (select 1 from capsule_members m2
       where m2.capsule_id = c.id
         and m2.user_id = auth.uid()
         and m2.joined_at is not null),
    -- Invited but never accepted — the client turns this into an UPDATE.
    exists (select 1 from capsule_members m3
       where m3.capsule_id = c.id
         and m3.user_id = auth.uid()
         and m3.joined_at is null)
  from capsules c
  join users u on u.id = c.owner_id
  where c.id = p_capsule_id;
$$;

-- Re-grant: the drop above wiped the previous ACL.
revoke all on function public.capsule_join_preview(uuid) from public;
grant execute on function public.capsule_join_preview(uuid) to authenticated;
grant execute on function public.capsule_join_preview(uuid) to service_role;
