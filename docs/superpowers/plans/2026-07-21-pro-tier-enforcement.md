# Capsule Pro Tier Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce Capsule Pro free-tier caps (active capsules, recurring groups, members, photos, video length) so hitting a wall drives the paywall and Pro removes it.

**Architecture:** All caps key off the **capsule owner's (host's)** `subscription_tier`. A single config module (`src/lib/tierLimits.ts`) holds every limit, keyed by tier, extensible to `premium`. Two SECURITY DEFINER create-RPCs get server-side hard enforcement (capsule count, group recurrence); the other three gates are client-side. When a cap is hit, the **owner** sees the RevenueCat paywall; a **guest** sees an informational message only.

**Tech Stack:** React Native + Expo, TypeScript, Supabase (Postgres RPCs + RLS), RevenueCat (`react-native-purchases` via `src/lib/purchases`).

## Global Constraints

- **No magic numbers for limits outside `src/lib/tierLimits.ts`.** The two Postgres RPCs may inline the single integer they need (`3`) with a comment; nothing else.
- **Caps key off the capsule OWNER's tier, never the acting user's.** Read the current user's own tier from `useEntitlements().isPro`; read another capsule's owner tier from that capsule's fetched `subscription_tier`.
- **Owner-vs-guest rule:** owner hitting a cap → `presentPaywall()`; guest hitting a cap → informational `toast` only, never a paywall.
- **Server migrations:** `security definer`, `set search_path = ''`, reference tables as `public.users` / `public.capsules` etc. Reproduce the RPC's **latest full signature verbatim** (fetch it live with `pg_get_functiondef` first — do not trust the migration files, they may be stale per CLAUDE.md). Re-run the existing `revoke ... from public` / `grant execute ... to authenticated` block after `create or replace`. **No destructive SQL.**
- **Distinct error strings** raised by RPCs so clients map them to the paywall: `CAPSULE_LIMIT_REACHED`, `GROUP_RECURRENCE_PRO`.
- **Supabase project ref:** `ezxxvvmesegegkdeniri`.
- **`limitsForTier` fail-safe:** unknown/null tier → `free` limits.
- **Typecheck** via `npx tsc --noEmit`; ignore the pre-existing `@expo/vector-icons` / `esm.sh` / Deno resolution errors (filter with `grep`). Only new errors in touched files count.
- **Commit after each task.** Branch: work on the current branch (`feat/capsule-link-preview`); do not create PRs unless asked.

---

### Task A: Server — active-capsule count gate

**Files:**
- Create: `supabase/migrations/20260721120000_capsule_limit_in_create_rpc.sql`

**Interfaces:**
- Produces: `create_capsule_with_owner(...)` now raises `CAPSULE_LIMIT_REACHED` when a `free` caller already owns 3 non-unlocked capsules. Signature **unchanged** (11 params).

- [ ] **Step 1: Fetch the live function definition**

Run (via `mcp__supabase__execute_sql`, project `ezxxvvmesegegkdeniri`):
```sql
select pg_get_functiondef('public.create_capsule_with_owner(text,text,timestamptz,timestamptz,text,integer,boolean,text,text,uuid,timestamptz)'::regprocedure);
```
Copy the returned body verbatim as the base. It has 11 params ending in `p_contribution_start_at timestamptz default null` and inserts `contribution_start_at` into `public.capsules`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260721120000_capsule_limit_in_create_rpc.sql` = the verbatim live definition from Step 1, with **one addition** inside the function body, immediately after the existing `if v_uid is null ... end if;` block:
```sql
  -- Free hosts may own at most 3 non-unlocked capsules (Capsule Pro removes
  -- this cap). Number mirrors TIER_LIMITS.free.activeCapsules in
  -- src/lib/tierLimits.ts — keep in sync. Do NOT filter on capsules.archived_at
  -- (retired column; archive is per-member now).
  if (select subscription_tier from public.users where id = v_uid) = 'free'
     and (select count(*) from public.capsules
          where owner_id = v_uid and status <> 'unlocked') >= 3 then
    raise exception 'CAPSULE_LIMIT_REACHED';
  end if;
