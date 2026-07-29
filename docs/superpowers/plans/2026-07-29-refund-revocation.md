# Refund Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a refunded customer actually lose Capsule Pro, by verifying every access-removing RevenueCat webhook against the RevenueCat API instead of guessing from the event type.

**Architecture:** `supabase/functions/revenuecat-webhook` keeps its existing self-contained fast path for grant events. Three events that can remove access — `CANCELLATION`, `EXPIRATION`, `REFUND_REVERSED` — instead call `GET /v2/…/active_entitlements` and mirror whatever RevenueCat reports. The pure decision (does this response mean Pro?) lives in its own module so it can be unit-tested under Node, since the edge function itself only runs under Deno.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, RevenueCat REST API v2, `node:assert/strict` + `npx tsx` for tests.

Spec: `docs/superpowers/specs/2026-07-29-refund-revocation-design.md`

## Global Constraints

- **Two different identifiers for one entitlement.** Webhook payloads carry the lookup key `Capsule Pro` in `event.entitlement_ids`. The v2 REST API returns the object id `entl2d972407b4` in `active_entitlements[].entitlement_id`. Never compare an API response against the lookup key.
- **Never guess a tier.** On any verification failure, leave `subscription_tier` untouched and return HTTP 500. RevenueCat retries non-200 five times at 5/10/20/40/80 minutes.
- **Grant events are not touched.** `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_EXTENDED` keep their existing behavior.
- **`SUBSCRIPTION_PAUSED` stays in `REVOKE` untouched.** It is Google Play only and cannot fire on iOS. Deliberate deferral, documented in the spec.
- RevenueCat project id: `proj72b0a2e3`. Supabase project ref: `ezxxvvmesegegkdeniri`. Entitlement object id: `entl2d972407b4`.
- The function is deployed with `verify_jwt: false` and must stay that way — RevenueCat sends no Supabase JWT.
- Tests are bare `node:assert/strict` scripts run with `npx tsx <file>`, ending in a `console.log('<name>: all assertions passed')` line. This repo has no test framework, by design.
- **Do not use `facade01-0000-4000-8000-000000000001` ("Alex", App Store reviewer) or `0f581d0e-1449-44b7-8ddf-4432584acf42` ("Mark") as test targets.** Both are `subscription_tier = 'pro'` comp grants with no purchase behind them; a test that flips them would revoke real comp access.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/revenuecat-webhook/entitlements.ts` | **New.** Pure, Deno-global-free: the entitlement constants and `isProActive()`. Importable by both the Deno function and a Node test. |
| `supabase/functions/revenuecat-webhook/entitlements.test.ts` | **New.** Unit tests for `isProActive()`. Not imported by `index.ts`, so it is inert in the deploy bundle. |
| `supabase/functions/revenuecat-webhook/index.ts` | **Modify.** Import the constants, add the API call, route the three verified events, handle failure as 500. |
| `CLAUDE.md` | **Modify.** Document the new behavior and the two-identifier trap under "Monetization → Server-side gate". |

---

## Task 1: Pure entitlement check

**Files:**
- Create: `supabase/functions/revenuecat-webhook/entitlements.ts`
- Test: `supabase/functions/revenuecat-webhook/entitlements.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RC_PROJECT_ID: string`, `PRO_ENTITLEMENT_ID: string`, `PRO_ENTITLEMENT_OBJECT_ID: string`, `isProActive(items: unknown): boolean` (throws `TypeError` when `items` is not an array).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/revenuecat-webhook/entitlements.test.ts`:

