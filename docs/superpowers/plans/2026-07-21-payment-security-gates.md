# Payment-Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `users.subscription_tier` the un-forgeable source of truth for Capsule Pro and add server backstops for every tier cap, so the paywall stops being cosmetic.

**Architecture:** Two DB migrations add `BEFORE`-trigger guards (tier write-lock, group-recurrence gate, member/photo cap backstops) and drop the two direct-create RLS policies that let clients skip the create RPCs. The RevenueCat webhook gains a production-environment filter + constant-time secret compare; the client wrapper drops the Test Store fallback key and fixes the logIn-failure payer gap; the video-length gate's fail-open holes are closed on the two client paths that skipped it.

**Tech Stack:** Supabase Postgres (PL/pgSQL triggers, RLS), Supabase Edge Functions (Deno), React Native / Expo, TypeScript.

## Global Constraints

- **Tier caps (verbatim from `src/lib/tierLimits.ts`):** free = 3 capsules / 10 members / 20 photos / 30s video; pro = ∞ / 50 / 1000 / 120s. Every SQL cap is inlined `case when v_tier = 'free' then <free> else <pro> end` with a `-- keep in sync with src/lib/tierLimits.ts` comment.
- **Error strings** (raised by triggers/RPCs, some already mapped client-side): `TIER_READONLY`, `GROUP_RECURRENCE_PRO` (already mapped), `CAPSULE_LIMIT_REACHED` (already mapped), `MEMBER_LIMIT_REACHED`, `PHOTO_LIMIT_REACHED`.
- **"Client request" guard:** all four enforcement triggers act only when `coalesce((select auth.role()), '') in ('authenticated','anon')`. `service_role` (webhook, cron) and the `postgres`/definer paths are never gated. `auth.role()` reads the JWT claim and is unchanged by `SECURITY DEFINER`, so it is `'authenticated'` even inside the create RPCs — the owner-row exemption (`new.user_id = owner`) handles that case.
- **All new functions:** `language plpgsql security definer set search_path to ''` with every table reference schema-qualified (`public.users`, etc.) — matches the established codebase convention.
- **Migrations** are timestamped files under `supabase/migrations/`, applied to production project `ezxxvvmesegegkdeniri` via `mcp__supabase__apply_migration`, then verified with live SQL fixtures that are **deleted in the same session** (no orphaned test data on prod — DB-delete-incident memory).
- **No test framework exists** (deliberate). DB tasks verify via before/after SQL fixtures; TS tasks verify via `npx tsc --noEmit` (filtered for known Expo/Deno noise) plus targeted logic review; the edge function verifies via a synthetic event body.
- **MCP-gated steps** (apply_migration, execute_sql fixtures, deploy_edge_function, RevenueCat dashboard) are performed by the orchestrator, not a subagent — a subagent cannot reach prod to verify.

---

### Task 1: Migration A — critical server gates (C1 tier write-lock, C3 direct-create + recurrence)

**Files:**
- Create: `supabase/migrations/20260721140000_payment_security_gates_a.sql`

**Interfaces:**
- Produces: trigger `guard_subscription_tier` on `public.users`; trigger `guard_group_recurrence` on `public.groups`; drops policies `"Owners can insert capsules"` (capsules) and `"Creator can insert groups"` (groups).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Prove the holes are open (baseline fixtures on prod)**

Run each as a normal `authenticated` user via `mcp__supabase__execute_sql` wrapped to impersonate a client role. Use this harness (sets the JWT role + a real user id, runs the statement, rolls back):

```sql
-- pick a real, disposable user id to impersonate
select id from public.users order by created_at desc limit 1;   -- note the uuid → <UID>
```

Baseline A (self-grant must currently SUCCEED):
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<UID>','role','authenticated')::text, true);
update public.users set subscription_tier = 'pro' where id = '<UID>';   -- expect: UPDATE 1
rollback;
```
Expected now: `UPDATE 1` (hole open).

Baseline B (direct capsule insert must currently SUCCEED):
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<UID>','role','authenticated')::text, true);
insert into public.capsules (owner_id, title, unlock_at, unlock_mode, status)
values ('<UID>','__probe__', now()+interval '1 day','time','active');   -- expect: INSERT 0 1
rollback;
```
Expected now: `INSERT 0 1` (hole open).

