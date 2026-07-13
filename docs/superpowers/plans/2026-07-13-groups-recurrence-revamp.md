# Groups Recurrence Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixed calendar anchors, pause/resume, an upcoming-schedule preview, and an advance reminder to recurring Groups, per `docs/superpowers/specs/2026-07-13-groups-recurrence-revamp-design.md`.

**Architecture:** A pure scheduling module (`src/lib/recurrence.ts`) computes next/upcoming occurrences from an anchor (weekday / day-of-month / month+day, plus a fixed time-of-day); it's duplicated verbatim into the `create-group-capsules` edge function (Deno can't import `src/lib`, same precedent as `awardPool.ts`). New `groups` columns store the anchor, a pause flag, and reminder configuration; `next_capsule_at` stays the single value the cron's claim query reads.

**Tech Stack:** React Native + Expo, TypeScript, Supabase (Postgres + Deno edge functions).

## Global Constraints

- No test suite or linter is configured in this repo. Pure-logic verification in this plan runs via `npx tsx <file>.ts` (plain `node:assert/strict` assertions, no framework) — do not add Jest or any other test runner as part of this work.
- Schema migrations are added as SQL files under `supabase/migrations/`. Applying a migration to the remote project (`mcp__supabase__apply_migration` or equivalent) is a production-database action — pause and get explicit user confirmation before running it, per this project's standing DB-safety practice.
- Edge functions (Deno) cannot import from `src/lib` — shared logic needed server-side is duplicated verbatim, not imported (established precedent: `awardPool.ts` in `create-group-capsules`).
- Dark theme tokens for any new UI: background `#0A0A0A`, surface `#1A1A1A`, border `#2A2A2A`, text primary `#FFFFFF`, text secondary `#888888`, text muted `#555555` (decorative only — never for content the user must read). Accent color always via `useTheme().accentColor`, never hardcoded.
- Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`.
- Any user-initiated mutation that fails must call `toast.show(...)` (`src/lib/toast.ts`).
- New tactile feedback goes through `src/lib/haptics.ts`, never `expo-haptics` directly.

---

### Task 1: Database migration — anchor, pause, and reminder columns

**Files:**
- Create: `supabase/migrations/20260713010000_groups_recurrence_revamp.sql`

**Interfaces:**
- Produces: new `groups` columns (`anchor_weekday`, `anchor_day_of_month`, `anchor_month`, `anchor_day`, `anchor_hour`, `anchor_minute`, `recurrence_paused_at`, `reminder_lead_hours`, `next_reminder_sent_at`) and new `notifications` columns (`group_id`), plus `'group_capsule_upcoming'` added to `notifications_type_check`. All later tasks read/write these columns by these exact names.

- [ ] **Step 1: Write the migration file**

```sql
-- Groups recurrence revamp: fixed calendar anchors, pause/resume, and an
-- advance reminder before a recurring group's next capsule is auto-created.
-- See docs/superpowers/specs/2026-07-13-groups-recurrence-revamp-design.md.

alter table public.groups
  add column anchor_weekday smallint,
  add column anchor_day_of_month smallint,
  add column anchor_month smallint,
  add column anchor_day smallint,
  add column anchor_hour smallint,
  add column anchor_minute smallint,
  add column recurrence_paused_at timestamptz,
  add column reminder_lead_hours smallint,
  add column next_reminder_sent_at timestamptz;

-- Backfill every existing group's anchor from its CURRENT next_capsule_at,
-- so no group's actual next-fire date changes as a result of this migration
-- — only new metadata is added.
update public.groups set
  anchor_weekday = extract(dow from next_capsule_at)::smallint,
  anchor_hour = extract(hour from next_capsule_at)::smallint,
  anchor_minute = extract(minute from next_capsule_at)::smallint
where recurrence_interval = 'weekly' and next_capsule_at is not null;

update public.groups set
  anchor_day_of_month = extract(day from next_capsule_at)::smallint,
  anchor_hour = extract(hour from next_capsule_at)::smallint,
  anchor_minute = extract(minute from next_capsule_at)::smallint
where recurrence_interval = 'monthly' and next_capsule_at is not null;

update public.groups set
  anchor_month = extract(month from next_capsule_at)::smallint,
  anchor_day = extract(day from next_capsule_at)::smallint,
  anchor_hour = extract(hour from next_capsule_at)::smallint,
  anchor_minute = extract(minute from next_capsule_at)::smallint
where recurrence_interval = 'yearly' and next_capsule_at is not null;

update public.groups set reminder_lead_hours = 24
where recurrence_interval <> 'manual';

-- Constraints added AFTER backfill so they validate real (now-populated)
-- data rather than rejecting pre-existing rows against nulls.
alter table public.groups
  add constraint groups_anchor_weekday_check
    check (recurrence_interval <> 'weekly' or anchor_weekday between 0 and 6),
  add constraint groups_anchor_day_of_month_check
    check (recurrence_interval <> 'monthly' or anchor_day_of_month between 1 and 31),
  add constraint groups_anchor_yearly_check
    check (recurrence_interval <> 'yearly' or (anchor_month between 1 and 12 and anchor_day between 1 and 31)),
  add constraint groups_anchor_time_check
    check (recurrence_interval = 'manual' or (anchor_hour between 0 and 23 and anchor_minute between 0 and 59)),
  add constraint groups_reminder_lead_hours_check
    check (reminder_lead_hours is null or reminder_lead_hours between 1 and 720);

-- notifications: group_id (nullable — populated only for
-- group_capsule_upcoming, which has no capsule yet) and the new type.
alter table public.notifications
  add column group_id uuid references public.groups(id) on delete cascade;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'group_capsule_upcoming'
  ]));
```

- [ ] **Step 2: Confirm with the user, then apply the migration to the remote project**

This writes to the production database — do not run it without the user explicitly confirming. Once confirmed, apply it (e.g. via `mcp__supabase__apply_migration` with the SQL above, or the user's own `supabase db push`).

- [ ] **Step 3: Verify**

Run a read-only query against the remote project (e.g. via `mcp__supabase__execute_sql`):

```sql
select recurrence_interval, next_capsule_at, anchor_weekday, anchor_day_of_month,
       anchor_month, anchor_day, anchor_hour, anchor_minute, reminder_lead_hours,
       recurrence_paused_at
from public.groups
limit 20;
```

Expected: every `weekly` row has `anchor_weekday`/`anchor_hour`/`anchor_minute` populated; every `monthly` row has `anchor_day_of_month`/`anchor_hour`/`anchor_minute` populated; every `yearly` row has `anchor_month`/`anchor_day`/`anchor_hour`/`anchor_minute` populated; every non-`manual` row has `reminder_lead_hours = 24`; `recurrence_paused_at` is `null` everywhere; and every row's `next_capsule_at` is unchanged from before the migration (spot-check against the value you saw before Step 2, if you captured it).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260713010000_groups_recurrence_revamp.sql
git commit -m "$(cat <<'EOF'
Add anchor, pause, and reminder columns to groups

Backfills anchor fields from each existing group's current
next_capsule_at so no group's schedule changes as a result of this
migration — only new metadata is added.
EOF
)"
```

---

### Task 2: Recurrence scheduling engine (`src/lib/recurrence.ts`)

**Files:**
- Create: `src/lib/recurrence.ts`
- Test: `src/lib/recurrence.test.ts`

**Interfaces:**
- Produces: `RecurrenceInterval` (`'weekly' | 'monthly' | 'yearly' | 'manual'`), `RecurrenceAnchor` (`{ weekday?: number; dayOfMonth?: number; month?: number; day?: number; hour: number; minute: number }`), `computeNextOccurrence(interval, anchor, from): Date | null`, `computeUpcomingOccurrences(interval, anchor, from, count): Date[]`. Task 3, 6, 7, 8 all import these by these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/lib/recurrence.test.ts`:

```ts
import assert from 'node:assert/strict';
import { computeNextOccurrence, computeUpcomingOccurrences, RecurrenceAnchor } from './recurrence';

