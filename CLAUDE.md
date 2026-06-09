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
src/
  components/
    AwardsSection.tsx        # Superlatives UI inside CapsuleDetail — voting open / tallying / finalized cards
    ColorPicker.tsx          # HSV picker (SV panel + hue slider + hex input), controlled, reusable
    ConfirmModal.tsx         # Cross-platform confirmation dialog — use instead of Alert.alert
    DatePicker.tsx           # Shared date/time picker — custom calendar grid, month/year picker, quick presets, haptics
    Skeleton.tsx             # Shimmer skeleton loaders (SkeletonBox, SkeletonCard, SkeletonProfileCard, etc.)
    SuggestCategoryModal.tsx # Bottom sheet for proposing a superlative category (label + target type)
    VoteSheet.tsx            # Bottom sheet for casting / changing a vote (person picker or media grid)
    VotingWindowPicker.tsx   # 24h / 48h / 7d / custom-hours picker for the Awards voting window
  context/
    ThemeContext.tsx         # accentColor per-user, loads from Supabase on auth
  hooks/
    useAuth.ts              # Session listener, returns { session, loading }
    useCachedFetch.ts       # Cache-aware data fetching hook — show cached, refresh in background
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
    supabase.ts             # Supabase client + on-web accessToken override (see Web Auth Gotchas)
    sessionStore.ts         # Synchronous session cache (web seeds from localStorage at module load)
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

---

## Key RLS Constraints

**Capsule insert:** do not chain `.select()` on the insert. The SELECT policy checks `capsule_members` for membership, but the member row doesn't exist yet at insert time — this causes a 403. Pattern: generate UUID client-side with `randomUUID()`, insert capsule without `.select()`, then insert the member row separately.

**`capsule_members` policies use security definer functions** to avoid infinite recursion:
- SELECT: `get_my_capsule_ids()` — returns capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — checks ownership via `capsules` table

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or use the `capsules` table directly.

All RLS policies use `(select auth.uid())` not `auth.uid()` directly — avoids query planner issues.

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

**Avatar upload path:** `${userId}/avatar.jpg` with `upsert: true`.
**Media upload path:** `${capsuleId}/${randomUUID()}.${ext}`.

---

## Database Schema

Defined in `supabase-schema.sql`.

| Table | Key columns |
|---|---|
| `users` | id, email, display_name, bio (max 80 chars), avatar_url, push_token, auth_provider, subscription_tier, accent_color (default '#FF6B35'), onboarded_at (null = needs wizard), created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at, archived_at (null = active), unlock_mode (time/proximity/both), proximity_radius_m (default 100), unlocked_at, superlative_voting_hours (default 48), superlative_voting_closes_at, superlative_voting_finalized_at, superlative_closing_soon_sent_at |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending), checkin_lat, checkin_lng, checkin_at |
| `media` | id, capsule_id, uploader_id, storage_key, media_type (photo/video), size_bytes, thumbnail_key, uploaded_at, is_flagged |
| `reactions` | id, media_id, user_id, emoji, created_at — unique (media_id, user_id) |
| `notifications` | id, user_id, capsule_id, type (invite/unlock/reaction/contribution_nudge/milestone/superlative_suggested/superlative_closing_soon/superlative_won), sent_at, read_at, pushed_at (null = unpushed; superlative pushes batch via cron) |
| `superlative_categories` | id, capsule_id, suggested_by, label (3–80 chars), target_type (person/media), status (pending/live/archived), promoted_at, created_at |
| `superlative_upvotes` | category_id + user_id (composite PK), created_at — drives auto-promote trigger |
| `superlative_votes` | category_id + voter_id (composite PK), target_user_id XOR target_media_id, created_at, updated_at — anonymous; clients only read own row |
| `superlative_winners` | id, category_id, target_user_id XOR target_media_id, vote_count, determined_at — one row per (category, tied target); written only by finalize RPC |

**`users` column privileges:** the `users` SELECT policy is `USING (true)` (every signed-in user can read every profile — needed for search and public profiles). To stop that exposing sensitive fields, `email`, `phone`, and `push_token` are removed from the `authenticated` SELECT grant at the **column level**. Never `select('email')` / `select('phone')` / `select('push_token')` / `select('*')` on `users` from client code — it will fail. The current user's email is on the auth session (`session.user.email`), not this table. Reading another user's `push_token` is server-only (see the `send-invite-push` edge function).

