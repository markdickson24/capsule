-- Security scan (2026-08-01/02) — server-side DATA-INTEGRITY backstops.
-- Scope is deliberately narrow: CHECK constraints + the backfills required to
-- add them safely. No GRANT/REVOKE, no policy changes, no trigger/function
-- rewrites — those live in sibling migrations
-- (20260802120000_security_authz_fixes.sql,
--  20260802120100_security_hardening.sql,
--  20260802120300_invite_push_dedupe.sql) owned by other agents.
--
-- Findings backed by this migration:
--   F11 — capsules.title has no server-side length cap. The 100-char limit
--         is enforced ONLY client-side (CreateScreen.tsx / EditCapsuleScreen.tsx)
--         and create_capsule_with_owner inserts p_title unvalidated. A caller
--         hitting the RPC directly through PostgREST can store a
--         multi-megabyte title, which is quadratic-CPU fuel for the public
--         invite-image edge function's SVG/rasterizer text-layout pass.
--   F2  — users.display_name is likewise unbounded (defense-in-depth: it is
--         rendered into an SVG text run handed to a WASM rasteriser in the
--         same public edge function). App cap is 30 chars
--         (OnboardingScreen.tsx).
--   F7 / F10 — groups' per-recurrence anchor CHECK constraints
--         (20260713010000_groups_recurrence_revamp.sql) are of the form
--         `check (recurrence_interval <> 'weekly' or anchor_weekday between 0 and 6)`.
--         When the relevant anchor column is NULL, that expression evaluates
--         to `false OR NULL` = NULL, which Postgres treats as satisfied (a
--         CHECK only rejects an explicit FALSE). So a group creator can PATCH
--         a non-manual group's anchor sub-field to NULL without ever touching
--         recurrence_interval, so guard_group_recurrence never fires. A null
--         anchor then crashes computeNextOccurrence() client-side
--         (ManageGroupScreen / GroupDetailScreen's upcoming-occurrences
--         preview) and wedges the create-group-capsules cron, which
--         duplicates the same anchor math and has no null-guard either.
--
-- ⚠️ SAFETY: pre-existing rows may already violate the constraints being
-- added here. CLAUDE.md documents that the original recurrence-revamp
-- backfill (20260713010000) only populated anchors for groups whose
-- next_capsule_at was non-null at the time — so pre-existing non-manual
-- groups that had a null next_capsule_at back then STILL CARRY NULL ANCHOR
-- COLUMNS in production today. Likewise nothing has ever enforced the title/
-- display_name length caps server-side, so rows longer than the client cap
-- may already exist. Every constraint below is preceded by an idempotent
-- repair of any violating rows in this same migration, so this migration
-- cannot fail on, or destroy, existing data:
--   - text fields are TRUNCATED to the new limit (never deleted)
--   - anchor fields are BACKFILLED with the same UTC-derived "default to now"
--     values the client already uses when an anchor sub-field is missing
--     (CreateGroupScreen.defaultAnchor() / ManageGroupScreen.load()) — see
--     the per-constraint comments below for the exact field mapping.
--
-- All backfill UPDATEs and all constraint ADDs are idempotent / safe to
-- re-run: the UPDATEs are qualified by the same violating-condition the
-- constraint checks, and `add constraint` is preceded by `drop constraint if
-- exists` under the constraint's existing name (or, for the two brand-new
-- constraints, guarded by a catalog check) so re-applying this file is a
-- no-op once it has succeeded.

-- =====================================================================
-- 1. capsules.title length cap (F11)
-- =====================================================================

-- Repair: truncate any pre-existing title longer than the app's own cap.
-- Truncation preserves the row (and every other column); it never deletes a
-- capsule. 100 chars matches CreateScreen.tsx/EditCapsuleScreen.tsx's own
-- validation (`title.trim().length > 100`), so this cannot affect any title
-- a client ever legitimately produced — only rows written by bypassing the
-- client (direct RPC/PostgREST calls, i.e. exactly the F11 attack shape, or
-- stale pre-validation data) can be non-empty past 100 chars.
update public.capsules
set title = left(title, 100)
where char_length(title) > 100;

