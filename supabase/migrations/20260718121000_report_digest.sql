-- Moderation loop (APP_STORE_REVIEW.md #13 / launch plan): content_reports
-- rows landed in a table nobody watched — a live report sat pending for ten
-- days before this shipped. App Store Guideline 1.2 expects reports to be
-- acted on promptly, and a reviewer may file a test report during review.
--
-- Design: a DAILY cron (not per-minute — this is a human-attention digest,
-- not a delivery pipeline) pings the `report-digest` edge function whenever
-- any pending report exists. The function pushes an Expo notification to the
-- admin account so the day it stops being empty, Mark's phone says so. The
-- admin user id lives in Vault (`report_digest_admin_user_id`) so it can be
-- rotated with vault.update_secret — no redeploy, nothing hardcoded in code.
-- The function reads it through this SECURITY DEFINER wrapper because the
-- vault schema isn't exposed over PostgREST; execute is service_role-only.

create or replace function public.get_report_digest_admin()
returns uuid
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret::uuid
    from vault.decrypted_secrets
   where name = 'report_digest_admin_user_id';
$$;

revoke all on function public.get_report_digest_admin() from public;
revoke execute on function public.get_report_digest_admin() from anon;
revoke execute on function public.get_report_digest_admin() from authenticated;
grant execute on function public.get_report_digest_admin() to service_role;

-- Daily at 13:00 UTC (~9am ET). EXISTS-gated like the other crons
-- (PERFORMANCE.md #4 pattern) so the function only cold-starts on days a
-- pending report actually exists — and keeps firing daily until triaged.
select cron.schedule(
  'report-digest',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/report-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_unlock_capsules_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.content_reports where status = 'pending');
  $$
);
