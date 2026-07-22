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
    SealedMoment.tsx         # Full-screen "sealed" ceremony overlay (lock scale-in + success haptic + unlock-date line)
                             # shown by CreateScreen.handleCreate on every successful create; auto-dismisses ~1.8s or on
                             # tap, then onDone navigates to CapsuleDetail. Mirrors Onboarding step 5's one-time ceremony.
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
    useRevenueCat.ts         # App-level RevenueCat lifecycle (configure once, logIn/logOut on session). See "Monetization"
    useEntitlements.ts       # Reactive { isPro } via CustomerInfo listener — UI-only, not the real gate. See "Monetization"
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
    purchases.native.ts     # RevenueCat SDK wrapper (native only). See "Monetization"
    purchases.web.ts        # No-op stub for web — signatures mirror purchases.native.ts
    purchases.ts             # TS-resolution fallback (re-exports the web stub), same split as usePushNotifications
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
    dispatch-capsule-start/  # Edge function: atomically claims active capsules whose contribution_start_at
                             # has arrived (contribution_start_notified_at still null), inserts a
                             # capsule_started notification per joined member, and pushes inline. Auth:
                             # Bearer CRON_SECRET. Per-minute EXISTS-gated cron. See "Capsule Start Date".
    revenuecat-webhook/      # Edge function: mirrors the Capsule Pro entitlement into users.subscription_tier.
                             # Auth: shared-secret Authorization header (REVENUECAT_WEBHOOK_SECRET), not CRON_SECRET
                             # — RevenueCat calls this directly, not via pg_cron. See "Monetization".
  migrations/                # Timestamped SQL migrations applied to the remote DB. supabase-schema.sql
                             # is the original schema and has drifted — the migrations are the source of truth.
```

---

## Auth Flow

`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`. `App.tsx` renders `AuthNavigator` or `AppNavigator` based on session presence. Loading state blocks rendering until session is confirmed (Supabase session restore is async).

**Auth methods:** email/password (`supabase.auth.signInWithPassword`) and Google OAuth (`src/lib/googleAuth.ts` — uses `expo-auth-session` + `expo-web-browser`, extracts tokens from redirect URL, calls `supabase.auth.setSession`).

**Platform split in `src/lib/supabase.ts`:** on web, Supabase uses `localStorage` (default). On native, `expo-secure-store` is used via a custom async adapter. Do not use the async adapter on web — it causes the JWT to not be attached to requests.

**Always use `getSession()` instead of `getUser()`** when you just need the user ID or token. `getUser()` makes a live network request on every call (500ms–2s latency). `getSession()` reads from local storage instantly.

**Email confirmation state (`SignUpScreen`)** — when `supabase.auth.signUp` succeeds with `data.session === null` (email confirmation required), the screen replaces the whole form with a dedicated confirmation state (`pendingEmail`) rather than leaving the filled-in form sitting there: shows the email, a "Resend email" button (`supabase.auth.resend({ type: 'signup', email })`, 60s cooldown), and "I've confirmed → Sign in" which navigates to `Login` with the email prefilled. `AuthStackParamList['Login']` is `{ email?: string } | undefined` for this — `LoginScreen` seeds its email state from `route.params?.email`. Auth error strings are mapped through `mapAuthError` (`src/lib/authErrors.ts`) to friendly copy; "already registered" additionally renders a tappable "Sign in instead" link (same Login-with-prefill mechanism).

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

Tab `Create` accepts optional `{ presetTitle, presetDescription, pendingMedia }` route params. `presetTitle`/`presetDescription` are used by Onboarding step 4 preset cards. `pendingMedia` is a `PendingMedia[]` set by `PreviewScreen` when creating a new capsule from the camera/share flow — enqueued onto the background `uploadQueue` (see "Background Upload Queue") right after the capsule row is created, so the new capsule's screen shows the same pending tiles / `Uploading n/N` / truthful drain toast as any other upload, and a per-item failure is retryable instead of silently swallowed. `CapsuleDetail` is opened with `justCreated: true` in this navigation so it can show the post-create invite nudge (below).

**`CreateScreen` progressive disclosure** — only **Name and the Unlock date** are always visible above the "Lock Capsule" button. **Description, Unlock-When mode, Uploads Deadline, Voting window, Occasion, and the Surprise toggle** all live behind a **"More options"** disclosure (collapsed by default), showing a one-line summary of current values (e.g. `General · 48h voting · Surprise on`) when collapsed. Everything collapsed is pre-defaulted (`time` mode, 48h voting, `general` occasion, surprise on), so leaving it closed costs a new user nothing. **The default-awards preview (`DefaultAwardsCard`) is NOT on this screen** — the occasion is just a chip row; the 4 themed awards are seeded from it at submit time (`pickDefaults(occasion)` → `set_default_superlatives`, non-fatal on error) and the owner reviews/regenerates them on the capsule's own `<DefaultAwardsCard mode="manage">` (pre-unlock) — a better version one screen later, with the capsule actually existing. The above-the-fold Unlock date field is gated on `unlockMode !== 'proximity'`, and the mode toggle now lives inside "More options", so switching to proximity there hides the top date field (accepted — proximity is a power path). Validation is per-field (`errors: { title?, description?, unlockDate?, contribLockDate?, votingHours?, general? }`, an `inputError` red border on the failing `TextInput`, inline text under the field) rather than one message at the bottom — on a failing submit, `scrollToField` auto-expands "More options" first if the invalid field lives there (title/unlockDate are above the fold; description/contribLockDate/votingHours are inside), then scrolls it into view. `general` is still a single bottom-of-form slot, reserved for account/system-level failures (not signed in, capsule insert failed) that aren't tied to one input.

**`navigationRef`** (`src/lib/navigationRef.ts`) — a `NavigationContainerRef` used for imperative navigation from outside components (e.g. push notification tap handler, deep link handler). Poll `navigationRef.isReady()` before calling `.navigate()`.

**Deep links** — handled by `useDeepLinks` (`src/hooks/useDeepLinks.ts`), called from `RootNavigator` in `App.tsx`. Two routes:
- `capsule://join/<capsuleId>` — inserts a **joined** `capsule_members` row (`joined_at` set) if not already a member, then navigates straight into `CapsuleDetail`. Opening the link IS the consent act, so this is a real join, not a pending invite — there's no second "Accept" step. No client-side `notifications` insert (there's no INSERT policy for it — always errored silently); the `notify_on_invite` trigger already fires off the `capsule_members` insert. **Signed-out taps are stashed, not dropped**: `useDeepLinks(session)` (the hook takes the session from `App.tsx`) writes the pending capsule id to `src/lib/pendingJoinStash.ts` (same module-level idiom as `shareIntentStash`) and a `useEffect` on session presence drains it after sign-in, running the same join+navigate.
- `capsule://reset-password#access_token=...&refresh_token=...` — calls `supabase.auth.setSession()` with tokens from the URL fragment, then navigates to `ResetPassword` screen.

The scheme `capsule://` is registered in `app.json`. `NavigationContainer` also receives a `linking={{ prefixes: ['capsule://'] }}` prop. **Custom URL schemes only work in native builds, not Expo Go.**

**QR scan-to-join** — owners show a QR encoding `capsule://join/<id>` (InviteModal in `CapsuleDetailScreen`); `QRScannerScreen` (Home → Scan QR) scans it. The pre-join preview (title/owner/member-count) **must** come from the `capsule_join_preview(p_capsule_id)` SECURITY DEFINER RPC, **not** a direct `capsules` select — the `capsules` SELECT policy is membership-gated, so a non-member (i.e. anyone scanning to join) can't read the row directly and the scanner would wrongly report "doesn't exist or expired." The RPC returns only minimal non-sensitive fields, gated by possession of the (unguessable) capsule UUID. The join INSERT itself is allowed for self-join (`can_insert_capsule_member` returns true when `p_user_id = auth.uid()`). Tapping "Accept Invite" joins immediately (`joined_at` set, same reasoning as the deep-link case above) and navigates into the capsule — not to Notifications. On an invalid/unrecognized QR or a lookup that comes back empty, no confirmation sheet renders, so the scanner explicitly re-arms itself (`setScanned(false)` after ~2s) — otherwise `onBarcodeScanned` stays `undefined` forever and the camera can never scan again despite the "Try again" copy.

---

## Key RLS Constraints

