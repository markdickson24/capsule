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
- **React Native + Expo** (single codebase for iOS, Android, web)
- **Supabase** — auth, PostgreSQL database, storage, RLS
- **React Navigation** — stack + bottom tabs

### Auth Flow
`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`. `App.tsx` renders `AuthNavigator` or `AppNavigator` based on session presence. The loading state prevents any screen from rendering until the session is confirmed, which is important because Supabase session restoration is async.

**Platform split in `src/lib/supabase.ts`:** on web, Supabase uses `localStorage` directly (default behavior, no custom adapter). On native, `expo-secure-store` is used. This split exists because SecureStore is native-only and using a custom async adapter on web caused JWT to not be attached to requests.

**Always use `getSession()` instead of `getUser()`** when you just need the user ID or token. `getUser()` makes a live network request to Supabase Auth on every call, adding 500ms–2s of latency. `getSession()` reads from local secure storage instantly.

### Key RLS Constraints

**Capsule insert:** do not chain `.select()` on the insert. The SELECT policy checks `capsule_members` for membership, but the member row doesn't exist yet at insert time — this causes a 403. Instead, generate the UUID client-side using `randomUUID()` from `src/lib/uuid.ts`, insert without `.select()`, then insert the member row separately.

**`capsule_members` policies use security definer functions** to avoid infinite recursion. Direct policy expressions that query `capsule_members` from within a `capsule_members` policy cause a recursion error. The pattern is:
- SELECT: `get_my_capsule_ids()` — security definer, returns capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — security definer, checks ownership via `capsules` table

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or use the `capsules` table directly.

All RLS policies use `(select auth.uid())` rather than `auth.uid()` directly to avoid query planner issues.

### Supabase Storage

Bucket: `capsule-media` (private). Required policies:
- INSERT: users can upload to their own capsules
- SELECT: authenticated users can read (needed for `createSignedUrls` to work)

**Raw REST uploads require both headers:**
```
Authorization: Bearer <access_token>
apikey: <anon_key>
```
The Supabase JS client adds both automatically, but `FileSystem.uploadAsync` does not — you must add `apikey` manually.

**Use `FileSystem.uploadAsync` for native uploads** (iOS/Android). It uses NSURLSession natively — file bytes never cross the JS bridge, making it dramatically faster than `fetch(uri).blob()`. Web must fall back to `fetch + arrayBuffer + supabase.storage.upload()`.

**`createSignedUrls` response:** map by array index, not by `item.path`. The `path` property is not always reliable. Use `signedData?.[i]?.signedUrl`.

### Database Schema
Defined in `supabase-schema.sql`. Key tables and relationships:

- `users` — extends `auth.users` via trigger `on_auth_user_created`
- `capsules` — owned by a user, has `status` (draft/active/unlocked) and `unlock_at`
- `capsule_members` — join table with `role` (owner/contributor/viewer); a user must be a member to see a capsule
- `media` — photos/videos belonging to a capsule, stored in Supabase Storage bucket `capsule-media`
- `reactions` — emoji reactions on individual media items
- `notifications` — records of push notifications sent

Permission model: only owners can see photos before unlock. Contributors and viewers see a locked state until `status = 'unlocked'`. Use `isOwner` (`capsule.owner_id === currentUserId`) for owner checks — it's derived from the capsule row directly and works even if the `capsule_members` row is missing.

### Navigation Structure

```
RootStack
  AuthStack (Welcome, Login, SignUp)
  AppStack
    Tabs (Home, Create, Camera, Notifications, Profile)
    CapsuleDetail
    Preview (animation: 'none')
```

### In-App Camera (`src/screens/app/CameraScreen.tsx`)
- `mode="video"` is required on `CameraView` even for photos — expo-camera 17.x needs it for `recordAsync`
- Tap = photo, hold 300ms = video (manual timer, not `onLongPress`)
- Double-tap viewfinder switches front/back camera
- Photos are resized to 1920px wide via `expo-image-manipulator` before upload
- Front camera photos are flipped horizontally via `FlipType.Horizontal`
- Use `useIsFocused()` to stop camera rendering when the tab is not active

### iOS Layout Gotchas
- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `Dimensions.get('window').width / 3` instead.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — always check `Platform.OS !== 'web'` before calling them. Use `expo-file-system/legacy` import path (not `expo-file-system`) to avoid deprecation warnings.

### Utilities
- `src/lib/uuid.ts` — `randomUUID()` helper. Use this instead of `crypto.randomUUID()` — the `crypto` global is not reliably typed in the Expo TS config.

### Environment
Credentials live in `.env` (gitignored):
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### Design System
Dark theme throughout. Primary color: `#FF6B35` (orange). Background: `#0A0A0A`. Secondary text: `#888888`. Success: `#30D158`. Destructive: `#FF3B30`. Border/surface: `#1A1A1A` / `#2A2A2A`.

`Alert.alert` does not work reliably on web — use inline state (`error`/`success` strings rendered as `<Text>`) instead of Alert for all user feedback.
