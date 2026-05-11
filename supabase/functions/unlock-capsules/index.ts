import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  // Flip all active capsules whose unlock time has passed
  const { data: unlocked, error } = await supabase
    .from('capsules')
    .update({ status: 'unlocked' })
    .eq('status', 'active')
    .lte('unlock_at', new Date().toISOString())
    .select('id, title');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!unlocked?.length) {
    return new Response(JSON.stringify({ unlocked: 0 }));
  }

  // Collect push tokens for all members of unlocked capsules
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
        body: `"${capsule.title}" is now unlocked — go see what's inside.`,
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
