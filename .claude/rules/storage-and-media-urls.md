---
paths:
  - "supabase/**"
  - "src/lib/uploadQueue.ts"
  - "src/lib/avatarUrl.ts"
  - "src/lib/mediaUrl.ts"
  - "src/lib/supabase.ts"
  - "src/screens/app/ProfileScreen.tsx"
  - "src/screens/app/OnboardingScreen.tsx"
  - "src/screens/app/CapsuleDetailScreen.tsx"
  - "src/components/VoteSheet.tsx"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

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

## Image Transforms (avoid full-res images in small UI)

⚠️ **Storage Image Transformations bill per distinct *origin image*, not per request or per size variant** — and the Pro plan includes only **100 origin images per month**. Every unique image routed through the render API in a billing cycle consumes one, no matter how many sizes or how many times it's fetched. Budget this before sending any new image class through the render endpoint.

**`transformAvatarUrl(url, displayPx)`** (`src/lib/avatarUrl.ts`) — **no longer transforms.** It returns the public URL unchanged. Avatars are already resized to ≤400px square and compressed at upload time (`ProfileScreen`/`OnboardingScreen`'s ImageManipulator step), so the render endpoint bought negligible bytes while burning one origin image per distinct avatar per cycle — avatars alone exhausted the whole 100/month quota. `displayPx` is kept in the signature so the call sites (`Avatar` in `ProfileScreen.tsx`, `GroupDetailScreen`, `CreateGroupScreen`, `VoteSheet`, `AwardsSection`, `QRScannerScreen`) need no change, and so the transform can be restored on a higher plan without touching them. **Don't "fix" this by reinstating the render path** — the quota, not the byte count, is the binding constraint. (Historical gotcha, still true if it's ever restored: the render API needs both `width` AND `height`; width alone leaves source height and returns a squashed image.)

`transformMediaUrl` below **does** still use the render API. Capsule media is full-resolution camera output where the saving is real, and it's gated behind private signed URLs.

**`transformMediaUrl(signedUrl, displayPx)`** (`src/lib/mediaUrl.ts`) — for the **private** `capsule-media` bucket. A signed URL already looks like `.../storage/v1/object/sign/capsule-media/<key>?token=<jwt>`; this rewrites the path segment to `/storage/v1/render/image/sign/` and appends the same `width/height/resize/quality` params, **preserving the existing `?token=` param** (the same signing token is valid on the render path — confirmed via `@supabase/storage-js`'s own `getPublicUrl()`/`download()` implementations, which do this identical path-swap-plus-query-params pattern internally). This derives a thumbnail from an *already-signed* URL with **no second signing round-trip** — preferred over `createSignedUrl(..., { transform })`, which bakes one fixed size into the token and would need a second signing call to also get the full-res viewer URL. Used for `CapsuleDetailScreen`'s media grid/3-up preview (`MediaItem.thumbSignedUrl`) and `VoteSheet`'s media-voting grid — both fall back to the full-res `signedUrl` if `thumbSignedUrl` is unset (e.g. videos, which use `thumbnailUri` instead).
