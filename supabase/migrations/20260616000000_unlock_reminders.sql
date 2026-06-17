-- Countdown reminder pushes before a capsule unlocks: 1 day / 1 hour / 10 min.
-- Dispatched by the unlock-capsules edge function (cron, every minute). Each tier
-- is stamped on the capsule the moment it fires, so a reminder is sent at most once.
-- Only 'time'-mode capsules get reminders (proximity/both don't unlock on a clock).

-- In-app rows use a new notification type.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder'
  ));

-- Per-tier "already sent" stamps (null = not yet sent).
alter table public.capsules
  add column if not exists unlock_reminder_1d_sent_at  timestamptz,
  add column if not exists unlock_reminder_1h_sent_at  timestamptz,
  add column if not exists unlock_reminder_10m_sent_at timestamptz;
