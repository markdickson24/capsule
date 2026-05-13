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
- **TypeScript** ~5.9

### Project Structure

```
src/
  hooks/
    useAuth.ts              # Session listener, returns { session, loading }
    usePushNotifications.ts # Token registration + notification tap routing
  lib/
    supabase.ts             # Supabase client (platform-split storage adapter)
    uuid.ts                 # randomUUID() helper
    googleAuth.ts           # signInWithGoogle() via expo-auth-session
    navigationRef.ts        # Imperative nav ref for use outside components
  navigation/
    AppNavigator.tsx        # Tabs + stack screens, CustomTabBar
    AuthNavigator.tsx       # Welcome → Login → SignUp
  screens/
    auth/  WelcomeScreen, LoginScreen, SignUpScreen
    app/   HomeScreen, CreateScreen, CapsuleDetailScreen, CameraScreen,
           PreviewScreen, NotificationsScreen, ProfileScreen, PublicProfileScreen
  types/
    navigation.ts           # AuthStackParamList, AppTabParamList, AppStackParamList
    database.ts             # Capsule and other DB row types
```

---

## Auth Flow

`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`. `App.tsx` renders `AuthNavigator` or `AppNavigator` based on session presence. Loading state blocks rendering until session is confirmed (Supabase session restore is async).

**Auth methods:** email/password (`supabase.auth.signInWithPassword`) and Google OAuth (`src/lib/googleAuth.ts` — uses `expo-auth-session` + `expo-web-browser`, extracts tokens from redirect URL, calls `supabase.auth.setSession`).

**Platform split in `src/lib/supabase.ts`:** on web, Supabase uses `localStorage` (default). On native, `expo-secure-store` is used via a custom async adapter. Do not use the async adapter on web — it causes the JWT to not be attached to requests.

**Always use `getSession()` instead of `getUser()`** when you just need the user ID or token. `getUser()` makes a live network request on every call (500ms–2s latency). `getSession()` reads from local storage instantly.

---

## Navigation Structure

```
RootNavigator (App.tsx)
  AuthNavigator  →  Welcome, Login, SignUp
  AppNavigator
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
```

**`navigationRef`** (`src/lib/navigationRef.ts`) — a `NavigationContainerRef` used for imperative navigation from outside components (e.g. push notification tap handler). Poll `navigationRef.isReady()` before calling `.navigate()`.

---

## Key RLS Constraints

**Capsule insert:** do not chain `.select()` on the insert. The SELECT policy checks `capsule_members` for membership, but the member row doesn't exist yet at insert time — this causes a 403. Pattern: generate UUID client-side with `randomUUID()`, insert capsule without `.select()`, then insert the member row separately.

**`capsule_members` policies use security definer functions** to avoid infinite recursion:
- SELECT: `get_my_capsule_ids()` — returns capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — checks ownership via `capsules` table

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or use the `capsules` table directly.

All RLS policies use `(select auth.uid())` not `auth.uid()` directly — avoids query planner issues.

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

**`createSignedUrls` response:** map by array index, not `item.path`. Use `signedData?.[i]?.signedUrl`. Signed URLs expire after 3600 seconds.

**Avatar upload path:** `${userId}/avatar.jpg` with `upsert: true`.
**Media upload path:** `${capsuleId}/${randomUUID()}.${ext}`.

---

## Database Schema

Defined in `supabase-schema.sql`.

| Table | Key columns |
|---|---|
| `users` | id, email, display_name, bio, avatar_url, push_token, auth_provider, subscription_tier, created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending) |
| `media` | id, capsule_id, uploader_id, storage_key, media_type (photo/video), size_bytes, thumbnail_key, uploaded_at, is_flagged |
| `reactions` | id, media_id, user_id, emoji, created_at — unique (media_id, user_id) |
| `notifications` | id, user_id, capsule_id, type (invite/unlock/reaction/contribution_nudge/milestone), sent_at, read_at |

**Triggers:**
- `handle_new_user()` — auto-creates `users` row on `auth.users` insert
- `notify_on_reaction()` — inserts reaction notification (not to self)

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