// Weekly: from a Wednesday, anchor Sunday 09:00 -> the coming Sunday
{
  const from = new Date(2026, 6, 15, 14, 0); // Wed Jul 15 2026, 2:00pm
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getDay(), 0);
  assert.equal(next!.getDate(), 19); // Sunday Jul 19 2026
  assert.equal(next!.getHours(), 9);
}

// Weekly: `from` is the anchor weekday but before the anchor time -> same day
{
  const from = new Date(2026, 6, 19, 3, 0); // Sun Jul 19 2026, 3:00am
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getDate(), 19);
  assert.equal(next!.getHours(), 9);
}

// Weekly: `from` is the anchor weekday but after the anchor time -> next week
{
  const from = new Date(2026, 6, 19, 15, 0); // Sun Jul 19 2026, 3:00pm
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getDate(), 26); // next Sunday, Jul 26 2026
}

// Monthly: anchor day 31 in April clamps to Apr 30
{
  const from = new Date(2026, 3, 1, 0, 0); // Apr 1 2026
  const anchor: RecurrenceAnchor = { dayOfMonth: 31, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getMonth(), 3); // April (0-indexed)
  assert.equal(next!.getDate(), 30);
}

// Monthly: the cycle after a clamped April occurrence correctly lands on
// May 31 (the clamp doesn't stick to 30 forever)
{
  const from = new Date(2026, 3, 30, 9, 0); // the clamped Apr 30 2026 occurrence itself
  const anchor: RecurrenceAnchor = { dayOfMonth: 31, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getMonth(), 4); // May
  assert.equal(next!.getDate(), 31);
}

// Yearly: Feb 29 anchor clamps to Feb 28 in a non-leap year (2027)
{
  const from = new Date(2027, 0, 1); // Jan 1 2027
  const anchor: RecurrenceAnchor = { month: 2, day: 29, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getFullYear(), 2027);
  assert.equal(next!.getMonth(), 1); // February
  assert.equal(next!.getDate(), 28);
}

// Yearly: Feb 29 anchor uses the real Feb 29 in the next leap year (2028)
{
  const from = new Date(2027, 11, 1); // Dec 1 2027
  const anchor: RecurrenceAnchor = { month: 2, day: 29, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getFullYear(), 2028);
  assert.equal(next!.getDate(), 29);
}

// Manual returns null
{
  const next = computeNextOccurrence('manual', { hour: 9, minute: 0 }, new Date());
  assert.equal(next, null);
}

// computeUpcomingOccurrences returns `count` strictly-increasing dates, one
// week apart for a weekly anchor
{
  const from = new Date(2026, 0, 1);
  const anchor: RecurrenceAnchor = { weekday: 1, hour: 9, minute: 0 }; // Monday
  const upcoming = computeUpcomingOccurrences('weekly', anchor, from, 3);
  assert.equal(upcoming.length, 3);
  assert.ok(upcoming[0] < upcoming[1]);
  assert.ok(upcoming[1] < upcoming[2]);
  const diffDays = (upcoming[1].getTime() - upcoming[0].getTime()) / 86_400_000;
  assert.equal(diffDays, 7);
}

// computeUpcomingOccurrences returns [] for manual
{
  assert.deepEqual(computeUpcomingOccurrences('manual', { hour: 9, minute: 0 }, new Date(), 3), []);
}

console.log('recurrence.test.ts: all assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx src/lib/recurrence.test.ts`
Expected: FAIL — `Cannot find module './recurrence'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/recurrence.ts`:

```ts
export type RecurrenceInterval = 'weekly' | 'monthly' | 'yearly' | 'manual';

export interface RecurrenceAnchor {
  weekday?: number;    // 0 (Sun) - 6 (Sat) — required for 'weekly'
  dayOfMonth?: number; // 1-31 — required for 'monthly'
  month?: number;      // 1-12 — required for 'yearly'
  day?: number;        // 1-31 — required for 'yearly'
  hour: number;        // 0-23 — fixed time-of-day for every occurrence
  minute: number;      // 0-59
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

// Clamps `day` to the last valid day of the given month (e.g. day 31 in a
// 30-day month becomes that month's 30th) rather than overflowing into the
// next month.
function clampedDate(year: number, month1to12: number, day: number, hour: number, minute: number): Date {
  const clampedDay = Math.min(day, daysInMonth(year, month1to12));
  return new Date(year, month1to12 - 1, clampedDay, hour, minute, 0, 0);
}

export function computeNextOccurrence(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
): Date | null {
  if (interval === 'manual') return null;

  if (interval === 'weekly') {
    if (anchor.weekday === undefined) throw new Error('weekly recurrence requires anchor.weekday');
    const diffToWeekday = (anchor.weekday - from.getDay() + 7) % 7;
    const candidate = new Date(from);
    candidate.setDate(from.getDate() + diffToWeekday);
    candidate.setHours(anchor.hour, anchor.minute, 0, 0);
    if (candidate <= from) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  if (interval === 'monthly') {
    if (anchor.dayOfMonth === undefined) throw new Error('monthly recurrence requires anchor.dayOfMonth');
    let year = from.getFullYear();
    let month = from.getMonth() + 1; // 1-12
    let candidate = clampedDate(year, month, anchor.dayOfMonth, anchor.hour, anchor.minute);
    if (candidate <= from) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      candidate = clampedDate(year, month, anchor.dayOfMonth, anchor.hour, anchor.minute);
    }
    return candidate;
  }

  // yearly
  if (anchor.month === undefined || anchor.day === undefined) {
    throw new Error('yearly recurrence requires anchor.month and anchor.day');
  }
  const year = from.getFullYear();
  let candidate = clampedDate(year, anchor.month, anchor.day, anchor.hour, anchor.minute);
  if (candidate <= from) {
    candidate = clampedDate(year + 1, anchor.month, anchor.day, anchor.hour, anchor.minute);
  }
  return candidate;
}

export function computeUpcomingOccurrences(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
  count: number,
): Date[] {
  if (interval === 'manual') return [];
  const results: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = computeNextOccurrence(interval, anchor, cursor);
    if (!next) break;
    results.push(next);
    cursor = next;
  }
  return results;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx src/lib/recurrence.test.ts`
Expected: PASS — prints `recurrence.test.ts: all assertions passed` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recurrence.ts src/lib/recurrence.test.ts
git commit -m "$(cat <<'EOF'
Add pure recurrence scheduling engine

computeNextOccurrence/computeUpcomingOccurrences compute fixed-anchor
(weekday / day-of-month / month+day) schedules with calendar clamping
for short months and non-leap years.
EOF
)"
```

---

### Task 3: `src/lib/groups.ts` — anchor-aware create/update, pause/resume

**Files:**
- Modify: `src/lib/groups.ts`

**Interfaces:**
- Consumes: `computeNextOccurrence`, `RecurrenceAnchor`, `RecurrenceInterval` from `./recurrence` (Task 2).
- Produces: `GroupRow` (extended with `anchor_weekday`, `anchor_day_of_month`, `anchor_month`, `anchor_day`, `anchor_hour`, `anchor_minute`, `recurrence_paused_at: string | null`, `reminder_lead_hours: number | null`), `anchorFromGroup(group: GroupRow): RecurrenceAnchor`, `pauseGroupRecurrence(groupId): Promise<{error?}>`, `resumeGroupRecurrence(groupId): Promise<{error?}>`. `createGroup`'s params gain `anchor?: RecurrenceAnchor` and `reminderLeadHours: number | null`. `updateGroup`'s params gain `anchor?: RecurrenceAnchor` and `reminderLeadHours?: number | null`. These exact names are used by Task 6, 7, 8, 9.

- [ ] **Step 1: Replace the file's contents**

Replace the full contents of `src/lib/groups.ts` with:

```ts
import { supabase } from './supabase';
import { sessionStore } from './sessionStore';
import { randomUUID } from './uuid';
import { computeNextOccurrence, RecurrenceAnchor, RecurrenceInterval } from './recurrence';

