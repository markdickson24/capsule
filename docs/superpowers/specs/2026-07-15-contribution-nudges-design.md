# Contribution Nudges — Design Spec

**Date:** 2026-07-15
**Branch:** `feat/contribution-nudges`
**Status:** Approved, ready for implementation plan

## Context

This is phase 1 of a broader "keep users coming back" retention-notifications effort, scoped down from three independent subsystems during brainstorming:

1. **Contribution nudges** (this spec) — capsule-scoped, no new user-activity tracking needed.
2. Milestone / anticipation notifications (X photos added, unlock countdown milestones, "on this day") — deferred, own spec later.
3. Dormant-user win-back pushes — deferred, needs new `last_active_at`-style infra, own spec later.

Two notification types already exist in the `notifications.type` check constraint but have never been wired to anything: `contribution_nudge` and `milestone`. This spec activates `contribution_nudge` and adds one new type, `contribution_activity`.

## Goals

- When a member uploads photos/videos to a capsule, other joined members get a batched "Sarah added 3 photos to Family Reunion" push — social proof that nudges them to open the app.
- As a capsule's contribution deadline approaches, members who haven't contributed anything yet get reminded at three tiers (7 days / 3 days / 1 day out), including a comparison against the capsule's current top contributor when one exists.

## Non-goals (deferred to later phases)

- Dormant-user re-engagement pushes.
- Milestone/celebration notifications (photo-count milestones, "on this day", streaks).
- Any user-facing notification-frequency preferences/mute controls.

## Data model changes

```sql
-- notifications: extend type enum + one generic reusable column
alter table public.notifications
  add column count int; -- nullable

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    -- verbatim copy of the current constraint on origin/main
    -- (20260710010000_group_capsule_notifications.sql) plus the one addition:
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'contribution_activity'
  ]));

-- capsule_members: per-member, per-tier nudge dedupe stamps
-- (mirrors capsules.unlock_reminder_{1d,1h,10m}_sent_at)
alter table public.capsule_members
  add column contribution_nudge_7d_sent_at timestamptz,
  add column contribution_nudge_3d_sent_at timestamptz,
  add column contribution_nudge_1d_sent_at timestamptz;

-- new staging table for debounced activity batching
create table public.contribution_activity_pending (
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  uploader_id uuid not null references public.users(id) on delete cascade,
  photo_count int not null default 0,
  last_upload_at timestamptz not null default now(),
  primary key (capsule_id, uploader_id)
);
alter table public.contribution_activity_pending enable row level security;
-- No policies added — deny-all to clients. Only touched by the
-- SECURITY DEFINER trigger below and the cron's service-role key.
```

> **Before applying this migration:** re-verify the current `notifications_type_check` definition against the live production DB (`pg_get_constraintdef`), not just the migration history above — CLAUDE.md documents multiple cases where the live DB drifted from committed migrations (RLS policies, helper functions). If they've diverged, the live definition wins and the migration's `array[...]` list must be reconciled to match it before adding `contribution_activity`.

`notifications.count` is deliberately generic, not `contribution_activity_photo_count` — both new usages share it via a consistent meaning: **"`actor_id` contributed `count` photos to `capsule_id`."**
- `contribution_activity`: `actor_id` = the uploader who just contributed, `count` = photos in that debounced batch.
- `contribution_nudge`: `actor_id` = the capsule's current top contributor (nullable if nobody has uploaded yet), `count` = their running photo total (nullable together with `actor_id`).

The existing `users` column-level SELECT grant restrictions (email/phone/push_token) are untouched by this change — no new columns are added to `users`.

## Mechanism 1: Contribution activity ping (social proof)

**Trigger** — `AFTER INSERT ON media FOR EACH ROW`, `SECURITY DEFINER` (same style as `notify_on_reaction`). Upserts the staging row, incrementing the running count and bumping the debounce clock on every insert:

```sql
insert into contribution_activity_pending (capsule_id, uploader_id, photo_count, last_upload_at)
values (new.capsule_id, new.uploader_id, 1, now())
on conflict (capsule_id, uploader_id) do update
  set photo_count = contribution_activity_pending.photo_count + 1,
      last_upload_at = now();
```

Fires for every upload path that inserts into `media` — camera, library picker, share intent, dual-camera main + alt — since they all converge on the same table.