```
Then append the exact `revoke ... from public;` + `grant execute ... to authenticated;` statements that the current live grants use (get them from the existing migration `20260718120000_revoke_anon_rpc_execute.sql` for this function's signature). Because the signature is unchanged, `create or replace` will not create a second overload — **do not** add a `drop function`.

- [ ] **Step 3: Apply the migration**

Apply via `mcp__supabase__apply_migration` (name `capsule_limit_in_create_rpc`, project `ezxxvvmesegegkdeniri`).

- [ ] **Step 4: Verify with fixtures**

Run via `execute_sql`. Create a disposable free user + 3 owned active capsules, then attempt a 4th by calling the RPC in a session as that user is not possible via service role directly; instead verify the guard logic in isolation:
```sql
-- Confirm the guard clause is present and the signature is single (no overload):
select count(*) from pg_proc where proname = 'create_capsule_with_owner'; -- expect 1
select pg_get_functiondef('public.create_capsule_with_owner(text,text,timestamptz,timestamptz,text,integer,boolean,text,text,uuid,timestamptz)'::regprocedure) like '%CAPSULE_LIMIT_REACHED%'; -- expect t
```
Expected: `count = 1`, `?column? = t`. (Full end-to-end auth-context test happens in Task D's dev-build exercise.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721120000_capsule_limit_in_create_rpc.sql
git commit -m "Enforce free-tier 3-capsule cap in create_capsule_with_owner RPC"
```

---

### Task B: Server — group-recurrence gate

**Files:**
- Create: `supabase/migrations/20260721120100_group_recurrence_pro_gate.sql`

**Interfaces:**
- Produces: `create_group_with_creator(...)` raises `GROUP_RECURRENCE_PRO` when a `free` caller passes any `p_recurrence_interval <> 'manual'`. Signature unchanged (11 params).

- [ ] **Step 1: Fetch the live definition**

```sql
select pg_get_functiondef('public.create_group_with_creator(text,text,int,timestamptz,int,int,int,int,int,int,int)'::regprocedure);
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260721120100_group_recurrence_pro_gate.sql` = verbatim live definition, adding immediately after the `if v_uid is null ... end if;` block:
```sql
  -- Recurring groups (auto-creating capsules) are a Pro feature; 'manual'
  -- groups stay free. Keep in sync with src/lib/tierLimits.ts gating.
  if p_recurrence_interval <> 'manual'
     and (select subscription_tier from public.users where id = v_uid) = 'free' then
    raise exception 'GROUP_RECURRENCE_PRO';
  end if;
```
Re-append the exact `revoke from public` / `grant execute to authenticated` block this function uses (from `20260718091000_create_group_with_creator.sql`). Signature unchanged → no `drop function`.

- [ ] **Step 3: Apply** via `mcp__supabase__apply_migration` (name `group_recurrence_pro_gate`).

- [ ] **Step 4: Verify**

```sql
select count(*) from pg_proc where proname = 'create_group_with_creator'; -- expect 1
select pg_get_functiondef('public.create_group_with_creator(text,text,int,timestamptz,int,int,int,int,int,int,int)'::regprocedure) like '%GROUP_RECURRENCE_PRO%'; -- expect t
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721120100_group_recurrence_pro_gate.sql
git commit -m "Gate recurring group creation behind Capsule Pro in create RPC"
```

---

### Task C: Shared client module (blocks D–H)

**Files:**
- Create: `src/lib/tierLimits.ts`
- Create: `src/lib/tierLimits.test.ts`
- Create: `src/lib/proGate.ts`
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (add owner tier to the capsule fetch + expose it)

**Interfaces:**
- Produces:
  - `type Tier = 'free' | 'pro'`
  - `interface TierLimits { activeCapsules: number; membersPerCapsule: number; photosPerCapsule: number; videoSeconds: number }`
  - `const TIER_LIMITS: Record<Tier, TierLimits>`
  - `function limitsForTier(tier: string | null | undefined): TierLimits`
  - `function tierFromIsPro(isPro: boolean): Tier`
  - `function proGateHit(params: { currentUserIsHost: boolean; guestMessage: string }): void` (from `proGate.ts`)
  - `CapsuleDetailScreen` capsule state carries `ownerTier?: string` (read via the capsule fetch).

