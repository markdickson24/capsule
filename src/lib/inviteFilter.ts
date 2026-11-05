// Alerts tab "N invites" pill: tapping it narrows the list to pending invites,
// tapping again shows everything. Kept pure so the rule is testable.

type FilterableNotification = { type: string; capsule_id: string | null };

/**
 * The filter only applies while there is something to filter to — once the
 * last pending invite is accepted or declined the pill disappears, and the
 * list must not be left stuck showing nothing.
 */
export function inviteFilterActive(requested: boolean, pendingCount: number): boolean {
  return requested && pendingCount > 0;
}

/**
 * Notifications to render. With the filter on, only invite cards whose
 * capsule membership is still pending (the same set the pill counts).
 */
export function visibleNotifications<T extends FilterableNotification>(
  all: T[],
  pendingMap: Record<string, string>,
  onlyInvites: boolean,
): T[] {
  if (!onlyInvites) return all;
  return all.filter(n => n.type === 'invite' && !!n.capsule_id && !!pendingMap[n.capsule_id]);
}
