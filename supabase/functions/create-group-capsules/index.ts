import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

type GroupRecurrence = 'weekly' | 'monthly' | 'yearly' | 'manual';

function calcNextAt(from: Date, interval: GroupRecurrence): Date {
  const d = new Date(from);
  if (interval === 'weekly') d.setDate(d.getDate() + 7);
  else if (interval === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (interval === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d;
}

function monthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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

async function sendPushes(tokens: string[], groupName: string, capsuleId: string) {
  const messages = tokens.filter(t => t.startsWith('ExponentPushToken[')).map(to => ({
    to,
    title: groupName,
    body: `A new capsule has been started — add your memories!`,
    data: { capsuleId },
    sound: 'default' as const,
  }));
  if (messages.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
}

async function processGroup(group: any) {
  const now = new Date();
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
    return;
  }

  const { data: groupMembers } = await supabase
    .from('group_members')
    .select('user_id, users(push_token)')
    .eq('group_id', group.id);

  if (!groupMembers || groupMembers.length === 0) return;

  const capsuleMembers = groupMembers.map((m: any) => ({
    capsule_id: capsuleId,
    user_id: m.user_id,
    role: m.user_id === group.created_by ? 'owner' : 'contributor',
    joined_at: now.toISOString(),
  }));
  await supabase.from('capsule_members').insert(capsuleMembers);

  const nonOwnerMembers = groupMembers.filter((m: any) => m.user_id !== group.created_by);
  if (nonOwnerMembers.length > 0) {
    await supabase.from('notifications').insert(
      nonOwnerMembers.map((m: any) => ({
        user_id: m.user_id,
        capsule_id: capsuleId,
        actor_id: group.created_by,
        type: 'invite',
        pushed_at: now.toISOString(),
      }))
    );
  }

  const nextAt = calcNextAt(now, group.recurrence_interval as GroupRecurrence);
  await supabase
    .from('groups')
    .update({
      last_capsule_at: now.toISOString(),
      next_capsule_at: nextAt.toISOString(),
    })
    .eq('id', group.id);

  const tokens: string[] = groupMembers.map((m: any) => m.users?.push_token).filter(Boolean);
  await sendPushes(tokens, group.name, capsuleId);
}

Deno.serve(async (req: Request) => {
  if (!await isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date().toISOString();

  const { data: dueGroups, error } = await supabase
    .from('groups')
    .select('id, name, created_by, recurrence_interval, unlock_duration_hours')
    .neq('recurrence_interval', 'manual')
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
