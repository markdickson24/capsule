# Capsule Pro — Tier Enforcement Design

_Date: 2026-07-21 · Status: approved, ready for planning_

## Goal

Make `subscription_tier` mean something functionally. Today the RevenueCat
integration mirrors the Capsule Pro entitlement into `users.subscription_tier`,
but **nothing reads it** — Free and Pro behave identically. This spec enforces
the free-tier caps from `docs/monetization-strategy.md` so hitting a wall drives
the paywall, and Pro removes the wall.

Single paid tier for now (**Free vs Pro**), but every limit is defined in one
config object keyed by tier so adding **Premium** later is a config change, not
a rewrite.

## Non-goals (explicitly out of scope)

- **Premium tier** — no RevenueCat entitlement/products for it exist; only the
  config shape is made extensible. Not enforced.
- **Bulk/ZIP export, original-quality export, premium themes/palettes** — these
  features **do not exist** in the app, so there is nothing to gate. Not built.
- **Gating the accent-color picker** — it currently ships free to everyone;
  gating it would be a visible regression. Left free.
- **Server-side enforcement of member/photo/video caps** — deliberately
  client-side (see "Enforcement layers"). Only the two create-RPCs get server
  enforcement.

## Core principle: paywall the owner, inform the guest

All caps key off the **capsule owner's (host's)** tier, never the acting user's.
This preserves "monetize the host, guests never pay": a Pro host unlocks video +
higher caps for *every* member of their capsule including free guests; a free
host's capsule is limited for everyone in it.

The critical UX consequence: when someone hits a host-based cap, **only the owner
sees a paywall**, because only the owner upgrading lifts the cap.

