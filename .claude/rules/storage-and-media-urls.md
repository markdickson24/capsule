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

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Supabase Storage

Two buckets:
- `capsule-media` (private) — photos and videos.
- `avatars` (public) — profile pictures; cache-bust with `?t=${Date.now()}`.

**`capsule-media` SELECT is membership-gated** (`20260722120000_audit_rls_hardening.sql`, "Members can read their capsule media") — replaces two prior dashboard policies both `USING (bucket_id = 'capsule-media')` with **no membership check** (any authenticated user could list/download/sign every capsule's private media). Mirrors the `media` table's own gate exactly (joined membership + `(unlocked OR (owner/contributor AND NOT owner_preview_locked))`), so a signed URL can only be minted for an object whose `media` row the caller can already read. Governs `list()`, direct download, AND `createSignedUrl` — any new read flow inherits this gate.

**Raw REST uploads require both headers:**
```
Authorization: Bearer <access_token>
apikey: <anon_key>
```
The JS client adds both automatically; `FileSystem.uploadAsync` does not — add `apikey` manually.

**Use `FileSystem.uploadAsync` for native uploads** — NSURLSession, file bytes never cross the JS bridge, far faster than `fetch(uri).blob()`. Web falls back to `fetch + arrayBuffer + supabase.storage.upload()`.

**For the native `Authorization` header, use `getFreshAccessToken()` (`src/lib/supabase.ts`) — never `sessionStore.get().access_token` directly.** `FileSystem.uploadAsync` attaches the bearer manually, bypassing the JS client's auto-refresh — an expired (past 1h) cached `sessionStore` token gets rejected with **HTTP 400 `jwt expired`** (not 401), surfacing as a generic `Storage 400` failure. `getFreshAccessToken()` calls `getSession()`, refreshing on native before returning. **Never call it on web** — `getSession()` can hang there (Web Auth Gotchas); web uploads go through `supabase.storage`, which refreshes on its own. All five native upload sites (avatar in Profile + Onboarding; media in Preview/CapsuleDetail/Create's `pendingMedia`) route through it.

**`createSignedUrls` response:** map by array index, not `item.path` — use `signedData?.[i]?.signedUrl`. Signed URLs expire after 3600 seconds.

**Avatar upload path:** `${userId}/avatar.jpg`, `upsert: true`. RLS is `auth.uid()::text = (storage.foldername(name))[1]`, so **the `userId` in the path MUST be the authenticated user** — derive from the live session (native: `getFreshSession()`, which returns `{ accessToken, userId }`; web: `sessionStore.get().user.id`), never a cached `profile.id` (a lagging id mismatches the bearer's subject → 403 `new row violates row-level security policy`, distinct from a 400 `jwt expired`).
**Media upload path:** `${capsuleId}/${randomUUID()}.${ext}`.

## Image Transforms (avoid full-res images in small UI)

⚠️ **Storage Image Transformations bill per distinct origin image, not per request or size variant** — Pro plan includes only **100 origin images/month**. Every unique image routed through the render API in a cycle consumes one regardless of size/fetch count. Budget this before sending a new image class through the render endpoint.

**`transformAvatarUrl(url, displayPx)`** (`src/lib/avatarUrl.ts`) — **no longer transforms**, returns the public URL unchanged. Avatars are already resized ≤400px square + compressed at upload (`ProfileScreen`/`OnboardingScreen`'s ImageManipulator step); the render endpoint bought negligible bytes while burning one origin image per avatar per cycle, exhausting the quota. `displayPx` stays in the signature so call sites (`Avatar` in `ProfileScreen.tsx`, `GroupDetailScreen`, `CreateGroupScreen`, `VoteSheet`, `AwardsSection`, `QRScannerScreen`) need no change, and the transform can be restored on a higher plan without touching them. **Don't reinstate the render path** — the quota, not byte count, is binding. (If restored: the render API needs both `width` AND `height`; width alone squashes the image.)

`transformMediaUrl` **does** still use the render API — capsule media is full-res camera output with a real saving, gated behind private signed URLs.

**`transformMediaUrl(signedUrl, displayPx)`** (`src/lib/mediaUrl.ts`) — for the private `capsule-media` bucket. Rewrites a signed URL's path (`.../storage/v1/object/sign/capsule-media/<key>?token=<jwt>` → `/storage/v1/render/image/sign/`) and appends `width/height/resize/quality`, **preserving the existing `?token=`** (same signing token valid on the render path — matches `@supabase/storage-js`'s own `getPublicUrl()`/`download()` path-swap pattern). Derives a thumbnail from an already-signed URL with **no second signing round-trip** — preferred over `createSignedUrl(..., { transform })`, which bakes in one fixed size and needs a second signing call for the full-res URL. Used for `CapsuleDetailScreen`'s media grid/3-up preview (`MediaItem.thumbSignedUrl`) and `VoteSheet`'s media-voting grid — both fall back to the full-res `signedUrl` if unset (videos use `thumbnailUri` instead).
