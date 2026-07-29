import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  isProActive,
  PRO_ENTITLEMENT_ID,
  RC_PROJECT_ID,
} from './entitlements.ts';

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
 * Design: grant events are interpreted from the event type alone, so the
 * money-in path stays fully self-contained (no RC API call). Most
 * access-removing events are not: CANCELLATION, EXPIRATION and
 * REFUND_REVERSED are verified against the RevenueCat API rather than
 * inferred, because the event type alone does not determine access (see the
 * VERIFY set below) — REFUND_REVERSED is actually access-*restoring*, the one
 * verified event that can move in the grant direction. BILLING_ISSUE
 * deliberately does NOT revoke — a grace period still means the user is
 * entitled. SUBSCRIPTION_PAUSED is the one event still blind-revoked with no
 * API round-trip (see the REVOKE set below).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Read-only RevenueCat v2 key (customer_information:customers:read). Set as a
// Supabase Edge Function secret. Absent = every verification fails loud with a
// 500 rather than silently falling back to guessing a tier.
const RC_API_KEY = Deno.env.get('REVENUECAT_API_KEY');

/**
 * Ask RevenueCat whether this customer currently holds Capsule Pro.
 *
 * Throws on any failure — unset key, non-2xx, network error, malformed body.
 * The caller turns that into a 500 so RevenueCat retries, because guessing is
 * never safe: defaulting to revoke strips a paying customer on a transient
 * blip, and defaulting to grant leaves a refunder entitled.
 */
