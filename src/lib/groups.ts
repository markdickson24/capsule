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
}): Promise<{ groupId?: string; error?: string; memberError?: boolean }> {
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
    const { error: memberErr } = await supabase.from('group_members').insert(
      otherIds.map(uid => ({ group_id: groupId, user_id: uid }))
    );
    // Group + creator already exist and are usable — don't fail the whole
    // create, but don't silently drop the picked members either. The caller
    // surfaces this as a toast (the group itself is fine to land on).
    if (memberErr) return { groupId, memberError: true };
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
