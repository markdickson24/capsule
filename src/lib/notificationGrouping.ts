// Pure grouping/labelling for the Alerts tab (NotificationsScreen). No
// react-native import — asserted under Tier 0 in notificationGrouping.test.ts.
//
// Two notification types are collapsed into ONE card per capsule:
//  - `reaction`: every reaction writes its own row; the card shows a count.
//  - `unlock_reminder`: the unlock-capsules cron writes a row per lead-time
//    tier (1 day / 1 hour / 10 minutes, see crons-and-notifications.md), and
//    the rows carry no tier info. Rendered individually they read as three
//    identical "X is unlocking soon" cards. A re-armed capsule (the App Store
//    reviewer countdown) piles up even more across re-arms.
// The newest row of a group represents it. Dismissing a group must mark every
// row in it read — the screen's persistRead sweeps (user, capsule, type,
// read_at is null, sent_at <= representative.sent_at), which is exactly the
// set collapsed here.

export const GROUPED_PER_CAPSULE_TYPES = ['reaction', 'unlock_reminder'] as const;

type GroupableRow = { type: string; capsule_id: string | null; sent_at: string };

export function isGroupedPerCapsule(row: { type: string; capsule_id: string | null }): boolean {
  return (
    !!row.capsule_id &&
    (GROUPED_PER_CAPSULE_TYPES as readonly string[]).includes(row.type)
  );
}

/** List key: one stable key per collapsed group, the row id otherwise. */
export function notificationKey(row: { id: string; type: string; capsule_id: string | null }): string {
  return isGroupedPerCapsule(row) ? `${row.type}-${row.capsule_id}` : row.id;
}

/**
 * Collapse per-capsule groups (newest row wins, `groupCount` = rows folded in)
 * and sort newest first. `reactionCount` is kept for reaction groups because
 * the card copy reads it.
 */
export function groupNotifications<T extends GroupableRow>(
  raw: T[],
): (T & { groupCount?: number; reactionCount?: number })[] {
  const display: (T & { groupCount?: number; reactionCount?: number })[] = [];
  const groups = new Map<string, { latest: T; count: number }>();

  for (const n of raw) {
    if (isGroupedPerCapsule(n)) {
      const key = `${n.type}-${n.capsule_id}`;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { latest: n, count: 1 });
      } else {
        g.count++;
        if (n.sent_at > g.latest.sent_at) g.latest = n;
      }
    } else {
      display.push(n);
    }
  }

  for (const { latest, count } of groups.values()) {
    display.push(
      latest.type === 'reaction'
        ? { ...latest, groupCount: count, reactionCount: count }
        : { ...latest, groupCount: count },
    );
  }

  display.sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
  return display;
}

/**
 * Card copy after the capsule title for an `unlock_reminder`, computed from
 * the capsule's CURRENT unlock_at (the row itself has no tier). Phrasing
 * mirrors the push body's formatRemaining in supabase/functions/unlock-capsules.
 */
export function unlockReminderText(unlockAt: string | null | undefined, nowMs: number): string {
  if (!unlockAt) return 'is unlocking soon';
  const unlockMs = new Date(unlockAt).getTime();
  if (Number.isNaN(unlockMs)) return 'is unlocking soon';
  const min = Math.round((unlockMs - nowMs) / 60_000);
  if (min <= 0) return 'has unlocked';
  if (min >= 36 * 60) return `unlocks in ${Math.round(min / (24 * 60))} days`;
  if (min >= 20 * 60) return 'unlocks tomorrow';
  if (min >= 90) return `unlocks in about ${Math.round(min / 60)} hours`;
  if (min >= 45) return 'unlocks in about an hour';
  if (min >= 2) return `unlocks in ${min} minutes`;
  return 'unlocks in moments';
}
