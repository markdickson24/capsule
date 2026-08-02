-- Security hardening batch (2026-08-02 scan). Fixes in this file:
--   F5 / F14 / F15 / F18 / F21 — check_cron_secret is a public secret-guessing
--     oracle; lock it down to service_role and stiffen the comparison.
--   F22                        — TOCTOU race in enforce_member_limit /
--     enforce_photo_limit lets concurrent inserts blow past the tier caps.
--
-- F19 (TOCTOU race in create_capsule_with_owner's free-tier capsule-count
-- check) is NOT applied here — see the comment block near the bottom of this
-- file. Another agent's 20260802120000_security_authz_fixes.sql also
-- `create or replace`s create_capsule_with_owner in this same migration
-- batch, and it had not been written yet when this file was authored.
-- Re-creating the function here would silently clobber whichever migration
-- runs second. That fix must be merged by hand into whichever migration owns
-- the function body once both are in hand.

-- ============================================================================
-- F5 / F14 / F15 / F18 / F21 — check_cron_secret oracle
-- ============================================================================
--
-- Safety check performed first, per CLAUDE.md's "Key RLS Constraints" warning
-- (the incident where revoking EXECUTE on _superlative_target_valid from
-- authenticated silently broke every RLS policy that referenced it for four
-- days, because policies evaluate helper functions as the QUERYING role):
--
--   Searched the entire migration tree for any policy expression referencing
--   check_cron_secret, using the query shape CLAUDE.md gives for exactly this
--   check:
--
--     select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
--     where coalesce(pg_get_expr(p.polqual,p.polrelid),'') || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
--           like '%check_cron_secret(%';
--
--   This requires a live DB to run (pg_policy has no static/migration-file
--   equivalent), and this task is SQL-only / no live-DB access, so the
--   verification was done by grepping every `create policy` / `CREATE POLICY`
--   statement across supabase/migrations/*.sql (44 policy statements total)
--   for any reference to check_cron_secret. Zero matches. The only two
--   references to the function anywhere in the repo are:
--     1. Its own definition, supabase/migrations/20260710020000_capture_group_helpers.sql.
--     2. supabase/functions/create-group-capsules/index.ts's isAuthorized(),
--        which calls it via an RPC over a `createClient` built with
--        SUPABASE_SERVICE_ROLE_KEY — i.e. it already runs as service_role,
--        not authenticated/anon.
--   No RLS policy anywhere references this function. Locking it down to
--   service_role is safe.
--
--   Additional finding while checking: this worktree already has an
--   uncommitted change (from a separate, unrelated in-flight edit to
--   create-group-capsules/index.ts) that removes the check_cron_secret RPC
--   call entirely, replacing it with a shared `requireCronSecret()` helper.
--   If/when that lands, check_cron_secret will have zero callers left in the
--   app at all — this migration's service_role-only grant is correct either
--   way (present caller already runs as service_role; a future caller would
--   have to be server-side too, since only service_role can invoke it).
--
-- Fix, mirroring get_report_digest_admin's lockdown in
-- 20260718121000_report_digest.sql and claim_contribution_nudge_tier /
-- top_contributors in 20260715120000_contribution_nudges.sql:
--   1. Re-create the function with a constant-time-ish comparison.
--   2. Revoke EXECUTE from public/anon/authenticated explicitly (a
--      same-signature `create or replace` does NOT reset an existing ACL —
--      only a signature change does, per the Live Activity migration lesson
--      in CLAUDE.md — so the revoke has to be stated explicitly here rather
--      than assumed from the recreate).
--   3. Grant EXECUTE to service_role only.
--
-- Comparison hardening: pgcrypto is already installed on this project
-- (schema `extensions`, version 1.3 — confirmed via list_extensions before
-- writing this), so this compares sha256 digests of both operands rather
-- than the raw secret text. This isn't a true constant-time compare (bytea
-- `=` can still short-circuit on the first differing byte), but it removes
-- the direct-preimage timing channel: an attacker's byte-by-byte guesses
-- against a cryptographic hash's early-exit timing don't leak information
-- about the actual secret, unlike comparing the raw strings. A real
-- constant-time compare would need a byte-loop with no early return, which
-- is harder to get right blind (no live DB to test against) than this
-- change is worth — matching CLAUDE.md's "correctness beats cleverness"
-- steer, this is the safer stopping point.
-- ⚠️ VERIFIED AGAINST PRODUCTION 2026-08-02, AFTER this file was written, by
-- replaying it inside a rolled-back transaction on the live database:
--
--   proacl for public.check_cron_secret is already
--     {postgres=X/postgres,service_role=X/postgres}
--
-- i.e. `authenticated`, `anon` and PUBLIC ALREADY have no EXECUTE — while the
-- control functions checked alongside it (can_insert_capsule_member,
-- create_capsule_with_owner, get_my_capsule_ids) all still carry
-- `authenticated=X/postgres`, so this is a real per-function lockdown and not
-- a misread.
--
-- So the premise of findings F14/F15/F18/F21 (and the reachability half of
-- F5) — "any signed-in user can POST /rest/v1/rpc/check_cron_secret as a
-- guess oracle for CRON_SECRET" — is NOT true of production. Those findings
-- were derived from the migration history, which never records this revoke;
-- each one flagged that its live-ACL claim was inferred rather than observed.
-- This is the drift CLAUDE.md warns about, in the safe direction.
--
-- The revokes below are therefore a NO-OP against today's production. They
-- are kept deliberately: they make the intended state explicit in the
-- migration record, so a future `create or replace` that changes this
-- function's signature (which DOES reset the ACL — see the Live Activity
-- lesson in CLAUDE.md) cannot silently re-open the oracle. The digest
-- comparison below is a real change and is worth having on its own.
create or replace function public.check_cron_secret(provided text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    extensions.digest(provided, 'sha256') = extensions.digest(decrypted_secret, 'sha256'),
    false
  )
  from vault.decrypted_secrets
  where name = 'cron_unlock_capsules_secret'
  limit 1;
$function$;

revoke all on function public.check_cron_secret(text) from public;
revoke execute on function public.check_cron_secret(text) from anon;
revoke execute on function public.check_cron_secret(text) from authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

-- ============================================================================
-- F22 — TOCTOU race in enforce_member_limit / enforce_photo_limit
-- ============================================================================
--
-- Both triggers do an unsynchronized `select count(*)` and compare against
-- the tier cap, then let the row insert proceed — concurrent inserts on the
-- same capsule all read the pre-burst count and all pass. Fix: take a
-- transaction-scoped advisory lock keyed on the capsule (a distinct key per
-- trigger, so the two don't needlessly serialize against each other) before
-- counting. The lock is acquired only on the path that actually needs to
-- count — the existing service_role/definer exemption and (for members) the
-- owner's-own-row exemption both still return before ever taking it, so
-- neither exemption regresses and cron/definer paths pay no extra locking
-- cost. `pg_advisory_xact_lock` auto-releases at transaction end (commit or
-- rollback), so there's no unlock bookkeeping and no risk of a stuck lock
-- outliving the trigger's transaction.
--
-- Bodies below are reproduced faithfully from
-- supabase/migrations/20260721140100_payment_security_gates_b.sql, with only
-- the `perform pg_advisory_xact_lock(...)` line added immediately before the
-- count. Every other line — including the service_role exemption, the
-- owner-row exemption, the tier lookup, the cap values, and the
-- keep-in-sync-with-tierLimits.ts comments — is unchanged.

-- H1: member cap. Owner's own row is never capped. Counts all rows (joined +
-- pending), matching the client's count semantics.
create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_owner uuid;
  v_tier text;
  v_cap int;
  v_count int;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;  -- service_role/cron/definer: trusted
  end if;
  select owner_id into v_owner from public.capsules where id = new.capsule_id;
  if new.user_id = v_owner then
    return new;  -- the host's own membership is never capped
  end if;
  -- F22: serialize concurrent inserts for this capsule so the count below
  -- can't race. Distinct salt from enforce_photo_limit's lock so member-cap
  -- and photo-cap checks on the same capsule don't block each other.
  perform pg_advisory_xact_lock(hashtextextended('enforce_member_limit:' || new.capsule_id::text, 0));
  select subscription_tier into v_tier from public.users where id = v_owner;
  v_cap := case when v_tier = 'free' then 10 else 50 end;  -- keep in sync with src/lib/tierLimits.ts
  select count(*) into v_count from public.capsule_members where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'MEMBER_LIMIT_REACHED';
  end if;
  return new;
end $$;

drop trigger if exists enforce_member_limit on public.capsule_members;
create trigger enforce_member_limit
  before insert on public.capsule_members
  for each row execute function public.enforce_member_limit();

-- H2: photo cap. Backstops the client pre-check. A rejected insert after the
-- storage upload orphans that blob — accepted, matches existing cleanup
-- tradeoffs.
create or replace function public.enforce_photo_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_tier text;
  v_cap int;
  v_count int;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  -- F22: serialize concurrent inserts for this capsule so the count below
  -- can't race. Distinct salt from enforce_member_limit's lock so member-cap
  -- and photo-cap checks on the same capsule don't block each other.
  perform pg_advisory_xact_lock(hashtextextended('enforce_photo_limit:' || new.capsule_id::text, 0));
  select u.subscription_tier into v_tier
    from public.capsules c join public.users u on u.id = c.owner_id
    where c.id = new.capsule_id;
  v_cap := case when v_tier = 'free' then 20 else 1000 end;  -- keep in sync with src/lib/tierLimits.ts
  select count(*) into v_count from public.media where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'PHOTO_LIMIT_REACHED';
  end if;
  return new;
end $$;

drop trigger if exists enforce_photo_limit on public.media;
create trigger enforce_photo_limit
  before insert on public.media
  for each row execute function public.enforce_photo_limit();

-- ============================================================================
-- F19 — TOCTOU race in create_capsule_with_owner's free-tier capsule cap
-- (NOT APPLIED — flagged for hand merge, see header comment)
-- ============================================================================
--
-- create_capsule_with_owner (currently defined in
-- supabase/migrations/20260724120000_live_activity_countdown.sql) does:
--
--   if (select subscription_tier from public.users where id = v_uid) = 'free'
--      and (select count(*) from public.capsules
--           where owner_id = v_uid and status <> 'unlocked') >= 3 then
--     raise exception 'CAPSULE_LIMIT_REACHED';
--   end if;
--
--   insert into public.capsules (...) values (...);
--
-- in one READ COMMITTED transaction with no lock, so N concurrent calls from
-- the same free-tier user all see the pre-burst count and all insert past
-- the cap of 3.
--
-- COORDINATION NOTE: 20260802120000_security_authz_fixes.sql (owned by a
-- different agent, adding a p_group_id membership check) also re-creates
-- this same function and had not been written yet as of this migration.
-- Re-creating create_capsule_with_owner here too would race that migration:
-- whichever of the two migrations applies second silently wins and discards
-- the other's changes, since `create or replace` fully replaces the function
-- body rather than merging it. Rather than guess at the post-p_group_id body
-- and risk clobbering that fix, this is left as an explicit instruction to
-- merge by hand into whichever migration ends up owning the function:
--
--   Immediately after the existing null check:
--
--     if v_uid is null then
--       raise exception 'Not authenticated';
--     end if;
--
--   add exactly one line, before the free-tier cap SELECT/COUNT:
--
--     -- F19: serialize concurrent creates by the same user so the free-tier
--     -- cap count below can't race. Auto-released at transaction end.
--     perform pg_advisory_xact_lock(hashtextextended('create_capsule_with_owner:' || v_uid::text, 0));
--
--   Everything else in the function — the cap comparison, the two inserts,
--   the p_group_id parameter, the return value — is unaffected by this
--   change; it only adds the lock line.
--
-- ⚠️ Whoever merges this: verify no other in-flight migration in this batch
-- also touches create_capsule_with_owner before applying, for the same
-- clobber reason described above.
