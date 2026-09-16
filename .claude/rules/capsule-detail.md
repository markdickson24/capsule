---
paths:
  - "src/screens/app/CapsuleDetailScreen.tsx"
  - "src/lib/zoomMath.ts"
  - "src/lib/galleryLayout.ts"
  - "src/lib/mergeCapsuleUpdate.ts"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## CapsuleDetailScreen Key Patterns

Large file (~2200 lines).

**`ProgressRing`** — pure RN circular progress indicator, two-half-clip technique: each half is a full ring with two adjacent border colors (orange + track), clipped to its side and rotated to reveal the amount.
- Right half: `borderTopColor + borderRightColor = orange`, rest = trackColor
- Left half: `borderBottomColor + borderLeftColor = orange`, rest = trackColor
- Rotation: `rightRot = -135 + min(deg, 180)`, `leftRot = -135 + max(deg - 180, 0)`
- **Never use `borderColor: 'transparent'`** — dark rendering artifact on iOS at the color transition point; set all 4 border colors explicitly.

**`CountdownRing`** — wraps `ProgressRing` with lock icon, countdown text, date line. Self-rescheduling tick (per-second under a day out, per-minute beyond). With `contribution_start_at`: pre-start counts down to **start** ("Not started yet"/"Starts `<date>`", progress over `created→start`); at start flips live to the unlock countdown ("Capsule locked"/"Unlocks `<date>`", progress over `start→unlock`, ring resets to full). Tick keeps running across the start moment, stops only at unlock. No start date = plain unlock countdown (progress over `unlock_at − created_at`, 1-year fallback if `created_at` unavailable). Props: `unlockAt`, `startAt` (= `capsule.contribution_start_at`), `createdAt`.

**`InviteModal`** — user search, 300ms debounce (min 2 chars), sends push client-side.

