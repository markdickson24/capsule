---
paths:
  - "src/screens/app/CapsuleDetailScreen.tsx"
  - "src/lib/zoomMath.ts"
  - "src/lib/galleryLayout.ts"
  - "src/lib/mergeCapsuleUpdate.ts"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## CapsuleDetailScreen Key Patterns

Large file (~2200 lines). Key sub-components and patterns:

**`ProgressRing`** — pure RN circular progress indicator. Two-half-clip technique: each half uses a full ring with two adjacent border colors (orange + track) clipped to its side, rotated to reveal the correct amount.
- Right half: `borderTopColor + borderRightColor = orange`, rest = trackColor
- Left half: `borderBottomColor + borderLeftColor = orange`, rest = trackColor
- Rotation formula: `rightRot = -135 + min(deg, 180)`, `leftRot = -135 + max(deg - 180, 0)`
- **Do not use `borderColor: 'transparent'`** — causes a dark rendering artifact on iOS at the color transition point. Always set all 4 border colors explicitly.

**`CountdownRing`** — wraps `ProgressRing` with lock icon, countdown text, and a date line. Self-rescheduling tick (per-second under a day out, per-minute beyond). **Two phases when the capsule has a `contribution_start_at`:** while pre-start it counts down to the **start** date ("Not started yet" / "Starts `<date>`", progress over `created→start`), then at the start moment it flips **live** to the usual unlock countdown ("Capsule locked" / "Unlocks `<date>`", progress over `start→unlock` so the ring resets to full at the flip). Same visual, only the labels/target change; the tick keeps running across the start moment and stops only at unlock. With no start date it's the plain unlock countdown (progress over `unlock_at − created_at`, 1-year fallback if `created_at` unavailable). Takes `unlockAt`, `startAt` (= `capsule.contribution_start_at`), `createdAt`.

**`InviteModal`** — user search with 300ms debounce (min 2 chars), sends push notification to invited user client-side.

