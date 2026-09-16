-- BUG: "Owners can update their capsules" UPDATE policy
-- (20260515232500_capture_capsule_rls_and_helpers.sql:61-63,
-- `for update using ((select auth.uid()) = owner_id)`) has no explicit
-- WITH CHECK. Postgres reuses the USING expression as the implicit WITH
-- CHECK for an UPDATE policy that defines none of its own, so only
-- `owner_id` is constrained after the write — every OTHER column, including
-- `group_id` and `status`, is completely unconstrained. Verified on a
-- scratch Postgres 18 instance with the exact policy text: an owner's plain
-- `update capsules set group_id = ...` and `update capsules set status =
-- 'unlocked' ...` both succeed; only `update ... set owner_id = ...` is
-- correctly rejected (Postgres's implicit WITH CHECK already covers that
-- one column, so this fix is narrower than "add a WITH CHECK" would imply).
--
-- This let an owner, via a plain client PATCH (no RPC involved):
--   (a) reassign `group_id` to ANY group's UUID, bypassing
--       create_capsule_with_owner's GROUP_MEMBERSHIP_REQUIRED check
--       (20260802120000_security_authz_fixes.sql:291-297) and reopening the
--       F16 group-branding attack (send-invite-push renders the victim
--       group's real name to whoever gets auto-joined next).
--   (b) flip `status` straight to 'unlocked', bypassing the free-tier
--       active-capsule cap (20260802120000_security_authz_fixes.sql:279-283
--       counts `status <> 'unlocked'`) and instantly revealing a
--       surprise-mode capsule's media to every member ahead of its real
--       unlock time.
--
-- Fix: mirror 20260722120000_audit_rls_hardening.sql's column-grant pattern
-- for capsule_members/media (see CLAUDE.md "Client UPDATE ... is
-- column-grant-scoped"). Revoke table-wide UPDATE on capsules from
-- authenticated/anon and grant back only the columns the one legitimate
-- client UPDATE call site — EditCapsuleScreen.tsx:127-138 — actually writes.
-- `group_id`, `status`, `owner_id`, `occasion`, `owner_preview_locked`,
-- `archived_at`, etc. become un-writable by clients; legitimate writes to
-- those already go only through SECURITY DEFINER RPCs
-- (create_capsule_with_owner, claim_capsule_unlock, check_in,
-- set_capsule_archived, set_default_superlatives, delete_my_account's owner
-- transfer, capsules_stamp_unlock_meta's trigger) or service-role cron/edge
-- paths, none of which are affected by column-level grants.
revoke update on public.capsules from authenticated;
revoke update on public.capsules from anon;
grant update (
  title,
  description,
  unlock_at,
  contribution_lock_at,
  contribution_start_at,
  unlock_mode,
  superlative_voting_hours,
  live_activity_enabled
) on public.capsules to authenticated;
