-- Superlatives — Phase 6: notification triggers + push dispatch.
--
-- Three new notification types need to reach users:
--   * superlative_suggested — fires when a new category is suggested.
--     Inserted by an AFTER INSERT trigger for every other joined member.
--   * superlative_closing_soon — sent ~2h before voting closes. The cron
--     calls dispatch_superlative_closing_soon() which fans the row out to
--     every joined member and stamps closing_soon_sent_at so it only fires
--     once per capsule.
--   * superlative_won — already inserted by finalize_capsule_superlatives
--     in phase 5.
--
-- A new edge function (send-superlative-pushes) reads unpushed superlative
-- notification rows once a minute and posts to the Expo push API. It marks
-- pushed_at so duplicates are impossible. The pg_cron job that already
-- closed windows now also calls the closing-soon dispatcher and pings the
-- edge function over net.http_post (shares the existing cron secret).

-- ============================================================
-- 1. Track which notification rows have been pushed.
-- ============================================================
alter table public.notifications add column pushed_at timestamptz;

create index if not exists idx_notifications_unpushed
  on public.notifications (sent_at)
  where pushed_at is null;

-- ============================================================
-- 2. Per-capsule guard so closing-soon fires once.
-- ============================================================
alter table public.capsules add column superlative_closing_soon_sent_at timestamptz;

-- ============================================================
-- 3. notify_on_superlative_suggested — fan-out trigger.
-- ============================================================
create or replace function public.notify_on_superlative_suggested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, capsule_id, type)
  select cm.user_id, NEW.capsule_id, 'superlative_suggested'
    from public.capsule_members cm
   where cm.capsule_id = NEW.capsule_id
     and cm.joined_at is not null
     and cm.user_id <> NEW.suggested_by;
  return null;
end;
$$;

revoke execute on function public.notify_on_superlative_suggested() from public, anon, authenticated;

create trigger superlative_category_notify_suggested
after insert on public.superlative_categories
for each row execute function public.notify_on_superlative_suggested();

-- ============================================================
-- 4. dispatch_superlative_closing_soon — once-per-capsule fanout
--    in the 2h window before voting closes.
-- ============================================================
create or replace function public.dispatch_superlative_closing_soon()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.capsules
     where superlative_voting_closes_at is not null
       and superlative_closing_soon_sent_at is null
       and now() >= superlative_voting_closes_at - interval '2 hours'
       and now() <  superlative_voting_closes_at
  loop
    insert into public.notifications (user_id, capsule_id, type)
    select cm.user_id, v_id, 'superlative_closing_soon'
      from public.capsule_members cm
     where cm.capsule_id = v_id
       and cm.joined_at is not null;

    update public.capsules
       set superlative_closing_soon_sent_at = now()
     where id = v_id;
  end loop;
end;
$$;

revoke execute on function public.dispatch_superlative_closing_soon() from public, anon, authenticated;

-- ============================================================
-- 5. Reschedule the cron so it also dispatches closing-soon and
--    pings the new edge function. We share the existing
--    cron_unlock_capsules_secret since both are cron→function auth.
-- ============================================================
select cron.unschedule('close-superlative-windows');

select cron.schedule(
  'close-superlative-windows',
  '* * * * *',
  $cron$
    select public.dispatch_superlative_closing_soon();
    select public.close_superlative_windows();
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
    );
  $cron$
);
