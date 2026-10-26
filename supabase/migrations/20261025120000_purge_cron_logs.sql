-- pg_cron records every run in cron.job_run_details and never deletes them.
-- Six jobs firing every minute had grown it to 1.6 GB (plus 206 MB in
-- net._http_response from the jobs' net.http_post calls) while the actual
-- app data was ~18 MB. Both tables were truncated by hand on 2026-10-25;
-- this keeps them at a week of history. Nothing in the app reads either table.
select cron.schedule(
  'purge-cron-logs',
  '17 3 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    delete from net._http_response where created < now() - interval '7 days';
  $$
);
