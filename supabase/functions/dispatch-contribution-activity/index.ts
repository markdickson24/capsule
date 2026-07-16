import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const DEBOUNCE_MS = 2 * 60 * 1000;

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

// Expo rejects a request carrying >100 messages and drops the WHOLE batch —
// slice into ≤100-message requests, posted sequentially (matches
// unlock-capsules / create-group-capsules' sendExpoPush).
async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Atomically claim every pending row whose debounce window has elapsed.
  // A DELETE...RETURNING can't be claimed twice by an overlapping tick.
  const cutoff = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const { data: due, error } = await supabase
    .from('contribution_activity_pending')
    .delete()
    .lte('last_upload_at', cutoff)
    .select('capsule_id, uploader_id, photo_count');

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  const messages: ExpoMessage[] = [];
  let notified = 0;

  for (const row of due ?? []) {
    const { data: capsule } = await supabase
      .from('capsules')
      .select('title')
      .eq('id', row.capsule_id)
      .single();
    if (!capsule) continue;

    const { data: uploader } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', row.uploader_id)
      .single();
    const uploaderName = uploader?.display_name ?? 'Someone';

    const { data: members } = await supabase
      .from('capsule_members')
      .select('user_id, users(push_token)')
      .eq('capsule_id', row.capsule_id)
      .not('joined_at', 'is', null)
      .neq('user_id', row.uploader_id);

    // Never tell a recipient about activity from someone they've blocked.
    const { data: blockedBy } = await supabase
      .from('blocked_users')
      .select('blocker_id')
      .eq('blocked_id', row.uploader_id);
    const blockedByIds = new Set((blockedBy ?? []).map((b: any) => b.blocker_id));
    const recipients = (members ?? []).filter((m: any) => !blockedByIds.has(m.user_id));
    if (recipients.length === 0) continue;

    const photoWord = row.photo_count === 1 ? 'photo' : 'photos';
    const body = `${uploaderName} added ${row.photo_count} ${photoWord} to "${capsule.title}"`;

    const rows = recipients.map((m: any) => ({
      user_id: m.user_id,
      capsule_id: row.capsule_id,
      actor_id: row.uploader_id,
      type: 'contribution_activity',
      count: row.photo_count,
      pushed_at: new Date().toISOString(),
    }));
    await supabase.from('notifications').insert(rows);
    notified += rows.length;

    for (const m of recipients as any[]) {
      const token = m.users?.push_token;
      if (token) {
        messages.push({
          to: token,
          title: '📸 New photos added',
          body,
          data: { capsuleId: row.capsule_id },
          sound: 'default',
        });
      }
    }
  }

  if (messages.length) {
    await sendExpoPush(messages);
  }

  return new Response(JSON.stringify({ claimed: due?.length ?? 0, notified }));
});