Record both outcomes. (Rollback means nothing persists.)

- [ ] **Step 2: Write migration A**

Create `supabase/migrations/20260721140000_payment_security_gates_a.sql`:

```sql
-- Payment-security gates (A): make subscription_tier un-forgeable (C1), remove
-- the direct-create RLS bypass of the create RPCs (C3), and gate group
-- recurrence edits for free creators (C3). See
-- docs/superpowers/specs/2026-07-21-payment-security-remediation-design.md.

-- C1: only service_role (the RevenueCat webhook) may change subscription_tier.
-- A client (authenticated/anon) attempting to set/change it is rejected. Reads
-- the JWT role, which SECURITY DEFINER does not alter.
create or replace function public.guard_subscription_tier()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;  -- webhook (service_role), migrations, definer paths: allowed
  end if;
  if tg_op = 'UPDATE' and new.subscription_tier is distinct from old.subscription_tier then
    raise exception 'TIER_READONLY' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and coalesce(new.subscription_tier, 'free') <> 'free' then
    raise exception 'TIER_READONLY' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_subscription_tier on public.users;
create trigger guard_subscription_tier
  before insert or update on public.users
  for each row execute function public.guard_subscription_tier();

-- C3a: creation must go through create_capsule_with_owner /
-- create_group_with_creator (SECURITY DEFINER, RLS-exempt), whose cap gates are
-- the only create path once these client INSERT policies are gone. Verified: no
-- client code inserts these tables directly.
drop policy if exists "Owners can insert capsules" on public.capsules;
drop policy if exists "Creator can insert groups" on public.groups;

-- C3b: a free creator cannot switch a group to a real recurrence via a direct
-- UPDATE (ManageGroupScreen). Mirrors create_group_with_creator's error string
-- so the existing client handler catches it. The cron only bumps
-- next_capsule_at (service_role), never recurrence_interval.
create or replace function public.guard_group_recurrence()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.recurrence_interval <> 'manual'
     and new.recurrence_interval is distinct from old.recurrence_interval
     and (select subscription_tier from public.users where id = old.created_by) = 'free'
  then
    raise exception 'GROUP_RECURRENCE_PRO';
  end if;
  return new;
end $$;

drop trigger if exists guard_group_recurrence on public.groups;
create trigger guard_group_recurrence
  before update on public.groups
  for each row execute function public.guard_group_recurrence();
```

- [ ] **Step 3: Apply migration A to prod**

Apply via `mcp__supabase__apply_migration` (project `ezxxvvmesegegkdeniri`, name `payment_security_gates_a`, the SQL above).
Expected: success, no error.

- [ ] **Step 4: Verify the holes are closed (re-run baselines + positive paths)**

Re-run Baseline A → now expect `ERROR: TIER_READONLY`.
Re-run Baseline B → now expect `ERROR: new row violates row-level security policy for table "capsules"` (no INSERT policy).

Service-role tier write still works (webhook path):
```sql
begin;
-- default connection is service_role via MCP; confirm auth.role() path is allowed
update public.users set subscription_tier = subscription_tier where id = '<UID>';  -- no-op, expect UPDATE 1
rollback;
```
Expected: `UPDATE 1` (service_role not gated; no-op same-value is allowed anyway).

