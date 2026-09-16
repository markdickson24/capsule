---
paths:
  - "src/screens/app/PreviewScreen.tsx"
  - "src/lib/uploadQueue.ts"
  - "src/lib/imageResize.ts"
  - "src/lib/mediaDuration.ts"
  - "src/hooks/useUploadTasks.ts"
  - "src/hooks/useShareIntent*"
  - "src/lib/shareIntentStash.ts"
  - "src/lib/ShareIntentProvider*"
  - "app.json"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Preview Screen (`PreviewScreen.tsx`)

- Shows photo(s) or looping video(s) before adding to a capsule
- **Layout: media above, panel below — nothing overlays the photo.** The screen is a column: a `flex: 1` media area (carousel + top bar + dots), then the bottom panel (caption, capsule chips, Add button) in normal flow underneath, not an absolutely-positioned overlay. Images/video use `contentFit="contain"` (not `"cover"`) so the whole shot is visible, letterboxed on the black background, instead of a cropped `cover` fill hidden partly behind the panel. The swipe-down-to-discard `PanResponder`/`translateY` transform is scoped to the media area only — the panel doesn't slide with it. The panel is wrapped in `KeyboardAvoidingView` (`'padding'` iOS / `'height'` Android, matching the rest of the codebase) so focusing the caption input pushes the panel up above the keyboard instead of the keyboard covering it; the media area shrinks to make room, which is fine since it's just `flex: 1` in a column.
- Fetches user's active capsules (non-unlocked, where role is owner or contributor and `joined_at` is not null)
- **Two route shapes** (discriminated at runtime in a `useMemo`):
  - `{ uri, mediaType, facing? }` — single-item form, used by `CameraScreen`
  - `{ media: PendingMedia[], source?: 'share' | 'camera'; targetCapsuleId?: string }` — multi-item form, used by `useShareIntent` and `CapsuleDetailScreen`'s "+ Add Media" (library/camera picks route through here too — see below — so they get per-item captions and the same resize pipeline as camera/share uploads, instead of enqueuing directly with neither)
- **Carousel for multi-item:** horizontal `FlatList` with `pagingEnabled`, page dots overlay, "N / total" counter pill in the top bar. `currentIndex` tracked via `onMomentumScrollEnd`
- **Single shared `useVideoPlayer`** keyed by `currentItem.uri` — only mounts a `VideoView` for the item at `currentIndex`; other video slides show a play-icon placeholder. This avoids the rules-of-hooks problem of one player per item
- The outer swipe-down PanResponder requires `g.dy > Math.abs(g.dx)` to start, so the horizontal `FlatList` keeps its gesture for paging
- **Multi-select capsules** via horizontal chip scroll with `Set<string>`. `targetCapsuleId` (when present) preselects — not locks — that capsule in the chip list, so arriving from a specific capsule's "+ Add Media" doesn't require re-picking it; the user can still add to other capsules too. "Add to Capsule" is **optimistic**: it enqueues every (capsule × media) pair on the background upload queue (see "Background Upload Queue" below) and navigates immediately — `CapsuleDetail` (single capsule) or `Home` (multiple). There is no blocking upload UI on this screen anymore.
- **Empty state:** when no active capsules exist, shows "No active capsules yet" with a "Create Capsule" button. This navigates to Create tab with `pendingMedia: PendingMedia[]` — the media auto-uploads after capsule creation
- Swipe down > 100px triggers discard confirmation modal
- Upload: web uses `arrayBuffer`, native uses `FileSystem.uploadAsync`
- Cache invalidation after upload: `cache.invalidate('capsules')` + per-capsule keys

## Share Intent (`expo-share-intent`)

Receives photos/videos shared from other apps (Photos, Files, Messages, Instagram, etc.) and routes them into the `PreviewScreen` capsule-selection flow.

- **Library:** `expo-share-intent` 5.1.1 (the last major that supports Expo SDK 54 — v6 requires SDK 55). Adds an iOS Share Extension target and Android `SEND` / `SEND_MULTIPLE` intent filters via a config plugin in `app.json`
- **Config plugin** accepts images + videos, single + multi:
  - iOS activation rules: `NSExtensionActivationSupportsImageWithMaxCount: 10`, `NSExtensionActivationSupportsMovieWithMaxCount: 10`
  - Android: `androidIntentFilters: ['image/*', 'video/*']` + `androidMultiIntentFilters: ['image/*', 'video/*']`
  - Extension display name: "Capsule Share" — via `iosShareExtensionName`. ⚠️ **This option sets BOTH the share-sheet display name (raw value) and the Xcode target name (value stripped to alphanumerics)**, so it must never sanitize to the same string as the app name: `"Capsule"` collided with the main `Capsule` target and made EAS/fastlane sign the main app with the share-extension's provisioning profile (three "profile doesn't match/support" errors, build failure). `"Capsule Share"` → target `CapsuleShare`, no collision.
