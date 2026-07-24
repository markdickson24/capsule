// Pure decision layer for the iOS Live Activity countdown. No React, no
// react-native, no network — so it runs under plain `npx tsx` in the test file
// next to it. Everything here works in absolute instants (Date objects /
// ISO strings), never local calendar fields, so it's timezone-independent.

export type LiveActivityCapsuleRow = {
  id: string;
  title: string;
  status: string;
  created_at: string | null;
  contribution_start_at: string | null;
  contribution_lock_at: string | null;
  unlock_at: string | null;
  live_activity_enabled: boolean;
  /** The viewing member's own capsule_members.live_activity_override. null = inherit. */
  live_activity_override: boolean | null;
};

export type DesiredActivity = {
  capsuleId: string;
  title: string;
  /** Lower bound of the progress bar. */
  windowStart: Date;
  /** What the countdown counts down to, and the activity's staleDate. */
  deadline: Date;
};

export type Reconciliation = {
  /** Desired but not currently running — call start() for these. */
  toStart: DesiredActivity[];
  /** Running but no longer desired — call end() for these capsule ids. */
  toEnd: string[];
  /** Desired and already running — candidates for an update(). */
  alreadyRunning: DesiredActivity[];
};

/** A member's own override beats the capsule default, in both directions. */
export function effectiveLiveActivityEnabled(row: LiveActivityCapsuleRow): boolean {
  return row.live_activity_override ?? row.live_activity_enabled;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  // An Invalid Date would otherwise flow into the native layer and render a
  // nonsense countdown, so treat unparseable input as "no date".
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * What the countdown counts down to: the uploads deadline. Falls back to
 * unlock_at when the capsule has no separate contribution deadline (the
 * common case — uploads then close at the moment of reveal).
 */
export function liveActivityDeadline(row: LiveActivityCapsuleRow): Date | null {
  // If contribution_lock_at is provided (non-null), use it (or null if invalid).
  // Only fall back to unlock_at if contribution_lock_at is explicitly null.
  if (row.contribution_lock_at !== null) {
    return parseDate(row.contribution_lock_at);
  }
  return parseDate(row.unlock_at);
}

/**
 * Lower bound of the progress bar: when the capsule opened for photos. Falls
 * back to created_at, since a capsule with no start date accepts uploads from
 * the moment it exists.
 */
export function liveActivityWindowStart(row: LiveActivityCapsuleRow): Date | null {
  return parseDate(row.contribution_start_at) ?? parseDate(row.created_at);
}

/**
 * The capsules that should have a Live Activity running right now: opted in,
 * still active, and inside their contribution window.
 */
export function desiredActivities(
  rows: LiveActivityCapsuleRow[],
  now: Date
): DesiredActivity[] {
  const out: DesiredActivity[] = [];

  for (const row of rows) {
    if (!effectiveLiveActivityEnabled(row)) continue;
    if (row.status === 'unlocked') continue;

    const deadline = liveActivityDeadline(row);
    if (!deadline) continue;
    // At-or-past the deadline the countdown reads zero — nothing to show.
    if (deadline.getTime() <= now.getTime()) continue;

    const windowStart = liveActivityWindowStart(row);
    if (!windowStart) continue;
    // Pre-start capsules accept no uploads from anyone, owner included, so a
    // camera button would be a lie.
    if (windowStart.getTime() > now.getTime()) continue;

    out.push({ capsuleId: row.id, title: row.title, windowStart, deadline });
  }

  return out;
}

/**
 * Diff desired state against what the OS reports as actually running.
 *
 * `activeCapsuleIds` must come from the native Activity.activities list, not
 * from a JS-side mirror: iOS can dismiss an activity on its own (user swipe,
 * 12h expiry, force-quit) and a mirror would drift, then try to update
 * something that no longer exists.
 */
export function reconcileActivities(
  desired: DesiredActivity[],
  activeCapsuleIds: string[]
): Reconciliation {
  const active = new Set(activeCapsuleIds);
  const desiredIds = new Set(desired.map(d => d.capsuleId));

  return {
    toStart: desired.filter(d => !active.has(d.capsuleId)),
    // Set iteration dedupes, so a duplicate active id can't produce two end()s.
    toEnd: [...active].filter(id => !desiredIds.has(id)),
    alreadyRunning: desired.filter(d => active.has(d.capsuleId)),
  };
}