async function proActiveForCustomer(appUserId: string): Promise<boolean> {
  if (!RC_API_KEY) throw new Error('REVENUECAT_API_KEY is not set');

  const url =
    `https://api.revenuecat.com/v2/projects/${RC_PROJECT_ID}` +
    `/customers/${encodeURIComponent(appUserId)}/active_entitlements`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${RC_API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`RevenueCat API ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  // Throws if `items` is missing or malformed — see isProActive's doc comment.
  return isProActive(body?.items);
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Constant-time string compare — avoids leaking the secret via response timing.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
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

// Events that mean "this user has lost access" with no ambiguity worth an API
// round-trip. SUBSCRIPTION_PAUSED is Google Play only and cannot fire on the
// App Store; when Android ships, move it into VERIFY below.
const REVOKE = new Set([
  'SUBSCRIPTION_PAUSED',
]);

// Events where the event type alone does NOT determine access, so we ask
// RevenueCat and mirror whatever it reports.
//
//  CANCELLATION     - a refund arrives as CANCELLATION with
//                     cancellation_reason CUSTOMER_SUPPORT. A refunded
//                     NON_RENEWING (lifetime) purchase has no EXPIRATION event
//                     to ever clean it up, so treating this as a no-op left a
//                     refunded customer entitled forever. A plain auto-renew-off
//                     cancellation verifies as still-active and changes nothing.
//  EXPIRATION       - blind revoking here loses a race: a resubscribe whose old
//                     EXPIRATION lands after the new INITIAL_PURCHASE would
//                     strip a paying customer until their next RENEWAL.
//  REFUND_REVERSED  - Apple reversed a refund. Rare, and carries no reliable
//                     signal about whether entitlement was actually restored.
const VERIFY = new Set([
  'CANCELLATION',
  'EXPIRATION',
  'REFUND_REVERSED',
]);

// A RevenueCat app_user_id we actually store on users.id is a UUID. Anything
// else (anonymous ids, aliases) is ignored — the matching TRANSFER carries the
// real id.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns true on success (including the no-op skip for a non-UUID id, which
// is correct behavior, not a failure). Returns false only when the DB write
// itself failed — callers must turn that into a 500 so RevenueCat retries;
// supabase-js v2 returns fetch failures as `{error}` rather than throwing, so
// a swallowed error here would otherwise return 200 with no row written (see
// Finding 1 in the 2026-07-29 review).
async function setTier(userId: string | null | undefined, tier: 'pro' | 'free'): Promise<boolean> {
  if (!userId || !UUID_RE.test(userId)) return true;
  const { error } = await admin
    .from('users')
    .update({ subscription_tier: tier })
    .eq('id', userId);
  if (error) {
    console.warn(`[rc-webhook] setTier(${userId}, ${tier}) failed:`, error.message);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Authenticate the webhook via the shared secret. If the secret is unset we
  // fail closed (401) rather than accepting unauthenticated writes.
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const provided = req.headers.get('Authorization') ?? '';
  if (!expected || !timingSafeEqual(provided, expected)) return json({ error: 'Unauthorized' }, 401);

  let event: any;
  try {
    ({ event } = await req.json());
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }
  if (!event?.type) return json({ error: 'Missing event' }, 400);

  // Only production purchases mirror into subscription_tier. Test Store /
  // sandbox events (environment SANDBOX) must never grant real Pro. RevenueCat
  // sends event.environment on store events; TEST pings omit it and are handled
  // below, so gate only when the field is present and non-production.
  const environment: string | undefined = event.environment;
  if (environment && environment !== 'PRODUCTION') {
    return json({ ok: true, handled: `ignored (${environment})` });
  }

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
    const results = await Promise.all([
      ...to.map((id) => setTier(id, 'pro')),
      ...from.map((id) => setTier(id, 'free')),
    ]);
    if (results.some((ok) => !ok)) {
      console.error(`[rc-webhook] TRANSFER: one or more setTier writes failed`);
      return json({ error: 'write failed' }, 500);
    }
    return json({ ok: true, handled: 'TRANSFER', to: to.length, from: from.length });
  }

  if (type === 'TEST') return json({ ok: true, handled: 'TEST' });

  if (!touchesPro) return json({ ok: true, handled: 'ignored (other entitlement)' });

  if (VERIFY.has(type)) {
    const userId: string | undefined = event.app_user_id;
    // Anonymous / alias ids are never rows in public.users; the matching
    // TRANSFER carries the real id. Skip without burning an API call.
    if (!userId || !UUID_RE.test(userId)) {
      return json({ ok: true, handled: `${type} (non-uuid app_user_id)` });
    }

    let active: boolean;
    try {
      active = await proActiveForCustomer(userId);
    } catch (e) {
      // Do NOT touch the tier. 500 makes RevenueCat retry (5 attempts over
      // ~2.5h); a wrong guess in either direction is worse than a delay.
      console.error(
        `[rc-webhook] ${type} verification failed for ${userId}:`,
        e instanceof Error ? e.message : e
      );
      return json({ error: 'verification failed' }, 500);
    }

    const wrote = await setTier(userId, active ? 'pro' : 'free');
    if (!wrote) {
      console.error(`[rc-webhook] ${type}: setTier(${userId}) DB write failed`);
      return json({ error: 'write failed' }, 500);
    }
    return json({ ok: true, handled: type, tier: active ? 'pro' : 'free', verified: true });
  }

  if (GRANT.has(type)) {
    const wrote = await setTier(event.app_user_id, 'pro');
    if (!wrote) {
      console.error(`[rc-webhook] ${type}: setTier(${event.app_user_id}) DB write failed`);
      return json({ error: 'write failed' }, 500);
    }
    return json({ ok: true, handled: type, tier: 'pro' });
  }
  if (REVOKE.has(type)) {
    const wrote = await setTier(event.app_user_id, 'free');
    if (!wrote) {
      console.error(`[rc-webhook] ${type}: setTier(${event.app_user_id}) DB write failed`);
      return json({ error: 'write failed' }, 500);
    }
    return json({ ok: true, handled: type, tier: 'free' });
  }

  // BILLING_ISSUE (grace period — still entitled), SUBSCRIBER_ALIAS,
  // INVOICE_ISSUANCE, paywall events, etc. — no tier change.
  return json({ ok: true, handled: `${type} (no-op)` });
});
