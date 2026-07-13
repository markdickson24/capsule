import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

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

function monthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// GROUPS.md #8 — group capsules have no `occasion` (that column drives the
// wedding/vacation/etc. themed pools; groups are recurring and general-purpose),
// so this mirrors src/lib/awardPool.ts's `general` pool verbatim. The client's
// set_default_superlatives RPC authorizes `auth.uid() = owner_id`, which the
// service-role cron can't satisfy — so these are inserted directly as `live`
// rows here instead of going through that RPC.
const GENERAL_AWARD_POOL: { label: string; target_type: 'person' | 'media' }[] = [
  { label: 'Best photo', target_type: 'media' },
  { label: 'Funniest moment', target_type: 'media' },
  { label: 'Life of the group', target_type: 'person' },
  { label: 'Best candid', target_type: 'media' },
  { label: 'Most likely to be late', target_type: 'person' },
  { label: 'Biggest jokester', target_type: 'person' },
  { label: 'Best group shot', target_type: 'media' },
  { label: 'Most photogenic', target_type: 'person' },
  { label: 'Most memorable moment', target_type: 'media' },
  { label: 'Best vibe', target_type: 'person' },
];

function pickDefaultAwards(count = 4) {
  const pool = [...GENERAL_AWARD_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Validates the Bearer token by calling a SECURITY DEFINER RPC that reads from
// Vault — no CRON_SECRET env var required on the function itself.
async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer /, '');
  if (!token) return false;
  const { data } = await supabase.rpc('check_cron_secret', { provided: token });
  return data === true;
}

// GROUPS.md #4 — Expo rejects a request carrying >100 messages and drops the
// WHOLE batch, so a 100+ member group would silently get zero pushes. Slice
// into ≤100-message requests, posted sequentially (matches unlock-capsules /
// send-superlative-pushes' sendExpoPush).
async function sendExpoPush(messages: object[]) {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

async function sendPushes(tokens: string[], groupName: string, capsuleId: string) {
  const messages = tokens.filter(t => t.startsWith('ExponentPushToken[')).map(to => ({
    to,
    title: groupName,
    body: `A new capsule has been started — add your memories!`,
    data: { capsuleId },
    sound: 'default' as const,
  }));
  if (messages.length === 0) return;
  await sendExpoPush(messages);
}

// Restore a group's schedule stamps after a mid-create failure, so the capsule
// that couldn't be built is retried on the next tick rather than silently
// skipped (GROUPS.md #3).
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

  const capsuleId = crypto.randomUUID();
  const unlockAt = new Date(now.getTime() + group.unlock_duration_hours * 3_600_000);

  const { error: capsuleErr } = await supabase.from('capsules').insert({
    id: capsuleId,
    owner_id: group.created_by,
    title: `${group.name} — ${monthYear(now)}`,
    status: 'active',
    visibility: 'invite',
    unlock_at: unlockAt.toISOString(),
    unlock_mode: 'time',
    group_id: group.id,
    owner_preview_locked: true,
  });
  if (capsuleErr) {
    console.error(`capsule insert failed for group ${group.id}:`, capsuleErr.message);
    await releaseClaim(group.id, group.next_capsule_at, group.last_capsule_at, group.next_reminder_sent_at);
    return;
  }

  const { data: groupMembers, error: membersErr } = await supabase
    .from('group_members')
    .select('user_id, users(push_token)')
    .eq('group_id', group.id);

  if (membersErr || !groupMembers || groupMembers.length === 0) {
    // Can't populate the capsule — a members-less capsule is invisible to
    // everyone (capsules SELECT is membership-gated with no owner fallback).
    // Roll it back and release the claim so the cycle retries.
    console.error(`members fetch empty/failed for group ${group.id}:`, membersErr?.message);
    await supabase.from('capsules').delete().eq('id', capsuleId);
    await releaseClaim(group.id, group.next_capsule_at, group.last_capsule_at, group.next_reminder_sent_at);
    return;
  }

  const capsuleMembers = groupMembers.map((m: any) => ({
    capsule_id: capsuleId,
    user_id: m.user_id,
    role: m.user_id === group.created_by ? 'owner' : 'contributor',
    joined_at: nowIso,
  }));
  const { error: cmErr } = await supabase.from('capsule_members').insert(capsuleMembers);
  if (cmErr) {
    // GROUPS.md #3 — the critical rollback: without members the capsule is
    // orphaned and unreachable even by its owner.
    console.error(`capsule_members insert failed for group ${group.id}:`, cmErr.message);
    await supabase.from('capsules').delete().eq('id', capsuleId);
    await releaseClaim(group.id, group.next_capsule_at, group.last_capsule_at, group.next_reminder_sent_at);
    return;
  }

  // GROUPS.md #6 — the notify_on_invite trigger (fired by the capsule_members
  // insert above, every row already joined) now emits one `group_capsule`
  // notification per non-owner member itself, so no separate insert here —
  // that used to double as a fake pending "invite" card for members who were
  // never actually pending.
  const { error: awardsErr } = await supabase.from('superlative_categories').insert(
    pickDefaultAwards().map(a => ({
      capsule_id: capsuleId,
      suggested_by: group.created_by,
      label: a.label,
      target_type: a.target_type,
      status: 'live',
      is_default: true,
      promoted_at: nowIso,
    }))
  );
  // Non-fatal: the capsule/membership are intact; the owner can still seed
  // awards manually from the capsule's pre-unlock DefaultAwardsCard.
  if (awardsErr) console.error(`default awards insert failed for group ${group.id}:`, awardsErr.message);

  const tokens: string[] = groupMembers.map((m: any) => m.users?.push_token).filter(Boolean);
  await sendPushes(tokens, group.name, capsuleId);
}

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

Deno.serve(async (req: Request) => {
  if (!await isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date().toISOString();

  await processReminders();

  const { data: dueGroups, error } = await supabase
    .from('groups')
    .select(
      'id, name, created_by, recurrence_interval, unlock_duration_hours, next_capsule_at, last_capsule_at, ' +
      'anchor_weekday, anchor_day_of_month, anchor_month, anchor_day, anchor_hour, anchor_minute, next_reminder_sent_at'
    )
    .neq('recurrence_interval', 'manual')
    .is('recurrence_paused_at', null)
    .lte('next_capsule_at', now);

  if (error) {
    console.error('fetch due groups failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const groups = dueGroups ?? [];
  console.log(`create-group-capsules: ${groups.length} group(s) due`);

  for (const group of groups) {
    await processGroup(group);
  }

  return new Response(JSON.stringify({ processed: groups.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
