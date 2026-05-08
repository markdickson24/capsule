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

### Key RLS Constraint
When inserting a capsule, **do not chain `.select()` on the insert**. The SELECT policy checks `capsule_members` for membership, but the member row doesn't exist yet at insert time — this causes a 403. Instead, generate the capsule UUID client-side with `crypto.randomUUID()`, insert without `.select()`, then insert the member row separately.

All RLS policies use `(select auth.uid())` rather than `auth.uid()` directly to avoid query planner issues.

### Database Schema
Defined in `supabase-schema.sql`. Key tables and relationships:

- `users` — extends `auth.users` via trigger `on_auth_user_created`
- `capsules` — owned by a user, has `status` (draft/active/unlocked) and `unlock_at`
- `capsule_members` — join table with `role` (owner/contributor/viewer); a user must be a member to see a capsule
- `media` — photos/videos belonging to a capsule, stored in Supabase Storage
- `reactions` — emoji reactions on individual media items
- `notifications` — records of push notifications sent

Permission model: owners control everything; contributors can add media until `contribution_lock_at`; viewers can only see content after unlock. Media is only visible to non-owners/contributors after `status = 'unlocked'`.

### Environment
Credentials live in `.env` (gitignored):
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### Design System
Dark theme throughout. Primary color: `#FF6B35` (orange). Background: `#0A0A0A`. Secondary text: `#888888`. Success: `#30D158`. Destructive: `#FF3B30`. Border/surface: `#1A1A1A` / `#2A2A2A`.

`Alert.alert` does not work reliably on web — use inline state (`error`/`success` strings rendered as `<Text>`) instead of Alert for all user feedback.
