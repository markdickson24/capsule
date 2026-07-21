# Payment-Security Remediation — Design

_Date: 2026-07-21 · Status: approved, ready for planning_

## Goal

Turn the Capsule Pro paywall from **cosmetic** into **server-enforced**. Today the
paywall has several independent bypasses (confirmed live against production during the
diagnostic): a user can set their own `subscription_tier`, direct-insert past the two
create-time RPC gates, edit a free group's recurrence, and exceed the member/photo/video
caps because those caps are client-only. After this work, `users.subscription_tier` is the
un-forgeable source of truth, the caps have server backstops, and paying users can't be
silently harmed by a login-time failure.

Scope: **C1–C3 (critical) + H1–H4 (high)**. Mediums (M1–M5) and the remaining lows are
explicitly deferred to later branches.

## Background: what was verified live (production `ezxxvvmesegegkdeniri`)

- `authenticated`/`anon` hold **both** a table-wide UPDATE grant and explicit column-level
  UPDATE/INSERT grants on `users.subscription_tier`. A plain column-revoke is therefore
  insufficient — hence the trigger approach for C1.
- Client code **never writes** `subscription_tier` (only reads it via an
  `owner:users!capsules_owner_id_fkey(subscription_tier)` embed). The only client
  `users.update` calls are `accent_color` and `home_layout` (ThemeContext).
- **No client path** directly inserts `capsules` or `groups` — creation is 100% through the
  `create_capsule_with_owner` / `create_group_with_creator` `SECURITY DEFINER` RPCs. So the
  direct-INSERT RLS policies can be dropped with zero app breakage.
- `groups` recurrence **is** edited via a direct `groups` UPDATE (`ManageGroupScreen` →
  `updateGroup`), so that policy cannot be dropped — it needs a conditional trigger.
- `capsule_members` INSERT is used by six paths (all funnelling through the
  `can_insert_capsule_member` policy): the create RPC (owner row), `CreateScreen` group
  fan-out, `CapsuleDetailScreen` InviteModal, `PublicProfileScreen` invite, `QRScannerScreen`
  self-join, `useDeepLinks` self-join. A single `BEFORE INSERT` trigger covers all of them.
- `media` INSERT policy `"Contributors can upload media"` checks membership/role/lock/start
  but **no count** — no photo-cap backstop exists.

## Non-goals

- No change to the client-side cap **pre-checks** — they stay for smooth UX; the triggers are
  the un-bypassable backstop underneath them.