**Triggers:**
- `handle_new_user()` — auto-creates `users` row on `auth.users` insert
- `notify_on_reaction()` — inserts reaction notification (not to self)
- `notify_on_superlative_suggested()` — fan-out on `superlative_categories` insert; notifies every other joined member
- `_promote_superlative()` — on `superlative_upvotes` insert, flips a pending category to `live` once upvotes hit `ceil(joined/2)`
- `_stamp_unlock_meta()` — BEFORE UPDATE on `capsules`; when status flips to 'unlocked' stamps `unlocked_at = now()` and `superlative_voting_closes_at = unlocked_at + voting_hours`. Both the unlock cron and the proximity `check_in` path inherit this for free.
- `_touch_superlative_vote_updated_at()` — bumps `updated_at` when a vote is changed

**Permission model:** only owners can see media before unlock. Contributors/viewers see a locked state until `status = 'unlocked'`. Use `isOwner` (`capsule.owner_id === currentUserId`) for owner checks — works even if the `capsule_members` row is missing.

**Pending invites:** `joined_at IS NULL` on `capsule_members` means invite not yet accepted. `joined_at` is set when the user accepts.

**Notifications are soft-deleted** by setting `read_at`. Queries filter `.is('read_at', null)` to show only unread.

---

## In-App Camera (`CameraScreen.tsx`)

- `mode="video"` is required on `CameraView` even for photos — expo-camera 17.x needs it for `recordAsync`
- Tap = photo, hold 300ms = video (manual timer via `setTimeout`, not `onLongPress`)
- Double-tap (within 300ms) switches front/back camera
- Pinch gesture (PanResponder): zoom 0–1, displayed as 1×–5× badge, fades after 800ms
- Max video recording: 30 seconds
- Photos: resized to 1920px wide via `expo-image-manipulator`, compress 0.82, quality 0.88
- Front camera photos: flipped horizontally via `FlipType.Horizontal`
- Use `useIsFocused()` to stop camera rendering when tab is not active
- Navigates to `Preview` with `{ uri, mediaType, facing }`

**Camera mode dropdown:** a side dropdown (top-left, `styles.modeDropdown`) selects `cameraMode: 'back' | 'front' | 'dual'`. `facing` is derived (`front`→front, else back). `Back`/`Front` render `CameraView`; `Dual` renders `<DualCameraView>` (see below). The Dual option only appears when `isDualCameraSupported`. In Dual mode: pinch/zoom + double-tap-flip are disabled, hold-to-record is disabled (tap-only), and the reverse button is hidden.

---

## Dual Camera (`modules/expo-dual-camera`)

Simultaneous front+back capture (Snapchat-style), **side-by-side** composite. `expo-camera` cannot do multi-cam, so this is a **local Expo native module** (autolinked from `modules/`, survives `expo prebuild --clean`). Consumed by `CameraScreen` via `import { DualCameraView, isDualCameraSupported, DualCameraViewRef } from '../../../modules/expo-dual-camera'`.

- **iOS (`ios/ExpoDualCameraView.swift`):** `AVCaptureMultiCamSession` with back+front wide-angle inputs added via `addInputWithNoConnections` and explicit `AVCaptureConnection`s (multi-cam requires manual connections). Two `AVCaptureVideoPreviewLayer`s laid out left|right in `layoutSubviews`. Photo: two `AVCapturePhotoOutput`s fire together; both JPEGs are composited left|right into one image (`composeSideBySide`) written to a temp file. `capturePhoto()` is a view `AsyncFunction` resolving `{ uri, width, height }`.
- **Android (`android/.../ExpoDualCameraModule.kt`):** reports `isSupported = false` (concurrent dual-cam is rare/device-specific). Dual mode is hidden there.
- **JS (`index.ts`):** guards `Platform.OS !== 'web'` + try/catch around `requireNativeModule`/`requireNativeView`, so web and Expo Go (pre-prebuild) fall back to `isDualCameraSupported = false` and `<DualCameraView>` renders null. `isDualCameraSupported` reads the native `isSupported` constant (true only on A12+ iPhones, iOS 13+).
- **Capture flow:** `CameraScreen.captureDualPhoto()` calls `dualRef.current.capturePhoto()`, runs the result through the same `processPhoto` (resize 1920) + `Preview` navigation as single-camera photos.
- **Requirements:** needs a custom dev/EAS build + a physical multi-cam iPhone — **does not run in Expo Go or the simulator**. Uses the existing `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` from the `expo-camera` plugin (no app.json change).
- **Not yet implemented (Phase 2):** dual **video** (needs `AVAssetWriter` compositing of both feeds into one MP4); in Dual mode video is disabled and single-lens video still works in Back/Front. The Swift is authored against the SDK but **not yet device-verified** — expect on-device iteration on session/hardware-cost tuning.

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
- **Multi-select capsules** via horizontal chip scroll with `Set<string>`. After multi-upload: navigates to `CapsuleDetail` (single capsule) or `Home` (multiple)
- **Upload loop is (capsule × media)** sequential — total progress is `selectedIds.size * items.length`
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
- Registers Expo push token (native only) and stores in `users.push_token`
- Notification tap handler: reads `data.capsuleId` or `data.screen` from notification payload, navigates via `navigationRef`
- Notification display config: `showAlert`, `playSound`, `showBanner`, `showList` all true
- Invite push notifications are sent by the `send-invite-push` edge function. `CapsuleDetailScreen.sendInviteNotification()` calls it via `supabase.functions.invoke()`; the function verifies the caller owns the capsule, reads the invitee's `push_token` with the service role, and posts to Expo. The in-app notification row itself is created server-side by the `notify_on_invite` trigger.
- Reaction notifications are created server-side by the `notify_on_reaction` trigger

