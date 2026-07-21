import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * RevenueCat webhook → mirrors the "Capsule Pro" entitlement into
 * users.subscription_tier ('pro' | 'free'), which the RLS policies read as the
 * server-side source of truth for Pro-gated limits. The client's
 * useEntitlements()/isProActive() is UI-only; THIS is the real gate.
 *
 * Auth: RevenueCat sends the value configured as the webhook's "Authorization
 * header" verbatim in the `Authorization` header. We compare it against the
 * REVENUECAT_WEBHOOK_SECRET Edge Function secret. Deployed with
 * verify_jwt=false (RevenueCat doesn't send a Supabase JWT).
 *
 * app_user_id: we call Purchases.logIn(<supabase user id>) on the client
 * (see src/lib/purchases.native.ts → identifyUser), so app_user_id is the
 * Supabase users.id UUID. Purchases made while still anonymous
 * ($RCAnonymousID:...) are merged into that id by logIn, and RevenueCat then
 * emits a TRANSFER we handle below — so we never need to resolve anon ids.
 *
 * Design: we interpret the event type rather than calling back into the
 * RevenueCat API, so the function is fully self-contained (no RC secret key,
 * no extra round-trip). CANCELLATION and BILLING_ISSUE deliberately do NOT
 * revoke — access continues until the entitlement actually EXPIRES.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const PRO_ENTITLEMENT_ID = 'Capsule Pro';

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

// Events that mean "this user should have Pro now".
const GRANT = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE', // lifetime
  'SUBSCRIPTION_EXTENDED',
]);

// Events that mean "this user has lost access".
const REVOKE = new Set([
  'EXPIRATION',
  'SUBSCRIPTION_PAUSED',
]);

// A RevenueCat app_user_id we actually store on users.id is a UUID. Anything
// else (anonymous ids, aliases) is ignored — the matching TRANSFER carries the
// real id.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setTier(userId: string | null | undefined, tier: 'pro' | 'free') {
  if (!userId || !UUID_RE.test(userId)) return;
  const { error } = await admin
    .from('users')
    .update({ subscription_tier: tier })
    .eq('id', userId);
  if (error) console.warn(`[rc-webhook] setTier(${userId}, ${tier}) failed:`, error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Authenticate the webhook via the shared secret. If the secret is unset we
  // fail closed (401) rather than accepting unauthenticated writes.
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const provided = req.headers.get('Authorization') ?? '';
  if (!expected || provided !== expected) return json({ error: 'Unauthorized' }, 401);

  let event: any;
  try {
    ({ event } = await req.json());
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }
  if (!event?.type) return json({ error: 'Missing event' }, 400);

  const type: string = event.type;

  // Entitlement filter: when the payload names entitlements, only act if ours
  // is among them. TRANSFER/EXPIRATION always carry the relevant ids; grant
  // events for our single entitlement always include it.
  const ids: string[] | null = event.entitlement_ids ?? null;
  const touchesPro = ids === null || ids.includes(PRO_ENTITLEMENT_ID);

  if (type === 'TRANSFER') {
    // Entitlement moved between app_user_ids (e.g. anon → identified on logIn,
    // or across two real accounts). Grant the destination, revoke the origin.
    const to: string[] = event.transferred_to ?? [];
    const from: string[] = event.transferred_from ?? [];
    await Promise.all([
      ...to.map((id) => setTier(id, 'pro')),
      ...from.map((id) => setTier(id, 'free')),
    ]);
    return json({ ok: true, handled: 'TRANSFER', to: to.length, from: from.length });
  }

  if (type === 'TEST') return json({ ok: true, handled: 'TEST' });

  if (!touchesPro) return json({ ok: true, handled: 'ignored (other entitlement)' });

  if (GRANT.has(type)) {
    await setTier(event.app_user_id, 'pro');
    return json({ ok: true, handled: type, tier: 'pro' });
  }
  if (REVOKE.has(type)) {
    await setTier(event.app_user_id, 'free');
    return json({ ok: true, handled: type, tier: 'free' });
  }

  // CANCELLATION (auto-renew off, still entitled), BILLING_ISSUE (grace),
  // SUBSCRIBER_ALIAS, etc. — no tier change.
  return json({ ok: true, handled: `${type} (no-op)` });
});
