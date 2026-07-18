-- Launch hardening (security advisor 0028): several SECURITY DEFINER RPCs
-- (create_capsule_with_owner, check_in, capsule_join_preview, the id-helper
-- functions, …) were executable by `anon` via /rest/v1/rpc/*. Every one has an
-- inline auth.uid() guard, so none was actually exploitable — but the app
-- never calls any RPC signed-out (auth happens through GoTrue, not PostgREST),
-- so anon execute is pure attack surface. Revoke it everywhere, and flip the
-- default privilege so functions added by future migrations don't silently
-- re-grant it (Supabase's default privileges grant EXECUTE on new functions
-- to anon/authenticated/service_role — the same behavior that bit
-- delete_capsule_with_storage's original revoke-from-public-only grant block).
--
-- Note: RLS policies evaluate helper functions (get_my_capsule_ids,
-- _superlative_target_valid, …) as the QUERYING role. `authenticated` grants
-- are therefore left fully intact — only anon loses execute. An anon PostgREST
-- table query that reaches such a policy now errors with 42501 instead of
-- returning empty; nothing legitimate does that.

revoke execute on all functions in schema public from anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- The revoke above only strips explicit `anon` entries. Seven legacy
-- functions additionally carried a bare PUBLIC grant (`=X/postgres` in
-- proacl) — anon is implicitly a member of PUBLIC, so they stayed
-- anon-executable until PUBLIC is revoked too. Verified before running:
-- every one of these already has an explicit `authenticated=X` grant, so
-- revoking PUBLIC changes nothing for signed-in users (RLS policy helpers
-- included) and none is a trigger function.
revoke execute on function public._haversine_m(double precision, double precision, double precision, double precision) from public;
revoke execute on function public.can_insert_capsule_member(uuid, uuid) from public;
revoke execute on function public.capsule_join_preview(uuid) from public;
revoke execute on function public.create_capsule_with_owner(text, text, timestamptz, timestamptz, text, integer, boolean, text, text, uuid, timestamptz) from public;
revoke execute on function public.get_my_capsule_ids() from public;
revoke execute on function public.get_my_group_ids() from public;
revoke execute on function public.is_group_creator(uuid) from public;
