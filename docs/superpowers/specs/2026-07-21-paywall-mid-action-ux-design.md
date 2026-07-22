# Mid-Action Paywall UX + Video Preservation — Design

_Date: 2026-07-21 · Status: approved, ready for planning_

## Goal

Two linked improvements to the just-shipped Capsule Pro tier gates:
1. **Smooth in-app limit sheet** — when a user is mid-action and hits a cap, replace the abrupt full-screen native RevenueCat paywall (owner) and the bare `toast` (guest) with a polished, animated bottom sheet that explains the limit and offers the right action.
2. **Never lose a user's video** — a clip over the 30s free cap is no longer silently dropped or hard-cut. The user is offered **Trim to first 30s** (keeps them free, posts a 30s clip) or **Upgrade** (owner-only, posts full), with the original clip preserved until they choose.

Builds on `docs/superpowers/specs/2026-07-21-pro-tier-enforcement-design.md` (the five gates + `proGateHit` owner-vs-guest rule) and `src/lib/proGate.ts`.

## Non-goals

- No trim scrubber (which-30s picker) — trim is always the **first 30s**, one tap.
- No custom pricing/purchase UI in the sheet — the Upgrade CTA opens the existing hosted RevenueCat paywall.
- No change to the server-side gates (capsule count, group recurrence) — those RPCs stay as-is.
- Share-intent videos with unknown duration are not gated (fail-open) — acceptable; can tighten later.

## Part 1 — The smooth limit sheet

### Imperative global sheet (mirrors `toast`/`ToastHost`)
Gates call plain functions (`proGateHit`) from non-component code, so the sheet is driven imperatively, exactly like `src/lib/toast.ts` + `<ToastHost>`:
- **`src/lib/limitSheet.ts`** — module-level `limitSheet.show(config)` / `limitSheet.hide()` with a pub/sub subscriber (one host).
  ```ts
  type LimitAction = { label: string; style?: 'primary' | 'secondary' | 'destructive'; onPress: () => void };
  type LimitSheetConfig = { title: string; message: string; icon?: string; actions: LimitAction[] };
  ```
- **`src/components/LimitSheet.tsx`** — the presentational sheet: a transparent `Modal` with an animated slide-up dark-theme card (`SafeAreaProvider`-wrapped, per the CLAUDE.md modal-safe-area rule), a title, message, optional Ionicon, and the action buttons stacked (primary accent-filled, secondary ghost, destructive red). Backdrop-tap and a handle dismiss it (equivalent to the last/cancel action). Reuse the design tokens + the members-sheet slide/pan patterns already in the codebase.
- **`<LimitSheetHost>`** — mounted once near the app root next to `<ToastHost>` (App.tsx), subscribes to `limitSheet`, renders `<LimitSheet>`. Tapping an action fires its `onPress` then hides.

Web-safe: it's just a Modal + Animated; no native deps. (The Upgrade action's `presentPaywall()` is the only native piece and already no-ops on web.)

### `proGateHit` rewired
`src/lib/proGate.ts`'s `proGateHit` now routes through `limitSheet` instead of calling `presentPaywall`/`toast` directly. Its params are **extended (backward-compatibly)** so each gate can supply its own copy — `proGateHit({ currentUserIsHost, guestMessage, title?, ownerMessage? })` — and the call pattern stays the same (every gate still calls `proGateHit`), with the five call sites updated to pass gate-specific copy. Behavior:
- **Owner:** `limitSheet.show({ title, message: ownerMessage, actions: [ { label: 'Upgrade to Capsule Pro', style: 'primary', onPress: presentPaywall }, { label: 'Not now', style: 'secondary', onPress: () => {} } ] })`.
- **Guest:** `limitSheet.show({ title, message: guestMessage, actions: [ { label: 'Got it', style: 'secondary', onPress: () => {} } ] })`.

Sensible defaults keep it terse if a gate omits `title`/`ownerMessage`. Per-gate copy:
- Capsule count: "You've reached 3 capsules" / owner "Capsule Pro unlocks unlimited capsules." / guest n/a (create-time is always owner).
- Groups: "Recurring groups are a Pro feature" / "Capsule Pro unlocks auto-scheduled group capsules."
- Members: "This capsule is full" / owner "Capsule Pro raises the limit to 50 members." / guest "Its host is on the free plan."
- Photos: "This capsule is full" / owner "Capsule Pro raises the limit to 1000 photos." / guest "Its host is on the free plan."

The existing guest `guestMessage` strings map onto the guest `message`. No gate logic changes — only the presentation `proGateHit` produces.

## Part 2 — Video: trim-or-upgrade, never lose it

### Native trim (local Expo module)
Extend the existing **`modules/expo-video-stitcher`** with a trim function (same AVFoundation / MediaMuxer machinery it already uses for stitching — one module, no new autolink target, no third-party dep):
- **JS** (`modules/expo-video-stitcher/index.ts`): `trimVideo(uri: string, maxSeconds: number): Promise<string>` — returns a trimmed temp-file URI (a new file; original untouched). Guarded `Platform.OS !== 'web'` + try/catch like the existing `stitchVideos`.
- **iOS** (Swift): `AVAssetExportSession` over the asset with `timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: maxSeconds, preferredTimescale: 600))`, output `.mp4` to a temp URL, async export, resolve the URL. Choose a preset that honors the exact `timeRange` so the result is `<= maxSeconds` (a quality preset re-encodes to an exact cut; passthrough is faster but cuts at sync samples — acceptable as long as the result is `<= maxSeconds`; if passthrough can overshoot, use the quality preset). Result duration must be `<= maxSeconds` so it re-passes the cap.
- **Android** (Kotlin): `MediaExtractor` + `MediaMuxer` copying video+audio track samples while `sampleTime <= maxSeconds * 1_000_000`, then stop — naturally yields `<= maxSeconds`. Mirrors the module's existing Android stitch path.
- **Requires a fresh EAS/dev build** before it works on device (same as dual-camera/stitcher); not runnable in Expo Go. Expect on-device iteration.

