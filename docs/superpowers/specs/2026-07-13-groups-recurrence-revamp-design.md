# Groups Recurrence Revamp — Design

## Motivation

Groups today (see CLAUDE.md "Groups" section) support `recurrence_interval`
(`weekly`/`monthly`/`yearly`/`manual`), but the schedule itself is just
"advance `next_capsule_at` by one interval from whenever it last fired." That
has four gaps:

1. **No fixed calendar anchor** — cadence drifts relative to a calendar
   concept ("the 1st of the month", "every Sunday"); it only knows "N days/
   months/years from last time."
2. **No pause/skip** — the only way to stop a cycle is switching to
   `manual`, which throws away the schedule rather than suspending it.
3. **No forward preview** — members can't see more than the single next
   `next_capsule_at` date.
4. **No advance reminder** — a new capsule (or its absence, if skipped)
   just appears with no heads-up.

This spec adds all four, scoped to the group recurrence subsystem only
(`groups` table, `create-group-capsules` cron, `CreateGroupScreen`/
`ManageGroupScreen`/`GroupDetailScreen`). It does not touch capsule-level
scheduling (`unlock_at`, the `unlock-capsules` cron) or any other group
capability (membership, roles).

## Chosen approach

Explicit typed anchor columns on `groups`, with `next_capsule_at` remaining
the single value the cron's claim query reads (`next_capsule_at <= now()`).
Anchor columns only change *how* `next_capsule_at` gets recomputed after each
firing, edit, or resume — the cron's core gate is untouched.

Rejected alternatives:
- **Single `recurrence_config jsonb` column** — more flexible for
  hypothetical future rule shapes, but no other table in this schema uses a
  jsonb config blob, it's harder to `CHECK`-constrain, and nothing here
  needs that flexibility yet.
- **Cron-expression string** (e.g. `"0 9 * * 1"`) — maximally powerful but
  overkill for "weekly/monthly/yearly on a fixed day"; would need a
  cron-parser dependency in the Deno edge function and produces a worse UI
  (a friendly picker would just be a UI layered on top of cron syntax
  anyway).

This keeps the diff consistent with the rest of the schema (plain typed
columns throughout) and every one of the four requested capabilities falls
out of it directly.

## Data model

New migration adds to `groups`:

| Column | Type | Meaning |
|---|---|---|
| `anchor_weekday` | `smallint` | 0=Sun..6=Sat. Used when `recurrence_interval = 'weekly'`. |
| `anchor_day_of_month` | `smallint` | 1-31. Used when `recurrence_interval = 'monthly'`. |
| `anchor_month` | `smallint` | 1-12. Used when `recurrence_interval = 'yearly'` (paired with `anchor_day`). |
| `anchor_day` | `smallint` | 1-31. Used when `recurrence_interval = 'yearly'`. |
| `recurrence_paused_at` | `timestamptz` | `null` = active. Non-null = paused; irrelevant for `manual`. |
| `reminder_lead_hours` | `smallint` | `null` = no reminder configured. Default `24` for new non-`manual` groups. |
| `next_reminder_sent_at` | `timestamptz` | Dedupe stamp for the reminder cron pass (see Reminders). |

`CHECK` constraints tie each anchor field to its relevant
`recurrence_interval` (e.g. `recurrence_interval <> 'weekly' or anchor_weekday between 0 and 6`),
one constraint per interval type. `manual` groups require no anchor fields.

**Time-of-day** for every future occurrence is fixed to whatever
time-of-day component the group's `next_capsule_at` already carries at
migration time (or, for new groups, whatever time-of-day the creator's
chosen anchor date implies at creation). No new time-picker UI — this
avoids adding a fifth config surface for a case nobody asked for.

**Backfill for existing groups** (same migration): derive each group's
anchor fields from its *current* `next_capsule_at`, so no existing group's
actual next-fire date changes as a result of this migration — only new
metadata is added:

```sql
update groups set anchor_weekday = extract(dow from next_capsule_at)::smallint
where recurrence_interval = 'weekly';

update groups set anchor_day_of_month = extract(day from next_capsule_at)::smallint
where recurrence_interval = 'monthly';

update groups set
  anchor_month = extract(month from next_capsule_at)::smallint,
  anchor_day = extract(day from next_capsule_at)::smallint
where recurrence_interval = 'yearly';

update groups set reminder_lead_hours = 24
where recurrence_interval <> 'manual';
```

`recurrence_paused_at` stays `null` for all existing groups (nothing is
paused by default).

`notifications_type_check` is extended with `'group_capsule_upcoming'` in
the same migration (mirrors the existing `group_capsule` addition).

## Scheduling engine

A pure module, `src/lib/recurrence.ts`, exports:

```ts
type RecurrenceInterval = 'weekly' | 'monthly' | 'yearly' | 'manual';

interface RecurrenceAnchor {
  weekday?: number;    // 0-6, required for 'weekly'
  dayOfMonth?: number; // 1-31, required for 'monthly'
  month?: number;      // 1-12, required for 'yearly'
  day?: number;        // 1-31, required for 'yearly'
}

function computeNextOccurrence(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
): Date | null; // null for 'manual' (no schedule)

function computeUpcomingOccurrences(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
  count: number,
): Date[]; // always length `count`, empty array for 'manual'
```

`computeNextOccurrence` always returns a date strictly after `from`.

**Clamping:** if `anchor.dayOfMonth` (monthly) or `anchor.day` (yearly)
exceeds the number of days in the target month, the occurrence clamps to
that month's last valid day (e.g. anchor day 31 in April → Apr 30; anchor
Feb 29 in a non-leap year → Feb 28). The clamp is computed per-occurrence
from the unchanged stored anchor value — a later cycle landing in a longer
month (or a leap year) uses the full anchor again, it doesn't stay stuck at
the clamped value.

**Duplication note:** this module is duplicated verbatim inside the
`create-group-capsules` edge function (Deno can't import from `src/lib`) —
same precedent already established for `awardPool.ts` in that function.

### Pause / resume

`src/lib/groups.ts` adds:

```ts
function pauseGroupRecurrence(groupId: string): Promise<{ error?: string }>;
function resumeGroupRecurrence(groupId: string): Promise<{ error?: string }>;
```

`pauseGroupRecurrence` sets `recurrence_paused_at = now()`.
`resumeGroupRecurrence` clears `recurrence_paused_at` **and** recomputes
`next_capsule_at = computeNextOccurrence(interval, anchor, now())` — i.e.
jumps to the next real occurrence from the moment of resuming, rather than
firing once immediately for however many cycles were missed while paused.
It also nulls `next_reminder_sent_at` (see Reminders) since `next_capsule_at`
just changed.

The cron's existing claim query (`create-group-capsules`) adds
`and recurrence_paused_at is null` to its `next_capsule_at <= now()` filter,
so a paused group's `next_capsule_at` simply stops advancing — no backlog of
missed cycles accumulates.

### Preview

Purely client-side, no new RPC or network round-trip:
`computeUpcomingOccurrences(interval, anchor, new Date(), 3)` run directly
against the group row's own columns (already fetched by `getGroup`/
`listMyGroups`). Both `GroupDetailScreen` (read-only) and
`ManageGroupScreen` (editable context) call the same function, so the
preview is always live and reflects the current pause state without a
fetch.

## Reminders