```ts
import assert from 'node:assert/strict';
import {
  isProActive,
  PRO_ENTITLEMENT_ID,
  PRO_ENTITLEMENT_OBJECT_ID,
} from './entitlements.ts';

// The two identifiers are genuinely different strings. If these ever become
// equal, the regression test below stops testing anything.
assert.notEqual(PRO_ENTITLEMENT_ID, PRO_ENTITLEMENT_OBJECT_ID);

// Pro present -> active. Shape copied verbatim from a live probe of
// GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements.
assert.equal(
  isProActive([
    { entitlement_id: 'entl2d972407b4', expires_at: 1785339831934, object: 'customer.active_entitlement' },
  ]),
  true
);

// A lifetime grant has no expiry. Presence alone must still be enough —
// isProActive must not do any date arithmetic.
assert.equal(
  isProActive([{ entitlement_id: 'entl2d972407b4', expires_at: null, object: 'customer.active_entitlement' }]),
  true
);

// Empty list -> not active. This is the refund case: RevenueCat only lists
// entitlements it considers currently active, so a refunded one is absent.
assert.equal(isProActive([]), false);

// A different entitlement does not count.
assert.equal(isProActive([{ entitlement_id: 'entl_somethingelse' }]), false);

// Pro alongside others -> active.
assert.equal(
  isProActive([{ entitlement_id: 'entl_other' }, { entitlement_id: 'entl2d972407b4' }]),
  true
);

// REGRESSION: the v2 API returns the OBJECT ID, never the lookup key.
// If isProActive were written against PRO_ENTITLEMENT_ID ('Capsule Pro'),
// every real response would read as "not active" and every CANCELLATION /
// EXPIRATION would revoke Pro from every paying customer.
assert.equal(isProActive([{ entitlement_id: PRO_ENTITLEMENT_ID }]), false);
assert.equal(isProActive([{ entitlement_id: 'Capsule Pro' }]), false);

// Junk elements must not throw — only a non-array `items` does.
assert.equal(isProActive([null, undefined, 'nope', 42]), false);
assert.equal(isProActive([null, { entitlement_id: 'entl2d972407b4' }]), true);

// A malformed body must NOT read as "no entitlement". Returning false here
// would revoke a paying customer on a bad response; throwing lets the caller
// turn it into a 500 and let RevenueCat retry.
assert.throws(() => isProActive(undefined), TypeError);
assert.throws(() => isProActive(null), TypeError);
assert.throws(() => isProActive({ items: [] }), TypeError);
assert.throws(() => isProActive('items'), TypeError);

console.log('entitlements.test.ts: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx supabase/functions/revenuecat-webhook/entitlements.test.ts
```