Recurrence gate — free creator blocked, cron-style bump allowed:
```sql
-- find a group whose creator is free, note <GID> and its <interval>
select g.id, g.recurrence_interval, u.subscription_tier
from public.groups g join public.users u on u.id = g.created_by
where u.subscription_tier = 'free' limit 1;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<CREATOR_UID>','role','authenticated')::text, true);
update public.groups set recurrence_interval = 'monthly' where id = '<GID>';  -- expect ERROR GROUP_RECURRENCE_PRO
rollback;
```
Expected: `ERROR: GROUP_RECURRENCE_PRO`. (If no free-creator group exists, note that and skip — the trigger logic is exercised by the code review.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721140000_payment_security_gates_a.sql
git commit -m "Server-lock subscription_tier + close direct-create/recurrence bypasses (C1, C3)"
```

---

### Task 2: Migration B — cap backstop triggers (H1 members, H2 photos)

**Files:**
- Create: `supabase/migrations/20260721140100_payment_security_gates_b.sql`

**Interfaces:**
- Produces: trigger `enforce_member_limit` on `public.capsule_members`; trigger `enforce_photo_limit` on `public.media`.
- Consumes: `guard_*` triggers from Task 1 exist (independent; ordering not required).

- [ ] **Step 1: Prove the caps have no server backstop (baseline)**

Find a free-owner capsule and count members/media:
```sql
select c.id, u.subscription_tier,
       (select count(*) from public.capsule_members m where m.capsule_id = c.id) as members,
       (select count(*) from public.media md where md.capsule_id = c.id) as photos
from public.capsules c join public.users u on u.id = c.owner_id
where u.subscription_tier = 'free' order by members desc limit 5;
```
Note a free-owner `<CID>` and its owner `<OWNER_UID>`. A direct member insert as a non-owner authenticated user currently succeeds regardless of count — the backstop below changes that.

- [ ] **Step 2: Write migration B**

Create `supabase/migrations/20260721140100_payment_security_gates_b.sql`:

```sql
-- Payment-security gates (B): server backstops for the member (H1) and photo
-- (H2) caps. Client pre-checks stay for UX; these are the un-bypassable floor
-- against self-join paths, races, and modified clients. Caps key off the
-- capsule OWNER's tier ("monetize the host"). See the design doc.

-- H1: member cap. Owner's own row is never capped. Counts all rows (joined +
-- pending), matching the client's count semantics.
create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_owner uuid;
  v_tier text;
  v_cap int;
  v_count int;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;  -- service_role/cron/definer: trusted
  end if;
  select owner_id into v_owner from public.capsules where id = new.capsule_id;
  if new.user_id = v_owner then
    return new;  -- the host's own membership is never capped
  end if;
  select subscription_tier into v_tier from public.users where id = v_owner;
  v_cap := case when v_tier = 'free' then 10 else 50 end;  -- keep in sync with src/lib/tierLimits.ts
  select count(*) into v_count from public.capsule_members where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'MEMBER_LIMIT_REACHED';
  end if;
  return new;
end $$;

drop trigger if exists enforce_member_limit on public.capsule_members;
create trigger enforce_member_limit
  before insert on public.capsule_members
  for each row execute function public.enforce_member_limit();

-- H2: photo cap. Backstops the client pre-check. A rejected insert after the
-- storage upload orphans that blob — accepted, matches existing cleanup
-- tradeoffs.
create or replace function public.enforce_photo_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_tier text;
  v_cap int;
  v_count int;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  select u.subscription_tier into v_tier
    from public.capsules c join public.users u on u.id = c.owner_id
    where c.id = new.capsule_id;
  v_cap := case when v_tier = 'free' then 20 else 1000 end;  -- keep in sync with src/lib/tierLimits.ts
  select count(*) into v_count from public.media where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'PHOTO_LIMIT_REACHED';
  end if;
  return new;
end $$;

drop trigger if exists enforce_photo_limit on public.media;
create trigger enforce_photo_limit
  before insert on public.media
  for each row execute function public.enforce_photo_limit();
```

- [ ] **Step 3: Apply migration B to prod**

Apply via `mcp__supabase__apply_migration` (name `payment_security_gates_b`).
Expected: success.

- [ ] **Step 4: Verify the caps enforce (fixtures, then delete them)**

Member cap — create a disposable free-owner capsule with 10 members, then attempt an 11th:
```sql
-- setup: a disposable free user + capsule with exactly 10 members (owner + 9), via service_role (MCP default)
-- Use existing disposable users; if fewer than 10 exist, insert temp users first and record their ids for cleanup.
-- Then, impersonating an 11th authenticated joiner:
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','<JOINER_UID>','role','authenticated')::text, true);
insert into public.capsule_members (capsule_id, user_id, role, joined_at)
values ('<FREE_CID_WITH_10>','<JOINER_UID>','contributor', now());  -- expect ERROR MEMBER_LIMIT_REACHED
rollback;
```
Expected: `ERROR: MEMBER_LIMIT_REACHED`.

Pro owner reaches 11+: temporarily set the capsule's owner tier to `pro` (service_role), re-run the impersonated insert inside a transaction → expect success; `rollback`.

Photo cap — on a free-owner capsule already at 20 media, impersonated insert of a 21st `media` row → expect `ERROR: PHOTO_LIMIT_REACHED`. (Build the 20-row fixture via service_role; the 21st via the impersonation harness inside `begin/rollback`.)

**Delete every fixture** (temp users, temp capsule, temp members/media) created for this step before finishing. Confirm with a count query that they are gone.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721140100_payment_security_gates_b.sql
git commit -m "Add server-side member/photo cap backstops (H1, H2)"
```