- **Owner** hits their own capsule's cap → `presentPaywall()` (upgrading lifts it).
- **Guest** hits the cap → informational message only ("This capsule is full —
  its host is on the free plan"), **no upsell**. A guest upgrading would do
  nothing, so showing them a paywall would be a dark pattern and a bug.

The current user's *own* create-time gates (capsules, groups) do show the
paywall — there the current user IS the prospective owner.

## Tier model & the limits module

New file **`src/lib/tierLimits.ts`** — the single source of truth:

```ts
export type Tier = 'free' | 'pro'; // extensible: add 'premium' later

export interface TierLimits {
  activeCapsules: number;      // max non-unlocked (active/draft) capsules a host may own
  membersPerCapsule: number;   // max members in a host's capsule
  photosPerCapsule: number;    // max media items in a host's capsule
  videoSeconds: number;        // max video clip length in a host's capsule
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { activeCapsules: 3,       membersPerCapsule: 10, photosPerCapsule: 20,   videoSeconds: 30  },
  pro:  { activeCapsules: Infinity, membersPerCapsule: 50, photosPerCapsule: 1000, videoSeconds: 120 },
  // premium: { … } ← later, one literal
};

export function limitsForTier(tier: string | null | undefined): TierLimits {
  return TIER_LIMITS[(tier as Tier)] ?? TIER_LIMITS.free; // unknown/null → free (fail safe)
}

export function tierFromIsPro(isPro: boolean): Tier { return isPro ? 'pro' : 'free'; }
```

No magic numbers anywhere else. The two Postgres RPCs that need the active-capsule
number duplicate **only** that one integer inline (same
duplication-with-a-comment precedent as the cron award pools); a comment in
`tierLimits.ts` points at them so the copies stay in sync.

`Infinity`/`1000` for Pro photo cap = effectively unlimited for a single capsule.

## Reading tiers

- **Current user** (creating a capsule/group; "am I Pro"): `useEntitlements().isPro`
  → `tierFromIsPro`. Instant post-purchase (RevenueCat CustomerInfo listener),
  no DB round-trip.
- **A capsule's owner** (member/photo/video caps on any capsule being viewed):
  add the owner's `subscription_tier` to the capsule-detail fetch. It is a
  client-readable `users` column (granted to `authenticated`; verified in the
  PII-restriction migrations). `CapsuleDetailScreen.load()` already selects the
  capsule row — extend it to join `users!capsules_owner_id_fkey(subscription_tier)`
  (or select it onto the capsule object) and expose an `ownerTier` on the
  capsule state. A small helper `capsuleLimits(capsule)` → `limitsForTier(ownerTier)`.
- **`isOwner`** already computed in `CapsuleDetailScreen` (`capsule.owner_id ===
  currentUserId`) drives the paywall-vs-inform branch.

## The five gates

| # | Gate | Free → Pro | Layer | Insertion point |
|---|------|-----------|-------|-----------------|
| 1 | Active capsules | 3 → ∞ | **Server** (create RPC) + client pre-check | `create_capsule_with_owner`; `CreateScreen.handleCreate` (`src/screens/app/CreateScreen.tsx:178`), OnboardingScreen create path |
| 2 | Recurring groups | manual only → any recurrence | **Server** (create RPC) + client | `create_group_with_creator`; `CreateGroupScreen` |
| 3 | Members/capsule | 10 → 50 | Client (owner tier) | `InviteModal` in `CapsuleDetailScreen` (send-invite path) + invite **accept** in `NotificationsScreen` |
| 4 | Photos/capsule | 20 → 1000 | Client (owner tier) | upload enqueue in `PreviewScreen` + `CapsuleDetailScreen` (before `uploadQueue.enqueue`) |
| 5 | Video length | 30s → 120s | Client (owner tier) | `CameraScreen` record timer (`MAX_RECORD_SECONDS`) + library-pick filter (`MAX_LIBRARY_VIDEO_MS`, `CapsuleDetailScreen:487/1610`) |

### Gate 1 — Active capsules (server + client)
- **Server**: new migration `create or replace`s `create_capsule_with_owner`
  from its **latest** definition (the 11-param version in
  `20260716120000_capsule_start_date.sql`, which includes
  `p_contribution_start_at`). Add, right after the `auth.uid()` null check:
  count the caller's owned capsules that are still "active" — i.e.
  `owner_id = v_uid and status <> 'unlocked'` (draft or active). Do **not**
  filter on `capsules.archived_at` — that column is retired (archive is now
  per-member on `capsule_members`, see CLAUDE.md "Owner-Only Capsule Actions"),
  so it must not participate in the count. If the caller's tier
  (`select subscription_tier from public.users where id = v_uid`) is `'free'`
  and that count `>= 3`, `raise exception 'CAPSULE_LIMIT_REACHED'`. Follow the CLAUDE.md
  overload gotcha: **drop the old signature(s) before `create or replace`** so
  no ambiguous overload remains, and re-apply the `revoke from public / grant to
  authenticated` exactly as the current migration does.
- **Client**: `CreateScreen`/`OnboardingScreen` pre-check the current user's
  active-capsule count (a lightweight `count/head` query, owner + `status <>
  'unlocked'`) against `limitsForTier(tier).activeCapsules` *before* calling the
  RPC. If over and free → `presentPaywall()` instead of creating; skip the RPC.
  The server check is the real gate (catches a bypassed client and races); the
  client check is what shows the paywall gracefully. If the RPC still returns
  `CAPSULE_LIMIT_REACHED` (race: created elsewhere), surface the paywall too.

### Gate 2 — Recurring groups (server + client)
- **Server**: new migration `create or replace`s `create_group_with_creator`.
  If `p_recurrence_interval <> 'manual'` and the caller is free, `raise
  exception 'GROUP_RECURRENCE_PRO'`. Same overload-drop + regrant discipline.
- **Client**: `CreateGroupScreen` — if the chosen recurrence is not `manual`
  and the current user is free, on submit show `presentPaywall()` and don't
  create. (Selecting a recurrence chip stays free; the gate is at create.)

### Gate 3 — Members per capsule (client, owner tier)
- In `InviteModal` (send-invite path): compute
  `limitsForTier(ownerTier).membersPerCapsule`. If current member count (joined +
  pending) `>=` cap, block the invite. If `isOwner` → paywall; else → inform
  ("This capsule is full"). Pending invites count toward the cap (they occupy a
  seat).
- Invite **accept** (`NotificationsScreen`): a free host's capsule could already
  be at cap when a pending invite is accepted. On accept, if the capsule is at
  the owner-tier member cap, block with an informational message (the accepting
  guest is never shown a paywall). Low-frequency edge; acceptable to just toast
  and leave the invite pending.

### Gate 4 — Photos per capsule (client, owner tier)
- Before `uploadQueue.enqueue` in `PreviewScreen` (Add-to-capsule) and
  `CapsuleDetailScreen` (+Add Media): for each target capsule, if `currentCount
  + pendingForThatCapsule + newItems > limitsForTier(ownerTier).photosPerCapsule`,
  block the overflow. `isOwner` → paywall; guest → inform. `currentCount` comes
  from the already-loaded `mediaCount`/`photos.length` (CapsuleDetailScreen has
  `mediaCount`; PreviewScreen may need a count/head query per selected capsule).
  Partial allowance is acceptable (enqueue up to the cap, inform about the
  remainder) — but simplest v1: block the whole batch if it would exceed, with
  the count remaining. Choose block-whole-batch for v1 clarity.

### Gate 5 — Video length (client, owner tier)
- The effective max video seconds = `limitsForTier(ownerTier).videoSeconds`.
- **CameraScreen**: `MAX_RECORD_SECONDS` becomes a value derived from the target
  capsule's owner tier (the screen already receives `targetCapsuleId` for the
  Add-Media flow; when recording for a brand-new capsule the current user is the
  prospective owner, so use their tier). Recording auto-stops at that cap. When a
  free host's 30s cap stops a recording, surface a one-time hint that Pro allows
  longer (owner-facing only).
