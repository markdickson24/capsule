# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npx expo start --web        # Run in browser (primary dev target)
npx expo start --ios        # Run on iOS simulator
npx expo start --android    # Run on Android emulator
```

No test suite or linter configured yet.

## Architecture

**Capsule** is a time-locked photo-sharing app. Users create albums that stay locked until a set date, then unlock for all invited members simultaneously.

### Stack
- **React Native + Expo ~54** (single codebase for iOS, Android, web)
- **Supabase** — auth, PostgreSQL, storage, RLS, realtime
- **React Navigation v7** — native stack + custom bottom tabs
- **expo-image** — cached image loading with native disk/memory cache
- **expo-haptics** — tactile feedback on calendar and UI interactions
- **expo-location** — foreground GPS for proximity check-in (native only)
- **expo-share-intent** — iOS Share Extension + Android intent filter for receiving photos/videos from other apps
- **TypeScript** ~5.9

### Project Structure

```
modules/
  expo-dual-camera/        # Simultaneous front+back capture (see "Dual Camera" section)
  expo-video-stitcher/     # Concatenates video segments into one MP4 (iOS: AVMutableComposition;
                           # Android: MediaExtractor+MediaMuxer). Used by CameraScreen's
                           # mid-recording flip feature. JS entry: modules/expo-video-stitcher/index.ts
src/
  components/
    AwardsSection.tsx        # Superlatives UI inside CapsuleDetail — voting open / tallying / finalized cards
    ColorPicker.tsx          # HSV picker (SV panel + hue slider + hex input), controlled, reusable
    ConfirmModal.tsx         # Cross-platform confirmation dialog — use instead of Alert.alert
    DatePicker.tsx           # Shared date/time picker — custom calendar grid, month/year picker, quick presets, haptics
    RetryPrompt.tsx          # Inline "taking longer than expected" + Retry button, shown after useLoadingTimeout fires
    Skeleton.tsx             # Shimmer skeleton loaders (SkeletonBox, SkeletonCard, SkeletonProfileCard, etc.)
    SuggestCategoryModal.tsx # Bottom sheet for proposing a superlative category (label + target type)
    VoteSheet.tsx            # Bottom sheet for casting / changing a vote (person picker or media grid)
    VotingWindowPicker.tsx   # 24h / 48h / 7d / custom-hours picker for the Awards voting window
  context/
    ThemeContext.tsx         # accentColor per-user, loads from Supabase on auth
  hooks/
    useAuth.ts              # Session listener, returns { session, loading }
    useCachedFetch.ts       # Cache-aware data fetching hook — show cached, refresh in background
    useLoadingTimeout.ts    # { timedOut, reset } after Nms of loading — powers the retry-button pattern
    useDeepLinks.ts         # Handles capsule://join/<id> and capsule://reset-password
    usePushNotifications.native.ts  # Token registration + tap routing (iOS/Android only)
    usePushNotifications.web.ts     # No-op stub for web
    usePushNotifications.ts         # TS fallback stub
    useShareIntent.native.ts        # Consumes expo-share-intent, routes to Preview or stash
    useShareIntent.web.ts           # No-op stub for web
    useShareIntent.ts               # TS fallback stub
  lib/
    animations.ts           # Reusable animation hooks (useFadeIn, useSlideUp, useListItemEntrance)
    cache.ts                # In-memory cache with TTL, invalidation, and pub/sub listeners
    avatarUrl.ts             # transformAvatarUrl() — resized avatars via the public-bucket render API
    mediaUrl.ts              # transformMediaUrl() — resized capsule media via the signed/private-bucket render API
    supabase.ts             # Supabase client + on-web accessToken override (see Web Auth Gotchas)
    sessionStore.ts         # Synchronous session cache (web seeds from localStorage at module load); also the
                             # per-user onboarded-flag + session-expired AsyncStorage flags
    shareIntentStash.ts     # In-memory stash for media shared while signed out — drained after login
    ShareIntentProvider.{native,web,tsx}  # Platform-split provider wrapper (real on native, passthrough on web)
    uuid.ts                 # randomUUID() helper
    googleAuth.ts           # signInWithGoogle() via expo-auth-session
    navigationRef.ts        # Imperative nav ref for use outside components
  navigation/
    AppNavigator.tsx        # Onboarding gate + Tabs + stack screens, CustomTabBar
    AuthNavigator.tsx       # Welcome → Login → SignUp
  screens/
    auth/  WelcomeScreen, LoginScreen, SignUpScreen
    app/   HomeScreen, CreateScreen, CapsuleDetailScreen, CameraScreen,
           PreviewScreen, NotificationsScreen, ProfileScreen, PublicProfileScreen,
           ResetPasswordScreen, EditCapsuleScreen, ManageMembersScreen, SettingsScreen,
           OnboardingScreen
  types/
    navigation.ts           # AuthStackParamList, AppTabParamList, AppStackParamList (includes Onboarding)
    database.ts             # Capsule, User, etc. row types — keep in sync with the DB
supabase/
  functions/
    unlock-capsules/         # Edge function: marks active capsules with unlock_at <= now() as unlocked
                             # and pushes notifications. Auth: Bearer CRON_SECRET. Triggered every minute
                             # by a pg_cron job that reads the secret from Supabase Vault.
    send-invite-push/        # Edge function: sends the "you were invited" push. Reads the invitee's
                             # push_token with the service role so clients never need read access to it.
    send-superlative-pushes/ # Edge function: reads unpushed superlative_* notifications and sends Expo
                             # pushes (suggested / closing_soon / won). Called every minute by the same
                             # cron that runs close_superlative_windows. Shares CRON_SECRET with
                             # unlock-capsules.
  migrations/                # Timestamped SQL migrations applied to the remote DB. supabase-schema.sql
                             # is the original schema and has drifted — the migrations are the source of truth.
```

---

## Auth Flow

`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`. `App.tsx` renders `AuthNavigator` or `AppNavigator` based on session presence. Loading state blocks rendering until session is confirmed (Supabase session restore is async).

**Auth methods:** email/password (`supabase.auth.signInWithPassword`) and Google OAuth (`src/lib/googleAuth.ts` — uses `expo-auth-session` + `expo-web-browser`, extracts tokens from redirect URL, calls `supabase.auth.setSession`).

**Platform split in `src/lib/supabase.ts`:** on web, Supabase uses `localStorage` (default). On native, `expo-secure-store` is used via a custom async adapter. Do not use the async adapter on web — it causes the JWT to not be attached to requests.

**Always use `getSession()` instead of `getUser()`** when you just need the user ID or token. `getUser()` makes a live network request on every call (500ms–2s latency). `getSession()` reads from local storage instantly.

---

## Navigation Structure

`AppNavigator` reads `users.onboarded_at` on mount and sets `initialRouteName` to `Onboarding` (if null) or `Tabs` (if set). Existing users were backfilled to `now()`, so only new sign-ups hit the wizard.

```
RootNavigator (App.tsx)
  AuthNavigator  →  Welcome, Login, SignUp
  AppNavigator
    Onboarding      ← initial route if users.onboarded_at IS NULL
    Tabs (CustomTabBar)
      Home
      Create
      Camera          ← large center button, translates up 10px
      Notifications   ← labeled "Alerts"
      Profile
    CapsuleDetail     { capsuleId: string }
    PublicProfile     { userId: string }
    Preview           { uri: string; mediaType: 'photo'|'video'; facing?: 'front'|'back' }
                      (animation: 'none')
    ResetPassword     (no params — session set via deep link before navigating here)
    EditCapsule       { capsuleId: string }
    ManageMembers     { capsuleId: string }
    Settings          (no params — accent color picker, animation: 'slide_from_bottom')
    Onboarding        (no params — 4-step wizard, animation: 'fade')
```

Tab `Create` accepts optional `{ presetTitle, presetDescription, pendingMedia }` route params. `presetTitle`/`presetDescription` are used by Onboarding step 4 preset cards. `pendingMedia` is a `PendingMedia[]` set by `PreviewScreen` when creating a new capsule from the camera/share flow — every item auto-uploads sequentially after the capsule is created.

**`navigationRef`** (`src/lib/navigationRef.ts`) — a `NavigationContainerRef` used for imperative navigation from outside components (e.g. push notification tap handler, deep link handler). Poll `navigationRef.isReady()` before calling `.navigate()`.

**Deep links** — handled by `useDeepLinks` (`src/hooks/useDeepLinks.ts`), called from `RootNavigator` in `App.tsx`. Two routes:
- `capsule://join/<capsuleId>` — inserts pending `capsule_members` + `notifications` row (type: 'invite') if not already a member, navigates to Notifications tab.
- `capsule://reset-password#access_token=...&refresh_token=...` — calls `supabase.auth.setSession()` with tokens from the URL fragment, then navigates to `ResetPassword` screen.

The scheme `capsule://` is registered in `app.json`. `NavigationContainer` also receives a `linking={{ prefixes: ['capsule://'] }}` prop. **Custom URL schemes only work in native builds, not Expo Go.**

**QR scan-to-join** — owners show a QR encoding `capsule://join/<id>` (InviteModal in `CapsuleDetailScreen`); `QRScannerScreen` (Home → Scan QR) scans it. The pre-join preview (title/owner/member-count) **must** come from the `capsule_join_preview(p_capsule_id)` SECURITY DEFINER RPC, **not** a direct `capsules` select — the `capsules` SELECT policy is membership-gated, so a non-member (i.e. anyone scanning to join) can't read the row directly and the scanner would wrongly report "doesn't exist or expired." The RPC returns only minimal non-sensitive fields, gated by possession of the (unguessable) capsule UUID. The join INSERT itself is allowed for self-join (`can_insert_capsule_member` returns true when `p_user_id = auth.uid()`).

---

## Key RLS Constraints

**Capsule insert:** do not chain `.select()` on the insert. The SELECT policy checks `capsule_members` for membership, but the member row doesn't exist yet at insert time — this causes a 403. Pattern: generate UUID client-side with `randomUUID()`, insert capsule without `.select()`, then insert the member row separately.

**`capsule_members` policies use security definer functions** to avoid infinite recursion:
- SELECT: `get_my_capsule_ids()` — returns capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — checks ownership via `capsules` table

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or use the `capsules` table directly.

All RLS policies use `(select auth.uid())` not `auth.uid()` directly — avoids query planner issues. `get_my_capsule_ids()`, `can_insert_capsule_member()`, and the `capsules`/`capsule_members` policies above were live on production for an unknown period without ever being committed to a migration — another out-of-band dashboard/MCP change, like the missing `home_layout` grant below but for an entire policy redesign rather than one grant. Captured in `20260515232500_capture_capsule_rls_and_helpers.sql`. If you find another RLS policy or function that doesn't match what `mcp__supabase__execute_sql` shows is actually live, assume the live DB is correct and the migration is the one that's stale — verify with `pg_policies`/`pg_get_functiondef` before changing behavior.