---

### Task 3: Webhook hardening — production-only + constant-time secret (C2b), dashboard scope (C2c)

**Files:**
- Modify: `supabase/functions/revenuecat-webhook/index.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: hardened webhook (behavioral only; no exported symbols).

- [ ] **Step 1: Edit the webhook — add a constant-time compare + production filter**

In `supabase/functions/revenuecat-webhook/index.ts`, add this helper near the top (after `PRO_ENTITLEMENT_ID`):

```ts
// Constant-time string compare — avoids leaking the secret via response timing.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
```

Replace the auth check:
```ts
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const provided = req.headers.get('Authorization') ?? '';
  if (!expected || provided !== expected) return json({ error: 'Unauthorized' }, 401);
```
with:
```ts
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const provided = req.headers.get('Authorization') ?? '';
  if (!expected || !timingSafeEqual(provided, expected)) return json({ error: 'Unauthorized' }, 401);
```

Immediately after the `if (!event?.type) ...` guard, add the environment filter:
```ts
  // Only production purchases mirror into subscription_tier. Test Store /
  // sandbox events (environment SANDBOX) must never grant real Pro. RevenueCat
  // sends event.environment on store events; TEST pings omit it and are handled
  // below, so gate only when the field is present and non-production.
  const environment: string | undefined = event.environment;
  if (environment && environment !== 'PRODUCTION') {
    return json({ ok: true, handled: `ignored (${environment})` });
  }
```

- [ ] **Step 2: Deploy the webhook**

Deploy via `mcp__supabase__deploy_edge_function` (project `ezxxvvmesegegkdeniri`, slug `revenuecat-webhook`, `verify_jwt: false`, the edited `index.ts`).
Expected: deploy succeeds, new version.

- [ ] **Step 3: Verify — sandbox ignored, production still grants, bad secret 401**

Using `curl` (or an MCP HTTP call) against the function URL `https://ezxxvvmesegegkdeniri.functions.supabase.co/revenuecat-webhook`:

Bad secret → 401:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST <URL> \
  -H "Authorization: wrong" -H "Content-Type: application/json" \
  -d '{"event":{"type":"TEST"}}'
```
Expected: `401`.

Sandbox GRANT ignored (correct secret, env SANDBOX) → 200 `ignored (SANDBOX)`, and confirm `subscription_tier` did NOT change for the id:
```bash
curl -s -X POST <URL> -H "Authorization: <SECRET>" -H "Content-Type: application/json" \
  -d '{"event":{"type":"INITIAL_PURCHASE","environment":"SANDBOX","app_user_id":"<UID>","entitlement_ids":["Capsule Pro"]}}'
```
Expected body: `{"ok":true,"handled":"ignored (SANDBOX)"}`. Then `select subscription_tier from public.users where id='<UID>'` unchanged.

(Do NOT send a PRODUCTION GRANT against a real id — that would actually flip a user to pro. Reason about the PRODUCTION branch from the unchanged code path instead, or use a throwaway id then reset it.)

- [ ] **Step 4: Scope the webhook in the RevenueCat dashboard (C2c, orchestrator/MCP)**

Via the RevenueCat MCP: `mcp__revenuecat__get-webhook-integration` for project `proj72b0a2e3` → inspect its `environment`/app scope. If the config supports restricting to the production App Store app / production environment, `mcp__revenuecat__update-webhook-integration` accordingly. If it does not expose that control, record that the C2b code filter is the effective guard and move on (do not block the task on a dashboard capability that may not exist).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/revenuecat-webhook/index.ts
git commit -m "Harden RevenueCat webhook: production-only events + constant-time secret (C2b)"
```

---

### Task 4: Client purchase wrapper — drop Test Store fallback (C2a) + fix logIn payer gap (H4)