**Post-create invite nudge** — when `route.params.justCreated` is true (set by `CreateScreen` right after create) and `members.length === 1`, a dismissible callout ("Invite people — capsules are better together") renders above Media, Invite button opens `InviteModal`. Gone once another member joins or dismissed; never reappears (param isn't persisted). <!-- A single-member capsule is a failed core loop (no reveal, no award voting), hence the one nudge. -->

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis locks on first movement (no diagonal). Vertical swipe >120px or velocity >1.5 closes. Header controls (close, page counter, download) sit in a `LinearGradient` overlay (top 120px, `rgba(0,0,0,0.6)`→transparent). Download: `expo-media-library` (native) / anchor download (web).

**Pinch-to-zoom (photos only).** Hand-rolled via the single `PanResponder` reading `evt.nativeEvent.touches` — no gesture library in this project (`react-native-gesture-handler`/`react-native-reanimated` absent from `package.json`/`node_modules`), same approach as `CameraScreen`'s pinch.
- Two touches scale 1x–4x; one touch while `scale > 1` pans, clamped to `±(scale − 1) × dimension / 2` using the photo's **contain-fit rendered size** (`renderedSizeFor()`, from intrinsic size on `onLoad`, cached per media id in `intrinsicSizeRef`) — not `SCREEN_WIDTH`/`SCREEN_HEIGHT`, since `contentFit="contain"` letterboxes on the mismatched axis and clamping to raw screen dims would let a fully-panned photo drag off screen. Falls back to screen dimensions until that photo's first `onLoad`.
- Paging/swipe-to-close suppressed while zoomed; `goToIndex` resets zoom, so scale is always 1 whenever more than one slide is visible.
- A released pinch below `SNAP_BACK_BELOW` (1.15) snaps back to exactly 1. <!-- Set well above "looks unzoomed" so an invisible ~1.08x residual scale from a fumbled pinch can't silently leave paging/dismiss dead with no visual cue. -->
- Pure math in `src/lib/zoomMath.ts` (unit-tested); gesture wiring is in the viewer.
- ⚠️ **Gesture handlers (and `goToIndex`, which they call) must read `itemsRef.current`, never the closed-over `items` param.** The `PanResponder`, created once via `useRef`, would otherwise close over whichever `items` array existed at mount; `items` (the parent's `photos` list) is wholesale-replaced by `fetchPhotos()` from triggers firing while the viewer is open (background upload landing, etc — same root cause as the `currentItemId` resync elsewhere). `itemsRef.current = items` is assigned every render; only the gesture-branch and `goToIndex` need it — JSX reads of `items` are already correct. <!-- A stale read let the photo-only gesture gate misreport "photo" for a slide that had become a video, letting a pinch accumulate zoom state with nothing shown and then block paging. -->
- ⚠️ **`onPanResponderTerminate` must perform the same cleanup as the release handler's zoom branch.** `onPanResponderTerminationRequest` defaults `true`, so a third finger on a header button (close/flag/download) mid-pinch terminates rather than releases the responder — `onPanResponderRelease` never runs, stranding `scaleRef` above 1 and blocking paging thereafter. `snapBackIfNeeded()`/`endGesture()` are helpers shared by the release and terminate paths.
- ⚠️ **Videos are excluded, and the gate is in the gesture branch — not the render.** `VideoSlide`'s default `nativeControls` overlay consumes touches (a pinch likely never reaches the handler) and scaling the container would distort controls; gating only the drawing would still let a pinch on a video accumulate scale state that leaks into the next photo.
- ⚠️ **A second finger joining a gesture already locked to `h` or `v` does NOT start a pinch** — the two-touch branch only fires when `axis.current` is `'none'` or already `'zoom'`, else a pinch mid-swipe would zoom a partially-visible cell (breaking "zoom is always 1 whenever more than one cell can be seen") and strand `translateX` off a `SCREEN_WIDTH` multiple, since only `goToIndex` re-syncs it. Letting the swipe/dismiss finish through its own release path keeps `translateX` correct.
- ⚠️ **`zoomScale`/`panX`/`panY` must animate with `useNativeDriver: true` everywhere.** The native driver latches permanently on first use; any later `Animated.timing`/`.spring()` call on these that omits `useNativeDriver: true` silently stops moving it, breaking within a single session. (`MediaViewerModal` remounts fresh per open, so these three are recreated by `useRef` each time and can't carry a bad driver forward, unlike `membersSheetTranslateY` below, which persists across opens.)
- ⚠️ **Transform order is `[{translateX}, {translateY}, {scale}]`.** Translate before scale applies the pan in untransformed space and tracks the finger 1:1 — the assumption `clampPan`'s bound encodes. Reordering silently makes panning drift at high zoom.

**Members bottom sheet** — tap the avatar cluster to open; swipe-down-to-close on top of the usual backdrop-tap/X button.
- `membersSheetTranslateY` is a persistent (component-lifetime) `useRef` `Animated.Value`, unlike `MediaViewerModal`'s (which remounts fresh every open) — **every** animation on it (open, close, release-cancel spring) must use `useNativeDriver: false`. The native driver latches permanently on first use; mixing drivers on a value created only once works the first open/close cycle and silently stops responding to drags on the second.
- The `PanResponder` is attached to the *whole* sheet (the outer `Animated.View` carrying the transform), not just the handle/header strip — a drag starting anywhere, including over member rows, should dismiss. Since the member list is a vertical `ScrollView` sharing the dismiss axis, `onMoveShouldSetPanResponderCapture` (capture, not bubble — must win against the ScrollView's native pan recognizer before scrolling starts) is gated on `membersScrollY.current <= 0 && dy > dx`, mirroring iOS overscroll-to-dismiss. `onStartShouldSetPanResponder` stays `false` so plain taps still reach the nested X button and member rows.
- `sheetCard` needs real `paddingTop` (not just the handle's own `marginTop`) — the backdrop `TouchableOpacity` is a *sibling* of the sheet, not an ancestor, so a touch landing even a few px above the sheet's top edge is grabbed by the backdrop's `Pressability` at touch-down and never reaches the sheet's `PanResponder`. Generous top padding fixes it without touching gesture logic.

**Real-time + unlock reconciliation:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules`. Every applied capsule row (realtime, `load()`, cached mount) routes through **`applyCapsule(fresh)`**, which detects a live active→unlocked transition (via `prevStatusRef`) and runs the reveal: triggers the animation, invalidates `signedUrls:${capsuleId}` **and** `media:${capsuleId}` (a surprise-mode owner's pre-unlock cache may hold an RLS-empty media list), then `fetchPhotos(true)`. This fixes the "only unlocks after refreshing" bug: realtime `postgres_changes` events aren't delivered while backgrounded and a dropped socket won't replay them. Two fallbacks: **(1)** an `AppState` `'active'` listener refetches on foreground; **(2)** a self-rescheduling poll that, while locked in time/`both` mode, wakes ~at `unlock_at` and re-checks every 15s past it (the cron flips status up to ~60s late) until confirmed, then stops. `HomeScreen` has the same `AppState` foreground `refresh(true)`. The `prevStatusRef !== null && !== 'unlocked'` guard means opening an already-unlocked capsule shows no spurious ceremony.

**Upload flow:** all media uploads go through the **background upload queue** (`src/lib/uploadQueue.ts`). "+ Add Media" offers **"Open Camera"** (→ `openInAppCamera()`, navigates to the in-app Camera tab with `{ targetCapsuleId }` — not the system camera; cleared on blur so a later direct tab visit isn't sticky) and **"Camera Roll"** (`pickFromLibrary`). The library picker doesn't enqueue directly — `goToPreview()` hands assets to `Preview` (`{ media, source: 'camera', targetCapsuleId: capsuleId }`) for per-item captions + the shared resize pipeline before Preview enqueues. `useUploadTasks(capsuleId)` renders the queue as local-URI pending tiles above the grid (spinner overlay; failed tiles get Retry + dismiss). A surprise-mode locked box shows "N uploading…" instead. An effect calls `fetchPhotos()` as each task lands. Aggregate "Uploading n/N" + `ProgressBar` driven by `uploadQueue.getProgress(capsuleId)`.

**The library picker requests images AND videos** (`mediaTypes: ['images', 'videos']` — SDK 54's array form; the older `MediaTypeOptions` enum is deprecated). `goToPreview()` maps each `ImagePickerAsset` to its real `PendingMedia.mediaType` (`asset.type === 'video' ? 'video' : 'photo'`), stamps `PendingMedia.durationMs` from `assetDurationMs(asset)` (`src/lib/mediaDuration.ts`). **Over-cap library videos are no longer dropped here** — the old `filterOversizedVideos()`/`MAX_LIBRARY_VIDEO_MS` early-drop was removed; all picked videos pass through to Preview at full length, where the tier-based gate handles them (Trim/Upgrade/Skip). `assetDurationMs` normalizes the web-shim gotcha: `asset.duration` is ms on iOS/Android, but expo-image-picker's web shim sets it straight from `HTMLVideoElement.duration`, which is **seconds** — it normalizes for `Platform.OS === 'web'`. (The old `pickFromCamera` system-camera path was removed when "Open Camera" switched to the in-app camera.) `PendingMedia` carries no `mimeType` field (matches `useShareIntent`'s shape) — `uploadQueue.enqueue` defaults it from `mediaType` (`video/mp4`/`image/jpeg`).

**Reactions:** `addReaction()` generates the reaction ID client-side via `randomUUID()` — **never chain `.select()` after `.insert()`** on `reactions` (the SELECT RLS policy may fail even though the insert succeeded, dropping the optimistic reaction). An existing reaction is UPDATEd (emoji swap) instead of inserted, respecting `unique(media_id, user_id)`.

**Cache integration:** on mount, checks `cache.get('capsule:${capsuleId}')` — cached renders instantly, fetches fresh in background. `load()` calls `cache.set()` after fetching, and runs `fetchPhotos()` in the same parallel wave. Invalidation: `cache.invalidate('capsules', 'profile')` on delete.

**`fetchPhotos(force?)`** caches three things, each independently:
- `media:${capsuleId}` (3min TTL) — raw `media` row list, so a hit skips the DB read entirely. `force=true` (pull-to-refresh) always bypasses it (another member's upload wouldn't trigger this client's own invalidate).
- `signedUrls:${capsuleId}` (50min TTL, under the 1hr signed-URL validity) — batches main + alt + thumbnail keys into one `createSignedUrls()` call.
- `videoThumb:${mediaId}` (6hr TTL) — fallback only, for videos with no `thumbnail_key`: the locally-generated `expo-video-thumbnails` frame URI.

**Video thumbnails are generated at upload time, not display time.** `uploadQueue.runTask` runs `VideoThumbnails.getThumbnailAsync` on the local file (no network) right after upload, stores the JPEG at `media.thumbnail_key` (best-effort, null on failure). `fetchPhotos` sets `MediaItem.thumbnailUri` directly from `transformMediaUrl(signedThumbUrl, GRID_THUMB_PX)` for any row that has one; the client-side `VideoThumbnails.getThumbnailAsync(item.signedUrl, …)` loop only runs where `thumbnailUri` is still unset (old rows) — gives web capsules real video thumbnails too. Included in the same delete-time storage cleanup as `storage_key`/`alt_storage_key` (`confirmDelete`).

**Grid/preview thumbnails use `transformMediaUrl()`** (`src/lib/mediaUrl.ts`), not the full-res `signedUrl` — `MediaItem.thumbSignedUrl` is derived from the already-signed URL with no extra signing round-trip. The full-screen viewer and `VoteSheet`'s media-voting grid both fall back to `signedUrl` for anything without a `thumbSignedUrl` (videos use `thumbnailUri` instead).

## Media Grid Layout

For equal-width thumbnail rows, use `flex: 1, aspectRatio: 1` — **not** `width: Dimensions.get('window').width / 3` (doesn't account for parent padding). Set `gap` on the row container.

"+N more" overlay: count is `photos.length - 2` (not `- 3`) because the overlaid photo itself isn't fully visible.

`MediaGalleryModal`: `FlatList` with `numColumns={3}`, `columnWrapperStyle={{ gap: 2 }}`, `ItemSeparatorComponent` for row gaps.