-- Constraint: added NOT VALID first, then validated in a separate statement.
-- `capsules` is read on effectively every screen (Home list, CapsuleDetail,
-- notifications joins) and can grow large over the app's lifetime, so we
-- avoid holding the full-table-scan ACCESS EXCLUSIVE lock that an
-- immediately-validated ADD CONSTRAINT would take. NOT VALID only takes a
-- brief ACCESS EXCLUSIVE lock to add the catalog entry (no scan); the
-- immediately-following VALIDATE CONSTRAINT takes just SHARE UPDATE
-- EXCLUSIVE, which does not block normal reads/writes while it scans. New
-- rows are checked against the constraint from the moment it's added (NOT
-- VALID only exempts pre-existing rows from the validation scan, it does not
-- weaken enforcement going forward) — and the repair UPDATE above already
-- ran, so the VALIDATE pass is expected to find zero violations regardless.
alter table public.capsules drop constraint if exists capsules_title_length_check;
alter table public.capsules
  add constraint capsules_title_length_check
    check (char_length(title) <= 100) not valid;
alter table public.capsules
  validate constraint capsules_title_length_check;

-- =====================================================================
-- 2. users.display_name length cap (F2 defense-in-depth)
-- =====================================================================

-- Repair: truncate any pre-existing display_name longer than the app's own
-- cap (30 chars, OnboardingScreen.tsx: `displayName.trim().length > 30`).
-- display_name is `not null` with no default that could ever legitimately
-- exceed 30 chars from the client, so — same reasoning as title above — a
-- violation here only exists from the handle_new_user() email-local-part
-- fallback (bounded by a valid email's local-part length, essentially never
-- 30+ chars in practice, but not provably so) or a pre-validation direct
-- write. Truncating preserves the row; the user's name is still resolvable
-- via their auth session and can be re-saved through the normal Edit Profile
-- flow if ever truncated.
update public.users
set display_name = left(display_name, 30)
where char_length(display_name) > 30;

-- Constraint: same NOT VALID + VALIDATE CONSTRAINT reasoning as capsules.title
-- above — `users` is read on effectively every authenticated screen (RLS
-- `USING (true)` SELECT policy, so it's the single most globally-read table
-- in the schema) and deserves the same non-blocking validation path.
alter table public.users drop constraint if exists users_display_name_length_check;
alter table public.users
  add constraint users_display_name_length_check
    check (char_length(display_name) <= 30) not valid;
alter table public.users
  validate constraint users_display_name_length_check;

-- =====================================================================
-- 3. users.avatar_url generous length bound (optional hardening)
-- =====================================================================
-- Explicitly NOT a host allowlist — that's out of scope here (rejected per
-- task brief: OAuth providers like Google/Apple can legitimately serve
-- avatar URLs from other hosts, and host validation belongs in the edge
-- function with a graceful fallback, owned by another agent). This is a
-- pure length bound: 2048 chars is the de facto safe maximum URL length
-- supported uniformly by browsers/HTTP infrastructure, and every legitimate
-- avatar URL in this app is far shorter — Supabase Storage public URLs
-- (`${userId}/avatar.jpg`, upsert:true) and typical Google/Apple OAuth
-- profile-photo URLs (including their size-parameter query strings) are
-- well under 500 chars. This closes off pathological/malicious values (e.g.
-- something feeding a URL-handling code path a multi-KB string) without any
-- risk of rejecting a real provider URL.
update public.users
set avatar_url = left(avatar_url, 2048)
where avatar_url is not null and char_length(avatar_url) > 2048;

alter table public.users drop constraint if exists users_avatar_url_length_check;
alter table public.users
  add constraint users_avatar_url_length_check
    check (avatar_url is null or char_length(avatar_url) <= 2048) not valid;
alter table public.users
  validate constraint users_avatar_url_length_check;

