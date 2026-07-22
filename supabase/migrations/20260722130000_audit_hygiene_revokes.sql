-- Low-severity hygiene from the 2026-07-22 audit (BS-4/5/6). Defense-in-depth
-- only — none is a live exploit today — brings these functions/grants in line
-- with the codebase's own established "internal functions aren't on the RPC
-- surface / anon has no users grants" pattern.
--
-- ⚠️ NOT auto-applied to production yet — pending explicit approval, since it
-- touches prod grants. Apply via apply_migration once approved.

-- BS-4: _superlative_target_valid is only meant to be called from within the
-- superlative_votes RLS policies (as the evaluating role), not directly via
-- PostgREST. Direct callers can use it as a cross-capsule membership-status
-- oracle. Revoke the direct RPC path (RLS-internal use is unaffected).
revoke execute on function public._superlative_target_valid(uuid, uuid, uuid) from public, anon, authenticated;

-- BS-6: these four RETURNS trigger functions are exposed on /rest/v1/rpc but
-- Postgres refuses to run a trigger function outside trigger context, so this is
-- hygiene only (clears the advisor + matches the revoke already applied to the
-- older trigger functions).
revoke execute on function public.enforce_member_limit()    from public, anon, authenticated;
revoke execute on function public.enforce_photo_limit()     from public, anon, authenticated;
revoke execute on function public.guard_group_recurrence()  from public, anon, authenticated;
revoke execute on function public.guard_subscription_tier() from public, anon, authenticated;

-- BS-5: the anon role still had a TABLE-LEVEL SELECT grant on users (which
-- covers every column, incl. email/phone/push_token, and masks any column-level
-- revoke). Dead today (the only users SELECT policy is scoped to authenticated,
-- so anon reads return zero rows regardless), but it removes the last non-RLS
-- safety net for anon and aligns it with authenticated (whose table-wide SELECT
-- was already revoked — that's why authenticated needs per-column grants). A
-- column-level `revoke select (...) from anon` is a no-op while the table grant
-- exists, so revoke at the table level.
revoke select on public.users from anon;
