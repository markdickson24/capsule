import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');
let lastCallTime = 0;
const RATE_LIMIT_MS = 55_000;

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = Date.now();
  if (now - lastCallTime < RATE_LIMIT_MS) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 });
  }
  lastCallTime = now;

  const { data: unlocked, error } = await supabase
    .from('capsules')
    .update({ status: 'unlocked' })
    .eq('status', 'active')
    .eq('unlock_mode', 'time')
    .lte('unlock_at', new Date().toISOString())
    .select('id, title');

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  if (!unlocked?.length) {
    return new Response(JSON.stringify({ unlocked: 0 }));
  }

  const messages: object[] = [];

  for (const capsule of unlocked) {
    const { data: members } = await supabase
      .from('capsule_members')
      .select('users(push_token)')
      .eq('capsule_id', capsule.id)
      .not('joined_at', 'is', null);

    const tokens: string[] = (members ?? [])
      .map((m: any) => m.users?.push_token)
      .filter(Boolean);

    for (const token of tokens) {
      messages.push({
        to: token,
        title: '🔓 Your capsule just opened!',
        body: `"${capsule.title}" is unlocked — see what's inside and vote on awards.`,
        data: { capsuleId: capsule.id },
        sound: 'default',
      });
    }
  }

  if (messages.length) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  }

  return new Response(
    JSON.stringify({ unlocked: unlocked.length, notified: messages.length })
  );
});