- [ ] **Step 1: Write `src/lib/tierLimits.ts`**

```ts
// Single source of truth for Capsule Pro tier limits. All caps key off the
// capsule OWNER's tier (monetize the host; guests never pay). Extensible to a
// future 'premium' tier by adding one literal below.
//
// ⚠️ The `free.activeCapsules` value (3) is ALSO hardcoded server-side in
// create_capsule_with_owner (migration 20260721120000). Keep both in sync.
export type Tier = 'free' | 'pro';

export interface TierLimits {
  activeCapsules: number;    // max non-unlocked capsules a host may own
  membersPerCapsule: number; // max members (joined + pending) in a host's capsule
  photosPerCapsule: number;  // max media items in a host's capsule
  videoSeconds: number;      // max video clip length in a host's capsule
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { activeCapsules: 3, membersPerCapsule: 10, photosPerCapsule: 20, videoSeconds: 30 },
  pro: { activeCapsules: Infinity, membersPerCapsule: 50, photosPerCapsule: 1000, videoSeconds: 120 },
};

/** Limits for a tier string; unknown/null falls back to free (fail safe). */
export function limitsForTier(tier: string | null | undefined): TierLimits {
  return TIER_LIMITS[tier as Tier] ?? TIER_LIMITS.free;
}

export function tierFromIsPro(isPro: boolean): Tier {
  return isPro ? 'pro' : 'free';
}
```

- [ ] **Step 2: Write `src/lib/tierLimits.test.ts`**

```ts
// Run with: npx tsx src/lib/tierLimits.test.ts
// Mirrors the src/lib/recurrence.test.ts precedent (no jest in this repo).
import assert from 'node:assert/strict';
import { limitsForTier, tierFromIsPro, TIER_LIMITS } from './tierLimits';

assert.equal(limitsForTier('free').activeCapsules, 3);
assert.equal(limitsForTier('pro').activeCapsules, Infinity);
assert.equal(limitsForTier('free').videoSeconds, 30);
assert.equal(limitsForTier('pro').videoSeconds, 120);
// fail-safe: unknown/null → free
assert.deepEqual(limitsForTier(undefined), TIER_LIMITS.free);
assert.deepEqual(limitsForTier(null), TIER_LIMITS.free);
assert.deepEqual(limitsForTier('premium'), TIER_LIMITS.free);
assert.equal(tierFromIsPro(true), 'pro');
assert.equal(tierFromIsPro(false), 'free');

console.log('tierLimits.test.ts: all assertions passed');
```

- [ ] **Step 3: Run the test — verify it passes**

Run: `npx tsx src/lib/tierLimits.test.ts`
Expected: `tierLimits.test.ts: all assertions passed`

- [ ] **Step 4: Write `src/lib/proGate.ts`**

```ts
import { presentPaywall } from './purchases';
import { toast } from './toast';

// Called when a Pro cap is hit. The host (prospective or actual owner) is shown
// the paywall — upgrading lifts the cap. A guest is only informed, never
// upsold, because the guest upgrading would NOT lift a host-based cap.
export function proGateHit(params: { currentUserIsHost: boolean; guestMessage: string }): void {
  if (params.currentUserIsHost) {
    presentPaywall(); // native-only; web stub no-ops
  } else {
    toast.show(params.guestMessage);
  }
}
```

- [ ] **Step 5: Add owner tier to the CapsuleDetailScreen capsule fetch**

In `src/screens/app/CapsuleDetailScreen.tsx`, find `load()` where the capsule row is selected from `capsules`. Add the owner's tier to that select via the FK embed and store it. Two edits:

(a) In the capsule `.select(...)` string, add the owner-tier embed. Example (adapt to the existing select — keep all current columns, append):
```ts
// e.g. .select('*, owner:users!capsules_owner_id_fkey(subscription_tier)')
```
If the FK constraint name differs, resolve it: the FK is `capsules.owner_id → users.id`; PostgREST embed hint is `users!capsules_owner_id_fkey`. Confirm the exact constraint name with:
```sql
select conname from pg_constraint where conrelid = 'public.capsules'::regclass and contype = 'f' and conname like '%owner%';
```