- **Library pick** (`CapsuleDetailScreen` `filterOversizedVideos`): the
  `MAX_LIBRARY_VIDEO_MS` filter uses `videoSeconds * 1000` for the target
  capsule's owner tier. Over-cap clips are dropped with the existing toast; if
  `isOwner`, the toast/next-step offers upgrade.

## UX components

- **`presentProGate(context)` helper** (small wrapper, likely in `tierLimits.ts`
  or a new `src/lib/proGate.ts`): given `{ isOwner }` and a reason, either calls
  `presentPaywall()` (owner) or shows an informational `toast`/`ConfirmModal`
  (guest). Centralizes the owner-vs-guest branch so no gate re-implements it.
- Reuse existing primitives: `presentPaywall` (`src/lib/purchases`), `toast`
  (`src/lib/toast`), `ConfirmModal`. No new heavy UI.
- Per-gate copy lives next to each call (short, reason-specific): "You've reached
  3 active capsules", "Free capsules hold up to 20 photos", "Free capsules allow
  30-second clips", "Recurring groups are a Pro feature", "This capsule is full".

## Server-side migration notes (critical)

- Both RPCs are `security definer set search_path = ''` — reference tables as
  `public.users` etc. Read the caller's tier with
  `select subscription_tier from public.users where id = v_uid`.
- **Overload hazard** (CLAUDE.md "Key RLS Constraints"): adding logic via `create
  or replace` keeps the same signature, so no new overload is created — but the
  new migration must reproduce the **latest** full signature verbatim (11 params
  for the capsule RPC) or it will create a *second* overload and make calls
  ambiguous (PGRST203). The migration drops nothing new if the signature is
  unchanged; only re-`create or replace` + re-run the existing
  `revoke from public` / `grant execute to authenticated` block.
- Raise distinct, greppable error strings (`CAPSULE_LIMIT_REACHED`,
  `GROUP_RECURRENCE_PRO`) so clients can map them to the paywall rather than a
  generic error toast.
- Apply via a normal timestamped migration file; deploy to project
  `ezxxvvmesegegkdeniri`. **No destructive SQL** — these are `create or replace`
  + grants only.

## Testing / verification

- **Server**: after applying, unit-check each RPC via `execute_sql` against a
  disposable free-tier user: 4th capsule create raises `CAPSULE_LIMIT_REACHED`;
  a non-manual group raises `GROUP_RECURRENCE_PRO`; a pro user does neither.
  Clean up fixtures. Verify no ambiguous-overload (`PGRST203`) by calling the
  RPC by named args.
- **Client**: TypeScript typecheck (`npx tsc --noEmit`, filtering the known
  Expo/Deno resolution noise as in prior sessions). Exercise each gate in a dev
  build if practical: free account hits 3-capsule wall → paywall; guest in a
  full capsule → informational message (no paywall); Pro host → no walls.
- The `limitsForTier` fail-safe (unknown tier → free) protects against a null
  `subscription_tier`.

## Known limitations / accepted races

- **Purchase→create race**: right after upgrading, RevenueCat `isPro` flips
  instantly but the webhook-written DB `subscription_tier` lags (~<1s observed).
  A user creating their 4th capsule in that sub-second window could be blocked by
  the server RPC despite the client showing Pro. Accepted; the client can offer a
  retry, and the window is tiny.
- **Photo/member caps are client-only** — a modified client can bypass them.
  Accepted per the agreed enforcement scope; the two highest-value gates
  (capsule count, group recurrence) are server-hardened.
- **Video duration is not stored server-side**, so the 30s cap is inherently
  client-side.

## Task breakdown (for the implementation plan / subagents)

Ordered by dependency; tasks A–B are server, C is the shared module (blocks the
client gates), D–H are client gates that can parallelize once C lands.

- **A. Server: capsule-count gate** — migration re-defining
  `create_capsule_with_owner` (+ tests).
- **B. Server: group-recurrence gate** — migration re-defining
  `create_group_with_creator` (+ tests).
- **C. Shared client module** — `src/lib/tierLimits.ts` + `proGate` helper +
  add `ownerTier` to `CapsuleDetailScreen` capsule fetch + a `useCapsuleLimits`
  accessor. **Blocks D–H.**
- **D. Capsule-count client gate** — CreateScreen + OnboardingScreen pre-check
  + paywall, and map the RPC error string.
- **E. Group-recurrence client gate** — CreateGroupScreen.
- **F. Members-per-capsule gate** — InviteModal + accept path.
- **G. Photos-per-capsule gate** — PreviewScreen + CapsuleDetailScreen upload
  enqueue.
- **H. Video-length gate** — CameraScreen + library-pick filter.
- **I. Docs** — update CLAUDE.md ("Monetization" section: replace the "Known
  gap" paragraph with the enforced model) once A–H land.