---

## CapsuleDetailScreen Key Patterns

Large file (~1400 lines). Key sub-components and patterns:

**`ProgressRing`** — pure RN circular progress indicator. Two-half-clip technique: each half uses a full ring with two adjacent border colors (orange + track) clipped to its side, rotated to reveal the correct amount.
- Right half: `borderTopColor + borderRightColor = orange`, rest = trackColor
- Left half: `borderBottomColor + borderLeftColor = orange`, rest = trackColor
- Rotation formula: `rightRot = -135 + min(deg, 180)`, `leftRot = -135 + max(deg - 180, 0)`
- **Do not use `borderColor: 'transparent'`** — causes a dark rendering artifact on iOS at the color transition point. Always set all 4 border colors explicitly.

**`CountdownRing`** — wraps `ProgressRing` with lock icon, countdown text, unlock date. Updates every 60s via `setInterval`. Progress = `timeRemaining / (unlock_at - created_at)`, falls back to 1-year total if `created_at` unavailable.

**`InviteModal`** — user search with 300ms debounce (min 2 chars), sends push notification to invited user client-side.

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis is locked on first movement (prevents diagonal). Vertical swipe > 120px or velocity > 1.5 closes modal. Header controls (close, page counter, download) sit inside a `LinearGradient` overlay (top 120px, `rgba(0,0,0,0.6)` → transparent) so buttons don't get lost against light images. Download button uses `expo-media-library` on native (saves to camera roll) and anchor-element download on web.

**Real-time:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules` table. On status → 'unlocked': triggers reveal animation + refetches media.

**Upload flow:**
- Web: `fetch(uri) → arrayBuffer → supabase.storage.upload()`
- Native: `FileSystem.uploadAsync` with `Authorization` + `apikey` headers
- After all uploads: refetches media via `fetchPhotos()`

**Reactions:** `addReaction()` generates the reaction ID client-side via `randomUUID()` — never chain `.select()` after `.insert()` on the `reactions` table (the SELECT RLS policy may fail even though the insert succeeded, causing the optimistic reaction to disappear). If the user already has a reaction on the media, the existing row is updated (emoji swap) instead of inserting a duplicate — respects the `unique(media_id, user_id)` constraint.

**Cache integration:** on mount, checks `cache.get('capsule:${capsuleId}')` — if cached, renders instantly and fetches fresh in background. `load()` calls `cache.set()` after fetching. Invalidation: `cache.invalidate('capsules', 'profile')` on delete.

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
const { accentColor, setAccentColor } = useTheme();
```

`ThemeProvider` wraps `NavigationContainer` in `App.tsx`. It loads `users.accent_color` from Supabase on login and resets to the default on logout. `setAccentColor` updates state instantly and persists to Supabase in the background.

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

All of the following are owner-only and silently no-op / navigate away if not owner:

- **Edit capsule** (`EditCapsuleScreen`) — title, description, unlock date, contribution lock date. Accessible via "Edit" button in CapsuleDetail header and long-press on a card in HomeScreen. Blocked if capsule is already unlocked.
- **Archive capsule** — sets `archived_at`. Hides from main feed; appears in collapsible "Archived" section on Home with a Restore button. Available from EditCapsule and CapsuleDetail danger zones.
- **Delete capsule** — clears storage files from `capsule-media` bucket first, then deletes the capsule row (cascades to members, media, reactions, notifications). Confirmation required via `<ConfirmModal>` (not `Alert.alert` — that no-ops on web). Available from EditCapsule and CapsuleDetail danger zones.
- **Manage members** (`ManageMembersScreen`) — lists all members (joined + pending). Trash icon removes a member after confirmation. Accessible via "Manage" button in CapsuleDetail members section.