export type GroupRecurrence = RecurrenceInterval;

const GROUP_COLUMNS =
  'id, name, created_by, recurrence_interval, unlock_duration_hours, next_capsule_at, last_capsule_at, created_at, ' +
  'anchor_weekday, anchor_day_of_month, anchor_month, anchor_day, anchor_hour, anchor_minute, ' +
  'recurrence_paused_at, reminder_lead_hours';

export interface GroupRow {
  id: string;
  name: string;
  created_by: string;
  recurrence_interval: GroupRecurrence;
  unlock_duration_hours: number;
  next_capsule_at: string | null;
  last_capsule_at: string | null;
  created_at: string;
  memberCount: number;
  anchor_weekday: number | null;
  anchor_day_of_month: number | null;
  anchor_month: number | null;
  anchor_day: number | null;
  anchor_hour: number | null;
  anchor_minute: number | null;
  recurrence_paused_at: string | null;
  reminder_lead_hours: number | null;
}

export interface GroupMemberProfile {
  user_id: string;
  joined_at: string;
  users: { display_name: string | null; avatar_url: string | null } | null;
}

function myId() { return sessionStore.get()?.user?.id ?? null; }

// Extracts a RecurrenceAnchor from a fetched GroupRow's anchor columns.
// hour/minute default to 9:00 only as a defensive fallback — every non-manual
// group always has them populated (set at creation, backfilled by the
// 20260713010000 migration for pre-existing rows).
export function anchorFromGroup(group: GroupRow): RecurrenceAnchor {
  return {
    weekday: group.anchor_weekday ?? undefined,
    dayOfMonth: group.anchor_day_of_month ?? undefined,
    month: group.anchor_month ?? undefined,
    day: group.anchor_day ?? undefined,
    hour: group.anchor_hour ?? 9,
    minute: group.anchor_minute ?? 0,
  };
}

export async function listMyGroups(): Promise<GroupRow[]> {
  const me = myId();
  if (!me) return [];

  // One round-trip: the embedded `group_members(count)` aggregate returns the
  // member count as a scalar (no member-row payload), instead of a second query
  // that fetched every member row just to count them.
  const { data, error } = await supabase
    .from('group_members')
    .select(`group_id, groups(${GROUP_COLUMNS}, group_members(count))`)
    .eq('user_id', me);

  // Don't swallow errors silently — a transient failure returning [] used to be
  // indistinguishable from "no groups." (Kept as a warn rather than a throw:
  // useCachedFetch has no error path and this runs on Home's critical path.)
  if (error) { console.warn('listMyGroups failed:', error.message); return []; }
  if (!data || data.length === 0) return [];

  return data
    .map((r: any) => r.groups)
    .filter(Boolean)
    .map((g: any) => ({ ...g, memberCount: g.group_members?.[0]?.count ?? 1 }));
}

export async function getGroup(groupId: string): Promise<GroupRow | null> {
  // One round-trip via the embedded count aggregate (see listMyGroups).
  const { data, error } = await supabase
    .from('groups')
    .select(`${GROUP_COLUMNS}, group_members(count)`)
    .eq('id', groupId)
    .single();

  if (error) { console.warn('getGroup failed:', error.message); return null; }
  if (!data) return null;

  return {
    ...data,
    recurrence_interval: data.recurrence_interval as GroupRecurrence,
    memberCount: (data as any).group_members?.[0]?.count ?? 1,
  };
}

export async function getGroupMembers(groupId: string): Promise<GroupMemberProfile[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, joined_at, users(display_name, avatar_url)')
    .eq('group_id', groupId);
  if (error) { console.warn('getGroupMembers failed:', error.message); return []; }
  return (data ?? []) as GroupMemberProfile[];
}

export async function createGroup(params: {
  name: string;
  memberIds: string[];
  recurrence: GroupRecurrence;
  anchor?: RecurrenceAnchor; // required (by the caller) for any non-'manual' recurrence
  unlockDurationHours: number;
  reminderLeadHours: number | null;
}): Promise<{ groupId?: string; error?: string }> {
  const me = myId();
  if (!me) return { error: 'Not signed in' };

  const groupId = randomUUID();
  const isManual = params.recurrence === 'manual';
  const nextCapsuleAt = !isManual && params.anchor
    ? computeNextOccurrence(params.recurrence, params.anchor, new Date())
    : null;

  const { error } = await supabase.from('groups').insert({
    id: groupId,
    name: params.name.trim(),
    created_by: me,
    recurrence_interval: params.recurrence,
    unlock_duration_hours: params.unlockDurationHours,
    next_capsule_at: nextCapsuleAt ? nextCapsuleAt.toISOString() : null,
    anchor_weekday: !isManual ? params.anchor?.weekday ?? null : null,
    anchor_day_of_month: !isManual ? params.anchor?.dayOfMonth ?? null : null,
    anchor_month: !isManual ? params.anchor?.month ?? null : null,
    anchor_day: !isManual ? params.anchor?.day ?? null : null,
    anchor_hour: !isManual ? params.anchor?.hour ?? null : null,
    anchor_minute: !isManual ? params.anchor?.minute ?? null : null,
    reminder_lead_hours: !isManual ? params.reminderLeadHours : null,
  });

  if (error) return { error: 'Could not create group.' };

  // Insert creator first so get_my_group_ids() returns this group for subsequent checks.
  const { error: creatorErr } = await supabase.from('group_members').insert({
    group_id: groupId,
    user_id: me,
  });
  if (creatorErr) return { error: 'Could not add you to the group.' };

  // Insert other members — is_group_creator() can now resolve correctly.
  const otherIds = params.memberIds.filter(id => id !== me);
  if (otherIds.length > 0) {
    await supabase.from('group_members').insert(
      otherIds.map(uid => ({ group_id: groupId, user_id: uid }))
    );
  }

  return { groupId };
}

export async function updateGroup(groupId: string, updates: {
  name?: string;
  recurrence?: GroupRecurrence;
  anchor?: RecurrenceAnchor; // if recurrence is set to non-'manual' and this is omitted, the group's current stored anchor is reused
  unlockDurationHours?: number;
  reminderLeadHours?: number | null;
}): Promise<{ error?: string }> {
  type GroupPatch = {
    name?: string;
    recurrence_interval?: string;
    next_capsule_at?: string | null;
    next_reminder_sent_at?: null;
    unlock_duration_hours?: number;
    reminder_lead_hours?: number | null;
    anchor_weekday?: number | null;
    anchor_day_of_month?: number | null;
    anchor_month?: number | null;
    anchor_day?: number | null;
    anchor_hour?: number | null;
    anchor_minute?: number | null;
  };
  const patch: GroupPatch = {};
  if (updates.name) patch.name = updates.name.trim();
  if (updates.unlockDurationHours) patch.unlock_duration_hours = updates.unlockDurationHours;
  if (updates.reminderLeadHours !== undefined) patch.reminder_lead_hours = updates.reminderLeadHours;

  if (updates.recurrence) {
    patch.recurrence_interval = updates.recurrence;

    if (updates.recurrence === 'manual') {
      patch.next_capsule_at = null;
      patch.anchor_weekday = null;
      patch.anchor_day_of_month = null;
      patch.anchor_month = null;
      patch.anchor_day = null;
      patch.anchor_hour = null;
      patch.anchor_minute = null;
    } else {
      let anchor = updates.anchor;
      if (!anchor) {
        // Caller didn't supply a new anchor (e.g. CreateScreen's "same
        // recurrence, just reschedule" call) — reuse what's already stored
        // rather than requiring every caller to carry full anchor state.
        const { data, error: fetchErr } = await supabase
          .from('groups')
          .select('anchor_weekday, anchor_day_of_month, anchor_month, anchor_day, anchor_hour, anchor_minute')
          .eq('id', groupId)
          .single();
        if (fetchErr || !data) return { error: 'Could not update group.' };
        anchor = {
          weekday: data.anchor_weekday ?? undefined,
          dayOfMonth: data.anchor_day_of_month ?? undefined,
          month: data.anchor_month ?? undefined,
          day: data.anchor_day ?? undefined,
          hour: data.anchor_hour ?? 9,
          minute: data.anchor_minute ?? 0,
        };
      }
      patch.anchor_weekday = anchor.weekday ?? null;
      patch.anchor_day_of_month = anchor.dayOfMonth ?? null;
      patch.anchor_month = anchor.month ?? null;
      patch.anchor_day = anchor.day ?? null;
      patch.anchor_hour = anchor.hour;
      patch.anchor_minute = anchor.minute;
      const nextAt = computeNextOccurrence(updates.recurrence, anchor, new Date());
      patch.next_capsule_at = nextAt ? nextAt.toISOString() : null;
    }
    // next_capsule_at just changed (or was cleared) — a stale reminder stamp
    // from the previous cycle must not suppress the next real reminder.
    patch.next_reminder_sent_at = null;
  }

  const { error } = await supabase.from('groups').update(patch as any).eq('id', groupId);
  return error ? { error: 'Could not update group.' } : {};
}