**Capsule insert goes through the `create_capsule_with_owner(...)` RPC** (`20260711160000_atomic_capsule_create.sql`), not a direct client insert. `CreateScreen` and `OnboardingScreen` both used to do this as two separate requests — insert the capsule (without `.select()`, since the SELECT policy checks `capsule_members` for membership and the member row doesn't exist yet — that would 403), then insert the owner's `capsule_members` row. If the second request failed, the capsule row was left behind with **zero members**, and since the `capsules` SELECT policy has no owner fallback, that capsule became permanently invisible to everyone, including its own owner — confirmed in production (10 of 21 capsules had this shape). The RPC does both inserts in one PL/pgSQL function body (`security definer`, since the caller isn't a `capsule_members` row yet when the capsule itself is inserted) — Postgres rolls back the whole function if either insert raises, so this path can no longer create an orphan. It generates the capsule's UUID server-side and returns it (`returns uuid`); callers no longer generate the ID client-side with `randomUUID()`. Takes the same fields both screens used to insert directly, plus an optional `p_group_id` (`CreateScreen`'s group flow passes it at creation instead of a follow-up `.update()`).

**`capsule_members` policies use security definer functions** to avoid infinite recursion:
- SELECT: `get_my_capsule_ids()` — returns capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — checks ownership via `capsules` table

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or use the `capsules` table directly.

All RLS policies use `(select auth.uid())` not `auth.uid()` directly — avoids query planner issues. `get_my_capsule_ids()`, `can_insert_capsule_member()`, and the `capsules`/`capsule_members` policies above were live on production for an unknown period without ever being committed to a migration — another out-of-band dashboard/MCP change, like the missing `home_layout` grant below but for an entire policy redesign rather than one grant. Captured in `20260515232500_capture_capsule_rls_and_helpers.sql`. If you find another RLS policy or function that doesn't match what `mcp__supabase__execute_sql` shows is actually live, assume the live DB is correct and the migration is the one that's stale — verify with `pg_policies`/`pg_get_functiondef` before changing behavior.

**Contribution lock — AND the mirror-image start date — are enforced at TWO layers** (both must allow):
1. `media` table INSERT policy checks `(c.contribution_lock_at IS NULL OR now() < c.contribution_lock_at) AND (c.contribution_start_at IS NULL OR now() >= c.contribution_start_at)` (joins `capsule_members` for membership + role).
2. `storage.objects` INSERT policy for the `capsule-media` bucket (`Contributors can upload to their capsules`) does the **same check** — extracts the capsule_id from the path's first folder segment (`(storage.foldername(name))[1]`) and validates membership/role/lock/start. The bucket-level policy was previously wide open; tightening it closed a hole where a malicious user could spam storage without ever inserting the linking `media` row.

The `contribution_start_at` half was added in `20260716120000_capsule_start_date.sql` (see "Capsule Start Date"). **Unlike the lock, the start gate has no owner exemption** — it's expressed as a plain `role in ('owner','contributor')` clause, so even the owner can't upload before the start date (the whole premise is that the event hasn't happened yet). Both policies were re-created (drop + create) rather than altered in place.

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
| `users` | id, email, display_name, bio (max 80 chars), avatar_url, push_token, auth_provider, subscription_tier, accent_color (default '#FF6B35'), accent_gradient (nullable text `"#a,#b"`, null = solid — Pro-only cosmetic, see "Theme System"), home_layout (list/grid, default 'list'), onboarded_at (null = needs wizard), created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at, archived_at (null = active), unlock_mode (time/proximity/both), proximity_radius_m (default 100), unlocked_at, superlative_voting_hours (default 48), superlative_voting_closes_at, superlative_voting_finalized_at, superlative_closing_soon_sent_at, owner_preview_locked (default true — surprise mode), occasion (wedding/vacation/party/baby/milestone/general, default 'general' — drives the default-awards theme), contribution_start_at (nullable — mirror of contribution_lock_at; **nobody, owner included, can upload before it**, see "Capsule Start Date"), contribution_start_notified_at (nullable — dedupe stamp set once the capsule-started push has fired) |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending), archived_at (per-member "hide from my feed" flag — see Archive below), checkin_lat, checkin_lng, checkin_at, contribution_nudge_7d_sent_at / _3d_sent_at / _1d_sent_at (nullable — per-tier dedupe stamps, see "Contribution Nudges") |
| `media` | id, capsule_id, uploader_id, storage_key, media_type (photo/video), size_bytes, thumbnail_key, uploaded_at, is_flagged |
| `reactions` | id, media_id, user_id, emoji, created_at — unique (media_id, user_id) |
| `notifications` | id, user_id, capsule_id (**nullable** — null for friend events), actor_id (nullable — the other user, for friend events), type (invite/unlock/reaction/contribution_nudge/contribution_activity/capsule_started/milestone/superlative_suggested/superlative_closing_soon/superlative_won/friend_request/friend_accept), count (nullable int — photo count, used by contribution_activity/contribution_nudge), sent_at, read_at, pushed_at (null = unpushed; superlative pushes batch via cron) |
| `contribution_activity_pending` | capsule_id + uploader_id (composite PK), photo_count, last_upload_at — debounce staging table, see "Contribution Nudges" |
| `superlative_categories` | id, capsule_id, suggested_by, label (3–80 chars), target_type (person/media), status (pending/live/archived), promoted_at, created_at, is_default (bool, default false — marks an auto-seeded award, see "Default Awards" below) |
| `superlative_upvotes` | category_id + user_id (composite PK), created_at — drives auto-promote trigger |
| `superlative_votes` | category_id + voter_id (composite PK), target_user_id XOR target_media_id, created_at, updated_at — anonymous; clients only read own row |
| `superlative_winners` | id, category_id, target_user_id XOR target_media_id, vote_count, determined_at — one row per (category, tied target); written only by finalize RPC |
| `content_reports` | id, reporter_id, target_type (media/user), reported_media_id XOR reported_user_id, capsule_id, reason (spam/harassment/nudity/violence/hate/self_harm/other), details (≤500), status (pending/reviewed/actioned/dismissed), created_at — insert+read-own RLS; reviewed out-of-band via service role |
| `blocked_users` | blocker_id + blocked_id (composite PK), created_at — directional; owner-only RLS (blocked party can't see the row) |
| `friendships` | id, requester_id, addressee_id, status (pending/accepted), created_at, responded_at — one row per unordered pair (unique index on least/greatest); RLS: read-own, insert-as-requester, update-to-accepted-by-addressee, delete-by-either |

**`users` column privileges:** the `users` SELECT policy is `USING (true)` (every signed-in user can read every profile — needed for search and public profiles). To stop that exposing sensitive fields, `email`, `phone`, and `push_token` are removed from the `authenticated` SELECT grant at the **column level**. Never `select('email')` / `select('phone')` / `select('push_token')` / `select('*')` on `users` from client code — it will fail. The current user's email is on the auth session (`session.user.email`), not this table. Reading another user's `push_token` is server-only (see the `send-invite-push` edge function).

> ⚠️ **Adding a new client-readable column to `users`?** Because the grant is column-level (the table-wide SELECT grant was revoked), a new column added via `ALTER TABLE ADD COLUMN` gets **no** SELECT grant by default — `authenticated` will have INSERT/UPDATE but not SELECT. Any query selecting it then fails with `42501 permission denied` for the **entire** query (not just that column), silently breaking unrelated fields in the same `select()`. **Always `grant select (...)` the new column to `authenticated` in the same migration.** This bit `home_layout` (added in `20260610020000`, granted in `20260610210000_grant_home_layout_select.sql`): the missing grant made `ThemeContext`'s `select('accent_color, home_layout')` 403, so accent color reset to default on every sign-in. `accent_gradient` (`20260721150000_accent_gradient.sql`) did it right the first time — `grant select (accent_gradient)` and `grant update (accent_gradient)` both live in the same migration as the `ALTER TABLE`.

**Indexes added for actual query shapes** (`20260709120000_perf_indexes.sql`, PERFORMANCE.md #9):
- `idx_notifications_unread` — partial `(user_id, sent_at desc) where read_at is null`, covers the Alerts list + tab-badge query (the most-frequent query in the app).
- `idx_capsules_unlock_due` — partial `(unlock_at) where status='active' and unlock_mode='time'`, covers the `unlock-capsules` cron's per-minute filter.
- `idx_capsules_group_id` — plain `(group_id)`, covers a group's capsule list + the `create-group-capsules` cron (was an unindexed FK per the advisors).
- `idx_media_capsule_uploaded` — composite `(capsule_id, uploaded_at desc)`, replaces the old single-column `idx_media_capsule_id` (dropped in the same migration) so `CapsuleDetailScreen.fetchPhotos`'s `capsule_id = ? order by uploaded_at desc` doesn't sort separately every call.

**Triggers:**
- `handle_new_user()` — auto-creates `users` row on `auth.users` insert
- `notify_on_reaction()` — inserts reaction notification (not to self)
- `notify_on_superlative_suggested()` — fan-out on `superlative_categories` insert; notifies every other joined member
- `_promote_superlative()` — on `superlative_upvotes` insert, flips a pending category to `live` once upvotes hit `ceil(joined/2)`
- `_stamp_unlock_meta()` — BEFORE UPDATE on `capsules`; when status flips to 'unlocked' stamps `unlocked_at = now()` and `superlative_voting_closes_at = unlocked_at + voting_hours`. Both the unlock cron and the proximity `check_in` path inherit this for free.
- `_touch_superlative_vote_updated_at()` — bumps `updated_at` when a vote is changed
- `notify_on_friend_request()` — AFTER INSERT on `friendships` (pending); inserts a `friend_request` notification for the addressee (actor = requester)
- `notify_on_friend_accept()` — BEFORE UPDATE on `friendships`; on pending→accepted stamps `responded_at` and inserts a `friend_accept` notification for the requester (actor = addressee)
- `notify_contribution_activity()` — AFTER INSERT on `media`; upserts a per-(capsule, uploader) row into `contribution_activity_pending`, incrementing `photo_count` and bumping `last_upload_at` on conflict — see "Contribution Nudges"

**Permission model:** by default only owners can preview media before unlock; contributors/viewers see a locked state until `status = 'unlocked'`. Use `isOwner` (`capsule.owner_id === currentUserId`) for owner checks — works even if the `capsule_members` row is missing. **Surprise mode (`capsules.owner_preview_locked`)** overrides this: when on, even the owner can't see media until unlock. See "Surprise Mode" below.

**Pending invites:** `joined_at IS NULL` on `capsule_members` means invite not yet accepted — this is the model for invites *pushed* to someone (`InviteModal`'s search-and-invite), where consent hasn't been given yet. (QR scan / `capsule://join` deep links are different: scanning/opening the link **is** the consent act, so those set `joined_at` immediately — see "Deep links" above.) `NotificationsScreen` renders pending invite cards with both **Accept** (sets `joined_at`, navigates into the capsule) and **Decline** (deletes the pending row, mirroring the `friend_request` Accept/Decline pattern) — declining is the only way to get rid of a pending invite; a plain dismiss would orphan the row (and the owner's ghost "pending" `ManageMembers` entry) forever.

**Notifications are soft-deleted** by setting `read_at`. Queries filter `.is('read_at', null)` to show only unread. `NotificationsScreen`'s main query is capped at `.limit(100)` — unread rows accumulate for passive users (nothing auto-reads reaction/suggestion notifications), so a dormant account could otherwise pull hundreds of rows plus embedded joins in one request.

---

## In-App Camera (`CameraScreen.tsx`)

- `mode="video"` is required on `CameraView` even for photos — expo-camera 17.x needs it for `recordAsync`
- Tap = photo, hold 300ms = video (manual timer via `setTimeout`, not `onLongPress`)
- Double-tap (within 300ms) switches front/back camera
- Pinch gesture (PanResponder): zoom 0–1, displayed as 1×–5× badge, fades after 800ms
- Max video recording: 2 minutes (`MAX_RECORD_SECONDS`)
- **Hands-free lock:** while holding to record, slide the shutter finger **right ≥ 90px** — the lock pill (right of shutter) highlights accent-colored and pulses (`lockAnim`). Release to lock: recording continues hands-free, the shutter becomes a red stop square. Tap the stop square to end. Works for both single and dual recording. State: `locked` (React state), `lockedRef` (ref for PanResponder), `willLockRef` + `hasFiredLockHapticRef` (transient arm state). All reset in `cleanupRecording`.
- **Zoom deadzone:** horizontal movement ≥ 20px (`LOCK_DEADZONE_X`) suppresses vertical zoom to prevent accidental zooming while starting a rightward lock-swipe.
- **First-run gesture coach:** hold-to-record, slide-to-lock, double-tap-flip, and the mode dropdown are otherwise invisible until stumbled upon. A full-screen dismissible overlay ("Tap for photo · Hold for video · Slide right to lock") shows once per install, gated on the `cap_camera_coach_seen` AsyncStorage flag (same one-time-flag pattern as `sessionStore.markOnboarded`/`wasOnboarded`) — tap anywhere to dismiss and set the flag.
- **Persistent idle hint retires after use:** the always-on "Tap for photo · Hold for video" line below the shutter hides once the user has made `HINT_HIDE_AFTER` (3) successful captures — tracked in the `cap_camera_captures` AsyncStorage counter, incremented in the single `goToPreview()` chokepoint every capture path routes through. The recording-state copy ("Release to stop · Slide ▶ to lock") still always shows; a space keeps the row height stable so the shutter doesn't jump when the idle hint goes.
- **Flip camera mid-recording (single-camera only):** tap the reverse button (top-right) or double-tap the viewfinder while recording to switch front↔back. Implemented as a **multi-segment recording loop** in `startRecording`: each call to `recordAsync` is one segment; `flipCameraDuringRecording()` sets `pendingFlipRef`, stops the current segment, calls `setCameraMode`, and a `useEffect([facing])` resolves the loop's await once the `CameraView` re-renders. After all segments are collected, they are stitched into one MP4 via `stitchVideos()` from `modules/expo-video-stitcher` before navigating to Preview. The 2-minute cap is shared across all segments (`recordSecondsRef`). Dual-camera mode is excluded (both lenses already active).
  - **iOS orientation gotcha:** `ExpoVideoStitcherModule.stitch()` (iOS) builds an `AVMutableComposition` with a single shared video track spanning all segments — that track has exactly **one** `preferredTransform` for its whole timeline, so it can't represent front and back camera segments having different orientations (which they commonly do). Naively concatenating without accounting for this renders every segment with the same transform regardless of which camera captured it, showing up as one segment (often whichever isn't closest to identity) compressed/stretched into the wrong aspect ratio. Fixed by building an explicit `AVMutableVideoComposition` with one instruction per segment, each applying that segment's own `preferredTransform` (re-anchored at the origin, scaled/centered into a shared render canvas — also guards against front/back recording at slightly different native resolutions). Android has the analogous bug (`MediaMuxer`'s single video track can likewise only carry one orientation, and `stitch()` there only registers the first segment's rotation) but needs a fundamentally different fix — a real decode/rotate/encode transcode, not a metadata change — and is not yet fixed.
- Photos: resized to 1920px wide via `resizeForUpload()` (`src/lib/imageResize.ts`, shared with the upload queue — see below), compress 0.82, quality 0.88
- Front camera photos are mirrored by `CameraView`'s `mirror={facing === 'front'}` prop, which flips **both the live preview and the captured JPEG** on iOS and Android (confirmed in expo-camera 17's native source: iOS sets `isVideoMirrored` on the photo connection, Android flips the saved bitmap in `ResolveTakenPicture`). Do **not** add a JS-side `FlipType.Horizontal` pass for front photos — it composes with the native mirror back to identity, un-mirroring the photo (tried and reverted)
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

---

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

**Post-create invite nudge** — when `route.params.justCreated` is true (set by `CreateScreen` on navigation right after a capsule is made) and `members.length === 1`, a dismissible callout ("Invite people — capsules are better together") renders above the Media section, with an Invite button opening the same `InviteModal`. A single-member capsule is a failed core loop (no reveal, no award voting to anticipate), so this is the one moment worth nudging; it's gone once another member joins or the user dismisses it, and never reappears on a later visit (the param isn't persisted).

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis is locked on first movement (prevents diagonal). Vertical swipe > 120px or velocity > 1.5 closes modal. Header controls (close, page counter, download) sit inside a `LinearGradient` overlay (top 120px, `rgba(0,0,0,0.6)` → transparent) so buttons don't get lost against light images. Download button uses `expo-media-library` on native (saves to camera roll) and anchor-element download on web.

**Members bottom sheet** — tap the avatar cluster to open; swipe-down-to-close on top of the usual backdrop-tap/X button. Three real bugs went into getting this gesture right, worth knowing before touching it again:
- `membersSheetTranslateY` is a persistent (component-lifetime) `useRef` `Animated.Value`, unlike `MediaViewerModal`'s (which remounts fresh every open) — so **every** animation on it (open, close, release-cancel spring) must use `useNativeDriver: false`. React Native's native driver permanently latches a value the first time `useNativeDriver: true` runs on it; mixing drivers on a value that's only ever created once works on the first open/close cycle and silently stops responding to drags on the second.
- The `PanResponder` is attached to the *whole* sheet (the outer `Animated.View` carrying the transform), not just the handle/header strip — a drag starting anywhere on the sheet, including over the member rows, should dismiss it. Since the member list is a vertical `ScrollView` sharing the same axis as the dismiss gesture, `onMoveShouldSetPanResponderCapture` (not the bubble-phase variant) is gated on `membersScrollY.current <= 0 && dy > dx` — only claims a downward drag once the list is already scrolled to the top, mirroring native iOS overscroll-to-dismiss. Capture (not bubble) is required to win against the ScrollView's own native pan recognizer before it starts scrolling. `onStartShouldSetPanResponder` stays `false` (no capture variant either) so plain taps still reach the nested X button and member rows.
- `sheetCard` needs real `paddingTop` (not just the handle's own `marginTop`) — the backdrop `TouchableOpacity` is a *sibling* of the sheet in the render tree, not an ancestor, so a touch that lands even a few px above the sheet's actual top edge is grabbed by the backdrop's `Pressability` at touch-down and never reaches the sheet's `PanResponder` at all (a subsequent drag just cancels the backdrop's pending tap — net effect: nothing happens). With a 4px handle pill and no top padding, "aim for the top of the sheet" reliably misses. Generous top padding fixes it without touching the gesture logic at all.

**Real-time:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules` table. On status → 'unlocked': triggers reveal animation, invalidates `signedUrls:${capsuleId}` **and** `media:${capsuleId}` (a surprise-mode owner's pre-unlock cache may have cached an RLS-empty media list), then refetches media.

**Upload flow:** all media uploads (Add Media picker, camera, and everything arriving from PreviewScreen) go through the **background upload queue** (`src/lib/uploadQueue.ts`). The "+ Add Media" picker offers **"Open Camera"** (→ `openInAppCamera()`, which navigates to the in-app Camera tab with `{ targetCapsuleId }` — NOT the system camera; `CameraScreen` reads the param, threads it into its Preview navigation so the capsule arrives preselected, and clears it on blur so a later direct tab visit isn't sticky) and **"Camera Roll"** (`pickFromLibrary`). The library picker doesn't enqueue directly — `goToPreview()` hands the picked assets to `Preview` (`{ media, source: 'camera', targetCapsuleId: capsuleId }`) so they get per-item captions and the shared resize pipeline before Preview itself enqueues them; `useUploadTasks(capsuleId)` renders the queue as local-URI **pending tiles** above the photo grid (spinner overlay while uploading; failed tiles get Retry + dismiss). A surprise-mode locked box shows an "N uploading…" line instead of tiles. An effect watches the task count and calls `fetchPhotos()` as each task lands (the queue has already invalidated `media:`/`signedUrls:`/`capsule:` for the capsule). The aggregate "Uploading n/N" row + `ProgressBar` is driven by `uploadQueue.getProgress(capsuleId)`.

**The library picker requests images AND videos** (`mediaTypes: ['images', 'videos']` — SDK 54's array form; the older `MediaTypeOptions` enum is deprecated). `goToPreview()` maps each `ImagePickerAsset` to its real `PendingMedia.mediaType` (`asset.type === 'video' ? 'video' : 'photo'`) instead of hardcoding `'photo'`. **Library video picks are capped at 2 minutes** (`MAX_LIBRARY_VIDEO_MS`, parity with `CameraScreen`'s `MAX_RECORD_SECONDS`) — `filterOversizedVideos()` drops any over-cap video before navigating to Preview and toasts what was skipped (singular/plural-correct; navigation is skipped entirely if every picked item was dropped). `asset.duration` is documented as milliseconds and is milliseconds on iOS/Android, but expo-image-picker's web shim sets it straight from `HTMLVideoElement.duration`, which is **seconds** — `durationMs()` normalizes for `Platform.OS === 'web'` before comparing against the cap. (The old `pickFromCamera` system-camera path was removed when "Open Camera" switched to the in-app camera, whose own `MAX_RECORD_SECONDS` cap applies at capture.) `PendingMedia` carries no `mimeType` field (matches `useShareIntent`'s shape) — `uploadQueue.enqueue` already defaults an unset `mimeType` to `video/mp4`/`image/jpeg` from `mediaType`, so nothing new was needed there.

**Reactions:** `addReaction()` generates the reaction ID client-side via `randomUUID()` — never chain `.select()` after `.insert()` on the `reactions` table (the SELECT RLS policy may fail even though the insert succeeded, causing the optimistic reaction to disappear). If the user already has a reaction on the media, the existing row is updated (emoji swap) instead of inserting a duplicate — respects the `unique(media_id, user_id)` constraint.

**Cache integration:** on mount, checks `cache.get('capsule:${capsuleId}')` — if cached, renders instantly and fetches fresh in background. `load()` calls `cache.set()` after fetching, and runs `fetchPhotos()` in the same parallel wave (it has no dependency on the capsule/members result). Invalidation: `cache.invalidate('capsules', 'profile')` on delete.

**`fetchPhotos(force?)`** caches three things, each independently:
- `media:${capsuleId}` (3min TTL) — the raw `media` row list itself, so a cache hit skips the DB read entirely, not just the signing step. `force=true` (used by pull-to-refresh) always bypasses it, since another member's upload wouldn't trigger this client's own `cache.invalidate`.
- `signedUrls:${capsuleId}` (50min TTL, under the 1hr signed-URL validity) — batches main + alt **+ thumbnail** keys into one `createSignedUrls()` call.
- `videoThumb:${mediaId}` (6hr TTL) — **fallback only**, for videos with no `thumbnail_key` (uploaded before the upload-time thumbnail existed): the locally-generated `expo-video-thumbnails` frame URI (decoded from the remote `signedUrl`), so re-entering the screen doesn't re-decode every video.

**Video thumbnails are generated at upload time, not display time.** `uploadQueue.runTask` (`src/lib/uploadQueue.ts`) runs `VideoThumbnails.getThumbnailAsync` on the **local** file (no network) right after upload, stores the JPEG at `media.thumbnail_key`, and is best-effort — a failure just leaves `thumbnail_key` null. `fetchPhotos` signs `thumbnail_key` alongside the main/alt keys and sets `MediaItem.thumbnailUri` directly from `transformMediaUrl(signedThumbUrl, GRID_THUMB_PX)` for any row that has one; the client-side `VideoThumbnails.getThumbnailAsync(item.signedUrl, …)` loop only runs for items where `thumbnailUri` is still unset (old rows). This means every member's device no longer has to download+decode the full remote video just to draw a grid cell, and web (previously blank for videos, since the client-side generation is native-only) now gets a real thumbnail whenever `thumbnail_key` is present. Included in the same delete-time storage cleanup as `storage_key`/`alt_storage_key` (`confirmDelete`).

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
const { accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient } = useTheme();
```

`ThemeProvider` wraps `NavigationContainer` in `App.tsx`. It loads `users.accent_color` **and `users.home_layout`** from Supabase on login (one query) and resets both to defaults on logout. `setAccentColor` / `setHomeLayout` update state instantly and persist to Supabase in the background.

**Accent gradients (Pro cosmetic).** `accentGradient: [string, string] | null` (from `users.accent_gradient`, parsed via `parseGradient`/`serializeGradient` in `src/lib/accentPresets.ts`) — null means solid, the default for everyone. `setAccentGradient(g)` also writes `accent_color = g[0]` in the same update so the app-wide solid token stays coherent for every screen that only reads `accentColor`; picking a plain solid via `setAccentColor` clears `accentGradient` back to null. **`src/lib/accentPresets.ts`** is the source of the palette: `ACCENT_PRESETS` (10 solids, free for everyone) and `ACCENT_GRADIENTS` (6 two-color pairs, Pro-only). `SettingsScreen`'s Appearance section shows the preset swatches to everyone; the custom `<ColorPicker>` and the gradient swatches are gated behind `isPro` (a locked row + `proGateHit` for non-Pro, same pattern as the other tier gates — see "Monetization"). **Grandfathered, never reset:** there's no migration or trigger that touches an existing `accent_color`/`accent_gradient`, so a user who set a custom color before this shipped (or a downgraded former-Pro user) keeps it. **`src/components/AccentSurface.tsx`** is a drop-in replacement for an accent-colored `View`: renders a `LinearGradient` when `accentGradient` is set, else the solid `accentColor` `View`. Used on exactly **two** surfaces — `ProfileScreen`'s hero glow bar and the camera tab button (`AppNavigator`'s `CustomTabBar`); everywhere else in the app still reads solid `accentColor` directly, by design (a gradient on every accent-colored element would be visual noise, not a coherent theme). In `SettingsScreen`, Pro users still *preview* their gradient directly on the gradient swatches themselves — the "Save Color" button intentionally previews the solid `pending` color, since gradient swatches persist immediately on tap (no pending-gradient state).

**No flash of default orange on launch.** `accentColor`/`homeLayout` used to start at their hardcoded defaults and only update once the Supabase fetch resolved inside a `useEffect` (which runs after first paint) — so every launch briefly rendered the wrong color. Fixed with a persistent per-user cache (`cap_theme_v1:<userId>`), mirroring `sessionStore.ts`'s `readWebSessionSync` pattern:
- **Web:** a synchronous `localStorage` read feeds the `accentColor`/`homeLayout` `useState` lazy initializers directly — since `sessionStore.get()` is already synchronously populated at module load on web, this seeds the real cached color before the very first render, so there's no flash at all.
- **Native:** session restore is async, so the user ID isn't known that early. `loadPrefs` instead does a fast local `AsyncStorage` read (no network, single-digit ms) before the Supabase fetch, applying the cached color almost immediately rather than waiting on the network round-trip.
- `setAccentColor`/`setHomeLayout` write through to this cache too, so a manual change is also available instantly on the next launch. Only fixes it from the *second* launch onward per user — the very first launch after a fresh sign-in has nothing cached yet.

**Home layout preference** (`homeLayout: 'list' | 'grid'`, default `'list'`) — `HomeScreen` renders its capsule `FlatList` as one-column comfortable cards (`list`) or two-column compact cards (`grid`), chosen via a small list/grid toggle in the Home header. The `FlatList` takes `key={homeLayout}` (forces remount when `numColumns` changes) and `columnWrapperStyle` only in grid. `CapsuleCard` takes a `variant` prop; the grid variant drops the description and shrinks. Per-user, synced like `accent_color`.

**`CountdownBadge` (`HomeScreen`)** — the card query selects `unlock_mode` alongside `unlock_at`/`status` specifically so a locked `proximity` capsule can render "Unlocks together" (people icon) instead of a countdown to `unlock_at` — that column is a placeholder never used to actually unlock a proximity capsule (see "Proximity Unlock"), so counting down to it is a promise the app breaks. `both` keeps the real countdown since its date is genuine. `CapsuleDetailScreen` already handled this correctly (hides the ring for `proximity`); Home couldn't until it started fetching `unlock_mode`.

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

**Text muted (`#555555`) vs. text secondary (`#888888`):** `#555555` on `#0A0A0A` is ≈2.5:1 contrast — below WCAG AA (4.5:1) for body text. **Reserve `#555555` for true decoration** (uppercase structural micro-labels like section headers, the "(optional)" annotation, divider words, icon tint on inactive/unselected elements). **Any text that's actual content the user needs to read — dates, counts, empty-state copy, hint/helper text, button labels — must use `#888888` or brighter**, which passes AA (≈5:1). When adding new muted text, default to `#888888` unless it's clearly decorative in the sense above.

**Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`** — otherwise VoiceOver/TalkBack just reads "button" with no name. Applies anywhere the only visible content is an `Ionicons` glyph (close ✕'s, camera controls, the `⋯` overflow, swap/dismiss/decline icon buttons, etc.) — a button with a `Text` child already gets an accessible name for free and doesn't need one added. Tab labels and countdown/badge `Text` also carry `maxFontSizeMultiplier` (≈1.3) so large Dynamic Type settings don't clip these tight, fixed-height layouts.

---

## Owner-Only Capsule Actions

All of the following are owner-only and silently no-op / navigate away if not owner — **except Archive**, which any joined member can do (see below):

- **Edit capsule** (`EditCapsuleScreen`) — title, description, unlock date, contribution lock date. Accessible via "Edit" button in CapsuleDetail header and (owner, pre-unlock only) the "Edit" option in Home's long-press context menu. Blocked if capsule is already unlocked.
- **Archive / restore capsule — PER-MEMBER, not capsule-global** (`20260711150000_per_member_archive.sql`). Archiving stamps `archived_at` on the **caller's own `capsule_members` row**; it hides the capsule from *that user's* main feed (into the collapsible "Archived" section on Home) and never changes what other members see. This replaced the capsule-global design (`capsules.archived_at`, `20260706120000_member_archive_capsule.sql`), which was a production bug: any member archiving silently removed the capsule from **every** member's Home feed — the "capsules keep disappearing" reports. `capsules.archived_at` is retired: the column and its final values are frozen for old installed builds; nothing in the current client reads or writes it. The RPC **`set_capsule_archived(p_capsule_id, p_archived)`** kept its name/signature but now updates the caller's member row (`security definer`, requires a `joined_at is not null` membership — raises otherwise). `CapsuleDetailScreen` gates the button on `canArchive = myMember?.joined_at != null` and reads the toggle state from `myMember.archived_at` (the members query selects `archived_at`); `HomeScreen`'s capsule query selects the member row's `archived_at` alongside the `capsules(...)` embed and merges it onto each card, so `capsules`/`archivedCapsules` split on the user's own flag. `EditCapsuleScreen.handleArchive` also routes through the RPC (toasts on failure). **Archive is reversible and lives in its own section, separate from Danger Zone** (which is Delete-only, `isOwner`-gated). `CapsuleDetailScreen`'s archive button uses `navigation.goBack()` (not `navigation.reset`) and, on success, shows a toast with an **Undo** action (`toast.show(message, { label, onPress })` — see "Toast" below) that re-calls the same RPC in reverse.
- **Home long-press context menu** — long-pressing any card (not just the owner's, unlike the old hidden owner-only long-press-to-Edit gesture) opens an Open / Edit / Archive action sheet (`HomeScreen`'s `menuCapsule` state). Edit only appears for the owner pre-unlock (mirrors `EditCapsuleScreen`'s own gate); Archive appears unconditionally since every capsule in this list already satisfies `canArchive` by virtue of being joined-member-scoped. Archive here has no Undo toast (unlike `CapsuleDetailScreen`'s) — just a plain success/failure toast.
- **Delete capsule** — goes through the **`delete_capsule_with_storage(p_capsule_id)`** RPC (`security definer`, `20260718090000_delete_capsule_with_storage.sql`), not a client-side key-collection + `capsules.delete()` sequence. The old client path selected `storage_key`/`thumbnail_key`/`alt_storage_key` from `media` before deleting the capsule row — but the `media` SELECT policy hides rows from the owner while a capsule is locked in surprise mode (`owner_preview_locked`, the **default** for new capsules), so that select silently returned zero rows and every file for the capsule was orphaned in the `capsule-media` bucket forever (BUGS.md #1). The RPC authorizes inline (`owner_id is distinct from auth.uid()` — null-safe, same pattern as `set_default_superlatives`), collects storage keys as `security definer` (bypassing the RLS gate, so it sees rows regardless of lock state), deletes them from `storage.objects` directly, then deletes the capsule row (cascades to members, media, reactions, notifications) — mirrors `delete_my_account`'s server-side storage-cleanup pattern. Confirmation required via `<ConfirmModal>` (not `Alert.alert` — that no-ops on web). Available from EditCapsule and CapsuleDetail Danger Zone (Delete only — see Archive above). Owner-only.
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
3. **First capsule, pre-built.** A capsule card with inline-editable title, occasion-aware date chips (first chip pre-selected) + "Pick my own date" (expands the shared `DatePickerField`), and a surprise-mode promise line. "Create my capsule" runs `saveProfile()` then `create_capsule_with_owner(...)` (see "Key RLS Constraints") followed by `set_default_superlatives` best-effort. Always `owner_preview_locked: true`, `unlock_mode: 'time'`, 48h voting.
4. **Notification primer** (forward-only, reached only when a capsule was created). Names the user's capsule + date; "Yes, notify me" calls `requestPushPermission` (the app's only native-prompt call site); "maybe later" sets the `cap_notif_reprime:<userId>` AsyncStorage flag. On web the button is copy-only ("Sounds good").
5. **Sealed ceremony** (forward-only). Lock scale-in + `haptics.success()` + live countdown (30s tick). Actions: **Invite people** (`Share.share` of the `capsule://join/<id>` link; on failure/web falls back to navigating into the capsule where the full invite UI lives), **Add the first photo** (→ Camera tab), or "take me home".

Footer only exists for steps 1–3 (`Back` from 2–3; contextual `Next`/skip). Steps 4–5 render their own primary actions in-body. Don't render placeholder `<View>`s for missing footer buttons or they'll consume row width.

## Settings Screen (`SettingsScreen`)

**Appearance is tier-aware.** The preset swatch grid (`ACCENT_PRESETS`) is always shown. The shared `<ColorPicker>` (`src/components/ColorPicker.tsx`) and the gradient swatch grid (`ACCENT_GRADIENTS`) only render for `isPro`; a non-Pro user sees a single locked "Custom color & gradient themes" row (`disabled` while `entitlementsLoading`) that calls `proGateHit` instead. Tracks a `pending` color (local state) so the user can preview/cancel before committing — picking a gradient calls `setAccentGradient` directly (not staged in `pending`, since a gradient isn't a single hex). Save writes to `users.accent_color` via `ThemeContext.setAccentColor` and navigates back; the original color is passed as `originalValue` to `<ColorPicker>` to show a small "before" swatch. See "Theme System" for the gradient data model.

**Capsule Pro section** (native-only, `Platform.OS !== 'web'`) — reads `isPro` from `useEntitlements()`. Non-Pro: an "Upgrade to Capsule Pro" button (`presentPaywall()`) + a "Restore Purchases" row (`restorePurchases()`, toasts the result). Pro: a "Manage Subscription" row (`presentCustomerCenter()` — the RevenueCat-hosted manage/cancel/refund UI) instead. The Pro pitch line here is capability-only ("Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export") — no full-res/original-quality claim; see "Monetization" for the full purchase stack.

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

- **Trigger:** `pg_cron` job `unlock-capsules` runs `* * * * *` (every minute), gated behind an `EXISTS` check (PERFORMANCE.md #4, `20260709130000_cron_exists_gates.sql`) so the `net.http_post` — and thus the edge function cold start — only fires when `exists (select 1 from capsules where status='active' and unlock_mode='time' and unlock_at <= now() + interval '24 hours')`. The 24h window covers both an actual unlock **and** the widest (1-day) reminder tier below, so no tick that would have done work is ever skipped — this is a pure invocation-count optimization (~43K/month → near zero at idle), not a behavior change. Same pattern applied to `create-group-capsules` (gated on `groups.next_capsule_at <= now() and recurrence_paused_at is null` — the pause filter was added in `20260717190000_group_cron_gate_pause_filter.sql` after a paused-and-overdue group was found to make the gate permanently true, firing a wasted cold start every minute forever) and the `send-superlative-pushes` POST inside `close-superlative-windows` (gated on unpushed superlative notifications existing — evaluated after that tick's `dispatch_superlative_closing_soon()`/`close_superlative_windows()` calls, which stay unconditional since they're cheap in-database SQL). Re-registering a cron job to change its command is `select cron.unschedule(name)` then `select cron.schedule(name, schedule, command)`.
- **Countdown reminders:** the same function also fires pre-unlock reminder pushes at three tiers — **1 day / 1 hour / 10 minutes** before `unlock_at` (`dispatchReminders`, runs every tick regardless of whether anything unlocked). For each tier it does an atomic `update({ <tier>_sent_at: now }).is(<tier>_sent_at, null).gt('unlock_at', now).lte('unlock_at', now + tier).select()` — claiming+stamping in one statement so a tier sends **at most once** per capsule (race-safe). Stamp columns: `capsules.unlock_reminder_{1d,1h,10m}_sent_at` (migration `20260616000000_unlock_reminders.sql`). It inserts durable `unlock_reminder` notification rows (new type; `pushed_at` set since it pushes inline) and posts the Expo push. Body copy is derived from *actual* remaining time (`formatRemaining`), so it reads correctly ("tomorrow" / "in about 3 hours" / "in 10 minutes") even for short-lived capsules that enter a tier late. `time`-mode only, same as unlocking. Client renders `unlock_reminder` in `NotificationsScreen` (hourglass icon, taps through to the capsule).
- **Auth:** `Authorization: Bearer <CRON_SECRET>` required (`if (CRON_SECRET && auth !== ...)` in the function). The matching value is stored in Supabase Vault as `cron_unlock_capsules_secret`, and the cron command reads it at execution time via `(select decrypted_secret from vault.decrypted_secrets where name = 'cron_unlock_capsules_secret')`.
- **`CRON_SECRET` is a project-wide Edge Function secret, not per-function.** Once set anywhere in Dashboard → Functions → Secrets, every function in the project — existing or newly deployed — can read it via `Deno.env.get('CRON_SECRET')` immediately, with no per-function dashboard step. Confirmed during the Contribution Nudges rollout: `dispatch-contribution-activity` and `contribution-nudges` both correctly enforced 401 on a bad bearer token right after deployment, despite no secrets action having been taken for them specifically — the value set for `unlock-capsules` was already in scope. (An earlier version of this doc implied a manual per-function secrets step was required for every new cron function; that was based on an untested assumption and is corrected here.)
- **Idempotency:** the `.eq('status', 'active')` filter means repeat calls within a minute don't re-unlock or re-notify. The in-memory rate-limit (`lastCallTime`) in the function is dead code on edge runtimes — it doesn't survive cold starts — but doesn't matter because the work is idempotent.
- **Rotating the secret:** update Vault (`select vault.update_secret(secret_id, new_value)`) AND set the new value once in the project's Functions → Secrets (it's project-wide — see above, not per-function). Order doesn't matter for safety — each function uses module-load env, so a redeploy is needed per function to pick up the new value (deploying the same code via `mcp__supabase__deploy_edge_function` works).

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
- **The count comes from a SECURITY DEFINER RPC** `capsule_media_count(p_capsule_id)` (joined-member-authorized, returns 0 for non-members) because RLS now hides the rows themselves. `CapsuleDetailScreen.fetchPhotos` only calls it when the `media` row-read comes back with **zero rows** (the one case that's ambiguous — genuinely empty vs. RLS-hidden); whenever rows are readable, `mediaCount` is set directly from the fetched row count instead, skipping the round-trip. The locked box renders `mediaCount` (not `photos.length`, which is empty under the lock).
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
The HTTP call uses the same Vault secret (`cron_unlock_capsules_secret`) as the unlock cron. `CRON_SECRET` is a project-wide Edge Function secret (see "Unlock Cron" → Auth), so both functions read it automatically once it's set anywhere in the project — no separate per-function setup.

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
- **`isClosed` self-advances live at the `votingClosesAt` boundary.** It derives from a `nowTick` state (not a bare `Date.now()` read at render time), and a one-shot `setTimeout` (capped at ~23 days to dodge `setTimeout`'s 32-bit signed-int overflow, since the voting window can be up to 720h) bumps `nowTick` right when the window closes — so a user sitting on the screen sees "voting open" flip to "Tallying…" without needing some other event (realtime message, refocus, manual refresh) to trigger a re-render first.

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

## Groups

Named member sets with an optional recurrence schedule that auto-creates capsules — e.g. a family that wants a fresh time-locked capsule every month without anyone manually starting one.

**Schema:** `groups` (id, name, `created_by` → `users(id)` **on delete cascade**, `recurrence_interval` [`weekly`/`monthly`/`yearly`/`manual`], `unlock_duration_hours`, `next_capsule_at`, `last_capsule_at`, `created_at`, `anchor_weekday`/`anchor_day_of_month`/`anchor_month`/`anchor_day`/`anchor_hour`/`anchor_minute`, `recurrence_paused_at`, `reminder_lead_hours`, `next_reminder_sent_at` — see "Fixed calendar anchors, pause/resume, and reminders" below); `group_members` (`group_id`, `user_id`, `joined_at`, unique on the pair); `capsules.group_id` — nullable FK, set on any capsule (manual or cron-created) that originated from a group.

**Group creation goes through the `create_group_with_creator(...)` RPC** (`20260718091000_create_group_with_creator.sql`), not a direct client insert — the same fix `create_capsule_with_owner` applies to capsules (see "Key RLS Constraints"). `createGroup()` (`src/lib/groups.ts`) used to insert the `groups` row and the creator's `group_members` row as two separate requests; a failure on the second left the group orphaned with zero members, and since the `groups` SELECT policy is membership-gated via `get_my_group_ids()`, that group became permanently invisible to everyone, including its creator. The RPC does both inserts in one `security definer` function body so either insert raising rolls back the whole thing. It generates the group's UUID server-side and returns it; the client no longer generates it with `randomUUID()`.

**RLS:** `get_my_group_ids()` (SECURITY DEFINER) avoids recursion on the `group_members` SELECT policy, same pattern as `get_my_capsule_ids()`. **`group_members` INSERT is creator-only**, enforced via `is_group_creator(p_group_id)` (SECURITY DEFINER). The original policy also allowed `user_id = auth.uid()` — self-insert — which was a real privilege escalation: `capsules.group_id` is a plain readable column on every group capsule, and `get_my_capsule_ids()` includes *pending* (not-yet-accepted) memberships, so being merely invited to one group capsule was enough to read the group's UUID and self-join it, thereafter auto-joining every future recurring capsule too. Closed in `20260710000000_groups_rls_selfinsert_fix.sql`. **DELETE still allows creator-or-self** — leaving a group you're a member of is legitimate and untouched. `is_group_creator` and `check_cron_secret` (below) are out-of-band functions that existed only in the live DB with no prior migration — both captured verbatim in `20260710020000_capture_group_helpers.sql`; treat any future groups-related live/migration mismatch the same way (verify with `pg_get_functiondef` before assuming the migration is current).

**Auto-join is standing consent.** Joining a group means consenting to its future capsules — so every group capsule, whether started manually or by the cron, inserts other members already-joined (`joined_at` set at insert time), not as a pending invite requiring a separate accept. The `notify_on_invite` trigger (fires on every `capsule_members` insert) has two branches: the original — non-owner, `joined_at IS NULL` → `'invite'` notification (a real pending invite) — and a second — non-owner, `joined_at IS NOT NULL`, and the capsule has a `group_id` → a `group_capsule` notification (new `notifications.type`, added to `notifications_type_check`) instead. The two can never double-fire for the same row since `joined_at` is either null or not. `NotificationsScreen` renders `group_capsule` with a `people-circle-outline` icon and treats it as capsule-nav (tap → `CapsuleDetail`, same as unlock/reaction/superlative cards). The `send-invite-push` edge function (still used to actually deliver the push after either insert path) reads `capsule.group_id`/`groups(name)` and swaps its copy — a group capsule gets "New capsule for `<group>`" instead of "You were invited", since there's nothing to accept.

**`create-group-capsules` cron** (`supabase/functions/create-group-capsules`), triggered every minute like the other crons:
- **Claims each due group atomically first** — advances `next_capsule_at`/`last_capsule_at` gated on `next_capsule_at <= now()`, then only proceeds for rows the update actually matched (mirrors `unlock-capsules`' `dispatchReminders` claim-and-stamp). This is what makes overlapping ticks safe: a second concurrent tick's claim matches zero rows for a group already claimed this cycle.
- **Every insert after the claim is checked; failures roll back.** If the `capsule_members` insert fails (or the group has zero members to insert), the just-created capsule row is deleted and the claim is released (`next_capsule_at`/`last_capsule_at` reset to their pre-claim values) so the *next* tick retries instead of silently skipping a cycle or leaving a members-less capsule that RLS hides from everyone, including its own owner.
- **Seeds 4 default awards directly** — `superlative_categories` rows inserted with `status='live', is_default=true` from a `general`-occasion pool mirrored verbatim from `src/lib/awardPool.ts` (group capsules have no `occasion` column to pick a themed pool from, and the owner-gated `set_default_superlatives` RPC can't be called by the service role anyway).
- **Pushes chunked ≤100** via a local `sendExpoPush()` — same ≤100-slice pattern as `unlock-capsules`/`send-superlative-pushes`.
- **Titles are `"{name} — {Month Year}"` except weekly groups, which get day granularity** (`"{name} — July 20, 2026"`, via `capsuleTitleDate`) — a month-year title collides 4-5×/month for weekly recurrence (GROUPS.md #15).
- **Auth is Vault-backed, not env-var-backed**: `isAuthorized()` calls the `check_cron_secret(provided)` SECURITY DEFINER RPC (reads `vault.decrypted_secrets`), unlike `unlock-capsules`/`send-superlative-pushes`, which compare against a `CRON_SECRET` env var directly. Both styles currently coexist in this codebase.

**Manual create respects the schedule.** When a member manually starts a capsule for a group that has a real recurrence (not `manual`), `CreateScreen`'s group branch bumps `next_capsule_at` forward from now (via `updateGroup(groupId, { recurrence: group.recurrence_interval })`, with no `anchor` argument — `updateGroup` re-fetches the group's own stored anchor and recomputes via `computeNextOccurrence`, see below) right after creating the capsule — otherwise the cron would still fire on the old schedule and double up. Best-effort/non-fatal: worst case on failure is one extra capsule next cycle, not worth surfacing to the user over their own "Lock Capsule" tap. The capsule itself is owned by whoever tapped create, not necessarily the group's creator — an accepted asymmetry, not a bug.

**`CreateGroupScreen`** (`src/screens/app/CreateGroupScreen.tsx`) — progressive disclosure, same principle as `CreateScreen`'s "More options" **and using its exact visual pattern**: Name, Add Members, and the 4 recurrence chips stay always visible (recurrence is the group's defining choice), while the anchor picker, unlock duration, and reminder picker collapse behind a "Schedule details" toggle (rendered only when `recurrence !== 'manual'`) with a one-line collapsed summary built from `describeAnchor()` (exported from `RecurrenceAnchorPicker.tsx`, so the summary can never drift from the picker's own compact/preview text) + `unlockDurationLabel()` (`src/lib/groups.ts`). **The toggle is a plain row with no card/border** — an earlier version wrapped the disclosure body in its own bordered card, which nested redundantly around `RecurrenceAnchorPicker`'s own already-boxed card and read as "boxes inside boxes"; the revealed body is now just a flat `{ gap: 24 }` `View` whose children (`RecurrenceAnchorPicker`, and a `section`-styled group each for Duration and Reminder) carry their own internal `section` spacing, exactly mirroring `CreateScreen.tsx`'s "More options" body. **Default Unlock Duration is plain day presets, not a date picker**: 3 day-count chips (1 week/1 month/3 months) + a "Custom" chip that reveals a numeric days `TextInput` (raw text state, committed on blur or read directly on submit as a safety net) — an earlier iteration reused `DatePickerField` ("pick a date, derive the duration"), which was confusing and was replaced outright. A single "Create Group" button (the old header+bottom double-CTA was removed). `createGroup()` returns an optional `memberError: true` when the group + creator insert succeeded but the other-members bulk insert failed — the group is still usable (not treated as a hard failure), but the screen toasts "Couldn't add some members — add them from the group page." instead of silently dropping them. On success, navigates with `{ groupId, justCreated: true }`.

**Post-create nudge (`GroupDetailScreen`)** — when `route.params.justCreated && memberList.length === 1`, a dismissible "Add members" card renders above the meta card (mirrors `CapsuleDetailScreen`'s post-create invite nudge: same not-persisted route-param + local-state-only pattern, gone once dismissed or once a second member joins). Its "Add" button opens `ManageGroup` directly rather than a separate modal. Independently, the empty-capsules-list subtext reads "Your first capsule arrives `{date}` — or start one now." whenever the group has a computed `nextDate` (any active non-manual, non-paused schedule), not gated on `justCreated` — it's simply the correct copy whenever a schedule exists.

**`ManageGroupScreen`** (`src/screens/app/ManageGroupScreen.tsx`, route `ManageGroup { groupId }`, `animation: 'slide_from_bottom'`) — creator-only (bounces non-creators via `goBack()`), reached from a gear icon in `GroupDetailScreen`'s header (creator only, alongside the existing trash icon in `styles.headerActions`). Rename, change recurrence (same chip components as `CreateGroupScreen`), and a member list with debounced add-member search (excludes existing members and `blockStore.has(id)`, matching `InviteModal`'s pattern) and remove (trash icon → `ConfirmModal`; the creator can't be removed) all stay always visible. **Uses the identical "Schedule details" disclosure as `CreateGroupScreen`** (same `detailsToggle`/`detailsBody` styles, same flat unboxed body) to collapse everything else behind one toggle when `recurrence !== 'manual'`: the calendar anchor (`RecurrenceAnchorPicker`), reminder lead time (`ReminderLeadPicker`), an "Upcoming Capsules" preview + Pause/Resume toggle, and Default Unlock Duration (same day-preset chips as `CreateGroupScreen` — see above). The collapsed summary appends `· Paused` when the recurrence is paused, since that's status the user would otherwise have to expand to see. Wires up `updateGroup` / `addGroupMember` / `removeGroupMember` (`src/lib/groups.ts`), previously dead code with no UI caller. Invalidates `groups`/`group:${id}`/`group-members:${id}` on any mutation. Newly-added members only appear in *future* group capsules — existing active ones are not backfilled.

**`handleSave` only passes `recurrence`/`anchor` to `updateGroup` when the schedule actually changed** (compared against a snapshot taken at load time, `originalScheduleRef`) — `updateGroup` reschedules `next_capsule_at` and clears `next_reminder_sent_at` whenever `recurrence` is present in its args, so passing it unconditionally on every save (e.g. a pure rename) would re-arm that reset and risk a duplicate `group_capsule_upcoming` reminder if the save happens to land inside the group's lead window.

### Fixed calendar anchors, pause/resume, and reminders

A recurring group's schedule is a **fixed calendar anchor**, not "N days/months/years from whenever it last fired": weekly picks a weekday, monthly a day-of-month, yearly a month+day, and all three share a fixed time-of-day (`anchor_hour`/`anchor_minute`, captured once at creation — no time-picker UI, since the whole Groups UI only ever displays dates, never times).

- **`src/lib/recurrence.ts`** — pure module exporting `computeNextOccurrence(interval, anchor, from)` and `computeUpcomingOccurrences(interval, anchor, from, count)`. Clamps short months/non-leap-years (e.g. a day-31 monthly anchor lands on Apr 30, then correctly uses day 31 again in May — the clamp is recomputed fresh each cycle from the stored anchor, it doesn't stick). Verified via `src/lib/recurrence.test.ts`, a plain `node:assert/strict` script run with `npx tsx` (this repo has no test framework configured — deliberate, not a gap).
- **All anchor fields are UTC, and the math is UTC-only on both sides.** `recurrence.ts`'s `Date` construction/access is exclusively `Date.UTC`/`getUTC*`/`setUTC*` — never a local accessor/mutator — so `computeNextOccurrence` produces the same absolute instant regardless of which timezone the runtime is in. This is what keeps the client (device-local runtime) and the Deno cron (UTC runtime; Supabase's Postgres session is also UTC) in agreement without either side needing to know about the other's timezone. `CreateGroupScreen.defaultAnchor()` captures every field — weekday/dayOfMonth/month/day **and** hour/minute — from UTC getters (`now.getUTCDay()`/`getUTCDate()`/`getUTCMonth()`/`getUTCHours()`/`getUTCMinutes()`), including the calendar-day fields, which used to stay local; `ManageGroupScreen`'s seeded-anchor defaulting does the same. Don't reintroduce a local accessor on either side — the two copies (`src/lib/recurrence.ts` and `create-group-capsules`'s duplicate) must stay in sync.
- **Duplicated verbatim into `create-group-capsules`** (Deno can't import `src/lib`) — same precedent as that file's `GENERAL_AWARD_POOL` mirroring `src/lib/awardPool.ts`. Keep the two copies in sync.
- **Pause/resume** — `recurrence_paused_at` (null = active). `pauseGroupRecurrence`/`resumeGroupRecurrence` (`src/lib/groups.ts`). The cron's due-groups query filters `recurrence_paused_at is null`, so a paused group's `next_capsule_at` simply stops advancing — no backlog of missed cycles. Resuming recomputes `next_capsule_at` from *now* (not from wherever it was frozen), so it doesn't fire once immediately for every cycle missed while paused.
- **Upcoming-occurrences preview** is purely client-side (`computeUpcomingOccurrences`, no RPC) — both `GroupDetailScreen` (read-only "Next `<date>`" / "Paused" badge) and `ManageGroupScreen` ("Upcoming Capsules" list) call it directly off the group's own anchor columns. It recomputes from `anchor + now()`, not from reading back `next_capsule_at` — so it can't visually distinguish a successful reschedule write from a silently-failed one (a failed write still toasts; the preview just isn't a persistence confirmation).
- **Every pre-existing group only has the anchor sub-field for its *original* `recurrence_interval` populated** (the revamp migration backfills just that one field per group; switching to a different interval leaves the others unset). `RecurrenceAnchorPicker`/`ManageGroupScreen`/`CreateGroupScreen` all default missing sub-fields to today's date so switching intervals never leaves `computeNextOccurrence` with a required field missing (it throws otherwise) — this bit both the "Upcoming Capsules" render *and* `handleSave`'s `updateGroup` call before being fixed; any new call site that reads a group's anchor needs the same defaulting.
- **Reminders** — `reminder_lead_hours` (null = off; 24/72/168 = 1 day/3 days/1 week in the UI) and `next_reminder_sent_at` (dedupe stamp, reset to `null` everywhere `next_capsule_at` changes: `updateGroup`, `resumeGroupRecurrence`, and the cron's own claim). The cron's `processReminders()` pass (run *before* the capsule-creation pass each tick) claims due groups atomically (same claim-and-stamp pattern as the creation claim) and inserts a `group_capsule_upcoming` notification (new type; `capsule_id` null, `group_id` set) per joined member, pushed inline. Wrapped in its own try/catch — matches `unlock-capsules`' `dispatchReminders` isolation ("reminders are best-effort") so a reminder failure can never block that tick's capsule creation. `NotificationsScreen` renders it with a `calendar-outline` icon, tap → `GroupDetail`; the native push handler routes `data.groupId` the same way.

**Data-layer error handling** (`src/lib/groups.ts`) — `deleteGroup`/`removeGroupMember` return `{ error?: string }` rather than `Promise<void>`; `GroupDetailScreen`'s delete/leave handlers check it, toast on failure, and only navigate/invalidate on success (previously they proceeded unconditionally, so a failed delete still looked like it worked). `listMyGroups`/`getGroup`/`getGroupMembers` `console.warn` (rather than throw) on a fetch error and fall back to an empty result — a deliberate choice: `useCachedFetch` has no error/retry path for a throwing fetcher (a throw just yields `loading:false` + `data:null` plus an unhandled-rejection warning, not a retry prompt), so throwing here would only add noise without giving the user anything actionable.

**Ownership safety net (groups and capsules).** `groups.created_by` and `capsules.owner_id` are both `on delete cascade` to `users(id)` — deleting an owner used to silently delete every group or capsule they owned for every other member too, with no warning, even for one with years of history and (for capsules) real photos/videos from other people. `delete_my_account` handles both the same way: immediately before the final `auth.users` delete, every group the caller created (`20260710030000_delete_account_group_transfer.sql`) and every capsule the caller owns (`20260711170000_delete_account_capsule_transfer.sql`) is reassigned to another existing member — oldest-`joined_at`, deterministic — if one exists (for capsules, specifically another **joined**, not pending, member; the RPC also bumps that member's `capsule_members.role` to `'owner'`). Either kind with no other (joined) member needs no special handling — it still cascade-deletes/gets swept by the existing `delete from capsules where owner_id = v_uid` exactly as before, since "delete only if they were the last one" falls out of the existing logic once the transfer-if-possible case runs first. `SettingsScreen`'s delete-account copy (both the inline `Account` section helper text and the confirmation sheet body) mentions that owned capsules and groups are handed off rather than destroyed.

**Storage cleanup is server-side, inside `delete_my_account` itself** (`20260717120000_delete_account_server_storage_cleanup.sql`), not client-side. It used to run in `SettingsScreen`'s `confirm()` before the RPC call — a real data-loss bug with two failure modes: (a) if the RPC then failed, other users' photos were permanently destroyed while every DB row survived, and (b) even on RPC success it also wiped storage for capsules the RPC *transfers* (see above) rather than deletes, whose media rows — and thus other members' photos — are meant to survive. Storage cleanup can't simply be reordered to run *after* the RPC instead: once `delete_my_account` succeeds the auth user (and the client's JWT) is gone, so a follow-up storage call would 401. The fix: at the top of the function, before any mutation, it computes the exact `storage_key`/`thumbnail_key`/`alt_storage_key` set for media it's actually about to delete — media in owned capsules with **no other joined member** (these fall through to the cascade-delete, independent of the transfer loop's order) plus, when `p_delete_contributions`, the caller's own contributed media in *any* capsule (including ones being transferred) — and deletes those rows directly from `storage.objects` (`bucket_id = 'capsule-media'`), plus the caller's `avatars/<uid>/avatar.jpg` row. Deleting `storage.objects` rows directly (not via the storage API) is the accepted pattern for this kind of server-side cleanup; orphaned S3 blobs on an edge case are acceptable. `SettingsScreen.confirm()` is now just the RPC call — no client-side key collection or `storage.remove()`.

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

**Blocked-users management** — `BlockedUsersScreen` (`AppStack` route `BlockedUsers`, opened via a "Blocked Users" row in Settings' new "Privacy" section). Previously the *only* way to unblock someone was finding their profile again (impossible if you'd forgotten who, or if search/mutual-capsule paths no longer surface them). Resolves `blockStore`'s ID-only set into `display_name`/`avatar_url` via a `users` select (id-only `blockStore`/`useBlockedUsers` intentionally carry no profile data — this screen is the one place that needs it, so it fetches locally rather than growing the shared store). Unblock is direct (no confirm, mirroring `PublicProfileScreen`'s unblock) — optimistic remove, reinserts + toasts on failure.

---

## Friends

Explicit friend requests (`friendships` table). Previously "friends" was *derived* from shared capsule membership; it's now an accept/request relationship. Invites to capsules remain open to **anyone** — friends are just a convenience shortcut, not a gate.

- **Data layer** `src/lib/friends.ts` — `getFriendStatus(id)` → `'none' | 'friends' | 'incoming' | 'outgoing'`; `sendFriendRequest` / `acceptFriendRequest` / `removeFriendship` (one delete covers cancel/decline/unfriend); `listFriends` / `listIncomingRequests` / `listOutgoingRequests` (embed the *other* party's profile via the named FK, e.g. `users!friendships_requester_id_fkey`); `countFriends`. The unordered-pair `.or()` filter is `and(requester_id.eq.X,addressee_id.eq.Y),and(requester_id.eq.Y,addressee_id.eq.X)`. 23505 (duplicate pair) is treated as success.
- **`PublicProfileScreen`** — a friend button that adapts to the status (`Add Friend` → `Requested`/tap-to-cancel → `Accept Request` + `Decline` → `Friends`). **Unfriend** lives in the `⋯` overflow menu (alongside Report/Block). Status is fetched on mount.
- **`FriendsScreen`** (`AppStack` route `Friends`, opened by tapping the **Friends stat on `ProfileScreen`**) — a Requests section (Accept/Decline) + a Friends list (row → `PublicProfile`). The Profile `Friends` stat now counts accepted friendships via `countFriends()` (cache key `profile`; invalidate on accept/unfriend). A **Find people** entry (nav-bar `person-add` icon + a button in the empty state) opens an inline `FindPeopleModal`: a debounced `users` `ilike` search (mirrors `CreateGroupScreen`'s), excluding self + blocked, each row → `PublicProfile` (where Add Friend lives) — so the empty state is no longer a dead end.
- **Alerts tab** (`NotificationsScreen`) — `friend_request` rows render with inline **Accept/Decline** (act on `friendships` via `actor_id`, then mark the notification read); `friend_accept` rows tap through to the actor's profile. The notifications query embeds `actor:users!notifications_actor_id_fkey(...)`. A **"Mark all read"** header button (shown when >1 *clearable* card) bulk-marks read via one `.update({ read_at }).is('read_at', null).neq('type','invite').neq('type','friend_request')` — it deliberately **excludes** actionable invite/friend-request cards so it can't orphan a pending invite (the same trap the invite Decline button fixed).
- **Capsule invite search** (`InviteModal` in `CapsuleDetailScreen`) — a **Friends / Search** tab toggle. Friends tab lists accepted friends not already members (and not blocked); Search is the existing username search. Both use the same `invite()`.
- **Not built (deferred):** remote push for friend events — `friend_request`/`friend_accept` create durable in-app notifications only; no Expo push is sent yet.

---

## Contribution Nudges

Two retention-notification types, fully server-side (no client code needed to *detect* anything — only to render): a batched social-proof ping on upload, and a tiered reminder to non-contributing members as a capsule's contribution deadline approaches.

**Schema** (`20260715120000_contribution_nudges.sql`):
- `notifications.count` (nullable int) — the photo count carried by both new types.
- `notifications.type` gained `contribution_activity`. (`contribution_nudge` was already a reserved-but-unused value in the `notifications_type_check` constraint before this migration — a leftover placeholder from earlier planning — so only `contribution_activity` was genuinely new. Verified against production's live constraint before migrating, per the pattern in "Key RLS Constraints": production had already drifted to include `group_capsule_upcoming` ahead of this branch's git history; the migration's type list was written as a superset of the live constraint, so no mismatch was introduced.)
- `capsule_members.contribution_nudge_7d_sent_at` / `_3d_sent_at` / `_1d_sent_at` (nullable timestamptz) — per-member, per-tier dedupe stamps.
- `contribution_activity_pending` (capsule_id, uploader_id — composite PK; photo_count, last_upload_at) — debounce staging table. RLS enabled with **no policies** (deny-all to clients); only the trigger below (SECURITY DEFINER) and the service-role edge function touch it.

**Trigger:** `notify_contribution_activity()` (SECURITY DEFINER) fires AFTER INSERT on `media` and upserts the staging row — `on conflict (capsule_id, uploader_id) do update set photo_count = photo_count + 1, last_upload_at = now()`. This is what lets a burst of uploads collapse into one notification instead of one per photo.

**RPCs** (both SECURITY DEFINER, execute revoked from `public`/`anon`/`authenticated` — internal-only, matching the established pattern for `dispatch_superlative_closing_soon` etc.):
- `claim_contribution_nudge_tier(p_tier text)` — `p_tier` is `'7d'` / `'3d'` / `'1d'`. One atomic `UPDATE ... RETURNING` per tier: claims joined `owner`/`contributor` members with **zero uploads** on capsules whose *effective deadline* (`coalesce(contribution_lock_at, unlock_at when unlock_mode in ('time','both'))`) falls inside that tier's window, and stamps the matching `_sent_at` column in the same statement — race-safe against overlapping cron ticks, same shape as `unlock-capsules`' `dispatchReminders`. **The three tiers' windows overlap** (each is "`<= now() + interval 'Xd'`", not a disjoint band) — a capsule whose deadline is already close the first time it's ever evaluated can legitimately match all three tiers in one tick (verified live in production: a fresh capsule with a 20-hour-out deadline stamped `7d`/`3d`/`1d` in the same cron run). Accepted, same reasoning as `unlock-capsules`' own overlapping reminder tiers — better to send a late tier than never.
- `top_contributors(p_capsule_id uuid)` — every uploader on a capsule, ordered by `photo_count desc`. Used to build the "X added N photos, you haven't added any yet" comparison copy; a nudge recipient can never appear in this list (recipients are by definition zero-upload members).

**Cron jobs** (`20260715120100_contribution_nudges_cron.sql`) — both `* * * * *`, EXISTS-gated (PERFORMANCE.md #4 pattern), Vault-backed `CRON_SECRET` auth via the same `cron_unlock_capsules_secret` entry every other cron reads (see "Unlock Cron" — this secret is project-wide, not per-function):
- **`dispatch-contribution-activity`** → `supabase/functions/dispatch-contribution-activity`. The cron's EXISTS gate and the function's own claim (`DELETE ... RETURNING` on `contribution_activity_pending`) both check `last_upload_at <= now() - interval '2 minutes'` — a 2-minute debounce, so a member uploading several photos in quick succession still produces one ping, not several. Filters out uploaders the recipient has blocked via `blocked_users`. Inserts one `contribution_activity` notification per (non-blocked) recipient and pushes inline (`pushed_at` set at insert).
- **`contribution-nudges`** → `supabase/functions/contribution-nudges`. Loops the three tiers, calls `claim_contribution_nudge_tier`, groups claimed members by capsule so `top_contributors` is called once per capsule (not once per member), and for each recipient picks the first top contributor they haven't blocked. Falls back to "nobody's added photos yet — don't be the one holding it up" copy (`actor_id: null`, `count: null`) when there's no unblocked top contributor — verified live against a zero-media test capsule.
- Both duplicate a local `sendExpoPush()` chunked to ≤100 messages, per this codebase's established per-function-duplication convention (see "Push Notifications").

**Client rendering** (`NotificationsScreen.tsx`) — both types are capsule-nav (tap → `CapsuleDetail`). `contribution_activity` uses an `images-outline` icon and reads "`<actor.display_name>` added `<count>` photo(s) to `<capsule title>`". `contribution_nudge` uses an `hourglass-outline` icon and reads either the top-contributor comparison (when `actor_id` is set) or the "nobody's added photos yet" line (when it's null). Both colored `accentColor`.

**Shipped to production** (`ezxxvvmesegegkdeniri`) via the two migrations above plus edge functions `dispatch-contribution-activity` and `contribution-nudges` (both `verify_jwt: false`, matching `unlock-capsules`/`send-superlative-pushes`/`create-group-capsules`) — verified end-to-end against live data (not just a test branch) before this doc was written: a real `media` insert produced a `contribution_activity` notification via the live cron within its debounce window, and a disposable test capsule with a near-term deadline produced `contribution_nudge` notifications with correctly-stamped tier columns.

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

## Monetization (RevenueCat)

Full strategy/pricing rationale lives in `docs/monetization-strategy.md`. This section covers the shipped plumbing — a single paid tier, **Capsule Pro** — not the roadmap (Event Pass, Premium, etc. are not built). **Tier copy never promises full-res/original-quality media or filters** — every photo is resized to 1920px for everyone regardless of tier (see "Image Loading"/upload pipeline); what Pro actually adds around media is capacity (caps below) and bulk **download** (ZIP export, below), never higher per-photo quality.

### Client stack
- **`src/lib/purchases.{native,web,ts}`** — the only module that talks to the RevenueCat SDK; every call site goes through it so the SDK is configured exactly once and the entitlement id lives in one place. Same platform-split idiom as `usePushNotifications`/`useShareIntent` (`.native.ts` real impl, `.web.ts` no-op stub, bare `.ts` re-exports the web stub for TS resolution). `PRO_ENTITLEMENT_ID = 'Capsule Pro'` — must match the RevenueCat dashboard entitlement **exactly** (case-sensitive) or `isProActive()` is always false.
  - `configurePurchases()` — idempotent, configures the SDK anonymously. `identifyUser(userId)` / `resetUser()` — `Purchases.logIn`/`logOut`, tie the RevenueCat app-user id to the Supabase user id (needed for the webhook below to map purchases back to a row, and for Pro to follow a user across devices/reinstalls).
  - `presentPaywall()` / `presentProPaywallIfNeeded()` — the RevenueCat-hosted paywall (built in the dashboard's Paywall AI Editor, attached to the `default` offering). `presentCustomerCenter()` — the drop-in manage/cancel/restore UI, wired to Settings' "Manage Subscription" row.
  - `purchasePackage(pkg)` / `restorePurchases()` — escape hatches for a fully custom paywall; not currently used (the hosted paywall covers both screens that need it).
  - **Client-side entitlement checks are UI-only.** The real gate is server-side (see webhook below) — never trust `isProActive()`/`isPro` for anything a malicious client could bypass.
- **`useRevenueCat(userId?)`** (`src/hooks/useRevenueCat.ts`) — called once from `App.tsx` (`useRevenueCat(session?.user.id)`, alongside `usePushNotifications`). Configures the SDK on mount, then `identifyUser`/`resetUser` whenever the signed-in user id appears/changes/disappears — mirrors `usePushNotifications`'s lifecycle exactly.
- **`useEntitlements()`** (`src/hooks/useEntitlements.ts`) — returns `{ isPro, loading, customerInfo, refresh }`. Reads `CustomerInfo` on mount and subscribes to the SDK's update listener (fires on purchase/restore/renewal/expiry), so any screen using this hook reflects a paywall purchase made anywhere else in the app with no manual refetch. Web returns `{ isPro: false, loading: false }` via the stub.

### Server-side gate
**`supabase/functions/revenuecat-webhook`** — the actual source of truth. RevenueCat POSTs entitlement lifecycle events here; the function maps `event.type` to a `users.subscription_tier` write (`'free'` | `'pro'`, the pre-existing column — see Database Schema):
- **Auth is a shared secret**, not `CRON_SECRET` — RevenueCat sends the value configured as the webhook's "Authorization header" verbatim; the function compares it against the `REVENUECAT_WEBHOOK_SECRET` Edge Function secret and fails closed (401) if either side is unset/mismatched. Deployed with `verify_jwt: false` (RevenueCat doesn't send a Supabase JWT).
- `event.app_user_id` is the Supabase `users.id` UUID, because `identifyUser()` always logs the client in with that id — a regex guards against writing to anonymous RevenueCat ids (`$RCAnonymousID:...`) if one ever leaks through.
- **GRANT set** (`INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` [lifetime], `SUBSCRIPTION_EXTENDED`) → `'pro'`. **REVOKE set** (`EXPIRATION`, `SUBSCRIPTION_PAUSED`) → `'free'`. `TRANSFER` (entitlement moved between app-user-ids, e.g. anonymous→identified on first `logIn`) grants the destination id(s) and revokes the origin id(s). `CANCELLATION`/`BILLING_ISSUE` are deliberately **no-ops** — auto-renew-off or a billing grace period still means the user is entitled until an actual `EXPIRATION` arrives.
- Any code that gates a feature by subscription tier reads `users.subscription_tier` (server-side, un-bypassable) for the two hard gates, and the client mirrors the same limits for UX — see "Tier enforcement" below.

### Post-unlock upsell
`CapsuleDetailScreen` shows a dismissible nudge — not an auto-popped paywall, which would step on the reveal moment — to a non-Pro owner once their capsule has unlocked ("Keep it forever with Pro" → `presentPaywall()`). Same visual/dismissal pattern as the existing post-create invite nudge: dismissal persists per-capsule via AsyncStorage (`cap_pro_nudge_dismissed:<capsuleId>`), native-only.

### Pro status badge
**`<ProBadge size?: 'sm'|'md'>`** (`src/components/ProBadge.tsx`) — a small decorative "PRO" pill; it takes no data prop, just `size`. Every call site fetches the *subject's* own tier and decides whether to render it, not the badge itself: own `ProfileScreen` (`isPro` from `useEntitlements()`, `size="md"`), `PublicProfileScreen` (`profile.subscription_tier === 'pro'`, `size="md"`), `HomeScreen` capsule cards next to the **owner** (`capsule.owner.subscription_tier === 'pro'`, via the same `owner:users!capsules_owner_id_fkey(...)` embed the tier gates use), and `CapsuleDetailScreen`'s members sheet next to an owner row (`m.role === 'owner' && ownerTier === 'pro'`).

### Capsule export (ZIP)
Owner-only, owner-**Pro**, unlocked-capsules-only — "download your whole capsule" (the actual Pro perk; not a quality upgrade, see the note above). Entry point is an "Export" affordance in `CapsuleDetailScreen`'s Media header, gated on `isOwner && capsule.status === 'unlocked' && isExportSupported() && photos.length > 0`; a non-Pro owner's tap runs the same `proGateHit` limit-sheet pattern as every other tier gate (never jumps straight to the paywall).
- **`src/lib/exportCapsule.{native,web,ts}`** — same platform-split idiom as `usePushNotifications`/`purchases` (`.native`/`.web` real impls, bare `.ts` TS-resolution fallback). `exportCapsule({ title, items, onProgress })` downloads each item's signed URL and zips the result.
  - **Native** zips to disk via `react-native-zip-archive`: streams each remote file into a temp `FileSystem.cacheDirectory` working dir first (never through the JS bridge as one buffer — safe for large capsules), zips the dir, then shares the `.zip` via `expo-sharing`. **Needs a full dev/EAS build — the native module is absent in Expo Go.** `isExportSupported()` eagerly probes `TurboModuleRegistry`/`NativeModules` for `RNZipArchive` (a bare `require()` isn't enough proof — the JS wrapper resolves the native module lazily at call time, same gotcha as `modules/expo-dual-camera`'s eager-probe pattern), so the Export button is hidden rather than shown-then-crashing when unlinked.
  - **Web** zips in-memory via `fflate` and triggers a browser download; `buildZipBlobParts` is exported from the native module too (for signature parity) but throws — the native path never needs it.
- **`src/components/ExportProgressModal.tsx`** — a `{ visible, done, total }` progress modal shown while `exportCapsule` runs.

### RevenueCat dashboard configuration
Project `proj72b0a2e3`. Entitlement `entl2d972407b4` (lookup key `Capsule Pro`). Offering `default` (`$rc_monthly` / `$rc_annual` / `$rc_lifetime` packages → products `monthly` / `yearly` / `lifetime`), with a published dashboard-built paywall attached.

**Two RevenueCat apps exist, same products/offering/entitlement shared across both:**
- **Test Store** (`app3febbe6182`) — the fallback key baked into `purchases.native.ts` (`FALLBACK_TEST_KEY`, `test_...`). Drives fake purchases with no real StoreKit involved — good for exercising the full client→webhook→DB pipeline (paywall render → purchase → `isPro` flips → webhook fires → `subscription_tier` updates), useless for verifying real App Store product config.
- **Capsule iOS** (`app7b40141214`) — the real App Store app, connected to App Store Connect via an ASC API key (Key ID + Issuer ID + `.p8`, configured in the RevenueCat dashboard — not exposed through any RevenueCat API, dashboard-only). Its public SDK key goes in `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (set in `.env` for local dev and as an EAS production secret via `eas env:create`).

**Real product pricing** (monthly $4.99, yearly $39.99, lifetime $79.99, full ~180-territory equalization from the US price) is live in App Store Connect for all three products. **⚠️ Known blocker:** real purchases will fail until Apple's one-time rule clears — *the first-ever In-App Purchase/subscription for an app must be submitted attached to an app version through App Store Connect's UI*, not via any API. Until someone does that (App Store Connect → app version → "In-App Purchases and Subscriptions" → attach `monthly`/`yearly`/`lifetime` → submit the version for review), only the Test Store key produces working purchases. After that first approval, all three products (and any future ones) become fully manageable via RevenueCat's API/dashboard with no further app-version dependency.

### Tier enforcement

The free-tier caps from `docs/monetization-strategy.md` are enforced. All limits live in one config, **`src/lib/tierLimits.ts`** — `TIER_LIMITS: Record<Tier, TierLimits>` (`Tier = 'free' | 'pro'`, extensible to `'premium'`), with `limitsForTier(tier)` (unknown/null → `free`, fail-safe) and `tierFromIsPro(isPro)`. Current values — free: `{ activeCapsules: 3, membersPerCapsule: 10, photosPerCapsule: 20, videoSeconds: 30 }`; pro: `{ Infinity, 50, 1000, 120 }`. **Never hardcode a limit elsewhere.** The `3` is also inlined in the `create_capsule_with_owner` RPC (SQL can't import TS) with a sync-comment — keep both in step.

**All caps key off the capsule OWNER's tier, never the acting user's** ("monetize the host, guests never pay"): a Pro host unlocks video length + higher caps for every member of their capsule including free guests. The owner's tier reaches the client via an `owner:users!capsules_owner_id_fkey(subscription_tier)` embed on the capsule fetch (`CapsuleDetailScreen` exposes `ownerTier` in render scope; `subscription_tier` is a client-readable `users` column).

**Owner-vs-guest rule** — centralized in **`src/lib/proGate.ts`**: `proGateHit({ currentUserIsHost, guestMessage })` → host sees `presentPaywall()` (upgrading lifts the cap); a **guest** sees `toast.show(guestMessage)` only, **never a paywall** (a guest upgrading wouldn't lift a host-based cap). Every guest-capable gate passes `currentUserIsHost: isOwner`; create-time gates (capsules, groups) always pass `true` (the current user is the prospective owner).

**The five gates:**
- **Active capsules** (3 → ∞): server-hard in `create_capsule_with_owner` (raises `CAPSULE_LIMIT_REACHED` for a free host owning 3 non-unlocked capsules) + client pre-check in `CreateScreen`/`OnboardingScreen` that shows the paywall and maps that error string.
- **Recurring groups** (manual-only → any recurrence): server-hard in `create_group_with_creator` (raises `GROUP_RECURRENCE_PRO`) + client gate in `CreateGroupScreen` (`createGroup` threads the error code out).
- **Members/capsule** (10 → 50): client, `InviteModal` (owner→paywall / guest→toast) + `NotificationsScreen` accept path (guest→toast, stays pending; the count **excludes the accepting user's own pending row** to avoid a self-count deadlock at the boundary).
- **Photos/capsule** (20 → 1000): client, at upload enqueue. `CapsuleDetailScreen` blocks the whole batch using its `mediaCount` (fed by the `capsule_media_count` RPC); `PreviewScreen` skips only the over-cap targets and **must use `capsule_media_count` per selected capsule, not a `media(count)` embed** — the `media` SELECT RLS hides rows under surprise mode (the default), so an embed count reads 0 and silently defeats the cap.
- **Video length** (30s → 120s): client only (duration isn't stored server-side). `CameraScreen` resolves the record cap from the target capsule's owner tier (or the current user's for a new capsule); `CapsuleDetailScreen.filterOversizedVideos` from `ownerTier`.

**Entitlements-loading rule:** `useEntitlements()` starts `{ isPro: false, loading: true }` until an async fetch resolves. Any client gate that reads the current user's own `isPro` must **not** fire while `loading` — gate on `!entitlementsLoading && !isPro` (creation/group gates skip the client pre-check and let the RPC decide) or default to the **permissive** cap (video length defaults to 120s until the tier is known). Otherwise a genuine Pro user is briefly false-gated. Gates that read a fetched `ownerTier` (members, photos, library video) have no such race.

**Accepted limitations:** members/photos/video caps are client-only (bypassable by a modified client — the two create-RPC gates are the un-bypassable ones); the client photo/member checks are fail-open on a transient count-query error (the RPC re-enforces capsule count; photos/members have no server backstop, an accepted trade).

---

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`. Use this instead of `crypto.randomUUID()` — `crypto` global is not reliably typed in the Expo TS config.
- `src/lib/haptics.ts` — `haptics.{light,medium,heavy,selection,success,warning,error}()`. Central wrapper over `expo-haptics`; no-ops on web and swallows errors so call sites need no platform guard. **Use this for all tactile feedback** rather than importing `expo-haptics` directly. Wired into: tab bar taps (light; camera button medium), camera shutter (medium), reactions (light), notification accept (success) / decline (light), Home layout toggle (selection), and `DatePicker` (its local `haptic()`/`hapticSelection()` now delegate to this wrapper rather than calling `expo-haptics` directly).
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient }`. `ThemeProvider` must wrap the app. See "Theme System" for the gradient (Pro cosmetic).
- `src/lib/sessionStore.ts` — `sessionStore.get()` / `sessionStore.set()`. Module-level session cache, updated by `useAuth` on every `onAuthStateChange` event. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()` inside screens.** `getSession()` on web hangs when the access token is expired because it blocks on an internal refresh network call. `sessionStore.get()` is synchronous and never hangs.
- `src/lib/toast.ts` — `toast.show(message, action?)`. Module-level global toast, rendered by `<ToastHost>` (mounted once near the app root, so it survives navigation). `action` is optional: `{ label: string; onPress: () => void }` renders a tappable inline action (e.g. "Undo") next to the message — tapping it fires `onPress` then dismisses the toast immediately, same as the auto-dismiss timer. Used for the archive/restore Undo (see "Owner-Only Capsule Actions"). **Rule: any user-initiated mutation that fails must toast** — a background write with no feedback on error becomes a mystery bug report ("my restore didn't work") that can't be reproduced. Swept across `persistRead` (NotificationsScreen), `setAccentColor`/`setHomeLayout` (ThemeContext), the per-member `send-invite-push` loop and `set_default_superlatives` call (CreateScreen) — all previously silent on failure.

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
- `group:${id}`, `group-members:${id}`, `group-capsules:${id}`, `groups` — GroupDetailScreen / HomeScreen / ManageGroupScreen (see "Groups" section above for the full feature). `listMyGroups`/`getGroup` (`src/lib/groups.ts`) fetch `memberCount` via a PostgREST embedded `group_members(count)` aggregate in the *same* query (PERFORMANCE.md #6) — one round-trip, no member-row payload, instead of a second query that pulled every member row just to count them.

**Invalidation pattern:** screens that mutate data call `cache.invalidate()` with all affected keys. Example: creating a capsule invalidates `capsules` and `profile` (stats changed). Uploading/deleting media or a capsule unlocking invalidates both `signedUrls:${id}` and `media:${id}` together — invalidating only the signed-URL cache while `media:${id}` is one mutation site is not enough.

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
succeeds iff a normal upload to that destination would. The three caches are
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

`SignUpScreen` collects only email and password — **no display name**. Display name is collected in Onboarding Step 1 (the first screen after sign-up). This avoids asking for the name twice.

**`handle_new_user` does NOT leave `display_name` null** — this doc previously claimed it did, which was wrong and caused a real bug (see "Apple Sign In" → name auto-fill). The live trigger is `coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'user'), '@', 1))` — with no `display_name` key in `raw_user_meta_data` (true for email signup, Google, and Apple), it falls back to the **local part of the email**. For a normal email signup this is harmless today only because nothing reads `users.display_name` back before `OnboardingScreen`'s own `saveProfile()` overwrites it — the local `displayName` state starts blank (`useState('')`) regardless of what's in the DB. Any new code that reads `users.display_name` before onboarding completes (like Apple Sign In's pre-fill) **will** see this fallback value, not null. For Apple's private-relay email (`4n66rhjb5j@privaterelay.appleid.com`) that fallback is a random-looking string — exactly what a real user saw in production before this was fixed.

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

## Native Patches (`patches/`)

`patch-package` runs from the `postinstall` script (so EAS applies patches on
every build). ⚠️ **A patch to React Native's iOS core source only takes effect
if RN is actually built from source.** Expo SDK 54 ships React as a
**precompiled `React.framework`** by default (`RCT_USE_PREBUILT_RNCORE=1`) —
a patched `RCTTurboModule.mm` in node_modules is then never compiled and the
crash it fixes ships anyway (this happened: build 24 contained the pristine
prebuilt framework and crashed identically; proven by downloading the IPA and
finding zero patch strings in the binary). `eas.json`'s production profile
sets `RCT_USE_PREBUILT_RNCORE=0` so React builds from source and the patch is
real. Cost: slower iOS builds (~5min → ~15-20min). If that env var is ever
removed, the patch below silently stops applying — when in doubt, download
the IPA and `strings` the React binary for `suppressed (would corrupt JS
runtime off-thread)`. Current patches:

- **`react-native+0.81.5.patch`** — `RCTTurboModule.mm`: an `NSException`
  thrown inside an **async void** TurboModule method used to be converted to a
  JS error *on the TurboModule thread* and thrown through a dispatch block —
  the off-thread runtime access races the JS thread and corrupts the Hermes
  heap (observed in production: SIGSEGV in `HiddenClass::addProperty` on iOS
  26.5.2 when adding camera-roll media to a capsule). The patch makes the
  async-void catch `NSLog` + continue (`[TurboModule] NSException in async
  void method …` in the device console names the thrower); the sync path is
  unchanged. Upstream is open with no fix (facebook/react-native#54859,
  expo/expo#44606) — when bumping React Native, check whether the void path
  got the `isSync`-gated treatment and drop the patch only if it did.

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_REVENUECAT_IOS_KEY=...      # appl_... — falls back to a Test Store key if unset, see "Monetization"
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=...  # goog_... — not yet configured (no Android app in RevenueCat yet)
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
