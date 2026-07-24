-- Re-assert least-privilege grants on create_capsule_with_owner's new 12-arg
-- signature. 20260724120000_live_activity_countdown.sql added a trailing
-- p_live_activity_enabled param via `drop function ... ; create or replace
-- function ...` — unlike a same-signature `create or replace` (which
-- preserves the ACL, see 20260721120000_capsule_limit_in_create_rpc.sql), a
-- signature-changing DROP followed by CREATE makes Postgres treat the result
-- as a brand-new function object, which picks up ambient default privileges
-- (PUBLIC execute) instead of inheriting the old grants. This silently undid
-- 20260718120000_revoke_anon_rpc_execute.sql's explicit anon revoke for this
-- function — confirmed live: `has_function_privilege('anon', oid, 'EXECUTE')`
-- was true and the ACL carried a `=X/postgres` (PUBLIC) entry, unlike sibling
-- RPCs (create_group_with_creator, set_capsule_archived) which have neither.
-- Exploitability was low (the function's own `if v_uid is null then raise
-- exception 'Not authenticated'` still blocks a real anon caller), but it's a
-- verifiable regression of a documented security invariant.
--
-- LESSON: any future signature change to this function (another drop+create)
-- must re-run this reassertion, or repeat this same regression.
revoke all on function public.create_capsule_with_owner(
  text, text, timestamptz, timestamptz, text, integer, boolean, text, text, uuid, timestamptz, boolean
) from public, anon;
grant execute on function public.create_capsule_with_owner(
  text, text, timestamptz, timestamptz, text, integer, boolean, text, text, uuid, timestamptz, boolean
) to authenticated;