**Contribution lock is enforced at TWO layers** (both must allow):
1. `media` table INSERT policy checks `c.contribution_lock_at IS NULL OR now() < c.contribution_lock_at` (joins `capsule_members` for membership + role).
2. `storage.objects` INSERT policy for the `capsule-media` bucket (`Contributors can upload to their capsules`) does the **same check** — extracts the capsule_id from the path's first folder segment (`(storage.foldername(name))[1]`) and validates membership/role/lock. The bucket-level policy was previously wide open; tightening it closed a hole where a malicious user could spam storage without ever inserting the linking `media` row.

---

## Supabase Storage

Two buckets:
- `capsule-media` (private) — photos and videos
- `avatars` (public) — user profile pictures; cache-bust URLs with `?t=${Date.now()}`

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

Both helpers use Supabase Storage's image-render API to serve a resized image instead of the full upload — saves bandwidth and avoids the device decoding a huge JPEG just to show a small thumbnail. **The mechanism differs by bucket visibility:**

**`transformAvatarUrl(url, displayPx)`** (`src/lib/avatarUrl.ts`) — for the **public** `avatars` bucket. Rewrites `/storage/v1/object/public/` → `/storage/v1/render/image/public/` and appends `?width=&height=&resize=cover&quality=75` (2× density, capped at 400px — the avatar upload ceiling). **Must pass both `width` AND `height`** — passing only `width` leaves height at the source image's size and returns a squashed, non-square image (this caused a real bug: avatars rendered badly cropped/zoomed because only `width` was set). `resize=cover` center-crops to the requested box. Used everywhere avatars render below full size: `Avatar` component (`ProfileScreen.tsx`), `GroupDetailScreen`, `CreateGroupScreen`, `VoteSheet`, `AwardsSection`, `QRScannerScreen`.

**`transformMediaUrl(signedUrl, displayPx)`** (`src/lib/mediaUrl.ts`) — for the **private** `capsule-media` bucket. A signed URL already looks like `.../storage/v1/object/sign/capsule-media/<key>?token=<jwt>`; this rewrites the path segment to `/storage/v1/render/image/sign/` and appends the same `width/height/resize/quality` params, **preserving the existing `?token=` param** (the same signing token is valid on the render path — confirmed via `@supabase/storage-js`'s own `getPublicUrl()`/`download()` implementations, which do this identical path-swap-plus-query-params pattern internally). This derives a thumbnail from an *already-signed* URL with **no second signing round-trip** — preferred over `createSignedUrl(..., { transform })`, which bakes one fixed size into the token and would need a second signing call to also get the full-res viewer URL. Used for `CapsuleDetailScreen`'s media grid/3-up preview (`MediaItem.thumbSignedUrl`) and `VoteSheet`'s media-voting grid — both fall back to the full-res `signedUrl` if `thumbSignedUrl` is unset (e.g. videos, which use `thumbnailUri` instead).

---

## Database Schema

Defined in `supabase-schema.sql`.

| Table | Key columns |
|---|---|
| `users` | id, email, display_name, bio (max 80 chars), avatar_url, push_token, auth_provider, subscription_tier, accent_color (default '#FF6B35'), home_layout (list/grid, default 'list'), onboarded_at (null = needs wizard), created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at, archived_at (null = active), unlock_mode (time/proximity/both), proximity_radius_m (default 100), unlocked_at, superlative_voting_hours (default 48), superlative_voting_closes_at, superlative_voting_finalized_at, superlative_closing_soon_sent_at, owner_preview_locked (default true — surprise mode), occasion (wedding/vacation/party/baby/milestone/general, default 'general' — drives the default-awards theme) |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending), checkin_lat, checkin_lng, checkin_at |
| `media` | id, capsule_id, uploader_id, storage_key, media_type (photo/video), size_bytes, thumbnail_key, uploaded_at, is_flagged |
| `reactions` | id, media_id, user_id, emoji, created_at — unique (media_id, user_id) |
| `notifications` | id, user_id, capsule_id (**nullable** — null for friend events), actor_id (nullable — the other user, for friend events), type (invite/unlock/reaction/contribution_nudge/milestone/superlative_suggested/superlative_closing_soon/superlative_won/friend_request/friend_accept), sent_at, read_at, pushed_at (null = unpushed; superlative pushes batch via cron) |
| `superlative_categories` | id, capsule_id, suggested_by, label (3–80 chars), target_type (person/media), status (pending/live/archived), promoted_at, created_at, is_default (bool, default false — marks an auto-seeded award, see "Default Awards" below) |
| `superlative_upvotes` | category_id + user_id (composite PK), created_at — drives auto-promote trigger |
| `superlative_votes` | category_id + voter_id (composite PK), target_user_id XOR target_media_id, created_at, updated_at — anonymous; clients only read own row |
| `superlative_winners` | id, category_id, target_user_id XOR target_media_id, vote_count, determined_at — one row per (category, tied target); written only by finalize RPC |
| `content_reports` | id, reporter_id, target_type (media/user), reported_media_id XOR reported_user_id, capsule_id, reason (spam/harassment/nudity/violence/hate/self_harm/other), details (≤500), status (pending/reviewed/actioned/dismissed), created_at — insert+read-own RLS; reviewed out-of-band via service role |
| `blocked_users` | blocker_id + blocked_id (composite PK), created_at — directional; owner-only RLS (blocked party can't see the row) |
| `friendships` | id, requester_id, addressee_id, status (pending/accepted), created_at, responded_at — one row per unordered pair (unique index on least/greatest); RLS: read-own, insert-as-requester, update-to-accepted-by-addressee, delete-by-either |

**`users` column privileges:** the `users` SELECT policy is `USING (true)` (every signed-in user can read every profile — needed for search and public profiles). To stop that exposing sensitive fields, `email`, `phone`, and `push_token` are removed from the `authenticated` SELECT grant at the **column level**. Never `select('email')` / `select('phone')` / `select('push_token')` / `select('*')` on `users` from client code — it will fail. The current user's email is on the auth session (`session.user.email`), not this table. Reading another user's `push_token` is server-only (see the `send-invite-push` edge function).

> ⚠️ **Adding a new client-readable column to `users`?** Because the grant is column-level (the table-wide SELECT grant was revoked), a new column added via `ALTER TABLE ADD COLUMN` gets **no** SELECT grant by default — `authenticated` will have INSERT/UPDATE but not SELECT. Any query selecting it then fails with `42501 permission denied` for the **entire** query (not just that column), silently breaking unrelated fields in the same `select()`. **Always `grant select (...)` the new column to `authenticated` in the same migration.** This bit `home_layout` (added in `20260610020000`, granted in `20260610210000_grant_home_layout_select.sql`): the missing grant made `ThemeContext`'s `select('accent_color, home_layout')` 403, so accent color reset to default on every sign-in.

**Triggers:**
- `handle_new_user()` — auto-creates `users` row on `auth.users` insert
- `notify_on_reaction()` — inserts reaction notification (not to self)
- `notify_on_superlative_suggested()` — fan-out on `superlative_categories` insert; notifies every other joined member
- `_promote_superlative()` — on `superlative_upvotes` insert, flips a pending category to `live` once upvotes hit `ceil(joined/2)`
- `_stamp_unlock_meta()` — BEFORE UPDATE on `capsules`; when status flips to 'unlocked' stamps `unlocked_at = now()` and `superlative_voting_closes_at = unlocked_at + voting_hours`. Both the unlock cron and the proximity `check_in` path inherit this for free.
- `_touch_superlative_vote_updated_at()` — bumps `updated_at` when a vote is changed
- `notify_on_friend_request()` — AFTER INSERT on `friendships` (pending); inserts a `friend_request` notification for the addressee (actor = requester)
- `notify_on_friend_accept()` — BEFORE UPDATE on `friendships`; on pending→accepted stamps `responded_at` and inserts a `friend_accept` notification for the requester (actor = addressee)

**Permission model:** by default only owners can preview media before unlock; contributors/viewers see a locked state until `status = 'unlocked'`. Use `isOwner` (`capsule.owner_id === currentUserId`) for owner checks — works even if the `capsule_members` row is missing. **Surprise mode (`capsules.owner_preview_locked`)** overrides this: when on, even the owner can't see media until unlock. See "Surprise Mode" below.

**Pending invites:** `joined_at IS NULL` on `capsule_members` means invite not yet accepted. `joined_at` is set when the user accepts.

**Notifications are soft-deleted** by setting `read_at`. Queries filter `.is('read_at', null)` to show only unread.

---

## In-App Camera (`CameraScreen.tsx`)

- `mode="video"` is required on `CameraView` even for photos — expo-camera 17.x needs it for `recordAsync`
- Tap = photo, hold 300ms = video (manual timer via `setTimeout`, not `onLongPress`)
- Double-tap (within 300ms) switches front/back camera
- Pinch gesture (PanResponder): zoom 0–1, displayed as 1×–5× badge, fades after 800ms
- Max video recording: 30 seconds
- **Hands-free lock:** while holding to record, slide the shutter finger **right ≥ 90px** — the lock pill (right of shutter) highlights accent-colored and pulses (`lockAnim`). Release to lock: recording continues hands-free, the shutter becomes a red stop square. Tap the stop square to end. Works for both single and dual recording. State: `locked` (React state), `lockedRef` (ref for PanResponder), `willLockRef` + `hasFiredLockHapticRef` (transient arm state). All reset in `cleanupRecording`.
- **Zoom deadzone:** horizontal movement ≥ 20px (`LOCK_DEADZONE_X`) suppresses vertical zoom to prevent accidental zooming while starting a rightward lock-swipe.
- **Flip camera mid-recording (single-camera only):** tap the reverse button (top-right) or double-tap the viewfinder while recording to switch front↔back. Implemented as a **multi-segment recording loop** in `startRecording`: each call to `recordAsync` is one segment; `flipCameraDuringRecording()` sets `pendingFlipRef`, stops the current segment, calls `setCameraMode`, and a `useEffect([facing])` resolves the loop's await once the `CameraView` re-renders. After all segments are collected, they are stitched into one MP4 via `stitchVideos()` from `modules/expo-video-stitcher` before navigating to Preview. The 30s cap is shared across all segments (`recordSecondsRef`). Dual-camera mode is excluded (both lenses already active).
  - **iOS orientation gotcha:** `ExpoVideoStitcherModule.stitch()` (iOS) builds an `AVMutableComposition` with a single shared video track spanning all segments — that track has exactly **one** `preferredTransform` for its whole timeline, so it can't represent front and back camera segments having different orientations (which they commonly do). Naively concatenating without accounting for this renders every segment with the same transform regardless of which camera captured it, showing up as one segment (often whichever isn't closest to identity) compressed/stretched into the wrong aspect ratio. Fixed by building an explicit `AVMutableVideoComposition` with one instruction per segment, each applying that segment's own `preferredTransform` (re-anchored at the origin, scaled/centered into a shared render canvas — also guards against front/back recording at slightly different native resolutions). Android has the analogous bug (`MediaMuxer`'s single video track can likewise only carry one orientation, and `stitch()` there only registers the first segment's rotation) but needs a fundamentally different fix — a real decode/rotate/encode transcode, not a metadata change — and is not yet fixed.
