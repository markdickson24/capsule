# Mid-Action Paywall UX + Video Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abrupt native-paywall jump / bare toast at every tier gate with a smooth in-app sheet, and make an over-30s video offer Trim-to-30s (all users) or Upgrade (owner) instead of being dropped/hard-cut — never losing the clip.

**Architecture:** A global imperative sheet (`limitSheet` + `<LimitSheetHost>`, mirroring the existing `toast`/`<ToastHost>`) that `proGateHit` drives. A native `trimVideo()` added to the existing `modules/expo-video-stitcher`. Video-length enforcement moves to `PreviewScreen`'s "Add to Capsule" action (camera stops hard-capping; library stops dropping), where over-cap clips route through the sheet with a Trim action.

**Tech Stack:** React Native + Expo, TypeScript, a local Expo native module (Swift `AVAssetExportSession` / Kotlin `MediaExtractor`+`MediaMuxer`), RevenueCat (`presentPaywall` via `src/lib/purchases`).

## Global Constraints

- **Mirror the existing `toast` pattern exactly** for the imperative sheet: module-level current-value + `seq` id + `Set` of listeners + `subscribe`/`notify`, host reads via `get()`. See `src/lib/toast.ts`.
- **Owner-vs-guest rule** (unchanged): owner → sheet with an Upgrade action that calls `presentPaywall()`; guest → sheet with no upgrade. **Exception for video:** the **Trim** action is offered to everyone (it complies with the host cap); only **Upgrade** stays owner-only.
- **Never delete/discard a user's clip silently.** Over-cap videos reach Preview intact; Cancel leaves them on Preview.
- **`trimVideo(uri, maxSeconds)` must return a NEW temp file** (original untouched) whose duration is `<= maxSeconds`.
- **Staging discipline:** each task's commit stages ONLY that task's files. These working-tree files are UNRELATED and must never be staged/reverted/stashed: `App.tsx` is EXEMPT (Task 1 legitimately edits it — but stage only App.tsx's `<LimitSheetHost>` change, nothing else if App.tsx has unrelated dirty hunks) — verify with `git diff App.tsx` before staging and stage the single relevant hunk if needed. Other untouchable dirty files: `HANDOFF.md`, `app.json`, `eas.json`, `package.json`, `package-lock.json`, `src/lib/avatarUrl.ts`.
- **tsc:** baseline ~73 pre-existing errors repo-wide; only NEW errors in touched files count. Verify with a filtered grep excluding `@expo/vector-icons`.
- **No jest/vitest** — pure-logic modules use the `npx tsx <file>.test.ts` + `node:assert` precedent (see `src/lib/tierLimits.test.ts`).
- **Native code can't be compiled/verified in this environment** — a fresh EAS/dev build is required (flagged to the user). Native tasks verify via tsc on the JS surface + code inspection; on-device is a manual follow-up.
- Commit after each task. Work on the current branch (`feat/capsule-link-preview`); no PRs unless asked.

---

### Task 1: Smooth limit sheet (infrastructure)

**Files:**
- Create: `src/lib/limitSheet.ts`
- Create: `src/lib/limitSheet.test.ts`
- Create: `src/components/LimitSheet.tsx` (exports both `LimitSheet` and `LimitSheetHost`)
- Modify: `App.tsx` (mount `<LimitSheetHost>` next to `<ToastHost>`)

**Interfaces:**
- Produces: `limitSheet.show(config)`, `limitSheet.hide()`, `limitSheet.get()`, `limitSheet.subscribe(fn)`; types `LimitAction`, `LimitSheetConfig`; component `<LimitSheetHost/>`.

- [ ] **Step 1: Write `src/lib/limitSheet.ts`**

```ts
// Global imperative "you hit a limit" sheet — mirrors src/lib/toast.ts so
// non-component code (proGateHit, the Preview video gate) can trigger a smooth
// in-app sheet. Rendered once by <LimitSheetHost> near the app root.
export type LimitAction = {
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
  onPress: () => void;
};
export type LimitSheetConfig = {
  title: string;
  message: string;
  icon?: string; // Ionicons name
  actions: LimitAction[];
};
type LimitSheetState = LimitSheetConfig & { id: number };

let current: LimitSheetState | null = null;
let seq = 0;
const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) fn(); }

export const limitSheet = {
  get: (): LimitSheetState | null => current,
  show(config: LimitSheetConfig) {
    current = { ...config, id: ++seq };
    notify();
  },
  hide() {
    current = null;
    notify();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
```

- [ ] **Step 2: Write `src/lib/limitSheet.test.ts` and run it**

```ts
// Run: npx tsx src/lib/limitSheet.test.ts
import assert from 'node:assert/strict';
import { limitSheet } from './limitSheet';

let ticks = 0;
const unsub = limitSheet.subscribe(() => { ticks++; });
assert.equal(limitSheet.get(), null);

limitSheet.show({ title: 'T', message: 'M', actions: [{ label: 'OK', onPress: () => {} }] });
assert.equal(limitSheet.get()?.title, 'T');
assert.equal(limitSheet.get()?.actions.length, 1);
assert.equal(ticks, 1);

const firstId = limitSheet.get()!.id;
limitSheet.show({ title: 'T2', message: 'M2', actions: [] });
assert.notEqual(limitSheet.get()!.id, firstId); // new id each show
assert.equal(ticks, 2);

limitSheet.hide();
assert.equal(limitSheet.get(), null);
assert.equal(ticks, 3);
unsub();
console.log('limitSheet.test.ts: all assertions passed');
```

Run: `npx tsx src/lib/limitSheet.test.ts` → Expected: `limitSheet.test.ts: all assertions passed`.

- [ ] **Step 3: Write `src/components/LimitSheet.tsx`**

An animated slide-up bottom sheet. Requirements (follow existing codebase conventions — read `src/components/ConfirmModal.tsx` for the transparent-Modal + dark-card pattern and `src/lib/toast`'s host for the subscribe pattern):
- `LimitSheet` (presentational): props `{ config: LimitSheetConfig | null; onDismiss: () => void }`. Renders a transparent RN `<Modal visible={!!config} transparent animationType="none">`, wrapped in its OWN `<SafeAreaProvider>` (CLAUDE.md: SafeAreaView returns zero insets inside a Modal otherwise). A backdrop `Pressable` (dark rgba) that calls `onDismiss`; a card slid up via `Animated` (translateY from screen height to 0 on show, reverse on hide — use a `useRef(new Animated.Value(...))`, `useNativeDriver: true` for transform). Card: a small grab handle, optional `Ionicons` `icon` (accent color from `useTheme()`), `title` (bold ~18px #FFF), `message` (#888888, ~14px), then the `actions` as full-width stacked buttons: `primary` = accent-filled white text; `secondary` = ghost/#1A1A1A with #FFF; `destructive` = #FF3B30 text. Each button `onPress` = fire the action then dismiss. Use design tokens from the Design System (bg #0A0A0A/#1A1A1A, radius 16). `accessibilityRole="button"` on icon-only elements (none here since buttons have labels).
- `LimitSheetHost` (the mounted host): subscribes to `limitSheet`, holds `const [config, setConfig] = useState(limitSheet.get())`, updates on notify, renders `<LimitSheet config={config} onDismiss={limitSheet.hide} />`. When an action is tapped, call `action.onPress()` then `limitSheet.hide()`.

- [ ] **Step 4: Mount `<LimitSheetHost>` in `App.tsx`**

Add `import { LimitSheetHost } from './src/components/LimitSheet';` and render `<LimitSheetHost />` immediately adjacent to the existing `<ToastHost />` (line ~45). Change ONLY this — `git diff App.tsx` first; if App.tsx has unrelated dirty hunks (Sentry removal etc.), stage only the LimitSheetHost hunk via `git add -p`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "limitSheet|LimitSheet|App\.tsx" | grep -v "@expo/vector-icons"` → Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add src/lib/limitSheet.ts src/lib/limitSheet.test.ts src/components/LimitSheet.tsx
git add -p App.tsx   # stage only the LimitSheetHost hunk
git commit -m "Add smooth global limit sheet (limitSheet + LimitSheetHost)"
```

---

### Task 2: Route the gates through the sheet

**Files:**
- Modify: `src/lib/proGate.ts`
- Modify: `src/screens/app/CreateScreen.tsx`, `src/screens/app/OnboardingScreen.tsx`, `src/screens/app/CreateGroupScreen.tsx`, `src/screens/app/CapsuleDetailScreen.tsx` (InviteModal), `src/screens/app/NotificationsScreen.tsx` — the five `proGateHit` call sites.

**Interfaces:**
- Consumes: `limitSheet` (Task 1), `presentPaywall` (`src/lib/purchases`).
- Produces: `proGateHit({ currentUserIsHost, guestMessage, title?, ownerMessage? })` — now shows the sheet.

- [ ] **Step 1: Rewire `src/lib/proGate.ts`**

```ts
import { presentPaywall } from './purchases';
import { limitSheet } from './limitSheet';

// Called when a Pro cap is hit, mid-action. Shows the smooth in-app limit sheet
// instead of jumping to the native paywall (owner) or a bare toast (guest).
// Owner → Upgrade action opens the hosted RevenueCat paywall; guest → explain
// only (a guest upgrading wouldn't lift a host-based cap).
export function proGateHit(params: {
  currentUserIsHost: boolean;
  guestMessage: string;
  title?: string;
  ownerMessage?: string;
}): void {
  if (params.currentUserIsHost) {
    limitSheet.show({
      title: params.title ?? 'Capsule Pro',
      message: params.ownerMessage ?? 'Upgrade to Capsule Pro to lift this limit.',
      icon: 'star',
      actions: [
        { label: 'Upgrade to Capsule Pro', style: 'primary', onPress: () => { presentPaywall(); } },
        { label: 'Not now', style: 'secondary', onPress: () => {} },
      ],
    });
  } else {
    limitSheet.show({
      title: params.title ?? 'This capsule is full',
      message: params.guestMessage,
      icon: 'lock-closed',
      actions: [{ label: 'Got it', style: 'secondary', onPress: () => {} }],
    });
  }
}
```

- [ ] **Step 2: Add gate-specific copy at each call site**

For each existing `proGateHit(...)` call, add `title` and `ownerMessage` (keep the existing `currentUserIsHost`/`guestMessage`). Exact copy:
- `CreateScreen.tsx` (both the pre-check and the RPC-error map): `title: "You've reached 3 capsules", ownerMessage: 'Capsule Pro unlocks unlimited active capsules.'`
- `OnboardingScreen.tsx` (RPC-error map): same as CreateScreen.
- `CreateGroupScreen.tsx` (both sites): `title: 'Recurring groups are a Pro feature', ownerMessage: 'Capsule Pro unlocks auto-scheduled group capsules.'`
- `CapsuleDetailScreen.tsx` InviteModal: `title: 'This capsule is full', ownerMessage: 'Capsule Pro raises the limit to 50 members.'` (guestMessage unchanged: 'This capsule is full — its host is on the free plan.')
- `NotificationsScreen.tsx` accept path: this is a GUEST-only path that currently calls `toast.show(...)`, NOT `proGateHit`. Convert it to `proGateHit({ currentUserIsHost: false, guestMessage: 'This capsule is full — its host is on the free plan.', title: 'This capsule is full' })` for consistency (still no upgrade, since currentUserIsHost is false). Remove the now-unused `toast` import there if nothing else uses it.

(The photo-gate copy in CapsuleDetailScreen/PreviewScreen already passes `guestMessage`; add matching `title`/`ownerMessage` there too — `title: 'This capsule is full', ownerMessage: 'Capsule Pro raises the limit to 1000 photos.'`)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "proGate|CreateScreen|OnboardingScreen|CreateGroupScreen|CapsuleDetailScreen|NotificationsScreen|PreviewScreen" | grep -v "@expo/vector-icons"` → Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add src/lib/proGate.ts src/screens/app/CreateScreen.tsx src/screens/app/OnboardingScreen.tsx src/screens/app/CreateGroupScreen.tsx src/screens/app/CapsuleDetailScreen.tsx src/screens/app/NotificationsScreen.tsx src/screens/app/PreviewScreen.tsx
git commit -m "Route all tier gates through the smooth limit sheet with per-gate copy"
```

---

### Task 3: Native `trimVideo` in expo-video-stitcher

**Files:**
- Modify: `modules/expo-video-stitcher/index.ts`
- Modify: `modules/expo-video-stitcher/ios/ExpoVideoStitcherModule.swift`
- Modify: `modules/expo-video-stitcher/android/src/main/java/expo/modules/videostitcher/ExpoVideoStitcherModule.kt`

**Interfaces:**
- Produces: `trimVideo(uri: string, maxSeconds: number): Promise<string>` (JS) → native `AsyncFunction("trimVideo")`.

- [ ] **Step 1: Add the JS wrapper in `modules/expo-video-stitcher/index.ts`**

Extend the `nativeModule` type and add:
```ts
let nativeModule: {
  stitchVideos?: (uris: string[]) => Promise<{ uri: string }>;
  trimVideo?: (uri: string, maxSeconds: number) => Promise<{ uri: string }>;
} | null = null;
// ... (existing requireNativeModule block unchanged) ...

/**
 * Trim a video to its first `maxSeconds` seconds. Returns the file:// URI of a
 * NEW trimmed temp file (original untouched); result duration is <= maxSeconds.
 * Native-only; throws on web / when the module is unavailable.
 */
export async function trimVideo(uri: string, maxSeconds: number): Promise<string> {
  if (!nativeModule?.trimVideo) {
    throw new Error('ExpoVideoStitcher.trimVideo is not available on this platform.');
  }
  const { uri: out } = await nativeModule.trimVideo(uri, maxSeconds);
  return out;
}
```

- [ ] **Step 2: Add the iOS implementation**

In `ExpoVideoStitcherModule.swift`, read the existing `AsyncFunction("stitchVideos")` + `static func stitch` to mirror error handling / temp-file / promise style, then add:
- `AsyncFunction("trimVideo") { (uri: String, maxSeconds: Double, promise: Promise) in ... }` that calls a new `static func trim(uri:maxSeconds:) async throws -> String`.
- `trim`: build `AVURLAsset` from the uri; create an `AVAssetExportSession` (use a preset that honors an explicit `timeRange` and yields duration `<= maxSeconds` — a quality/`AVAssetExportPresetHighestQuality`-style preset gives an exact cut; passthrough is acceptable only if it does not overshoot `maxSeconds`); set `exportSession.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: min(maxSeconds, assetDurationSeconds), preferredTimescale: 600))`; `outputFileType = .mp4`; `outputURL` = a unique temp `.mp4` in `NSTemporaryDirectory()`; run `exportAsynchronously`/`export(to:)`; on completion resolve the output URL string (`file://...`), on failure/cancel reject. Guard: if the source is already `<= maxSeconds`, you may still export (simplest) or return the original — either is fine as long as a valid `<= maxSeconds` file URI comes back.

- [ ] **Step 3: Add the Android implementation**

In `ExpoVideoStitcherModule.kt`, mirror the existing `stitch` (which already uses `MediaExtractor`/`MediaMuxer`) and add:
- `AsyncFunction("trimVideo") { uri: String, maxSeconds: Double, promise: Promise -> ... }` calling a private `trim(uri, maxSeconds): String`.
- `trim`: `MediaExtractor` on the input; create a `MediaMuxer` (MP4) at a temp output path; add all tracks (video + audio); for each track, `selectTrack`, `seekTo(0, SEEK_TO_CLOSEST_SYNC)`, then loop `readSampleData` and `writeSampleData` while `extractor.sampleTime <= (maxSeconds * 1_000_000).toLong()`; break when exceeded or `readSampleData` returns < 0; `advance()`. Stop/release muxer + extractor. Return the output `file://` path. Naturally yields `<= maxSeconds`.

- [ ] **Step 4: Typecheck the JS surface**

Run: `npx tsc --noEmit 2>&1 | grep -E "video-stitcher" | grep -v "@expo/vector-icons"` → Expected: empty. (Native Swift/Kotlin can't be compiled here — a fresh EAS build verifies them; note this in the report.)

- [ ] **Step 5: Commit**

```bash
git add modules/expo-video-stitcher/index.ts modules/expo-video-stitcher/ios/ExpoVideoStitcherModule.swift modules/expo-video-stitcher/android/src/main/java/expo/modules/videostitcher/ExpoVideoStitcherModule.kt
git commit -m "Add native trimVideo() to expo-video-stitcher (iOS AVAssetExportSession, Android MediaMuxer)"
```

---

### Task 4: Carry video duration + stop dropping/hard-capping

**Files:**
- Modify: `src/types/navigation.ts` (`PendingMedia`)
- Modify: `src/screens/app/CameraScreen.tsx` (drop the free-tier record hard-stop; pass `durationMs`)
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (stop dropping over-cap library videos; still pass them to Preview; share the `durationMs` helper)
- Create: `src/lib/mediaDuration.ts` (extract the existing `durationMs` helper so both CapsuleDetailScreen and any caller can reuse it)

**Interfaces:**
- Produces: `PendingMedia.durationMs?: number`; `src/lib/mediaDuration.ts` exporting `assetDurationMs(asset): number` (the moved helper).

- [ ] **Step 1: Add `durationMs` to `PendingMedia`** (`src/types/navigation.ts`)

After the `mimeType?` field:
```ts
  /** Video length in ms when known (camera recording length / picker asset.duration).
   * Unset = unknown (share intent) → not length-gated (fail-open). */
  durationMs?: number;
```

- [ ] **Step 2: Extract the duration helper to `src/lib/mediaDuration.ts`**

Move the body of `CapsuleDetailScreen.tsx`'s `durationMs(asset)` (which normalizes `asset.duration` — note the web-shim-returns-seconds gotcha it already handles) into a new `src/lib/mediaDuration.ts` as `export function assetDurationMs(asset: ImagePicker.ImagePickerAsset): number`. Import it back into CapsuleDetailScreen for any remaining use.

- [ ] **Step 3: CameraScreen — drop the free hard-stop, pass durationMs**

CameraScreen currently resolves a tier-aware `maxSeconds` (Task H) and hard-stops recording at it. Revert that to a flat cap for everyone: the record timers use the app max `MAX_RECORD_SECONDS` (120) again — remove the `maxSeconds`/`maxSecondsRef`/`notifyFreeCapHitIfHost`/owner-tier-fetch/`useEntitlements` machinery added for the video record cap in Task H (grep them out; leave any UNRELATED useEntitlements usage untouched — check first). Then, when navigating to `Preview` after a recording, set `durationMs` on the `PendingMedia`/route from the recorded length: use `recordSecondsRef.current * 1000` (for the stitched multi-segment path, `recordSecondsRef` already tracks the summed total). Both single and dual paths.

- [ ] **Step 4: CapsuleDetailScreen — stop dropping over-cap library videos**

`filterOversizedVideos` currently drops over-cap videos before navigating to Preview. Remove that drop: library-picked videos (any length up to the app cap) now pass through to Preview unchanged, where the length gate + trim sheet handle them (Task 5). If `filterOversizedVideos` becomes unused, delete it and its `MAX_LIBRARY_VIDEO_MS` constant + the toast copy; keep populating `durationMs` on the `PendingMedia` handed to Preview from `assetDurationMs(asset)` so Preview can gate. Do NOT remove any non-video handling in that pick flow.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "navigation\.ts|CameraScreen|CapsuleDetailScreen|mediaDuration" | grep -v "@expo/vector-icons"` → Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add src/types/navigation.ts src/lib/mediaDuration.ts src/screens/app/CameraScreen.tsx src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Carry video durationMs; camera records to app max, library stops dropping over-cap clips"
```

---

### Task 5: Preview video-length gate + trim flow

**Files:**
- Modify: `src/screens/app/PreviewScreen.tsx`

**Interfaces:**
- Consumes: `limitSheet` (T1), `trimVideo` (T3), `PendingMedia.durationMs` + `assetDurationMs` (T4), `limitsForTier` (`src/lib/tierLimits`), `presentPaywall` (`src/lib/purchases`), the per-target owner-tier + `currentUserId` already available in `upload()` from the tier-enforcement work.

- [ ] **Step 1: Add the video-length gate inside `upload()`**

`PreviewScreen.upload()` (already async, already fetches per-selected-capsule owner tier + `capsule_media_count` for the photo gate) — add a video-length check before enqueuing:
- Compute `effectiveVideoCap = Math.min(...selectedTargets.map(t => limitsForTier(t.ownerTier).videoSeconds))` (strictest selected target; default to `limitsForTier('free').videoSeconds` if empty). Also compute `ownerOfStrictest` = whether the current user owns a selected target whose `videoSeconds` equals `effectiveVideoCap` (→ Upgrade is meaningful).
- Find over-cap video items: `media.filter(m => m.mediaType === 'video' && m.durationMs != null && m.durationMs / 1000 > effectiveVideoCap)`.
- If none over-cap → proceed with the existing enqueue path unchanged.
- If some are over-cap → do NOT enqueue yet; `limitSheet.show({ ... })` with:
  - `{ label: 'Trim to first ' + effectiveVideoCap + 's & post', style: 'primary', onPress: <trimThenPost> }` — for EVERYONE.
  - if `ownerOfStrictest`: `{ label: 'Upgrade to post full', style: 'secondary', onPress: () => presentPaywall() }`.
  - `{ label: 'Skip these ' + (over-cap count) + ' clip(s)', style: 'secondary', onPress: <postSkippingOverCap> }`.
  - `{ label: 'Cancel', style: 'secondary', onPress: () => {} }` (dismiss → stays on Preview; nothing lost).
- Because the sheet's actions are async-capable via their `onPress`, factor the actual enqueue into a helper `enqueueItems(items)` you can call from both `<trimThenPost>` and `<postSkippingOverCap>` and the no-over-cap path.

- [ ] **Step 2: Implement `trimThenPost`**

```ts
// Trim each over-cap video to effectiveVideoCap, swap the trimmed uri +
// corrected durationMs into the item list, then enqueue everything.
async function trimThenPost() {
  // show a lightweight "Trimming…" state (reuse an existing busy flag/spinner)
  try {
    const trimmed = await Promise.all(media.map(async m => {
      if (m.mediaType === 'video' && m.durationMs != null && m.durationMs / 1000 > effectiveVideoCap) {
        const outUri = await trimVideo(m.uri, effectiveVideoCap);
        return { ...m, uri: outUri, durationMs: effectiveVideoCap * 1000 };
      }
      return m;
    }));
    enqueueItems(trimmed);
  } catch (e) {
    toast.show('Couldn’t trim the video. Try again.');
  }
}
```
(Use the screen's existing navigation-after-enqueue behavior inside `enqueueItems`.)

- [ ] **Step 3: Implement `postSkippingOverCap`**

Enqueue only the items that are not over-cap: `enqueueItems(media.filter(m => !(m.mediaType === 'video' && m.durationMs != null && m.durationMs / 1000 > effectiveVideoCap)))`. If that leaves zero items, just dismiss (stay on Preview) — don't navigate.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "PreviewScreen" | grep -v "@expo/vector-icons"` → Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add src/screens/app/PreviewScreen.tsx
git commit -m "Enforce video length at Preview with Trim-to-30s / Upgrade / Skip sheet"
```

---

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

- In the **Utilities** section (near `toast`), add `src/lib/limitSheet.ts` + `<LimitSheetHost>` — the global imperative limit sheet, mirrors toast, driven by `proGateHit` and the Preview video gate.
- In the **Monetization → Tier enforcement** subsection: note that hitting any gate now shows the smooth `LimitSheet` (owner: Upgrade→paywall; guest: explain-only) rather than an abrupt paywall/toast; and that **video length is enforced at PreviewScreen's Add-to-Capsule** (camera no longer hard-caps recording; library no longer drops over-cap clips) with a **Trim-to-first-30s** option (available to everyone — it complies with the host cap) backed by `trimVideo()`.
- In the **modules/expo-video-stitcher** description (Project Structure comment + any dedicated note): add `trimVideo(uri, maxSeconds)` — first-N-seconds trim (iOS `AVAssetExportSession` timeRange; Android `MediaExtractor`+`MediaMuxer` to the cutoff); needs a fresh EAS build like the rest of the module.
- Note `PendingMedia.durationMs` and `src/lib/mediaDuration.ts` (`assetDurationMs`).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the limit sheet, trimVideo, and Preview-side video gate"
```

---

## Dependency order

- **T1** (sheet infra) → blocks **T2** and **T5**.
- **T3** (native trim) → blocks **T5**. Independent of T1/T2/T4.
- **T4** (durationMs + camera/library) → blocks **T5**.
- **T5** integrates T1+T3+T4. **T6** last.
- Sequential execution (T1→T2→T3→T4→T5→T6): several tasks touch CapsuleDetailScreen/PreviewScreen/CameraScreen, so no parallel implementers.

## Self-review notes

- Every spec element maps to a task: smooth sheet (T1), gate rewire+copy (T2), native trim (T3), duration plumbing + camera-hardstop-removal + library-drop-removal (T4), Preview enforcement + trim/upgrade/skip/cancel (T5), docs (T6). ✅
- Trim offered to everyone, Upgrade owner-only: T5 Step 1 (`ownerOfStrictest` gates the Upgrade action only). ✅
- Never-lose-the-clip: camera/library no longer discard (T4); Cancel stays on Preview (T5). ✅
- No jest invented; limitSheet pure logic tested via tsx; native flagged as build-verified. ✅
- App.tsx staging hazard (unrelated dirty hunks) called out with `git add -p`. ✅