Expected: FAIL — `Cannot find module './entitlements.ts'` (the module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/revenuecat-webhook/entitlements.ts`:

```ts
/**
 * Pure helpers for the RevenueCat webhook.
 *
 * Deliberately free of Deno globals (no `Deno.env`, no remote imports) so this
 * file can be imported by BOTH the edge function (Deno) and
 * entitlements.test.ts (Node, via `npx tsx`).
 */

/** The RevenueCat project that owns the Capsule Pro entitlement. */
export const RC_PROJECT_ID = 'proj72b0a2e3';

/**
 * The entitlement's LOOKUP KEY.
 *
 * This is what WEBHOOK PAYLOADS carry in `event.entitlement_ids`.
 * It is NOT what the v2 REST API returns. See PRO_ENTITLEMENT_OBJECT_ID.
 */
export const PRO_ENTITLEMENT_ID = 'Capsule Pro';

/**
 * The entitlement's OBJECT ID.
 *
 * This is what the v2 REST API returns in
 * `active_entitlements[].entitlement_id` (confirmed against the live API,
 * 2026-07-29). It is NOT the lookup key.
 *
 * These are two different strings for the same entitlement. Comparing an API
 * response against PRO_ENTITLEMENT_ID never matches, which would make every
 * verification report "not active" and revoke Pro from every paying customer —
 * strictly worse than the refund bug this exists to fix.
 */
export const PRO_ENTITLEMENT_OBJECT_ID = 'entl2d972407b4';

/**
 * True iff Capsule Pro appears in a v2 `active_entitlements` list.
 *
 * Presence is the whole check. RevenueCat only lists entitlements it considers
 * currently active, so a refunded or expired one is simply absent — no date
 * arithmetic, and no assumption about how a refund is represented.
 *
 * Throws when `items` is not an array. That matters: a malformed response must
 * not be indistinguishable from "no entitlement", or a bad API response would
 * silently revoke a paying customer.
 */
export function isProActive(items: unknown): boolean {
  if (!Array.isArray(items)) {
    throw new TypeError('active_entitlements: expected an items array');
  }
  return items.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as { entitlement_id?: unknown }).entitlement_id === PRO_ENTITLEMENT_OBJECT_ID
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx supabase/functions/revenuecat-webhook/entitlements.test.ts
```

Expected: PASS — prints `entitlements.test.ts: all assertions passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/revenuecat-webhook/entitlements.ts \
        supabase/functions/revenuecat-webhook/entitlements.test.ts
git commit -m "Add pure Capsule Pro entitlement check for webhook verification

The v2 REST API returns the entitlement OBJECT ID (entl2d972407b4), while
webhook payloads carry the LOOKUP KEY ('Capsule Pro'). Two constants, plus a
regression test asserting the lookup key does not match.

Throws on a non-array body so a malformed response can never be mistaken for
'no entitlement' and silently revoke a paying customer."
```

---

## Task 2: Verify before revoking

**Files:**
- Modify: `supabase/functions/revenuecat-webhook/index.ts`

**Interfaces:**
- Consumes: `isProActive`, `PRO_ENTITLEMENT_ID`, `RC_PROJECT_ID` from `./entitlements.ts` (Task 1). Not `PRO_ENTITLEMENT_OBJECT_ID` — that is used only inside `isProActive`, and `index.ts` must never compare against an entitlement id itself.
- Produces: the deployed handler behavior verified in Task 3. No new exports.

- [ ] **Step 1: Replace the local constant with the shared import**

In `index.ts`, delete this line (currently line 31):

```ts
const PRO_ENTITLEMENT_ID = 'Capsule Pro';
```

and add this import directly below the existing `createClient` import at the top of the file. **The `.ts` extension is required** — Deno does not resolve extensionless specifiers:

```ts
import {
  isProActive,
  PRO_ENTITLEMENT_ID,
  RC_PROJECT_ID,
} from './entitlements.ts';
```

- [ ] **Step 2: Add the API key and the verification call**

Immediately after the existing `admin` client declaration (currently lines 33-36), add:

```ts
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
```

- [ ] **Step 3: Re-scope the event sets**

Replace the existing `REVOKE` set (currently lines 65-69) with the following. `EXPIRATION` moves out to the verified set; `SUBSCRIPTION_PAUSED` stays a blind revoke because it is Google Play only and cannot fire on iOS (see the spec):

```ts
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
```

- [ ] **Step 4: Route the verified events**

In the request handler, insert this block **after** the `if (!touchesPro)` early return (currently line 135) and **before** `if (GRANT.has(type))` (currently line 137):

```ts
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

    await setTier(userId, active ? 'pro' : 'free');
    return json({ ok: true, handled: type, tier: active ? 'pro' : 'free', verified: true });
  }
```

- [ ] **Step 5: Update the stale trailing comment**

Replace the closing comment (currently lines 146-147), which still claims `CANCELLATION` is a no-op:

```ts
  // BILLING_ISSUE (grace period — still entitled), SUBSCRIBER_ALIAS,
  // INVOICE_ISSUANCE, paywall events, etc. — no tier change.
```

Also update the file's header comment: the block currently ending "CANCELLATION and BILLING_ISSUE deliberately do NOT revoke — access continues until the entitlement actually EXPIRES." is now wrong for CANCELLATION. Replace that sentence with:

```
 * BILLING_ISSUE deliberately does NOT revoke — a grace period still means the
 * user is entitled. CANCELLATION, EXPIRATION and REFUND_REVERSED are verified
 * against the RevenueCat API rather than inferred, because the event type alone
 * does not determine access (see the VERIFY set below).
