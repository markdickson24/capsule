# Capsule — Full Security & Correctness Audit (Consolidated)

**Date:** 2026-07-22
**Method:** 5 parallel domain audits (backend security, auth/session/platform, client correctness, data/media/cache, payments/notifications/cron), read-only, cross-checked against the **live production DB** (`ezxxvvmesegegkdeniri`) and origin/main source. Critical/High items independently re-verified by the orchestrator.
**Domain reports:** `AUDIT_BACKEND_SECURITY_2026-07-22.md`, `AUDIT_AUTH_PLATFORM_2026-07-22.md`, `AUDIT_CLIENT_CORRECTNESS_2026-07-22.md`, `AUDIT_DATA_MEDIA_CACHE_2026-07-22.md`, `AUDIT_PAYMENTS_NOTIFS_CRON_2026-07-22.md`.

---

## ⚠️ Headline

1. **LIVE CRITICAL data exposure (BS-1):** the private `capsule-media` storage bucket's SELECT policy has **no membership check** — any signed-in user can download **every** capsule's private photos/videos, bypassing privacy, time-locks, surprise mode, and member removal. Verified live. **Needs an immediate prod fix.**
2. **Severe source ↔ production drift:** the entire payment-security remediation + pro-features monetization + video-length gate were **applied to production directly but never merged to `main`** (they live on unmerged remote branches `origin/fix/payment-security-gates` + `origin/feat/capsule-pro-features`). `main` source today still has the RevenueCat Test Store fallback key, no webhook production filter, and no `mediaDuration.ts`. The live DB has the `guard_*`/`enforce_*` triggers, but the migrations aren't tracked on `main` — **a deploy/DB-reset from `main` would regress the hardening.** Many "documented feature missing" findings are this drift, not regressions.

---

## Confirmed live-DB vulnerabilities (verified by orchestrator)

| ID | Sev | Issue | Status |
|---|---|---|---|
| **BS-1** | **Critical** | `capsule-media` bucket has **two** SELECT policies, both `USING (bucket_id='capsule-media')` — no membership/lock/surprise-mode check. Any authenticated user can list + download all private media. | ✅ confirmed live |
| **BS-2** | **High** | `capsule_members` UPDATE has `WITH CHECK = null` → a `viewer` can self-promote `role` to `contributor`/`owner`, gaining upload rights (and self-inserts can pick any role). | ✅ confirmed live |
| **BS-3** | **Medium** | `media` UPDATE `WITH CHECK` only pins `uploader_id` → an uploader can reassign `capsule_id` (cross-capsule injection, bypasses lock + photo cap) or clear `is_flagged`. | ✅ confirmed live |

Fixes for all three are drop/replace-policy migrations (see backend report BS-1/2/3 for exact SQL). Additive/reversible; must be verified with a rolled-back fixture per project rule.

## Source ↔ production drift (meta-finding)

- Payment-security migrations (`2026072114xxxx_payment_security_gates_*`, etc.) + edge-function hardening are **NOT on `main`**; live DB/functions **have** them (triggers verified enabled; deployed `revenuecat-webhook` has the production filter + constant-time compare — the "webhook unfiltered" finding is a *source*-only gap).
- `main` source still contains: RevenueCat **Test Store fallback key** (`purchases.native.ts`), **no** webhook production filter, **no** `mediaDuration.ts` / video-length gate.
- **Reconciliation options:** (A) merge `origin/fix/payment-security-gates` then `origin/feat/capsule-pro-features` into `main` (restores everything at once, tracks the migrations); (B) cherry-pick. Until reconciled, `main` is the wrong source of truth.

## Other findings (by severity)

**High**
- **DM-1** — `uploadQueue.ts`: a `media`-insert failure after a successful storage upload orphans the blob; `dismiss()`/retry never delete it; no orphan-sweep → unbounded storage leak.
- **PN-1** — `create-group-capsules` cron never re-checks the host's tier; a lapsed-Pro host's recurring group keeps auto-creating unlimited capsules/members forever (service-role insert bypasses `enforce_member_limit`).

**Medium**
- **DM-2** — `CapsuleDetailScreen.saveCaption()` ignores the update error and applies the optimistic patch unconditionally (silent failure, no toast — violates the toast-on-failure rule).
- **AP-2** — `pendingJoinStash` / `shareIntentStash` not cleared on sign-out → on a shared/handed-off device, the next user can be silently auto-joined to a capsule/media they never opted into.
- **AP-3** — `useDeepLinks` reset-password path discards `setSession()`'s error → expired/used recovery links fail totally silently.
- **CC-1** — `usePushNotifications.native.ts` starts an unbounded `setInterval` polling `navigationRef.isReady()` on a cold-launch push tap; never cleared/capped (the `useDeepLinks` equivalent is correctly bounded).
- **CC-2** — `CameraScreen` doesn't stop an in-progress recording when the tab loses focus; native view unmounts under the running loop (caught, but state/UX inconsistent).
- **PN-2 / PN-3 / AP-1** — the webhook-filter / fallback-test-key items = the drift above (real on `main` source, fixed on the unmerged branch).

**Low / hygiene**
- **BS-4** `_superlative_target_valid` directly callable (membership-status oracle) — revoke execute.
- **BS-5** `anon` role still has column grants (incl. PII) on `users` — revoke (dead today behind RLS).
- **BS-6** 4 trigger functions on the RPC surface — not exploitable (Postgres refuses non-trigger calls) — revoke for hygiene.
- **CC-3** 4 debounced-search components don't cancel their `setTimeout` on unmount (harmless stale setState).
- **CC-4** `MediaViewerModal` reactions effect `[]` deps miss reactions for items appended while open.
- **DM (low)** signed-URL cache/TTL + a couple of minor cache-invalidation gaps (see data report).

## Areas verified SOUND (no action)
- RevenueCat webhook (deployed), `send-invite-push`, the cron auth + atomic-claim + ≤100-push-chunk patterns, `get_my_capsule_ids`/`get_my_group_ids` recursion avoidance, the create/delete RPCs' inline authorization, `authenticated` PII column scoping, `friendships`/`blocked_users`/`content_reports`/`superlative_*` WITH-CHECK scoping, and (client) Rules-of-Hooks compliance, realtime-channel cleanup, `useCachedFetch` race guards, optimistic-update+toast discipline.

---

## Proposed remediation plan (phased)

- **Phase A — URGENT prod security (BS-1, BS-2, BS-3):** one additive migration (drop the 2 open storage SELECT policies + create a membership-gated one; add `WITH CHECK` scoping to `capsule_members` UPDATE and `media` UPDATE). Apply to prod, verify with rolled-back fixtures, commit the migration. **Requires explicit approval to touch prod.**
- **Phase B — reconcile drift:** merge the unmerged payment-security + pro-features branches into `main` so source = production (restores fallback-key removal, webhook filter, video gate, and tracks the live migrations). **Requires a decision on approach.**
- **Phase C — code fixes (subagents):** DM-1 (orphan handling), PN-1 (cron tier recheck), DM-2/AP-2/AP-3/CC-1/CC-2 and the Low items, each via implement→review subagents.
- **Phase D — hygiene + docs:** BS-4/5/6 revokes, CLAUDE.md updates (the drift, `report-digest`, new policies), enable Supabase leaked-password protection.