### Duration on `PendingMedia`
Add optional `durationMs?: number` to `PendingMedia`:
- **Library pick:** from `asset.duration` normalized via the existing `durationMs()` web/native helper (already in CapsuleDetailScreen — move it to a shared spot, e.g. `src/lib/mediaDuration.ts`, or keep it where both callers can import).
- **Camera:** `CameraScreen` passes the recorded length (it already tracks `recordSecondsRef`; for the flip-stitch path that's the summed total) as `durationMs` on the `Preview` navigation.
- **Share intent / unknown:** leave `durationMs` unset → treated as under-cap (fail-open, not gated).

### Enforcement moves to Preview's "Add to Capsule"
All video now flows to `PreviewScreen` with the full clip; the length cap is enforced there, at the post action, alongside the existing photo-count gate (Task G):
- **Remove** CameraScreen's free-tier record hard-stop (revert Task H's tier-aware record cap) — everyone records up to the app's 120s max (`MAX_RECORD_SECONDS`), so a moment is never cut off mid-capture. CameraScreen no longer needs tier/owner logic for recording.
- **Remove** the pre-Preview drop in CapsuleDetailScreen's `filterOversizedVideos` — over-cap library clips pass through to Preview instead of being silently skipped.
- **In PreviewScreen `upload()`** (already gated for photo count per selected target): compute the **effective video cap = min over selected target capsules of `limitsForTier(ownerTier).videoSeconds`** (strictest wins — trimming to it satisfies every target). For each selected video item whose `durationMs/1000 > effectiveVideoCap`, it's over-cap. If any are over-cap, do **not** enqueue yet — show the **video limit sheet** and let the user decide:
  - **[Trim to first {cap}s & post]** (available to everyone — trimming complies with the host cap, doesn't bypass it): run `trimVideo(uri, cap)` on each over-cap item (show a brief "Trimming…" state), swap in the trimmed URIs (with corrected `durationMs`), then enqueue the whole batch.
  - **[Upgrade to post full]** (shown only when the strictest target is a capsule the current user OWNS — i.e. upgrading actually lifts it): `presentPaywall()`. On return, if now Pro, re-evaluate and post.
  - **[Skip these]**: drop only the over-cap video items, enqueue the rest.
  - **Cancel / backdrop**: dismiss the sheet, stay on Preview with everything intact (nothing lost) — the user can re-tap Add to Capsule later.
- Non-video items and under-cap videos are unaffected and enqueue normally.

This reuses `limitSheet` (custom `actions`), so the video case is one more `limitSheet.show(...)` config, not a bespoke modal.

## Files touched (summary)

- **New:** `src/lib/limitSheet.ts`, `src/components/LimitSheet.tsx`, `<LimitSheetHost>` (in LimitSheet.tsx or its own file), possibly `src/lib/mediaDuration.ts`.
- **Native:** `modules/expo-video-stitcher/index.ts` (+ `trimVideo`), `ios/…Swift`, `android/…Kotlin`.
- **Modified:** `App.tsx` (mount `<LimitSheetHost>`), `src/lib/proGate.ts` (route through the sheet; add optional title/ownerMessage), the five gate call sites (pass gate-specific copy — CreateScreen, OnboardingScreen, CreateGroupScreen, CapsuleDetailScreen InviteModal + NotificationsScreen), `src/types` PendingMedia (`durationMs`), `PreviewScreen.tsx` (video-length gate + trim flow), `CameraScreen.tsx` (drop free hard-stop, pass durationMs), `CapsuleDetailScreen.tsx` (drop `filterOversizedVideos` early-drop, still pass library picks to Preview).

## Enforcement note (unchanged principle)

Video length remains **client-only** (duration isn't stored server-side) — same accepted limitation as before. The server gates (capsule count, group recurrence) are untouched. `subscription_tier`/owner-tier reads are as established in the tier-enforcement spec.

## Testing / verification

- **`limitSheet`/`LimitSheet`**: exercise each gate in a dev build — owner sees the sheet → Upgrade opens the paywall; guest sees explain-only. Web: sheet renders, Upgrade no-ops.
- **`trimVideo`**: on-device (physical iPhone + Android) — record/pick a >30s clip as a free host, Trim → the posted clip is ≤30s and plays; verify the original isn't mutated and a Cancel leaves the clip on Preview.
- **Effective-cap logic**: a video allowed for a Pro-host target but blocked for a free-host target when both are selected (strictest wins).
- **tsc** (`npx tsc --noEmit`, filtered for the known Expo/Deno noise) — no new errors in touched files.
- Regression: the non-video gates still block correctly and now show the sheet; the photo-count gate (Task G) still fires alongside the new video gate on Preview.

## Accepted limitations / notes

- Multi-select with mixed-tier targets uses the strictest cap; trimming to it posts one trimmed clip to all — a deliberate simplification (single-target is the common path).
- Share-intent videos with no `durationMs` aren't length-gated (fail-open).
- Trim precision: result must be `<= cap`; exact-second vs sync-sample cut is an implementation choice (spec requires `<= cap`).
- A fresh EAS build is required for the native trim; until then the trim button would fail — the sheet/paywall parts work without it, but ship the two together.
