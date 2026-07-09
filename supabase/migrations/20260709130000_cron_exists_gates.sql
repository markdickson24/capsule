-- Performance audit (PERFORMANCE.md #4): all three per-minute cron jobs
-- called net.http_post unconditionally, regardless of whether there was any
-- work to do (~130K invocations/month combined at idle). Gate each HTTP call
-- behind a cheap EXISTS check on the same tick's actual work. Zero behavior
-- change: the same ticks that would have done work still fire.
--
-- `select expr where exists (...)` (no FROM clause) is valid Postgres — the
-- WHERE filters the single implicit row before the target list (net.http_post
-- call) is evaluated, so the HTTP call is skipped entirely when the EXISTS
-- is false.
--
-- Re-registers each job by name (unschedule + schedule), matching the
-- pattern used in 20260607020000_superlative_notifications.sql. Command
-- text otherwise unchanged from the live jobs (verified via cron.job).

select cron.unschedule('unlock-capsules');

select cron.schedule(
  'unlock-capsules',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/unlock-capsules',
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
      -- Covers both unlocking AND the widest (1-day) reminder tier in
      -- dispatchReminders, so this tick's actual work is never skipped.
      select 1 from public.capsules
      where status = 'active' and unlock_mode = 'time'
        and unlock_at <= now() + interval '24 hours'
    );
  $cron$
);

select cron.unschedule('create-group-capsules');

select cron.schedule(
  'create-group-capsules',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/create-group-capsules',
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
      select 1 from public.groups where next_capsule_at <= now()
    );
  $cron$
);

select cron.unschedule('close-superlative-windows');

select cron.schedule(
  'close-superlative-windows',
  '* * * * *',
  $cron$
    -- Cheap in-database SQL functions stay unconditional.
    select public.dispatch_superlative_closing_soon();
    select public.close_superlative_windows();
    -- Evaluated AFTER the two functions above, so it sees rows they just
    -- inserted/updated this same tick.
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/send-superlative-pushes',
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
      select 1 from public.notifications
      where pushed_at is null
        and type in ('superlative_suggested', 'superlative_closing_soon', 'superlative_won')
    );
  $cron$
);