**Files:**
- Modify: `src/lib/purchases.native.ts:38-47,75-82`
- Modify: `src/hooks/useRevenueCat.ts:21-29`

**Interfaces:**
- Consumes: nothing.
- Produces: `identifyUser(userId)` now resolves the identity reliably; `configurePurchases()` no-ops (with a warning) when no real key is set.

- [ ] **Step 1: Remove the Test Store fallback key**

In `src/lib/purchases.native.ts`, delete the `FALLBACK_TEST_KEY` constant (lines ~29-38) and change `apiKey()` to return `undefined` when unset, and `configurePurchases()` to skip configuring (warn) when there is no key:

```ts
function apiKey(): string | undefined {
  return Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    default: undefined,
  });
}
```

```ts
export function configurePurchases(): void {
  if (configured) return;
  const key = apiKey();
  if (!key) {
    // Fail closed: never silently run on a shared Test Store key in a release
    // build (that would grant real Pro for free). Purchases are simply disabled
    // when no real key is configured.
    console.warn('[Purchases] no RevenueCat key set — purchases disabled');
    return;
  }
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey: key });
    configured = true;
  } catch (e) {
    console.warn('[Purchases] configure failed:', e);
  }
}
```

- [ ] **Step 2: Make `identifyUser` resolve reliably (return success, retry once)**

Change `identifyUser` in `src/lib/purchases.native.ts` to report success so the caller only latches its guard on success:

```ts
export async function identifyUser(userId: string): Promise<boolean> {
  ensureConfigured();
  if (!configured) return false;
  try {
    await Purchases.logIn(userId);
    return true;
  } catch (e) {
    console.warn('[Purchases] logIn failed, retrying once:', e);
    try {
      await Purchases.logIn(userId);
      return true;
    } catch (e2) {
      console.warn('[Purchases] logIn retry failed:', e2);
      return false;
    }
  }
}
```

Update the web/TS stubs so signatures still match. In `src/lib/purchases.web.ts` and `src/lib/purchases.ts`, make `identifyUser` return `Promise<boolean>` (resolve `false`). (Check the current stub signatures and adjust the return type/`return false` only.)

- [ ] **Step 3: Latch the identity guard only on success (H4 core)**

In `src/hooks/useRevenueCat.ts`, set `identifiedRef` only after `identifyUser` resolves `true`, so a failed logIn is retried on the next render/session tick instead of being permanently marked done:

```ts
  useEffect(() => {
    let cancelled = false;
    if (userId && identifiedRef.current !== userId) {
      identifyUser(userId).then((ok) => {
        if (!cancelled && ok) identifiedRef.current = userId;
      });
    } else if (!userId && identifiedRef.current) {
      identifiedRef.current = null;
      resetUser();
    }
    return () => { cancelled = true; };
  }, [userId]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "purchases|useRevenueCat" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/purchases.native.ts src/lib/purchases.web.ts src/lib/purchases.ts src/hooks/useRevenueCat.ts
git commit -m "Drop Test Store fallback key + fix logIn-failure payer gap (C2a, H4)"
```

---

### Task 5: Close video-length fail-open holes (H3)

**Files:**
- Modify: `src/hooks/useShareIntent.native.ts:19-27`
- Modify: `src/screens/app/CreateScreen.tsx:180-329`
- Reference (do not change): `src/lib/mediaDuration.ts` (`assetDurationMs`), `src/screens/app/PreviewScreen.tsx:199-290` (the reference gate), `src/lib/tierLimits.ts` (`limitsForTier`), `modules/expo-video-stitcher` (`trimVideo`), `src/lib/limitSheet.ts`.

**Interfaces:**
- Consumes: `limitsForTier(tier).videoSeconds`, `trimVideo(uri, seconds): Promise<string>`, `PendingMedia.durationMs`, `toast.show`.
- Produces: share-intent videos carry `durationMs` when probeable; the CreateScreen `pendingMedia` path no longer enqueues over-cap videos untrimmed for a free host.

- [ ] **Step 1: Add a duration probe helper**