export async function pauseGroupRecurrence(groupId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('groups')
    .update({ recurrence_paused_at: new Date().toISOString() })
    .eq('id', groupId);
  return error ? { error: 'Could not pause this group.' } : {};
}

export async function resumeGroupRecurrence(groupId: string): Promise<{ error?: string }> {
  const { data, error: fetchErr } = await supabase
    .from('groups')
    .select('recurrence_interval, anchor_weekday, anchor_day_of_month, anchor_month, anchor_day, anchor_hour, anchor_minute')
    .eq('id', groupId)
    .single();
  if (fetchErr || !data) return { error: 'Could not resume this group.' };

  const interval = data.recurrence_interval as GroupRecurrence;
  if (interval === 'manual') {
    const { error } = await supabase.from('groups').update({ recurrence_paused_at: null }).eq('id', groupId);
    return error ? { error: 'Could not resume this group.' } : {};
  }

  const anchor: RecurrenceAnchor = {
    weekday: data.anchor_weekday ?? undefined,
    dayOfMonth: data.anchor_day_of_month ?? undefined,
    month: data.anchor_month ?? undefined,
    day: data.anchor_day ?? undefined,
    hour: data.anchor_hour ?? 9,
    minute: data.anchor_minute ?? 0,
  };
  // Resume computes the next occurrence from NOW, not from wherever
  // next_capsule_at was frozen — so no backlog of missed cycles fires at once.
  const nextAt = computeNextOccurrence(interval, anchor, new Date());

  const { error } = await supabase
    .from('groups')
    .update({
      recurrence_paused_at: null,
      next_capsule_at: nextAt ? nextAt.toISOString() : null,
      next_reminder_sent_at: null,
    })
    .eq('id', groupId);
  return error ? { error: 'Could not resume this group.' } : {};
}

export async function deleteGroup(groupId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  return error ? { error: 'Could not delete group.' } : {};
}

export async function addGroupMember(groupId: string, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, user_id: userId });
  if (error && error.code !== '23505') return { error: 'Could not add member.' };
  return {};
}

export async function removeGroupMember(groupId: string, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  return error ? { error: 'Could not remove member.' } : {};
}

export function recurrenceLabel(interval: GroupRecurrence): string {
  if (interval === 'weekly') return 'Weekly';
  if (interval === 'monthly') return 'Monthly';
  if (interval === 'yearly') return 'Yearly';
  return 'Manual';
}

export function unlockDurationLabel(hours: number): string {
  if (hours < 24) return `${hours}h`;
  if (hours === 24) return '1 day';
  if (hours % 168 === 0) return `${hours / 168} week${hours / 168 > 1 ? 's' : ''}`;
  if (hours % 720 === 0) return `${hours / 720} month${hours / 720 > 1 ? 's' : ''}`;
  if (hours % 8760 === 0) return `${hours / 8760} year${hours / 8760 > 1 ? 's' : ''}`;
  return `${Math.round(hours / 24)}d`;
}
```

Note: `calcNextCapsuleAt` is removed — it had no callers outside this file (verified: `grep -rn "calcNextCapsuleAt" src` before this change matches only `groups.ts` itself), and `computeNextOccurrence` replaces its role.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "groups.ts\|groups'"`
Expected: no output referencing `groups.ts` beyond pre-existing unrelated errors (the repo has known `@expo/vector-icons` type-resolution errors unrelated to this change — ignore those). This file will show errors until Tasks 6 and 7 update their callers to pass the new required `anchor`/`reminderLeadHours` params — that's expected at this point; just confirm `groups.ts` itself has no *internal* type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/groups.ts
git commit -m "$(cat <<'EOF'
Wire anchor-aware scheduling and pause/resume into groups.ts

createGroup/updateGroup now compute next_capsule_at via
computeNextOccurrence instead of naive "+interval" math, and reset
next_reminder_sent_at whenever next_capsule_at changes. Adds
pauseGroupRecurrence/resumeGroupRecurrence.
EOF
)"
```

---

### Task 4: `RecurrenceAnchorPicker` component

**Files:**
- Create: `src/components/RecurrenceAnchorPicker.tsx`

**Interfaces:**
- Consumes: `RecurrenceAnchor`, `GroupRecurrence` (`./recurrence` re-exported via `./groups`; import `RecurrenceAnchor` from `../lib/recurrence` directly).
- Produces: `<RecurrenceAnchorPicker interval anchor onChange />` — a controlled component. Used by Task 6 and 7.

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { RecurrenceAnchor } from '../lib/recurrence';
import { GroupRecurrence } from '../lib/groups';
import { useTheme } from '../context/ThemeContext';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
// UI-only bound for the day picker — a conservative per-month max (allows 29
// for February so a leap-year Feb 29 anchor is selectable at all). The real
// per-year clamping happens in computeNextOccurrence, not here.
const MAX_DAY_FOR_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface Props {
  interval: GroupRecurrence;
  anchor: RecurrenceAnchor;
  onChange: (anchor: RecurrenceAnchor) => void;
}

export default function RecurrenceAnchorPicker({ interval, anchor, onChange }: Props) {
  const { accentColor } = useTheme();

  if (interval === 'manual') return null;

  if (interval === 'weekly') {
    return (
      <View style={styles.section}>
        <Text style={styles.label}>On which day</Text>
        <View style={styles.chipRow}>
          {WEEKDAY_LABELS.map((label, i) => {
            const active = anchor.weekday === i;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.chip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                onPress={() => onChange({ ...anchor, weekday: i })}
              >
                <Text style={[styles.chipText, active && { color: accentColor }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  if (interval === 'monthly') {
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    return (
      <View style={styles.section}>
        <Text style={styles.label}>On which day of the month</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {days.map(day => {
            const active = anchor.dayOfMonth === day;
            return (
              <TouchableOpacity
                key={day}
                style={[styles.dayChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                onPress={() => onChange({ ...anchor, dayOfMonth: day })}
              >
                <Text style={[styles.chipText, active && { color: accentColor }]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {(anchor.dayOfMonth ?? 0) > 28 && (
          <Text style={styles.hint}>If a month is shorter, the last day of that month is used.</Text>
        )}
      </View>
    );
  }

  // yearly
  const month = anchor.month ?? 1;
  const maxDay = MAX_DAY_FOR_MONTH[month - 1];
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Which date each year</Text>
      <View style={styles.chipRow}>
        {MONTH_LABELS.map((label, i) => {
          const m = i + 1;
          const active = anchor.month === m;
          const dayStillValid = (anchor.day ?? 1) <= MAX_DAY_FOR_MONTH[i];
          return (
            <TouchableOpacity
              key={m}
              style={[styles.chip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
              onPress={() => onChange({
                ...anchor,
                month: m,
                day: dayStillValid ? anchor.day : MAX_DAY_FOR_MONTH[i],
              })}
            >
              <Text style={[styles.chipText, active && { color: accentColor }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, styles.dayGridSpacing]}>
        {days.map(day => {
          const active = anchor.day === day;
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
              onPress={() => onChange({ ...anchor, day })}
            >
              <Text style={[styles.chipText, active && { color: accentColor }]}>{day}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {maxDay === 29 && anchor.day === 29 && (
        <Text style={styles.hint}>In non-leap years, Feb 28 is used instead.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 4 },
  label: { fontSize: 13, fontWeight: '600', color: '#888888' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayGridSpacing: { marginTop: 4 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  dayChip: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  hint: { fontSize: 12, color: '#888888', marginTop: -2 },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "RecurrenceAnchorPicker"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/RecurrenceAnchorPicker.tsx
git commit -m "Add RecurrenceAnchorPicker component for weekly/monthly/yearly anchor selection"
```