```

- [ ] **Step 6: Type-check the changed function**

```bash
npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler \
  supabase/functions/revenuecat-webhook/entitlements.ts
```

Expected: no output (exit 0). Only `entitlements.ts` is checked — `index.ts` imports remote `https://esm.sh/...` URLs and uses the `Deno` global, neither of which `tsc` can resolve; it is validated by the deploy in Task 3 instead.

- [ ] **Step 7: Re-run the unit test**

```bash
npx tsx supabase/functions/revenuecat-webhook/entitlements.test.ts
```

Expected: PASS — `entitlements.test.ts: all assertions passed`. This confirms Step 1's import refactor did not change the constants.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/revenuecat-webhook/index.ts
git commit -m "Verify against RevenueCat before revoking Pro

CANCELLATION was an explicit no-op, so a refund never revoked. A refunded
lifetime purchase has no EXPIRATION event to clean it up, leaving the customer
entitled permanently.

CANCELLATION, EXPIRATION and REFUND_REVERSED now read the customer's live
active_entitlements and mirror it. Grant events keep their self-contained fast
path, so an API problem can never block the money-in path. Any verification
failure returns 500 and leaves the tier untouched for RevenueCat to retry."
```

---

## Task 3: Ship it and prove it works

**Files:**
- No source changes. Sets a secret, deploys, verifies against production.

**Interfaces:**
- Consumes: the deployed function from Task 2.
- Produces: a working production deployment. No code artifacts.

- [ ] **Step 1: Set the secret BEFORE deploying**

The function fails loud (500) without it, so order matters. There is no MCP tool for Supabase secrets — do it one of these two ways:

```bash
# If the Supabase CLI is installed and linked:
npx supabase secrets set REVENUECAT_API_KEY=<the sk_ read-only key> \
  --project-ref ezxxvvmesegegkdeniri
```

Otherwise: Supabase Dashboard → Project Settings → Edge Functions → Secrets → Add new secret, name `REVENUECAT_API_KEY`.

Use the **read-only** V2 key (`customer_information:customers:read`), not the full-access key from the RevenueCat MCP config.

- [ ] **Step 2: Verify the key is read-only before trusting it in production**

```bash
# Expect 200
curl -s -o /dev/null -w "read: %{http_code}\n" \
  -H "Authorization: Bearer $RC_KEY" \
  "https://api.revenuecat.com/v2/projects/proj72b0a2e3/customers/9583a6d3-3e7d-4139-b629-878d0f644074/active_entitlements"

# Expect 403 — proves it cannot write
curl -s -o /dev/null -w "write: %{http_code}\n" -X POST \
  -H "Authorization: Bearer $RC_KEY" -H "Content-Type: application/json" \
  -d '{"lookup_key":"scope_probe","display_name":"scope probe"}' \
  "https://api.revenuecat.com/v2/projects/proj72b0a2e3/entitlements"
```

Expected: `read: 200`, `write: 403`.

- [ ] **Step 3: Deploy**

Use `mcp__supabase__deploy_edge_function` with `project_id: ezxxvvmesegegkdeniri`, `name: revenuecat-webhook`, `entrypoint_path: index.ts`, **`verify_jwt: false`**, and BOTH files in `files`: `index.ts` and `entitlements.ts` (a missing `entitlements.ts` produces a module-resolution failure at cold start, not at deploy).

Do not include `entitlements.test.ts` — it imports `node:assert`, which does not resolve under Deno.

- [ ] **Step 4: Confirm the deploy is live and still auth-gated**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer definitely-not-the-secret" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"TEST"}}' \
  "https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/revenuecat-webhook"
```

Expected: `401`. A `500` here means `verify_jwt` was left on or the deploy is broken.

- [ ] **Step 5: End-to-end — a refund revokes**