## Onboarding (`OnboardingScreen`)

A 4-step wizard that runs after new sign-ups. Gated by `users.onboarded_at`:
- AppNavigator on mount queries `users.onboarded_at`. If null → `initialRouteName = 'Onboarding'`. Otherwise → `'Tabs'`. On query error, falls through to Tabs (don't strand the user).
- The wizard writes `display_name`, optionally `avatar_url` / `bio` / `accent_color`, and sets `onboarded_at = now()` in a single update on completion.
- Final step uses `navigation.replace('Tabs', { screen: 'Home' })` (no back stack to the wizard).

Steps:
1. **Name + avatar.** Display name required (max 30). Avatar via `expo-image-picker` → resize to 400px → upload to `avatars/${userId}/avatar.jpg` (web: arrayBuffer; native: FileSystem.uploadAsync).
2. **Accent color.** Reuses the shared `<ColorPicker>` component (`src/components/ColorPicker.tsx`). On completion, also calls `ThemeContext.setAccentColor` so the change is reflected everywhere immediately.
3. **Bio.** 80-char free-text (mirrors the DB `check (char_length(bio) <= 80)` constraint).
4. **First-capsule preset.** Four cards (Vacation memories, Baby's first year, Wedding day, Year in review) — tapping one calls `navigation.replace('Tabs', { screen: 'Create', params: { presetTitle, presetDescription } })`, which CreateScreen reads via `useRoute()` to prefill the form. "Skip & finish" goes straight to Home.

Footer renders only the buttons that apply for the current step. Step 1: just `Next`. Steps 2–3: `Back | Skip | Next`. Step 4: `Back | Skip & finish` (preset cards are themselves the primary action). Don't render placeholder `<View>`s for missing buttons or they'll consume row width.

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
2. Are delivered as Expo pushes by the `send-superlative-pushes` edge function, which the cron pings every minute via `net.http_post`. The function pulls notifications where `pushed_at IS NULL AND type IN (...)`, builds per-type Expo payloads with `data.capsuleId`, posts to `exp.host`, and stamps `pushed_at` so retries can't double-send.
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

---

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`. Use this instead of `crypto.randomUUID()` — `crypto` global is not reliably typed in the Expo TS config.
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor }`. `ThemeProvider` must wrap the app.
- `src/lib/sessionStore.ts` — `sessionStore.get()` / `sessionStore.set()`. Module-level session cache, updated by `useAuth` on every `onAuthStateChange` event. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()` inside screens.** `getSession()` on web hangs when the access token is expired because it blocks on an internal refresh network call. `sessionStore.get()` is synchronous and never hangs.

## Cache System (`src/lib/cache.ts`)

In-memory cache with TTL, key-based invalidation, and pub/sub listeners. Reduces loading times by showing cached data instantly while fetching fresh data in the background.

- `cache.get<T>(key, ttl?)` — returns cached data or null if expired (default 5 min TTL)
- `cache.set<T>(key, data)` — stores data with timestamp
- `cache.invalidate(...keys)` — deletes entries and notifies all subscribers for those keys
- `cache.subscribe(key, fn)` — returns unsubscribe function; used by `useCachedFetch` for cross-screen reactivity
- `cache.clear()` — wipes entire cache (called on sign out via `useAuth`)

**`useCachedFetch<T>(key, fetcher, deps)`** (`src/hooks/useCachedFetch.ts`) — returns `{ data, loading, refresh }`. On screen focus: if cached data exists, renders instantly and fetches fresh in background; otherwise shows loading state. Subscribes to cache invalidation: when another screen invalidates the key, re-fetches immediately.

**Cache keys in use:**
- `capsules` — HomeScreen capsule list
- `capsule:${id}` — per-capsule detail data
- `profile` — ProfileScreen hero card data
- `notifications` — NotificationsScreen

**Invalidation pattern:** screens that mutate data call `cache.invalidate()` with all affected keys. Example: creating a capsule invalidates `capsules` and `profile` (stats changed).

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

All three hooks use `useIsFocused()` from React Navigation — animations reset and replay every time the screen gains focus (not just on initial mount). This is important for tab screens which stay mounted.

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
