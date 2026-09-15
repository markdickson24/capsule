-- BUG: NotificationsScreen.declineInvite() (src/screens/app/NotificationsScreen.tsx)
-- deletes the invitee's own pending capsule_members row to decline an
-- invite. The capsule_members_delete policy
-- (20260515232500_capture_capsule_rls_and_helpers.sql:91-94) only allows the
-- CAPSULE OWNER to delete rows, so the invitee's delete matches zero rows.
-- PostgREST has no "0 rows affected" error for this — it returns
-- { error: null } — so the client's own error-only check treated a
-- completely no-op delete as a successful decline: it marked the invite
-- notification read (permanently hiding the card) while the pending row,
-- and the owner's ghost "Pending" member in ManageMembers, survived
-- forever with no way to ever act on it again.
--
-- Fix: extend the DELETE policy to also allow a member to delete their own
-- row while it is still pending (joined_at is null) — this is exactly the
-- self-decline case and mirrors capsule_members_update's existing
-- `user_id = auth.uid()` shape. It does NOT let a member remove themselves
-- (or anyone else) once they've actually joined — that stays owner-only,
-- matching ManageMembersScreen's existing remove-member semantics. Paired
-- with a client-side fix (NotificationsScreen.tsx) that now requests the
-- deleted row back via .select() and treats a zero-row result as a real
-- failure instead of a silent success.
drop policy if exists "capsule_members_delete" on public.capsule_members;

create policy "capsule_members_delete" on public.capsule_members
  for delete using (
    capsule_id in (select id from public.capsules where owner_id = (select auth.uid()))
    or (user_id = (select auth.uid()) and joined_at is null)
  );