Target `9583a6d3-3e7d-4139-b629-878d0f644074` ("dixonrffle1"): it is an existing RevenueCat customer whose `active_entitlements` is `[]`, and it is `subscription_tier = 'free'` in Supabase, so it starts and ends in the same state. **Do not substitute Alex or Mark** — both hold comp Pro that this would revoke.

Set it to `'pro'` so the flip is observable (service role via `mcp__supabase__execute_sql`; the `guard_subscription_tier` trigger blocks any client from doing this):

```sql
update public.users set subscription_tier = 'pro'
 where id = '9583a6d3-3e7d-4139-b629-878d0f644074';
```

Then POST a refund-shaped CANCELLATION, with `REVENUECAT_WEBHOOK_SECRET`'s value in `$WEBHOOK_SECRET`:

```bash
curl -s -X POST \
  -H "Authorization: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"CANCELLATION","cancellation_reason":"CUSTOMER_SUPPORT","environment":"PRODUCTION","app_user_id":"9583a6d3-3e7d-4139-b629-878d0f644074","entitlement_ids":["Capsule Pro"]}}' \
  "https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/revenuecat-webhook"
```

Expected body: `{"ok":true,"handled":"CANCELLATION","tier":"free","verified":true}`

Then confirm the database actually changed:

```sql
select id, subscription_tier from public.users
 where id = '9583a6d3-3e7d-4139-b629-878d0f644074';
```

Expected: `free`. If it still reads `pro`, the write failed — check the function logs.

- [ ] **Step 6: Confirm a grant event still works (no regression)**

```bash
curl -s -X POST \
  -H "Authorization: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"RENEWAL","environment":"PRODUCTION","app_user_id":"9583a6d3-3e7d-4139-b629-878d0f644074","entitlement_ids":["Capsule Pro"]}}' \
  "https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/revenuecat-webhook"
```

Expected body: `{"ok":true,"handled":"RENEWAL","tier":"pro"}` — no `verified` field, proving grants still take the fast path and make no API call.

- [ ] **Step 7: Restore the test user**

```sql
update public.users set subscription_tier = 'free'
 where id = '9583a6d3-3e7d-4139-b629-878d0f644074';
```

Then confirm nothing else drifted:

```sql
select id, display_name, subscription_tier from public.users
 where subscription_tier = 'pro' order by id;
```

Expected: exactly the two comp accounts — `facade01-0000-4000-8000-000000000001` (Alex) and `0f581d0e-1449-44b7-8ddf-4432584acf42` (Mark). If either is missing, restore it with an `update`.

- [ ] **Step 8: Commit**

No source changed in this task. If Steps 1-7 surfaced a fix, commit that; otherwise skip.

---

## Task 4: Document it

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1-3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the Monetization → Server-side gate section**

In `CLAUDE.md`, find the `revenuecat-webhook` bullet list under "Monetization → Server-side gate" — specifically the sentence reading "`CANCELLATION`/`BILLING_ISSUE` are deliberately **no-ops** — auto-renew-off or a billing grace period still means the user is entitled until an actual `EXPIRATION` arrives." Replace that sentence with:

```markdown
- **VERIFY set** (`CANCELLATION`, `EXPIRATION`, `REFUND_REVERSED`) does not infer
  anything from the event type: it calls
  `GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements` with the
  read-only `REVENUECAT_API_KEY` secret and mirrors whatever RevenueCat reports.
  A **refund** arrives as `CANCELLATION` with `cancellation_reason:
  CUSTOMER_SUPPORT`; treating that as a no-op meant a refunded customer kept Pro,
  and a refunded **lifetime** purchase has **no `EXPIRATION` event** to ever
  clean it up, so it kept Pro *permanently*. `EXPIRATION` verifies too, so a
  resubscribe whose old `EXPIRATION` lands after the new `INITIAL_PURCHASE`
  can't strip a paying customer. `BILLING_ISSUE` is still a plain no-op (grace
  period = still entitled).
  ⚠️ **The two surfaces use different identifiers for the same entitlement.**
  Webhook payloads carry the **lookup key** (`'Capsule Pro'`, matched against
  `event.entitlement_ids`); the v2 REST API returns the **object id**
  (`'entl2d972407b4'`) in `active_entitlements[].entitlement_id`. Hence two
  constants in `entitlements.ts`. Comparing an API response against the lookup
  key never matches, so every verification would report "not active" and revoke
  Pro from **every paying customer** — strictly worse than the bug this fixed,
  and invisible in a project with no purchases to test against.
  ⚠️ **Never guess a tier.** Any verification failure (unset key, non-2xx,
  malformed body) leaves `subscription_tier` untouched and returns **500** so
  RevenueCat retries (5 attempts over ~2.5h). `isProActive` *throws* rather than
  returning false on a malformed body precisely so a bad response can't be
  mistaken for "no entitlement" and silently revoke a paying customer.
  ⚠️ **`SUBSCRIPTION_PAUSED` is still a blind revoke** — it's **Google Play only**
  (Apple has no consumer pause), so it can't fire on iOS. When Android ships,
  move it into the VERIFY set: a pause is only *scheduled* at the event and the
  customer keeps access until the period actually ends.
  ⚠️ **Comp grants are not protected.** A tier set by direct DB write with no
  purchase behind it (the App Store reviewer account, support grants) would be
  revoked if a VERIFY event ever fired for that `app_user_id`, since RevenueCat
  correctly reports no entitlement. Not reachable without RevenueCat purchase
  activity on that account, but it's why comp accounts must never be used as
  webhook test targets.
```

- [ ] **Step 2: Add the new secret to the Environment section**

In `CLAUDE.md`'s Environment section, directly below the fenced `EXPO_PUBLIC_*` block, add:

```markdown
**Server-side secrets** (Supabase Edge Function secrets — never `EXPO_PUBLIC_`,
these must not reach the client bundle):

```
REVENUECAT_WEBHOOK_SECRET=...  # shared secret RevenueCat sends as the Authorization header
REVENUECAT_API_KEY=...         # RevenueCat V2 key, customer_information:customers:read ONLY
CRON_SECRET=...                # project-wide, read by every cron-triggered function
```

`REVENUECAT_API_KEY` must be the **read-only** V2 key, not the full-access key
used by the RevenueCat MCP — least privilege, since a leak of this one only
exposes customer entitlement reads. The webhook fails closed (500, tier
untouched, RevenueCat retries) when it is unset, so **set the secret before
deploying**.
```

- [ ] **Step 3: Verify the claims you just wrote**

Re-read the edited section against `supabase/functions/revenuecat-webhook/index.ts`. Every event name in the prose must match the actual `GRANT` / `REVOKE` / `VERIFY` sets, and `PRO_ENTITLEMENT_OBJECT_ID` must match `entitlements.ts`. CLAUDE.md is the source of truth for future sessions — a wrong claim here is worse than no claim.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document verify-before-revoke refund handling in CLAUDE.md

Covers the VERIFY set, the lookup-key vs object-id trap, the never-guess-a-tier
rule, why SUBSCRIPTION_PAUSED is left alone, and that comp grants are
unprotected."
```

---

## Notes for the reviewer

- **The riskiest line in this change** is the entitlement comparison in `isProActive`. If it is ever "simplified" to use `PRO_ENTITLEMENT_ID`, the function inverts: every cancellation and expiration revokes Pro from everyone. The regression test in Task 1 Step 1 is the guard — do not delete it.
- **Nothing here requires an app rebuild.** This is an edge-function deploy, independent of the stale-TestFlight blocker (HANDOFF open thread #1).
- **No backfill is needed.** The project has zero purchases and zero subscriptions across all 11 RevenueCat customers, so no one is currently holding refunded Pro.