**Post-create invite nudge** — when `route.params.justCreated` is true (set by `CreateScreen` on navigation right after a capsule is made) and `members.length === 1`, a dismissible callout ("Invite people — capsules are better together") renders above the Media section, with an Invite button opening the same `InviteModal`. A single-member capsule is a failed core loop (no reveal, no award voting to anticipate), so this is the one moment worth nudging; it's gone once another member joins or the user dismisses it, and never reappears on a later visit (the param isn't persisted).

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis is locked on first movement (prevents diagonal). Vertical swipe > 120px or velocity > 1.5 closes modal. Header controls (close, page counter, download) sit inside a `LinearGradient` overlay (top 120px, `rgba(0,0,0,0.6)` → transparent) so buttons don't get lost against light images. Download button uses `expo-media-library` on native (saves to camera roll) and anchor-element download on web.
  **Pinch-to-zoom (photos only).** The single `PanResponder` carries a third
  axis, `zoom`, driven by reading `evt.nativeEvent.touches` — there is no
  gesture library in this project (`react-native-gesture-handler` and
  `react-native-reanimated` are absent from `package.json` *and* `node_modules`),
  so two-finger handling is hand-rolled, the same way `CameraScreen` does its
  pinch. Two touches scale between 1x and 4x; one touch while `scale > 1` pans,
  clamped to `±(scale − 1) × dimension / 2` so the image can't be dragged past
  its own edge — `dimension` here is the photo's actual **contain-fit rendered
  size** (`renderedSizeFor()`, derived from the intrinsic pixel size expo-image
  reports on `onLoad`, cached per media id in `intrinsicSizeRef`), not
  `SCREEN_WIDTH`/`SCREEN_HEIGHT`. The image renders with `contentFit="contain"`
  and is letterboxed on one axis whenever its aspect ratio doesn't match the
  screen's; clamping against the raw screen dimensions there let a fully-panned
  photo be dragged completely off screen. Falls back to the screen dimensions
  only until that photo's first `onLoad` fires. Paging and swipe-to-close are
  both suppressed while zoomed, and `goToIndex` resets zoom, so scale is always
  1 whenever more than one slide is visible. A released pinch below
  `SNAP_BACK_BELOW` (1.15, deliberately well above "looks unzoomed" — an
  invisible ~1.08x residual scale from a fumbled pinch would otherwise leave
  paging/dismiss silently dead with no visual cue) snaps back to exactly 1. The
  pure math is `src/lib/zoomMath.ts` (unit-tested); the gesture wiring is in the
  viewer.
  ⚠️ **The `PanResponder`'s handlers (and `goToIndex`, which they call) read
  `itemsRef.current`, never the closed-over `items` parameter.** The responder
  is created once via `useRef`, so its handlers otherwise close over whichever
  `items` array existed at mount — and `items` is the parent's `photos` list,
  wholesale-replaced by `fetchPhotos()` from several triggers that can fire
  while the viewer is open (background upload landing, etc. — same root cause
  as the `currentItemId` resync above). A stale `items` read let the
  photo-only gesture gate report "photo" for a slide that had actually become
  a video after `items` shrank, letting a pinch silently accumulate zoom state
  with nothing on screen to show for it and then block paging. `itemsRef` is
  assigned `itemsRef.current = items` on every render; only the gesture-branch
  and `goToIndex` reads need it — JSX/render-time reads of `items` are already
  correct since they aren't wrapped in a `useRef`-memoized callback.
  ⚠️ **`onPanResponderTerminate` must perform the same cleanup as the release
  handler's zoom branch.** `onPanResponderTerminationRequest` defaults to
  `true`, so a third finger landing on a header button (close/flag/download)
  mid-pinch terminates the responder instead of releasing it —
  `onPanResponderRelease` then never runs, and without this handler `scaleRef`
  is left stranded above 1 with paging blocked from then on, no different from
  the snap-back-drift bug above. `snapBackIfNeeded()` and `endGesture()` are
  extracted helpers shared by both the release and terminate paths so this
  cleanup can't drift out of sync between them.
  ⚠️ **Videos are excluded, and the gate is in the gesture branch — not the
  render.** `VideoSlide` uses expo-video's default `nativeControls`, whose
  overlay consumes touches, so a pinch likely never reaches the handler anyway;
  and scaling the container would distort the controls. If the gate were only on
  the drawing, a pinch on a video would still accumulate scale state that
  nothing displays and then leak into the next photo.
  ⚠️ **A second finger joining a gesture already locked to `h` or `v` does NOT
  start a pinch.** The two-touch branch only fires when `axis.current` is
  `'none'` or already `'zoom'` — a normal horizontal/vertical drag already in
  progress keeps going as that drag. Without this guard, a pinch begun mid-swipe
  would zoom a cell that's only partially visible (breaking the "zoom is always
  1 whenever more than one cell can be seen" invariant the unconditional
  transform above relies on) and strand `translateX` at a non-multiple-of-
  `SCREEN_WIDTH` offset, since the zoom release path never re-syncs it —
  `goToIndex` is the only thing that does. Letting the swipe/dismiss finish
  through its existing release path keeps `translateX` correct. This looks like
  an arbitrary condition in isolation; it isn't.
  ⚠️ **`zoomScale`/`panX`/`panY` must animate with `useNativeDriver: true`
  everywhere.** Once the first animation on one of these latches it to the
  native driver, an `Animated.timing`/`.spring()` call anywhere else in the same
  viewer session that omits `useNativeDriver: true` silently stops moving it —
  mixing drivers on an already-latched value breaks within that single session,
  it doesn't need to survive across multiple opens to fail. (Contrast the
  members sheet below, a *related but distinct* case: `MediaViewerModal` is
  conditionally mounted and remounts fresh per open, so these three are
  recreated by `useRef` every time and can't carry a bad driver forward from a
  previous session the way `membersSheetTranslateY` — a value that persists
  across opens — does.)
  ⚠️ **Transform order is `[{translateX}, {translateY}, {scale}]`.** Translate
  before scale means the pan is applied in untransformed space and tracks the
  finger 1:1, which is the assumption `clampPan`'s bound encodes. Reordering it
  silently makes panning drift at high zoom.

