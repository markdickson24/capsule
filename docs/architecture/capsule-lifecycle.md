# Capsule detail and lifecycle

Part of the Capsule architecture docs, indexed from `CLAUDE.md`. Describes the system as it is now; update in the same change that alters it.

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

---

## Owner-Only Capsule Actions

All of the following are owner-only and silently no-op / navigate away if not owner — **except Archive**, which any joined member can do (see below):

- **Edit capsule** (`EditCapsuleScreen`) — title, description, unlock date, contribution lock date. Accessible via "Edit" button in CapsuleDetail header and (owner, pre-unlock only) the "Edit" option in Home's long-press context menu. Blocked if capsule is already unlocked.
- **Archive / restore capsule — PER-MEMBER, not capsule-global** (`20260711150000_per_member_archive.sql`). Archiving stamps `archived_at` on the **caller's own `capsule_members` row**; it hides the capsule from *that user's* main feed (into the collapsible "Archived" section on Home) and never changes what other members see. This replaced the capsule-global design (`capsules.archived_at`, `20260706120000_member_archive_capsule.sql`), which was a production bug: any member archiving silently removed the capsule from **every** member's Home feed — the "capsules keep disappearing" reports. `capsules.archived_at` is retired: the column and its final values are frozen for old installed builds; nothing in the current client reads or writes it. The RPC **`set_capsule_archived(p_capsule_id, p_archived)`** kept its name/signature but now updates the caller's member row (`security definer`, requires a `joined_at is not null` membership — raises otherwise). `CapsuleDetailScreen` gates the button on `canArchive = myMember?.joined_at != null` and reads the toggle state from `myMember.archived_at` (the members query selects `archived_at`); `HomeScreen`'s capsule query selects the member row's `archived_at` alongside the `capsules(...)` embed and merges it onto each card, so `capsules`/`archivedCapsules` split on the user's own flag. `EditCapsuleScreen.handleArchive` also routes through the RPC (toasts on failure). **Archive is reversible and lives in its own section, separate from Danger Zone** (which is Delete-only, `isOwner`-gated). `CapsuleDetailScreen`'s archive button uses `navigation.goBack()` (not `navigation.reset`) and, on success, shows a toast with an **Undo** action (`toast.show(message, { label, onPress })` — see "Toast" below) that re-calls the same RPC in reverse.
- **Home long-press context menu** — long-pressing any card (not just the owner's, unlike the old hidden owner-only long-press-to-Edit gesture) opens an Open / Edit / Archive action sheet (`HomeScreen`'s `menuCapsule` state). Edit only appears for the owner pre-unlock (mirrors `EditCapsuleScreen`'s own gate); Archive appears unconditionally since every capsule in this list already satisfies `canArchive` by virtue of being joined-member-scoped. Archive here has no Undo toast (unlike `CapsuleDetailScreen`'s) — just a plain success/failure toast.
- **Delete capsule** — goes through the **`delete_capsule_with_storage(p_capsule_id)`** RPC (`security definer`, `20260718090000_delete_capsule_with_storage.sql`), not a client-side key-collection + `capsules.delete()` sequence. The old client path selected `storage_key`/`thumbnail_key`/`alt_storage_key` from `media` before deleting the capsule row — but the `media` SELECT policy hides rows from the owner while a capsule is locked in surprise mode (`owner_preview_locked`, the **default** for new capsules), so that select silently returned zero rows and every file for the capsule was orphaned in the `capsule-media` bucket forever (BUGS.md #1). The RPC authorizes inline (`owner_id is distinct from auth.uid()` — null-safe, same pattern as `set_default_superlatives`), collects storage keys as `security definer` (bypassing the RLS gate, so it sees rows regardless of lock state), then deletes the capsule row (cascades to members, media, reactions, notifications, superlative_categories).

  ⚠️ **The RPC no longer deletes from `storage.objects`, and must not.** Supabase added `storage.protect_delete()`, a statement-level BEFORE DELETE trigger raising `42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.` Both this RPC and `delete_my_account` did exactly that, so **capsule deletion and account deletion were entirely broken** until `20260726231008` / `20260726231047`. Note a row delete never removed the underlying S3 object anyway — that asymmetry is why the guard exists — so the old code was already orphaning blobs, just untracked ones. Cleanup therefore runs **client-side, and BEFORE the row delete** — both halves forced: client-side because only the Storage API removes the blob, and *before* because the delete policy is `you own the capsule`, a check that can never pass once the capsule row is gone. `capsule_storage_keys(p_capsule_id)` (definer, owner-authorized) supplies the key list, because the `media` SELECT policy hides rows from the owner under surprise mode and a client-side select would silently return zero — the original BUGS.md #1 failure. Storage removal is best-effort: orphaned blobs are a cost problem, a capsule that won't delete is a user-facing one, so a failure reports and proceeds. `delete_my_account` follows the same shape via `my_account_storage_keys(p_delete_contributions)`, which must run before the RPC since that destroys the auth user and the JWT dies with it.

  Storage DELETE policies (added `20260726234500`): **`capsule-media` — capsule owner only**, deliberately not extended to uploaders deleting their own objects, since that would strand a media row pointing at a removed blob. **`avatars` — own folder only**, mirroring the existing insert/update policies.

  ⚠️ **`superlative_winners`' target FKs are `ON DELETE CASCADE` and must stay that way.** The table carries the same XOR check as `superlative_votes` (`(target_user_id IS NOT NULL)::int + (target_media_id IS NOT NULL)::int = 1`), which makes `SET NULL` *unsatisfiable* — nulling either column makes the sum 0 and raises 23514, aborting the whole delete. They were `SET NULL` while `superlative_votes` was correctly `CASCADE`, so any capsule holding a finalized **media**-target winner could not be deleted. That is why this presented as an *unlocked*-capsule bug: winners only exist after `finalize_capsule_superlatives`, which only runs post-unlock. `target_user_id` had the identical defect on the account-deletion path. Fixed in `20260726231158`. Confirmation required via `<ConfirmModal>` (not `Alert.alert` — that no-ops on web). Available from EditCapsule and CapsuleDetail Danger Zone (Delete only — see Archive above). Owner-only.
- **Manage members** (`ManageMembersScreen`) — lists all members (joined + pending). Trash icon removes a member after confirmation. Accessible via "Manage" button in CapsuleDetail members section.

---

## Surprise Mode (`capsules.owner_preview_locked`)

Addresses the complaint that the creator could peek at a capsule's contents before unlock. When `owner_preview_locked = true`, **the owner is locked out of viewing media exactly like everyone else** until `status = 'unlocked'` — they can still upload, see the member list, and a "N memories waiting" count, but no thumbnails/viewer.

- **Default ON for new capsules** (`default true`). Migration `20260618000000_owner_preview_lock.sql` backfilled all **pre-existing** capsules to `false` so their owners keep the old preview behavior.
- **Creation-only.** `CreateScreen` has a "Keep it a surprise" `Switch` (default on) that sets the column at insert. There is **no toggle in `EditCapsuleScreen`** — by design, so an owner can't flip it off right before unlock to peek. (The DB owner-UPDATE policy still technically allows changing the column; the client just never exposes a control.)
- **Server-side enforcement (RLS).** The `media` SELECT policy gates pre-unlock reads on `cm.role in ('owner','contributor') AND NOT c.owner_preview_locked`. So the owner genuinely can't read media rows (and thus can't obtain `storage_key`s to sign URLs) while locked — not just a client-side hide. ⚠️ That policy's membership test was `cm.user_id = auth.uid()` with **no `joined_at is not null` filter**, so a user who was invited but never accepted could read every media row of the capsule — captions, uploader ids, and the raw storage keys — despite `20260722120000`'s comment claiming it "mirrors the media table's own SELECT policy exactly" (the *storage* policy did check `joined_at`; this one didn't). Fixed in `20260802120000`. **A membership test anywhere in this codebase means `joined_at is not null`** — `capsule_media_count`, `tally_superlatives` and `set_capsule_archived` all filter on it.
- **The count comes from a SECURITY DEFINER RPC** `capsule_media_count(p_capsule_id)` (joined-member-authorized, returns 0 for non-members) because RLS now hides the rows themselves. `CapsuleDetailScreen.fetchPhotos` only calls it when the `media` row-read comes back with **zero rows** (the one case that's ambiguous — genuinely empty vs. RLS-hidden); whenever rows are readable, `mediaCount` is set directly from the fetched row count instead, skipping the round-trip. The locked box renders `mediaCount` (not `photos.length`, which is empty under the lock).
- **Client gate:** `canSeePhotos = !isLocked || (isOwner && !capsule.owner_preview_locked)`.

---

## Capsule Start Date

An optional `contribution_start_at` — the **mirror image of `contribution_lock_at`**: nobody (owner included, deliberately unlike the lock's owner exemption) can add photos until the start date arrives. For planning a capsule ahead of an event/trip that hasn't happened yet. Ships with a countdown UI, near-term date presets, and a push the moment it opens.

**Schema** (`20260716120000_capsule_start_date.sql`): `capsules.contribution_start_at` + `capsules.contribution_start_notified_at` (both nullable timestamptz), `notifications_type_check` gained `capsule_started`, and `create_capsule_with_owner` gained a trailing `p_contribution_start_at timestamptz default null`. Existing callers are unaffected (PostgREST maps `.rpc()` by name). **The migration drops the old 10-arg `create_capsule_with_owner` overload before `create or replace`** — adding a trailing param changes the type signature, so `create or replace` alone would leave two overloads coexisting and make the original 10-named-arg call ambiguous (PGRST203). RLS enforcement: see "Contribution lock… enforced at TWO layers" above (both the `media` and `storage.objects` INSERT policies check the start gate, no owner exemption).

**Cron + edge function** (`20260716120100_capsule_start_cron.sql` + `supabase/functions/dispatch-capsule-start`) — `* * * * *`, EXISTS-gated, Vault-backed `CRON_SECRET` via the shared `cron_unlock_capsules_secret` (`verify_jwt: false`, own auth check). The function atomically claims due capsules (`UPDATE ... contribution_start_notified_at = now() ... where ... is null RETURNING`, so overlapping ticks can't double-send), inserts one `capsule_started` notification per **joined** member (`pushed_at` set inline), and pushes via a local ≤100-chunk `sendExpoPush()`. Same self-contained shape as `dispatch-contribution-activity`.

**Client:**
- `src/components/DatePicker.tsx` exports `START_DATE_QUICK_OPTIONS` (Tomorrow / This weekend / In 3 days / 1 week — near-term presets, since the default `QUICK_OPTIONS` skew too far out for event planning). Consumed by both Create and Edit.
- `CreateScreen` — a "Starts" `DatePickerField` (optional, with tooltip) rendered **above the fold, unconditionally** (unlike Unlock Date, which is hidden for `proximity` mode — the start date is independent of `unlock_mode`). Validation: start must be before both the unlock date and the uploads deadline. Threaded into the RPC as `p_contribution_start_at`.
- `EditCapsuleScreen` — same "Starts" field (no tooltip, matching this screen's simpler pattern) loaded from / saved to `contribution_start_at`, with the same ordering validation.
- `CapsuleDetailScreen` — computes `notStartedYet` from `contribution_start_at`; when true it gates `canUpload` for **everyone including the owner** and renders a "Capsule starts `<date>`" pre-start card (`startsBox`) in place of the upload controls.
- `HomeScreen` — `CountdownBadge` gained a pre-start branch: when `contribution_start_at` is in the future it shows a "Starts in Nd/Nh" badge (reusing the `togetherBadge` style, calendar icon) counting down to the start date, then automatically flips to the unlock countdown once the start passes.
- `NotificationsScreen` — renders `capsule_started` (camera-outline icon, accent color, capsule-nav) with "`<title>` is open for photos now" copy.

**Shipped to production** (`ezxxvvmesegegkdeniri`) — both migrations applied, edge function deployed, cron active, bad-token 401 confirmed, and verified end-to-end against live data: a disposable capsule with a past `contribution_start_at` + two joined members produced exactly 2 `capsule_started` notifications (one per member, `pushed_at` set) via the real Vault-auth cron path, the dedup stamp landed, a second invocation returned `{"claimed":0,"notified":0}` (idempotent), and all fixtures were deleted afterward.

---

## Instant Unlock (`claim_capsule_unlock`)

The cron above runs once a minute, so `status` flipped **up to 60s after `unlock_at`** — by far the largest part of perceived unlock latency, dwarfing the ~2 round-trips and the image downloads combined. `claim_capsule_unlock(p_capsule_id)` (`20260801170000_instant_unlock.sql`, `security definer`) lets a **joined member's own client** perform the flip the moment the capsule is due. `CapsuleDetailScreen`'s existing unlock poll calls it instead of just re-reading, and reveals straight off the RPC's returned status rather than waiting for the realtime echo.

- **It cannot open anything early.** The UPDATE is guarded by `unlock_at <= now()` evaluated on the **server** clock, so a tampered device clock buys nothing. `security definer` because the `capsules` UPDATE policy is owner-only but any joined member should be able to trigger it — same reasoning as `check_in`. Verified on prod: a real joined member against a not-due capsule returns `active` and changes nothing; a non-member is rejected with `Not a member of this capsule`.
- **`unlock_mode = 'time'` only.** A `both` capsule additionally needs everyone physically together (`check_in`'s half of the contract); flipping it on the date alone would skip that entirely.
- ⚠️ **The unlock push had to be decoupled from the flip, and this is the subtle part.** `unlock-capsules` derived its push list from the rows its own `update … .eq('status','active')` returned. Once a client can win that race, that update matches **zero rows and nobody gets the unlock push** — including every member who wasn't on the screen, i.e. precisely the audience the push exists for. The notifier now claims independently via **`capsules.unlock_notified_at`** (`update … .eq('status','unlocked').is('unlock_notified_at', null)` — claim-and-stamp, race-safe against both a concurrent cron tick and a client flip, same shape as `contribution_start_notified_at`). The migration **backfills every already-unlocked capsule**, without which the next tick would blast "your capsule unlocked!" for the entire history.
- ⚠️ **The cron's EXISTS gate had to widen too** — it only fired for `status='active'` capsules, so a client-flipped one would never invoke the notifier and the push would die one layer up instead. Gate now also matches `status='unlocked' and unlock_mode='time' and unlock_notified_at is null`.
- The notify claim is scoped to `unlock_mode='time'` to match exactly who got a push before. **Known gap (pre-existing, not introduced here): proximity/`both` capsules notify nobody on unlock** — `check_in` flips the status and inserts no `notifications` rows at all.
- The `capsules_stamp_unlock_meta` BEFORE UPDATE trigger fires on this flip like any other, so `unlocked_at` / `superlative_voting_closes_at` are stamped identically whichever path unlocked it.

**Media genuinely cannot be preloaded before unlock.** The `media` SELECT policy hides the rows pre-unlock under surprise mode (the default), so there are no `storage_key`s to sign and no bytes to fetch — a deliberate server-side guarantee, not an oversight (see "Surprise Mode"). Instead `fetchPhotos` fires `Image.prefetch()` on the first `GRID_PREFETCH_COUNT` (12) thumbnails the instant signed URLs land, which at unlock overlaps the reveal animation — the only free time that exists. Don't "optimize" this by relaxing the RLS to prefetch earlier without an explicit product decision; that reverses surprise mode's whole premise.

---

## Proximity Unlock

A capsule's `unlock_mode` (`time` | `proximity` | `both`) controls how it opens:
- `time` — unlocks on `unlock_at` via the `unlock-capsules` cron (the original behavior).
- `proximity` — unlocks when all joined members are physically together.
- `both` — requires the date to have passed **and** members to be together.

**`check_in(p_capsule_id, p_lat, p_lng)` RPC** (`SECURITY DEFINER`) — a member calls it with their current GPS location. It records the location on their `capsule_members` row (`checkin_lat/lng/at`), then unlocks the capsule if every joined member has checked in within the last 10 minutes and the largest distance between any two of them is `<= proximity_radius_m` (default 100m). It's `SECURITY DEFINER` so any joined member — not just the owner — can trigger the unlock; it authorizes inline (caller must be a joined member). Returns `{ unlocked, checked_in, total, within_range }`. Distance is computed by the `_haversine_m` helper.

**Check-in UI** — `CheckInCard` (`CapsuleDetailScreen`) renders for locked `proximity`/`both` capsules in place of / alongside the `CountdownRing` (proximity-only hides the ring; `both` shows both). It has a "We're here — check in" button that requests foreground location via `expo-location`, calls `supabase.rpc('check_in', …)`, and shows `N of M here` progress. **Once the caller is checked in, the button flips to a confirmed outlined "✓ You're checked in" state** (subtitle "You're checked in — waiting on the group") but stays tappable to re-check-in (check-ins expire after 10 min and everyone must be in range at once). This `iCheckedIn` state is seeded from the caller's own `capsule_members.checkin_at` — the members query selects it and `MemberRow` carries it — but **only if within the 10-min `CHECKIN_WINDOW_MS`**, so it survives navigating away and back yet a stale check-in doesn't falsely show as active. The capsule's realtime channel fires the reveal animation for everyone when the last check-in flips `status` to `unlocked`.

**Unlock-mode picker** — `CreateScreen` and `EditCapsuleScreen` have an "Unlock When" selector (Date / Together / Both). Choosing Proximity hides the unlock-date field and skips its validation; `unlock_at` is `not null` so it still gets a placeholder value (unused for `proximity`).
