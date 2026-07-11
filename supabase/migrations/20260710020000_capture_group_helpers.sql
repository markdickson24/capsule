-- GROUPS.md #10 — capture out-of-band, live-only function bodies verbatim so
-- a migrations-only restore doesn't silently break group auth. Neither of
-- these exists in any prior migration file:
--
-- - check_cron_secret: what the group cron's isAuthorized() actually calls
--   (Vault-backed, mirrors unlock-capsules' CRON_SECRET check but reads from
--   Vault directly instead of an env var). Without this captured, restoring
--   from migrations alone would 401 every create-group-capsules tick.
-- - is_group_creator: the helper behind "Creator can add members" (recreated
--   again here, idempotently, alongside the fix in
--   20260710000000_groups_rls_selfinsert_fix.sql — kept for a clean, single
--   place documenting every out-of-band groups function).

create or replace function public.check_cron_secret(provided text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select provided = decrypted_secret
  from vault.decrypted_secrets
  where name = 'cron_unlock_capsules_secret'
  limit 1;
$function$;

create or replace function public.is_group_creator(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists(
    select 1 from groups where id = p_group_id and created_by = (select auth.uid())
  );
$function$;