**Members bottom sheet** — tap the avatar cluster to open; swipe-down-to-close on top of the usual backdrop-tap/X button. Three real bugs went into getting this gesture right, worth knowing before touching it again:
- `membersSheetTranslateY` is a persistent (component-lifetime) `useRef` `Animated.Value`, unlike `MediaViewerModal`'s (which remounts fresh every open) — so **every** animation on it (open, close, release-cancel spring) must use `useNativeDriver: false`. React Native's native driver permanently latches a value the first time `useNativeDriver: true` runs on it; mixing drivers on a value that's only ever created once works on the first open/close cycle and silently stops responding to drags on the second.
- The `PanResponder` is attached to the *whole* sheet (the outer `Animated.View` carrying the transform), not just the handle/header strip — a drag starting anywhere on the sheet, including over the member rows, should dismiss it. Since the member list is a vertical `ScrollView` sharing the same axis as the dismiss gesture, `onMoveShouldSetPanResponderCapture` (not the bubble-phase variant) is gated on `membersScrollY.current <= 0 && dy > dx` — only claims a downward drag once the list is already scrolled to the top, mirroring native iOS overscroll-to-dismiss. Capture (not bubble) is required to win against the ScrollView's own native pan recognizer before it starts scrolling. `onStartShouldSetPanResponder` stays `false` (no capture variant either) so plain taps still reach the nested X button and member rows.
- `sheetCard` needs real `paddingTop` (not just the handle's own `marginTop`) — the backdrop `TouchableOpacity` is a *sibling* of the sheet in the render tree, not an ancestor, so a touch that lands even a few px above the sheet's actual top edge is grabbed by the backdrop's `Pressability` at touch-down and never reaches the sheet's `PanResponder` at all (a subsequent drag just cancels the backdrop's pending tap — net effect: nothing happens). With a 4px handle pill and no top padding, "aim for the top of the sheet" reliably misses. Generous top padding fixes it without touching the gesture logic at all.

**Real-time + unlock reconciliation:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules`. Every applied capsule row (realtime, `load()`, cached mount) routes through **`applyCapsule(fresh)`**, which detects a live **active→unlocked** transition (tracked via `prevStatusRef`) and runs the reveal: triggers the animation, invalidates `signedUrls:${capsuleId}` **and** `media:${capsuleId}` (a surprise-mode owner's pre-unlock cache may hold an RLS-empty media list), then `fetchPhotos(true)`. Centralizing this is what fixes the **"only unlocks after refreshing"** bug: realtime `postgres_changes` events are **not delivered while the app is backgrounded** and a dropped socket won't replay them, so the reveal can't depend on realtime alone. Two server-reconciling fallbacks cover the miss — **(1) an `AppState` `'active'` listener refetches on foreground** (catches a capsule flipped while away), and **(2) a self-rescheduling poll** that, while locked in time/`both` mode, wakes ~at `unlock_at` and re-checks every 15s past it (the cron flips `status` up to ~60s after `unlock_at`) until the server confirms the flip, then stops. `HomeScreen` has the same `AppState` foreground `refresh(true)` so the list badge flips too. The `prevStatusRef !== null && !== 'unlocked'` guard means opening an already-unlocked capsule shows no spurious ceremony.

**Upload flow:** all media uploads (Add Media picker, camera, and everything arriving from PreviewScreen) go through the **background upload queue** (`src/lib/uploadQueue.ts`). The "+ Add Media" picker offers **"Open Camera"** (→ `openInAppCamera()`, which navigates to the in-app Camera tab with `{ targetCapsuleId }` — NOT the system camera; `CameraScreen` reads the param, threads it into its Preview navigation so the capsule arrives preselected, and clears it on blur so a later direct tab visit isn't sticky) and **"Camera Roll"** (`pickFromLibrary`). The library picker doesn't enqueue directly — `goToPreview()` hands the picked assets to `Preview` (`{ media, source: 'camera', targetCapsuleId: capsuleId }`) so they get per-item captions and the shared resize pipeline before Preview itself enqueues them; `useUploadTasks(capsuleId)` renders the queue as local-URI **pending tiles** above the photo grid (spinner overlay while uploading; failed tiles get Retry + dismiss). A surprise-mode locked box shows an "N uploading…" line instead of tiles. An effect watches the task count and calls `fetchPhotos()` as each task lands (the queue has already invalidated `media:`/`signedUrls:`/`capsule:` for the capsule). The aggregate "Uploading n/N" row + `ProgressBar` is driven by `uploadQueue.getProgress(capsuleId)`.

**The library picker requests images AND videos** (`mediaTypes: ['images', 'videos']` — SDK 54's array form; the older `MediaTypeOptions` enum is deprecated). `goToPreview()` maps each `ImagePickerAsset` to its real `PendingMedia.mediaType` (`asset.type === 'video' ? 'video' : 'photo'`) instead of hardcoding `'photo'`, and stamps `PendingMedia.durationMs` from `assetDurationMs(asset)` (`src/lib/mediaDuration.ts`). **Over-cap library videos are no longer dropped here** — the old `filterOversizedVideos()`/`MAX_LIBRARY_VIDEO_MS` early-drop was removed; all picked videos pass through to Preview at full length, where the tier-based video-length gate handles them (Trim / Upgrade / Skip — see "Monetization → Tier enforcement → Video length"). `assetDurationMs` still handles the duration-units gotcha: `asset.duration` is milliseconds on iOS/Android, but expo-image-picker's web shim sets it straight from `HTMLVideoElement.duration`, which is **seconds** — it normalizes for `Platform.OS === 'web'`. (The old `pickFromCamera` system-camera path was removed when "Open Camera" switched to the in-app camera.) `PendingMedia` carries no `mimeType` field (matches `useShareIntent`'s shape) — `uploadQueue.enqueue` already defaults an unset `mimeType` to `video/mp4`/`image/jpeg` from `mediaType`, so nothing new was needed there.

**Reactions:** `addReaction()` generates the reaction ID client-side via `randomUUID()` — never chain `.select()` after `.insert()` on the `reactions` table (the SELECT RLS policy may fail even though the insert succeeded, causing the optimistic reaction to disappear). If the user already has a reaction on the media, the existing row is updated (emoji swap) instead of inserting a duplicate — respects the `unique(media_id, user_id)` constraint.

**Cache integration:** on mount, checks `cache.get('capsule:${capsuleId}')` — if cached, renders instantly and fetches fresh in background. `load()` calls `cache.set()` after fetching, and runs `fetchPhotos()` in the same parallel wave (it has no dependency on the capsule/members result). Invalidation: `cache.invalidate('capsules', 'profile')` on delete.

**`fetchPhotos(force?)`** caches three things, each independently:
- `media:${capsuleId}` (3min TTL) — the raw `media` row list itself, so a cache hit skips the DB read entirely, not just the signing step. `force=true` (used by pull-to-refresh) always bypasses it, since another member's upload wouldn't trigger this client's own `cache.invalidate`.
- `signedUrls:${capsuleId}` (50min TTL, under the 1hr signed-URL validity) — batches main + alt **+ thumbnail** keys into one `createSignedUrls()` call.
- `videoThumb:${mediaId}` (6hr TTL) — **fallback only**, for videos with no `thumbnail_key` (uploaded before the upload-time thumbnail existed): the locally-generated `expo-video-thumbnails` frame URI (decoded from the remote `signedUrl`), so re-entering the screen doesn't re-decode every video.

**Video thumbnails are generated at upload time, not display time.** `uploadQueue.runTask` (`src/lib/uploadQueue.ts`) runs `VideoThumbnails.getThumbnailAsync` on the **local** file (no network) right after upload, stores the JPEG at `media.thumbnail_key`, and is best-effort — a failure just leaves `thumbnail_key` null. `fetchPhotos` signs `thumbnail_key` alongside the main/alt keys and sets `MediaItem.thumbnailUri` directly from `transformMediaUrl(signedThumbUrl, GRID_THUMB_PX)` for any row that has one; the client-side `VideoThumbnails.getThumbnailAsync(item.signedUrl, …)` loop only runs for items where `thumbnailUri` is still unset (old rows). This means every member's device no longer has to download+decode the full remote video just to draw a grid cell, and web (previously blank for videos, since the client-side generation is native-only) now gets a real thumbnail whenever `thumbnail_key` is present. Included in the same delete-time storage cleanup as `storage_key`/`alt_storage_key` (`confirmDelete`).

**Grid/preview thumbnails use `transformMediaUrl()`** (`src/lib/mediaUrl.ts`), not the full-res `signedUrl` — `MediaItem.thumbSignedUrl` is derived from the already-signed URL with no extra signing round-trip (see "Media URL Transforms" below). The full-screen viewer and `VoteSheet`'s media-voting grid both still fall back to `signedUrl` for anything without a `thumbSignedUrl` (videos use `thumbnailUri` instead).

## Media Grid Layout

For equal-width thumbnail rows, use `flex: 1, aspectRatio: 1` — **not** `width: Dimensions.get('window').width / 3`. Dimensions doesn't account for parent padding. Set `gap` on the row container.

"+N more" overlay: count is `photos.length - 2` (not `- 3`) because the overlaid photo is itself not fully visible.

`MediaGalleryModal`: `FlatList` with `numColumns={3}`, `columnWrapperStyle={{ gap: 2 }}`, `ItemSeparatorComponent` for row gaps.
