# Audit Sweep — 2026-07-17

> **Status (end of session):** all three fix waves executed and PR'd.
> Merge order: **#37** (repair — lands bug-hunt waves 3+4 that GitHub had
> merged into base branches instead of main) → **#38** (Wave A) → **#39**
> (Wave B) → **#40** (Wave C). Server-side pieces (3 migrations, 2 edge-fn
> redeploys) are already live on production. Wave A's BUGS #7 was adjudicated
> not-a-bug during review (see table). Feature gaps + ops items below remain
> held for product decisions.

Re-verification of every finding in the seven pre-existing audits (`BUGS.md`,
`GAPS.md`, `GROUPS.md`, `PERFORMANCE.md`, `UX.md`, `UX_POLISH.md`,
`APP_STORE_REVIEW.md`) against the current codebase — post Groups revamp,
contribution nudges, capsule start dates, Apple Sign In, and the 4-wave bug
hunt (PRs #33–36, all merged). Seven parallel verification agents produced
per-audit reports; every surviving finding below was then adversarially
re-verified inline (code read + live-DB checks on production). `MARKETING.md`
and `LANDING_SCREENSHOTS.md` are strategy/content docs and were excluded.

**Headline:** of ~90 findings across the seven audits, the large majority are
now IMPLEMENTED. Survivors: **10 confirmed code fixes**, **9 App Store
submission mechanics**, **14 feature gaps** (held for product decisions), and
**7 ops/external items** (App Store Connect, content, design decisions).

## Adjudicated out (verified false or already decided)

- **APP_STORE #1 (Apple Sign In config)** — FALSE POSITIVE. `expo-apple-authentication`
  is in `app.json` plugins (the config plugin injects the entitlement);
  TestFlight-verified end-to-end. `usesAppleSignIn` is redundant with the plugin.
- **GROUPS #7 (fetchers swallow errors)** — documented deliberate decision in
  CLAUDE.md (`useCachedFetch` has no error path for a throwing fetcher).
- **PERF #3 remainder (parallelize upload loop)** — sequential-per-task is now
  load-bearing for the wave-1 `TASK_TIMEOUT_MS` bounding; not worth the risk.
- **GROUPS #10/#21 live-parity residuals** — verified live: `notify_on_invite`
  and `check_cron_secret` match the captured migrations.

---

## Fix Wave A — Data-loss & correctness

| ID | Sev | Finding | Fix |
|---|---|---|---|
| BUGS #1 | 🔴 | Deleting a locked **surprise-mode** capsule orphans all storage files — client can't read `media` rows under RLS (live policy confirmed), so key collection returns empty. Wave 1 fixed delete *ordering*, not this. | SECURITY DEFINER RPC `delete_capsule_with_storage(p_capsule_id)`: owner-authorized; collects `storage_key`/`thumbnail_key`/`alt_storage_key` server-side, deletes `storage.objects` rows + capsule row atomically (same pattern as `delete_my_account`'s cleanup). Both `confirmDelete` sites call it. |
| GROUPS #3 | 🔴 | `createGroup` (`src/lib/groups.ts:140-147`) leaves an invisible orphaned `groups` row if the creator-member insert fails — same class as the production orphan-capsule bug. | RPC `create_group_with_creator(...)` doing both inserts in one function body (mirrors `create_capsule_with_owner`). |
| BUGS #8 | 🟡 | Hold-to-record strands recording if the finger lifts during the first-run mic-permission prompt. | Re-check press state after permission resolves; abort cleanly if released. |
| BUGS #7 | 🟡 | ~~Front-camera photos not mirrored~~ **ADJUDICATED NOT-A-BUG during Wave A:** `CameraView`'s `mirror={facing === 'front'}` prop mirrors the *captured* JPEG on both platforms (verified in expo-camera 17 native source). A JS-side flip was implemented, caught by review as a double-flip regression, and reverted. | CLAUDE.md corrected to document the real mechanism. |
| BUGS #12 | 🟡 | Member lists keyed by array index (`CapsuleDetailScreen.tsx:1749,2129`). | Key by `user_id`/member id. |

## Fix Wave B — App Store submission mechanics

| ID | Sev | Finding | Fix |
|---|---|---|---|
| ASR #3 | ⛔ | Settings links dead `https://capsule.app/privacy|terms` — real site is `getcapsuleapp.com` (landing/legal.html exists). | Point Settings at the live legal URLs. (Policy *text* expansion to cover app data = content item, held.) |
| ASR #2 | ⛔ | No terms-agreement line at signup; no support/contact row in Settings. | Signup footer line ("By creating an account you agree to…" linking Terms/Privacy) + Settings Support row (mailto + legal links). |
| ASR #5 | 🟠 | `expo-media-library` missing from app.json plugins → no `NSPhotoLibraryAddUsageDescription`; `handleSaveQR` never requests permission → save-to-camera-roll crashes a production build. | Add plugin with save-permission string; request permission in `handleSaveQR` (and the viewer download path). |
| ASR #11 | 🟡 | Circular camera/mic purpose strings. | Rewrite to explain the *why* (Apple rejects circular strings). |
| ASR #10 | 🟡 | App display name is lowercase "capsule". | `"name": "Capsule"`. |
| ASR #9 | 🟡 | Share extension shows as "ShareExtension" in the share sheet. | `iosShareExtensionName: "Capsule"`. |
| ASR #14 | 🟡 | Android permissions each declared twice in app.json. | Dedupe. |
| ASR #6 | 🟠 | `supportsTablet: true` exposes an unoptimized iPad layout to review + requires iPad screenshots. | Set `false` per audit recommendation. **Flagged: reversible product decision — say the word to keep iPad.** |
| ASR #12 | 🟡 | Invite share message is a raw `capsule://` URI — meaningless to someone without the app. | Human-readable message; still includes the link. |

## Fix Wave C — Polish & perf residuals

| ID | Sev | Finding | Fix |
|---|---|---|---|
| UXP #4 | 🔥 | The sealed-moment ceremony exists only in Onboarding; regular `CreateScreen.handleCreate` just navigates. | Show the lock scale-in + haptic + countdown moment on every capsule create (reuse Onboarding's pattern). |
| UX 6.2 | 🟡 | `ProfileScreen.tsx:185` web avatar-failure path shows raw `error.message` (RLS text). | Generic copy. |
| UX 7.2 | 🟡 | `BlockedUsersScreen.tsx:158` empty-state copy at `#555555` (≈2.5:1). | `#888888` per the documented floor. |
| PERF #9 | 🟡 | `notifications.actor_id` FK unindexed (live-confirmed) — matters now that account deletion cascades through it. | Migration: `idx_notifications_actor_id`. |
| PERF #10 | 🟡 | `pushTokensFor` queries per-capsule in cron loops. | Batch with `.in('capsule_id', …)` where a tick handles multiple capsules. |
| GROUPS #11 | 🟠 | GroupDetail member bubbles skip the `blockStore` filter (parity gap with every other member-list surface). | Filter + count consistently. |
| GROUPS #15 | 🟡 | Cron capsule titles `"{name} — {Month Year}"` collide 4×/month for weekly groups. | Weekly gets day-granular title (e.g. "{name} — Jul 20"). |
| GROUPS #19 | 🟡 | No creator crown on GroupDetail's own member bubbles (ManageGroup has one). | Add badge. |

## Held for product decisions — feature gaps (GAPS.md)

Not implemented in the waves; each needs your go (per standing preference to
gate features): **library video upload** (#1 — hours, highest value/effort in
the doc), upload limits (#2), join-link web preview + universal links (#4),
bulk export (#5), pinch-to-zoom (#6), Settings change-password (#7 remainder),
manual ownership transfer (#8), leave-a-capsule (#9 — needs RLS change,
live-confirmed owner-only DELETE), delete-own-uploads (#10 — needs RLS),
pagination for Home/media (#11 remainder), offline/persisted cache & queue
(#12), force-update kill-switch (#13), product analytics (#14), notification
preferences (#15).

**⚠️ Telemetry flag:** the uncommitted `App.tsx`/`package.json` edits removed
Sentry — the app currently ships with *zero* crash/error telemetry. If that
wasn't intentional, it belongs at the top of the feature list.

## Held — ops / external / content

- **ASR #4** (⛔): demo capsules are empty (live-confirmed 0 media) and unlock
  ~a month out — a reviewer sees a locked, empty app. Needs real seeded photos
  (ties into `LANDING_SCREENSHOTS.md`'s demo-data plan) + a near-term unlock +
  demo credentials in App Review notes.
- **ASR #8/#15/#16**: ASC privacy questionnaire, age rating,
  `ITSAppUsesNonExemptEncryption: false`, demo video — App Store Connect tasks.
- **Privacy-policy text** covering app data (content).
- **GROUPS #16/#17/#20**: recurrence safeguards, cron-defaults documentation,
  push-driven cache invalidation — design decisions, low urgency.
- **PERF #11 remainder**: web upload buffering, per-card `setInterval` — the
  audit itself called these conditional/at-scale.

## Verification provenance

Per-audit agent reports: `~/.claude/jobs/a6a2021c/tmp/verify-*.md`. Live-DB
checks run read-only against production (`ezxxvvmesegegkdeniri`): `media`
SELECT policy, `capsule_members` DELETE policy, `notifications` indexes,
`notify_on_invite`/`check_cron_secret` definitions, facade00 demo-capsule
media counts.