- Photos: resized to 1920px wide via `expo-image-manipulator`, compress 0.82, quality 0.88
- Front camera photos: flipped horizontally via `FlipType.Horizontal`
- Use `useIsFocused()` to stop camera rendering when tab is not active
- Navigates to `Preview` with `{ uri, mediaType, facing }`

**Camera mode dropdown:** a side dropdown (top-left, `styles.modeDropdown`) selects `cameraMode: 'back' | 'front' | 'dual'`. `facing` is derived (`front`→front, else back). `Back`/`Front` render `CameraView`; `Dual` renders `<DualCameraView>` (see below). The Dual option only appears when `isDualCameraSupported`. In Dual mode: pinch/zoom + double-tap-flip are disabled, and the reverse button is hidden. Tap = dual still photo; hold 300ms = dual video recording (same hold threshold as single).

---

## Dual Camera (`modules/expo-dual-camera`)

Simultaneous front+back capture (Snapchat-style) with two **selectable layouts** — `sideBySide` (back|front feeds shown **whole/aspect-fit** over a shared **blurred backdrop**, Snapchat-style) and `pip` (full back + a rounded front bubble top-right). `expo-camera` cannot do multi-cam, so this is a **local Expo native module** (autolinked from `modules/`, survives `expo prebuild --clean`). Consumed by `CameraScreen` via `import { DualCameraView, isDualCameraSupported, DualCameraViewRef, DualCameraLayout } from '../../../modules/expo-dual-camera'`.

- **Layout prop:** `<DualCameraView layout="sideBySide" | "pip" />`. `CameraScreen` holds `dualLayout` state and shows a **live switcher** (Split / PiP segmented control, `styles.layoutSwitch`) over the dual preview, bottom-center. The native `setLayout` re-runs `layoutSubviews` and the capture path picks the matching compositor, so switching is instant and applies to the next capture. The switcher dims and becomes non-interactive during video recording.
- **iOS (`ios/ExpoDualCameraView.swift`):** `AVCaptureMultiCamSession` with back+front wide-angle inputs added via `addInputWithNoConnections` and explicit `AVCaptureConnection`s (multi-cam requires manual connections). Two `AVCaptureVideoPreviewLayer`s, arranged by `layout` in `layoutSubviews` (half-width boxes with `videoGravity = .resizeAspect` for sideBySide so each whole feed is letterboxed; full back + corner bubble for pip — PiP geometry is width-fraction constants so preview + composite stay in sync). **sideBySide blurred backdrop:** a `backdropLayer` (`CALayer`) sits behind both preview layers and fills the letterbox gaps. It's driven by the **back lens's already-running `AVCaptureVideoDataOutput` frames** — `onFrame(isBack:)` downscales to ~96px, `CIGaussianBlur`s, and sets `backdropLayer.contents`, throttled to ~14fps. This adds **no new `AVCaptureConnection`** (critical for the multi-cam hardware-cost budget). The backdrop is hidden in `pip` (where the back layer fills the frame with `.resizeAspectFill`). **Capture uses the Apple AVMultiCamPiP / Snapchat pattern: each lens runs an `AVCaptureVideoDataOutput` (a `FrameGrabber` delegate), NOT an `AVCapturePhotoOutput`.** On `capturePhoto()` we "arm" a grab; the next frame delivered from each lens (on `dataQueue`) is converted via a shared `CIContext` to a `UIImage`, then both are merged by `composeSideBySide` (blurred back-lens backdrop aspect-filled across the canvas, then each lens drawn **whole via `drawAspectFit`** centered in its half, **no divider** — mirrors the live preview) or `composePiP` (rounded, white-bordered, aspect-fill inset) into one JPEG in a temp file. The front lens is mirrored at the capture connection (and the data connection is set to `.portrait`), so compositors draw it as-is. A 2s timeout rejects the promise if frames never arrive. `capturePhoto()` is a view `AsyncFunction` resolving `{ uri, width, height }`.
  - **Hardware-cost budget (the "cost limit" bug):** `AVCaptureMultiCamSession` shares one hardware-cost budget across both lenses, and two `AVCapturePhotoOutput`s blew it (they reserve full-res still budget) — capture is now video-data-output based for that reason. Cost is further kept in budget by `applyMultiCamFormat` (prefers **binned**, modest-resolution formats — *cheapest*, not highest-res — capped at 24fps), and `ensureCanAdd` (steps frame rate 24→12fps and retries `canAddConnection` instead of failing). `reduceHardwareCostIfNeeded` is the post-commit safety net. Init-error messages report the live `session.hardwareCost` (e.g. "cost 1.20") so an on-device run is diagnostic.
- **Android (`android/.../ExpoDualCameraModule.kt`):** reports `isSupported = false` (concurrent dual-cam is rare/device-specific). Dual mode is hidden there.
- **JS (`index.ts`):** guards `Platform.OS !== 'web'` + try/catch around `requireNativeModule`/`requireNativeView`, so web and Expo Go (pre-prebuild) fall back to `isDualCameraSupported = false` and `<DualCameraView>` renders null. `isDualCameraSupported` reads the native `isSupported` constant (true only on A12+ iPhones, iOS 13+).
- **Still capture flow:** `CameraScreen.captureDualPhoto()` calls `dualRef.current.capturePhoto()`, runs the result through the same `processPhoto` (resize 1920) + `Preview` navigation as single-camera photos.
- **PiP swap (BeReal-style):** in PiP, `capturePhoto()` also returns `altUri` — the swapped composite (`composePiP(base: front, inset: back)`), i.e. front as the full frame. Both composites are uploaded: the default → `media.storage_key`, the swap → `media.alt_storage_key` (added in `20260616120000_add_media_alt_key.sql`; a non-null `alt_storage_key` marks a swappable dual photo). `PreviewScreen.uploadToSingle(…, altUri?)` uploads both via the shared `uploadFile` helper. In the viewer (`MediaViewerModal`), `fetchPhotos` signs both keys; a corner **swap button** (`styles.swapBubble`) toggles per-item `swapped[id]`, and `shownUrl(item)` picks `altSignedUrl` vs `signedUrl` for both the displayed image and the download. sideBySide has no `altUri` (no meaningful swap). Only newly-captured dual photos are swappable; pre-existing flattened ones aren't. **The camera→new-capsule `pendingMedia` path does not carry `altUri` yet** (alt is threaded only through the single-item `Preview` route).
- **Video recording:** `recordAsync({ maxDuration })` / `stopRecording()` are view `AsyncFunction`/`Function` on `ExpoDualCameraModule`. `startRecordingWithPromise` sets up an `AVAssetWriter` (H.264, 720×1280, 8 Mbps) + `AVCaptureAudioDataOutput` (AAC mono, 44.1 kHz) on `sessionQueue`. In `onFrame`, when recording is armed, both lenses' `CMSampleBuffer`s are stored; on each back-lens frame, both are composited (via the existing `composeSideBySide`/`composePiP` UIKit functions) and the resulting `UIImage` is drawn into a `CVPixelBuffer` from the `AVAssetWriterInputPixelBufferAdaptor` pool, then appended with a relative PTS. `recordingLock` (`NSLock`) serialises recording state across `sessionQueue` (setup/teardown) and `dataQueue` (frame writes). `finalizeRecording` marks inputs finished, calls `finishWriting`, then resolves the JS promise with `{ uri }`. Backdrop blur is suppressed during recording to free CPU. **No `altUri` for video** (producing two simultaneous composited streams is prohibitively expensive).
- **`CameraScreen` video flow:** `startDualRecording` / `stopDualRecording` mirror the single-camera `startRecording` / `stopRecording` pattern exactly — same `isRecordingRef`, `recordInterval`, `maxDurationTimer`, `cleanupRecording`, and red-shutter animation. Hold 300ms triggers `startDualRecording` (via `isDualRef.current` check inside the hold timer closure); release calls `stopDualRecording`. No `processPhoto` call — videos skip ImageManipulator (same as single-camera video).
- **Requirements:** needs a custom dev/EAS build + a physical multi-cam iPhone — **does not run in Expo Go or the simulator**. Uses the existing `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` from the `expo-camera` plugin (no app.json change).
- **Not yet device-verified** — expect on-device iteration on session/hardware-cost tuning. If capture still fails, the error now carries the actual cost number; lower `applyMultiCamFormat`'s `maxWidth` (e.g. 960) and/or the starting fps from there.

---

## Preview Screen (`PreviewScreen.tsx`)

- Shows photo(s) or looping video(s) before adding to a capsule
- Fetches user's active capsules (non-unlocked, where role is owner or contributor and `joined_at` is not null)
- **Two route shapes** (discriminated at runtime in a `useMemo`):
  - `{ uri, mediaType, facing? }` — single-item form, used by `CameraScreen`
  - `{ media: PendingMedia[], source?: 'share' | 'camera' }` — multi-item form, used by `useShareIntent`
- **Carousel for multi-item:** horizontal `FlatList` with `pagingEnabled`, page dots overlay, "N / total" counter pill in the top bar. `currentIndex` tracked via `onMomentumScrollEnd`
- **Single shared `useVideoPlayer`** keyed by `currentItem.uri` — only mounts a `VideoView` for the item at `currentIndex`; other video slides show a play-icon placeholder. This avoids the rules-of-hooks problem of one player per item
- The outer swipe-down PanResponder requires `g.dy > Math.abs(g.dx)` to start, so the horizontal `FlatList` keeps its gesture for paging
- **Multi-select capsules** via horizontal chip scroll with `Set<string>`. "Add to Capsule" is **optimistic**: it enqueues every (capsule × media) pair on the background upload queue (see "Background Upload Queue" below) and navigates immediately — `CapsuleDetail` (single capsule) or `Home` (multiple). There is no blocking upload UI on this screen anymore.
- **Empty state:** when no active capsules exist, shows "No active capsules yet" with a "Create Capsule" button. This navigates to Create tab with `pendingMedia: PendingMedia[]` — the media auto-uploads after capsule creation
- Swipe down > 100px triggers discard confirmation modal
- Upload: web uses `arrayBuffer`, native uses `FileSystem.uploadAsync`
- Cache invalidation after upload: `cache.invalidate('capsules')` + per-capsule keys

---

## Share Intent (`expo-share-intent`)

Receives photos/videos shared from other apps (Photos, Files, Messages, Instagram, etc.) and routes them into the `PreviewScreen` capsule-selection flow.

- **Library:** `expo-share-intent` 5.1.1 (the last major that supports Expo SDK 54 — v6 requires SDK 55). Adds an iOS Share Extension target and Android `SEND` / `SEND_MULTIPLE` intent filters via a config plugin in `app.json`
- **Config plugin** accepts images + videos, single + multi:
  - iOS activation rules: `NSExtensionActivationSupportsImageWithMaxCount: 10`, `NSExtensionActivationSupportsMovieWithMaxCount: 10`
  - Android: `androidIntentFilters: ['image/*', 'video/*']` + `androidMultiIntentFilters: ['image/*', 'video/*']`
  - Extension display name: "Capsule"
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

---

## Push Notifications (`usePushNotifications.ts`)

