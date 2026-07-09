-- Performance audit (PERFORMANCE.md #9): index gaps for the app's actual
-- query shapes. Tables are small today so plain CREATE INDEX (no
-- CONCURRENTLY) is fine inside the migration transaction.

-- Alerts list + tab-badge count: user_id = ? AND read_at IS NULL ORDER BY
-- sent_at DESC. Most-frequent query in the app (every tab switch).
create index if not exists idx_notifications_unread
  on public.notifications (user_id, sent_at desc)
  where read_at is null;

-- Unlock cron: status='active' AND unlock_mode='time' AND unlock_at <= now(),
-- run every minute. No index touched these columns before.
create index if not exists idx_capsules_unlock_due
  on public.capsules (unlock_at)
  where status = 'active' and unlock_mode = 'time';

-- Group's capsule list + group-capsule cron. Advisor: unindexed_foreign_keys.
create index if not exists idx_capsules_group_id
  on public.capsules (group_id);

-- CapsuleDetail media list: capsule_id = ? ORDER BY uploaded_at DESC. The
-- old single-column index made every query sort separately; this composite
-- covers both the filter and the sort, so the old one is redundant.
create index if not exists idx_media_capsule_uploaded
  on public.media (capsule_id, uploaded_at desc);

drop index if exists public.idx_media_capsule_id;
