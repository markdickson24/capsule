-- Remove users.push_token from the client-readable column set.
--
-- Invite push notifications now go through the `send-invite-push` edge
-- function, which reads the invitee's push_token with the service role.
-- No client code reads push_token any more — `usePushNotifications` only
-- UPDATEs the current user's own token, which is unaffected by SELECT grants.
--
-- This extends 20260515232958_restrict_users_pii_columns.sql: the grant is
-- re-issued without push_token (alongside email/phone, still excluded).

revoke select on public.users from authenticated;

grant select (
  id,
  display_name,
  avatar_url,
  auth_provider,
  subscription_tier,
  created_at,
  bio,
  accent_color,
  onboarded_at
) on public.users to authenticated;
