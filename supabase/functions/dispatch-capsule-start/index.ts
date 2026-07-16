import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

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

  // Atomically claim every capsule whose start date has arrived and hasn't
  // been notified yet. UPDATE...RETURNING means an overlapping tick can't
  // double-send — a second call matches zero rows for already-claimed capsules.
  const { data: due, error } = await supabase
    .from('capsules')
    .update({ contribution_start_notified_at: new Date().toISOString() })
    .not('contribution_start_at', 'is', null)
    .lte('contribution_start_at', new Date().toISOString())
    .is('contribution_start_notified_at', null)
    .eq('status', 'active')
    .select('id, title');

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  const messages: ExpoMessage[] = [];
  let notified = 0;

  for (const capsule of due ?? []) {
    const { data: members } = await supabase
      .from('capsule_members')
      .select('user_id, users(push_token)')
      .eq('capsule_id', capsule.id)
      .not('joined_at', 'is', null);

    const rows = (members ?? []).map((m: any) => ({
      user_id: m.user_id,
      capsule_id: capsule.id,
      type: 'capsule_started',
      pushed_at: new Date().toISOString(),
    }));
    if (rows.length) {
      await supabase.from('notifications').insert(rows);
      notified += rows.length;
    }

    for (const m of (members ?? []) as any[]) {
      const token = m.users?.push_token;
      if (token) {
        messages.push({
          to: token,
          title: '📸 Time to start adding photos',
          body: `"${capsule.title}" is open for photos now!`,
          data: { capsuleId: capsule.id },
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
