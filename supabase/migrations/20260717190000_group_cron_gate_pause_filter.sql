-- X2 fix: the create-group-capsules cron's EXISTS gate never checked
-- recurrence_paused_at, so a paused group whose frozen next_capsule_at
-- passes makes the gate permanently true — net.http_post fires (and the
-- edge function cold-starts) every single minute forever, even though the
-- function's own due-groups query correctly filters paused groups and does
-- nothing. This silently reintroduced exactly the idle invocation cost the
-- original cron_exists_gates migration (20260709130000) was written to
-- eliminate. Adding the same pause filter the function itself applies.
--
-- Command text below is otherwise byte-identical to the live production
-- job (fetched from cron.job immediately before writing this migration),
-- including the Vault secret lookup. Re-registering a cron job means
-- unschedule + schedule, per the established pattern.

select cron.unschedule('create-group-capsules');

select cron.schedule(
  'create-group-capsules',
  '* * * * *',
  $$
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
      select 1 from public.groups
       where next_capsule_at <= now()
         and recurrence_paused_at is null
    );
  $$
);
