-- Registers the capsule-start cron (* * * * *, EXISTS-gated per
-- PERFORMANCE.md #4 — same pattern as every other per-minute cron). Auth:
-- CRON_SECRET, project-wide Edge Function secret (confirmed during the
-- contribution-nudges work — no per-function dashboard step needed; the
-- secret is already available to every function in this project).

select cron.schedule(
  'dispatch-capsule-start',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/dispatch-capsule-start',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'cron_unlock_capsules_secret'
        )
      ),
      body := '{}'::jsonb
    )
    where exists (
      select 1 from public.capsules
      where contribution_start_at is not null
        and contribution_start_at <= now()
        and contribution_start_notified_at is null
        and status = 'active'
    );
  $cron$
);
