import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Sends the "you were invited" push notification server-side, so the client
// never needs read access to other users' push_token. Invoked by the inviter
// right after the capsule_members row is inserted.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Identify the caller from their JWT.
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let capsuleId: string, inviteeId: string;
  try {
    ({ capsuleId, inviteeId } = await req.json());
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }
  if (!capsuleId || !inviteeId) return json({ error: 'Missing capsuleId or inviteeId' }, 400);

  // The caller must own the capsule they're inviting into.
  const { data: capsule } = await admin
    .from('capsules')
    .select('title, owner_id, group_id, groups(name)')
    .eq('id', capsuleId)
    .single();
  if (!capsule || capsule.owner_id !== user.id) return json({ error: 'Forbidden' }, 403);

  // The invitee must actually be a member row of this capsule — prevents
  // using this endpoint to push arbitrary users.
  const { data: member } = await admin
    .from('capsule_members')
    .select('id')
    .eq('capsule_id', capsuleId)
    .eq('user_id', inviteeId)
    .maybeSingle();
  if (!member) return json({ error: 'Invitee is not a member of this capsule' }, 400);

  const [{ data: invitee }, { data: inviter }] = await Promise.all([
    admin.from('users').select('push_token').eq('id', inviteeId).single(),
    admin.from('users').select('display_name').eq('id', user.id).single(),
  ]);

  const token = invitee?.push_token;
  if (!token) return json({ sent: false }); // invitee has no push token — nothing to do

  // Group-capsule members are auto-joined (standing consent), not pending
  // invitees — the "you were invited" copy would be misleading since there's
  // nothing to accept. groups is embedded above purely for this wording.
  const groupName = (capsule as any).groups?.name as string | undefined;
  const isGroupCapsule = !!capsule.group_id;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: isGroupCapsule ? (groupName ?? 'New group capsule') : 'You were invited to a Capsule!',
      body: isGroupCapsule
        ? `A new capsule was started for ${groupName ?? 'your group'} — add your memories!`
        : `${inviter?.display_name ?? 'Someone'} invited you to "${capsule.title}"`,
      data: { screen: 'Notifications' },
      sound: 'default',
    }),
  });

  return json({ sent: true });
});
