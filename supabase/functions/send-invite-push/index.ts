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

  // Group-capsule members are auto-joined (standing consent), not pending
  // invitees — the "you were invited" copy would be misleading since there's
  // nothing to accept. groups is embedded above purely for this wording.
  const groupName = (capsule as any).groups?.name as string | undefined;
  const isGroupCapsule = !!capsule.group_id;

  // Cheap per-capsule rate limit. The dedupe claim below caps each invite to
  // one push ever, but the caller owns this capsule, so they can also delete
  // their own capsule_members row (capsule_members_delete policy: capsule_id
  // in the caller's own capsules) and re-insert it to mint a fresh
  // invite_pushed_at IS NULL row and push again. Bounding recent pushes per
  // capsule closes that loop without any new infrastructure — it reuses the
  // same invite_pushed_at column and table.
  const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
  const RATE_LIMIT_MAX = 8;
  const { count: recentPushCount, error: rateError } = await admin
    .from('capsule_members')
    .select('id', { count: 'exact', head: true })
    .eq('capsule_id', capsuleId)
    .gte('invite_pushed_at', new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString());
  if (!rateError && (recentPushCount ?? 0) >= RATE_LIMIT_MAX) {
    return json({ error: 'Too many invite pushes for this capsule — try again shortly' }, 429);
  }

  // Atomically claim this invite's one-time push. A legitimate push target is
  // either a genuinely pending direct invite (joined_at IS NULL) or a
  // group-capsule auto-join (joined_at IS NOT NULL, standing consent — see
  // CLAUDE.md "Groups"). "A member row exists" alone is NOT enough: the
  // capsule owner can manufacture a row for any user id via
  // can_insert_capsule_member and then invoke this function directly for an
  // unlimited-push primitive against a victim whose UUID they merely know
  // (`users` SELECT policy is USING (true)). joined_at is reliable here
  // because only the invitee themselves can ever flip it — the
  // capsule_members UPDATE policy is `user_id = auth.uid()`, so the inviter
  // can't fake "already joined" to dodge this check for a direct invite, nor
  // fake "still pending" to push a group member repeatedly.
  //
  // invite_pushed_at IS NULL in the same UPDATE...WHERE makes the claim
  // atomic/race-safe and caps each invite to exactly one push — the same
  // claim-and-stamp idiom used by unlock-capsules' dispatchReminders and
  // dispatch-capsule-start.
  let claimQuery = admin
    .from('capsule_members')
    .update({ invite_pushed_at: new Date().toISOString() })
    .eq('capsule_id', capsuleId)
    .eq('user_id', inviteeId)
    .is('invite_pushed_at', null);
  claimQuery = isGroupCapsule
    ? claimQuery.not('joined_at', 'is', null)
    : claimQuery.is('joined_at', null);

  const { data: claimed, error: claimError } = await claimQuery.select('id').maybeSingle();
  if (claimError) return json({ error: 'Internal error' }, 500);
  // Either no eligible member row (arbitrary/manufactured recipient, or a
  // direct invite that's already been accepted) or this invite already
  // pushed once — both are indistinguishable to the caller by design.
  if (!claimed) return json({ sent: false });

  const [{ data: invitee }, { data: inviter }] = await Promise.all([
    admin.from('users').select('push_token').eq('id', inviteeId).single(),
    admin.from('users').select('display_name').eq('id', user.id).single(),
  ]);

  const token = invitee?.push_token;
  if (!token) return json({ sent: false }); // invitee has no push token — nothing to do

  // Title is always a fixed, app-branded string — never user-authored input.
  // groupName/capsule.title/inviter display name are confined to the body,
  // so an attacker who controls a group name can't turn this into a
  // phishing primitive delivered through the OS notification's most
  // prominent (title) text.
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: isGroupCapsule ? 'New group capsule' : 'You were invited to a Capsule!',
      body: isGroupCapsule
        ? `A new capsule was started for ${groupName ?? 'your group'} — add your memories!`
        : `${inviter?.display_name ?? 'Someone'} invited you to "${capsule.title}"`,
      data: { screen: 'Notifications' },
      sound: 'default',
    }),
  });

  return json({ sent: true });
});
