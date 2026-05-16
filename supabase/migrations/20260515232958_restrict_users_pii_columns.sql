-- Stop exposing users.email / users.phone to other signed-in users.
--
-- The "Authenticated users can search profiles" RLS policy is USING (true),
-- which is required for user search and public profiles — but it also let
-- any signed-in user read every other user's email and phone.
--
-- RLS is row-level only, so the fix is column-level privileges: revoke the
-- table-wide SELECT grant from `authenticated`, then re-grant SELECT on every
-- column EXCEPT email and phone. The app never reads email/phone from this
-- table (it uses the auth session for the current user's email), so no
-- application code changes are needed.
--
-- Unaffected: `service_role` (edge functions) keeps full access; the
-- `handle_new_user` SECURITY DEFINER trigger runs as the function owner and
-- still writes email/phone on signup; `anon` has no SELECT policy on users
-- so RLS already blocks it entirely.

revoke select on public.users from authenticated;

grant select (
  id,
  display_name,
  avatar_url,
  auth_provider,
  subscription_tier,
  created_at,
  push_token,
  bio,
  accent_color,
  onboarded_at
) on public.users to authenticated;