-- =====================================================================
-- 4. groups: NULL-rejecting recurrence anchor constraints (F7 / F10)
-- =====================================================================
--
-- Backfill first. Mirrors the client's own "default missing anchor
-- sub-fields to today, in UTC" behavior exactly
-- (CreateGroupScreen.defaultAnchor() / ManageGroupScreen.load(), both of
-- which read now.getUTCDay()/getUTCDate()/getUTCMonth()/getUTCHours()/
-- getUTCMinutes()) so a backfilled anchor is consistent with what the app
-- would have written had the field never gone null. CLAUDE.md is explicit
-- that all anchor math in this codebase (src/lib/recurrence.ts and the
-- create-group-capsules cron's duplicate) is UTC-only on both sides — never
-- a local accessor — so the backfill below uses `now() at time zone 'utc'`
-- (converts the timestamptz `now()` to a UTC wall-clock timestamp) rather
-- than a bare `extract(... from now())`, which would silently pick up the
-- session's TimeZone GUC instead. Postgres's `extract(dow from ...)` is
-- 0=Sunday..6=Saturday, matching JS `getUTCDay()` exactly; `extract(day/
-- month/hour/minute from ...)` likewise line up with `getUTCDate()`/
-- `getUTCMonth()+1`/`getUTCHours()`/`getUTCMinutes()`.
--
-- This does NOT change any group's actual next-fire time: next_capsule_at is
-- a separately-stored column that the cron/UI already use directly, and is
-- left untouched here. It only ensures the anchor *sub-fields* are non-null
-- and in-range so (a) computeNextOccurrence() never crashes on a null field
-- and (b) the tightened constraints below can be added without rejecting
-- these rows. A backfilled anchor is a reasonable synthetic default — the
-- same kind of default the client already silently applies today whenever
-- it encounters a missing sub-field on a group started under an older
-- recurrence_interval (per CLAUDE.md: "every pre-existing group only has the
-- anchor sub-field for its *original* recurrence_interval populated").

-- weekly: anchor_weekday
update public.groups
set anchor_weekday = extract(dow from (now() at time zone 'utc'))::smallint
where recurrence_interval = 'weekly' and anchor_weekday is null;

-- monthly: anchor_day_of_month
update public.groups
set anchor_day_of_month = extract(day from (now() at time zone 'utc'))::smallint
where recurrence_interval = 'monthly' and anchor_day_of_month is null;

-- yearly: anchor_month, anchor_day (independently nullable, so guard each)
update public.groups
set anchor_month = extract(month from (now() at time zone 'utc'))::smallint
where recurrence_interval = 'yearly' and anchor_month is null;

update public.groups
set anchor_day = extract(day from (now() at time zone 'utc'))::smallint
where recurrence_interval = 'yearly' and anchor_day is null;

-- any non-manual recurrence needs a time-of-day: anchor_hour, anchor_minute
update public.groups
set anchor_hour = extract(hour from (now() at time zone 'utc'))::smallint
where recurrence_interval <> 'manual' and anchor_hour is null;

update public.groups
set anchor_minute = extract(minute from (now() at time zone 'utc'))::smallint
where recurrence_interval <> 'manual' and anchor_minute is null;

-- Replace the four original (null-tolerant) checks from
-- 20260713010000_groups_recurrence_revamp.sql with NULL-rejecting
-- equivalents, under the SAME constraint names (drop + re-add) so there is
-- exactly one constraint per anchor concern, not a duplicate. The `groups`
-- table is small (one row per named member set, not per capsule/member), so
-- unlike capsules/users above there is no meaningful lock-duration concern —
-- still added NOT VALID + VALIDATE for consistency and to keep this
-- migration's lock footprint uniformly minimal, at negligible extra cost.
alter table public.groups drop constraint if exists groups_anchor_weekday_check;
alter table public.groups
  add constraint groups_anchor_weekday_check
    check (
      recurrence_interval <> 'weekly'
      or (anchor_weekday is not null and anchor_weekday between 0 and 6)
    ) not valid;

alter table public.groups drop constraint if exists groups_anchor_day_of_month_check;
alter table public.groups
  add constraint groups_anchor_day_of_month_check
    check (
      recurrence_interval <> 'monthly'
      or (anchor_day_of_month is not null and anchor_day_of_month between 1 and 31)
    ) not valid;

alter table public.groups drop constraint if exists groups_anchor_yearly_check;
alter table public.groups
  add constraint groups_anchor_yearly_check
    check (
      recurrence_interval <> 'yearly'
      or (
        anchor_month is not null and anchor_day is not null
        and anchor_month between 1 and 12 and anchor_day between 1 and 31
      )
    ) not valid;

alter table public.groups drop constraint if exists groups_anchor_time_check;
alter table public.groups
  add constraint groups_anchor_time_check
    check (
      recurrence_interval = 'manual'
      or (
        anchor_hour is not null and anchor_minute is not null
        and anchor_hour between 0 and 23 and anchor_minute between 0 and 59
      )
    ) not valid;

alter table public.groups validate constraint groups_anchor_weekday_check;
alter table public.groups validate constraint groups_anchor_day_of_month_check;
alter table public.groups validate constraint groups_anchor_yearly_check;
alter table public.groups validate constraint groups_anchor_time_check;

-- groups_reminder_lead_hours_check (`reminder_lead_hours is null or ...
-- between 1 and 720`) is intentionally left untouched: reminder_lead_hours
-- is a genuinely optional field (null = reminders off) with no
-- recurrence-interval-gated "must be set" requirement, so its existing
-- null-tolerant form is already correct and is not part of F7/F10.
