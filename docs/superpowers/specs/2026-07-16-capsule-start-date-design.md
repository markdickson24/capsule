# Capsule Start Date — Design Spec

**Date:** 2026-07-16
**Status:** Approved, ready for implementation plan

## Context

Capsules currently have a fixed set of temporal bounds: `contribution_lock_at` (optional — when uploads stop) and `unlock_at` (when the capsule reveals). There is no notion of a *start* — contributions are allowed from the moment a capsule is created, which doesn't fit the "planning ahead for a future event" use case: creating a capsule for a trip or weekend that hasn't happened yet, where nobody should be able to add photos until the event actually begins.

This spec adds `contribution_start_at` — the mirror image of `contribution_lock_at` — plus the countdown UI, validation, and notification that go with it.

## Goals

- An optional start date on a capsule. Before it arrives, nobody (including the owner) can add photos/videos.
- Visible "Capsule starts in 4 days" countdown copy on both the Home card and Capsule Detail screen.
- A near-term-friendly date picker (quick presets like "This weekend," not just 1/3/6-month options).
- A push + in-app notification the moment the start date arrives, telling members contributions are now open.

## Non-goals

- No change to `contribution_lock_at`'s existing owner-exemption behavior — that field is untouched.
- No new capsule status; `status` stays `active` throughout (start/lock/unlock are independent temporal gates, not state-machine transitions).
- No reminder tiers before start (unlike `unlock_reminder`'s 1d/1h/10m tiers) — just a single notification the moment it actually starts.

## Data model

```sql
alter table public.capsules
  add column contribution_start_at timestamptz,          -- nullable; null = starts immediately (today's behavior)
  add column contribution_start_notified_at timestamptz; -- dedup stamp for the "it's started" push
```

Purely additive, nullable, backward compatible — existing capsules are unaffected. Applies regardless of `unlock_mode` (time/proximity/both), same reasoning as `contribution_lock_at`: a proximity-unlock capsule can still have a calendar-based contribution start.

## Enforcement (RLS, both layers — mirrors `contribution_lock_at` exactly)

1. `media` table INSERT policy gains: `AND (contribution_start_at IS NULL OR now() >= contribution_start_at)`.
2. `storage.objects` INSERT policy for the `capsule-media` bucket gains the identical check (extracting `capsule_id` from the path's first folder segment, same as the existing `contribution_lock_at` check there).

**No owner exemption** — deliberately different from `contribution_lock_at`'s `isOwner || ...` pattern. The semantic here is "the event hasn't happened yet," which applies to everyone including the owner; `contribution_lock_at`'s owner exemption is about sealing-before-reveal, a different concern.

## Client UI

### Create / Edit screens

New **"Starts"** field, **above the fold** next to Unlock date (not tucked into "More options" — this is a headline use case per the brainstorm, not a rare power-user setting). Reuses `DatePickerField` with `optional` (unset by default — costs nothing to leave alone):

```tsx
<DatePickerField
  label="Starts"
  optional
  value={startDate}
  onChange={setStartDate}
  contextLabel="No one can add photos until this date"
  tooltip={{
    title: 'Start Date',
    body: 'Nobody — including you — can add photos or videos until this date arrives. Useful for planning a capsule ahead of an event or trip that hasn\'t happened yet.\n\nLeave it off to let people start adding photos right away.',
  }}
/>
```

**New near-term quick presets specific to this field** — "Tomorrow," "This weekend," "In 3 days," "In 1 week" — since the existing 1/3/6-month/1-year presets (used by Unlock date and Uploads Deadline) don't fit a near-term event-planning framing. `DatePicker`/`DatePickerField` needs a way to accept a caller-supplied preset set rather than always using the hardcoded month/year presets.

**Validation** (both `CreateScreen` and `EditCapsuleScreen`, mirroring the existing `contribLockDate >= unlockDate` check style):
- `startDate >= unlockDate` → `"Start date must be before the unlock date."`
- `startDate >= contribLockDate` (only when both are set) → `"Start date must be before the uploads deadline."`

`CreateScreen` gets the richer per-field-error + tooltip + scroll-to-field version (matching its existing pattern for `contribLockDate`); `EditCapsuleScreen` gets the simpler generic-error version (matching its existing, less elaborate pattern for the same field).

### CapsuleDetail pre-start state

Computed alongside the existing `contributionLocked`:
```ts
const notStartedYet = capsule.contribution_start_at
  ? new Date(capsule.contribution_start_at) > new Date()
  : false;
const canUpload = !notStartedYet && (isOwner || (myRole === 'contributor' && !contributionLocked));
```

Unlike `contributionLocked`'s current behavior (the upload area silently unmounts with zero explanation — confirmed via direct code inspection, a real gap in the existing pattern), the pre-start state renders a **dedicated card** in place of the upload area:

> 🗓️ **Capsule starts in 4 days**
> Photos can be added starting [date]

This is deliberate: the whole point of this feature is visible countdown messaging, so silently hiding the upload button (as `contributionLocked` does today) would undercut the feature's purpose.

### HomeScreen countdown badge

`HomeScreen`'s capsule list query needs `contribution_start_at` added to its `capsules(...)` embed (it currently selects no contribution-related fields at all). `CountdownBadge` gains a new branch, checked **before** its existing logic:

```
now() < contribution_start_at  → "Starts in 4 days" (new copy + icon, e.g. calendar-outline)
otherwise                       → existing logic unchanged (proximity "Unlocks together", or countdown to unlock_at)
```

Once the start date passes, the badge falls through to existing behavior automatically — no extra state transition to manage.

## "It's started" notification

New notification type: `capsule_started`. **Before writing this migration, re-verify the current `notifications_type_check` definition against the live production DB** (`pg_get_constraintdef`), not against git history — this codebase has a confirmed, recurring pattern of the live constraint carrying types not yet present in any committed migration (hit for real during the contribution-nudges work: production already had `group_capsule_upcoming` from an unmerged branch). Reconcile the migration's `array[...]`/`in (...)` list against whatever's actually live, not the last migration file in git.

New self-contained edge function + per-minute cron, `dispatch-capsule-start` — architecturally identical to `dispatch-contribution-activity`/`contribution-nudges` (claim-and-stamp, then push, all in one tick, no delegation to a shared dispatcher):

```sql
update public.capsules
set contribution_start_notified_at = now()
where contribution_start_at is not null
  and contribution_start_at <= now()
  and contribution_start_notified_at is null
  and status = 'active'
returning id, title;
```

For each claimed capsule, **every joined member** (owner included — no exemption, matching the enforcement decision above) gets a durable notification row + push:
- Push: *"📸 [Capsule title] is open for photos!"* / *"Add your photos and videos now."*
- `NotificationsScreen` renders `capsule_started` with a `camera-outline` icon, tap → `CapsuleDetail`.

Cron is `EXISTS`-gated the same way as every other per-minute cron in this codebase (PERFORMANCE.md #4 pattern): zero `net.http_post` cost when no capsule is due.

## Decisions log (from brainstorming)

| Question | Decision |
|---|---|
| What does "starts" control? | Contributions blocked until the date — a real functional gate, not just cosmetic countdown copy. |
| Countdown display location | Both Home card and Capsule Detail. |
| Field placement | Above the fold on Create, next to Unlock date — not buried in "More options." |
| Start notification | Yes — push + in-app the moment it starts, mirroring the unlock push's shape (not tiered reminders). |
| Date presets | New near-term presets ("This weekend," "In 3 days," etc.) specific to this field. |
| Owner exemption | None — applies to everyone, including the owner (deliberately different from `contribution_lock_at`'s existing owner exemption). |

## Testing

Same approach as the contribution-nudges work: apply the migration to an ephemeral Supabase branch, seed fixture capsules/members, exercise the RLS enforcement and the cron function's claim/push logic directly via `execute_sql`/direct function invocation before touching production. Client-side: `npx tsc --noEmit` for type safety (no test framework in this repo, per CLAUDE.md), plus manual verification in the running app per the `verify` skill — create a capsule with a near-future start date, confirm the upload area is replaced by the pre-start card, confirm the Home badge shows "Starts in N days," and confirm the notification fires once the start time passes.
