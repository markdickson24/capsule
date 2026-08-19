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
                           # mid-recording flip feature. Also exports trimVideo(uri, maxSeconds) —
                           # first-N-seconds trim (iOS AVAssetExportSession timeRange; Android
                           # MediaExtractor+MediaMuxer to the cutoff), used by the Preview video-length
                           # gate. JS entry: modules/expo-video-stitcher/index.ts
src/
  components/
    AwardsSection.tsx        # Superlatives UI inside CapsuleDetail — voting open / tallying / finalized cards
    ColorPicker.tsx          # HSV picker (SV panel + hue slider + hex input), controlled, reusable
    ConfirmModal.tsx         # Cross-platform confirmation dialog — use instead of Alert.alert
    DatePicker.tsx           # Shared date/time picker — custom calendar grid, month/year picker, quick presets, haptics
    JoinCapsuleConfirm.tsx   # Global confirm sheet for capsule://join deep links (module-level pub/sub + host,
                             # same idiom as toast/limitSheet; mounted in App.tsx). The deep link NEVER writes
                             # membership on its own — see "Deep links"
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
    useEntitlements.ts       # Reactive { isPro } from RevenueCat OR users.subscription_tier — UI-only, not the real gate. See "Monetization"
  lib/
    animations.ts           # Reusable animation hooks (useFadeIn, useSlideUp, useListItemEntrance)
    cache.ts                # In-memory cache with TTL, invalidation, and pub/sub listeners
    avatarUrl.ts             # transformAvatarUrl() — pass-through (render API disabled, see Image Transforms)
    mediaUrl.ts              # transformMediaUrl() — resized capsule media via the signed/private-bucket render API
    supabase.ts             # Supabase client + on-web accessToken override (see Web Auth Gotchas)
    sessionStore.ts         # Synchronous session cache (web seeds from localStorage at module load); also the
                             # per-user onboarded-flag + session-expired AsyncStorage flags
    shareIntentStash.ts     # In-memory stash for media shared while signed out — drained after login
    ShareIntentProvider.{native,web,tsx}  # Platform-split provider wrapper (real on native, passthrough on web)
    uuid.ts                 # randomUUID() — expo-crypto CSPRNG (never Math.random, see Utilities)
    googleAuth.ts           # signInWithGoogle() via expo-auth-session (PKCE code exchange)
    deepLinkRoute.ts        # parseDeepLink() — pure capsule:// router; strips the URL fragment
                            # before parsing so a token can't reach a route. Do NOT use the
                            # global URL class here (RN polyfill is http-only) — see "Deep links"
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

`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`. `App.tsx` renders `AuthNavigator` or `AppNavigator` based on session presence; loading blocks rendering until session is confirmed (restore is async).

**Auth methods:** email/password (`supabase.auth.signInWithPassword`) and Google OAuth (`src/lib/googleAuth.ts` — `expo-auth-session` + `expo-web-browser`, reads `?code=` off the redirect and calls `supabase.auth.exchangeCodeForSession`). **Client is configured `flowType: 'pkce'`** — see "Deep links" for why, and the one-line change that would break both Google sign-in and password reset at once.

**Platform split in `src/lib/supabase.ts`:** web uses `localStorage` (default); native uses `expo-secure-store` via a custom async adapter. Don't use the async adapter on web — the JWT won't attach to requests.

⚠️ **The native SecureStore adapter writes with `keychainAccessible: AFTER_FIRST_UNLOCK`, and must keep doing so.** expo-secure-store defaults to `WHEN_UNLOCKED`, which makes the item unreadable **while the device is locked** — SecureStore throws, the auth client sees no session, and the user lands on Welcome as if signed out. The app reads the session precisely when the device tends to be locked (push tap, Live Activity tap, background `autoRefreshToken`). ⚠️ **Accessibility is fixed when the item is WRITTEN, not retroactively** — an install stored under `WHEN_UNLOCKED` keeps that until next written (sign-in, or a refresh while unlocked). `getItem` catches and returns null rather than throwing, so a failed read degrades to "signed out" instead of a crash, and reports through `reportError`.

**Always use `getSession()` instead of `getUser()`** for user ID/token — `getUser()` makes a live network request (500ms–2s), `getSession()` reads local storage instantly.

**Email OTP confirmation (`SignUpScreen`)** — signup verifies via a **6-digit code**, not a magic link. When `supabase.auth.signUp` returns `data.session === null`, the screen shows a `pendingEmail` code-entry state: 6-digit `TextInput` (`oneTimeCode`, auto-submits at 6 digits), "Verify & continue", "Resend code" (`supabase.auth.resend({ type: 'signup', email })`, 60s cooldown), and "Use a different email". `handleVerify(code)` calls **`supabase.auth.verifyOtp({ email, token: code, type: 'signup' })`** — success sets the session, so `onAuthStateChange` swaps `AuthNavigator` → `AppNavigator` → Onboarding automatically, **no separate Login step**. **Requires the Supabase "Confirm signup" template to emit `{{ .Token }}`** (code) alongside `{{ .ConfirmationURL }}` (default-only link) so older installed builds still work during rollout. `AuthStackParamList['Login']` stays `{ email?: string } | undefined` for the "already registered → Sign in instead" path. Auth errors map through `mapAuthError` (`src/lib/authErrors.ts`).

---

## Navigation Structure

`AppNavigator` reads `users.onboarded_at` on mount, sets `initialRouteName` to `Onboarding` (null) or `Tabs` (set). Existing users were backfilled to `now()`.

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

Tab `Create` accepts optional `{ presetTitle, presetDescription, pendingMedia }`. `presetTitle`/`presetDescription` are Onboarding step 4's preset cards. `pendingMedia` (`PendingMedia[]`, from `PreviewScreen` creating a new capsule from camera/share) enqueues onto the background `uploadQueue` right after the capsule row is created — same pending tiles / `Uploading n/N` / drain toast as any upload, per-item retry on failure. `CapsuleDetail` opens with `justCreated: true` to show the post-create invite nudge.

**`CreateScreen` progressive disclosure** — only **Name and Unlock date** are always visible above "Lock Capsule". **Description, Unlock-When mode, Uploads Deadline, Voting window, Occasion, Surprise toggle** live behind a collapsed-by-default **"More options"** disclosure showing a one-line summary (e.g. `General · 48h voting · Surprise on`); everything collapsed is pre-defaulted (`time` mode, 48h voting, `general`, surprise on). **`DefaultAwardsCard` is NOT on this screen** — occasion is just a chip row; 4 themed awards seed at submit (`pickDefaults(occasion)` → `set_default_superlatives`, non-fatal on error), reviewed later via `<DefaultAwardsCard mode="manage">` on the capsule page. Unlock date field is gated on `unlockMode !== 'proximity'` (mode toggle lives in "More options"). Validation is per-field (`errors: { title?, description?, unlockDate?, contribLockDate?, votingHours?, general? }`, red border + inline text); on failing submit, `scrollToField` auto-expands "More options" if needed then scrolls to it. `general` is one bottom-of-form slot for account/system-level failures not tied to a field.

**`navigationRef`** (`src/lib/navigationRef.ts`) — imperative nav ref for use outside components (push tap handler, deep link handler). Poll `navigationRef.isReady()` before `.navigate()`.

**Deep links** — `useDeepLinks` (`src/hooks/useDeepLinks.ts`), called from `RootNavigator`. Two routes:
- `capsule://join/<capsuleId>` — **shows a confirmation sheet; does NOT write membership on its own.** ⚠️ It used to insert a joined `capsule_members` row instantly on the reasoning that opening the link is consent. That fails for a *custom URL scheme*, which any web page can fire with no gesture: `getcapsuleapp.com/join/<id>` auto-navigated on load, letting a cross-origin page silently enroll any signed-in visitor into an attacker's capsule (exposed their profile to the member list, handed the attacker a push channel, auto-accepted a deliberately-pending invite, and — chained with `capsule://capsule/<id>/camera` — opened their camera preselected into the attacker's capsule). **Both ends are gated now:** the web page requires a click (see QR below), and the app routes through **`joinCapsuleConfirm`/`JoinCapsuleConfirmHost` (`src/components/JoinCapsuleConfirm.tsx`)** — module-level pub/sub sheet, same idiom as `toast`/`limitSheet`, mounted in `App.tsx`. It fetches `capsule_join_preview` and mirrors `QRScannerScreen`'s three membership states (`already_member` → open only; `is_pending` → **UPDATE** `joined_at`, never INSERT; neither → INSERT); the `capsule_members` write happens only inside "Accept Invite". No client-side `notifications` insert (no INSERT policy — the `notify_on_invite` trigger fires off the `capsule_members` insert instead). Signed-out taps stash to `src/lib/pendingJoinStash.ts` (same idiom as `shareIntentStash`) and drain after sign-in by opening the sheet, not auto-joining.
- `capsule://reset-password?code=<pkce code>` — `supabase.auth.exchangeCodeForSession(code)`, then navigate to `ResetPassword`.

⚠️ **The client runs `flowType: 'pkce'` (`src/lib/supabase.ts`, both platforms) and the implicit-token path is GONE. Do not reintroduce it.** The old link `capsule://reset-password#access_token=...` fed straight into `setSession()`, routed via a substring match (`url.includes('reset-password')`). Custom URL schemes are **unauthenticated** — any website can fire `capsule://…`, so a malicious page could hand the app its own tokens and sign the victim into the **attacker's** account, uploading their photos into the attacker's capsules (2026-07-29 audit, H-1, CWE-384). `exchangeCodeForSession` only succeeds when *this device* holds the matching `code_verifier`, so an injected code is inert.

Consequences:
- **Reset links are single-device by design** — request on one phone, open on another → "invalid or expired". Security property, not a bug.
- **The "Reset Password" email template must emit `{{ .ConfirmationURL }}`** — a raw-token customization breaks reset for everyone.
- **`googleAuth.ts` depends on PKCE too** — `signInWithOAuth` returns `?code=` under PKCE; flipping `flowType` back breaks Google sign-in as well as reset.

**Routing lives in `src/lib/deepLinkRoute.ts`** (pure, unit-tested `parseDeepLink`), not inline in the hook — strips the URL fragment **before** parsing (a token can't structurally reach a route; the `reset` variant can only carry a `code`) and routes on exact path-segment equality, never `.includes()`.

⚠️ **Do NOT use the global `URL` class to route these.** RN's polyfill (`Libraries/Blob/URL.js`) regexes `host`/`hostname`/`pathname`/`origin` against `^https?://` — for `capsule://join/<id>` they return `''`/`'/'` on-device, and the constructor doesn't throw on garbage, so `try/catch` isn't a validity check. It would silently break **every** deep link while type-checking clean (tsconfig's `lib: ["DOM"]` types the *browser* URL) and pass a Node-based test against the wrong URL implementation. `parseDeepLink` hand-parses for this reason. (`protocol`/`search`/`searchParams`/`hash` *are* scheme-agnostic in the polyfill, which is why `googleAuth.ts` can still read its callback params.)

Scheme `capsule://` is registered in `app.json`. **Custom schemes only work in native builds, not Expo Go.**

⚠️ **`NavigationContainer` deliberately has NO `linking` prop — don't add one.** `useDeepLinks` owns every `capsule://` URL via its own `Linking.addEventListener` + `getInitialURL`, routing through `navigationRef`. A `linking={{ prefixes: ['capsule://'] }}` prop once made React Navigation a *second* consumer of the same URLs; with no `config`, it auto-derives screen names from path segments, so `capsule://capsule/<id>/camera` navigated to a screen literally named `capsule`:

```
The action 'NAVIGATE' with payload {"name":"capsule","params":{"screen":"<uuid>", ...}}
was not handled by any navigator. Do you have a screen named 'capsule'?
```

Every shape hit this — stayed unnoticed since it's a dev-only warning and `useDeepLinks` still navigated correctly underneath. A `config` would fix the parse but leave two navigators reacting to one tap; one owner is the point.

**QR scan-to-join** — owners show a QR encoding **`https://getcapsuleapp.com/join/<id>`** (InviteModal in `CapsuleDetailScreen`), served by `/join/*` (`netlify/edge-functions/join.ts`) — real OG tags, then bounces to `capsule://join/<id>`. Same URL used by CapsuleDetail's share sheet and Onboarding's share, so it fails *open* (generic-copy redirect) on any data-fetch failure, 404s only on genuine miss.

⚠️ **`netlify/edge-functions/join.ts` is public/unauthenticated and `capsule_join_preview` is SECURITY DEFINER with no membership check — every input it renders is attacker-supplied.** Load-bearing rules (`20260802` security wave):
- **Never auto-fire `capsule://join/<id>`** — renders a "Join <title>" **button**; the deep link fires only from the click (auto-fire on load was the web half of the forced-enrollment CSRF above).
- **`owner_avatar` (`users.avatar_url`, client-writable to any string) must never be fetched unvalidated** — `fetchAvatarDataUri` requires `https:` **and** an exact hostname match to the project's own Supabase host, `redirect: "manual"` (else a blind SSRF from Netlify's egress); failures fall back to the initial-letter badge.
- **Cap the avatar body at 512KB** via a streaming reader (not `content-length`, which a hostile origin can lie about) — the old per-byte `binary +=` rope could OOM the isolate and take co-tenant requests with it.
- **Clamp `title` before wrapping** — `capsules.title`'s cap was client-side only and `wrapTitle`'s old shrink loop was O(n²); a CHECK constraint now backstops server-side length too.

Scanner regex accepts both https and `capsule://` forms; `QRScannerScreen` (Home → Scan QR) scans it. Pre-join preview (title/owner/member-count) **must** come from `capsule_join_preview(p_capsule_id)` SECURITY DEFINER RPC, **not** a direct `capsules` select — the SELECT policy is membership-gated, so a non-member reading directly would wrongly get "doesn't exist." The RPC returns minimal fields, gated by possession of the unguessable UUID.

⚠️ **It reports three membership states, not two** — `already_member` and `is_pending` are mutually exclusive. `already_member` used to be a bare `exists` with no `joined_at` filter, so a pending invite read as "already a member" and dead-ended the scanner. **`capsule_members` has `UNIQUE (capsule_id, user_id)`, so accepting a pending invite is an `UPDATE` of `joined_at`, never `INSERT`** (23505 otherwise) — both `QRScannerScreen.joinCapsule` and `useDeepLinks.joinAndNavigate` branch on this. ⚠️ That fix was a signature change requiring DROP + CREATE, **which silently resets the function ACL** — `grant execute to authenticated, service_role` is load-bearing. Self-join INSERT is allowed via `can_insert_capsule_member` (`p_user_id = auth.uid()`). "Accept Invite" joins immediately and navigates into the capsule, not Notifications. On an invalid QR / empty lookup, no sheet renders, so the scanner re-arms itself (`setScanned(false)` after ~2s) — otherwise `onBarcodeScanned` stays `undefined` forever.

---

## Key RLS Constraints

**Capsule insert goes through the `create_capsule_with_owner(...)` RPC** (`20260711160000_atomic_capsule_create.sql`), not a direct client insert. The old two-request pattern (insert capsule without `.select()`, then insert the owner's `capsule_members` row) left a **zero-member, permanently invisible-to-everyone-including-the-owner** capsule if the second request failed (confirmed: 10 of 21 prod capsules had this shape) — the `capsules` SELECT policy has no owner fallback. The RPC does both inserts in one `security definer` PL/pgSQL body (caller isn't a member row yet when the capsule is inserted), so either insert raising rolls back the whole thing. It generates and returns the capsule UUID server-side (`returns uuid`) — no more client-side `randomUUID()`. Takes an optional `p_group_id` (group flow passes it at creation instead of a follow-up `.update()`).

**`capsule_members` policies use security definer functions** to avoid infinite recursion:
- SELECT: `get_my_capsule_ids()` — capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — checks ownership via `capsules`

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or the `capsules` table directly.

⚠️ **Removing a member is only durable because of a tombstone — `can_insert_capsule_member`'s self-insert arm is otherwise unconditional.** It returns true for any `capsule_id` when `user_id = auth.uid()`, deliberately — possession of the unguessable UUID **is** consent for QR/`capsule://join`. Side effect: `ManageMembersScreen`'s remove (plain DELETE) could be undone by the removed user re-inserting themselves. `20260802120000_security_authz_fixes.sql` adds **`capsule_member_revocations`** (owner-only RLS, PK `(capsule_id, user_id)`): self-insert now also requires no tombstone row; owner-insert *deletes* one so re-inviting works. The `capsule_member_removal_tombstone` AFTER DELETE trigger writes it, exempting a voluntary self-leave (`auth.uid() = old.user_id`) so leaving never blocks rejoining. **`capsule_members_insert` also pins a self-inserted `role` to `'contributor'`** (owner-inserted rows unrestricted) — pinned in the policy, not a function param, since a signature change resets the function ACL. **A new self-join flow needing another role must update that policy too.**

⚠️ **`create_capsule_with_owner` validates `p_group_id` and takes a per-caller advisory lock.** An unvalidated `p_group_id` let a capsule be stamped with any group's UUID — readable by anyone ever invited to that group — after which `notify_on_invite`/`send-invite-push` would push the victim a notification branded with their real group pointing at the attacker's capsule; now requires a `group_members` row for the caller (`GROUP_MEMBERSHIP_REQUIRED`). Separately, the free-tier capsule cap was a check-then-act on an unsynchronized `count(*)` (N concurrent calls all pass); now runs `pg_advisory_xact_lock` keyed on the caller first. `enforce_member_limit`/`enforce_photo_limit` had the same race, fixed with the same lock keyed on the capsule (`20260802120100_security_hardening.sql`).

**Client UPDATE on `capsule_members` and `media` is column-grant-scoped** (`20260722120000_audit_rls_hardening.sql`). Both UPDATE policies previously lacked a column-level `WITH CHECK`: a `viewer` could self-promote `role` to contributor/owner, and an uploader could reassign `media.capsule_id` (cross-capsule injection, bypassing the photo cap) or clear `is_flagged`. Fixed by revoking table-wide UPDATE from `authenticated`/`anon` and granting back only `capsule_members(joined_at)` and `media(caption)`. Everything else — `role`, `capsule_id`, `storage_key`, `is_flagged` — is un-writable by clients; legitimate `role` changes happen only via SECURITY DEFINER RPCs. **Any new client-writable column on these tables needs its own `grant update (col)`** (the table-wide grant is gone).