- Called from `App.tsx` with `userId` from session
- Registers Expo push token (native only) and stores in `users.push_token` — but **only if permission is already granted**. `registerToken` never calls `requestPermissionsAsync`; the native prompt fires exactly once, from `requestPushPermission(userId)` (exported from the same module, no-op `false` on web), which the Onboarding "Don't miss it" primer calls after the user's first capsule is created. A "maybe later" answer writes `cap_notif_reprime:<userId>` to AsyncStorage so a future contextual re-ask knows the prompt is still unspent.
- Notification tap handler: reads `data.capsuleId` or `data.screen` from notification payload, navigates via `navigationRef`
- Notification display config: `showAlert`, `playSound`, `showBanner`, `showList` all true
- Invite push notifications are sent by the `send-invite-push` edge function. `CapsuleDetailScreen.sendInviteNotification()` calls it via `supabase.functions.invoke()`; the function verifies the caller owns the capsule, reads the invitee's `push_token` with the service role, and posts to Expo. The in-app notification row itself is created server-side by the `notify_on_invite` trigger.
- Reaction notifications are created server-side by the `notify_on_reaction` trigger
- **Expo push requests are chunked to ≤100 messages** (PERFORMANCE.md #10). Expo's `exp.host` API rejects a request carrying more than 100 messages — the **whole batch** fails, so a 100+ member capsule unlocking would silently drop every push for that tick. Both cron-driven senders (`unlock-capsules`, `send-superlative-pushes`) route their `messages` array through a `sendExpoPush()` helper that slices into ≤100-message requests, posted sequentially. Byte-identical behavior for ≤100 messages. Both functions keep `verify_jwt = false` (custom `CRON_SECRET` auth — the cron sends a non-JWT bearer).

---

## CapsuleDetailScreen Key Patterns

Large file (~2200 lines). Key sub-components and patterns:

**`ProgressRing`** — pure RN circular progress indicator. Two-half-clip technique: each half uses a full ring with two adjacent border colors (orange + track) clipped to its side, rotated to reveal the correct amount.
- Right half: `borderTopColor + borderRightColor = orange`, rest = trackColor
- Left half: `borderBottomColor + borderLeftColor = orange`, rest = trackColor
- Rotation formula: `rightRot = -135 + min(deg, 180)`, `leftRot = -135 + max(deg - 180, 0)`
- **Do not use `borderColor: 'transparent'`** — causes a dark rendering artifact on iOS at the color transition point. Always set all 4 border colors explicitly.

**`CountdownRing`** — wraps `ProgressRing` with lock icon, countdown text, unlock date. Updates every 60s via `setInterval`. Progress = `timeRemaining / (unlock_at - created_at)`, falls back to 1-year total if `created_at` unavailable.

**`InviteModal`** — user search with 300ms debounce (min 2 chars), sends push notification to invited user client-side.

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis is locked on first movement (prevents diagonal). Vertical swipe > 120px or velocity > 1.5 closes modal. Header controls (close, page counter, download) sit inside a `LinearGradient` overlay (top 120px, `rgba(0,0,0,0.6)` → transparent) so buttons don't get lost against light images. Download button uses `expo-media-library` on native (saves to camera roll) and anchor-element download on web.

**Members bottom sheet** — tap the avatar cluster to open; swipe-down-to-close on top of the usual backdrop-tap/X button. Three real bugs went into getting this gesture right, worth knowing before touching it again:
- `membersSheetTranslateY` is a persistent (component-lifetime) `useRef` `Animated.Value`, unlike `MediaViewerModal`'s (which remounts fresh every open) — so **every** animation on it (open, close, release-cancel spring) must use `useNativeDriver: false`. React Native's native driver permanently latches a value the first time `useNativeDriver: true` runs on it; mixing drivers on a value that's only ever created once works on the first open/close cycle and silently stops responding to drags on the second.
- The `PanResponder` is attached to the *whole* sheet (the outer `Animated.View` carrying the transform), not just the handle/header strip — a drag starting anywhere on the sheet, including over the member rows, should dismiss it. Since the member list is a vertical `ScrollView` sharing the same axis as the dismiss gesture, `onMoveShouldSetPanResponderCapture` (not the bubble-phase variant) is gated on `membersScrollY.current <= 0 && dy > dx` — only claims a downward drag once the list is already scrolled to the top, mirroring native iOS overscroll-to-dismiss. Capture (not bubble) is required to win against the ScrollView's own native pan recognizer before it starts scrolling. `onStartShouldSetPanResponder` stays `false` (no capture variant either) so plain taps still reach the nested X button and member rows.
- `sheetCard` needs real `paddingTop` (not just the handle's own `marginTop`) — the backdrop `TouchableOpacity` is a *sibling* of the sheet in the render tree, not an ancestor, so a touch that lands even a few px above the sheet's actual top edge is grabbed by the backdrop's `Pressability` at touch-down and never reaches the sheet's `PanResponder` at all (a subsequent drag just cancels the backdrop's pending tap — net effect: nothing happens). With a 4px handle pill and no top padding, "aim for the top of the sheet" reliably misses. Generous top padding fixes it without touching the gesture logic at all.

**Real-time:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules` table. On status → 'unlocked': triggers reveal animation, invalidates `signedUrls:${capsuleId}` **and** `media:${capsuleId}` (a surprise-mode owner's pre-unlock cache may have cached an RLS-empty media list), then refetches media.

**Upload flow:** all media uploads (Add Photos picker, camera, and everything arriving from PreviewScreen) go through the **background upload queue** (`src/lib/uploadQueue.ts`). `uploadPhotos` just enqueues and returns; `useUploadTasks(capsuleId)` renders the queue as local-URI **pending tiles** above the photo grid (spinner overlay while uploading; failed tiles get Retry + dismiss). A surprise-mode locked box shows an "N uploading…" line instead of tiles. An effect watches the task count and calls `fetchPhotos()` as each task lands (the queue has already invalidated `media:`/`signedUrls:`/`capsule:` for the capsule). The aggregate "Uploading n/N" row + `ProgressBar` is driven by `uploadQueue.getProgress(capsuleId)`.

**Reactions:** `addReaction()` generates the reaction ID client-side via `randomUUID()` — never chain `.select()` after `.insert()` on the `reactions` table (the SELECT RLS policy may fail even though the insert succeeded, causing the optimistic reaction to disappear). If the user already has a reaction on the media, the existing row is updated (emoji swap) instead of inserting a duplicate — respects the `unique(media_id, user_id)` constraint.

**Cache integration:** on mount, checks `cache.get('capsule:${capsuleId}')` — if cached, renders instantly and fetches fresh in background. `load()` calls `cache.set()` after fetching, and runs `fetchPhotos()` in the same parallel wave (it has no dependency on the capsule/members result). Invalidation: `cache.invalidate('capsules', 'profile')` on delete.

**`fetchPhotos(force?)`** caches three things, each independently:
- `media:${capsuleId}` (3min TTL) — the raw `media` row list itself, so a cache hit skips the DB read entirely, not just the signing step. `force=true` (used by pull-to-refresh) always bypasses it, since another member's upload wouldn't trigger this client's own `cache.invalidate`.
- `signedUrls:${capsuleId}` (50min TTL, under the 1hr signed-URL validity) — batches main + alt keys into one `createSignedUrls()` call.
- `videoThumb:${mediaId}` (6hr TTL) — the locally-generated `expo-video-thumbnails` frame URI, so re-entering the screen doesn't re-decode every video.

**Grid/preview thumbnails use `transformMediaUrl()`** (`src/lib/mediaUrl.ts`), not the full-res `signedUrl` — `MediaItem.thumbSignedUrl` is derived from the already-signed URL with no extra signing round-trip (see "Media URL Transforms" below). The full-screen viewer and `VoteSheet`'s media-voting grid both still fall back to `signedUrl` for anything without a `thumbSignedUrl` (videos use `thumbnailUri` instead).

---

## Media Grid Layout

For equal-width thumbnail rows, use `flex: 1, aspectRatio: 1` — **not** `width: Dimensions.get('window').width / 3`. Dimensions doesn't account for parent padding. Set `gap` on the row container.

"+N more" overlay: count is `photos.length - 2` (not `- 3`) because the overlaid photo is itself not fully visible.

`MediaGalleryModal`: `FlatList` with `numColumns={3}`, `columnWrapperStyle={{ gap: 2 }}`, `ItemSeparatorComponent` for row gaps.

---

## iOS / Web Layout Gotchas

- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `flex: 1` + `aspectRatio`.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — always guard with `Platform.OS !== 'web'`. Use `expo-file-system/legacy` import path.
- `Alert.alert` does not work reliably on web — use inline error state rendered as `<Text>` for errors, and `<ConfirmModal>` (`src/components/ConfirmModal.tsx`) for confirmation dialogs. A multi-button `Alert.alert` silently no-ops on web, so any action gated behind its callback never runs.
- `DateTimePicker` with `display="spinner"` renders the native iOS wheel picker. Use `Platform.OS === 'web' ? 'default' : 'spinner'` for cross-platform.
- Import `SafeAreaView` from `react-native-safe-area-context`, never from `react-native` (the latter is deprecated). For normal screens the provider is supplied by React Navigation's `NavigationContainer`, so no explicit `SafeAreaProvider` is needed. **Inside a React Native `<Modal>` it IS needed** — a `Modal` renders in a separate native view hierarchy the outer provider can't reach, so `SafeAreaView` returns zero insets and content slides under the notch. Wrap the modal's content in its own `<SafeAreaProvider>`.

---

## Theme System

The primary accent color is user-customizable. All app screens use `useTheme()` from `src/context/ThemeContext.tsx` — never hardcode `#FF6B35` in app screens.

```tsx
const { accentColor, setAccentColor, homeLayout, setHomeLayout } = useTheme();
```

`ThemeProvider` wraps `NavigationContainer` in `App.tsx`. It loads `users.accent_color` **and `users.home_layout`** from Supabase on login (one query) and resets both to defaults on logout. `setAccentColor` / `setHomeLayout` update state instantly and persist to Supabase in the background.

**No flash of default orange on launch.** `accentColor`/`homeLayout` used to start at their hardcoded defaults and only update once the Supabase fetch resolved inside a `useEffect` (which runs after first paint) — so every launch briefly rendered the wrong color. Fixed with a persistent per-user cache (`cap_theme_v1:<userId>`), mirroring `sessionStore.ts`'s `readWebSessionSync` pattern:
- **Web:** a synchronous `localStorage` read feeds the `accentColor`/`homeLayout` `useState` lazy initializers directly — since `sessionStore.get()` is already synchronously populated at module load on web, this seeds the real cached color before the very first render, so there's no flash at all.
- **Native:** session restore is async, so the user ID isn't known that early. `loadPrefs` instead does a fast local `AsyncStorage` read (no network, single-digit ms) before the Supabase fetch, applying the cached color almost immediately rather than waiting on the network round-trip.
- `setAccentColor`/`setHomeLayout` write through to this cache too, so a manual change is also available instantly on the next launch. Only fixes it from the *second* launch onward per user — the very first launch after a fresh sign-in has nothing cached yet.

**Home layout preference** (`homeLayout: 'list' | 'grid'`, default `'list'`) — `HomeScreen` renders its capsule `FlatList` as one-column comfortable cards (`list`) or two-column compact cards (`grid`), chosen via a small list/grid toggle in the Home header. The `FlatList` takes `key={homeLayout}` (forces remount when `numColumns` changes) and `columnWrapperStyle` only in grid. `CapsuleCard` takes a `variant` prop; the grid variant drops the description and shrinks. Per-user, synced like `accent_color`.

**Auth screens (LoginScreen, SignUpScreen, WelcomeScreen) keep the static `#FF6B35`** — no user is loaded at that point.

**For StyleSheet.create():** keep `#FF6B35` as a static fallback in style definitions. Apply `accentColor` as an inline override in JSX: `style={[styles.btn, { backgroundColor: accentColor }]}`.

## Design System

Dark theme throughout.

| Token | Value |
|---|---|
| Primary (accent) | `accentColor` from `useTheme()` — default `#FF6B35` |
| Background | `#0A0A0A` |
| Surface | `#1A1A1A` |
| Border | `#2A2A2A` |
| Success | `#30D158` |
| Destructive | `#FF3B30` |
| Text primary | `#FFFFFF` |
| Text secondary | `#888888` |
| Text muted | `#555555` |

Standard border radius: 16 (cards/buttons), 12 (inputs), 10 (pills/badges).
Standard screen padding: 24px horizontal.
Tab bar height: 60px, background `#111111`, top border `#1E1E1E`.

---

## Owner-Only Capsule Actions

All of the following are owner-only and silently no-op / navigate away if not owner — **except Archive**, which any joined member can do (see below):

- **Edit capsule** (`EditCapsuleScreen`) — title, description, unlock date, contribution lock date. Accessible via "Edit" button in CapsuleDetail header and long-press on a card in HomeScreen. Blocked if capsule is already unlocked.
- **Archive / restore capsule** — sets/clears `archived_at`. Hides from main feed; appears in collapsible "Archived" section on Home with a Restore button. **Any joined member can archive or restore, not just the owner** — `CapsuleDetailScreen`'s danger zone gates the button on `canArchive = isOwner || myMember?.joined_at != null` (a pending, not-yet-accepted invitee cannot). Because the blanket `capsules` UPDATE RLS policy is owner-only and covers every column (no column-level exception), this goes through a dedicated `security definer` RPC, **`set_capsule_archived(p_capsule_id, p_archived)`** (`20260706120000_member_archive_capsule.sql`), rather than a direct `.update()` — it authorizes inline (owner OR a `capsule_members` row with `joined_at is not null`) and only ever touches `archived_at`. Both `CapsuleDetailScreen`'s toggle and `HomeScreen.restoreCapsule` call this RPC. `HomeScreen`'s `archivedCapsules` list is derived from `allCapsules`, which is already scoped to joined membership (the underlying query filters `joined_at is not null`) — so no extra owner filter is needed there; any archived capsule a member can see is one they're allowed to restore. **Delete remains owner-only** and still lives in the same danger-zone container, just gated separately (`isOwner`) from the archive button now that the container itself is gated on `canArchive`. `EditCapsuleScreen`'s own Archive button (that screen is still owner-only end-to-end, gated by its `loadCapsule` early-return) was left as a direct `.update()` — unreachable by non-owners anyway since the whole screen bounces them.
- **Delete capsule** — clears storage files from `capsule-media` bucket first, then deletes the capsule row (cascades to members, media, reactions, notifications). Confirmation required via `<ConfirmModal>` (not `Alert.alert` — that no-ops on web). Available from EditCapsule and CapsuleDetail danger zones. Owner-only.
- **Manage members** (`ManageMembersScreen`) — lists all members (joined + pending). Trash icon removes a member after confirmation. Accessible via "Manage" button in CapsuleDetail members section.

## Onboarding (`OnboardingScreen`)

A 5-step personalized flow ("Onboarding v2" — full design rationale in `designs/ONBOARDING_V2.md`) that runs after new sign-ups. Gated by `users.onboarded_at`:
- AppNavigator first checks a **local flag** (`sessionStore.wasOnboarded(userId)`, an `AsyncStorage` boolean keyed per user — see `markOnboarded`/`wasOnboarded` in `src/lib/sessionStore.ts`). If set, routes straight to `'Tabs'` with **no network round-trip** — this used to block first paint on every launch behind a `users.onboarded_at` query (up to a 5s timeout). The flag is written the moment a `users.onboarded_at` query confirms `true`, and again when the wizard itself completes.
- If the local flag isn't set (first launch, fresh install, or genuinely not yet onboarded), falls back to the original behavior: queries `users.onboarded_at`. If null → `initialRouteName = 'Onboarding'`. Otherwise → `'Tabs'` (and the local flag gets written for next launch). On query error or 5s timeout, falls through to Tabs (don't strand the user).
- `users.onboarded_at` remains the server source of truth — the local flag only exists to skip the round-trip for returning users; nothing in the app currently un-sets `onboarded_at`, so a stale-true local flag isn't a real-world risk.
- `saveProfile()` writes `display_name` + optionally `avatar_url` and stamps `onboarded_at = now()`, then calls `sessionStore.markOnboarded(userId)`. It runs at the end of step 3 (both "Create my capsule" and every skip-to-Home path) — so a user killed mid-wizard before step 3 correctly re-enters it, and one who completed step 3 never does.
- Exits use `navigation.replace('Tabs', …)` (no back stack to the wizard). Bio and accent color are **not** collected here anymore — they live in Edit Profile and Settings.

Steps (state machine inside the one screen; dynamic copy comes from `src/lib/onboardingMoments.ts` — the `MOMENTS` matrix keyed on `OccasionKey`, exporting title seeds, date chips, flavor lines, and invite nudges per occasion):
1. **Name + avatar.** Display name required (max 30). Avatar upload **starts in the background the moment it's picked** (`avatarUrlPromise` ref) so a failure isn't discovered at finish-time; `resolveAvatarUrl()` awaits it, retries once, and degrades to a toast (never blocks completion). A live member-row preview chip renders the name/avatar as they type.
2. **"What are you waiting for?"** Six moment cards (mapping 1:1 to `capsules.occasion`) + an optional 60-char free-text line. Tapping a card advances immediately; typed free text **becomes the capsule title verbatim** (always beats the seed — never rewrite the user's words). Skip → `skipToHome()`.
3. **First capsule, pre-built.** A capsule card with inline-editable title, occasion-aware date chips (first chip pre-selected) + "Pick my own date" (expands the shared `DatePickerField`), and a surprise-mode promise line. "Create my capsule" runs `saveProfile()` then the standard RLS-safe create (client UUID → `capsules` insert without `.select()` → owner `capsule_members` row → `set_default_superlatives` best-effort). Always `owner_preview_locked: true`, `unlock_mode: 'time'`, 48h voting.
4. **Notification primer** (forward-only, reached only when a capsule was created). Names the user's capsule + date; "Yes, notify me" calls `requestPushPermission` (the app's only native-prompt call site); "maybe later" sets the `cap_notif_reprime:<userId>` AsyncStorage flag. On web the button is copy-only ("Sounds good").
5. **Sealed ceremony** (forward-only). Lock scale-in + `haptics.success()` + live countdown (30s tick). Actions: **Invite people** (`Share.share` of the `capsule://join/<id>` link; on failure/web falls back to navigating into the capsule where the full invite UI lives), **Add the first photo** (→ Camera tab), or "take me home".

Footer only exists for steps 1–3 (`Back` from 2–3; contextual `Next`/skip). Steps 4–5 render their own primary actions in-body. Don't render placeholder `<View>`s for missing footer buttons or they'll consume row width.

## Settings Screen (`SettingsScreen`)

Wraps the shared `<ColorPicker>` from `src/components/ColorPicker.tsx`. Tracks a `pending` color (local state) so the user can preview/cancel before committing. Save writes to `users.accent_color` via `ThemeContext.setAccentColor` and navigates back. The original color is passed as `originalValue` to show a small "before" swatch.

## ColorPicker (`src/components/ColorPicker.tsx`)

Controlled component. Props: `{ value: string; onChange: (hex) => void; originalValue?: string }`. Internals:
- 2D saturation/brightness panel: two stacked `LinearGradient`s (white→hue horizontal, transparent→black vertical)
- Hue slider: full-spectrum `LinearGradient` strip
- Touch via `onStartShouldSetResponder` / `onResponderMove` — `locationX`/`locationY` from `nativeEvent` are relative to the touched view (no page coordinate math needed)
- Hex input for precision — updates the HSV state on valid 6-char hex
- Exports `hsvToHex(h, s, v)` and `hexToHsv(hex)` for callers that need raw conversions

## ConfirmModal (`src/components/ConfirmModal.tsx`)

Cross-platform confirmation dialog — **use instead of `Alert.alert` for any confirm/cancel decision**, because a multi-button `Alert.alert` silently no-ops on web (the destructive action gated behind its callback never runs).

Controlled component. Props: `{ visible, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel }`. Renders a transparent `Modal` with a dark-theme card. `destructive` colors the confirm button `#FF3B30`; `loading` swaps the confirm label for a spinner and disables both buttons. The caller owns the `visible` state and the async work — keep `visible` true and `loading` true while the action runs, then close. Used for delete confirmation in `EditCapsuleScreen` and `CapsuleDetailScreen`.

## Unlock Cron (`supabase/functions/unlock-capsules`)

Edge function that marks `status = 'active'` capsules whose `unlock_at <= now()` as `'unlocked'` and sends Expo push notifications to all joined members. Only acts on `unlock_mode = 'time'` capsules — `proximity`/`both` capsules unlock via the `check_in` RPC instead (see Proximity Unlock).

- **Trigger:** `pg_cron` job `unlock-capsules` runs `* * * * *` (every minute).
- **Countdown reminders:** the same function also fires pre-unlock reminder pushes at three tiers — **1 day / 1 hour / 10 minutes** before `unlock_at` (`dispatchReminders`, runs every tick regardless of whether anything unlocked). For each tier it does an atomic `update({ <tier>_sent_at: now }).is(<tier>_sent_at, null).gt('unlock_at', now).lte('unlock_at', now + tier).select()` — claiming+stamping in one statement so a tier sends **at most once** per capsule (race-safe). Stamp columns: `capsules.unlock_reminder_{1d,1h,10m}_sent_at` (migration `20260616000000_unlock_reminders.sql`). It inserts durable `unlock_reminder` notification rows (new type; `pushed_at` set since it pushes inline) and posts the Expo push. Body copy is derived from *actual* remaining time (`formatRemaining`), so it reads correctly ("tomorrow" / "in about 3 hours" / "in 10 minutes") even for short-lived capsules that enter a tier late. `time`-mode only, same as unlocking. Client renders `unlock_reminder` in `NotificationsScreen` (hourglass icon, taps through to the capsule).
- **Auth:** `Authorization: Bearer <CRON_SECRET>` required (`if (CRON_SECRET && auth !== ...)` in the function). The function's `CRON_SECRET` env var is set in Supabase Dashboard → Functions → unlock-capsules → Secrets. The matching value is also stored in Supabase Vault as `cron_unlock_capsules_secret`, and the cron command reads it at execution time via `(select decrypted_secret from vault.decrypted_secrets where name = 'cron_unlock_capsules_secret')`.
- **Idempotency:** the `.eq('status', 'active')` filter means repeat calls within a minute don't re-unlock or re-notify. The in-memory rate-limit (`lastCallTime`) in the function is dead code on edge runtimes — it doesn't survive cold starts — but doesn't matter because the work is idempotent.
- **Rotating the secret:** update Vault (`select vault.update_secret(secret_id, new_value)`) AND set the new value on the function's env vars. Order doesn't matter for safety — the function uses module-load env, so a redeploy is needed for the function to pick up the new value (deploying the same code via `mcp__supabase__deploy_edge_function` works).

## Proximity Unlock

A capsule's `unlock_mode` (`time` | `proximity` | `both`) controls how it opens:
- `time` — unlocks on `unlock_at` via the `unlock-capsules` cron (the original behavior).
- `proximity` — unlocks when all joined members are physically together.
- `both` — requires the date to have passed **and** members to be together.

**`check_in(p_capsule_id, p_lat, p_lng)` RPC** (`SECURITY DEFINER`) — a member calls it with their current GPS location. It records the location on their `capsule_members` row (`checkin_lat/lng/at`), then unlocks the capsule if every joined member has checked in within the last 10 minutes and the largest distance between any two of them is `<= proximity_radius_m` (default 100m). It's `SECURITY DEFINER` so any joined member — not just the owner — can trigger the unlock; it authorizes inline (caller must be a joined member). Returns `{ unlocked, checked_in, total, within_range }`. Distance is computed by the `_haversine_m` helper.

**Check-in UI** — `CheckInCard` (`CapsuleDetailScreen`) renders for locked `proximity`/`both` capsules in place of / alongside the `CountdownRing` (proximity-only hides the ring; `both` shows both). It has a "We're here — check in" button that requests foreground location via `expo-location`, calls `supabase.rpc('check_in', …)`, and shows `N of M here` progress. The capsule's realtime channel fires the reveal animation for everyone when the last check-in flips `status` to `unlocked`.

**Unlock-mode picker** — `CreateScreen` and `EditCapsuleScreen` have an "Unlock When" selector (Date / Together / Both). Choosing Proximity hides the unlock-date field and skips its validation; `unlock_at` is `not null` so it still gets a placeholder value (unused for `proximity`).

## Surprise Mode (`capsules.owner_preview_locked`)

Addresses the complaint that the creator could peek at a capsule's contents before unlock. When `owner_preview_locked = true`, **the owner is locked out of viewing media exactly like everyone else** until `status = 'unlocked'` — they can still upload, see the member list, and a "N memories waiting" count, but no thumbnails/viewer.

- **Default ON for new capsules** (`default true`). Migration `20260618000000_owner_preview_lock.sql` backfilled all **pre-existing** capsules to `false` so their owners keep the old preview behavior.
- **Creation-only.** `CreateScreen` has a "Keep it a surprise" `Switch` (default on) that sets the column at insert. There is **no toggle in `EditCapsuleScreen`** — by design, so an owner can't flip it off right before unlock to peek. (The DB owner-UPDATE policy still technically allows changing the column; the client just never exposes a control.)
- **Server-side enforcement (RLS).** The `media` SELECT policy gates pre-unlock reads on `cm.role in ('owner','contributor') AND NOT c.owner_preview_locked`. So the owner genuinely can't read media rows (and thus can't obtain `storage_key`s to sign URLs) while locked — not just a client-side hide.
- **The count comes from a SECURITY DEFINER RPC** `capsule_media_count(p_capsule_id)` (joined-member-authorized, returns 0 for non-members) because RLS now hides the rows themselves. `CapsuleDetailScreen.fetchPhotos` calls it into `mediaCount` state; the locked box renders `mediaCount` (not `photos.length`, which is empty under the lock).
- **Client gate:** `canSeePhotos = !isLocked || (isOwner && !capsule.owner_preview_locked)`.

## Superlatives (Awards)

Per-capsule, yearbook-style awards. Members suggest categories; once enough upvote a suggestion it auto-promotes to live; voting opens when the capsule unlocks and runs for an owner-configured window; winners are revealed when the window closes.

### Lifecycle
- **suggest** — any joined member calls INSERT on `superlative_categories` with a label (3–80 chars) and `target_type ∈ {'person','media'}`. RLS verifies `suggested_by = auth.uid()`, capsule membership, and `status = 'pending'`. An AFTER INSERT trigger (`notify_on_superlative_suggested`) inserts `superlative_suggested` notification rows for every other joined member.
- **upvote** — members INSERT into `superlative_upvotes`. The `_promote_superlative` trigger reads the current upvote count + joined-member count; if `count >= ceil(joined/2)` it flips the category's status to `live`. SECURITY DEFINER bypasses the "owner only" UPDATE policy.
- **vote** — members upsert into `superlative_votes` keyed on the composite PK `(category_id, voter_id)`. RLS enforces: voter is self, no self-vote (`target_user_id <> auth.uid()`), category is `live`, voting window is open, and the target row belongs to the category's capsule + matches its `target_type` (checked via the `_superlative_target_valid` helper). Voters can update or delete their own row until the window closes.
- **finalize** — when `now() >= superlative_voting_closes_at` the `close_superlative_windows()` cron picks up the capsule and calls `finalize_capsule_superlatives()`: computes winners with `rank() = 1` (ties = co-winners), archives any pending suggestions that never crossed the threshold, sets `superlative_voting_finalized_at`, and inserts `superlative_won` notification rows for winning members (and uploaders of winning media).

### Voting window
- `capsules.superlative_voting_hours` (1–720, default 48) — owner picks this on Create / Edit via `<VotingWindowPicker>`.
- `_stamp_unlock_meta` BEFORE UPDATE trigger stamps `superlative_voting_closes_at = unlocked_at + voting_hours` the moment status flips to `unlocked`. Works for both the time-cron and the proximity `check_in` path.
- 2 hours before close, `dispatch_superlative_closing_soon()` fans out `superlative_closing_soon` notifications and stamps `superlative_closing_soon_sent_at` so it fires once.

### RLS + anonymity
- `superlative_categories` — members read; members insert (only `status = 'pending'`); owner can update / delete.
- `superlative_upvotes` — members read and upvote pending categories; voters can remove their own upvote.
- `superlative_votes` — **the voter can only read their own rows**. Aggregated counts come from `tally_superlatives(capsule_id)` — a SECURITY DEFINER RPC that returns `(category_id, target_*, vote_count)` rows but only after `now() >= voting_closes_at`. This is what makes the "tallies hidden during voting" rule enforceable on the server.
- `superlative_winners` — read-only for members; writes happen only via `finalize_capsule_superlatives`. The reveal UI reads from this table directly, not from `tally_superlatives`.

### Notifications + push
Three new notification types: `superlative_suggested`, `superlative_closing_soon`, `superlative_won`. All three:
1. Are inserted by a trigger or by the finalize/dispatch functions (rows are durable; the in-app `NotificationsScreen` reads them).
2. Are delivered as Expo pushes by the `send-superlative-pushes` edge function, which the cron pings every minute via `net.http_post`. The function pulls notifications where `pushed_at IS NULL AND type IN (...)`, builds per-type Expo payloads with `data.capsuleId`, posts to `exp.host` (chunked ≤100/request — see Push Notifications), and stamps `pushed_at` so retries can't double-send. **The `users` embed in its select MUST be FK-qualified (`users!notifications_user_id_fkey(push_token)`)**: `notifications` has two FKs to `users` (`user_id` and `actor_id`, the latter added by the friends feature), so a bare `users(...)` embed is ambiguous and PostgREST errors — which surfaces as a silent 500 that, combined with the EXISTS-gated cron, made the function 500 every minute and never clear its backlog. Any new server-side `notifications`→`users` embed must pick the FK the same way (`NotificationsScreen` already does, via `actor:users!notifications_actor_id_fkey`).
3. Tap routing: the native push handler already routes any `data.capsuleId` to `CapsuleDetail`; `NotificationsScreen` does the same on tap.

The unlock push body is intentionally worded to double as the "voting opens" cue — no separate notification is sent for that moment.

### Cron job
`close-superlative-windows` runs `* * * * *` and executes three statements in sequence each minute:
```sql
select public.dispatch_superlative_closing_soon();
select public.close_superlative_windows();
select net.http_post(... send-superlative-pushes ...);
```
The HTTP call uses the same Vault secret (`cron_unlock_capsules_secret`) as the unlock cron. Both edge functions must have `CRON_SECRET` env vars set to the matching plaintext.

### Client integration
- `<AwardsSection>` lives in `CapsuleDetailScreen` under the media grid, only on unlocked capsules. It branches on `voting_closes_at` / `voting_finalized_at`:
  - **voting open** — pending cards with upvote button + progress bar to threshold, live cards with Vote / Change pill
  - **voting closed, pre-finalize** — `"Tallying votes…"` placeholder
  - **finalized** — staggered `WinnerCard` reveals (avatar for person, thumbnail for media; tied co-winners side by side)
- Realtime subscription on `superlative_categories` (filtered to capsule) drives upvote / auto-promote updates. A second subscription on `superlative_winners` INSERTs drives the finalize → reveal transition.
- The parent's existing realtime channel on `capsules` UPDATEs catches `superlative_voting_finalized_at` flipping and re-renders the section with the new props.

### Gotchas
- The voter's own vote IS readable client-side (so "Your vote: X" works). Anonymity is about *other* voters — tallies for them route through the time-gated RPC or the winners table.
- `finalize_capsule_superlatives()` is idempotent: `if v_finalized_at is not null then return`. The cron can hit a capsule multiple times safely.
- When tying capsules' realtime to the section, the parent's `capsule` state must be passed as props (`votingClosesAt`, `votingFinalizedAt`) — the section can't subscribe to capsule changes itself because that's the parent's responsibility.
- The auto-promote trigger checks `status = 'pending'` before flipping, so concurrent upvotes can't promote twice.

### Default Awards

A second, parallel path to `live` alongside the suggest→upvote flow above: every capsule can have up to **4 predetermined ("default") awards**, themed by the capsule's `occasion`, inserted already `status = 'live'` — no suggest/upvote gauntlet. Member suggestions still work exactly as described above and coexist with the defaults.

- **`capsules.occasion`** (`wedding` / `vacation` / `party` / `baby` / `milestone` / `general`, default `'general'`) — picked via a chip row on `CreateScreen` (no equivalent in `EditCapsuleScreen` — occasion is creation-only, like `owner_preview_locked`). Chosen purely to select which themed pool `src/lib/awardPool.ts` draws from; carries no other behavior.
- **`src/lib/awardPool.ts`** — pure client-side module (no network calls, since the Create-screen preview happens before the capsule exists): `AWARD_POOL: Record<OccasionKey, PresetAward[]>` (~10 awards per occasion, mixed person/media, themed — sentimental for wedding/baby, playful for vacation/party, reflective for milestone), `pickDefaults(occasion, count=4, exclude=[])` (shuffles + samples, tops up with repeats only if the pool minus exclusions is too small), `pickReplacement(occasion, currentLabels)` (single-slot swap, excludes the other current labels).
- **`set_default_superlatives(p_capsule_id, p_awards jsonb)` RPC** (`security definer`) — the only way a default award reaches `status = 'live'` (the suggest-INSERT RLS policy still forces `status = 'pending'` for client inserts, so this can't be done through a plain `.insert()`). Authorizes inline: caller must be `capsules.owner_id` (checked with `is distinct from`, not `<>` — a null `auth.uid()` must not silently bypass the check) and the capsule must not be `status = 'unlocked'`. **Full-replace, not incremental**: every call deletes the capsule's existing `is_default` rows and re-inserts the given array — safe pre-unlock since no votes can exist yet. Caps the array at 4, re-validates label length (3–80) and `target_type` server-side even though the client already validates.
- **`notify_on_superlative_suggested`** early-returns when `NEW.is_default` — seeding/reshuffling defaults never fans out `superlative_suggested` notifications the way a real member suggestion does.
- **`src/components/DefaultAwardsCard.tsx`** — one presentational component, two modes, discriminated by a `mode` prop:
  - `mode="preview"` (`CreateScreen`) — fully controlled; the parent owns the `awards` array (seeded via `pickDefaults(occasion)`, re-seeded whenever the occasion chip changes) and passes `onChange`. Nothing is persisted until the capsule itself is created.
  - `mode="manage"` (`CapsuleDetailScreen`, pre-unlock only) — owns its own state: fetches the capsule's current `is_default` rows on mount, and every shuffle/swap/remove calls `set_default_superlatives` directly (optimistic update, rolls back on error).
  - Both modes render the same 4 award chips with per-slot swap (↻) and remove (×) controls plus a "Shuffle all" button.
- **`CreateScreen.handleCreate`** calls the RPC once, right after the owner `capsule_members` insert succeeds (non-fatal on error — the capsule is already usable, and the owner can still seed defaults from the capsule page).
- **`CapsuleDetailScreen`** renders `<DefaultAwardsCard mode="manage">` only when `isOwner && isLocked` — this is the owner's only chance to review/regenerate the defaults, since `<AwardsSection>` itself is unlocked-only and the RPC refuses changes post-unlock. Once unlocked, default awards are indistinguishable from member-suggested ones in `AwardsSection` — they're just ordinary `live` categories that happen to have `is_default = true`.
- **`fetchAwardsData`** (`src/lib/awardsData.ts`) selects `is_default` alongside the other category columns so it's available to any future UI that wants to badge defaults differently, though `AwardsSection` doesn't currently render on it.

---

## Content Moderation (Report + Block)

UGC compliance for Apple App Store Guideline 1.2. Scope is **report + block**; EULA-at-signup and an admin review console are deferred.

**Tables** (migration `20260609230500_add_reports_and_blocks.sql`):
- `content_reports` — a user files a report against a `media` item or a `user`. RLS: insert as self, read only your own rows. There is **no** client review path — reports are triaged out-of-band with the service role. CHECK constraints enforce exactly-one target matching `target_type` and no self-report.
- `blocked_users` — directional `(blocker_id, blocked_id)` block. Owner-only RLS on all of select/insert/delete, so the blocked party can never tell they were blocked.

**Block enforcement is client-side filtering** (not RLS — chosen for speed; can be hardened later):
- `src/lib/blocks.ts` — `blockStore`: module-level `Set` of blocked IDs with pub/sub, optimistic `block()`/`unblock()` (ignores `23505` duplicate), `refresh()`, `clear()`. `blockStore.has(id)` is the filter primitive; readable synchronously from non-component code (e.g. `fetchPhotos`).
- `src/hooks/useBlockedUsers.ts` — `useBlockedUsers()` returns the reactive set; refreshes on mount, re-renders on any block change.
- `useAuth` warms `blockStore.refresh()` on `SIGNED_IN`/`INITIAL_SESSION` and calls `blockStore.clear()` on `SIGNED_OUT` (alongside `cache.clear()`).
- Filter sites: `CapsuleDetailScreen.fetchPhotos` drops blocked uploaders' media; `MediaViewerModal.loadReactions` drops blocked users' reactions; the `InviteModal` search excludes blocked users. The parent re-runs `fetchPhotos` when `useBlockedUsers()` changes (skipping the first run).

**Report UI** — `src/components/ReportModal.tsx`, a reusable controlled modal (reason radio list + optional ≤500-char details). Entry points: the **flag icon in `MediaViewerModal`'s header** (`targetType="media"`, passes `capsuleId`) and an **overflow `⋯` menu in `PublicProfileScreen`'s nav bar**. The `⋯` opens a small fade-in popup (tap-outside to dismiss) with **Report** and **Block/Unblock**; block goes through `ConfirmModal`. A blocked profile hides the Invite button and shows a notice.

---

## Friends

Explicit friend requests (`friendships` table). Previously "friends" was *derived* from shared capsule membership; it's now an accept/request relationship. Invites to capsules remain open to **anyone** — friends are just a convenience shortcut, not a gate.

- **Data layer** `src/lib/friends.ts` — `getFriendStatus(id)` → `'none' | 'friends' | 'incoming' | 'outgoing'`; `sendFriendRequest` / `acceptFriendRequest` / `removeFriendship` (one delete covers cancel/decline/unfriend); `listFriends` / `listIncomingRequests` / `listOutgoingRequests` (embed the *other* party's profile via the named FK, e.g. `users!friendships_requester_id_fkey`); `countFriends`. The unordered-pair `.or()` filter is `and(requester_id.eq.X,addressee_id.eq.Y),and(requester_id.eq.Y,addressee_id.eq.X)`. 23505 (duplicate pair) is treated as success.
- **`PublicProfileScreen`** — a friend button that adapts to the status (`Add Friend` → `Requested`/tap-to-cancel → `Accept Request` + `Decline` → `Friends`). **Unfriend** lives in the `⋯` overflow menu (alongside Report/Block). Status is fetched on mount.
- **`FriendsScreen`** (`AppStack` route `Friends`, opened by tapping the **Friends stat on `ProfileScreen`**) — a Requests section (Accept/Decline) + a Friends list (row → `PublicProfile`). The Profile `Friends` stat now counts accepted friendships via `countFriends()` (cache key `profile`; invalidate on accept/unfriend).
- **Alerts tab** (`NotificationsScreen`) — `friend_request` rows render with inline **Accept/Decline** (act on `friendships` via `actor_id`, then mark the notification read); `friend_accept` rows tap through to the actor's profile. The notifications query embeds `actor:users!notifications_actor_id_fkey(...)`.
- **Capsule invite search** (`InviteModal` in `CapsuleDetailScreen`) — a **Friends / Search** tab toggle. Friends tab lists accepted friends not already members (and not blocked); Search is the existing username search. Both use the same `invite()`.
- **Not built (deferred):** remote push for friend events — `friend_request`/`friend_accept` create durable in-app notifications only; no Expo push is sent yet.

---

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`. Use this instead of `crypto.randomUUID()` — `crypto` global is not reliably typed in the Expo TS config.
- `src/lib/haptics.ts` — `haptics.{light,medium,heavy,selection,success,warning,error}()`. Central wrapper over `expo-haptics`; no-ops on web and swallows errors so call sites need no platform guard. **Use this for all tactile feedback** rather than importing `expo-haptics` directly. Wired into: tab bar taps (light; camera button medium), camera shutter (medium), reactions (light), notification accept (success) / decline (light), Home layout toggle (selection). `DatePicker` predates it and still calls `expo-haptics` directly.
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor, homeLayout, setHomeLayout }`. `ThemeProvider` must wrap the app.
- `src/lib/sessionStore.ts` — `sessionStore.get()` / `sessionStore.set()`. Module-level session cache, updated by `useAuth` on every `onAuthStateChange` event. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()` inside screens.** `getSession()` on web hangs when the access token is expired because it blocks on an internal refresh network call. `sessionStore.get()` is synchronous and never hangs.

## Cache System (`src/lib/cache.ts`)

In-memory cache (lost on cold start — no persistence) with TTL, key-based invalidation, and pub/sub listeners. Reduces loading times by showing cached data instantly while fetching fresh data in the background.

- `cache.get<T>(key, ttl?)` — returns cached data or null if expired (default 15 min TTL)
- `cache.set<T>(key, data)` — stores data with timestamp
- `cache.invalidate(...keys)` — deletes entries and notifies all subscribers for those keys
- `cache.subscribe(key, fn)` — returns unsubscribe function; used by `useCachedFetch` for cross-screen reactivity
- `cache.clear()` — wipes entire cache (called on sign out via `useAuth`)

**`useCachedFetch<T>(key, fetcher, deps)`** (`src/hooks/useCachedFetch.ts`) — returns `{ data, loading, refresh }`. On screen focus: if `cache.get(key)` is still fresh (within TTL), renders instantly **and skips the network call entirely** — the TTL governs every focus, not just the first render. On a miss/expiry, fetches and shows a loading state. `refresh()` always force-fetches regardless of TTL. Subscribes to cache invalidation: when another screen invalidates the key, **keeps showing current data** (no blank-then-reload flash) while refetching in the background. Concurrent fetches for the same key are deduped via a module-level in-flight registry — e.g. if `cache.invalidate('capsules')` fires while three components are subscribed to that key, only one network call goes out, not three.

Not every cache consumer uses this hook — `CapsuleDetailScreen` and `AwardsSection` hand-roll the same "check `cache.get` for instant render, then fetch in the background" pattern directly, because both have local optimistic-update state (reactions, upvotes) that the hook's read-only `data` can't accommodate.

**Cache keys in use:**
- `capsules` — HomeScreen capsule list
- `capsule:${id}` — per-capsule detail data (capsule row + members)
- `media:${id}` — per-capsule raw `media` row list (3min TTL; separate from the signed-URL cache below so a cache hit skips the DB read, not just the signing step)
- `signedUrls:${id}` — per-capsule signed URLs, batched (50min TTL, under the 1hr signed-URL validity)
- `videoThumb:${id}` — per-media locally-generated video thumbnail frame (6hr TTL — a local file URI, not server-expiring)
- `awards:${id}` — per-capsule superlatives categories + winners (AwardsSection, hand-rolled, not via the hook)
- `profile` — ProfileScreen hero card data
- `notifications` — NotificationsScreen. **The Alerts tab badge (`CustomTabBar` in `AppNavigator.tsx`) also reads this key** (PERFORMANCE.md #11): it `cache.subscribe`s to `notifications` and sets the unread count from the cached (grouped) list's length, so the badge updates the instant a notification is read/dismissed/received — no throttled per-tab-switch query, no up-to-60s stale lag (BUGS.md #10). It falls back to a lightweight `count/head` query only when the cache is empty (cold start before Alerts is visited, or right after an invalidate). Because the cached list is *grouped* (reactions collapse into one card), the badge shows the grouped-unread count, capped at "9+".
- `group:${id}`, `group-members:${id}`, `group-capsules:${id}`, `groups` — GroupDetailScreen / HomeScreen groups section. `listMyGroups`/`getGroup` (`src/lib/groups.ts`) fetch `memberCount` via a PostgREST embedded `group_members(count)` aggregate in the *same* query (PERFORMANCE.md #6) — one round-trip, no member-row payload, instead of a second query that pulled every member row just to count them.

**Invalidation pattern:** screens that mutate data call `cache.invalidate()` with all affected keys. Example: creating a capsule invalidates `capsules` and `profile` (stats changed). Uploading/deleting media or a capsule unlocking invalidates both `signedUrls:${id}` and `media:${id}` together — invalidating only the signed-URL cache while `media:${id}` is one mutation site is not enough.

## Background Upload Queue (`src/lib/uploadQueue.ts`)

Module-level sequential upload worker — the optimistic-UI backbone for media.
Callers `uploadQueue.enqueue(entries)` and move on; the queue uploads one task
at a time (web: arrayBuffer + `supabase.storage.upload`; native:
`FileSystem.uploadAsync` via `getFreshAccessToken()`), inserts the `media` row
(including dual-photo `alt_storage_key`, best-effort), and invalidates
`capsules` + `capsule:`/`media:`/`signedUrls:` per success. Failures stay in
the queue as `status: 'failed'` tasks — `retry(id)` / `dismiss(id)` — rendered
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

## Retry on slow loads (`useLoadingTimeout` + `RetryPrompt`)

Every screen that fetches data on mount/focus shows a retry affordance if loading
takes longer than 8 seconds, instead of an indefinite spinner/skeleton (RN's
`fetch()` has no default timeout — a dead connection can hang 30s-2min).

- **`src/hooks/useLoadingTimeout.ts`** — `useLoadingTimeout(loading, timeoutMs = 8000)` returns `{ timedOut, reset }`. Arms an 8s timer whenever `loading` is `true`; clears it and resets `timedOut` to `false` the moment `loading` goes `false`. Exposes `reset()` because a retry tap doesn't produce a `loading: false→true` edge (the fetch just restarts under the same `true`) — **every `onRetry` handler must call `reset()` before kicking off the new fetch**, or the timeout will never re-arm on a second hang. This is the one detail to double-check when wiring a new screen.
- **`src/components/RetryPrompt.tsx`** — `{ onRetry, message?, compact? }`. Renders inline (not a modal/popup) — a message + a "Retry" button styled with dark-theme tokens and `accentColor` from `useTheme()`. `compact` shrinks padding/text for small inline contexts (`AwardsSection`'s `loadingBox`, `PublicProfileScreen`'s `InviteToCapsuleModal`); the default (non-compact) fills the screen like the skeleton it replaces.
- **Wiring pattern:** `if (loading) { if (timedOut) return <RetryPrompt onRetry={...} />; return <...skeleton...>; }` — the retry prompt **replaces** the skeleton/spinner rather than showing alongside it.
- **`useCachedFetch`'s `refresh` takes an optional `force` param** (`refresh(force?: boolean)`) specifically for this: the hook dedupes concurrent fetches per key via a module-level in-flight registry, so calling `refresh()` on a genuinely hung fetch would just re-await the same stuck promise. `refresh(true)` discards the stale in-flight entry first so a real new request fires. Every retry handler on a `useCachedFetch` screen calls `refresh(true)`, never bare `refresh()`.
- **Hand-rolled (non-hook) screens** just call their own fetch function again on retry, but **must replicate however that function currently clears its `loading` state** — some fetch functions clear it internally (`AwardsSection.fetchCategories`, `FriendsScreen.load`), others rely on the caller chaining `.finally(() => setLoading(false))` (`ManageMembersScreen.fetchMembers`, `PublicProfileScreen.load`, `EditCapsuleScreen.loadCapsule`). Check before assuming.
- **Applied to:** HomeScreen, NotificationsScreen, ProfileScreen, GroupDetailScreen (primary `groupLoading` gate only — the secondary `capsulesLoading` `ListEmptyComponent` spinner is non-blocking and deliberately left out), CapsuleDetailScreen (cold-load skeleton only — the warm-cache path already shows content instantly and refreshes silently in the background, so there's no visible loading UI to attach a retry button to), AwardsSection, FriendsScreen, EditCapsuleScreen, ManageMembersScreen, PublicProfileScreen + its nested `InviteToCapsuleModal`.
- **Not touched:** `LoadingBrandScreen`'s use in `AppNavigator.tsx`'s onboarding/route-resolution gate — that's a different kind of "loading" (route resolution, not a data-fetch-on-mount screen) and already has its own 5s timeout fallback to `Tabs`.

## DatePicker (`src/components/DatePicker.tsx`)

Shared date/time picker used by `CreateScreen` and `EditCapsuleScreen`. Controlled component.

Props: `{ label, value, onChange, optional?, contextLabel? }`.

- Collapsed state shows the selected date/time with a "change" link; tapping expands inline
- Quick preset buttons: "In 1 month", "In 3 months", "In 6 months", "In 1 year"
- **Custom calendar grid** (no external library):
  - Day view: 7-column grid, accent-colored circle on selected day, accent border on today, past days dimmed (#333)
  - Tappable month/year header ("June 2026 ▼") switches to month picker mode
  - Month picker: 4×3 month grid with year navigation arrows (◀ ▶)
- Collapsible time row with native `DateTimePicker` (spinner on iOS, default on web)
- `contextLabel` shows a live preview sentence below the picker (e.g. "Capsule unlocks for everyone on Jun 30, 2026 at 3:00 PM")
- `optional` prop adds an "enabled" toggle — when off, `onChange(null)` is called
- **Haptics** via `expo-haptics`: Light impact on day/month select and quick presets; Selection feedback on month/year navigation arrows. All no-op on web.

## Animations (`src/lib/animations.ts`)

Reusable entrance animation hooks using the built-in `Animated` API (no `react-native-reanimated`).

- `useFadeIn(delay?, duration?)` — opacity 0→1
- `useSlideUp(delay?, duration?)` — opacity 0→1 + translateY 20→0
- `useListItemEntrance(index, baseDelay?)` — staggered fade+slide for list items (60ms per item, caps at index 8)

All three hooks use `useIsFocused()` from React Navigation, but only play the entrance animation **once per screen instance** (a `hasAnimatedRef` guard) — on the first focus after mount. On every subsequent re-focus (e.g. switching tabs back to an already-mounted screen), values snap directly to their final state instead of resetting and replaying; data from `useCachedFetch` is typically already instant on a re-focus, so replaying a ~300–780ms entrance animation on top of it just made already-fast navigation look slow. A genuine unmount+remount (e.g. pushing a new stack screen) still gets the full entrance animation, since `hasAnimatedRef` lives with the component instance.

**Rules of Hooks:** these hooks must be called before any early returns (e.g. `if (loading) return <Skeleton />`). Moving them after an early return causes "Rendered more hooks than during the previous render" errors.

**Screen transitions** configured in `AppNavigator.tsx`:
- Tabs/Onboarding: `animation: 'fade'`
- Settings: `animation: 'slide_from_bottom'`
- Preview: `animation: 'none'` (instant camera preview)
- All others: default `slide_from_right`

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

## Skeleton Loaders (`src/components/Skeleton.tsx`)

Shimmer-animated loading placeholders for screens that use `useCachedFetch`.

- `SkeletonBox` — base component with configurable width, height, borderRadius; uses `Animated.loop` with `interpolate` for shimmer
- `SkeletonCard` — capsule card placeholder for HomeScreen
- `SkeletonProfileCard` — hero card placeholder matching ProfileScreen layout (glow bar, avatar circle, name/bio/stats, action rows)
- All use dark theme colors (`#1A1A1A` base, `#2A2A2A` shimmer highlight)

## Profile Screen (`ProfileScreen.tsx`)

Hero card design with accent-colored glow:
- 3px accent glow bar at top of card, avatar ring with accent border
- Stats row: Capsules, Unlocked, Friends — counts fetched from `capsule_members` with joins
- Action rows: Edit Profile (opens inline modal), Appearance (navigates to Settings)
- Sign out as a text link at bottom
- Uses `useCachedFetch<ProfileData>('profile', ...)` — skeleton shown on first load only

## Sign-Up Flow

`SignUpScreen` collects only email and password — **no display name**. The `handle_new_user` trigger creates the `users` row with `display_name = null`. Display name is collected in Onboarding Step 1 (the first screen after sign-up). This avoids asking for the name twice.

## Web Auth Gotchas

`supabase.auth.getSession()` on web hangs indefinitely when the stored access token is expired and the refresh network call is slow or blocked. The Supabase internal `initializePromise` does not resolve until the refresh completes, so both `getSession()` and the `INITIAL_SESSION` auth event can be blocked simultaneously.

**Pattern to use everywhere:**
```ts
// WRONG — hangs on web if token is expired
const { data: { session } } = await supabase.auth.getSession();

// RIGHT — reads cached session set by onAuthStateChange, synchronous
import { sessionStore } from '../../lib/sessionStore';
const session = sessionStore.get();
```

`sessionStore` (`src/lib/sessionStore.ts`) seeds itself synchronously on web by reading Supabase's `sb-<projectRef>-auth-token` entry from `localStorage` at module load. This means `sessionStore.get()` returns the persisted session before Supabase has finished its async init — so the app never has to wait on `initializePromise`.

`useAuth` (`src/hooks/useAuth.ts`) uses that synchronous seed: on web, `loading` starts as `false` and the initial `session` comes straight from `sessionStore`, so the root spinner never blocks. On native, a 1.5s fallback timeout forces `loading` off in case SecureStore-backed init lags. `onAuthStateChange` then updates state when Supabase eventually catches up.

**Push notifications on web:** `expo-notifications` triggers side effects at import time that warn on web. Solved with platform-specific files:
- `usePushNotifications.native.ts` — full implementation (native only)
- `usePushNotifications.web.ts` — no-op stub (web)
- `usePushNotifications.ts` — no-op stub (TypeScript resolution fallback)

**Shadow props on web:** `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset` are deprecated in React Native Web. Wrap in `Platform.select({ default: { shadow... }, web: {} })` applied as an inline style override, and remove from `StyleSheet.create`.

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

App config: `app.json`. Bundle ID: `com.markdickson.capsule`. EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`.

**EAS build profiles** (`eas.json`):
- `production` — iOS: `simulator: false`, `autoIncrement: true` (bumps `buildNumber` each build). `appVersionSource: "remote"` so version is managed by EAS, not `app.json`.
- No `preview` profile defined yet — Android preview APKs use `eas build --profile preview` with the default config.

**TestFlight deployment:**
```bash
eas build --platform ios --profile production   # Build the binary
eas submit --platform ios --profile production  # Submit to App Store Connect / TestFlight
```