---

### Task 5: `ReminderLeadPicker` component

**Files:**
- Create: `src/components/ReminderLeadPicker.tsx`

**Interfaces:**
- Produces: `<ReminderLeadPicker value={number | null} onChange={(hours: number | null) => void} />`. Used by Task 6 and 7.

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';

const OPTIONS: { label: string; hours: number | null }[] = [
  { label: 'Off', hours: null },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

interface Props {
  value: number | null;
  onChange: (hours: number | null) => void;
}

export default function ReminderLeadPicker({ value, onChange }: Props) {
  const { accentColor } = useTheme();
  return (
    <View style={styles.row}>
      {OPTIONS.map(opt => {
        const active = value === opt.hours;
        return (
          <TouchableOpacity
            key={opt.label}
            style={[styles.chip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
            onPress={() => onChange(opt.hours)}
          >
            <Text style={[styles.chipText, active && { color: accentColor }]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  chipText: { fontSize: 14, fontWeight: '600', color: '#888888' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ReminderLeadPicker"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReminderLeadPicker.tsx
git commit -m "Add ReminderLeadPicker component"
```

---

### Task 6: Wire the pickers into `CreateGroupScreen`

**Files:**
- Modify: `src/screens/app/CreateGroupScreen.tsx`

**Interfaces:**
- Consumes: `RecurrenceAnchorPicker` (Task 4), `ReminderLeadPicker` (Task 5), `RecurrenceAnchor` (`../../lib/recurrence`), updated `createGroup` (Task 3).

- [ ] **Step 1: Add imports and default-anchor helper**

In `src/screens/app/CreateGroupScreen.tsx`, add to the imports (after the existing `groups` import on line 16):

```tsx
import RecurrenceAnchorPicker from '../../components/RecurrenceAnchorPicker';
import ReminderLeadPicker from '../../components/ReminderLeadPicker';
import { RecurrenceAnchor } from '../../lib/recurrence';
```

Add above the component definition (after `DURATION_OPTIONS`):

```tsx
function defaultAnchor(): RecurrenceAnchor {
  const now = new Date();
  return {
    weekday: now.getDay(),
    dayOfMonth: now.getDate(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}
```

- [ ] **Step 2: Add state and wire `handleCreate`**

Add state alongside the existing `unlockHours` state (after line 43):

```tsx
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(defaultAnchor);
  const [reminderLeadHours, setReminderLeadHours] = useState<number | null>(24);
```

Update the `createGroup` call inside `handleCreate` (replace the existing call at lines 93-98):

```tsx
    const { groupId, error: err } = await createGroup({
      name: trimmedName,
      memberIds: selectedMembers.map(m => m.id),
      recurrence,
      anchor: recurrence !== 'manual' ? anchor : undefined,
      unlockDurationHours: unlockHours,
      reminderLeadHours: recurrence !== 'manual' ? reminderLeadHours : null,
    });
```

- [ ] **Step 3: Render the pickers**

In the "Schedule" section (after the recurrence `optionGrid` block, i.e. right after the closing `</View>` that ends the recurrence chip row's `View style={styles.optionGrid}` block, still inside the same `<View style={styles.section}>`), add:

```tsx
          <RecurrenceAnchorPicker interval={recurrence} anchor={anchor} onChange={setAnchor} />
```

After the "Default Unlock Duration" `<View style={styles.section}>` block (i.e. as a new sibling section, only when scheduled), add a new section:

```tsx
        {recurrence !== 'manual' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Remind Members</Text>
            <Text style={styles.sectionHint}>Heads-up before the next capsule is auto-created.</Text>
            <ReminderLeadPicker value={reminderLeadHours} onChange={setReminderLeadHours} />
          </View>
        )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "CreateGroupScreen"`
Expected: no output.

- [ ] **Step 5: Manual verification**

Run: `npx expo start --web`, navigate to Home → New Group. Confirm: choosing Weekly shows a weekday chip row defaulting to today; choosing Monthly shows a 1-31 day scroller defaulting to today's date (with the clamp hint appearing only above 28); choosing Yearly shows a month grid + day grid defaulting to today's month/day; a "Remind Members" chip row appears for all three, defaulting to "1 day"; choosing Manual hides both the anchor picker and the reminder row. Create a weekly group and confirm no error toast.

- [ ] **Step 6: Commit**

```bash
git add src/screens/app/CreateGroupScreen.tsx
git commit -m "Wire anchor and reminder pickers into CreateGroupScreen"
```

---

### Task 7: Wire pause/resume, anchor editing, and upcoming preview into `ManageGroupScreen`

**Files:**
- Modify: `src/screens/app/ManageGroupScreen.tsx`

**Interfaces:**
- Consumes: `RecurrenceAnchorPicker` (Task 4), `ReminderLeadPicker` (Task 5), `computeUpcomingOccurrences`/`RecurrenceAnchor` (`../../lib/recurrence`), `anchorFromGroup`/`pauseGroupRecurrence`/`resumeGroupRecurrence` (Task 3, `../../lib/groups`).

- [ ] **Step 1: Update imports**

Replace the `groups` import (line 20-23) with:

```tsx
import {
  getGroup, getGroupMembers, updateGroup, addGroupMember, removeGroupMember,
  pauseGroupRecurrence, resumeGroupRecurrence, anchorFromGroup,
  GroupRecurrence, GroupMemberProfile, recurrenceLabel,
} from '../../lib/groups';
import { computeUpcomingOccurrences, RecurrenceAnchor } from '../../lib/recurrence';
import RecurrenceAnchorPicker from '../../components/RecurrenceAnchorPicker';
import ReminderLeadPicker from '../../components/ReminderLeadPicker';
```

- [ ] **Step 2: Add state, seed it in `load()`**

Add state after `unlockHours` (line 51):

```tsx
  const [anchor, setAnchor] = useState<RecurrenceAnchor>({ hour: 9, minute: 0 });
  const [reminderLeadHours, setReminderLeadHours] = useState<number | null>(24);
  const [paused, setPaused] = useState(false);
  const [pausing, setPausing] = useState(false);
```

Update `load()` (lines 61-74) to seed the new state — replace the body with:

```tsx
  const load = useCallback(async () => {
    const [group, mems] = await Promise.all([getGroup(groupId), getGroupMembers(groupId)]);
    if (!group) { navigation.goBack(); return; }
    // Manage is creator-only — bounce anyone else (matches the RLS, which
    // rejects their updates anyway).
    if (group.created_by !== myId) { navigation.goBack(); return; }
    setCreatedBy(group.created_by);
    setName(group.name);
    setRecurrence(group.recurrence_interval);
    setUnlockHours(group.unlock_duration_hours);
    setAnchor(anchorFromGroup(group));
    setReminderLeadHours(group.reminder_lead_hours);
    setPaused(group.recurrence_paused_at !== null);
    setMembers(mems);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, myId]);
```

- [ ] **Step 3: Update `handleSave`, add `handleTogglePause`**

Replace `handleSave` (lines 82-94) with:

```tsx
  async function handleSave() {
    if (!name.trim()) { toast.show('Group name is required.'); return; }
    setSaving(true);
    const { error } = await updateGroup(groupId, {
      name: name.trim(),
      recurrence,
      anchor: recurrence !== 'manual' ? anchor : undefined,
      unlockDurationHours: unlockHours,
      reminderLeadHours: recurrence !== 'manual' ? reminderLeadHours : null,
    });
    setSaving(false);
    if (error) { toast.show("Couldn't save the group — try again."); return; }
    invalidate();
    navigation.goBack();
  }

  async function handleTogglePause() {
    setPausing(true);
    const wasPaused = paused;
    setPaused(!wasPaused); // optimistic
    const { error } = wasPaused
      ? await resumeGroupRecurrence(groupId)
      : await pauseGroupRecurrence(groupId);
    setPausing(false);
    if (error) {
      setPaused(wasPaused);
      toast.show(wasPaused ? "Couldn't resume this group — try again." : "Couldn't pause this group — try again.");
      return;
    }
    invalidate();
  }
```

- [ ] **Step 4: Render the anchor picker, reminder picker, upcoming preview, and pause switch**

Add the anchor picker right after the existing recurrence `optionGrid` `</View>` inside the "Schedule" section (lines 189-205), so the section becomes:

```tsx
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Schedule</Text>
          <View style={styles.optionGrid}>
            {RECURRENCE_OPTIONS.map(opt => {
              const active = recurrence === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => setRecurrence(opt)}
                >
                  <Text style={[styles.optionChipText, active && { color: accentColor }]}>{recurrenceLabel(opt)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <RecurrenceAnchorPicker interval={recurrence} anchor={anchor} onChange={setAnchor} />
        </View>

        {recurrence !== 'manual' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Remind Members</Text>
            <ReminderLeadPicker value={reminderLeadHours} onChange={setReminderLeadHours} />
          </View>
        )}

        {recurrence !== 'manual' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Upcoming Capsules</Text>
            {paused ? (
              <Text style={styles.hintText}>Paused — no capsules will be created until resumed.</Text>
            ) : (
              computeUpcomingOccurrences(recurrence, anchor, new Date(), 3).map((d, i) => (
                <Text key={i} style={styles.hintText}>
                  {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              ))
            )}
            <TouchableOpacity
              style={[styles.pauseBtn, paused && { borderColor: accentColor }]}
              onPress={handleTogglePause}
              disabled={pausing}
              accessibilityRole="button"
              accessibilityLabel={paused ? 'Resume this group\'s schedule' : 'Pause this group\'s schedule'}
            >
              {pausing
                ? <ActivityIndicator color={accentColor} size="small" />
                : <Text style={[styles.pauseBtnText, paused && { color: accentColor }]}>{paused ? 'Resume Schedule' : 'Pause Schedule'}</Text>}
            </TouchableOpacity>
          </View>
        )}
```

Add to `styles` (after `optionChipText`):

```tsx
  hintText: { fontSize: 13, color: '#888888' },
  pauseBtn: {
    marginTop: 4, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  pauseBtnText: { fontSize: 14, fontWeight: '600', color: '#888888' },
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ManageGroupScreen"`
Expected: no output.

- [ ] **Step 6: Manual verification**

Run: `npx expo start --web`. Create a weekly group, then open it as creator → Manage. Confirm: the anchor picker shows the correct pre-selected weekday; "Upcoming Capsules" lists 3 future dates one week apart; tapping "Pause Schedule" flips it to "Paused — no capsules will be created until resumed." and the button to "Resume Schedule"; tapping resume flips it back and the upcoming list reappears; Save persists anchor/reminder changes (reload the screen and confirm they stuck).

- [ ] **Step 7: Commit**

```bash
git add src/screens/app/ManageGroupScreen.tsx
git commit -m "Add anchor editing, upcoming preview, and pause/resume to ManageGroupScreen"
```

---

### Task 8: Read-only schedule line in `GroupDetailScreen`

**Files:**
- Modify: `src/screens/app/GroupDetailScreen.tsx`

**Interfaces:**
- Consumes: `computeUpcomingOccurrences`/`RecurrenceAnchor` (`../../lib/recurrence`), `anchorFromGroup` (`../../lib/groups`).

- [ ] **Step 1: Update the "Next" badge to use the anchor-aware preview and show Paused**

Add to the imports:

```tsx
import { computeUpcomingOccurrences } from '../../lib/recurrence';
import { anchorFromGroup } from '../../lib/groups';
```

(the existing `GroupRow, GroupMemberProfile, recurrenceLabel` import from `../../lib/groups` stays as-is; add `anchorFromGroup` to that same import list instead of a separate line.)

Replace the `nextDate` line (line 202) and the badge block (lines 279-286) — first replace:

```tsx
  const nextDate = group.next_capsule_at ? new Date(group.next_capsule_at) : null;
```

with:

```tsx
  const isPaused = group.recurrence_paused_at !== null;
  const nextDate = !isPaused && group.recurrence_interval !== 'manual'
    ? computeUpcomingOccurrences(group.recurrence_interval, anchorFromGroup(group), new Date(), 1)[0] ?? null
    : null;
```

Then replace the badge block:

```tsx
                {nextDate && (
                  <View style={styles.badge}>
                    <Ionicons name="calendar-outline" size={13} color="#888888" />
                    <Text style={styles.badgeText}>
                      Next {nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                )}
```

with:

```tsx
                {isPaused ? (
                  <View style={styles.badge}>
                    <Ionicons name="pause-circle-outline" size={13} color="#888888" />
                    <Text style={styles.badgeText}>Paused</Text>
                  </View>
                ) : nextDate && (
                  <View style={styles.badge}>
                    <Ionicons name="calendar-outline" size={13} color="#888888" />
                    <Text style={styles.badgeText}>
                      Next {nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                )}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "GroupDetailScreen"`
Expected: no output.

- [ ] **Step 3: Manual verification**

Run: `npx expo start --web`. Open a non-paused recurring group's detail screen — confirm the "Next <date>" badge shows. Pause it via Manage, go back to the detail screen — confirm the badge now reads "Paused".

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/GroupDetailScreen.tsx
git commit -m "Show anchor-aware next-occurrence / Paused badge on GroupDetailScreen"
```

---

### Task 9: `create-group-capsules` edge function — anchor-aware cron + reminder pass

**Files:**
- Modify: `supabase/functions/create-group-capsules/index.ts`

**Interfaces:**
- Duplicates `computeNextOccurrence` from `src/lib/recurrence.ts` verbatim (Deno can't import `src/lib` — see Global Constraints).

- [ ] **Step 1: Replace `calcNextAt` with the anchor-aware duplicate**

Replace lines 8-16 (the `GroupRecurrence` type and `calcNextAt` function) with:

```ts
type GroupRecurrence = 'weekly' | 'monthly' | 'yearly' | 'manual';

// Duplicated verbatim from src/lib/recurrence.ts — Deno edge functions can't
// import from src/lib (same precedent as this file's GENERAL_AWARD_POOL,
// mirrored from src/lib/awardPool.ts). Keep in sync if either changes.
interface RecurrenceAnchor {
  weekday?: number;
  dayOfMonth?: number;
  month?: number;
  day?: number;
  hour: number;
  minute: number;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

function clampedDate(year: number, month1to12: number, day: number, hour: number, minute: number): Date {
  const clampedDay = Math.min(day, daysInMonth(year, month1to12));
  return new Date(year, month1to12 - 1, clampedDay, hour, minute, 0, 0);
}

function computeNextOccurrence(interval: GroupRecurrence, anchor: RecurrenceAnchor, from: Date): Date | null {
  if (interval === 'manual') return null;

  if (interval === 'weekly') {
    if (anchor.weekday === undefined) throw new Error('weekly recurrence requires anchor.weekday');
    const diffToWeekday = (anchor.weekday - from.getDay() + 7) % 7;
    const candidate = new Date(from);
    candidate.setDate(from.getDate() + diffToWeekday);
    candidate.setHours(anchor.hour, anchor.minute, 0, 0);
    if (candidate <= from) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  if (interval === 'monthly') {
    if (anchor.dayOfMonth === undefined) throw new Error('monthly recurrence requires anchor.dayOfMonth');
    let year = from.getFullYear();
    let month = from.getMonth() + 1;
    let candidate = clampedDate(year, month, anchor.dayOfMonth, anchor.hour, anchor.minute);
    if (candidate <= from) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      candidate = clampedDate(year, month, anchor.dayOfMonth, anchor.hour, anchor.minute);
    }
    return candidate;
  }

  if (anchor.month === undefined || anchor.day === undefined) {
    throw new Error('yearly recurrence requires anchor.month and anchor.day');
  }
  const year = from.getFullYear();
  let candidate = clampedDate(year, anchor.month, anchor.day, anchor.hour, anchor.minute);
  if (candidate <= from) {
    candidate = clampedDate(year + 1, anchor.month, anchor.day, anchor.hour, anchor.minute);
  }
  return candidate;
}
```

- [ ] **Step 2: Update `releaseClaim` to also restore the reminder stamp**

Replace `releaseClaim` (lines 86-94) with:

```ts
async function releaseClaim(
  groupId: string,
  prevNextAt: string | null,
  prevLastAt: string | null,
  prevReminderSentAt: string | null,
) {
  await supabase
    .from('groups')
    .update({ next_capsule_at: prevNextAt, last_capsule_at: prevLastAt, next_reminder_sent_at: prevReminderSentAt })
    .eq('id', groupId);
}
```

- [ ] **Step 3: Update `processGroup` to compute via the anchor and reset the reminder stamp on claim**

Replace the start of `processGroup` (lines 96-118) with:

```ts
async function processGroup(group: any) {
  const now = new Date();
  const nowIso = now.toISOString();
  const anchor: RecurrenceAnchor = {
    weekday: group.anchor_weekday ?? undefined,
    dayOfMonth: group.anchor_day_of_month ?? undefined,
    month: group.anchor_month ?? undefined,
    day: group.anchor_day ?? undefined,
    hour: group.anchor_hour ?? 9,
    minute: group.anchor_minute ?? 0,
  };
  const nextOccurrence = computeNextOccurrence(group.recurrence_interval as GroupRecurrence, anchor, now);
  const nextAt = (nextOccurrence ?? now).toISOString();

  // GROUPS.md #2 — CLAIM FIRST, atomically. Advancing next_capsule_at up front,
  // gated on it still being due, means two overlapping ticks can't both create
  // a capsule for the same cycle: the second update matches zero rows. Only
  // proceed for groups this call actually claimed. next_reminder_sent_at is
  // reset here too — it just moved past its old value, so a stale "already
  // reminded" stamp from the previous cycle must not suppress the next one.
  const { data: claimed, error: claimErr } = await supabase
    .from('groups')
    .update({ next_capsule_at: nextAt, last_capsule_at: nowIso, next_reminder_sent_at: null })
    .eq('id', group.id)
    .lte('next_capsule_at', nowIso)
    .select('id');
  if (claimErr) {
    console.error(`claim failed for group ${group.id}:`, claimErr.message);
    return;
  }
  if (!claimed || claimed.length === 0) {
    // Another tick already claimed this cycle — nothing to do.
    return;
  }
```

The rest of `processGroup` (capsule insert, members insert, awards, pushes) is unchanged, **except** every call to `releaseClaim(group.id, group.next_capsule_at, group.last_capsule_at)` (there are two, in the capsule-insert-failure and members-fetch-failure branches) must become `releaseClaim(group.id, group.next_capsule_at, group.last_capsule_at, group.next_reminder_sent_at)`.

- [ ] **Step 4: Add the reminder pass**

Add these two functions after `processGroup` (before the `Deno.serve` block):

```ts
async function sendGroupReminder(groupId: string, groupName: string) {
  const { data: members, error } = await supabase
    .from('group_members')
    .select('user_id, users(push_token)')
    .eq('group_id', groupId);
  if (error || !members || members.length === 0) return;

  const nowIso = new Date().toISOString();
  const notifRows = members.map((m: any) => ({
    user_id: m.user_id,
    group_id: groupId,
    type: 'group_capsule_upcoming',
    sent_at: nowIso,
    pushed_at: nowIso,
  }));
  const { error: insertErr } = await supabase.from('notifications').insert(notifRows);
  if (insertErr) console.error(`reminder notification insert failed for group ${groupId}:`, insertErr.message);

  const tokens: string[] = members.map((m: any) => m.users?.push_token).filter(Boolean);
  const messages = tokens.filter((t: string) => t.startsWith('ExponentPushToken[')).map((to: string) => ({
    to,
    title: groupName,
    body: 'A new capsule starts soon',
    data: { groupId },
    sound: 'default' as const,
  }));
  if (messages.length > 0) await sendExpoPush(messages);
}

// Fetches candidates broadly (not paused, reminder configured, due date set,
// not already reminded this cycle) then filters + claims per-row, since the
// per-row "next_capsule_at <= now + reminder_lead_hours" comparison can't be
// expressed as a single PostgREST filter (reminder_lead_hours varies per row).
async function processReminders() {
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: candidates, error } = await supabase
    .from('groups')
    .select('id, name, next_capsule_at, reminder_lead_hours')
    .is('recurrence_paused_at', null)
    .not('reminder_lead_hours', 'is', null)
    .not('next_capsule_at', 'is', null)
    .gt('next_capsule_at', nowIso)
    .is('next_reminder_sent_at', null);

  if (error) {
    console.error('reminder candidates fetch failed:', error.message);
    return;
  }

  for (const group of candidates ?? []) {
    const leadMs = group.reminder_lead_hours * 3_600_000;
    const dueAt = new Date(group.next_capsule_at).getTime() - leadMs;
    if (now.getTime() < dueAt) continue; // not within this group's lead window yet

    // Claim atomically — an overlapping tick's claim matches zero rows here.
    const { data: claimedRows } = await supabase
      .from('groups')
      .update({ next_reminder_sent_at: nowIso })
      .eq('id', group.id)
      .is('next_reminder_sent_at', null)
      .select('id');
    if (!claimedRows || claimedRows.length === 0) continue;

    await sendGroupReminder(group.id, group.name);
  }
}
```

- [ ] **Step 5: Call the reminder pass and filter paused groups out of the create-pass**

Replace the `Deno.serve` handler body's due-groups query (lines 202-206):

```ts
  const { data: dueGroups, error } = await supabase
    .from('groups')
    .select(
      'id, name, created_by, recurrence_interval, unlock_duration_hours, next_capsule_at, last_capsule_at, ' +
      'anchor_weekday, anchor_day_of_month, anchor_month, anchor_day, anchor_hour, anchor_minute, next_reminder_sent_at'
    )
    .neq('recurrence_interval', 'manual')
    .is('recurrence_paused_at', null)
    .lte('next_capsule_at', now);
```

And add the reminder pass right before this query runs (i.e. right after the `const now = new Date().toISOString();` line inside `Deno.serve`):

```ts
  await processReminders();

```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit --skipLibCheck supabase/functions/create-group-capsules/index.ts 2>&1 | grep -v "Cannot find module 'https://esm.sh\|Cannot find name 'Deno'"`
Expected: no output (the ignored patterns are the pre-existing, unrelated Deno/remote-import errors this file always has under a Node `tsc` run — confirmed present before this change too).

- [ ] **Step 7: Confirm with the user, then deploy**

Deploying an edge function pushes it live to production. Confirm with the user before running, then deploy (e.g. via `mcp__supabase__deploy_edge_function`).

- [ ] **Step 8: Verify**

After deploy, check function logs (`mcp__supabase__get_logs` for the `create-group-capsules` function, or the Dashboard) on the next cron tick (within a minute) for `create-group-capsules: N group(s) due` with no error-level entries. If any group in the project has `reminder_lead_hours` set and a `next_capsule_at` inside its lead window, confirm a `group_capsule_upcoming` row appears in `notifications` for its members (`select * from notifications where type = 'group_capsule_upcoming' order by sent_at desc limit 10`).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/create-group-capsules/index.ts
git commit -m "$(cat <<'EOF'
Make create-group-capsules anchor-aware, add pause filter and reminders

Cron capsule-creation now computes next_capsule_at via the duplicated
computeNextOccurrence (weekly/monthly/yearly anchors with calendar
clamping) instead of naive "+interval" math, skips paused groups, and
gains a claim-and-stamp reminder pass that sends group_capsule_upcoming
notifications/pushes ahead of each group's configured lead time.
EOF
)"
```

---

### Task 10: `NotificationsScreen` and native push routing for `group_capsule_upcoming`

**Files:**
- Modify: `src/screens/app/NotificationsScreen.tsx`
- Modify: `src/hooks/usePushNotifications.native.ts`

**Interfaces:**
- Consumes: `notifications.group_id` and `groups(name)` embed added in Task 1.

- [ ] **Step 1: Extend `NotificationRow` and the fetch query**

In `src/screens/app/NotificationsScreen.tsx`, update the `type` union (line 30-40) to add `'group_capsule_upcoming'` after `'group_capsule'`, and add two new fields to `NotificationRow` (after `capsule_id: string | null;` on line 28):

```tsx
  group_id: string | null;
```

and after `capsules: { title: string } | null;` (line 43):

```tsx
  groups: { name: string } | null;
```

Update the fetch query's `.select(...)` (line 127) to add `group_id, groups(name)`:

```tsx
          .select('id, capsule_id, group_id, actor_id, type, sent_at, read_at, capsules(title), groups(name), actor:users!notifications_actor_id_fkey(id, display_name, avatar_url)')
```

- [ ] **Step 2: Add tap routing**

In the card's `onPress` handler (lines 432-444), add a new branch before the closing brace:

```tsx
                  } else if (item.type === 'group_capsule_upcoming' && item.group_id) {
                    dismiss(item);
                    navigation.navigate('GroupDetail', { groupId: item.group_id });
                  }
```

- [ ] **Step 3: Add icon and copy**

In the `Ionicons name={...}` ternary (lines 446-458), add a branch before the final `: 'cube-outline'`:

```tsx
                    : item.type === 'group_capsule_upcoming' ? 'calendar-outline'
```

In the matching `color={...}` ternary (lines 460-469), add a branch before `: '#888888'`:

```tsx
                    : item.type === 'group_capsule_upcoming' ? accentColor
```

In the card body copy ternary (lines 472-526), add a branch right after the `group_capsule` case (before the final `else` / invite fallback):

```tsx
                    ) : item.type === 'group_capsule_upcoming' ? (
                      <>
                        A new capsule for{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.groups?.name ?? 'your group'}</Text>
                        {' '}starts soon
                      </>
```

- [ ] **Step 4: Add push tap routing**

In `src/hooks/usePushNotifications.native.ts`, update both places that check `data?.capsuleId` (the live-tap listener and the cold-start `navigate` closure) to add a `groupId` branch. Replace:

```ts
      if (data?.capsuleId) {
        navigationRef.navigate('CapsuleDetail', { capsuleId: data.capsuleId });
      } else if (data?.screen === 'Notifications') {
        navigationRef.navigate('Tabs', { screen: 'Notifications' });
      }
```

(appearing twice — once in the `addNotificationResponseReceivedListener` callback, once inside the `getLastNotificationResponseAsync`'s `navigate` closure) with:

```ts
      if (data?.capsuleId) {
        navigationRef.navigate('CapsuleDetail', { capsuleId: data.capsuleId });
      } else if (data?.groupId) {
        navigationRef.navigate('GroupDetail', { groupId: data.groupId });
      } else if (data?.screen === 'Notifications') {
        navigationRef.navigate('Tabs', { screen: 'Notifications' });
      }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "NotificationsScreen\|usePushNotifications"`
Expected: no output.

- [ ] **Step 6: Manual verification**

After Task 9 is deployed and at least one group has a due reminder (or by temporarily setting a test group's `next_capsule_at`/`reminder_lead_hours` close together and waiting for a cron tick), open the Alerts tab and confirm a "A new capsule for `<group>` starts soon" card renders with a calendar icon, and tapping it navigates to that group's `GroupDetail` screen.

- [ ] **Step 7: Commit**

```bash
git add src/screens/app/NotificationsScreen.tsx src/hooks/usePushNotifications.native.ts
git commit -m "Add group_capsule_upcoming notification rendering and push tap routing"
```

---

### Task 11: Verify `CreateScreen`'s manual-reschedule path against the new `updateGroup`

**Files:**
- Modify: `src/screens/app/CreateScreen.tsx:240-243` (verify only — likely no change needed)

**Interfaces:**
- Consumes: `updateGroup` (Task 3).

- [ ] **Step 1: Confirm behavior**

`CreateScreen.tsx`'s existing manual-create reschedule call (lines 240-243):

```tsx
      const group = await getGroup(groupId);
      if (group && group.recurrence_interval !== 'manual') {
        await updateGroup(groupId, { recurrence: group.recurrence_interval });
      }
```

already passes `recurrence` with no `anchor` — under Task 3's new `updateGroup`, this correctly falls into the "no anchor supplied, reuse what's stored" branch, recomputes `next_capsule_at` via `computeNextOccurrence`, and resets `next_reminder_sent_at`. No code change is needed here; this step exists to confirm that explicitly rather than silently assume it.

- [ ] **Step 2: Manual verification**

Create a weekly group, manually start a capsule for it from `GroupDetailScreen`'s "Start New Capsule" button, then open Manage for that group and confirm `next_capsule_at`'s preview ("Upcoming Capsules") advanced to the next real anchor occurrence after now (not still showing the pre-manual-create date).

- [ ] **Step 3: No commit needed** (verification-only task; skip if Step 2 passes).

---

### Task 12: Full manual walkthrough and branch completion

**Files:** none (verification only)

- [ ] **Step 1: End-to-end walkthrough**

Run: `npx expo start --web`. Walk through, in order:
1. Create a monthly group with day-of-month 31 and a "1 day" reminder.
2. Open Manage → confirm the "Upcoming Capsules" preview shows the clamped date for the current month if it's short, and 31 for a 31-day month.
3. Pause the group; confirm the Home groups shelf / GroupDetail badge reflects "Paused".
4. Resume the group; confirm a new upcoming date appears and is `>= now`.
5. Manually start a capsule for the group from GroupDetail; confirm the schedule advances (Task 11).
6. Confirm no console errors/warnings appear in the Expo web console during any of the above (`read_console_messages` if using Claude in Chrome, or the terminal running `expo start --web`).

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "@expo/vector-icons\|esm.sh\|Cannot find name 'Deno'"`
Expected: no output beyond the pre-existing, unrelated errors filtered out above (confirmed present before this feature in Task 3 Step 2 — this final check just confirms no *new* errors were introduced anywhere in the app).

- [ ] **Step 3: Hand off**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."
**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch.