⚠️ **A function called from inside an RLS policy must be EXECUTE-granted to the role doing the query.** Policies evaluate as the **querying role**, not the table owner — revoking `execute … from authenticated` on a policy helper breaks every statement that policy guards (`42501: permission denied for function …`). Not theoretical: revoking EXECUTE on `_superlative_target_valid` from `authenticated` (to keep it off the RPC surface) killed **all superlative voting for four days**, unnoticed because demo fixtures seeded via `service_role` (bypasses RLS) kept the row count looking healthy. Restored `20260726000000`.

Before revoking EXECUTE on anything, check whether a policy references it:

```sql
select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
where coalesce(pg_get_expr(p.polqual,p.polrelid),'') || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
      like '%your_function_name(%';
```

Revoking from `anon` alone is safe. This cuts against "internal helpers shouldn't be on the RPC surface" — for a policy helper in the PostgREST-exposed `public` schema you can't have both without moving it to a non-exposed schema and repointing the policies.

All RLS policies use `(select auth.uid())`, not `auth.uid()` directly — avoids planner issues. `get_my_capsule_ids()`, `can_insert_capsule_member()`, and the `capsules`/`capsule_members` policies were live on production for an unknown period with no matching migration (an out-of-band dashboard/MCP change), captured in `20260515232500_capture_capsule_rls_and_helpers.sql`. **If a live RLS policy/function doesn't match `mcp__supabase__execute_sql`, assume the live DB is correct and the migration is stale** — verify with `pg_policies`/`pg_get_functiondef` before changing behavior.

**Contribution lock — AND the mirror-image start date — are enforced at TWO layers** (both must allow):
1. `media` INSERT policy: `(c.contribution_lock_at IS NULL OR now() < c.contribution_lock_at) AND (c.contribution_start_at IS NULL OR now() >= c.contribution_start_at)` (joins `capsule_members` for membership + role).
2. `storage.objects` INSERT policy for `capsule-media` (`Contributors can upload to their capsules`) does the **same check**, extracting capsule_id from the path's first segment. Previously wide open; tightening closed a hole where storage could be spammed without ever inserting a `media` row.

`contribution_start_at` was added in `20260716120000_capsule_start_date.sql`. **Unlike the lock, the start gate has no owner exemption** — plain `role in ('owner','contributor')`, so even the owner can't upload before the start date. Both policies were drop+recreated rather than altered in place.

---

## Supabase Storage

Two buckets:
- `capsule-media` (private) — photos and videos
- `avatars` (public) — profile pictures; cache-bust with `?t=${Date.now()}`

**`capsule-media` SELECT is membership-gated** (`20260722120000_audit_rls_hardening.sql`, "Members can read their capsule media"). The bucket previously had two out-of-band dashboard SELECT policies both `USING (bucket_id = 'capsule-media')` with **no membership check** — any authenticated user could list/download/sign every capsule's private media (critical live exposure). The replacement mirrors the `media` table's own SELECT gate (`joined` + `(unlocked OR (owner/contributor AND NOT owner_preview_locked))`), so a signed URL can only be minted for a readable `media` row. Governs `list()`, direct download, AND `createSignedUrl` — any new capsule-media read flow inherits this gate.

**Raw REST uploads require both headers:**
```
Authorization: Bearer <access_token>
apikey: <anon_key>
```
The JS client adds both automatically; `FileSystem.uploadAsync` does not — add `apikey` manually.

**Use `FileSystem.uploadAsync` for native uploads** (NSURLSession — bytes never cross the JS bridge, far faster than `fetch(uri).blob()`). Web falls back to `fetch + arrayBuffer + supabase.storage.upload()`.

**For the native `Authorization` header, use `getFreshAccessToken()` (`src/lib/supabase.ts`) — never `sessionStore.get().access_token` directly.** `FileSystem.uploadAsync` attaches the bearer manually, bypassing the JS client's auto-refresh — a stale cached token (app idle past the 1h lifetime) gets **HTTP 400 `jwt expired`** (not 401), surfacing as a generic `Storage 400`. `getFreshAccessToken()` calls `getSession()`, which refreshes an expired token on native before returning. Do **not** call it on web — `getSession()` can hang there (see Web Auth Gotchas); web uploads refresh via `supabase.storage` on their own. All five native upload sites (avatar in Profile + Onboarding, media in Preview/CapsuleDetail/Create's `pendingMedia`) route through it.

**`createSignedUrls` response:** map by array index, not `item.path` — use `signedData?.[i]?.signedUrl`. Signed URLs expire after 3600s.