**New edge function + cron: `dispatch-contribution-activity`**, `* * * * *`, `EXISTS`-gated on `contribution_activity_pending` rows where `last_upload_at <= now() - interval '2 minutes'` (the debounce window):

1. Atomically claims due rows: `delete from contribution_activity_pending where last_upload_at <= now() - interval '2 minutes' returning *`. A row can only be claimed once.
2. For each claimed row: looks up joined members of that capsule excluding the uploader, **and** excluding any recipient who has blocked the uploader (`not exists (select 1 from blocked_users where blocker_id = recipient and blocked_id = uploader_id)`).
3. Inserts one `contribution_activity` notification per recipient (`actor_id` = uploader, `count` = `photo_count`, `capsule_id` set, `pushed_at` set inline since this function pushes immediately — no separate dispatcher sweep, mirroring `unlock-capsules`' self-contained structure rather than delegating to `send-superlative-pushes`).
4. Sends the Expo push (chunked ≤100 via a locally duplicated `sendExpoPush` helper, following the existing convention already used by `create-group-capsules`): *"Sarah added 3 photos to Family Reunion"* (singular "photo" when `count === 1`).

**Debounce behavior:** uploading 10 photos in one sitting produces exactly one push (the staging row absorbs every insert until 2 minutes of silence). Uploading again 5 minutes later produces a second, independent push, since the first pending row was already claimed and deleted.

**Surprise mode:** this ping only ever conveys a name + count, never photo content — consistent with the existing `mediaCount` "N memories waiting" display already permitted under `owner_preview_locked`. No special-casing needed.

## Mechanism 2: Contribution deadline nudge (7d / 3d / 1d)

**Effective deadline** = `coalesce(contribution_lock_at, case when unlock_mode in ('time','both') then unlock_at end)`. This is `null` for a `proximity`-only capsule with no explicit `contribution_lock_at` — which naturally excludes it from nudging, since `unlock_at` is an unused placeholder value on those capsules (see `CountdownBadge`'s existing handling of the same trap).

**New edge function + cron: `contribution-nudges`**, `* * * * *`, `EXISTS`-gated on: an active capsule with an effective deadline within the next 7 days that has at least one joined owner/contributor member with zero uploads and an unstamped tier for that window.

For each tier (7d, then 3d, then 1d, evaluated in that order each tick), one atomic claim-and-stamp per eligible `(capsule, member)` pair:

```sql
update capsule_members cm
set contribution_nudge_7d_sent_at = now() -- (or _3d / _1d depending on tier)
from capsules c
where cm.capsule_id = c.id
  and cm.joined_at is not null
  and cm.role in ('owner', 'contributor')
  and cm.contribution_nudge_7d_sent_at is null -- (matching tier column)
  and c.status = 'active'
  and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time','both') then c.unlock_at end) is not null
  and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time','both') then c.unlock_at end)
  and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time','both') then c.unlock_at end) <= now() + interval '7 days' -- (3/1 for later tiers)
  and not exists (select 1 from media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
returning cm.user_id, cm.capsule_id, c.title;
```

For each claimed row, a follow-up query finds the capsule's current top contributor **for that specific recipient** — `media` grouped by `uploader_id`, excluding any uploader the recipient has blocked (anti-join on `blocked_users` where `blocker_id` = recipient), ordered by count desc, limit 1. `null` if nobody eligible has uploaded yet. Computed per-recipient (not once per capsule) so a recipient never sees a comparison against someone they've blocked — this mirrors mechanism 1's blocked-uploader exclusion, applied here to keep the two mechanisms consistent.

**Push copy:**
- With a top contributor: *"Sarah added 5 photos to Family Reunion — you haven't added any yet. Locks in 3 days."*
- With none yet: *"Nobody's added photos to Family Reunion yet — don't be the one holding it up! Locks in 3 days."*

Notification row: `type = 'contribution_nudge'`, `actor_id` = top contributor (nullable), `count` = their photo total (nullable together), `capsule_id` set, `pushed_at` set inline (same self-contained, non-delegated push pattern as mechanism 1).

**Auth for both new crons:** `CRON_SECRET` env var compared directly (the `unlock-capsules`/`send-superlative-pushes` style, not the Vault-RPC style used by `create-group-capsules`) — both styles already coexist in this codebase; picking the simpler env-var style here since these two functions don't need the Vault indirection for any other reason.

## Client-side rendering (`NotificationsScreen.tsx`)

Two new cases added to the existing type-branching logic, following established patterns:

- **`contribution_activity`** — icon `images-outline`, tap → `CapsuleDetail`. Copy from the embedded `actor:users!notifications_actor_id_fkey(display_name)` + `count`: *"Sarah added 3 photos to your capsule."* Included in the existing "Mark all read" bulk-clear (non-actionable, like reactions/unlocks).
- **`contribution_nudge`** — icon `alarm-outline` (reusing the reminder look already established for `unlock_reminder`), tap → `CapsuleDetail`. Copy mirrors the push body. Also bulk-clearable.

Push tap routing needs no client changes — the existing native handler already routes any `data.capsuleId` to `CapsuleDetail`.

`database.ts`'s `NotificationType` union gains `'contribution_activity'` (`'contribution_nudge'` already exists there, unused until now).

## Error handling / idempotency

- Both new functions reuse the exact idempotency shape already proven by `unlock-capsules`' `dispatchReminders`: an atomic `UPDATE ... WHERE <not-yet-sent> RETURNING` (nudge tiers) or `DELETE ... RETURNING` (activity claim) means an overlapping cron tick can't double-send — it simply matches zero rows on the second pass.
- Both crons are `EXISTS`-gated the same way as the other four crons in this codebase, so they cost nothing when idle (PERFORMANCE.md #4 pattern).
- Push sends are chunked ≤100 (shared convention across all four existing push-senders) and wrapped so a partial Expo failure doesn't block the DB-row insert that already happened — the in-app notification stays durable even if the push itself fails.
- If a function fails mid-run after claiming some rows but before finishing others, the claimed rows are already stamped/deleted and won't be retried that tick — same accepted behavior as the existing unlock reminders.

## Testing

No test framework beyond the existing plain `node:assert/strict` + `tsx` pattern (`src/lib/recurrence.test.ts`). This spec adds a similar script covering the pure logic pieces:
- Effective-deadline calculation (all `unlock_mode` × nullable-`contribution_lock_at` combinations, including the proximity-with-no-lock exclusion case).
- Tier-window boundary math (a deadline exactly at a tier edge, a deadline that skips a tier because the capsule was created late).

Runtime verification (per the `verify` skill, since this is a real data-flow with no unit-testable runtime surface otherwise):
- Apply the migration to a Supabase dev branch; manually insert/backdate test rows and invoke both new edge functions directly via `mcp__supabase__execute_sql` / direct function invocation before registering the crons, to exercise the SQL and push logic without waiting on real time to pass.
- Drive one full cycle in the running app: upload photos as one test account, confirm the activity ping arrives for a second test account after ~2 minutes; set a test capsule's `contribution_lock_at` into one of the tier windows and confirm the nudge fires for a non-contributing member.

## Decisions log (from brainstorming)

| Question | Decision |
|---|---|
| Scope | Mix of dormant-user, contribution-nudge, and milestone notifications requested; decomposed into 3 phases. This spec = phase 1 only. |
| Who sees "[name] added N photos" | Both: a social-proof ping to other members on every contribution, AND a comparison baked into the deadline reminder. |
| Activity ping batching | Batch per session — debounce ~2 min after a member's uploads settle, one notification per burst. |
| Deadline source when `contribution_lock_at` is null | Fall back to `unlock_at` — except proximity-only capsules, where `unlock_at` is a meaningless placeholder, so those are skipped unless `contribution_lock_at` is explicitly set. |
| Reminder tiers | Three: 7 days / 3 days / 1 day before the effective deadline. |
| Reminder audience | Joined owner/contributor members with zero uploads so far (viewers can't upload, so they're excluded). |
| Architecture | Approach A — fully server-side DB trigger + staging table + two new self-contained per-minute cron edge functions, each doing claim + DB insert + push in one tick (mirrors `unlock-capsules`' existing structure), rather than a client-driven ping (Approach B, rejected — not robust to app kill) or piggybacking on existing crons (Approach C, rejected — couples unrelated domains). |
| Branch | New branch `feat/contribution-nudges`, created from `origin/main` (not from the in-progress `feat/groups-recurrence-revamp`, which has unrelated uncommitted WIP). |

## Implementation orchestration note

Per user instruction: implementation should use an Opus 4.8 orchestrator with Sonnet subagents reporting back to it. This is an execution-plan detail, not part of the design itself — to be reflected in the plan produced by `writing-plans` / carried out via `executing-plans` or `subagent-driven-development`.