- **Provider:** `<ShareIntentProvider>` in `src/lib/ShareIntentProvider.{native,web,tsx}` — wraps `App.tsx` outside `ThemeProvider`. Native imports the real provider from `expo-share-intent`; web returns `children` as-is
- **Hook:** `useShareIntent(session)` in `src/hooks/useShareIntent.native.ts` consumes `useShareIntentContext()` and:
  1. Filters `shareIntent.files` to image/* and video/* by `mimeType`, maps to `PendingMedia[]`
  2. If signed in: navigates to `Preview` with `{ media, source: 'share' }`
  3. If signed out: writes the array to `shareIntentStash`, lets the user log in, then on the next render with `session` set it drains the stash and navigates
  4. Always calls `resetShareIntent()` so the same payload isn't re-handled on next render
- **`shareIntentStash`** (`src/lib/shareIntentStash.ts`) — module-level `PendingMedia[] | null`. Survives the Auth → App navigator swap because it's just a JS variable, not navigation state
- **Web:** the hook + provider are no-ops; `expo-share-intent` is native-only. Platform split via `.native.ts` / `.web.ts` files, same pattern as `usePushNotifications`
- **Build requirements:**
  - **Cannot run in Expo Go** — requires a custom dev client / EAS build (iOS share extension is a separate native target)
  - Bumps native config; a fresh `eas build` is required before the share sheet entry appears
  - The auto-generated iOS share extension target uses bundle ID `com.markdickson.capsule.share-extension` and app group `group.com.markdickson.capsule.share-extension`. **When prompted by `eas credentials`, register the extension target alongside the main app** — see the "iOS Extension Target" note in the `expo-share-intent` README
- **Snapchat caveat:** Snapchat's "Share" sheet typically hands over a URL or text, not the underlying image. To get a Snap into Capsule, the user usually saves the Snap to Photos first, then shares from Photos → Capsule. Most other apps (Photos, Messages, Instagram saves, Files) share the actual image file

## Background Upload Queue (`src/lib/uploadQueue.ts`)

Module-level sequential upload worker — the optimistic-UI backbone for media.
Callers `uploadQueue.enqueue(entries)` and move on; the queue uploads one task
at a time (web: arrayBuffer + `supabase.storage.upload`; native:
`FileSystem.uploadAsync` via `getFreshAccessToken()`), inserts the `media` row
(including dual-photo `alt_storage_key` and, for video, `thumbnail_key` — see
below — both best-effort), and invalidates
`capsules` + `capsule:`/`media:`/`signedUrls:` per success.

**Multi-capsule fan-out uploads each file once, not once per capsule.**
`PreviewScreen`'s multi-select "Add to Capsule" enqueues one task per
(capsule × media) pair in a single `enqueue()` call — selecting 3 capsules for
5 photos used to mean 15 full device-to-storage uploads of the same 5 files.
`runTask` now routes every upload (main, dual `altUri`, and video thumbnail)
through `copyOrUpload()`, keyed by the **source local uri** in one of three
module-level `Map`s (`mainUploadCache`/`altUploadCache`/`thumbUploadCache`).
The first task for a given uri does the real `prepareForUpload` + `uploadFile`
and caches the resulting `{ key, size, ext }`; every later task for the same
uri (i.e. the same file going to another capsule) does a bucket-side
`supabase.storage.from('capsule-media').copy(cachedKey, newKey)` instead —
zero device bytes. The storage INSERT RLS policy validates the *destination*
path's own capsule membership (identical check to a direct upload), so a copy
is permitted for exactly the capsules the caller could upload to directly;
verified against the live policy definitions rather than a device run — copy
succeeds iff a normal upload to that destination would.

⚠️ **That reasoning covered only the destination. A copy also has to READ the
source, and that side is not symmetric.** The `capsule-media` SELECT policy is
`status = 'unlocked' OR (role in (owner,contributor) AND NOT
owner_preview_locked)` — so under **surprise mode, which is ON by default**,
nobody can read a locked capsule's objects, *including the person who just
uploaded them*. RLS makes the row invisible, so storage answers `400 Object not
found` rather than a permission error, and the whole upload task failed.
Multi-selecting into two capsules where the first is a locked surprise-mode
capsule is the **default shape**, not an edge case; it reached production and
surfaced in Sentry as `Error: Object not found` on
`POST /storage/v1/object/copy`. `copyOrUpload()` now **falls back to a real
upload** on any copy failure, dropping the cache entry first (an unreadable
source stays unreadable for the batch, so retrying a doomed copy per task just
costs a round-trip each). The optimisation degrades into the thing it optimises
instead of breaking the upload, and reports through `reportError` so the cost
stays visible. The three caches are
cleared when the queue fully drains (`work()`), so an unrelated later batch
never copies from a stale key. Main + alt also now upload **concurrently**
(`Promise.all`) instead of sequentially — free wall-time win on swappable
dual photos regardless of cache hit/miss.

Each task is bounded by `TASK_TIMEOUT_MS` (3 minutes, via a `withTimeout()`
race in `work()`) — RN's network primitives never time out a dead connection
on their own, and `work()` is a single sequential loop, so one hung task
would otherwise wedge every future upload app-wide with no retry UI to
recover from. The underlying network call isn't cancelled on timeout (no
`AbortController` wired through), so it can still resolve after `work()` has
already moved on and, at the batch's end, cleared the dedup caches above. A
module-level `cacheGeneration` counter (bumped on every cache clear) guards
this: `copyOrUpload()` snapshots the generation before its upload and only
writes the result into the cache if the generation is unchanged, so a write
that straddles a drain is dropped rather than repopulating a cleared Map with
a stale entry an unrelated later batch could collide with and copy from.

**Video thumbnail at upload time:** for `mediaType === 'video'` (native only —
`expo-video-thumbnails` has no web implementation), `runTask` grabs a frame
from the **local** file via `VideoThumbnails.getThumbnailAsync(task.uri, { time: 0 })`
right after the main upload, uploads that JPEG to `${capsuleId}/${uuid}_thumb.jpg`,
and sets it as `media.thumbnail_key`. Best-effort — on failure `thumbnail_key`
stays null and `fetchPhotos` falls back to its old client-side
generation-from-`signedUrl` path for that row (see CapsuleDetailScreen section
below). This is the fix for the pre-existing "every member's device downloads
and decodes the whole remote video just to draw a grid cell" pathology, and
incidentally gives web capsules with videos a real thumbnail for the first time.

**Resize before upload:** `runTask`'s `prepareForUpload` step runs every photo
(main + `altUri`) through `resizeForUpload()` (`src/lib/imageResize.ts`) before
`uploadFile`. This is the one place all photo uploads converge — library
picker, share-intent, and camera — so it's also where `CameraScreen.processPhoto`
delegates to the same helper. `resizeForUpload` checks width via `Image.getSize`
(a header read, not a decode) and only resizes down to 1920px/compress 0.82 if
the source is wider; it never upscales and is a no-op for already-camera-sized
images. Without this, library-picked photos uploaded at full device
resolution — 5–10x the bytes of the in-app camera path for no visual gain at
display size. When the resize actually runs, the output is always JPEG
(`ImageManipulator`'s default save format), so `prepareForUpload` also bumps
the task's `mimeType`/extension to `image/jpeg` in that case — otherwise the
original mimeType from the picker/share-intent asset is kept as-is. Video is
untouched.

Failures stay in the queue as `status: 'failed'` tasks — `retry(id)` / `dismiss(id)` — rendered
as retryable tiles by `CapsuleDetailScreen`. `useUploadTasks(capsuleId)`
(`src/hooks/useUploadTasks.ts`) is the reactive subscription;
`getProgress(capsuleId)` returns per-capsule `{done,total}` since that
capsule's queue was last empty. When the whole queue drains it fires one toast
("N items added" / "· M failed") through the global ToastHost, so completion
reaches the user wherever they navigated. In-memory only: uploads do not
survive an app kill (the failed/pending tiles vanish with the process).

**Optimistic-action pattern** (used by NotificationsScreen accept/decline,
ManageMembersScreen remove, HomeScreen restore, CapsuleDetail archive): snapshot
the current state → apply the state change / navigate immediately → fire the
write with `.then(({ error }) => …)` → on error restore the snapshot and
`toast.show(...)`. For invite accepts, `read_at` is persisted only **after**
the membership write commits — persisting it up front on a failed accept would
orphan the invite.