- Video length stays **client-only** (duration isn't stored server-side) — the same accepted
  limitation as today. H3 only closes the normal-UI fail-open holes, it does not make video
  length server-enforced.
- Mediums M1 (refund/chargeback), M2 (webhook reconciliation), M3 (account-switch entitlement
  reset), M4 (downgrade→cron), M5 (ASC first-IAP submission), and lows L2/L3 are out of scope.

---

## Workstream A — Critical server gates (DB migration)

### A1 · C1 — lock `subscription_tier` writes (trigger)

`BEFORE INSERT OR UPDATE` trigger `guard_subscription_tier()` on `public.users`:

```sql
create or replace function public.guard_subscription_tier()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce((select auth.role()), '') = 'service_role' then
    return new;  -- the RevenueCat webhook writes via service_role; always allowed
  end if;
  if tg_op = 'UPDATE' and new.subscription_tier is distinct from old.subscription_tier then
    raise exception 'TIER_READONLY' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and coalesce(new.subscription_tier, 'free') <> 'free' then
    raise exception 'TIER_READONLY' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_subscription_tier
  before insert or update on public.users
  for each row execute function public.guard_subscription_tier();
```

Rationale for trigger over column-grant surgery: immune to the documented column-grant
footgun (a newly-added writable column would otherwise need a matching re-grant), single
responsibility, directly testable. Same-value updates don't trip (`IS DISTINCT FROM`), so a
client `update({...})` that happens to echo the current tier is unaffected — though in
practice the client never sends the column at all.

### A2 · C3 — drop the direct-create bypass policies

```sql
drop policy "Owners can insert capsules" on public.capsules;
drop policy "Creator can insert groups" on public.groups;
```

After this, the only way to create a capsule/group is the `SECURITY DEFINER` RPC, whose
cap gate (`CAPSULE_LIMIT_REACHED` / `GROUP_RECURRENCE_PRO`) is now un-bypassable. The
`capsules`/`groups` **UPDATE** policies are untouched (legit Edit/Manage flows depend on
them; A3 handles the one tier-sensitive column).

### A3 · C3 — gate group recurrence edits (trigger)

`BEFORE UPDATE` trigger `guard_group_recurrence()` on `public.groups`:

```sql
create or replace function public.guard_group_recurrence()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce((select auth.role()), '') = 'service_role' then
    return new;  -- cron only bumps next_capsule_at, never recurrence_interval
  end if;
  if new.recurrence_interval <> 'manual'
     and new.recurrence_interval is distinct from old.recurrence_interval
     and (select subscription_tier from public.users where id = old.created_by) = 'free'
  then
    raise exception 'GROUP_RECURRENCE_PRO';
  end if;
  return new;
end $$;

create trigger guard_group_recurrence
  before update on public.groups
  for each row execute function public.guard_group_recurrence();
```

Error string matches `create_group_with_creator` so `ManageGroupScreen`'s existing
`GROUP_RECURRENCE_PRO` handler catches it and shows the paywall/limit sheet.

---

## Workstream B — High: server backstops for member & photo caps

Caps are inlined in each trigger as `case when v_tier = 'free' then N else M end` (SQL can't
import TS) with a `-- keep in sync with src/lib/tierLimits.ts` comment, matching the
`create_capsule_with_owner` precedent. Current values: free = 10 members / 20 photos; pro =
50 / 1000. The `case` treats `free` as the low cap and every other value (`pro`, future
`premium`, or any unexpected value) as the high cap — consistent with how a non-free tier is
the paid tier; the create-RPC uses the same "`= 'free'`" test.

### B1 · H1 — member cap (10 → 50)

`BEFORE INSERT` trigger `enforce_member_limit()` on `public.capsule_members`:

```sql
create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_owner uuid;
  v_tier text;
  v_cap int;
  v_count int;
begin
  select owner_id into v_owner from public.capsules where id = new.capsule_id;
  -- the owner's own membership row is never capped
  if new.user_id = v_owner then
    return new;
  end if;
  select subscription_tier into v_tier from public.users where id = v_owner;
  v_cap := case when v_tier = 'free' then 10 else 50 end;  -- sync: tierLimits.ts
  select count(*) into v_count from public.capsule_members where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'MEMBER_LIMIT_REACHED';
  end if;
  return new;
end $$;
```

Counts all rows (joined + pending) — matches how the client cap counts. The count naturally
includes the owner row, so the effective non-owner headroom is `cap - 1`; this matches the
client's own count semantics (the client counts the owner among members). Multi-row group
fan-out fires the row trigger per row and each sees prior in-statement rows, so a fan-out that
would exceed the cap fails at the boundary row.

### B2 · H2 — photo cap (20 → 1000)

`BEFORE INSERT` trigger `enforce_photo_limit()` on `public.media`:

```sql
create or replace function public.enforce_photo_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_tier text;
  v_cap int;
  v_count int;
begin
  select u.subscription_tier into v_tier
    from public.capsules c join public.users u on u.id = c.owner_id
    where c.id = new.capsule_id;
  v_cap := case when v_tier = 'free' then 20 else 1000 end;  -- sync: tierLimits.ts
  select count(*) into v_count from public.media where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'PHOTO_LIMIT_REACHED';
  end if;
  return new;
end $$;
```

Backstops the existing `CapsuleDetailScreen`/`PreviewScreen` client pre-check against races
and modified clients. Accepted limitation: a media INSERT rejected here after the storage
upload already ran orphans that blob in `capsule-media` — the same orphan tradeoff already
documented for server-side storage cleanup. Not worth a two-phase upload to avoid.

---

## Workstream C — Critical/hardening: test-key & webhook scope

### C2a · Remove the Test Store fallback key
`src/lib/purchases.native.ts`: delete `FALLBACK_TEST_KEY` and the `key || FALLBACK_TEST_KEY`
fallback in `apiKey()`. When no real key is configured, `configurePurchases()` skips
configuration and logs a warning (dev without the env var simply has purchases disabled)
instead of silently running on the shared Test Store key that grants free real Pro.

### C2b · Webhook hardens
`supabase/functions/revenuecat-webhook/index.ts`:
- Ignore non-production events early: `if (event.environment && event.environment !== 'PRODUCTION') return 200 no-op;` — a sandbox/Test-Store purchase can no longer write `subscription_tier='pro'`.
- Replace the plain `!==` secret comparison with a constant-time compare (length check + XOR accumulate, or `crypto.timingSafeEqual` on encoded bytes) — folds in L1.

### C2c · Scope the webhook in the RevenueCat dashboard (MCP)
Point the webhook integration at the production App Store app only (not the Test Store app /
shared scope), via the RevenueCat MCP (`get-webhook-integration` → `update-webhook-integration`).
The C2b environment filter is the reliable guard; this is defense-in-depth. Exact capability
confirmed at execution time against the live integration config.

---

## Workstream D — High: payment-integrity client fixes

### H4 · logIn failure must not leave a payer un-mapped
`src/lib/purchases.native.ts` (`identifyUser`) / `src/hooks/useRevenueCat.ts`: set the
`identifiedRef` guard **only after** `Purchases.logIn` resolves successfully, and retry on
failure (bounded). Today the ref is set before the await, so a failed `logIn` is never
retried and purchases attribute to the anonymous RC id — the webhook then can't map them to a
`users` row and the payer never gets Pro server-side.

### H3 · Close the video-length fail-open holes
Video length is client-only, so this only closes the **normal-UI** paths that silently post an
over-cap video:
- **`CreateScreen` `pendingMedia` path**: it enqueues directly to `uploadQueue`, bypassing the
  `PreviewScreen` video gate. Apply the same effective-cap check there before enqueue (offer
  Trim / Skip via the existing limit sheet), so "Create Capsule" from the Preview empty state
  is gated like every other path.
- **Share-intent videos**: `useShareIntent.native.ts` maps files with no `durationMs`, which the
  gate treats as under-cap. Probe the duration (shared `getVideoDurationMs(uri)` helper backed
  by the app's existing video stack) so a shared long video is gated on Preview. Genuinely
  unprobeable clips stay fail-open — documented, client-only limit.

`getVideoDurationMs` and the trim path need a fresh dev/EAS build to verify on device (same as
`trimVideo`) — the gate logic itself is testable without one.

---

## Files touched (summary)

- **New migration(s):** `supabase/migrations/2026072113xxxx_*.sql` — A1 trigger, A2 policy
  drops, A3 trigger, B1 trigger, B2 trigger. May be split A+B for reviewability but applied
  together.
- **Edge function:** `supabase/functions/revenuecat-webhook/index.ts` (C2b).
- **Client:** `src/lib/purchases.native.ts` (C2a, H4), `src/hooks/useRevenueCat.ts` (H4),
  `src/screens/app/CreateScreen.tsx` (H3), `src/hooks/useShareIntent.native.ts` +
  possibly a `src/lib/mediaDuration.ts` addition (H3).
- **Dashboard (MCP, no repo file):** RevenueCat webhook scoping (C2c).
- **Docs:** CLAUDE.md — Monetization section (server gates now real; list the new triggers).

## Testing / verification

- **A/B triggers — live fixtures on production**, reusing the exact method that proved the
  holes open:
  - self-grant `update users set subscription_tier='pro'` as `authenticated` → must raise
    `TIER_READONLY`; a `service_role` write still succeeds.
  - direct `insert into capsules(...)` / `insert into groups(...)` as `authenticated` → must
    fail (no policy); the RPC path still works.
  - free creator flips a group to `monthly` → `GROUP_RECURRENCE_PRO`; a Pro creator succeeds;
    cron `next_capsule_at` bump still succeeds.
  - 11th `capsule_members` insert on a free-owner capsule → `MEMBER_LIMIT_REACHED`; a Pro
    owner reaches 11+.
  - 21st `media` insert on a free-owner capsule → `PHOTO_LIMIT_REACHED`; a Pro owner reaches 21+.
  - **Delete every fixture afterward** (memory: no orphaned test data on prod).
- **C2b:** a synthetic non-production event body returns the 200 no-op; a production GRANT
  still writes `pro`.
- **D:** `npx tsc --noEmit` clean on touched files (filtered for known Expo/Deno noise); H3/H4
  on-device behaviour verified in the next dev build.

## Accepted limitations

- Member/photo triggers count with a subquery on each insert — negligible at these row counts,
  no index change needed (both tables already index `capsule_id`).
- A backstopped photo/member insert that fails after a storage upload orphans that blob
  (photos) — accepted, matches existing cleanup tradeoffs.
- Video length remains client-only and thus bypassable by a modified client — unchanged
  accepted limitation; H3 only closes the normal-UI fail-open paths.
- Fixture-based prod verification mutates production briefly; every fixture is deleted in the
  same session (per the DB-delete incident memory).
