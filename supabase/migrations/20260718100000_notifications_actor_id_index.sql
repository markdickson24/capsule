-- PERFORMANCE.md #9 residual: notifications.actor_id is an unindexed FK.
-- It matters now that account deletion is live — delete_my_account's cascade
-- through auth.users → public.users fans out to every FK referencing
-- users(id); without an index, the notifications.actor_id side of that
-- cascade is a sequential scan per deleted user. Same shape as the other
-- FK-coverage indexes added in 20260709120000_perf_indexes.sql.
create index if not exists idx_notifications_actor_id
  on public.notifications (actor_id)
  where actor_id is not null;
