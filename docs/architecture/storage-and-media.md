# Storage, uploads and media display

Part of the Capsule architecture docs, indexed from `CLAUDE.md`. Describes the system as it is now; update in the same change that alters it.

## Supabase Storage

Two buckets:
- `capsule-media` (private) — photos and videos
- `avatars` (public) — user profile pictures; cache-bust URLs with `?t=${Date.now()}`

**`capsule-media` SELECT is membership-gated** (`20260722120000_audit_rls_hardening.sql`, "Members can read their capsule media"). The July 2026 audit found the bucket had two out-of-band dashboard SELECT policies both `USING (bucket_id = 'capsule-media')` with **no membership check** — any authenticated user could list/download/sign every capsule's private media (critical live exposure). The replacement policy mirrors the `media` table's own SELECT gate exactly (`joined` membership + `(unlocked OR (owner/contributor AND NOT owner_preview_locked))`), so a signed URL can only be minted for an object whose `media` row the caller can already read. Storage-level SELECT governs `list()`, direct download, AND `createSignedUrl` — all three now require membership. If you add a new capsule-media read flow, it inherits this gate.

**Raw REST uploads require both headers:**
```
Authorization: Bearer <access_token>
apikey: <anon_key>
```
The JS client adds both automatically. `FileSystem.uploadAsync` does not — add `apikey` manually.

**Use `FileSystem.uploadAsync` for native uploads** (iOS/Android). Uses NSURLSession — file bytes never cross the JS bridge, far faster than `fetch(uri).blob()`. Web falls back to `fetch + arrayBuffer + supabase.storage.upload()`.

**For the native `Authorization` header, use `getFreshAccessToken()` (`src/lib/supabase.ts`) — never `sessionStore.get().access_token` directly.** `FileSystem.uploadAsync` attaches the bearer manually and so bypasses the JS client's automatic token refresh. The cached `sessionStore` token can be expired if the app sat idle/backgrounded past the 1h token lifetime, and storage-api rejects a stale token with **HTTP 400 `jwt expired`** (not 401) — which manifests as a generic `Storage 400` upload failure. `getFreshAccessToken()` calls `getSession()`, which on native refreshes an expired token before returning. Do **not** call it on web — `getSession()` can hang there (see Web Auth Gotchas); web uploads go through `supabase.storage`, which refreshes on its own. All five native upload sites (avatar in Profile + Onboarding, media in Preview, CapsuleDetail, and Create's `pendingMedia` auto-upload) route through it.

**`createSignedUrls` response:** map by array index, not `item.path`. Use `signedData?.[i]?.signedUrl`. Signed URLs expire after 3600 seconds.

**Avatar upload path:** `${userId}/avatar.jpg` with `upsert: true`. The `avatars` bucket INSERT/UPDATE RLS is `auth.uid()::text = (storage.foldername(name))[1]`, so **the `userId` in the path MUST be the authenticated user** — derive it from the live session (native: `getFreshSession()`, which returns `{ accessToken, userId }` from the same `getSession()` call; web: `sessionStore.get().user.id`). Never build the path from a cached `profile.id`: if it lags the live session (e.g. after switching accounts) the path folder won't match the bearer token's subject and storage returns 403 `new row violates row-level security policy`. A 403 here is an auth.uid/path mismatch, **not** an expired token (that's a 400 `jwt expired`).
**Media upload path:** `${capsuleId}/${randomUUID()}.${ext}`.

---

## Image Transforms (avoid full-res images in small UI)

⚠️ **Storage Image Transformations bill per distinct *origin image*, not per request or per size variant** — and the Pro plan includes only **100 origin images per month**. Every unique image routed through the render API in a billing cycle consumes one, no matter how many sizes or how many times it's fetched. Budget this before sending any new image class through the render endpoint.

**`transformAvatarUrl(url, displayPx)`** (`src/lib/avatarUrl.ts`) — **no longer transforms.** It returns the public URL unchanged. Avatars are already resized to ≤400px square and compressed at upload time (`ProfileScreen`/`OnboardingScreen`'s ImageManipulator step), so the render endpoint bought negligible bytes while burning one origin image per distinct avatar per cycle — avatars alone exhausted the whole 100/month quota. `displayPx` is kept in the signature so the call sites (`Avatar` in `ProfileScreen.tsx`, `GroupDetailScreen`, `CreateGroupScreen`, `VoteSheet`, `AwardsSection`, `QRScannerScreen`) need no change, and so the transform can be restored on a higher plan without touching them. **Don't "fix" this by reinstating the render path** — the quota, not the byte count, is the binding constraint. (Historical gotcha, still true if it's ever restored: the render API needs both `width` AND `height`; width alone leaves source height and returns a squashed image.)

`transformMediaUrl` below **does** still use the render API. Capsule media is full-resolution camera output where the saving is real, and it's gated behind private signed URLs.

**`transformMediaUrl(signedUrl, displayPx)`** (`src/lib/mediaUrl.ts`) — for the **private** `capsule-media` bucket. A signed URL already looks like `.../storage/v1/object/sign/capsule-media/<key>?token=<jwt>`; this rewrites the path segment to `/storage/v1/render/image/sign/` and appends the same `width/height/resize/quality` params, **preserving the existing `?token=` param** (the same signing token is valid on the render path — confirmed via `@supabase/storage-js`'s own `getPublicUrl()`/`download()` implementations, which do this identical path-swap-plus-query-params pattern internally). This derives a thumbnail from an *already-signed* URL with **no second signing round-trip** — preferred over `createSignedUrl(..., { transform })`, which bakes one fixed size into the token and would need a second signing call to also get the full-res viewer URL. Used for `CapsuleDetailScreen`'s media grid/3-up preview (`MediaItem.thumbSignedUrl`) and `VoteSheet`'s media-voting grid — both fall back to the full-res `signedUrl` if `thumbSignedUrl` is unset (e.g. videos, which use `thumbnailUri` instead).

---

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

---

## Media Grid Layout

For equal-width thumbnail rows, use `flex: 1, aspectRatio: 1` — **not** `width: Dimensions.get('window').width / 3`. Dimensions doesn't account for parent padding. Set `gap` on the row container.

"+N more" overlay: count is `photos.length - 2` (not `- 3`) because the overlaid photo is itself not fully visible.

`MediaGalleryModal`: `FlatList` with `numColumns={3}`, `columnWrapperStyle={{ gap: 2 }}`, `ItemSeparatorComponent` for row gaps.

---

## Image Loading (`expo-image`)

All remote images use `Image` from `expo-image`, **not** from `react-native`. `expo-image` provides native disk + memory caching — after the first download, images load from cache on subsequent views.

```tsx
import { Image } from 'expo-image';

// expo-image uses `source` as string (not { uri }), `contentFit` (not resizeMode)
<Image source={url} contentFit="cover" transition={200} />
```

- `transition={200}` for smooth fade-in as images load
- `contentFit` replaces `resizeMode`: `"contain"` for full-screen viewer, `"cover"` for thumbnails
- Applied in: CapsuleDetailScreen (viewer + grid + gallery), ProfileScreen (Avatar), PreviewScreen, OnboardingScreen