---

## Preview Screen (`PreviewScreen.tsx`)

- Shows photo or looping video before adding to a capsule
- Fetches user's active capsules (non-unlocked, where role is owner or contributor and `joined_at` is not null)
- Capsule selection via horizontal chip scroll; selected chip is orange
- Swipe down > 100px triggers discard confirmation modal
- Upload mirrors `CapsuleDetailScreen` upload logic (web: arrayBuffer, native: FileSystem.uploadAsync)
- `media_type` in the DB insert correctly passes `route.params.mediaType` — photos and videos are stored with the right type

---

## Push Notifications (`usePushNotifications.ts`)

- Called from `App.tsx` with `userId` from session
- Registers Expo push token (native only) and stores in `users.push_token`
- Notification tap handler: reads `data.capsuleId` or `data.screen` from notification payload, navigates via `navigationRef`
- Notification display config: `showAlert`, `playSound`, `showBanner`, `showList` all true
- Invite notifications are sent client-side from `CapsuleDetailScreen.sendInviteNotification()` via `https://exp.host/--/api/v2/push/send`
- Reaction notifications are created server-side by the `notify_on_reaction` trigger

---

## CapsuleDetailScreen Key Patterns

Large file (~1250 lines). Key sub-components and patterns:

**`ProgressRing`** — pure RN circular progress indicator. Two-half-clip technique: each half uses a full ring with two adjacent border colors (orange + track) clipped to its side, rotated to reveal the correct amount.
- Right half: `borderTopColor + borderRightColor = orange`, rest = trackColor
- Left half: `borderBottomColor + borderLeftColor = orange`, rest = trackColor
- Rotation formula: `rightRot = -135 + min(deg, 180)`, `leftRot = -135 + max(deg - 180, 0)`
- **Do not use `borderColor: 'transparent'`** — causes a dark rendering artifact on iOS at the color transition point. Always set all 4 border colors explicitly.

**`CountdownRing`** — wraps `ProgressRing` with lock icon, countdown text, unlock date. Updates every 60s via `setInterval`. Progress = `timeRemaining / (unlock_at - created_at)`, falls back to 1-year total if `created_at` unavailable.

**`InviteModal`** — user search with 300ms debounce (min 2 chars), sends push notification to invited user client-side.

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis is locked on first movement (prevents diagonal). Vertical swipe > 120px or velocity > 1.5 closes modal.

**Real-time:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules` table. On status → 'unlocked': triggers reveal animation + refetches media.

**Upload flow:**
- Web: `fetch(uri) → arrayBuffer → supabase.storage.upload()`
- Native: `FileSystem.uploadAsync` with `Authorization` + `apikey` headers
- After all uploads: refetches media via `fetchPhotos()`

---

## Media Grid Layout

For equal-width thumbnail rows, use `flex: 1, aspectRatio: 1` — **not** `width: Dimensions.get('window').width / 3`. Dimensions doesn't account for parent padding. Set `gap` on the row container.

"+N more" overlay: count is `photos.length - 2` (not `- 3`) because the overlaid photo is itself not fully visible.

`MediaGalleryModal`: `FlatList` with `numColumns={3}`, `columnWrapperStyle={{ gap: 2 }}`, `ItemSeparatorComponent` for row gaps.

---

## iOS / Web Layout Gotchas

- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `flex: 1` + `aspectRatio`.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — always guard with `Platform.OS !== 'web'`. Use `expo-file-system/legacy` import path.
- `Alert.alert` does not work reliably on web — use inline error state rendered as `<Text>`.
- `DateTimePicker` with `display="spinner"` renders the native iOS wheel picker. Use `Platform.OS === 'web' ? 'default' : 'spinner'` for cross-platform.

---

## Design System

Dark theme throughout.

| Token | Value |
|---|---|
| Primary (orange) | `#FF6B35` |
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

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`. Use this instead of `crypto.randomUUID()` — `crypto` global is not reliably typed in the Expo TS config.
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

App config: `app.json`. Bundle ID: `com.markdickson.capsule`. EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`.
