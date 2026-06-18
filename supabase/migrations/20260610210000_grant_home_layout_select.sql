-- Fix: home_layout was added (20260610020000_add_home_layout_to_users.sql) via
-- ALTER TABLE ADD COLUMN, but the `users` table has only *column-level* SELECT
-- grants for `authenticated` (the table-wide grant was revoked in
-- 20260515232958_restrict_users_pii_columns.sql). New columns do NOT inherit a
-- column-level grant, so `authenticated` had INSERT/UPDATE but NOT SELECT on
-- home_layout. Any query selecting it (ThemeContext's
-- `select('accent_color, home_layout')`) failed with 42501 for the WHOLE query,
-- so accent_color never loaded and reset to the default on every sign-in.
--
-- Re-grant SELECT on the full client-readable column set, now including
-- home_layout. email / phone / push_token remain excluded by design.
grant select (
  id,
  display_name,
  avatar_url,
  auth_provider,
  subscription_tier,
  created_at,
  bio,
  accent_color,
  onboarded_at,
  home_layout
) on public.users to authenticated;
