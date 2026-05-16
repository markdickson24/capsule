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
  components/
    ColorPicker.tsx          # HSV picker (SV panel + hue slider + hex input), controlled, reusable
    ConfirmModal.tsx         # Cross-platform confirmation dialog — use instead of Alert.alert
  context/
    ThemeContext.tsx         # accentColor per-user, loads from Supabase on auth
  hooks/
    useAuth.ts              # Session listener, returns { session, loading }
    useDeepLinks.ts         # Handles capsule://join/<id> and capsule://reset-password
    usePushNotifications.native.ts  # Token registration + tap routing (iOS/Android only)
    usePushNotifications.web.ts     # No-op stub for web
    usePushNotifications.ts         # TS fallback stub
  lib/
    supabase.ts             # Supabase client + on-web accessToken override (see Web Auth Gotchas)
    sessionStore.ts         # Synchronous session cache (web seeds from localStorage at module load)
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
    unlock-capsules/        # Edge function: marks active capsules with unlock_at <= now() as unlocked
                            # and pushes notifications. Auth: Bearer CRON_SECRET. Triggered every minute
                            # by a pg_cron job that reads the secret from Supabase Vault.
    send-invite-push/       # Edge function: sends the "you were invited" push. Reads the invitee's
                            # push_token with the service role so clients never need read access to it.
  migrations/               # Timestamped SQL migrations applied to the remote DB. supabase-schema.sql
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
    Settings          (no params — accent color picker)
    Onboarding        (no params — 4-step wizard, see Onboarding section)
```

Tab `Create` accepts optional `{ presetTitle, presetDescription }` route params (used by Onboarding step 4 preset cards to prefill the form).

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

**`createSignedUrls` response:** map by array index, not `item.path`. Use `signedData?.[i]?.signedUrl`. Signed URLs expire after 3600 seconds.

**Avatar upload path:** `${userId}/avatar.jpg` with `upsert: true`.
**Media upload path:** `${capsuleId}/${randomUUID()}.${ext}`.

---

## Database Schema

Defined in `supabase-schema.sql`.

| Table | Key columns |
|---|---|
| `users` | id, email, display_name, bio (max 80 chars), avatar_url, push_token, auth_provider, subscription_tier, accent_color (default '#FF6B35'), onboarded_at (null = needs wizard), created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at, archived_at (null = active), unlock_mode (time/proximity/both), proximity_radius_m (default 100) |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending), checkin_lat, checkin_lng, checkin_at |
| `media` | id, capsule_id, uploader_id, storage_key, media_type (photo/video), size_bytes, thumbnail_key, uploaded_at, is_flagged |
| `reactions` | id, media_id, user_id, emoji, created_at — unique (media_id, user_id) |
| `notifications` | id, user_id, capsule_id, type (invite/unlock/reaction/contribution_nudge/milestone), sent_at, read_at |

**`users` column privileges:** the `users` SELECT policy is `USING (true)` (every signed-in user can read every profile — needed for search and public profiles). To stop that exposing sensitive fields, `email`, `phone`, and `push_token` are removed from the `authenticated` SELECT grant at the **column level**. Never `select('email')` / `select('phone')` / `select('push_token')` / `select('*')` on `users` from client code — it will fail. The current user's email is on the auth session (`session.user.email`), not this table. Reading another user's `push_token` is server-only (see the `send-invite-push` edge function).

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
- Invite push notifications are sent by the `send-invite-push` edge function. `CapsuleDetailScreen.sendInviteNotification()` calls it via `supabase.functions.invoke()`; the function verifies the caller owns the capsule, reads the invitee's `push_token` with the service role, and posts to Expo. The in-app notification row itself is created server-side by the `notify_on_invite` trigger.
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

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`. Use this instead of `crypto.randomUUID()` — `crypto` global is not reliably typed in the Expo TS config.
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor }`. `ThemeProvider` must wrap the app.
- `src/lib/sessionStore.ts` — `sessionStore.get()` / `sessionStore.set()`. Module-level session cache, updated by `useAuth` on every `onAuthStateChange` event. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()` inside screens.** `getSession()` on web hangs when the access token is expired because it blocks on an internal refresh network call. `sessionStore.get()` is synchronous and never hangs.

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