(b) After the capsule row loads, derive and store `ownerTier`. Add to the capsule state (or a sibling state):
```ts
const ownerTier: string = (capsuleRow as any).owner?.subscription_tier ?? 'free';
```
Store it so it's in scope where `InviteModal`, upload, and camera-launch code read it (a `const ownerTier = (capsule as any).owner?.subscription_tier ?? 'free'` computed near `isOwner` is acceptable if the embed is kept on the `capsule` object). Expose a value the later tasks can read: **`ownerTier`** (string) available in the `CapsuleDetailScreen` render scope alongside `isOwner`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "tierLimits|proGate|CapsuleDetailScreen" | grep -v "@expo/vector-icons"`
Expected: no output (no new errors in touched files).

- [ ] **Step 7: Commit**

```bash
git add src/lib/tierLimits.ts src/lib/tierLimits.test.ts src/lib/proGate.ts src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Add tierLimits config, proGate helper, and owner-tier on capsule fetch"
```

---

### Task D: Capsule-count client gate

**Files:**
- Modify: `src/screens/app/CreateScreen.tsx` (handleCreate, ~line 178)
- Modify: `src/screens/app/OnboardingScreen.tsx` (its create-capsule path)

**Interfaces:**
- Consumes: `limitsForTier`, `tierFromIsPro` (`tierLimits.ts`); `proGateHit` (`proGate.ts`); `useEntitlements` (`src/hooks/useEntitlements`).

- [ ] **Step 1: Add the pre-check + error mapping in `CreateScreen.handleCreate`**

Near the top of the component, read the tier:
```ts
const { isPro } = useEntitlements();
```
In `handleCreate`, **before** `supabase.rpc('create_capsule_with_owner', …)`, pre-check the current user's active-capsule count against the cap and short-circuit to the paywall:
```ts
if (!isPro) {
  const { count } = await supabase
    .from('capsules')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId) // the current user's id already in scope in this fn
    .neq('status', 'unlocked');
  if ((count ?? 0) >= limitsForTier('free').activeCapsules) {
    proGateHit({ currentUserIsHost: true, guestMessage: '' }); // owner path → paywall
    return; // do not create
  }
}
```
Then wrap the existing RPC call's error handling to map the server error:
```ts
if (capsuleError) {
  if (capsuleError.message?.includes('CAPSULE_LIMIT_REACHED')) {
    proGateHit({ currentUserIsHost: true, guestMessage: '' });
    return;
  }
  // …existing error handling…
}
```
(`userId` is whatever the function already uses for the owner id; reuse it. Import `limitsForTier` and `proGateHit`.)

- [ ] **Step 2: Mirror the same guard in `OnboardingScreen`'s create path**

Onboarding step 3 calls `create_capsule_with_owner`. A brand-new user is virtually never at 3 capsules, but map the `CAPSULE_LIMIT_REACHED` error the same way (paywall + return) so a server rejection never surfaces as a raw error. The pre-check count query is optional here (new users have 0); mapping the error is required.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CreateScreen|OnboardingScreen" | grep -v "@expo/vector-icons"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/CreateScreen.tsx src/screens/app/OnboardingScreen.tsx
git commit -m "Gate 4th active capsule behind paywall (client pre-check + RPC error map)"
```

---

### Task E: Group-recurrence client gate

**Files:**
- Modify: `src/screens/app/CreateGroupScreen.tsx`

**Interfaces:**
- Consumes: `useEntitlements`; `proGateHit`.

- [ ] **Step 1: Gate the create submit**

Read `const { isPro } = useEntitlements();`. In the "Create Group" submit handler, **before** calling `createGroup(...)`, if the chosen recurrence is not `'manual'` and `!isPro`:
```ts
if (recurrence !== 'manual' && !isPro) {
  proGateHit({ currentUserIsHost: true, guestMessage: '' }); // creator → paywall
  return;
}
```
Also map the server error from `createGroup` (which calls `create_group_with_creator`): if the returned error message includes `GROUP_RECURRENCE_PRO`, call `proGateHit({ currentUserIsHost: true, guestMessage: '' })` and toast nothing else. (Check how `createGroup` in `src/lib/groups.ts` surfaces errors; it may need to pass the error string through — if it currently swallows the error, thread the message so the screen can detect `GROUP_RECURRENCE_PRO`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CreateGroupScreen|groups.ts" | grep -v "@expo/vector-icons"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/screens/app/CreateGroupScreen.tsx src/lib/groups.ts
git commit -m "Gate recurring group creation behind paywall on the client"
```