Add to `src/lib/mediaDuration.ts` a native duration probe used when the picker/share-intent didn't provide one. Use the app's existing video stack (`expo-video`'s `createVideoPlayer`, which exposes `.duration` in **seconds** once loaded); guard web + failures to return `undefined` (fail-open preserved for genuinely unprobeable clips):

```ts
import { createVideoPlayer } from 'expo-video';
import { Platform } from 'react-native';

/** Best-effort local-file video duration in ms. undefined on web / failure
 * (caller then treats the clip as ungated — fail-open, client-only limit). */
export async function probeVideoDurationMs(uri: string): Promise<number | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const player = createVideoPlayer(uri);
    // duration is in seconds and may be 0 until the item loads; poll briefly.
    for (let i = 0; i < 20; i++) {
      const d = player.duration;
      if (d && d > 0) { player.release(); return Math.round(d * 1000); }
      await new Promise((r) => setTimeout(r, 100));
    }
    player.release();
    return undefined;
  } catch {
    return undefined;
  }
}
```

> If `createVideoPlayer` isn't importable this way in this SDK, fall back to `expo-video-thumbnails` is NOT an option (no duration). Verify the `expo-video` API surface (`grep -rn "expo-video" package.json src`) and adjust the import/property names to the installed version before finalizing — the behavior (return ms or `undefined`) is the contract.

- [ ] **Step 2: Probe duration for share-intent videos**

In `src/hooks/useShareIntent.native.ts`, make `filesToMedia` async and populate `durationMs` for videos. Change the mapping and both call sites to await it:

```ts
import { probeVideoDurationMs } from '../lib/mediaDuration';

async function filesToMedia(files: ShareFile[] | undefined | null): Promise<PendingMedia[]> {
  if (!files) return [];
  const out: PendingMedia[] = [];
  for (const f of files) {
    if (!f?.path || !f.mimeType) continue;
    if (f.mimeType.startsWith('image/')) {
      out.push({ uri: f.path, mediaType: 'photo', mimeType: f.mimeType });
    } else if (f.mimeType.startsWith('video/')) {
      const durationMs = await probeVideoDurationMs(f.path);
      out.push({ uri: f.path, mediaType: 'video', mimeType: f.mimeType, durationMs });
    }
  }
  return out;
}
```

Update the first effect to await it:
```ts
  useEffect(() => {
    if (!hasShareIntent) return;
    let cancelled = false;
    (async () => {
      const media = await filesToMedia(shareIntent?.files as ShareFile[] | undefined);
      if (cancelled) return;
      if (media.length === 0) { resetShareIntent(); return; }
      if (session) {
        navigateWhenReady(() => {
          (navigationRef as any).navigate('Preview', { media, source: 'share' });
        });
      } else {
        shareIntentStash.set(media);
      }
      resetShareIntent();
    })();
    return () => { cancelled = true; };
  }, [hasShareIntent, shareIntent, session, resetShareIntent]);
```

(The stash-drain effect is unchanged — it re-navigates already-probed media.)

- [ ] **Step 3: Gate the CreateScreen `pendingMedia` path before create**

In `src/screens/app/CreateScreen.tsx`, the over-cap videos in `pendingMedia` currently enqueue untrimmed (lines ~312-329). Because the new capsule's owner is the current user, the cap is `limitsForTier(isPro ? 'pro' : 'free').videoSeconds`. Add — right where `pendingMedia` is enqueued — a trim-first pass for a free host, preserving the clip (first Ns), with an honest toast. Import `trimVideo` and `limitsForTier` and `toast` if not already imported (check the existing imports first):

Replace the enqueue block (312-329) with:
```ts
    if (pendingMedia && pendingMedia.length > 0) {
      const cap = limitsForTier(isPro ? 'pro' : 'free').videoSeconds;
      const isOver = (m: PendingMedia) =>
        m.mediaType === 'video' && m.durationMs != null && m.durationMs / 1000 > cap;
      const overCount = pendingMedia.filter(isOver).length;
      let toEnqueue = pendingMedia;
      if (overCount > 0) {
        // Preserve the clip rather than dropping it: trim over-cap videos to the
        // host's cap (first N seconds) before enqueue. The interactive
        // Trim/Upgrade/Skip sheet lives on PreviewScreen; here the capsule is
        // already committed and the seal ceremony is about to play, so a silent
        // trim + honest toast is the right call.
        try {
          toEnqueue = await Promise.all(
            pendingMedia.map(async (m) =>
              isOver(m)
                ? { ...m, uri: await trimVideo(m.uri, cap), durationMs: cap * 1000 }
                : m
            )
          );
          toast.show(`Trimmed ${overCount > 1 ? `${overCount} videos` : 'your video'} to ${cap}s (free limit).`);
        } catch {
          // Trim failed (e.g. no native build yet): drop the over-cap clips
          // rather than upload full-length past the cap.
          toEnqueue = pendingMedia.filter((m) => !isOver(m));
          toast.show('Some videos were too long and were skipped.');
        }
      }
      uploadQueue.enqueue(
        toEnqueue.map(m => ({
          capsuleId,
          uri: m.uri,
          mediaType: m.mediaType,
          altUri: m.altUri,
          caption: m.caption,
        }))
      );
    }
```

Make the enclosing `handleCreate` (or the function containing this block) `async` if it isn't already (it already `await`s the RPC, so it is). Confirm `isPro` is in scope here — it is (`const { isPro } = useEntitlements()` at line 51).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "useShareIntent|CreateScreen|mediaDuration" || echo "no new errors in touched files"`
Expected: `no new errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mediaDuration.ts src/hooks/useShareIntent.native.ts src/screens/app/CreateScreen.tsx
git commit -m "Close video-length fail-open holes: probe share-intent duration + gate CreateScreen pendingMedia (H3)"
```

---

### Task 6: Update CLAUDE.md — server gates are now real

**Files:**
- Modify: `CLAUDE.md` (Monetization → Tier enforcement section; Database Schema → Triggers list)

**Interfaces:**
- Consumes: everything above (documents it).

- [ ] **Step 1: Document the new triggers and behavior**

In `CLAUDE.md`, update the Monetization "Tier enforcement" and "Accepted limitations" text and the Triggers list to reflect that the paywall is now server-enforced:
- `subscription_tier` is write-locked to `service_role` by the `guard_subscription_tier` trigger — clients can no longer self-grant.
- The direct-create RLS bypass is gone: `capsules`/`groups` INSERT policies dropped; creation is RPC-only.
- `guard_group_recurrence` blocks free creators switching a group to a real recurrence (raises `GROUP_RECURRENCE_PRO`) — the recurrence gate is no longer create-only.
- `enforce_member_limit` / `enforce_photo_limit` are the server backstops for the 10/50 member and 20/1000 photo caps (owner-tier keyed) — members/photos are no longer "client-only, no server backstop". Note the accepted photo-orphan tradeoff.
- Webhook: production-environment filter + constant-time secret; the Test Store fallback key is removed from `purchases.native.ts` (fail-closed when no real key).
- Add the five trigger names to the Triggers bullet list in Database Schema.

Keep the terse decision-and-reason voice. Do not turn it into a changelog — edit the relevant sentences in place.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document server-enforced tier gates in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:** C1 → Task 1 (guard_subscription_tier). C2a → Task 4. C2b → Task 3. C2c → Task 3 Step 4. C3 (direct-create) → Task 1 policy drops. C3 (recurrence) → Task 1 guard_group_recurrence. H1 → Task 2 enforce_member_limit. H2 → Task 2 enforce_photo_limit. H3 → Task 5. H4 → Task 4. Docs → Task 6. All covered.

**Placeholder scan:** The `expo-video` API caveat in Task 5 Step 1 is a verify-then-adjust instruction with a firm behavioral contract (return ms or `undefined`), not a TODO — acceptable because the exact property name depends on the installed SDK version and must be confirmed against the tree. `<UID>`/`<CID>` etc. are fixture placeholders filled at run time from the preceding query, not spec gaps.

**Type consistency:** `identifyUser` returns `Promise<boolean>` in Task 4 and is consumed as `.then((ok) => …)` in the same task — consistent, and the web/TS stubs are updated in the same step. `probeVideoDurationMs(uri): Promise<number | undefined>` (Task 5 Step 1) is consumed in Step 2 with the same shape. `isOver`/`cap`/`durationMs` usage mirrors PreviewScreen's existing `isOverCap` logic. Cap values (10/50, 20/1000, 30/120) match tierLimits.ts throughout.
