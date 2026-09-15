-- Bug fix: capsule_member_removal_tombstone() (20260802120000, function body at
-- lines 187-211) aborts capsule/account deletion whenever the capsule being
-- deleted has any OTHER capsule_members row.
--
-- Mechanism: capsule_members.capsule_id is `on delete cascade` to capsules(id)
-- (supabase-schema.sql:34), so deleting a capsule row fires
-- trg_capsule_member_removal_tombstone (AFTER DELETE, no WHEN clause) once per
-- cascaded capsule_members row -- including rows belonging to someone other
-- than the deleter. For those rows the trigger body unconditionally INSERTs
-- into capsule_member_revocations(capsule_id, ...), but that column is ALSO
-- `on delete cascade` to capsules(id) (20260802120000:47) with an IMMEDIATE
-- (non-deferrable) FK, and the parent capsules row is already gone from the
-- FK-check snapshot mid-cascade. The INSERT raises 23503 (foreign key
-- violation) and rolls back the entire statement -- including the capsule
-- delete itself.
--
-- Reproduced against a throwaway local Postgres 18 instance with the exact
-- table/trigger shapes transcribed from supabase-schema.sql:34 and this
-- migration's own capsule_member_revocations/trigger definitions (not the
-- project DB) -- deleting a capsule with one other member row deterministically
-- raised the FK violation and rolled back.
--
-- Reachable in production via:
--   - delete_capsule_with_storage(p_capsule_id) (20260726231008:48,
--     `delete from public.capsules where id = p_capsule_id;`) -- fails for ANY
--     capsule that has ever been shared/invited to (any capsule_members row
--     besides the owner's own).
--   - delete_my_account (20260726231047) -- its ownership-transfer loop
--     (lines 40-57) only reassigns capsules to members with `joined_at is not
--     null`; a sole-owned capsule whose only other member is a still-pending
--     invitee (joined_at null) is not transferred, so the final
--     `delete from public.capsules where owner_id = v_uid` (line 64) hits the
--     same 23503 and aborts account deletion entirely -- including the
--     reaction/vote/notification cleanup and any capsule/group transfers
--     already performed earlier in the same function.
--
-- Fix: skip the tombstone INSERT when the parent capsules row no longer
-- exists (i.e. this DELETE arrived via cascade from a capsule delete, not a
-- standalone member removal) -- there's no capsule left to enforce a
-- self-insert block against, so there is nothing to tombstone. A direct
-- member removal (ManageMembersScreen's trash icon, capsule untouched) is
-- unaffected: the capsule row still exists, so the guard is a no-op there and
-- the tombstone is written exactly as before. Verified both cases against the
-- same throwaway Postgres instance: a plain member removal still tombstones,
-- and a capsule delete with another (joined or pending) member now succeeds.
--
-- Same-signature `create or replace` on an already-`security definer`
-- function -- no grant/revoke changes needed (see the migration-lesson
-- comment in create_capsule_with_owner's history).
create or replace function public.capsule_member_removal_tombstone()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if (select auth.uid()) = old.user_id then
    -- Self-leave: no tombstone. The member must still be able to rejoin via
    -- QR / capsule://join later -- that is the intentional, documented
    -- self-insert design the original migration does not touch.
    return old;
  end if;

  -- NEW: this row was removed as part of the capsule itself being deleted
  -- (FK CASCADE from capsules -> capsule_members), not a standalone member
  -- removal. There is no capsule left to tombstone a revocation against --
  -- and capsule_member_revocations.capsule_id is itself `on delete cascade`
  -- to capsules(id), so inserting here mid-cascade would 23503 and abort the
  -- whole DELETE (the bug this migration fixes).
  if not exists (select 1 from capsules where id = old.capsule_id) then
    return old;
  end if;

  -- Owner-performed removal of someone else, capsule still exists. Record/
  -- refresh a tombstone so their self-insert (QR/deep-link) is durably
  -- blocked until the owner re-invites them, which clears it (see
  -- can_insert_capsule_member).
  insert into capsule_member_revocations (capsule_id, user_id, revoked_by)
  values (old.capsule_id, old.user_id, (select auth.uid()))
  on conflict (capsule_id, user_id)
  do update set revoked_at = now(), revoked_by = excluded.revoked_by;

  return old;
end;
$$;