---

### Task F: Members-per-capsule gate

**Files:**
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (InviteModal send-invite path)
- Modify: `src/screens/app/NotificationsScreen.tsx` (invite accept path)

**Interfaces:**
- Consumes: `limitsForTier` with `ownerTier` (from Task C); `proGateHit`; `isOwner` (already in CapsuleDetailScreen).

- [ ] **Step 1: Block invites at the member cap (InviteModal)**

In the invite send path, before inserting/inviting a new member, compute:
```ts
const memberCap = limitsForTier(ownerTier).membersPerCapsule;
if (members.length >= memberCap) {
  proGateHit({
    currentUserIsHost: isOwner,
    guestMessage: 'This capsule is full — its host is on the free plan.',
  });
  return; // don't invite
}
```
`members.length` counts joined + pending (both occupy a seat). If a batch of invites is sent, check the running total so the batch can't exceed the cap.

- [ ] **Step 2: Block accept when the host's capsule is already full (NotificationsScreen)**

In the invite-accept handler (sets `joined_at`), first read the capsule's owner tier + current member count. If at the owner-tier member cap, block:
```ts
// fetch owner subscription_tier for the capsule + member count, then:
if (memberCount >= limitsForTier(ownerTier).membersPerCapsule) {
  toast.show('This capsule is full — its host is on the free plan.');
  return; // leave the invite pending; never paywall the accepting guest
}
```
(The accepting user is a guest by definition here — always inform, never paywall.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CapsuleDetailScreen|NotificationsScreen" | grep -v "@expo/vector-icons"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/CapsuleDetailScreen.tsx src/screens/app/NotificationsScreen.tsx
git commit -m "Enforce per-capsule member cap (owner tier); paywall owner, inform guest"
```

---

### Task G: Photos-per-capsule gate

**Files:**
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (+Add Media enqueue path)
- Modify: `src/screens/app/PreviewScreen.tsx` (Add-to-Capsule enqueue path)

**Interfaces:**
- Consumes: `limitsForTier` with owner tier; `proGateHit`; `uploadQueue`.

- [ ] **Step 1: Gate the CapsuleDetailScreen upload path**

Before `uploadQueue.enqueue(...)` for the current capsule, compute remaining room from the already-loaded count (`mediaCount`) plus in-flight pending tasks for this capsule:
```ts
const photoCap = limitsForTier(ownerTier).photosPerCapsule;
const existing = mediaCount; // already tracked in this screen
if (existing + newItems.length > photoCap) {
  proGateHit({
    currentUserIsHost: isOwner,
    guestMessage: `This capsule is full — free capsules hold up to ${photoCap} photos.`,
  });
  return; // block the whole batch (v1: no partial fill)
}
```

- [ ] **Step 2: Gate the PreviewScreen Add-to-Capsule path**

PreviewScreen fetches the user's active capsules for selection. For each **selected** target capsule, it needs that capsule's owner tier + current media count. Extend the capsule-list query to include the owner's `subscription_tier` (embed `owner:users!capsules_owner_id_fkey(subscription_tier)`) and the media count (embed `media(count)` — same aggregate pattern used elsewhere). Before enqueuing to a given capsule:
```ts
const cap = limitsForTier(selectedCapsule.ownerTier).photosPerCapsule;
if (selectedCapsule.mediaCount + itemsForThatCapsule > cap) {
  const isHostOfIt = selectedCapsule.owner_id === currentUserId;
  proGateHit({
    currentUserIsHost: isHostOfIt,
    guestMessage: `This capsule is full — free capsules hold up to ${cap} photos.`,
  });
  // skip enqueuing to this capsule; continue with others under cap
  continue;
}
```
Per-capsule: block only the over-cap targets, still enqueue the ones with room.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CapsuleDetailScreen|PreviewScreen" | grep -v "@expo/vector-icons"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/CapsuleDetailScreen.tsx src/screens/app/PreviewScreen.tsx
git commit -m "Enforce per-capsule photo cap (owner tier) at upload enqueue"
```

---

### Task H: Video-length gate

**Files:**
- Modify: `src/screens/app/CameraScreen.tsx` (`MAX_RECORD_SECONDS` usage)
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (`filterOversizedVideos`, `MAX_LIBRARY_VIDEO_MS` usage, ~line 487/1610)

**Interfaces:**
- Consumes: `limitsForTier` with owner tier; `proGateHit`.

- [ ] **Step 1: Make the camera record cap tier-aware**

In `CameraScreen`, the effective max seconds should come from the target capsule's owner tier. The screen receives `targetCapsuleId` for the Add-Media flow; when recording for a brand-new capsule (no target), the current user is the prospective owner — use `tierFromIsPro(isPro)`. Resolve an effective `maxSeconds`:
- If `targetCapsuleId` present: fetch that capsule's owner `subscription_tier` (lightweight select) → `limitsForTier(tier).videoSeconds`.
- Else: `limitsForTier(tierFromIsPro(isPro)).videoSeconds`.

Replace the hardcoded `MAX_RECORD_SECONDS` (=120) usages in the record timers (`setTimeout(stopRecording, maxSeconds * 1000)` and the dual path) with this resolved `maxSeconds`. Keep 120 as the Pro value via the config. When the cap stops a free host's recording, if the current user is the prospective/actual host, surface a one-time toast: "Free capsules allow 30-second clips — Pro unlocks up to 2 minutes." (owner-facing only).

- [ ] **Step 2: Make the library-pick filter tier-aware**

In `CapsuleDetailScreen`, `filterOversizedVideos` uses `MAX_LIBRARY_VIDEO_MS` (=120_000). Replace with `limitsForTier(ownerTier).videoSeconds * 1000` for the current capsule. Over-cap clips are dropped with the existing toast; when `isOwner`, append the upgrade hint to that toast (owner-facing). Guests just get the neutral "some clips were too long" toast.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CameraScreen|CapsuleDetailScreen" | grep -v "@expo/vector-icons"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/CameraScreen.tsx src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Cap free-host video clips at 30s (owner tier); Pro unlocks 2 min"
```

---

### Task I: Documentation

**Files:**
- Modify: `CLAUDE.md` (Monetization section)

- [ ] **Step 1: Replace the "Known gap" paragraph**

In CLAUDE.md's `## Monetization (RevenueCat)` section, replace the "**Known gap:** the free-tier usage caps … are not enforced anywhere in code …" paragraph with a description of the now-enforced model: the `src/lib/tierLimits.ts` config (with the free/pro numbers), the owner-tier-keyed rule, the paywall-owner/inform-guest principle (`src/lib/proGate.ts`), the two server RPC gates (`CAPSULE_LIMIT_REACHED`, `GROUP_RECURRENCE_PRO`), and the client gates (members, photos, video length). Note the accepted limitation that member/photo/video caps are client-only. Note the `3` in `create_capsule_with_owner` mirrors `tierLimits.ts` and both must stay in sync.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document enforced Capsule Pro tier caps in CLAUDE.md"
```

---

## Dependency order

- **A, B** (server) — independent, can run first/parallel.
- **C** (shared module) — **blocks D–H**.
- **D, E, F, G, H** — parallelizable once C lands (D/E also depend on A/B server error strings existing, so run A→D and B→E in sequence; F/G/H depend only on C).
- **I** — last, after A–H.

## Self-review notes

- Every spec gate (active capsules, recurring groups, members, photos, video length) maps to a task (A/D, B/E, F, G, H). ✅
- Owner-vs-guest rule centralized in `proGateHit` (Task C), consumed by F/G (guest-capable gates); D/E/create-time gates always `currentUserIsHost: true`. ✅
- `ownerTier` produced in Task C, consumed by F/G/H. ✅
- No unit-test framework invented — pure module uses the `tsx`+`node:assert` precedent; RPCs use `execute_sql` fixtures; screens use `tsc` + manual exercise. ✅
- Scope exclusions (export, themes, accent picker) not in any task, by design. ✅