**Avatar upload path:** `${userId}/avatar.jpg`, `upsert: true`. RLS is `auth.uid()::text = (storage.foldername(name))[1]`, so **`userId` MUST come from the live session** (native: `getFreshSession()`; web: `sessionStore.get().user.id`) — never a cached `profile.id`, which can lag the live session and cause a 403 `new row violates row-level security policy` (auth.uid/path mismatch — not an expired token, that's 400).
**Media upload path:** `${capsuleId}/${randomUUID()}.${ext}`.

---

## Image Transforms (avoid full-res images in small UI)

⚠️ **Storage Image Transformations bill per distinct *origin image*, not per request or size variant** — Pro plan includes only **100 origin images/month**; every unique image routed through the render API in a cycle consumes one regardless of size count or fetch count. Budget this before adding any new image class to the render endpoint.

**`transformAvatarUrl(url, displayPx)`** (`src/lib/avatarUrl.ts`) — **no longer transforms; returns the public URL unchanged.** Avatars are already resized ≤400px and compressed at upload (`ProfileScreen`/`OnboardingScreen`'s ImageManipulator step), so the render endpoint bought negligible bytes while burning one origin image per avatar per cycle — avatars alone exhausted the whole quota. `displayPx` stays in the signature so call sites (`Avatar` in `ProfileScreen.tsx`, `GroupDetailScreen`, `CreateGroupScreen`, `VoteSheet`, `AwardsSection`, `QRScannerScreen`) need no change if restored on a higher plan. **Don't "fix" this by reinstating the render path** — quota, not byte count, is the binding constraint. (If restored: the render API needs both `width` AND `height`; width alone squashes the image.)

`transformMediaUrl` **does** still use the render API — capsule media is full-res camera output where the saving is real, and it's gated behind private signed URLs.

**`transformMediaUrl(signedUrl, displayPx)`** (`src/lib/mediaUrl.ts`) — for the **private** `capsule-media` bucket. Rewrites a signed URL's `/storage/v1/object/sign/` segment to `/storage/v1/render/image/sign/` and appends `width/height/resize/quality`, **preserving the existing `?token=`** (the same signing token is valid on the render path, per `@supabase/storage-js`'s own `getPublicUrl()`/`download()` internals). Derives a thumbnail from an *already-signed* URL with **no second signing round-trip** — preferred over `createSignedUrl(..., { transform })`, which bakes in one fixed size and needs a second call for the full-res URL too. Used for `CapsuleDetailScreen`'s grid/3-up (`MediaItem.thumbSignedUrl`) and `VoteSheet`'s media-voting grid — both fall back to full-res `signedUrl` if unset (videos use `thumbnailUri`).

---
## Database Schema

Defined in `supabase-schema.sql`.

| Table | Key columns |
|---|---|
| `users` | id, email, display_name, bio (max 80 chars), avatar_url, push_token, auth_provider, subscription_tier, accent_color (default '#FC6A5B' — brand reddish-coral, matches the website; was '#FF6B35', existing users un-migrated), accent_gradient (nullable text `"#a,#b"`, null = solid — Pro-only cosmetic, see "Theme System"), home_layout (list/grid, default 'list'), onboarded_at (null = needs wizard), created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at, archived_at (null = active), unlock_mode (time/proximity/both), proximity_radius_m (default 100), unlocked_at, superlative_voting_hours (default 48), superlative_voting_closes_at, superlative_voting_finalized_at, superlative_closing_soon_sent_at, owner_preview_locked (default true — surprise mode), occasion (wedding/vacation/party/baby/milestone/general, default 'general' — drives the default-awards theme), contribution_start_at (nullable — mirror of contribution_lock_at; **nobody, owner included, can upload before it**, see "Capsule Start Date"), contribution_start_notified_at (nullable — dedupe stamp set once the capsule-started push has fired), live_activity_enabled (default true for new capsules, backfilled false on existing ones — owner default for the lock-screen countdown, see "Live Activity Countdown"), unlock_notified_at (nullable — dedupe stamp for the unlock push, claimed independently of *who* flipped status, see "Instant Unlock") |
| `capsule_member_revocations` | capsule_id + user_id (composite PK), revoked_at, revoked_by — owner-removal tombstone; blocks the removed user's self-insert. See "Key RLS Constraints" |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending), invite_pushed_at (nullable — set by `send-invite-push` under the service role so each invite pushes at most once; **service-role-written, so it deliberately has no client UPDATE grant**), archived_at (per-member "hide from my feed" flag — see Archive below), checkin_lat, checkin_lng, checkin_at, contribution_nudge_7d_sent_at / _3d_sent_at / _1d_sent_at (nullable — per-tier dedupe stamps, see "Contribution Nudges"), live_activity_override (nullable — per-member override of the capsule default, null = inherit, see "Live Activity Countdown") |
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

**`users` column privileges:** SELECT policy is `USING (true)` (any signed-in user reads any profile — needed for search/public profiles), but `email`, `phone`, `push_token` are revoked from `authenticated`'s SELECT grant at the **column level**. Never `select('email'|'phone'|'push_token'|'*')` on `users` client-side — it fails. Current user's email lives on `session.user.email`; another user's `push_token` is server-only (`send-invite-push`).

> ⚠️ **New client-readable column on `users`?** A fresh column gets no SELECT grant by default (grant is column-level) — selecting it 403s the **whole** query. **`grant select (...)` to `authenticated` in the same migration.** Bit `home_layout` this way in prod: the missing grant silently reset accent color to default on every sign-in until fixed.

**Indexes** (`20260709120000_perf_indexes.sql`, PERFORMANCE.md #9) — added for actual query shapes: `idx_notifications_unread` (partial `(user_id, sent_at desc) where read_at is null` — Alerts list + tab-badge query), `idx_capsules_unlock_due` (partial `(unlock_at) where status='active' and unlock_mode='time'` — `unlock-capsules`'s per-minute filter), `idx_capsules_group_id` (plain `(group_id)` — a group's capsule list + `create-group-capsules` cron), `idx_media_capsule_uploaded` (composite `(capsule_id, uploaded_at desc)`, replaces `idx_media_capsule_id` so `fetchPhotos` doesn't sort separately every call).

**Triggers:**
- `handle_new_user()` — auto-creates `users` row on `auth.users` insert
- `notify_on_reaction()` — inserts reaction notification (not to self)
- `notify_on_superlative_suggested()` — fans out to every other joined member on `superlative_categories` insert
- `_promote_superlative()` — on `superlative_upvotes` insert, flips a pending category to `live` at `ceil(joined/2)` upvotes
- `_stamp_unlock_meta()` — BEFORE UPDATE on `capsules`; status→'unlocked' stamps `unlocked_at`/`superlative_voting_closes_at`, shared by the unlock cron and `check_in`
- `_touch_superlative_vote_updated_at()` — bumps `updated_at` on vote change
- `notify_on_friend_request()` / `notify_on_friend_accept()` — `friendships` insert (pending) notifies the addressee; pending→accepted stamps `responded_at` and notifies the requester
- `notify_contribution_activity()` — AFTER INSERT on `media`; upserts `contribution_activity_pending` — see "Contribution Nudges"
- `guard_subscription_tier()` — BEFORE INSERT/UPDATE on `users`; rejects a client set/change of `subscription_tier` (`TIER_READONLY`) — only `service_role` (webhook) may write it, making the paywall un-forgeable
- `guard_group_recurrence()` — BEFORE UPDATE on `groups`; blocks a free creator switching to real recurrence via direct UPDATE (`GROUP_RECURRENCE_PRO`); cron exempt
- `enforce_member_limit()` / `enforce_photo_limit()` — BEFORE INSERT server backstops, owner-tier-keyed (members 10 free/50 pro, `MEMBER_LIMIT_REACHED`; photos 20 free/1000 pro, `PHOTO_LIMIT_REACHED`), owner's own member row exempt. All four `guard_*`/`enforce_*` triggers exempt service_role/definer/cron paths.
- `capsule_member_removal_tombstone()` — AFTER DELETE on `capsule_members`; writes `capsule_member_revocations` when an owner removes someone else, so it can't be undone by self-insert (voluntary leave is skipped). See "Key RLS Constraints".

**Permission model:** only owners preview media pre-unlock by default; contributors/viewers see locked state until `status='unlocked'`. Use `isOwner` (`capsule.owner_id === currentUserId`), not a `capsule_members` lookup — works even if that row is missing. **Surprise mode** (`owner_preview_locked`) overrides this, locking out even the owner — see "Surprise Mode".

**Pending invites:** `joined_at IS NULL` = not yet accepted (invites *pushed* via `InviteModal`). QR/deep-link joins differ — opening the link is the consent act, so `joined_at` sets immediately. `NotificationsScreen` offers Accept/Decline; Decline (deletes the row) is the only way to clear a pending invite — a bare dismiss orphans it and the owner's ghost `ManageMembers` entry forever.

**Notifications are soft-deleted** via `read_at` (`.is('read_at', null)` filters unread). `NotificationsScreen`'s main query caps at `.limit(100)` since unread rows accumulate for passive users.

---

## In-App Camera (`CameraScreen.tsx`)

- `mode="video"` required on `CameraView` even for photos — expo-camera 17.x needs it for `recordAsync`.
- Tap = photo, hold 300ms = video (manual `setTimeout`, not `onLongPress`); double-tap (≤300ms) flips front/back.
- Pinch (PanResponder): zoom 0–1 shown as 1×–5× badge, fades after 800ms. Max recording 2 min (`MAX_RECORD_SECONDS`).
- **Hands-free lock:** holding to record, slide the shutter finger right ≥90px locks recording hands-free (shutter becomes a red stop square). Works single and dual. **Zoom deadzone:** horizontal move ≥20px suppresses vertical zoom so a lock-swipe doesn't also zoom.
- **First-run coach + idle hint:** a dismissible overlay explaining hold/lock/flip shows once per install (`cap_camera_coach_seen` flag); the persistent "Tap for photo · Hold for video" hint hides after 3 captures (`cap_camera_captures` counter, incremented in the shared `goToPreview()` chokepoint).
- **Flip camera mid-recording (single-camera only):** reverse button or double-tap the viewfinder while recording. Implemented as a multi-segment loop — each `recordAsync` call is one segment; flipping stops the current segment and resumes on the next `facing` render. Segments stitch into one MP4 via `stitchVideos()` (`modules/expo-video-stitcher`); the 2-min cap spans all segments. Excluded in dual-camera mode.
  - **iOS orientation gotcha:** `AVMutableComposition` has one `preferredTransform` for its shared track, so naive concatenation applies one orientation to all segments even though front/back commonly differ. Fixed with an explicit `AVMutableVideoComposition`, one instruction per segment applying its own transform. **Android has the same bug, not yet fixed** (needs a real transcode, not a metadata change).
- Photos resized to 1920px via `resizeForUpload()` (`src/lib/imageResize.ts`, shared with the upload queue), compress 0.82, quality 0.88.
- Front photos are mirrored natively by `mirror={facing==='front'}` (flips preview + JPEG on iOS/Android). **Don't add a JS `FlipType.Horizontal` pass** — it composes back to identity and un-mirrors the photo (tried, reverted).
- `useIsFocused()` stops rendering off-tab. Navigates to `Preview` with `{ uri, mediaType, facing }`.

**Camera mode dropdown** (top-left) selects `cameraMode: 'back'|'front'|'dual'`. `Dual` renders `<DualCameraView>`, shown only when `isDualCameraSupported`; pinch/zoom + double-tap-flip disable and the reverse button hides in Dual mode. Tap = still photo, hold 300ms = video (same threshold).

---

## Dual Camera (`modules/expo-dual-camera`)

Simultaneous front+back capture (Snapchat-style), two layouts — `sideBySide` (both feeds whole/aspect-fit over a shared blurred backdrop) and `pip` (full back + rounded front bubble). `expo-camera` can't do multi-cam, so this is a **local Expo native module** (autolinked from `modules/`, survives `expo prebuild --clean`), imported by `CameraScreen` as `{ DualCameraView, isDualCameraSupported, DualCameraViewRef, DualCameraLayout }`.

- **Layout switcher:** `CameraScreen` shows a live Split/PiP control; native `setLayout` applies instantly to the next capture, disabled during recording.
- **iOS:** `AVCaptureMultiCamSession` with back+front inputs on manual connections; two preview layers arranged per layout. The sideBySide blurred backdrop reuses the back lens's already-running data-output frames (no new connection, to stay in the hardware-cost budget).
  - **Capture is video-data-output based, not `AVCapturePhotoOutput`** — the deliberate fix for the multi-cam hardware-cost budget: two photo outputs reserve full-res still budget and blow the shared cost ceiling multi-cam enforces. `capturePhoto()` arms a grab; the next frame from each lens becomes a `UIImage`, composited into one JPEG (`composeSideBySide`/`composePiP`) and run through the same resize+Preview path as single-camera photos. Cost is further managed by preferring binned/cheap capture formats capped at 24fps and stepping to 12fps on failure; init errors report the live `hardwareCost` for on-device diagnosis.
- **Android:** reports unsupported (device-specific), Dual mode hidden. **JS:** guards `Platform.OS!=='web'` + try/catch around native resolution; supported only on A12+ iPhones, iOS 13+.
- **PiP swap (BeReal-style):** in PiP, capture also returns `altUri` (front-as-full-frame). Both composites upload — default → `media.storage_key`, swap → `media.alt_storage_key` (non-null marks a swappable photo); the viewer's swap button toggles which is shown/downloaded. sideBySide has no swap; only newly-captured dual photos are swappable, and **the camera→new-capsule `pendingMedia` path doesn't carry `altUri`** (only single-item Preview does).
- **Video recording:** `AVAssetWriter` (H.264, 720×1280, 8Mbps) + audio output; each back-lens frame composites both lenses into a pixel buffer with a relative PTS. `recordingLock` serialises state across the session/data queues. ⚠️ **The re-check-and-append must be one locked block**, and `finalizeRecording` must hold the same lock across `isRecording=false` and `markAsFinished()` — appending to an already-finished writer input raises an uncatchable exception that aborts the process (previously happened because the append raced `stopRecording()`/the maxDuration timer outside the lock). `finishWriting` stays outside the lock (never hold one across an async completion). No `altUri` for video (too expensive). Dual video flow otherwise mirrors single-camera start/stop/cleanup exactly.
- **Requirements:** custom dev/EAS build + physical multi-cam iPhone — doesn't run in Expo Go/simulator. **Not yet device-verified** — error messages carry the live hardware cost for tuning if capture fails.

---

## Preview Screen (`PreviewScreen.tsx`)

- Shows photo(s)/looping video(s) before adding to a capsule. Fetches active (non-unlocked) capsules where role is owner/contributor and `joined_at` is set.
- **Layout: media above, panel below — nothing overlays the photo.** Column layout: `flex:1` media area (carousel + top bar + dots), then the bottom panel (caption, capsule chips, Add button) in normal flow. `contentFit="contain"` letterboxes rather than cropping behind the panel. Swipe-down-to-discard is scoped to the media area only. Panel uses `KeyboardAvoidingView` so the caption input isn't covered by the keyboard.
- **Two route shapes:** `{ uri, mediaType, facing? }` (single-item, from `CameraScreen`) or `{ media: PendingMedia[], source?: 'share'|'camera', targetCapsuleId? }` (multi-item, from `useShareIntent` and CapsuleDetail's "+ Add Media" — library/camera picks route through here too, for per-item captions + the shared resize pipeline).
- **Carousel:** horizontal paging `FlatList`, page dots, "N / total" pill. **Single shared `useVideoPlayer`** keyed by `currentItem.uri` — only the current slide mounts a `VideoView` (avoids one-player-per-item hooks). Outer swipe-down `PanResponder` requires `dy > |dx|` so the `FlatList` keeps horizontal paging.
- **Multi-select capsules** via chip scroll (`Set<string>`); `targetCapsuleId` preselects, doesn't lock. "Add to Capsule" is **optimistic**: enqueues every (capsule × media) pair on the background upload queue and navigates immediately — no blocking upload UI.
- **Empty state** (no active capsules): "Create Capsule" → Create tab with `pendingMedia`, auto-uploaded post-creation. Swipe down >100px → discard confirmation. Upload: web `arrayBuffer`, native `FileSystem.uploadAsync`. Invalidates `capsules` + per-capsule cache keys.

---

## Share Intent (`expo-share-intent`)

Receives photos/videos shared from other apps, routes into `PreviewScreen`'s capsule-selection flow.

- **Library:** `expo-share-intent` 5.1.1 (last major supporting Expo SDK 54). Adds an iOS Share Extension target + Android `SEND`/`SEND_MULTIPLE` filters via `app.json`'s config plugin.
- **Extension name "Capsule Share"** (`iosShareExtensionName`). ⚠️ Sets BOTH the share-sheet name (raw) and the Xcode target name (alphanumeric-stripped) — must never sanitize to the same string as the main app target. `"Capsule"` collided with the main target and made EAS/fastlane sign the app with the extension's provisioning profile (build failure); `"Capsule Share"` → target `CapsuleShare`, no collision.
- **`<ShareIntentProvider>`** (`src/lib/ShareIntentProvider.{native,web,tsx}`) wraps `App.tsx` outside `ThemeProvider`; web is a passthrough.
- **Hook `useShareIntent(session)`** (`.native.ts`): filters `shareIntent.files` to image/video → `PendingMedia[]`; signed in → navigates to `Preview`; signed out → stashes to `shareIntentStash` (module-level, survives the Auth→App navigator swap) and drains once `session` is set. Always calls `resetShareIntent()`. Web is a no-op, same `.native`/`.web` split as `usePushNotifications`.
- **Build requirements:** cannot run in Expo Go (separate native target); needs a fresh `eas build` after any change; register the extension target alongside the main app in `eas credentials`.
- **Snapchat caveat:** its share sheet usually hands over a URL/text, not the image — users must save to Photos first, then share from there. Most other apps share the real file.

---

## Push Notifications (`usePushNotifications.ts`)

- Called from `App.tsx` with `userId` from session. Registers the Expo push token (native only) into `users.push_token` — **only if permission is already granted**; `registerToken` never calls `requestPermissionsAsync`. The one native-prompt call site is `requestPushPermission(userId)`, invoked by Onboarding's "Don't miss it" primer after the first capsule is created; "Maybe later" writes `cap_notif_reprime:<userId>` so a future re-ask knows the prompt is unspent.
- Tap handler reads `data.capsuleId`/`data.screen`, navigates via `navigationRef`. Display config (`showAlert`/`playSound`/`showBanner`/`showList`) all true.
- Invite pushes go through the `send-invite-push` edge function (`CapsuleDetailScreen.sendInviteNotification()`), which reads the invitee's `push_token` with the service role and posts to Expo. ⚠️ **"Caller owns the capsule + a `capsule_members` row exists" is NOT sufficient authorization** — an owner can insert a member row for *any* `user_id` (`can_insert_capsule_member`), making this an unlimited push channel to any known user UUID (`users` SELECT is `USING(true)`), with the group branch putting attacker-chosen text straight in the push **title**. Fixed by requiring a genuinely pending invite (`joined_at IS NULL`) or a joined group-capsule row (auto-join = standing consent) — unforgeable, since only the invitee can flip their own `joined_at`. Also claims `invite_pushed_at` atomically (claim-and-stamp, same idiom as `dispatchReminders`) so each invite pushes once. **Keep user text in the body, never the title.** In-app rows come from `notify_on_invite`; reaction notifications from `notify_on_reaction`.
- **Expo push requests are chunked to ≤100 messages** (PERFORMANCE.md #10) — `exp.host` rejects a >100-message request wholesale, so an unchunked 100+-member unlock would silently drop every push. `unlock-capsules` and `send-superlative-pushes` route through a shared `sendExpoPush()` helper that slices into ≤100-message requests, posted sequentially. Both keep `verify_jwt = false` (custom `CRON_SECRET` bearer auth).

---

## CapsuleDetailScreen Key Patterns

Large file (~2200 lines). Key sub-components and patterns:

**`ProgressRing`** — pure RN circular progress indicator. Two-half-clip technique: each half uses a full ring with two adjacent border colors (orange + track) clipped to its side, rotated to reveal the correct amount.
- Right half: `borderTopColor + borderRightColor = orange`, rest = trackColor
- Left half: `borderBottomColor + borderLeftColor = orange`, rest = trackColor
- Rotation formula: `rightRot = -135 + min(deg, 180)`, `leftRot = -135 + max(deg - 180, 0)`
- **Do not use `borderColor: 'transparent'`** — causes a dark rendering artifact on iOS at the color transition point. Always set all 4 border colors explicitly.

**`CountdownRing`** — wraps `ProgressRing` with lock icon, countdown text, and date line. Self-rescheduling tick (per-second under a day out, per-minute beyond). **Two phases with `contribution_start_at`:** pre-start counts down to the **start** date ("Not started yet"/"Starts `<date>`", progress over `created→start`), then at start flips live to the usual unlock countdown ("Capsule locked"/"Unlocks `<date>`", progress over `start→unlock`, ring resets to full at the flip). Tick keeps running across the start moment, stops only at unlock. With no start date it's the plain unlock countdown (progress over `unlock_at − created_at`, 1-year fallback if `created_at` unavailable). Takes `unlockAt`, `startAt` (= `capsule.contribution_start_at`), `createdAt`.

**`InviteModal`** — user search with 300ms debounce (min 2 chars), sends push notification to invited user client-side.

**Post-create invite nudge** — when `route.params.justCreated` is true and `members.length === 1`, a dismissible callout ("Invite people — capsules are better together") renders above the Media section, Invite button opens the same `InviteModal`. Gone once another member joins or the user dismisses it; never reappears (the param isn't persisted).

**`MediaViewerModal`** — full-screen swipe carousel. Gesture axis locks on first movement (prevents diagonal). Vertical swipe > 120px or velocity > 1.5 closes. Header controls sit inside a `LinearGradient` overlay (top 120px, `rgba(0,0,0,0.6)` → transparent) so they don't get lost against light images. Download: `expo-media-library` on native, anchor-element on web.

**Pinch-to-zoom (photos only).** One `PanResponder` carries a third axis, `zoom`, read from `evt.nativeEvent.touches` — hand-rolled since this project has no `react-native-gesture-handler`/`reanimated` (same approach as `CameraScreen`'s pinch). Two touches scale 1x–4x; one touch while `scale > 1` pans, clamped to `±(scale − 1) × dimension / 2` using the photo's actual **contain-fit rendered size** (`renderedSizeFor()`, from expo-image's `onLoad` intrinsic size, cached per media id in `intrinsicSizeRef`) — not raw screen dimensions, since a letterboxed image clamped to screen size could be dragged fully off-screen; falls back to screen dims until that photo's first `onLoad`. Paging/swipe-to-close are suppressed while zoomed, and `goToIndex` resets zoom so scale is always 1 whenever more than one slide is visible. A released pinch below `SNAP_BACK_BELOW` (1.15 — deliberately above "looks unzoomed", so an invisible ~1.08x residual from a fumbled pinch can't silently leave paging/dismiss dead) snaps back to exactly 1. Pure math lives in `src/lib/zoomMath.ts` (unit-tested); gesture wiring is in the viewer.

⚠️ **The `PanResponder`'s handlers (and `goToIndex`, which they call) read `itemsRef.current`, never the closed-over `items` param.** The responder is created once via `useRef`, so its handlers would otherwise close over whichever `items` array existed at mount — `items` is the parent's `photos` list, wholesale-replaced by `fetchPhotos()` from triggers that can fire while the viewer is open. A stale read let the photo-only gesture gate report "photo" for a slide that had actually become a video, letting a pinch silently accumulate zoom state with nothing on screen and then block paging. `itemsRef.current = items` is assigned every render; only the gesture-branch and `goToIndex` reads need it.

⚠️ **`onPanResponderTerminate` must perform the same cleanup as the release handler's zoom branch.** `onPanResponderTerminationRequest` defaults `true`, so a third finger landing on a header button (close/flag/download) mid-pinch terminates the responder instead of releasing it — without this handler `scaleRef` is left stranded above 1 with paging blocked from then on. `snapBackIfNeeded()`/`endGesture()` are extracted helpers shared by both paths so this cleanup can't drift out of sync.

⚠️ **Videos are excluded, and the gate is in the gesture branch — not the render.** `VideoSlide`'s native controls overlay likely consumes touches anyway, and scaling the container would distort them — but if the gate were only on the drawing, a pinch on a video would still accumulate scale state that nothing displays and then leak into the next photo.

⚠️ **A second finger joining a gesture already locked to `h`/`v` does NOT start a pinch.** The two-touch branch only fires when `axis.current` is `'none'` or already `'zoom'`. Without this guard, a pinch begun mid-swipe would zoom a cell that's only partially visible (breaking the "zoom is always 1 whenever more than one cell can be seen" invariant) and strand `translateX` at a non-multiple-of-`SCREEN_WIDTH` offset, since only `goToIndex` re-syncs it — the zoom release path doesn't.

⚠️ **`zoomScale`/`panX`/`panY` must animate with `useNativeDriver: true` everywhere.** Once the first animation on one of these latches it to the native driver, any later `Animated.timing`/`.spring()` call on it in the same session that omits `useNativeDriver: true` silently stops moving it. (Contrast the members sheet below: `MediaViewerModal` remounts fresh per open, so these three are recreated by `useRef` every time and can't carry a bad driver forward across sessions the way `membersSheetTranslateY` — a value that persists across opens — does.)

⚠️ **Transform order is `[{translateX}, {translateY}, {scale}]`.** Translate-before-scale applies the pan in untransformed space, tracking the finger 1:1 — the assumption `clampPan`'s bound encodes. Reordering it silently makes panning drift at high zoom.

**Members bottom sheet** — tap the avatar cluster to open; swipe-down-to-close on top of the usual backdrop-tap/X button. Three real bugs went into this gesture, worth knowing before touching it again:
- `membersSheetTranslateY` is a persistent (component-lifetime) `useRef` `Animated.Value`, unlike `MediaViewerModal`'s (which remounts fresh) — so **every** animation on it (open, close, release-cancel spring) must use `useNativeDriver: false`. The native driver permanently latches a value the first time `useNativeDriver: true` runs on it; mixing drivers on a value only ever created once works on the first open/close cycle and silently stops responding to drags on the second.
- The `PanResponder` is attached to the *whole* sheet, not just the handle/header strip — a drag starting anywhere, including over member rows, should dismiss it. Since the member list is a `ScrollView` sharing the dismiss axis, `onMoveShouldSetPanResponderCapture` (capture, not bubble — needed to win against the ScrollView's native pan recognizer before it starts scrolling) is gated on `membersScrollY.current <= 0 && dy > dx`, mirroring native overscroll-to-dismiss. `onStartShouldSetPanResponder` stays `false` so plain taps still reach the nested X button and member rows.
- `sheetCard` needs real `paddingTop` (not just the handle's own `marginTop`) — the backdrop `TouchableOpacity` is a *sibling* of the sheet, not an ancestor, so a touch landing even a few px above the sheet's top edge is grabbed by the backdrop's `Pressability` at touch-down and never reaches the sheet's `PanResponder` (a subsequent drag just cancels the backdrop's pending tap — net effect: nothing happens). Generous top padding fixes it without touching gesture logic.

**Real-time + unlock reconciliation:** `supabase.channel('capsule-${capsuleId}')` listens for `UPDATE` on `capsules`. Every applied capsule row (realtime, `load()`, cached mount) routes through **`applyCapsule(fresh)`**, which detects a live active→unlocked transition (`prevStatusRef`) and runs the reveal: triggers the animation, invalidates `signedUrls:${capsuleId}` **and** `media:${capsuleId}` (a surprise-mode owner's pre-unlock cache may hold an RLS-empty media list), then `fetchPhotos(true)`. This is what fixes the **"only unlocks after refreshing"** bug: realtime `postgres_changes` events are **not delivered while backgrounded** and a dropped socket won't replay, so the reveal can't depend on realtime alone. Two server-reconciling fallbacks cover the miss — **(1)** an `AppState` `'active'` listener refetches on foreground, and **(2)** a self-rescheduling poll that, while locked in time/`both` mode, wakes ~at `unlock_at` and re-checks every 15s past it (the cron flips up to ~60s late) until the server confirms. `HomeScreen` has the same `AppState` foreground refresh so the list badge flips too. The `prevStatusRef !== null && !== 'unlocked'` guard means opening an already-unlocked capsule shows no spurious ceremony.

**Upload flow:** all media uploads (Add Media picker, camera, everything from PreviewScreen) go through the **background upload queue** (`src/lib/uploadQueue.ts`). "+ Add Media" offers **"Open Camera"** (→ `openInAppCamera()`, navigates to the in-app Camera tab with `{ targetCapsuleId }` — NOT the system camera; cleared on blur so a later direct tab visit isn't sticky) and **"Camera Roll"** (`pickFromLibrary`). The library picker doesn't enqueue directly — `goToPreview()` hands assets to `Preview` (`{ media, source: 'camera', targetCapsuleId }`) for per-item captions + the shared resize pipeline before Preview itself enqueues them; `useUploadTasks(capsuleId)` renders the queue as local-URI pending tiles above the grid (spinner while uploading; failed tiles get Retry + dismiss). Surprise-mode shows an "N uploading…" line instead of tiles. An effect calls `fetchPhotos()` as each task lands. "Uploading n/N" + `ProgressBar` driven by `uploadQueue.getProgress(capsuleId)`.

**The library picker requests images AND videos** (`mediaTypes: ['images', 'videos']`, SDK 54's array form). `goToPreview()` maps each asset's real `mediaType` (not hardcoded `'photo'`), and stamps `durationMs` via `assetDurationMs()` (`src/lib/mediaDuration.ts`, normalizes the iOS/Android-ms vs. web-shim-seconds gotcha). **Over-cap library videos are no longer dropped here** — all picked videos pass through to Preview at full length, where the tier-based video-length gate handles them (Trim/Upgrade/Skip — see "Monetization"). `PendingMedia` carries no `mimeType` field; `uploadQueue.enqueue` defaults it from `mediaType`.

**Reactions:** `addReaction()` generates the reaction ID client-side via `randomUUID()` — never chain `.select()` after `.insert()` on `reactions` (the SELECT RLS policy may fail even though the insert succeeded, dropping the optimistic reaction). An existing reaction is updated (emoji swap) instead of duplicated — respects `unique(media_id, user_id)`.

**Cache integration:** on mount, checks `cache.get('capsule:${capsuleId}')` — cached renders instantly, fetches fresh in background. `load()` calls `cache.set()` and runs `fetchPhotos()` in the same parallel wave. Delete invalidates `cache.invalidate('capsules', 'profile')`.

**`fetchPhotos(force?)`** caches three things, each independently:
- `media:${capsuleId}` (3min TTL) — the raw row list, so a cache hit skips the DB read entirely. `force=true` (pull-to-refresh) always bypasses it, since another member's upload wouldn't trigger this client's own invalidate.
- `signedUrls:${capsuleId}` (50min TTL, under the 1hr signed-URL validity) — batches main + alt **+ thumbnail** keys into one `createSignedUrls()` call.
- `videoThumb:${mediaId}` (6hr TTL) — fallback only, for videos with no `thumbnail_key` (locally-generated `expo-video-thumbnails` frame, decoded from the remote `signedUrl`).

**Video thumbnails are generated at upload time, not display time.** `uploadQueue.runTask` runs `VideoThumbnails.getThumbnailAsync` on the **local** file (no network) right after upload, stores the JPEG at `media.thumbnail_key`, best-effort (failure leaves it null). `fetchPhotos` signs it alongside main/alt and sets `MediaItem.thumbnailUri` directly; the client-side generation loop only runs for rows still missing it. No member's device has to download+decode the full remote video just to draw a grid cell anymore, and web now gets a real thumbnail whenever `thumbnail_key` is present. Cleaned up alongside `storage_key`/`alt_storage_key` on delete.

**Grid/preview thumbnails use `transformMediaUrl()`** (`src/lib/mediaUrl.ts`), not the full-res `signedUrl` — `MediaItem.thumbSignedUrl` derives from the already-signed URL with no extra signing round-trip. The full-screen viewer and `VoteSheet`'s voting grid both fall back to `signedUrl` for anything without one (videos use `thumbnailUri` instead).

---

## Media Grid Layout

For equal-width thumbnail rows, use `flex: 1, aspectRatio: 1` — **not** `width: Dimensions.get('window').width / 3` (doesn't account for parent padding). Set `gap` on the row container.

"+N more" overlay: count is `photos.length - 2` (not `- 3`) because the overlaid photo itself isn't fully visible.

`MediaGalleryModal`: `FlatList` with `numColumns={3}`, `columnWrapperStyle={{ gap: 2 }}`, `ItemSeparatorComponent` for row gaps.

---

## iOS / Web Layout Gotchas

- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `flex: 1` + `aspectRatio`.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — always guard with `Platform.OS !== 'web'`. Use `expo-file-system/legacy` import path.
- `Alert.alert` does not work reliably on web — a multi-button one silently no-ops, so any action gated behind its callback never runs. Use inline `<Text>` error state and `<ConfirmModal>` (`src/components/ConfirmModal.tsx`) for confirmations.
- `DateTimePicker` with `display="spinner"` renders the native iOS wheel picker. Use `Platform.OS === 'web' ? 'default' : 'spinner'` for cross-platform.
- Import `SafeAreaView` from `react-native-safe-area-context`, never `react-native` (deprecated). Normal screens get the provider from React Navigation's `NavigationContainer`. **Inside a `<Modal>` it IS needed** — a Modal renders in a separate native view hierarchy the outer provider can't reach, so `SafeAreaView` returns zero insets and content slides under the notch; wrap the modal's content in its own `<SafeAreaProvider>`.
- **`KeyboardAvoidingView` is broken on iOS under the New Architecture** (`newArchEnabled: true`) — it silently fails to move its content, leaving the input **under the keyboard**. Bit both a plain screen and a modal caption field. **Don't use KeyboardAvoidingView; track the keyboard height yourself**: `Keyboard.addListener('keyboardWillShow'/'keyboardWillHide', e => setKbHeight(e.endCoordinates?.height ?? 0))` (`keyboardDidShow/Hide` on Android), then lift the bottom bar/panel by that height — `transform: [{ translateY: -kbHeight }]` on `PreviewScreen`'s caption panel, or `paddingBottom: kbHeight` on `CapsuleDetailScreen`'s `MediaViewerModal` caption editor (KAV also can't measure its frame origin inside a `<Modal>`'s separate window, so the manual-height approach handles both cases). Any new text field near the bottom of the screen needs this pattern, not KAV.

---
## Theme System

The primary accent color is user-customizable. All app screens use `useTheme()` from `src/context/ThemeContext.tsx` — never hardcode `#FF6B35` in app screens.

```tsx
const { accentColor, onAccentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient } = useTheme();
```

`ThemeProvider` wraps `NavigationContainer` in `App.tsx`, loads `users.accent_color`/`home_layout` on login (one query), resets both on logout. `setAccentColor`/`setHomeLayout` update state instantly and persist in the background.

⚠️ **Never hardcode `'#fff'` for text/icons ON an accent background — use `onAccentColor`.** Pro users pick arbitrary colors; white on a pale accent can be near-invisible (1.07:1 seen on `#FFF9C4`). `onAccentColor` comes from **`src/lib/accentContrast.ts`** (`onAccent(hex)`), flipping to near-black `#0A0A0A` when the accent's relative luminance exceeds **0.38**, else `#FFFFFF`.

**0.38, deliberately NOT the widely-copied 0.179** (the luminance that maximizes WCAG ratio, not legibility — at 0.179 seven of ten presets, including the brand coral, would flip to dark text). 0.38 (Andrew Somers/Myndex, APCA/WCAG3) is "about middle contrast for text under typical conditions" — flips only the genuinely unreadable presets/pale customs while correctly keeping white on dark customs like navy. `contrastRatio()` in the same module is WCAG-correct but for tests/reporting only, never the flip decision.

⚠️ **Known-open:** presets that keep white sit at 2.84–4.20:1, under AA's 4.5 — a deliberate brand-preservation tradeoff, not a bug to fix by lowering the threshold unilaterally.

**Two call-site rules:** conditionally-accent surfaces (mode chips, selected chips, upvote pills, invite tabs) must gate the override on the same condition as the background. Components receiving `accentColor` as a **prop** (`MemberBubble`, `DatePicker`/`RecurrenceAnchorPicker` sub-components) call `onAccent(accentColor)` locally rather than growing their prop signature. Bare accent surfaces with no content need nothing. When `accentGradient` is set, `onAccentColor` decides on the gradient's **lighter stop** (`onAccentForGradient`), since `accentColor` only tracks the first stop.

**Accent gradients (Pro cosmetic).** `accentGradient: [string,string] | null` (`users.accent_gradient`, via `src/lib/accentPresets.ts`'s `parseGradient`/`serializeGradient`) — null = solid, default for all. `setAccentGradient(g)` also writes `accent_color = g[0]` for coherence; picking a solid clears the gradient. `ACCENT_PRESETS` (10 solids, free) and `ACCENT_GRADIENTS` (6 pairs, Pro-only) live there; `<ColorPicker>`/gradient swatches are `isPro`-gated (locked row + `proGateHit`). **Grandfathered, never reset** — no migration touches an existing value. `<AccentSurface>` renders gradient-or-solid, used only on the Profile hero glow and camera tab button; everywhere else reads solid `accentColor` by design.

**No flash of default orange on launch** — fixed via a per-user cache (`cap_theme_v1:<userId>`): web seeds state synchronously from `localStorage`; native does a fast `AsyncStorage` read before the Supabase fetch. `setAccentColor`/`setHomeLayout` write through too. Fixes from the *second* launch onward per user only.

**`homeLayout: 'list'|'grid'`** (default `list`) toggles Home's `FlatList` between one/two-column cards (`key={homeLayout}` forces remount on column change), synced like `accent_color`.

**`CountdownBadge` (Home)** fetches `unlock_mode` so locked `proximity` capsules show "Unlocks together" instead of counting down a placeholder `unlock_at` (see Proximity Unlock); `both` keeps the real countdown. Ticks live via self-rescheduling `setTimeout`; at zero shows "Unlocking…" until the flip. Home self-refreshes near the unlock moment (wakes ~at the soonest due time, rechecks every 15s, engages within 24h) so cards flip without a manual refresh.

**Auth screens keep static `#FF6B35`** (no user loaded yet). **In `StyleSheet.create()`**, keep `#FF6B35` as fallback; apply `accentColor` as an inline JSX override.

## Design System

Dark theme throughout.

| Token | Value |
|---|---|
| Primary (accent) | `accentColor` from `useTheme()` — default `#FC6A5B` (brand reddish-coral; static `#FF6B35` fallbacks remain in `StyleSheet.create` blocks and auth screens) |
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

**Text muted (`#555555`) vs. secondary (`#888888`):** `#555555` on `#0A0A0A` is ≈2.5:1 — below AA. **Reserve `#555555` for true decoration** (uppercase micro-labels, "(optional)", divider words, inactive icon tint). **Any actual content — dates, counts, empty-state copy, hints, button labels — must use `#888888`+** (≈5:1, AA). Default new muted text to `#888888` unless clearly decorative.

**Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`** — otherwise VoiceOver/TalkBack reads "button" with no name (a `Text`-child button already has one). Tab labels and countdown/badge `Text` carry `maxFontSizeMultiplier` (≈1.3) so large Dynamic Type doesn't clip tight layouts.

---

## Owner-Only Capsule Actions

All of the following are owner-only and silently no-op/navigate away if not owner — **except Archive**, which any joined member can do:

- **Edit capsule** — title, description, unlock date, contribution lock date. Blocked once unlocked.
- **Archive/restore — PER-MEMBER, not capsule-global** (`20260711150000_per_member_archive.sql`). Stamps `archived_at` on the **caller's own `capsule_members` row**, hiding it from only that user's Home feed. Replaced an earlier capsule-global design (`capsules.archived_at`, now retired/frozen) that let any member archiving remove it from *everyone's* feed. RPC **`set_capsule_archived(p_capsule_id, p_archived)`** kept its signature but now updates the caller's member row (`security definer`, requires `joined_at is not null`). Gated on `canArchive = myMember?.joined_at != null`. Reversible, separate section from Danger Zone (Delete-only). Shows a toast with **Undo** (re-calls the RPC in reverse).
- **Home long-press menu** — Open/Edit/Archive; Edit only for owner pre-unlock; Archive unconditional. No Undo toast here.
- **Delete capsule** — via **`delete_capsule_with_storage(p_capsule_id)`** RPC (`security definer`), not client-side key-collection + delete. The old client path selected storage keys from `media` first, but that SELECT is hidden from the owner under surprise mode's default lock, silently returning zero rows and orphaning every file (BUGS.md #1). The RPC authorizes inline (`owner_id is distinct from auth.uid()`, null-safe), collects keys as definer (bypassing RLS), then deletes the row (cascades to members/media/reactions/notifications/superlative_categories).

  ⚠️ **The RPC no longer deletes from `storage.objects`, and must not** — Supabase's `storage.protect_delete()` trigger rejects direct storage-table deletes (`42501`), which broke both this RPC and `delete_my_account` until fixed. Cleanup now runs **client-side, before the row delete**: client-side because only the Storage API removes blobs, before because the delete RLS policy (`you own the capsule`) can't pass once the row is gone. `capsule_storage_keys(p_capsule_id)` (definer, owner-authorized) supplies keys since a client select would silently return zero under surprise mode. Best-effort (an orphaned blob beats a capsule that won't delete). `delete_my_account` mirrors via `my_account_storage_keys(p_delete_contributions)`, which must run first since that call destroys the auth user/JWT.

  Storage DELETE policies: `capsule-media` — capsule owner only (not uploaders, to avoid stranding a media row). `avatars` — own folder only.

  ⚠️ **`superlative_winners`' target FKs are `ON DELETE CASCADE` and must stay that way** — the table's XOR check makes `SET NULL` unsatisfiable (nulling either column raises 23514, aborting the delete). They were wrongly `SET NULL` while `superlative_votes` was correctly `CASCADE`, so a capsule with a finalized media-target winner couldn't be deleted (fixed). Confirmation via `<ConfirmModal>` (not `Alert.alert`, no-ops on web). Owner-only.
- **Manage members** — lists joined + pending; trash icon removes after confirmation.

## Onboarding (`OnboardingScreen`)

A 5-step personalized flow ("Onboarding v2", rationale in `designs/ONBOARDING_V2.md`), gated by `users.onboarded_at`:
- `AppNavigator` first checks a **local flag** (`sessionStore.wasOnboarded(userId)`, `AsyncStorage`) — if set, routes straight to `'Tabs'`, no network round-trip. Written when a `users.onboarded_at` query confirms true, and again on wizard completion.
- If unset: falls back to querying `users.onboarded_at` (null → `Onboarding`, else → `Tabs`, writes the flag). Query error/5s timeout falls through to Tabs.
- `onboarded_at` remains server source of truth; nothing un-sets it.
- `saveProfile()` writes `display_name`/`avatar_url`, stamps `onboarded_at`, calls `markOnboarded` then `setTourPending()`. Runs at the end of step 3 on every exit path.
- Exits via `navigation.replace('Tabs', …)`. Bio/accent color live in Edit Profile/Settings, not here.

Steps (copy from `src/lib/onboardingMoments.ts`'s `MOMENTS` matrix, keyed on `OccasionKey`):
1. **Name + avatar.** Avatar upload starts in the background the moment it's picked; failure degrades to a toast, never blocks completion.
2. **"What are you waiting for?"** Six moment cards (1:1 with `capsules.occasion`) + optional 60-char free text, which always becomes the title verbatim if typed. Skip → Home.
3. **First capsule, pre-built.** Inline-editable title, occasion-aware date chips, surprise-mode line. "Create my capsule" → `saveProfile()` → `create_capsule_with_owner(...)` → best-effort `set_default_superlatives`. Always `owner_preview_locked: true`, `unlock_mode: 'time'`, 48h voting.
4. **Notification primer** (only if a capsule was created). "Yes, notify me" calls `requestPushPermission` (the app's only native-prompt site); "maybe later" sets `cap_notif_reprime:<userId>`. Web is copy-only.
5. **Sealed ceremony.** Lock scale-in + success haptic + 30s countdown. Actions: Invite (share the join link), Add first photo (→ Camera), or home.

Footer exists only for steps 1–3; steps 4–5 render their own actions in-body — don't render placeholder `<View>`s for missing footer buttons.

## New-User Tour

One-time coach-mark walkthrough after onboarding, custom-built (no library, no SVG).

- **`TourProvider`/`useTour`/`useTourTarget`** (`src/context/TourContext.tsx`) — mounted in `App.tsx`; holds step list/index, a target-id registry, drives `navigationRef` between steps. Elements opt in via `useTourTarget(id)`.
- **`TourOverlay`** — four dim `View` panels around a `measureInWindow` rect + a tooltip card. No SVG mask, so identical on web/native.
- **`buildTourSteps(ctx)`** (`src/lib/tourSteps.ts`) — pure, unit-tested. `hasCapsule` → full walkthrough; no capsule → shorter join-first path. In-capsule stops target only what a fresh, still-locked capsule shows.
- **Target ids** — tab bar (`tab:Camera`/`Create`/`Notifications`/`Profile`), Home (`home-scan`, `capsule-card`), CapsuleDetail (`capsule-countdown`/`-add-media`/`-invite`/`-awards`). A target that never mounts auto-skips.
- **`waitForTarget`** (`src/lib/waitForTarget.ts`) — pure poll loop waiting for a newly-navigated screen's target to register.
- **Trigger/persistence** (`src/lib/tourStorage.ts`, `AsyncStorage`) — `saveProfile()` calls `setTourPending()`; `HomeScreen` consumes it once (`consumeTourPending()`) and starts only if `cap_tour_seen` isn't set. `markTourSeen()` on finish/Skip.

## Settings Screen (`SettingsScreen`)

**Appearance is tier-aware.** Preset swatches always shown; `<ColorPicker>`/gradient swatches only for `isPro` — non-Pro sees a locked row calling `proGateHit`. Local `pending` color previews before commit. Save writes `users.accent_color` via `ThemeContext.setAccentColor`.

**Capsule Pro section** (native-only) reads `isPro` from `useEntitlements()`. Non-Pro: "Upgrade" (`presentPaywall()`) + "Restore Purchases". Pro: "Manage Subscription" (`presentCustomerCenter()`). Copy is capability-only, no quality claim.

**Community section** — Discord/Instagram/TikTok rows via `Linking.openURL`, URLs centralized in `src/lib/communityLinks.ts`.

## ColorPicker (`src/components/ColorPicker.tsx`)

Controlled: `{ value, onChange, originalValue? }`. 2D saturation/brightness panel, hue slider, touch via `onStartShouldSetResponder`/`onResponderMove`, hex input. Exports `hsvToHex`/`hexToHsv`.

## ConfirmModal (`src/components/ConfirmModal.tsx`)

**Use instead of `Alert.alert` for any confirm/cancel decision** — a multi-button `Alert.alert` silently no-ops on web. Controlled: `{ visible, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel }`. `destructive` colors confirm `#FF3B30`; `loading` swaps it for a spinner and disables both buttons.

## Unlock Cron (`supabase/functions/unlock-capsules`)

Marks `status='active'`, `unlock_at <= now()` capsules `'unlocked'` and pushes joined members. `unlock_mode='time'` only — `proximity`/`both` use `check_in`.

- **Trigger:** `pg_cron` `* * * * *`, EXISTS-gated (fires only when a capsule is due or in its widest reminder window within 24h — pure invocation-count optimization). Same pattern on `create-group-capsules` and `send-superlative-pushes`. Re-register: `cron.unschedule` then `cron.schedule`.
- **Countdown reminders:** same function fires pre-unlock pushes at 1d/1h/10m (`dispatchReminders`), each tier claimed+stamped atomically (race-safe, at-most-once). Stamp columns `unlock_reminder_{1d,1h,10m}_sent_at`. **Tiers' windows overlap**, so a late-created capsule can match all three in one tick — deduped per capsule across tiers (`remindedThisRun` Set) to send at most one per run; all stamps still commit. Same fix pattern as Contribution Nudges.
- **Auth:** `Authorization: Bearer <CRON_SECRET>` via **`requireCronSecret(req)`** (`supabase/functions/_shared/cronAuth.ts`), shared by all six cron functions, value in Vault (`cron_unlock_capsules_secret`).

  ⚠️ **It FAILS CLOSED, and must keep doing so.** Functions used to inline `if (CRON_SECRET && auth !== ...)` — fail-**open**: an unset env var short-circuits, skipping the check, turning a `verify_jwt=false` function into a public unauthenticated endpoint (mass push spam, quota burn) with no error surfaced. Fixed: unset secret now returns constant-time-compared **500 "Server misconfigured"**. **Never reintroduce the `SECRET && ...` guard shape.**

  **Deploy ordering:** `CRON_SECRET` must be set before deploying any of the six, or all 500 simultaneously. **`create-group-capsules` deliberately uses a different auth style** (Vault RPC `check_cron_secret`) — don't unify it. **Multi-file deploys** need the nested layout (`"<fn>/index.ts"` + `"_shared/cronAuth.ts"`) — a flat deploy boot-crashes on the import. Verify with a wrong bearer: 401 = healthy, 500 = broken.
- **`CRON_SECRET` is project-wide**, not per-function — readable by any function immediately once set anywhere.
- **Idempotency:** `.eq('status','active')` makes repeat calls safe; the in-memory rate-limit is dead code on edge runtimes but harmless.
- **Rotating:** update Vault AND the project-wide secret; each function needs a redeploy to pick it up (module-load env).

## Instant Unlock (`claim_capsule_unlock`)

The cron's once-a-minute cadence flips `status` up to 60s late — the largest chunk of perceived latency. `claim_capsule_unlock(p_capsule_id)` (`security definer`) lets a **joined member's client** perform the flip the instant it's due; `CapsuleDetailScreen`'s poll calls it and reveals off the returned status.

- **Cannot open anything early** — guarded by `unlock_at <= now()` on the **server** clock. Definer since the `capsules` UPDATE policy is owner-only but any joined member should trigger it (same reasoning as `check_in`).
- **`unlock_mode='time'` only** — `both` still needs `check_in`'s physical-together half.
- ⚠️ **The unlock push had to be decoupled from the flip.** `unlock-capsules` used to derive its push list from rows its own update matched — once a client can win that race, that update matches zero rows and nobody gets pushed. The notifier now claims independently via **`capsules.unlock_notified_at`** (race-safe claim-and-stamp against both a concurrent cron tick and a client flip). Migration backfilled every already-unlocked capsule to avoid a rollout blast.
- ⚠️ **The cron's EXISTS gate had to widen too** — now also matches `status='unlocked' and unlock_mode='time' and unlock_notified_at is null`, or a client-flipped capsule never reaches the notifier.
- **Known gap (pre-existing):** proximity/`both` capsules notify nobody on unlock — `check_in` inserts no `notifications` rows.
- The stamp-unlock-meta trigger fires on this flip like any other.

**Media genuinely cannot be preloaded before unlock** — the `media` SELECT policy hides rows pre-unlock under surprise mode (default), so there are no keys to sign (deliberate). `fetchPhotos` instead prefetches the first 12 thumbnails the instant signed URLs land at unlock. Don't relax RLS to prefetch earlier without an explicit product decision.

## Proximity Unlock

`unlock_mode` (`time`|`proximity`|`both`): `time` unlocks via cron; `proximity` when all joined members are physically together; `both` requires both.

**`check_in(p_capsule_id, p_lat, p_lng)` RPC** (`SECURITY DEFINER`) — records the caller's location, then unlocks if every joined member checked in within 10 minutes and max pairwise distance is `<= proximity_radius_m` (default 100m). Definer so any joined member can trigger it; authorizes inline. Returns `{ unlocked, checked_in, total, within_range }`; distance via `_haversine_m`.

**Check-in UI** — `CheckInCard` renders for locked `proximity`/`both`. "We're here — check in" requests location, calls `check_in`, shows `N of M here`; once checked in, flips to a confirmed re-tappable state (check-ins expire after 10 min). Seeded from the caller's own `checkin_at`, only if within the 10-min window. Realtime fires the reveal for everyone on the flip.

**Unlock-mode picker** — Create/Edit's "Unlock When" (Date/Together/Both); Proximity hides the unlock-date field and skips its validation.

## Surprise Mode (`capsules.owner_preview_locked`)

When true, **the owner is locked out of viewing media exactly like everyone else** until unlock — can upload, see members, and a "N memories waiting" count, but no thumbnails/viewer.

- **Default ON for new capsules**; pre-existing capsules backfilled to `false`.
- **Creation-only** — `CreateScreen`'s "Keep it a surprise" `Switch` sets it at insert; no toggle in `EditCapsuleScreen` by design, so an owner can't flip it off right before unlock to peek.
- **Server-side enforcement (RLS).** The `media` SELECT policy gates pre-unlock reads on `role in ('owner','contributor') AND NOT owner_preview_locked` — not just a client hide. ⚠️ **That policy's membership test lacked a `joined_at is not null` filter** — an invited-but-never-accepted user could read every media row (captions, uploader ids, storage keys), despite a comment claiming parity with the (correctly filtered) storage policy. Fixed. **A membership test anywhere in this codebase means `joined_at is not null`** — `capsule_media_count`, `tally_superlatives`, `set_capsule_archived` all filter on it.
- **Count via SECURITY DEFINER RPC `capsule_media_count(p_capsule_id)`** (0 for non-members), called only when the row-read returns zero (the ambiguous case); otherwise `mediaCount` comes directly from the fetched count. The locked box renders `mediaCount`, not `photos.length`.
- **Client gate:** `canSeePhotos = !isLocked || (isOwner && !capsule.owner_preview_locked)`.

---

## Superlatives (Awards)

Per-capsule, yearbook-style awards. Members suggest categories; enough upvotes auto-promotes to live; voting opens at unlock for an owner-configured window; winners reveal at close.

### Lifecycle
- **suggest** — joined member INSERTs `superlative_categories` (label 3–80 chars, `target_type ∈ {person,media}`). RLS: `suggested_by = auth.uid()`, membership, `status='pending'`. Trigger `notify_on_superlative_suggested` notifies every other joined member.
- **upvote** — INSERT `superlative_upvotes`. `_promote_superlative` trigger flips status to `live` once `count >= ceil(joined/2)` (SECURITY DEFINER, bypasses owner-only UPDATE).
- **vote** — upsert `superlative_votes` PK `(category_id, voter_id)`. RLS: self, no self-vote, category `live`, window open, target matches capsule + `target_type` (via `_superlative_target_valid`). Editable/deletable until close.
- **finalize** — `close_superlative_windows()` cron calls `finalize_capsule_superlatives()` once `now() >= voting_closes_at`: `rank()=1` winners (ties=co-winners), archives never-promoted suggestions, stamps `voting_finalized_at`, notifies (`superlative_won`) winners + winning-media uploaders.

### Voting window
`capsules.superlative_voting_hours` (1–720, default 48, `<VotingWindowPicker>`). `_stamp_unlock_meta` (BEFORE UPDATE) stamps `voting_closes_at = unlocked_at + voting_hours` on unlock, for both the time-cron and `check_in` paths. `dispatch_superlative_closing_soon()` fans out 2h before close (`_sent_at` dedupe stamp).

### RLS + anonymity
`superlative_categories` — members read/insert(pending); owner update/delete. `superlative_upvotes` — members read/upvote pending, remove own. **`superlative_votes` — voter reads only their own row**; aggregates come from `tally_superlatives(capsule_id)` (SECURITY DEFINER, returns counts only after close) — this is what makes "tallies hidden during voting" server-enforced. `superlative_winners` — read-only for members, written only by finalize; the reveal UI reads it directly, not `tally_superlatives`.

### Notifications + push
`superlative_suggested`/`superlative_closing_soon`/`superlative_won` are inserted by trigger/finalize/dispatch, delivered by `send-superlative-pushes` (cron-pinged every minute, pulls `pushed_at IS NULL`, chunks ≤100, stamps `pushed_at`).
⚠️ **The `users` embed MUST be FK-qualified** (`users!notifications_user_id_fkey(push_token)`) — `notifications` has FKs to `users` via both `user_id` and `actor_id`, so a bare `users(...)` embed is ambiguous and PostgREST 500s (this broke the function for days under the EXISTS-gated cron). Any new `notifications`→`users` embed must qualify the FK.
Tap routing → `data.capsuleId` → `CapsuleDetail`. The unlock push body doubles as the "voting opens" cue.

### Cron job
`close-superlative-windows` (`* * * * *`): `dispatch_superlative_closing_soon()`, `close_superlative_windows()`, then `net.http_post` to `send-superlative-pushes` — same project-wide Vault secret as the unlock cron.

### Client integration
`<AwardsSection>` (under the media grid, unlocked only) branches on `voting_closes_at`/`voting_finalized_at`: open (upvote/progress, Vote/Change), closed-pre-finalize ("Tallying votes…"), finalized (staggered `WinnerCard` reveals, tied co-winners side by side; winning media thumbnails tap through to `MediaViewerModal` via `onOpenMedia`). Realtime on `superlative_categories` drives upvote/promote; a second on `superlative_winners` INSERTs drives the reveal. The parent's `capsules` UPDATE channel catches `voting_finalized_at` and re-renders (the section can't subscribe to capsule changes itself).

### Gotchas
Own vote IS client-readable; anonymity is about *other* voters. `finalize_capsule_superlatives()` is idempotent (safe to hit repeatedly). Auto-promote checks `status='pending'` first — no double-promote race. **`isClosed` self-advances live at the close boundary** via a `nowTick` state + one-shot `setTimeout` (capped ~23 days, dodges 32-bit overflow since windows run up to 720h) — "voting open" flips to "Tallying…" with no other trigger needed.

### Default Awards
A parallel path to `live`: up to **4 default awards**, themed by `occasion`, inserted already `live` — no suggest/upvote gauntlet, coexists with real suggestions.
- `capsules.occasion` (wedding/vacation/party/baby/milestone/general) — creation-only chip, selects the pool in `src/lib/awardPool.ts` (`AWARD_POOL`, `pickDefaults(occasion, count=4, exclude=[])`, `pickReplacement`).
- `set_default_superlatives(p_capsule_id, p_awards jsonb)` RPC (security definer) — only way a default reaches `live` (client INSERT RLS forces `pending`). Authorizes via `owner_id is distinct from auth.uid()` (null-safe) + not `unlocked`. **Full-replace**: deletes existing `is_default` rows, re-inserts (safe pre-unlock). Caps at 4, re-validates server-side.
- `notify_on_superlative_suggested` early-returns on `NEW.is_default` — seeding never fans out notifications.
- `src/components/DefaultAwardsCard.tsx` — one component, `mode="preview"` (CreateScreen, controlled, nothing persisted pre-capsule) vs `mode="manage"` (CapsuleDetailScreen, pre-unlock only, calls the RPC per mutation, optimistic w/ rollback). Collapsed by default, summarized via `summarizeAwards`; a failed RPC call toasts.
- `CreateScreen.handleCreate` calls the RPC once post-insert (non-fatal). `CapsuleDetailScreen` renders `manage` only for `isOwner && isLocked`; post-unlock, defaults are indistinguishable from suggested awards.

---

## Groups

Named member sets with an optional recurrence schedule that auto-creates capsules.

**Schema:** `groups` (id, name, `created_by`→`users(id)` on delete cascade, `recurrence_interval` [weekly/monthly/yearly/manual], `unlock_duration_hours`, `next_capsule_at`, `last_capsule_at`, `anchor_weekday/day_of_month/month/day/hour/minute`, `recurrence_paused_at`, `reminder_lead_hours`, `next_reminder_sent_at`); `group_members` (group_id, user_id, joined_at, unique pair); `capsules.group_id` nullable FK.

**`create_group_with_creator(...)` RPC** — same orphan-avoidance as `create_capsule_with_owner`: group + creator's `group_members` insert in one `security definer` body, so a mid-sequence failure can't leave a permanently-invisible orphan (`groups` SELECT is membership-gated). Server generates the UUID.

**RLS:** `get_my_group_ids()` (SECURITY DEFINER) avoids recursion, same pattern as `get_my_capsule_ids()`. **`group_members` INSERT is creator-only** via `is_group_creator()` — the old policy also allowed self-insert, a real privilege escalation (any member merely invited-not-joined to one group capsule could read the group's `group_id` via `get_my_capsule_ids()` and self-join, auto-joining every future recurring capsule). Closed `20260710000000`. DELETE stays creator-or-self (leaving is legitimate). `is_group_creator`/`check_cron_secret` were captured from a live-DB-only state with no prior migration — verify with `pg_get_functiondef` before assuming a migration is current on any future groups mismatch.

**Auto-join is standing consent** — every group capsule inserts other members already-joined, not pending. `notify_on_invite` branches: `joined_at IS NULL` → `invite`; joined + has `group_id` → `group_capsule` (new type, mutually exclusive by construction). `NotificationsScreen` treats it as capsule-nav. `send-invite-push` swaps copy to "New capsule for `<group>`".

**`create-group-capsules` cron** (every minute):
- **Claims each due group atomically first** (advances `next_capsule_at`/`last_capsule_at` gated on due, proceeds only for matched rows) — makes overlapping ticks safe.
- **Re-checks the creator's Pro tier every tick post-claim** — `guard_group_recurrence` only gates at creation, so a lapsed creator's group would otherwise fire forever (fan-out runs `service_role`, bypassing `enforce_member_limit`). Non-pro → no insert/fan-out/push, and **the claim is NOT released** (unlike the failure path below) — skipped once per cycle, not retried every minute.
- **Every insert after the claim is checked; failures roll back** — a failed member insert (or zero members) deletes the capsule and resets `next_capsule_at`/`last_capsule_at` so the next tick retries.
- Seeds 4 default awards (`is_default=true`) from a `general`-pool mirrored verbatim from `awardPool.ts` (groups have no `occasion`; the owner-gated RPC is unusable by service role). Pushes chunked ≤100. Titles `"{name} — {Month Year}"`, day-granular for weekly groups (avoids 4–5×/month collisions).
- ⚠️ **Auth now uses the shared `requireCronSecret` helper, like every other cron.** It used to call `check_cron_secret(provided)`, a public-schema SECURITY DEFINER RPC returning the boolean **to the caller** — any signed-in user could brute-force it as a guess oracle for the project-wide `CRON_SECRET` (non-constant-time compare). Fixed (`20260802120100`): EXECUTE revoked to `service_role` only, hashed compare. **Never publish a secret comparison through a public-schema RPC** — use `requireCronSecret` for any new cron. Now reads `CRON_SECRET` from env (not Vault) — keep env and Vault entry in sync.

**Manual create respects the schedule** — starting a capsule manually for a recurring group bumps `next_capsule_at` forward via `updateGroup` right after creation, else the cron double-fires. Best-effort. Capsule owner is whoever tapped create, not necessarily the group creator (accepted).

**`CreateGroupScreen`/`ManageGroupScreen`** — progressive disclosure (Name/Members/recurrence always visible; anchor picker, unlock duration, reminder collapse behind "Schedule details" when `recurrence !== 'manual'`, summarized via `describeAnchor()`+`unlockDurationLabel()`). Unlock Duration is day-count chips + Custom numeric input, not a date picker. `createGroup()` can return `memberError: true` (group still usable) if the bulk member insert fails. `ManageGroupScreen` is creator-only, wires up previously-dead `updateGroup`/`addGroupMember`/`removeGroupMember`; new members only affect future capsules. Both screens' post-create/empty-state nudges mirror CapsuleDetail's pattern (not-persisted route param, dismissible).

**`handleSave` only passes `recurrence`/`anchor` to `updateGroup` when the schedule actually changed** (vs. a load-time snapshot) — `updateGroup` reschedules `next_capsule_at` and clears `next_reminder_sent_at` whenever `recurrence` is present, so passing it unconditionally on a pure rename risks a duplicate reminder.

### Fixed calendar anchors, pause/resume, and reminders
A recurring schedule is a **fixed calendar anchor** (weekday / day-of-month / month+day + shared `anchor_hour`/`anchor_minute` captured once), not "N days from last fire."
- `src/lib/recurrence.ts` — pure, `computeNextOccurrence`/`computeUpcomingOccurrences`. Clamps short months/non-leap-years, recomputed fresh each cycle. Verified via a plain `node:assert/strict` script (no test framework in this repo — deliberate).
- **All anchor fields are UTC, math is UTC-only** (`Date.UTC`/`getUTC*`/`setUTC*` only) — keeps the device-local client and UTC Deno cron/Postgres in agreement without either side knowing the other's timezone. Don't reintroduce a local accessor — `recurrence.ts` and `create-group-capsules`'s **duplicated-verbatim** copy (Deno can't import `src/lib`) must stay in sync.
- **Pause/resume** — `recurrence_paused_at` (null=active); cron filters it so `next_capsule_at` stops advancing (no backlog). Resuming recomputes from *now*, not the frozen point.
- **Upcoming-occurrences preview is purely client-side**, recomputed from `anchor + now()` — can't distinguish a successful reschedule write from a silently-failed one.
- **Pre-existing groups only have the anchor sub-field for their original interval populated** — all read sites default missing sub-fields to today's date (else `computeNextOccurrence` throws); any new call site needs the same defaulting.
- **Reminders** — `reminder_lead_hours` (null=off; 24/72/168), `next_reminder_sent_at` (reset wherever `next_capsule_at` changes). Cron's `processReminders()` (runs before capsule-creation each tick) claims atomically, inserts `group_capsule_upcoming` per joined member, pushed inline; isolated in its own try/catch (best-effort, can't block capsule creation).

**Data-layer error handling** — `deleteGroup`/`removeGroupMember` return `{ error? }` rather than throwing; screens toast + only navigate/invalidate on success. `listMyGroups`/`getGroup`/`getGroupMembers` warn + fall back to empty on fetch error (deliberate — `useCachedFetch` has no throw-retry path).

**Ownership safety net.** `groups.created_by`/`capsules.owner_id` are `on delete cascade` — deleting an owner used to silently delete every group/capsule they owned for every other member too. `delete_my_account` reassigns (oldest-`joined_at`, deterministic) each to another existing (joined, for capsules) member if one exists, before the final `auth.users` delete; capsule transfer also promotes that member's role. No other member → falls through to the existing cascade unchanged.

**Storage cleanup is server-side, inside `delete_my_account`** — client-side pre-RPC cleanup (the old approach) could destroy other users' photos on RPC failure, or wipe storage for capsules the RPC *transfers* rather than deletes; running after the RPC can't work either since the JWT dies with the account. Fix: computes the exact key set for media actually being deleted (owned capsules with no other joined member, plus — if `p_delete_contributions` — the caller's own contributed media anywhere) *before* any mutation, deletes those `storage.objects` rows directly plus the avatar.

---

## Content Moderation (Report + Block)

UGC compliance for Apple Guideline 1.2. Scope is **report + block** only; EULA-at-signup and an admin console are deferred.

**Tables** (`20260609230500`): `content_reports` — report against `media`/`user`; RLS insert-as-self, read-own only, no client review path (triaged out-of-band via service role); CHECK enforces exactly-one target + no self-report. `blocked_users` — directional `(blocker_id, blocked_id)`; owner-only RLS on select/insert/delete so the blocked party can never tell.

**Block enforcement is client-side filtering** (not RLS — speed tradeoff, hardenable later): `src/lib/blocks.ts`'s `blockStore` (module-level `Set`, pub/sub, optimistic block/unblock ignoring 23505) is the sync filter primitive; `useBlockedUsers()` is the reactive hook. `useAuth` warms it on sign-in, clears on sign-out. Filter sites: `fetchPhotos`, `MediaViewerModal.loadReactions`, `InviteModal` search.

**Report UI** — `ReportModal` (reason radio + optional ≤500-char details), entry points: flag icon in `MediaViewerModal`, `⋯` overflow in `PublicProfileScreen` (Report + Block via `ConfirmModal`). A blocked profile hides Invite + shows a notice.

**`BlockedUsersScreen`** (Settings → Privacy) resolves the ID-only `blockStore` set into names/avatars locally (shared store stays id-only). Unblock is direct, optimistic w/ toast-on-failure rollback.

---

## Friends

Explicit friend requests (`friendships` table), replacing the old derived-from-shared-capsule model. Capsule invites remain open to anyone; friends are a shortcut, not a gate.

- `src/lib/friends.ts` — `getFriendStatus(id)` → `none|friends|incoming|outgoing`; `sendFriendRequest`/`acceptFriendRequest`/`removeFriendship` (one delete covers cancel/decline/unfriend); list/count helpers embed the other party via named FK. Unordered-pair `.or()` filter both orderings; 23505 = success.
- `PublicProfileScreen` — status-adaptive friend button; Unfriend in `⋯` overflow (with Report/Block).
- `FriendsScreen` (from Profile's Friends stat) — Requests + Friends list + a **Find people** debounced search modal (excludes self/blocked).
- **Alerts tab** — `friend_request` gets inline Accept/Decline; `friend_accept` taps to the actor's profile. "Mark all read" bulk-marks but **excludes** `invite`/`friend_request` so it can't orphan a pending one.
- **Capsule invite search** — Friends/Search tab toggle, both funnel into the same `invite()`.
- **Deferred:** no remote push for friend events yet — in-app notifications only.

---

## Contribution Nudges

Two retention notification types, fully server-side: a batched social-proof ping on upload, and a tiered reminder to non-contributing members as the deadline approaches.

**Schema** (`20260715120000`): `notifications.count` (nullable int); `notifications.type` gained `contribution_activity` (`contribution_nudge` was already a reserved placeholder). `capsule_members.contribution_nudge_7d/3d/1d_sent_at` — per-member, per-tier dedupe stamps. `contribution_activity_pending` (capsule_id+uploader_id PK, photo_count, last_upload_at) — deny-all RLS, touched only by the trigger (SECURITY DEFINER) and the edge function.

**Trigger** `notify_contribution_activity()` (AFTER INSERT on `media`) upserts the staging row, collapsing an upload burst into one notification.

**RPCs** (SECURITY DEFINER, execute revoked from clients):
- `claim_contribution_nudge_tier(p_tier)` — one atomic `UPDATE ... RETURNING` per tier: claims zero-upload joined members on capsules whose deadline falls in that tier's window, stamping `_sent_at` in the same statement (race-safe, same claim-and-stamp shape as `unlock-capsules`' `dispatchReminders`). **Tier windows overlap** — a near-deadline capsule can match all three in one tick, intentional at the DB level but caused duplicate pushes. **Fixed in the edge function**: dedupe per `(user, capsule)` across a run (a `nudgedThisRun` Set), at most one nudge per member per run; all stamps still commit so no tier re-fires. `unlock-capsules`' 1d/1h/10m reminders got the identical fix for the identical overlap.
- `top_contributors(p_capsule_id)` — feeds the comparison copy; a recipient can never appear in it (zero uploads by definition).

**Cron jobs** (both `* * * * *`, EXISTS-gated, shared Vault secret): `dispatch-contribution-activity` — 2-minute debounce on `last_upload_at`, filters blocked uploaders. `contribution-nudges` — loops the 3 tiers, groups claims by capsule, picks the first unblocked top contributor per recipient, falls back to "nobody's added photos yet" (`actor_id`/`count` null) when none.

**Client** (`NotificationsScreen`) — both capsule-nav; `contribution_activity` reads "`<actor>` added `<count>` photo(s)…", `contribution_nudge` shows the comparison or fallback copy.

---

## Capsule Start Date

An optional `contribution_start_at` — mirror image of `contribution_lock_at`: **nobody, owner included** (deliberately unlike the lock's owner exemption), can add photos until it arrives. For planning ahead of an event that hasn't happened. Ships with countdown UI, near-term presets, opening push.

**Schema** (`20260716120000`): `contribution_start_at`/`contribution_start_notified_at` (nullable), `notifications_type_check` gained `capsule_started`, `create_capsule_with_owner` gained trailing `p_contribution_start_at`. **The migration drops the old 10-arg overload before `create or replace`** — a trailing param changes the signature; without the drop, two overloads coexist and the original call becomes ambiguous (PGRST203). RLS: both `media` and `storage.objects` INSERT policies check the start gate with no owner exemption.

**Cron + `dispatch-capsule-start`** — EXISTS-gated, Vault-backed, atomically claims due capsules, notifies every joined member, pushes ≤100-chunked. Same shape as `dispatch-contribution-activity`.

**Client:** `DatePicker.tsx` exports `START_DATE_QUICK_OPTIONS` (near-term, unlike the default far-out presets). `CreateScreen` shows "Starts" above-the-fold unconditionally (unlike Unlock Date, hidden for `proximity`); validates start < both unlock date and uploads deadline; `EditCapsuleScreen` mirrors it. `CapsuleDetailScreen` gates `canUpload` for everyone including owner pre-start. `HomeScreen`'s `CountdownBadge` shows a pre-start branch, flipping to the unlock countdown once passed. `NotificationsScreen` renders `capsule_started`.

---

## Live Activity Countdown

A lock-screen/Dynamic Island card counting down to a capsule's uploads deadline (`contribution_lock_at ?? unlock_at`) while open for contributions, with a tap-to-open-camera button. iOS 16.2+ only, free for every tier by design.

**Data model.** `capsules.live_activity_enabled` (default true; pre-existing capsules backfilled `false`, same reasoning as `owner_preview_locked`'s backfill). `capsule_members.live_activity_override` (nullable, null=inherit). Effective value: `override ?? capsule.live_activity_enabled` (`effectiveLiveActivityEnabled()`).

⚠️ **The `grant update (live_activity_override) ... to authenticated` in the same migration is mandatory.** The audit revoked the table-wide UPDATE grant on `capsule_members`, granting back only `joined_at` — a new column has no UPDATE privilege by default, and a client write fails `42501` for the whole statement. Any future `capsule_members`/`media` column needs its own explicit grant.

⚠️ **Migration lesson (RPC signature changes):** the RPC gained a 12th trailing param — the migration drops the old 11-arg overload before `create or replace`, or PostgREST fails the pre-existing call as ambiguous (PGRST203). **A signature-changing drop+recreate also silently resets the function's ACL** (confirmed live — the recreated function picked up ambient `anon` EXECUTE, undoing an earlier revoke); a same-signature `create or replace` preserves the ACL, only a signature change resets it. **Anyone changing an RPC's signature here must re-run its grants in the same migration.**

**Architecture (brief):** `targets/liveactivity/` is a widget extension target via `@bacons/apple-targets` (not `expo-widgets` — needs SDK 56+; not third-party — `ios/` is gitignored/regenerated every prebuild, so only a plugin survives that). `modules/expo-live-activity` is a local native module wrapping ActivityKit (`isSupported/start/update/end/listActive`), gated `Platform.OS==='ios'` + try/catch.

⚠️ **`CapsuleActivityAttributes.swift` is a single canonical file, symlinked** (git mode `120000`) from the module into the widget target. ActivityKit matches a running activity to UI by **concrete type** — two independently-declared but field-identical `ActivityAttributes` structs don't interoperate. A drift-guard test asserts both paths byte-identical, catching a tool that replaces the symlink with a real copy before it fails silently at runtime.

**Two verification gotchas:** (1) this project's Xcode project uses **synchronized file-system groups**, so `grep`ping `project.pbxproj` for a filename proves nothing about target membership — verify by **compiling** (unsigned `xcodebuild`) and checking for "cannot find type in scope". (2) A file-scope Swift helper named `accentColor` failed to type-check inside a SwiftUI `View` — shadowed by the deprecated `View.accentColor(_:)` instance method; renamed to `colorFromHex`.

**Why there's no server component.** iOS itself renders the countdown from the activity's `staleDate` (set at `start()`) — zero updates needed, even offline. `update()` only ever changes `photoCount`/`memberCount`, only while the app runs — no cron, no edge function, no push-to-start. This is not "stays correct for the whole window" — see the ~8h limit below.

**Lifecycle — `useLiveActivities(userId)`** (mounted once in `RootNavigator`). Reconciles on mount, `userId` change, and `AppState` foreground. A pass fetches joined capsules + overrides, computes `desiredActivities()` (pure), diffs against `listActiveLiveActivities()`, calls start/update/end.

**"What's running" always comes from native `Activity.activities`, never a JS mirror** — iOS can dismiss an activity on its own, and a mirror would drift. Sign-out isn't special-cased: no `userId` → empty desired list → everything ends.

A `runningRef` guard prevents overlapping reconcile passes; `generationRef` stops an abandoned pass from resuming after a newer one took over. **Neither is load-bearing against a duplicate activity** — `expo-modules-core` dispatches every `AsyncFunction` on a serial `DispatchQueue`, and `start()` has no `await` before its check-then-act, so the native side is already atomic; the JS guards just skip redundant work.

**Deep links:** `capsule://capsule/<id>` → `CapsuleDetail`; `.../camera` → Camera tab preselected. **Neither performs a membership write** — a Live Activity only exists on an already-member device. Signed-out taps stash and drain after sign-in.

**Client surfaces:** a "Lock screen countdown" `Switch` in `CapsuleDetailScreen` (shown only inside the contribution window) writes the caller's own override; `CreateScreen`/`EditCapsuleScreen` expose the owner-level default toggle.

**Explicit non-goals / known limitations:**
- **No push-to-start** — a card only appears the first time the app runs during the window; building this needs an Apple `.p8` key + separate APNs-signing function (Expo push can't send `liveactivity` push type), per-device token sync, iOS 17.2+.
- No home-screen widget, no Android.
- **iOS ends any Live Activity after ~8h active (~12h on-screen), regardless of `staleDate`.** Most windows outlive one instance; `listActive()` won't report an expired activity as running, so the next reconcile re-arms it — a never-reopened device just shows no card for that stretch.
- **Editing a capsule's deadline while its card is live does not update the card** — reconciliation keys purely on capsule id, `listActive()` doesn't surface the running deadline.
- **`title`/`accentHex` are `ActivityAttributes`, immutable for the activity's lifetime** — renaming/recoloring after start leaves the running card stale. A cold-launch reconcile can also race `ThemeContext`'s accent fetch and bake in the default color.
- **`photoCount` refreshes only on app foreground and upload-queue drain** — not real-time; another member's upload doesn't push to your card.
- **Toggling ON starts the activity immediately** (mirrors OFF→end); neither waits for the next reconcile.
- **A rapid double-tap can leave the DB and toggle briefly disagreeing** (in-flight writes resolving out of order) — a monotonic generation guard suppresses the misleading toast but doesn't close the underlying race; self-corrects on the next fetch.
- **Requires a fresh dev/EAS build** — new native target/module invisible to the current binary/Expo Go; the widget target's provisioning-profile name must never collide with `Capsule`/`CapsuleShare`.
- **`NSSupportsLiveActivities: true` in `app.json`'s `ios.infoPlist` is required** — without it `isSupported()` silently returns false with no runtime warning.
- **`Text(timerInterval:)` must use `windowStart...deadline`, never `Date()...deadline`** — Swift's `...` traps if `lowerBound > upperBound`, and ActivityKit re-invokes the view at exactly `staleDate == deadline` (the moment `Date() >= deadline`), so a live-`Date()` lower bound crashes deterministically at the end of every window. Always anchor at `windowStart`, guaranteed `< deadline`.

---
## Monetization (RevenueCat)

Full strategy/pricing rationale lives in `docs/monetization-strategy.md`. Single paid tier, **Capsule Pro** (Event Pass/Premium etc. not built). **Tier copy never promises full-res/original-quality media or filters** — every photo resizes to 1920px for everyone; Pro adds capacity (caps below) + bulk **download** (ZIP export), never per-photo quality.

### Client stack
- **`src/lib/purchases.{native,web,ts}`** — the only module talking to the RevenueCat SDK (same `.native`/`.web`/`.ts`-stub split as `usePushNotifications`). `PRO_ENTITLEMENT_ID = 'Capsule Pro'` — must match the dashboard entitlement **exactly** (case-sensitive) or `isProActive()` is always false.
  - `configurePurchases()` (idempotent, anonymous), `identifyUser(userId)`/`resetUser()` (`logIn`/`logOut`, ties RC app-user id to the Supabase user id for the webhook + cross-device Pro).
  - `presentPaywall()`/`presentProPaywallIfNeeded()` (dashboard-hosted paywall), `presentCustomerCenter()` (manage/cancel/restore UI).
  - `purchasePackage(pkg)`/`restorePurchases()` — unused escape hatches.
  - **Client-side entitlement checks are UI-only.** The real gate is server-side — never trust `isProActive()`/`isPro` for anything a malicious client could bypass.
- **`useRevenueCat(userId?)`** — called once from `App.tsx`, configures SDK on mount then `identifyUser`/`resetUser` as the signed-in user id appears/changes/disappears (mirrors `usePushNotifications`).
- **`useEntitlements()`** — `{ isPro, loading, customerInfo, refresh }`; subscribes to the SDK's update listener so any screen reflects a purchase made elsewhere with no manual refetch.
  ⚠️ **`isPro` resolves from BOTH RevenueCat AND `users.subscription_tier`** (`resolveIsPro()` in `tierLimits.ts`) — **either source alone grants Pro; neither may veto the other.** Reading RC only showed the *free* UI to genuinely-Pro users whenever the two diverged. Divergence is normal: a tier granted server-side with no purchase behind it (comps, support grants, the App Store reviewer account), a `getCustomerInfo()` failure at cold start, a `logIn()` that never landed, or **web**, where the SDK stub always reports false. DB tier cached under `tier:${userId}` (5min TTL) via `sessionStore` + single-column select. A null/unreadable tier is "no signal", never a revocation — `guard_subscription_tier` makes the column server-writable only, so trusting it client-side is no weaker than trusting the SDK.
  ⚠️ **`loading` means "don't act yet", not merely "still fetching".** Stays true while either source is pending **and** when neither could answer at all — `isPro` is a boolean and can't express "unknown," so a failed fetch would otherwise look like a confirmed free account, paywalling a paying customer on a cold-start blip. Tri-state lives in `entitlementsResolved(rcState, dbState)` (pure, tested): nothing pending, and at least one source answered. Failures retry with backoff (`RETRY_DELAYS_MS`) and re-attempt on `AppState` foreground. `purchasesSupported` (false on web) marks the SDK as "no opinion" so web resolves on the DB alone without waiting out retries.

### Server-side gate
**`supabase/functions/revenuecat-webhook`** is the actual source of truth — maps `event.type` to a `users.subscription_tier` write (`'free'`/`'pro'`):
- **Auth:** shared secret (not `CRON_SECRET`) — compares `event`'s Authorization header against `REVENUECAT_WEBHOOK_SECRET` (constant-time), fails closed 401 if either side unset/mismatched. `verify_jwt: false`.
- **Production-only:** ignores any event whose `event.environment` isn't `PRODUCTION`; the dashboard webhook integration is also scoped to the production app+env — defense-in-depth.
- `event.app_user_id` is the Supabase `users.id` (guaranteed by `identifyUser()`); a regex guards against writing to anonymous RC ids (`$RCAnonymousID:...`).
- **GRANT set** (`INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` [lifetime], `SUBSCRIPTION_EXTENDED`) → `'pro'` from event type alone, no RC API call. **REVOKE set** (`SUBSCRIPTION_PAUSED`) → `'free'`, also blind. **`TRANSFER` is a VERIFY event, not a blind write.** ⚠️ It used to grant/revoke every id in `transferred_to`/`transferred_from` straight from the payload — but `app_user_id` is **entirely client-asserted** (`identifyUser` = `Purchases.logIn(<arbitrary string>)` with the public SDK key shipped in the bundle), so naming a real customer in `transferred_from` isn't evidence they lost anything, and `subscription_tier` is the un-forgeable gate behind every cap. Every id on **both** sides is now checked against the RC API and mirrored; a verification failure leaves the tier untouched and returns 500 — never a guess.
- **VERIFY set** (`CANCELLATION`, `EXPIRATION`, `REFUND_REVERSED`) infers nothing from event type: calls `GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements` with the read-only `REVENUECAT_API_KEY` and mirrors the result. A **refund** arrives as `CANCELLATION` with `cancellation_reason: CUSTOMER_SUPPORT` — treating that as a no-op let a refunded customer keep Pro, and a refunded **lifetime** purchase has **no `EXPIRATION` event** to ever clean it up (kept Pro *permanently*). `EXPIRATION` verifies too, so a resubscribe whose old `EXPIRATION` lands after the new `INITIAL_PURCHASE` can't strip a paying customer. `BILLING_ISSUE` stays a plain no-op (grace period = still entitled).
  ⚠️ **The two surfaces use different identifiers for the same entitlement.** Webhook payloads carry the **lookup key** (`'Capsule Pro'`, matched against `event.entitlement_ids`); the v2 REST API returns the **object id** (`'entl2d972407b4'`) in `active_entitlements[].entitlement_id`. Two separate constants in `entitlements.ts` for this reason. Comparing an API response against the lookup key never matches → every verification reports "not active" → revokes Pro from **every paying customer**, worse than the bug this fixed and invisible with no purchases to test against.
  ⚠️ **Never delete/recreate the `Capsule Pro` entitlement in the RC dashboard without updating `PRO_ENTITLEMENT_OBJECT_ID`.** A recreated entitlement gets a new object id while the lookup key stays identical — the existing regression test only catches the lookup-key-vs-object-id mixup above, not a changed object id (an external RC state change). Unnoticed, every VERIFY comparison reports "not active" and every `CANCELLATION`/`EXPIRATION` revokes Pro from every paying customer.
  ⚠️ **Never guess a tier.** Any verification failure (unset key, non-2xx, malformed body) leaves `subscription_tier` untouched and returns **500** so RC retries (5 attempts over ~2.5h). `isProActive` *throws* rather than returning false on a malformed body, so a bad response can't be mistaken for "no entitlement."
  ⚠️ **`SUBSCRIPTION_PAUSED` is still a blind revoke** — Google Play only (Apple has no consumer pause), can't fire on iOS. When Android ships, move it to VERIFY: a pause is only *scheduled* at the event, access continues until the period ends.
  ⚠️ **Comp grants are not protected — and this change widened that surface.** A tier set by direct DB write with no purchase behind it (App Store reviewer account, support grants) would be revoked if a VERIFY event ever fired for that `app_user_id` (RC correctly reports no entitlement). Before this change only `EXPIRATION` (subscription-only) could do that; verifying `CANCELLATION` too exposes a comp account with *any* RC purchase/cancellation activity on the cancellation path as well, not just at term end. Not reachable without RC purchase activity on that account — but comp accounts must never be used as webhook test targets, and production currently holds two comp-Pro accounts by direct DB write, one being the **App Store reviewer account**.
  ⚠️ **The App Store reviewer account must be `'free'`, NEVER comped to `'pro'`.** An earlier version of this doc said the opposite ("confirm it's still `'pro'` before each submission") and that directly caused Apple to **approve the binary and reject all three in-app purchases** on the first submission — because `isPro` resolves from *either* source, a comped column alone flips the whole app into its Pro presentation, hiding every purchase entry point (Settings' Upgrade button/locked color row, the post-unlock nudge, all five tier gates), leaving the reviewer no reachable way to see or buy an IAP. **The pre-submission checklist must confirm the reviewer account's `subscription_tier` is `'free'`**, alongside re-arming its countdown capsule — see `docs/REVIEWER_ACCOUNT.md`.
- Tier-gated code reads `users.subscription_tier` (server-side, un-bypassable) for the two hard gates; the client mirrors the same limits for UX — see "Tier enforcement."

### Post-unlock upsell
`CapsuleDetailScreen` shows a dismissible nudge (not an auto-popped paywall) to a non-Pro owner once their capsule unlocks ("Keep it forever with Pro" → `presentPaywall()`). Dismissal persists per-capsule via AsyncStorage (`cap_pro_nudge_dismissed:<capsuleId>`), native-only.

### Pro status badge
**`<ProBadge size?: 'sm'|'md'>`** — decorative "PRO" pill, no data prop. Each call site fetches the *subject's* own tier and decides whether to render: own `ProfileScreen`, `PublicProfileScreen` (`profile.subscription_tier === 'pro'`), `HomeScreen` cards next to the owner (`capsule.owner.subscription_tier`), `CapsuleDetailScreen`'s members sheet owner row. Also the canonical "PRO" pill — `SettingsScreen`'s locked color row renders it too.

### Capsule export (ZIP)
Owner-only, owner-**Pro**, unlocked-only. Gated on `isOwner && capsule.status === 'unlocked' && isExportSupported() && photos.length > 0`; non-Pro tap runs the same `proGateHit` limit-sheet as every other gate.
- **`src/lib/exportCapsule.{native,web,ts}`** — `exportCapsule({ title, items, onProgress, shouldCancel? })` downloads signed URLs and zips. `shouldCancel` polled per file boundary; cancel throws `EXPORT_CANCELLED`, treated by `CapsuleDetailScreen.handleExport` as a user cancel.
  - **Native:** `react-native-zip-archive`, streams to a temp `FileSystem.cacheDirectory` dir first (never through the JS bridge as one buffer), zips, shares via `expo-sharing`. Needs a full dev/EAS build. `isExportSupported()` eagerly probes `TurboModuleRegistry`/`NativeModules` for `RNZipArchive` (bare `require()` isn't proof — lazy resolution), hiding the button rather than crashing when unlinked.
  - **Web:** `fflate` in-memory zip + browser download.
- **`src/components/ExportProgressModal.tsx`** — `{ visible, done, total, onCancel? }` progress modal with Cancel.

### RevenueCat dashboard configuration
Project `proj72b0a2e3`. Entitlement `entl2d972407b4` (lookup key `Capsule Pro`). Offering `default` (`$rc_monthly`/`$rc_annual`/`$rc_lifetime` → products `monthly`/`yearly`/`lifetime`), published dashboard paywall attached.

**Two RC apps, same products/offering/entitlement shared:**
- **Test Store** (`app3febbe6182`) — fake purchases, no real StoreKit. No fallback key baked in anymore (`FALLBACK_TEST_KEY` removed) — `configurePurchases()` fails closed (warns + disables purchases) with no real key set, so release builds can never silently grant free real Pro. Put its `test_...` key in `EXPO_PUBLIC_REVENUECAT_IOS_KEY` locally to use it. Webhook is production-only now, so Test Store purchases no longer flip `subscription_tier`.
- **Capsule iOS** (`app7b40141214`) — the real App Store app, connected via an ASC API key (dashboard-only config). Public SDK key in `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`.env` locally, EAS production secret via `eas env:create`).

**Pricing** (monthly $4.99, yearly $39.99, lifetime $79.99, ~180-territory equalization) is live in App Store Connect. **⚠️ Known blocker:** real purchases fail until Apple's one-time rule clears — the first-ever IAP/subscription for an app must be submitted attached to an app version through ASC's UI, not any API. Until then only the Test Store key produces working purchases; after that first approval, all products become fully API/dashboard-manageable.

### Tier enforcement

Limits live in one config, **`src/lib/tierLimits.ts`** — `TIER_LIMITS: Record<Tier, TierLimits>` (`Tier = 'free' | 'pro'`), `limitsForTier(tier)` (unknown/null → `free`), `tierFromIsPro(isPro)`. Free: `{ activeCapsules: 3, membersPerCapsule: 10, photosPerCapsule: 20, videoSeconds: 30 }`; Pro: `{ Infinity, 50, 1000, 120 }`. **Never hardcode a limit elsewhere** — the `3` is also inlined in `create_capsule_with_owner` (SQL can't import TS), keep both in sync.

**All caps key off the capsule OWNER's tier, never the acting user's** ("monetize the host, guests never pay") — reaches the client via `owner:users!capsules_owner_id_fkey(subscription_tier)`.

**Owner-vs-guest rule**, centralized in **`src/lib/proGate.ts`**: `proGateHit({ currentUserIsHost, guestMessage, title?, ownerMessage? })` — host sees the limit sheet with "Upgrade to Capsule Pro" (→ `presentPaywall()`) + "Not now"; guest sees the same sheet explain-only ("Got it"), **never an upgrade** (wouldn't lift a host-based cap). Create-time gates (capsules, groups) always pass `currentUserIsHost: true`. Sheet: `src/lib/limitSheet.ts` + `<LimitSheetHost>`.

**The five gates:**
- **Active capsules** (3 → ∞): server-hard in `create_capsule_with_owner` (`CAPSULE_LIMIT_REACHED`) + client pre-check in `CreateScreen`/`OnboardingScreen`.
- **Recurring groups** (manual → any recurrence): server-hard in `create_group_with_creator` (`GROUP_RECURRENCE_PRO`) + client gate in `CreateGroupScreen`.
- **Members/capsule** (10 → 50): server-hard via `enforce_member_limit` trigger (`MEMBER_LIMIT_REACHED`, covers every join path) + client pre-checks in `InviteModal` and `NotificationsScreen` accept (count excludes the accepting user's own pending row).
- **Photos/capsule** (20 → 1000): server-hard via `enforce_photo_limit` trigger (`PHOTO_LIMIT_REACHED`) + client pre-check at enqueue. `CapsuleDetailScreen` uses `mediaCount` (from `capsule_media_count` RPC); `PreviewScreen` **must use `capsule_media_count` per selected capsule, not a `media(count)` embed** — the embed reads 0 under surprise mode's RLS and silently defeats the cap.
- **Video length** (30s → 120s): client-only (no server duration storage). Enforced at post time on `PreviewScreen`, not capture — camera/library hand full clips through with `PendingMedia.durationMs`; over-cap videos get the limit sheet with Trim (everyone), Upgrade (strictest-target owner only), Skip, or Cancel. Trim via `trimVideo()` in `modules/expo-video-stitcher`. Also enforced for share-intent videos (`probeVideoDurationMs()`) and `CreateScreen`'s `pendingMedia` path (silent trim + toast). Unknown/unprobeable duration stays fail-open.

**Entitlements-loading rule:** `useEntitlements()` starts `{ isPro: false, loading: true }` until genuinely resolved. Any gate reading the current user's own `isPro` must gate on `!entitlementsLoading && !isPro`, **never `!isPro` alone**, or a genuine Pro user gets false-gated. Gates reading a fetched `ownerTier` have no such race.

**Every current-user gate honors it, shaped to its failure mode:**

| Site | Guard | Why that shape |
|---|---|---|
| `CreateScreen` capsule-count pre-check | skip the pre-check | falls through to the RPC, which knows the true tier |
| `CreateGroupScreen` recurrence | skip the pre-check | same — `GROUP_RECURRENCE_PRO` decides |
| `CreateScreen` video trim | **fail open to the Pro cap** | trimming on a guess is irreversible loss for a paying user; video length has no server backstop, so the worst case is one long clip from a free user |
| `SettingsScreen` Capsule Pro section | render nothing | would otherwise pitch an upgrade — and open the paywall on tap — to an existing subscriber |
| `SettingsScreen` custom color / gradients | render neither branch | the locked row *asserts* the user lacks Pro; presets stay available so the section is never empty |
| `CapsuleDetailScreen` post-unlock upsell | hide the nudge | same mis-sell risk |

⚠️ **A new gate reading the current user's own `isPro` must pick one of these.** The wrong default — treating `!isPro` as "free" — is what shipped the bug this table exists to prevent.

**Server-enforced, not cosmetic.** `subscription_tier` is un-forgeable: `guard_subscription_tier` lets only `service_role` (the webhook) write it. Capsule/group creation is RPC-only (direct insert policies **dropped** — `20260721140000_payment_security_gates_a.sql`), so create-RPC cap gates can't be side-stepped. Members/photos have server-side backstop triggers `enforce_member_limit`/`enforce_photo_limit` (`20260721140100_payment_security_gates_b.sql`). All migrations verified live on prod with rolled-back fixtures.

**Accepted limitations:** video length stays client-only — bypassable by a modified client. Client photo/member pre-checks fail-open on a transient count-query error, but the `enforce_*` triggers are the un-bypassable floor underneath.

---

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`, backed by **`expo-crypto`'s CSPRNG** (native on iOS/Android; `globalThis.crypto.randomUUID()` on web). Use instead of `crypto.randomUUID()` — the `crypto` global isn't reliably typed in the Expo TS config. ⚠️ **Never revert to `Math.random()`**: Hermes' `Math.random` is a seeded xorshift128+, so observing outputs allows state recovery/prediction (2026-07-29 audit, M-3, CWE-338). Synchronous on both native and web, so no call site needs touching if swapped in. `src/lib/uuid.test.ts` statically asserts the wiring.
- `src/lib/haptics.ts` — `haptics.{light,medium,heavy,selection,success,warning,error}()`. Wrapper over `expo-haptics`; no-ops on web, swallows errors, no platform guard needed at call sites. **Use this for all tactile feedback**, never `expo-haptics` directly. Wired into tab taps, camera shutter, reactions, notification accept/decline, Home layout toggle, and `DatePicker` (delegates its local haptic helpers here).
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient }`. `ThemeProvider` must wrap the app. See "Theme System" for the gradient (Pro cosmetic).
- `src/lib/sessionStore.ts` — `sessionStore.get()` / `sessionStore.set()`. Module-level session cache updated by `useAuth` on every `onAuthStateChange`. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()` inside screens** — `getSession()` hangs on web when the token is expired (blocks on an internal refresh call); `sessionStore.get()` is synchronous and never hangs.
- `src/lib/limitSheet.ts` — `limitSheet.show({ title, message, icon?, actions })` / `.hide()`. Global "you hit a limit" bottom sheet (mirrors the `toast`/`ToastHost` pub/sub pattern), rendered by `<LimitSheetHost>`. `actions`: `{ label, style?: 'primary'|'secondary'|'destructive', onPress }`. The host **dismisses the sheet first, then runs `onPress`** after the ~220ms close (instant under Reduce Motion) — an action that opens a **native** modal (RevenueCat's `presentPaywall`) must not fire while this RN `<Modal>` is still animating out, or it glitches on iOS. `onPress` must not re-`show()` the sheet; async `onPress` is fine. Driven by `proGateHit` and the Preview video-length sheet. Component `src/components/LimitSheet.tsx`: dismiss via backdrop tap, an action, or swipe-down (`PanResponder`, `useNativeDriver: false` so the JS-thread drag can share `translateY`, same rule as the members sheet); honors OS Reduce Motion.
- `src/lib/mediaDuration.ts` — `assetDurationMs(asset)`: an ImagePicker asset's video length in ms, normalizing the web-shim-returns-seconds gotcha. Feeds `PendingMedia.durationMs`, read by the Preview video-length gate (unset = fail-open).
- `src/lib/toast.ts` — `toast.show(message, action?)`. Global toast via `<ToastHost>` (mounted once, survives navigation). Optional `action: { label, onPress }` renders a tappable inline action (e.g. "Undo") that fires then dismisses. **Rule: any user-initiated mutation that fails must toast** — a silent background-write failure becomes an unreproducible bug report. Swept across `persistRead`, `setAccentColor`/`setHomeLayout`, the invite-push loop and `set_default_superlatives` call in CreateScreen — all previously silent on failure.
- `src/lib/sentry.ts` — the single home for Sentry wiring (see "Error Monitoring"). Exports `initSentry()`, `setSentryUser(id|null)`, `reportError(err, { where?, extra? })`, `navigationIntegration`, `hasSentryDsn`. **Use `reportError` in any catch block that would otherwise swallow an error or only toast** — the manual-capture counterpart to the toast rule (toast = tell the user, `reportError` = tell you).

## Error Monitoring (Sentry)

Crash + error reporting via `@sentry/react-native` (v7.2.0). **All Sentry config lives in `src/lib/sentry.ts`** — never call `Sentry.init` or read `EXPO_PUBLIC_SENTRY_DSN` elsewhere.

- **Init:** `App.tsx` calls `initSentry()` at module load, then `export default hasSentryDsn ? Sentry.wrap(App) : App` (wrap adds the error boundary + crash capture; passthrough when no DSN). The `@sentry/react-native/expo` config plugin (org `capsule-60`, project `react-native`) uploads source maps at EAS build time.
- **Release builds only.** `sentryEnabled = !!DSN && !__DEV__` — under Metro/Expo dev the SDK is initialized-but-disabled (wired, nothing transmits). `initSentry()` returns early with no DSN set.
- **Privacy: user id only.** `sendDefaultPii: false`, plus a `beforeSend` hook scrubs `event.user.email`/`ip_address`/`username`. `useAuth`'s `settle()` calls `setSentryUser(session?.user.id ?? null)` on every session update — events group per user with no email/IP. Never widen this without a deliberate decision.
- **Navigation instrumentation:** `navigationIntegration` (`reactNavigationIntegration`) registers via `NavigationContainer`'s `onReady` (`registerNavigationContainer(navigationRef)`) — route changes become breadcrumbs + performance transactions.
- **Performance tracing only, no Session Replay** (`tracesSampleRate: 0.2`) — Replay records the screen, a privacy concern here, deliberately omitted.
- **`environment`** = `EXPO_PUBLIC_SENTRY_ENV` or `production`/`development`. **`release`** = `<bundleId>@<version>`, **`dist`** = native build number, mirroring the Expo plugin's source-map naming so events symbolicate.
- **Manual capture:** `reportError(err, { where: 'module.fn', extra: {...} })` in catch blocks that swallow or only toast; `extra` is structured context (ids/counts), **never PII**. Already wired into `uploadQueue.runTask`, the `purchases` revenue-pipeline calls, and `SettingsScreen` account deletion. New swallowed-error paths should use it too.

## Cache System (`src/lib/cache.ts`)

In-memory cache (lost on cold start, no persistence) with TTL, key-based invalidation, and pub/sub listeners — shows cached data instantly while refetching in the background.

- `cache.get<T>(key, ttl?)` — cached data or null if expired (default 15 min TTL)
- `cache.set<T>(key, data)` — stores with timestamp
- `cache.invalidate(...keys)` — deletes entries, notifies subscribers
- `cache.subscribe(key, fn)` — unsubscribe fn; used by `useCachedFetch` for cross-screen reactivity
- `cache.clear()` — wipes everything (called on sign-out via `useAuth`)

⚠️ **Module-level state must be bound to a user id AND cleared on sign-out — `cache.clear()` alone isn't enough.** Most cache keys aren't user-scoped (`capsules`, `profile`, `notifications`, `groups`, `awards:<id>` — only `tier:${userId}` is), and `useCachedFetch`'s in-flight registry is module-level, so a request issued under a departing user's token can resolve *after* `cache.clear()` and write that user's data back under a shared key — the next user's `useFocusEffect` then treats it as a fresh cache hit and skips the network call (and thus the RLS check) entirely, leaking the previous user's capsules/profile/notifications/vote flags. `uploadQueue` had the mirror bug: `tasks` survived sign-out and `runTask` re-read the session at execution time, so the next user saw the previous user's retryable tiles and Retry uploaded under the new user's credentials. Fix requires **both**: (1) capture the user id at `enqueue()`/fetch start and drop work that no longer matches (`resetCachedFetchState()`/`uploadQueue.reset()` are the clear-side; the identity check is the real defense), and (2) `useAuth`'s SIGNED_OUT branch calls both alongside `cache.clear()`/`blockStore.clear()`/the stashes. `uploadQueue.reset()` bumps `cacheGeneration` **before** clearing its three dedup Maps, matching `work()`'s drain-clear ordering. **New module-level state needs the same treatment.**

**`useCachedFetch<T>(key, fetcher, deps)`** (`src/hooks/useCachedFetch.ts`) — returns `{ data, loading, refresh }`. On focus: a fresh `cache.get(key)` renders instantly and **skips the network call entirely** (TTL governs every focus, not just the first). On miss/expiry, fetches and shows loading. `refresh()` always force-fetches. Subscribes to invalidation from other screens: keeps showing current data while refetching in the background (no blank-then-reload flash). Concurrent fetches for the same key dedupe via a module-level in-flight registry — three subscribers invalidated at once still issue one network call.

Not every consumer uses this hook — `CapsuleDetailScreen` and `AwardsSection` hand-roll the same "cache.get for instant render, then background fetch" pattern directly, since both carry local optimistic-update state (reactions, upvotes) the hook's read-only `data` can't accommodate.

**Cache keys in use:**
- `capsules` — HomeScreen capsule list
- `capsule:${id}` — per-capsule detail data (capsule row + members)
- `media:${id}` — per-capsule raw `media` row list (3min TTL; separate from the signed-URL cache so a hit skips the DB read, not just signing)
- `signedUrls:${id}` — per-capsule signed URLs, batched (50min TTL, under the 1hr signed-URL validity)
- `videoThumb:${id}` — per-media locally-generated video thumbnail frame (6hr TTL — local file URI, not server-expiring)
- `awards:${id}` — per-capsule superlatives categories + winners (AwardsSection, hand-rolled, not via the hook)
- `profile` — ProfileScreen hero card data
- `tier:${userId}` — mirrored `users.subscription_tier`, read by `useEntitlements()` as the second Pro source (5min TTL — short because it mirrors a webhook write; a purchase needs no TTL wait since RevenueCat's listener flips `isPro` immediately). Cleared by `cache.clear()` on sign-out so an account switch can't inherit the previous user's tier.
- `notifications` — NotificationsScreen. **The Alerts tab badge (`CustomTabBar`) also reads this key** (PERFORMANCE.md #11): subscribes and sets the unread count from the cached grouped list's length, so the badge updates instantly on read/dismiss/receive with no stale lag. Falls back to a lightweight `count/head` query only when the cache is empty. Shows the grouped-unread count (reactions collapse into one card), capped at "9+".
- `group:${id}`, `group-members:${id}`, `group-capsules:${id}`, `groups` — GroupDetailScreen / HomeScreen / ManageGroupScreen. `listMyGroups`/`getGroup` fetch `memberCount` via a PostgREST embedded `group_members(count)` aggregate in the same query (PERFORMANCE.md #6) — one round-trip instead of pulling every member row to count them.

**Invalidation pattern:** mutating screens call `cache.invalidate()` with all affected keys — e.g. creating a capsule invalidates `capsules` and `profile`. Uploading/deleting media or an unlock invalidates both `signedUrls:${id}` and `media:${id}` together — invalidating only one is not enough.

## Background Upload Queue (`src/lib/uploadQueue.ts`)

Module-level sequential upload worker — the optimistic-UI backbone for media. Callers `uploadQueue.enqueue(entries)` and move on; the queue uploads one task at a time (web: arrayBuffer + `supabase.storage.upload`; native: `FileSystem.uploadAsync` via `getFreshAccessToken()`), inserts the `media` row (including dual-photo `alt_storage_key` and, for video, `thumbnail_key` — both best-effort), and invalidates `capsules` + `capsule:`/`media:`/`signedUrls:` per success.

**Multi-capsule fan-out uploads each file once, not once per capsule.** `PreviewScreen`'s multi-select "Add to Capsule" enqueues one task per (capsule × media) pair — selecting 3 capsules for 5 photos would otherwise mean 15 uploads of the same 5 files. `runTask` routes every upload (main, dual `altUri`, video thumbnail) through `copyOrUpload()`, keyed by the **source local uri** in one of three module-level `Map`s (`mainUploadCache`/`altUploadCache`/`thumbUploadCache`). The first task for a uri does the real `prepareForUpload` + `uploadFile` and caches `{ key, size, ext }`; later tasks for the same uri do a bucket-side `storage.copy(cachedKey, newKey)` instead — zero device bytes. The destination path is validated by the same storage INSERT RLS check a direct upload would hit, so a copy succeeds iff a normal upload to that destination would.

⚠️ **The destination check alone isn't sufficient — a copy also has to READ the source, which is not symmetric.** The `capsule-media` SELECT policy requires `unlocked` status or `(owner/contributor AND NOT owner_preview_locked)`, so under **surprise mode (on by default)** nobody — including the uploader — can read a locked capsule's objects; RLS makes the row invisible and storage returns `400 Object not found` rather than a permission error, failing the whole task. Multi-selecting into a locked surprise-mode capsule plus another is the default shape, not an edge case. `copyOrUpload()` **falls back to a real upload** on any copy failure (dropping the cache entry first, since an unreadable source stays unreadable for the batch), and reports via `reportError`. The three caches clear when the queue fully drains (`work()`), so a later unrelated batch never copies from a stale key. Main + alt also upload **concurrently** (`Promise.all`) rather than sequentially.

Each task is bounded by `TASK_TIMEOUT_MS` (3 min, via `withTimeout()` in `work()`) — RN never times out a dead connection on its own, and `work()` is a single sequential loop, so one hung task would otherwise wedge all future uploads. The underlying call isn't cancelled on timeout (no `AbortController`), so it can resolve after `work()` has moved on and cleared the dedup caches. A module-level `cacheGeneration` counter (bumped on every clear) guards this: `copyOrUpload()` snapshots the generation before uploading and only writes its result into the cache if the generation is unchanged — a write that straddles a drain is dropped instead of repopulating a cleared Map with a stale entry a later unrelated batch could collide with.

**Video thumbnail at upload time:** for `mediaType === 'video'` (native only — no web `expo-video-thumbnails`), `runTask` grabs a frame from the **local** file (`VideoThumbnails.getThumbnailAsync(task.uri, { time: 0 })`) right after the main upload, uploads it as `${capsuleId}/${uuid}_thumb.jpg`, and sets `media.thumbnail_key`. Best-effort — on failure `thumbnail_key` stays null and `fetchPhotos` falls back to its old client-side generation-from-`signedUrl` path. Fixes the "every member downloads and decodes the whole video just to draw a grid cell" pathology and gives web capsules a real video thumbnail for the first time.

**Resize before upload:** `prepareForUpload` runs every photo (main + `altUri`) through `resizeForUpload()` (`src/lib/imageResize.ts`) before `uploadFile` — the one convergence point for library, share-intent, and camera uploads (`CameraScreen.processPhoto` delegates here too). Checks width via `Image.getSize` (header read, no decode) and only resizes down to 1920px/compress 0.82 if wider; never upscales, no-op for already-camera-sized images. Without this, library-picked photos uploaded at full device resolution — 5–10x the bytes of the camera path for no visual gain at display size. When resize runs, output is always JPEG, so `prepareForUpload` also bumps `mimeType`/extension to `image/jpeg` in that case; otherwise the original mimeType is kept. Video is untouched.

Failures stay in the queue as `status: 'failed'` tasks — `retry(id)` / `dismiss(id)` — rendered as retryable tiles by `CapsuleDetailScreen`. `useUploadTasks(capsuleId)` is the reactive subscription; `getProgress(capsuleId)` returns per-capsule `{done,total}` since that capsule's queue was last empty. A full drain fires one toast ("N items added" / "· M failed") via the global ToastHost. In-memory only — uploads don't survive an app kill.

**Optimistic-action pattern** (NotificationsScreen accept/decline, ManageMembersScreen remove, HomeScreen restore, CapsuleDetail archive): snapshot state → apply the change / navigate immediately → fire the write with `.then(({ error }) => …)` → on error restore the snapshot and `toast.show(...)`. For invite accepts, `read_at` persists only **after** the membership write commits — persisting it up front on a failed accept would orphan the invite.

---

## Retry on slow loads (`useLoadingTimeout` + `RetryPrompt`)

Every screen that fetches on mount/focus shows a retry affordance if loading takes longer than 8s, instead of an indefinite spinner/skeleton (RN's `fetch()` has no default timeout — a dead connection can hang 30s-2min).

- **`src/hooks/useLoadingTimeout.ts`** — `useLoadingTimeout(loading, timeoutMs = 8000)` returns `{ timedOut, reset }`. Arms an 8s timer while `loading` is `true`; clears it and resets `timedOut` to `false` the moment `loading` goes `false`. A retry tap doesn't produce a `false→true` edge (the fetch just restarts under the same `true`), so **every `onRetry` handler must call `reset()` before kicking off the new fetch** or the timeout never re-arms on a second hang.
- **`src/components/RetryPrompt.tsx`** — `{ onRetry, message?, compact? }`. Renders inline (not a modal) — message + "Retry" button in dark-theme tokens + `accentColor`. `compact` shrinks padding/text for small contexts (`AwardsSection`'s `loadingBox`, `PublicProfileScreen`'s `InviteToCapsuleModal`); default fills the screen like the skeleton it replaces.
- **Wiring pattern:** `if (loading) { if (timedOut) return <RetryPrompt onRetry={...} />; return <...skeleton...>; }` — the retry prompt **replaces** the skeleton/spinner, not shown alongside it.
- **`useCachedFetch`'s `refresh(force?: boolean)`** — the hook dedupes concurrent fetches per key via an in-flight registry, so bare `refresh()` on a genuinely hung fetch just re-awaits the same stuck promise. `refresh(true)` discards the stale in-flight entry first. Every retry handler on a `useCachedFetch` screen calls `refresh(true)`, never bare `refresh()`.
- **Hand-rolled (non-hook) screens** just re-call their fetch function on retry, but must replicate however it clears `loading`: some clear internally (`AwardsSection.fetchCategories`, `FriendsScreen.load`), others rely on the caller's `.finally(() => setLoading(false))` (`ManageMembersScreen.fetchMembers`, `PublicProfileScreen.load`, `EditCapsuleScreen.loadCapsule`). Check before assuming.
- **Applied to:** HomeScreen, NotificationsScreen, ProfileScreen, GroupDetailScreen (primary `groupLoading` gate only — the secondary `capsulesLoading` list spinner is non-blocking and left out), CapsuleDetailScreen (cold-load skeleton only — warm-cache shows content instantly with a silent background refresh), AwardsSection, FriendsScreen, EditCapsuleScreen, ManageMembersScreen, PublicProfileScreen + its nested `InviteToCapsuleModal`.
- **Not touched:** `LoadingBrandScreen` in `AppNavigator.tsx`'s onboarding/route-resolution gate — a different kind of "loading" (route resolution, not a data-fetch-on-mount screen) with its own 5s fallback to `Tabs`.

## DatePicker (`src/components/DatePicker.tsx`)

Shared date/time picker used by `CreateScreen` and `EditCapsuleScreen`. Controlled: `{ label, value, onChange, optional?, contextLabel? }`.

- Collapsed state shows selected date/time + "change" link; tapping expands inline
- Quick presets: "In 1 month", "In 3 months", "In 6 months", "In 1 year"
- **Custom calendar grid** (no external library): 7-column day view (accent circle on selected, accent border on today, past days dimmed `#333`); tappable month/year header ("June 2026 ▼") opens a 4×3 month picker with year nav arrows
- Collapsible time row with native `DateTimePicker` (spinner iOS, default web)
- `contextLabel` renders a live preview sentence (e.g. "Capsule unlocks for everyone on Jun 30, 2026 at 3:00 PM")
- `optional` adds an "enabled" toggle — off calls `onChange(null)`
- **Haptics**: Light impact on day/month select and quick presets; Selection feedback on month/year nav arrows. No-op on web.

## Animations (`src/lib/animations.ts`)

Reusable entrance hooks on the built-in `Animated` API (no `react-native-reanimated`):
- `useFadeIn(delay?, duration?)` — opacity 0→1
- `useSlideUp(delay?, duration?)` — opacity 0→1 + translateY 20→0
- `useListItemEntrance(index, baseDelay?)` — staggered fade+slide, 60ms/item, caps at index 8

All three use `useIsFocused()` but play the entrance **once per screen instance** (`hasAnimatedRef` guard) — only on first focus after mount. Later re-focuses snap straight to final state instead of replaying (data from `useCachedFetch` is usually already instant on re-focus, so replaying the animation just looks slow). A genuine unmount+remount still gets the full animation.

**Rules of Hooks:** call these before any early return (e.g. `if (loading) return <Skeleton />`) — after one causes "Rendered more hooks than during the previous render."

**Screen transitions** (`AppNavigator.tsx`): Tabs/Onboarding `fade`; Settings `slide_from_bottom`; Preview `none` (instant camera preview); all others default `slide_from_right`.

## Image Loading (`expo-image`)

All remote images use `Image` from `expo-image`, **not** `react-native` — native disk + memory caching, cache hit after first download.

```tsx
import { Image } from 'expo-image';

// source is a string (not { uri }), contentFit (not resizeMode)
<Image source={url} contentFit="cover" transition={200} />
```

`contentFit` replaces `resizeMode`: `"contain"` for full-screen viewer, `"cover"` for thumbnails. Applied in CapsuleDetailScreen (viewer + grid + gallery), ProfileScreen (Avatar), PreviewScreen, OnboardingScreen.

## Skeleton Loaders (`src/components/Skeleton.tsx`)

Shimmer-animated placeholders for `useCachedFetch` screens: `SkeletonBox` (base, `Animated.loop`+`interpolate` shimmer), `SkeletonCard` (HomeScreen capsule placeholder), `SkeletonProfileCard` (ProfileScreen hero layout — glow bar, avatar circle, name/bio/stats, action rows). Dark theme colors throughout (`#1A1A1A` base, `#2A2A2A` highlight).

## Profile Screen (`ProfileScreen.tsx`)

Hero card with accent-colored glow: 3px glow bar at top, avatar ring with accent border. Stats row (Capsules, Unlocked, Friends) from `capsule_members` joins. Action rows: Edit Profile (inline modal), Appearance (→ Settings). Sign out as a text link at bottom. Uses `useCachedFetch<ProfileData>('profile', ...)` — skeleton on first load only.

## Sign-Up Flow

`SignUpScreen` collects only email + password — no display name; that's collected in Onboarding Step 1, avoiding asking twice.

**`handle_new_user` does NOT leave `display_name` null.** The live trigger is `coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'user'), '@', 1))` — with no `display_name` key (true for email signup, Google, and Apple), it falls back to the **local part of the email**. Harmless for normal email signup only because nothing reads `users.display_name` before `OnboardingScreen.saveProfile()` overwrites it (local state starts blank regardless of the DB). Any new code reading `users.display_name` before onboarding completes (like Apple Sign In's pre-fill) **will** see this fallback, not null — Apple's private-relay email (`4n66rhjb5j@privaterelay.appleid.com`) falls back to a random-looking string, exactly what a real user saw in production before this was diagnosed.

## Web Auth Gotchas

`supabase.auth.getSession()` on web hangs indefinitely when the stored token is expired and the refresh call is slow/blocked — Supabase's internal `initializePromise` won't resolve until the refresh completes, so `getSession()` and `INITIAL_SESSION` can both be stuck at once.

**Pattern to use everywhere:**
```ts
// WRONG — hangs on web if token is expired
const { data: { session } } = await supabase.auth.getSession();

// RIGHT — reads cached session set by onAuthStateChange, synchronous
import { sessionStore } from '../../lib/sessionStore';
const session = sessionStore.get();
```

`sessionStore` seeds itself synchronously on web by reading Supabase's `sb-<projectRef>-auth-token` from `localStorage` at module load, so `sessionStore.get()` returns the persisted session before Supabase finishes async init — no wait on `initializePromise`.

`useAuth` uses that seed: on web, `loading` starts `false` and the initial session comes straight from `sessionStore`, so the root spinner never blocks. On native, a 1.5s fallback timeout forces `loading` off in case SecureStore init lags. `onAuthStateChange` updates state once Supabase catches up.

**Push notifications on web:** `expo-notifications` has import-time side effects that warn on web — solved via platform files: `usePushNotifications.native.ts` (real impl), `.web.ts` (no-op stub), `.ts` (TS-resolution fallback stub).

**Shadow props on web:** `shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffset` are deprecated in RN Web — wrap in `Platform.select({ default: { shadow... }, web: {} })` as an inline override, removed from `StyleSheet.create`.

## Native Patches (`patches/`)

`patch-package` runs from `postinstall` (EAS applies patches on every build). ⚠️ **A patch to React Native's iOS core source only takes effect if RN is actually built from source.** Expo SDK 54 ships React as a **precompiled `React.framework`** by default (`RCT_USE_PREBUILT_RNCORE=1`) — a patched `RCTTurboModule.mm` then never compiles and the crash it fixes ships anyway (happened once: build 24 shipped the pristine prebuilt framework and crashed identically; confirmed by downloading the IPA and finding zero patch strings in the binary). `eas.json`'s production profile sets `RCT_USE_PREBUILT_RNCORE=0` so React builds from source and the patch is real — cost: slower iOS builds (~5min → ~15-20min). If that env var is ever removed, the patch silently stops applying — when in doubt, download the IPA and `strings` the React binary for `suppressed (would corrupt JS runtime off-thread)`.

- **`react-native+0.81.5.patch`** — `RCTTurboModule.mm`: an `NSException` thrown inside an **async void** TurboModule method used to be converted to a JS error *on the TurboModule thread* and thrown through a dispatch block — the off-thread runtime access races the JS thread and corrupts the Hermes heap (production: SIGSEGV in `HiddenClass::addProperty` on iOS 26.5.2 adding camera-roll media to a capsule). The patch makes the async-void path catch → `NSLog` + continue (look for `[TurboModule] NSException in async void method …` in the device console to name the thrower); the sync path is unchanged. Upstream open, no fix (facebook/react-native#54859, expo/expo#44606) — when bumping React Native, check whether the void path got the `isSync`-gated treatment and only drop the patch if it did.

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_REVENUECAT_IOS_KEY=...      # appl_... — REQUIRED; if unset, purchases are disabled (no fallback key), see "Monetization"
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=...  # goog_... — not yet configured (no Android app in RevenueCat yet)
EXPO_PUBLIC_SENTRY_DSN=...              # unset = Sentry never inits; set = release-only reporting, see "Error Monitoring"
EXPO_PUBLIC_SENTRY_ENV=...              # optional — overrides the Sentry `environment` tag (else production/development)
```

**Server-side secrets** (Supabase Edge Function secrets — never `EXPO_PUBLIC_`, must not reach the client bundle):

```
REVENUECAT_WEBHOOK_SECRET=...  # shared secret RevenueCat sends as the Authorization header
REVENUECAT_API_KEY=...         # RevenueCat V2 key, customer_information:customers:read ONLY
CRON_SECRET=...                # project-wide, read by every cron-triggered function
```

**The App Store reviewer account's credential is NOT in the repo and must never be reintroduced.** `scripts/reviewer-seed/*.mjs` read `REVIEWER_EMAIL`/`REVIEWER_PASSWORD` from the environment and fail fast when unset; `seed.sql` takes it as a psql variable (`-v reviewer_password=…`). It was previously hardcoded in four tracked files — a live production login for a comp-Pro account, and with `users` SELECT being `USING (true)`, an authenticated foothold able to enumerate every profile. It remains in git history prior to the `20260802` fix, so **treat any pre-fix clone as compromised**. Keep the value only in the password manager and App Store Connect review notes; `docs/REVIEWER_ACCOUNT.md` carries a pre-submission item to rotate it and re-verify `subscription_tier = 'pro'`.

`REVENUECAT_API_KEY` must be the **read-only** V2 key, not the full-access key used by the RevenueCat MCP — least privilege, since a leak of this one only exposes customer entitlement reads. The webhook fails closed (500, tier untouched, RevenueCat retries) when it's unset, so **set the secret before deploying**.

App config: `app.json`. Bundle ID: `com.markdickson.capsule`. EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`.

**iOS deployment target is 15.5**, pinned via the `expo-build-properties` plugin (`app.json`'s `ios.deploymentTarget`). `react-native-zip-archive` (Pro ZIP-export dependency) requires 15.5; SDK 54's default of 15.1 broke `pod install` (and would've broken EAS production builds). `ios/` is gitignored (Expo CNG, regenerated on prebuild), so `app.json` is the durable source — don't hand-edit `ios/Podfile.properties.json` / the pbxproj to fix this, they get regenerated.

**EAS build profiles** (`eas.json`):
- `production` — iOS: `simulator: false`, `autoIncrement: true` (bumps `buildNumber` each build). `appVersionSource: "remote"` (version managed by EAS, not `app.json`).
- No `preview` profile yet — Android preview APKs use `eas build --profile preview` with default config.

**TestFlight deployment:**
```bash
eas build --platform ios --profile production   # Build the binary
eas submit --platform ios --profile production  # Submit to App Store Connect / TestFlight
```
