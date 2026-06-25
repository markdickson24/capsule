import { supabase } from './supabase';
import { sessionStore } from './sessionStore';
import { randomUUID } from './uuid';

export type GroupRecurrence = 'weekly' | 'monthly' | 'yearly' | 'manual';

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
}

export interface GroupMemberProfile {
  user_id: string;
  joined_at: string;
  users: { display_name: string | null; avatar_url: string | null } | null;
}

function myId() { return sessionStore.get()?.user?.id ?? null; }

export async function listMyGroups(): Promise<GroupRow[]> {
  const me = myId();
  if (!me) return [];

  const { data } = await supabase
    .from('group_members')
    .select('group_id, groups(id, name, created_by, recurrence_interval, unlock_duration_hours, next_capsule_at, last_capsule_at, created_at)')
    .eq('user_id', me);

  if (!data || data.length === 0) return [];

  const groupIds = data.map((r: any) => r.group_id as string);
  const { data: counts } = await supabase
    .from('group_members')
    .select('group_id')
    .in('group_id', groupIds);

  const countMap: Record<string, number> = {};
  (counts ?? []).forEach((r: any) => {
    countMap[r.group_id] = (countMap[r.group_id] ?? 0) + 1;
  });

  return data
    .map((r: any) => r.groups)
    .filter(Boolean)
    .map((g: any) => ({ ...g, memberCount: countMap[g.id] ?? 1 }));
}

export async function getGroup(groupId: string): Promise<GroupRow | null> {
  const { data } = await supabase
    .from('groups')
    .select('id, name, created_by, recurrence_interval, unlock_duration_hours, next_capsule_at, last_capsule_at, created_at')
    .eq('id', groupId)
    .single();

  if (!data) return null;

  const { data: counts } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', groupId);

  return { ...data, recurrence_interval: data.recurrence_interval as GroupRecurrence, memberCount: counts?.length ?? 1 };
}

export async function getGroupMembers(groupId: string): Promise<GroupMemberProfile[]> {
  const { data } = await supabase
    .from('group_members')
    .select('user_id, joined_at, users(display_name, avatar_url)')
    .eq('group_id', groupId);
  return (data ?? []) as GroupMemberProfile[];
}

export async function createGroup(params: {
  name: string;
  memberIds: string[];
  recurrence: GroupRecurrence;
  unlockDurationHours: number;
}): Promise<{ groupId?: string; error?: string }> {
  const me = myId();
  if (!me) return { error: 'Not signed in' };

  const groupId = randomUUID();
  const nextCapsuleAt = params.recurrence !== 'manual'
    ? calcNextCapsuleAt(new Date(), params.recurrence).toISOString()
    : null;

  const { error } = await supabase.from('groups').insert({
    id: groupId,
    name: params.name.trim(),
    created_by: me,
    recurrence_interval: params.recurrence,
    unlock_duration_hours: params.unlockDurationHours,
    next_capsule_at: nextCapsuleAt,
  });

  if (error) return { error: 'Could not create group.' };

  const members = [me, ...params.memberIds.filter(id => id !== me)].map(uid => ({
    group_id: groupId,
    user_id: uid,
  }));
  await supabase.from('group_members').insert(members);

  return { groupId };
}

export async function updateGroup(groupId: string, updates: {
  name?: string;
  recurrence?: GroupRecurrence;
  unlockDurationHours?: number;
}): Promise<{ error?: string }> {
  type GroupPatch = {
    name?: string;
    recurrence_interval?: string;
    next_capsule_at?: string | null;
    unlock_duration_hours?: number;
  };
  const patch: GroupPatch = {};
  if (updates.name) patch.name = updates.name.trim();
  if (updates.recurrence) {
    patch.recurrence_interval = updates.recurrence;
    patch.next_capsule_at = updates.recurrence !== 'manual'
      ? calcNextCapsuleAt(new Date(), updates.recurrence).toISOString()
      : null;
  }
  if (updates.unlockDurationHours) patch.unlock_duration_hours = updates.unlockDurationHours;

  const { error } = await supabase.from('groups').update(patch as any).eq('id', groupId);
  return error ? { error: 'Could not update group.' } : {};
}

export async function deleteGroup(groupId: string): Promise<void> {
  await supabase.from('groups').delete().eq('id', groupId);
}

export async function addGroupMember(groupId: string, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, user_id: userId });
  if (error && error.code !== '23505') return { error: 'Could not add member.' };
  return {};
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
}

export function calcNextCapsuleAt(from: Date, interval: GroupRecurrence): Date {
  const d = new Date(from);
  if (interval === 'weekly') d.setDate(d.getDate() + 7);
  else if (interval === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (interval === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d;
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
