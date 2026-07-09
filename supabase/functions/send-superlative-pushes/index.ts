import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');

type Row = {
  id: string;
  user_id: string;
  capsule_id: string;
  type: 'superlative_suggested' | 'superlative_closing_soon' | 'superlative_won';
  capsules: { title: string } | null;
  users: { push_token: string | null } | null;
};

// Expo's push API rejects a request with more than 100 messages (the whole batch
// fails), so chunk into ≤100-message requests, sequentially.
async function sendExpoPush(messages: object[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

function buildPayload(row: Row): { title: string; body: string } | null {
  const capsuleTitle = row.capsules?.title ?? 'a capsule';
  switch (row.type) {
    case 'superlative_suggested':
      return {
        title: '🏆 New award category',
        body: `Someone suggested an award in "${capsuleTitle}". Upvote it to start voting.`,
      };
    case 'superlative_closing_soon':
      return {
        title: '⏰ 2 hours left to vote',
        body: `Voting on "${capsuleTitle}" closes in 2 hours.`,
      };
    case 'superlative_won':
      return {
        title: '🏆 You won an award!',
        body: `Check out your win in "${capsuleTitle}".`,
      };
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: notifs, error } = await supabase
    .from('notifications')
    .select('id, user_id, capsule_id, type, capsules(title), users(push_token)')
    .is('pushed_at', null)
    .in('type', ['superlative_suggested', 'superlative_closing_soon', 'superlative_won'])
    .limit(200);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!notifs?.length) {
    return new Response(JSON.stringify({ pushed: 0 }));
  }

  const rows = notifs as unknown as Row[];
  const messages: object[] = [];

  for (const row of rows) {
    const token = row.users?.push_token;
    if (!token) continue;

    const payload = buildPayload(row);
    if (!payload) continue;

    messages.push({
      to: token,
      title: payload.title,
      body: payload.body,
      data: { capsuleId: row.capsule_id, type: row.type },
      sound: 'default',
    });
  }

  if (messages.length > 0) {
    await sendExpoPush(messages);
  }

  // Mark every row we processed (including ones without a push_token) so the
  // dispatcher does not loop on them forever.
  await supabase
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', rows.map(r => r.id));

  return new Response(
    JSON.stringify({ checked: rows.length, pushed: messages.length })
  );
});