New notification type `group_capsule_upcoming` — `capsule_id` is `null`
(the capsule doesn't exist yet), body references the group name and when
the next capsule fires (e.g. "New capsule for Smith Family Reunions in 2
days").

`create-group-capsules` gets a new pass **before** its existing claim-and-
create pass, using the same atomic claim-and-stamp pattern as
`unlock-capsules`' tiered reminders:

```sql
update groups
set next_reminder_sent_at = now()
where recurrence_paused_at is null
  and reminder_lead_hours is not null
  and next_capsule_at is not null
  and next_capsule_at > now()
  and next_capsule_at <= now() + (reminder_lead_hours || ' hours')::interval
  and next_reminder_sent_at is null
returning id, name, next_capsule_at;
```

For each claimed row, the function inserts one `group_capsule_upcoming`
notification per joined `group_members` row and sends a push via the
existing `sendExpoPush()` ≤100-message-chunk helper already in this
function.

**`next_reminder_sent_at` must be explicitly reset to `null`** at every site
that changes `next_capsule_at` — it does not go stale on its own:
1. The cron's own capsule-creation pass, right after it advances
   `next_capsule_at` for the next cycle.
2. `CreateScreen`'s manual-create reschedule (the existing "bump
   `next_capsule_at` forward" side effect when a member manually starts a
   capsule for a recurring group) — this also switches from "+interval from
   now" math to `computeNextOccurrence(interval, anchor, now())`.
3. `resumeGroupRecurrence` (see above).

**Push routing:** the native push tap handler
(`usePushNotifications.native.ts`) currently only routes `data.capsuleId`.
It gets a new branch: if the payload carries `data.groupId` (and no
`capsuleId`), navigate to `GroupDetail` instead. `NotificationsScreen` gets
a matching render branch for `group_capsule_upcoming` (icon: `time-outline`,
tap → `GroupDetail`).

## UI

**`CreateGroupScreen`** — once weekly/monthly/yearly is picked (the
existing chip row is unchanged), an anchor sub-picker appears:
- weekly → 7-day chip row (Sun–Sat), defaults to today's weekday
- monthly → a horizontal-scroll day-of-month chip row (1–31), defaults to
  today's day-of-month, with helper text ("if a month is shorter, the last
  day of that month is used") shown only when a day >28 is selected
- yearly → a compact month grid (reusing `DatePicker`'s month-picker
  layout) followed by a day grid constrained to the chosen month's day
  count, defaulting to today's month/day
- manual → no anchor UI (unchanged)

A reminder-lead chip row is added regardless of interval (hidden for
`manual`): **Off / 1 day / 3 days / 1 week**, mapping to
`reminder_lead_hours` of `null / 24 / 72 / 168`.

**`ManageGroupScreen`** — same anchor editor and reminder chip row (both
editable, creator-only, matching this screen's existing gating), plus:
- an "Upcoming capsules" read-only list rendering
  `computeUpcomingOccurrences(..., 3)`, or "Paused" if
  `recurrence_paused_at` is set
- a Pause/Resume switch, calling `pauseGroupRecurrence`/
  `resumeGroupRecurrence`, toasting on failure (matching this codebase's
  "any user-initiated mutation that fails must toast" rule)

**`GroupDetailScreen`** — a read-only line under the group header: "Next:
`<date>`" or "Paused" (same preview function, non-editable — editing stays
exclusively in `ManageGroupScreen`, consistent with how every other
creator-only action in Groups is already gated).

## Rollout

One migration (columns + `CHECK` constraints + `notifications_type_check`
update + backfill) ships together with the `create-group-capsules`
redeploy (new reminder pass, paused-filter on the existing claim, anchor-
aware next-occurrence math replacing the old "+interval" math), then the
client update — same migration-plus-function-redeploy sequencing already
used elsewhere in this codebase (e.g. `home_layout`).

## Testing / edge cases to verify

- Monthly anchor day 31 lands on Apr 30 in April, then correctly uses day
  31 again in May (clamp doesn't stick).
- Yearly anchor Feb 29 clamps to Feb 28 in a non-leap year, uses Feb 29
  correctly in a leap year.
- Pausing mid-cycle then resuming produces a `next_capsule_at` computed
  from resume-time — this can land sooner than the originally-scheduled
  date (e.g. weekly anchor Sunday, resuming Tuesday jumps to the *next*
  Sunday, which may be less than a full week from now) — this is correct,
  expected behavior, not a bug to fix.
- The reminder claim query cannot double-send within one lead window
  across overlapping cron ticks (verified by the atomic
  claim-and-stamp `update ... returning`).
- Post-migration sanity check: every existing group's `next_capsule_at`
  value is byte-identical before and after the migration (only new anchor
  metadata is added; the migration never writes `next_capsule_at` itself).
- `CreateScreen`'s manual-create reschedule path uses the new
  `computeNextOccurrence` math instead of the old "+interval from now" and
  also resets `next_reminder_sent_at`.
