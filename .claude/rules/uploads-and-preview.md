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

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Preview Screen (`PreviewScreen.tsx`)

- Shows photo(s)/looping video(s) before adding to a capsule.
- **Layout: media above, panel below — nothing overlays the photo.** Column: `flex: 1` media area (carousel + top bar + dots), then bottom panel (caption, capsule chips, Add button) in normal flow. `contentFit="contain"` (not `"cover"`) letterboxes the whole shot rather than cropping behind the panel. Swipe-down-to-discard `PanResponder`/`translateY` is scoped to the media area only. Panel wrapped in `KeyboardAvoidingView` (`'padding'` iOS / `'height'` Android) so the caption input pushes the panel above the keyboard.
- Fetches user's active capsules (non-unlocked, role owner/contributor, `joined_at` not null).
- **Two route shapes** (`useMemo`-discriminated): `{ uri, mediaType, facing? }` (single-item, from `CameraScreen`) vs `{ media: PendingMedia[], source?: 'share' | 'camera'; targetCapsuleId?: string }` (multi-item, from `useShareIntent`/`CapsuleDetailScreen`'s "+ Add Media" — library/camera picks route through here too for per-item captions + the shared resize pipeline).
- **Carousel:** horizontal `FlatList`, `pagingEnabled`, page dots, "N / total" pill; `currentIndex` via `onMomentumScrollEnd`.
- **Single shared `useVideoPlayer`** keyed by `currentItem.uri` — mounts a `VideoView` only for `currentIndex`; others show a play-icon placeholder (avoids one-player-per-item hooks issue).
- Outer swipe-down `PanResponder` requires `g.dy > Math.abs(g.dx)` so the `FlatList` keeps its paging gesture.
- **Multi-select capsules** via chip scroll with `Set<string>`; `targetCapsuleId` preselects (not locks). "Add to Capsule" is **optimistic**: enqueues every (capsule × media) pair on the upload queue and navigates immediately (`CapsuleDetail` or `Home`) — no blocking upload UI.
- **Empty state:** "No active capsules yet" + "Create Capsule" → Create tab with `pendingMedia: PendingMedia[]` (auto-uploads post-creation).
- Swipe down > 100px → discard confirmation modal.
- Upload: web `arrayBuffer`, native `FileSystem.uploadAsync`.
- Cache invalidation: `cache.invalidate('capsules')` + per-capsule keys.

## Share Intent (`expo-share-intent`)

Routes photos/videos shared from other apps into `PreviewScreen`'s capsule-selection flow.

- **Library:** `expo-share-intent` 5.1.1 (last major on Expo SDK 54; v6 needs SDK 55) — adds an iOS Share Extension target + Android `SEND`/`SEND_MULTIPLE` filters via a config plugin in `app.json`.
- iOS: `NSExtensionActivationSupportsImageWithMaxCount: 10`, `NSExtensionActivationSupportsMovieWithMaxCount: 10`. Android: `androidIntentFilters: ['image/*', 'video/*']` + `androidMultiIntentFilters: ['image/*', 'video/*']`.
- **Extension name:** `iosShareExtensionName` sets both the share-sheet name and the (alphanumeric-stripped) Xcode target name — must never sanitize to the app's own name. Use `"Capsule Share"` → target `CapsuleShare`, not `"Capsule"` (collides with the main `Capsule` target and breaks EAS/fastlane signing).
  <!-- History: a "Capsule" extension name previously made EAS/fastlane sign the main app with the share-extension's provisioning profile (3 "profile doesn't match/support" errors, build failure). -->
- **Provider:** `<ShareIntentProvider>` (`src/lib/ShareIntentProvider.{native,web,tsx}`) wraps `App.tsx` outside `ThemeProvider`; native imports the real `expo-share-intent` provider, web passes `children` through.
- **Hook `useShareIntent(session)`** (`src/hooks/useShareIntent.native.ts`) via `useShareIntentContext()`: filters `shareIntent.files` to image/video by `mimeType` → `PendingMedia[]`; signed in → navigate `Preview` with `{ media, source: 'share' }`; signed out → stash to `shareIntentStash`, drain + navigate after login; always calls `resetShareIntent()`.
- **`shareIntentStash`** (`src/lib/shareIntentStash.ts`) — module-level `PendingMedia[] | null`, survives the Auth→App navigator swap (plain JS variable).
- **Web:** no-op (native-only), split via `.native.ts`/`.web.ts` like `usePushNotifications`.
- **Build:** no Expo Go (needs dev client/EAS build, separate native target); fresh `eas build` needed after config changes; bundle ID `com.markdickson.capsule.share-extension`, app group `group.com.markdickson.capsule.share-extension` — register the extension target in `eas credentials`.
- **Snapchat caveat:** its Share sheet hands over a URL/text, not the image — save to Photos first, then share from Photos → Capsule.

## Background Upload Queue (`src/lib/uploadQueue.ts`)

Module-level sequential upload worker, the optimistic-UI backbone for media. `uploadQueue.enqueue(entries)` returns immediately; the queue uploads one task at a time (web: `arrayBuffer` + `supabase.storage.upload`; native: `FileSystem.uploadAsync` via `getFreshAccessToken()`), inserts the `media` row (`alt_storage_key`/`thumbnail_key` best-effort), and invalidates `capsules` + `capsule:`/`media:`/`signedUrls:` per success.

**Multi-capsule fan-out uploads each file once, not once per capsule.** `PreviewScreen`'s multi-select "Add to Capsule" enqueues one task per (capsule × media) pair in a single `enqueue()` call — 3 capsules × 5 photos used to mean 15 full uploads of the same 5 files. `runTask` routes every upload (main, dual `altUri`, video thumbnail) through `copyOrUpload()`, keyed by source local uri in `mainUploadCache`/`altUploadCache`/`thumbUploadCache` `Map`s. The first task for a uri does the real `prepareForUpload` + `uploadFile`, caching `{ key, size, ext }`; later tasks for the same uri do a bucket-side `supabase.storage.from('capsule-media').copy(cachedKey, newKey)` — zero device bytes. Storage INSERT RLS validates the *destination* path's membership (same check as a direct upload), so a copy succeeds iff a direct upload would.

⚠️ **Copy also has to READ the source, which isn't symmetric.** The `capsule-media` SELECT policy is `status = 'unlocked' OR (role in (owner,contributor) AND NOT owner_preview_locked)` — under **surprise mode (ON by default)** nobody, including the uploader, can read a locked capsule's objects. RLS hides the row, so storage returns `400 Object not found` (not a permission error), failing the task — surfaced in production as `Error: Object not found` on `POST /storage/v1/object/copy`. Multi-selecting into a locked surprise-mode capsule plus another is the **default shape**, not an edge case. `copyOrUpload()` now falls back to a real upload on any copy failure (dropping the cache entry first) and reports via `reportError`. Caches clear on full drain (`work()`); main + alt upload **concurrently** (`Promise.all`).

Each task is bounded by `TASK_TIMEOUT_MS` (3 min, via `withTimeout()` in `work()`) — RN never times out a dead connection, and `work()`'s single sequential loop means a hung task would wedge all future uploads. The call isn't cancelled on timeout (no `AbortController`), so it can resolve after `work()` moved on and cleared caches — guarded by a `cacheGeneration` counter: `copyOrUpload()` snapshots it before uploading and only writes the cache if unchanged, so a late write can't repopulate a cleared Map with a stale entry.

**Video thumbnail at upload time:** for `mediaType === 'video'` (native only — no web `expo-video-thumbnails` implementation), `runTask` grabs a frame from the local file via `VideoThumbnails.getThumbnailAsync(task.uri, { time: 0 })`, uploads it to `${capsuleId}/${uuid}_thumb.jpg`, sets `media.thumbnail_key`. Best-effort — failure leaves it null, `fetchPhotos` falls back to client-side generation from `signedUrl`. Avoids every member's device downloading/decoding the full video for a grid cell; also gives web capsules with videos a real thumbnail.

**Resize before upload:** `prepareForUpload` runs every photo (main + `altUri`) through `resizeForUpload()` (`src/lib/imageResize.ts`) before `uploadFile` — the convergence point for library, share-intent, and camera uploads (`CameraScreen.processPhoto` uses the same helper). Checks width via `Image.getSize` (header read, no decode); resizes to 1920px/compress 0.82 only if wider, never upscales, no-op for camera-sized images — without it, library photos upload at full device resolution (5–10x the bytes for no display gain). When resize runs, output is always JPEG (`ImageManipulator` default), so `prepareForUpload` also bumps `mimeType`/extension to `image/jpeg`. Video untouched.

Failures stay as `status: 'failed'` tasks — `retry(id)`/`dismiss(id)`, rendered as retryable tiles by `CapsuleDetailScreen`. `useUploadTasks(capsuleId)` (`src/hooks/useUploadTasks.ts`) is the reactive subscription; `getProgress(capsuleId)` returns per-capsule `{done,total}` since last empty. Full drain fires one toast ("N items added" / "· M failed") via `ToastHost`. In-memory only — doesn't survive an app kill.

**Optimistic-action pattern** (`NotificationsScreen` accept/decline, `ManageMembersScreen` remove, `HomeScreen` restore, `CapsuleDetail` archive): snapshot state → apply the change/navigate immediately → fire write `.then(({ error }) => …)` → on error restore snapshot + `toast.show(...)`. For invite accepts, `read_at` persists only **after** the membership write commits (avoids orphaning the invite on failure).
