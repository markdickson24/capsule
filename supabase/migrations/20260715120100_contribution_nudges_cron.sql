-- Registers the two phase-1 contribution-nudge crons (both * * * * *,
-- EXISTS-gated per PERFORMANCE.md #4 — same pattern as the four existing
-- per-minute crons). Auth: CRON_SECRET env var on each function (set
-- manually in the Supabase dashboard — see Task 6), sourced here from the
-- same 'cron_unlock_capsules_secret' Vault entry every other cron reads.

select cron.schedule(
  'dispatch-contribution-activity',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/dispatch-contribution-activity',
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
      select 1 from public.contribution_activity_pending
      where last_upload_at <= now() - interval '2 minutes'
    );
  $cron$
);

select cron.schedule(
  'contribution-nudges',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/contribution-nudges',
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
      select 1
      from public.capsule_members cm
      join public.capsules c on c.id = cm.capsule_id
      where cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and c.status = 'active'
        and (
          cm.contribution_nudge_7d_sent_at is null
          or cm.contribution_nudge_3d_sent_at is null
          or cm.contribution_nudge_1d_sent_at is null
        )
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '7 days'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
    );
  $cron$
);
