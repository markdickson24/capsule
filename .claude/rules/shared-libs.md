---
paths:
  - "src/**"
  - "App.tsx"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`, backed by `expo-crypto`'s CSPRNG (native; `globalThis.crypto.randomUUID()` on web). Use instead of `crypto.randomUUID()` (untyped in Expo's TS config). ⚠️ **Never revert to `Math.random()`** — Hermes's is a seeded xorshift128+, allowing state recovery/prediction from observed outputs. Already a dependency, already linked in `ios/Pods`; `randomUUID()` is synchronous on both platforms. `src/lib/uuid.test.ts` asserts the wiring. <!-- History: 2026-07-29 audit M-3, CWE-338 -->
- `src/lib/haptics.ts` — `haptics.{light,medium,heavy,selection,success,warning,error}()`. Wraps `expo-haptics` (no-ops on web, swallows errors). **Use for all tactile feedback** — never import `expo-haptics` directly. Wired into tab taps, camera shutter, reactions, notification accept/decline, Home layout toggle, and `DatePicker` (`haptic()`/`hapticSelection()` delegate here).
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient }`. `ThemeProvider` must wrap the app. See "Theme System" for the gradient (Pro cosmetic).
- `src/lib/sessionStore.ts` — `sessionStore.get()`/`sessionStore.set()`. Module-level session cache updated by `useAuth` on `onAuthStateChange`. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()`** — `getSession()` hangs on web when the token is expired (blocks on an internal refresh call); `sessionStore.get()` is synchronous and never hangs.
- `src/lib/limitSheet.ts` — `limitSheet.show({ title, message, icon?, actions })` / `.hide()`. Global "hit a limit" sheet via `<LimitSheetHost>` (near root with `<ToastHost>`; mirrors `toast`/`ToastHost`'s pub/sub pattern). `actions`: `{ label, style?: 'primary'|'secondary'|'destructive', onPress }`. **Host dismisses FIRST, then runs `onPress`** after the ~220ms dismiss — a native modal action (e.g. `presentPaywall`) must not fire while this RN `<Modal>` is still animating out (glitches on iOS). `onPress` must not call `limitSheet.show(...)` to re-open; async is fine. Driven by `proGateHit` and the Preview video-length sheet. Component: `src/components/LimitSheet.tsx` — dismiss via backdrop, action, or swipe-down (`PanResponder`, `useNativeDriver: false` sharing `translateY`); honors OS Reduce Motion.
- `src/lib/mediaDuration.ts` — `assetDurationMs(asset)`: an ImagePicker asset's video length in ms, normalizing the web-shim-returns-seconds gotcha. Feeds `PendingMedia.durationMs`, which the Preview video-length gate reads (unset = fail-open).
- `src/lib/toast.ts` — `toast.show(message, action?)`. Global toast via `<ToastHost>` (near root, survives navigation). `action` is optional: `{ label: string; onPress: () => void }` — tapping fires `onPress` then dismisses immediately. **Rule: any user-initiated mutation that fails must toast** — a silent failure becomes an unreproducible bug report. Swept across archive/restore Undo, `persistRead`, `setAccentColor`/`setHomeLayout`, the `send-invite-push` loop, and `set_default_superlatives` (all previously silent on failure).
- `src/lib/sentry.ts` — single home for Sentry wiring. Exports `initSentry()`, `setSentryUser(id|null)`, `reportError(err, { where?, extra? })`, `navigationIntegration`, `hasSentryDsn`. **Use `reportError`** in catch blocks that would otherwise swallow an error or only toast (toast = tell the user, `reportError` = tell you).

## Error Monitoring (Sentry)

Crash/error reporting via `@sentry/react-native` (v7.2.0). **All config lives in `src/lib/sentry.ts`** — never call `Sentry.init` or read `EXPO_PUBLIC_SENTRY_DSN` elsewhere.

- **Init:** `App.tsx` calls `initSentry()` once at module load, then `export default hasSentryDsn ? Sentry.wrap(App) : App`. The `@sentry/react-native/expo` plugin in `app.json` (org `capsule-60`, project `react-native`) uploads source maps at EAS build time.
- **Release-only:** `sentryEnabled = !!DSN && !__DEV__` — in dev, `__DEV__` is true so the SDK inits `enabled:false` (wired, nothing transmits). `initSentry()` never inits if `EXPO_PUBLIC_SENTRY_DSN` is unset.
- **Privacy: user id ONLY.** `sendDefaultPii: false` + a `beforeSend` hook deletes `event.user.email`/`ip_address`/`username`. `useAuth`'s `settle()` calls `setSentryUser(session?.user.id ?? null)` on every session change. Never widen without a deliberate decision.
- **Navigation instrumentation:** `navigationIntegration` (a `reactNavigationIntegration`) registers via `NavigationContainer`'s `onReady` (`registerNavigationContainer(navigationRef)`).
- **Performance tracing only, no Session Replay** (`tracesSampleRate: 0.2`) — Replay records the screen, a privacy concern here.
- `environment` = `EXPO_PUBLIC_SENTRY_ENV` or `production`/`development`. `release` = `<bundleId>@<version>`; `dist` = native build number.
- **Manual capture:** `reportError(err, { where: 'module.fn', extra: {...} })` in catch blocks that swallow/only-toast; `where` is a call-site tag, `extra` structured context — never PII. Wired into `uploadQueue.runTask`, `purchases.configure`/`identifyUser`/`presentPaywall`, `SettingsScreen` deletion. A non-Error value (e.g. Supabase's `{ message, code, details, hint }`, from every `{ data, error }` destructure — postgrest-js only builds a real `PostgrestError` on the `throwOnError` path) is normalized by `describeError` (`src/lib/errorFields.ts`) instead of `Error: [object Object]`.

## Cache System (`src/lib/cache.ts`)

In-memory cache (lost on cold start): TTL, key-based invalidation, pub/sub — shows cached data instantly while refetching in the background.

- `cache.get<T>(key, ttl?)` — cached data or null if expired (default 15 min TTL)
- `cache.set<T>(key, data)` — stores with timestamp
- `cache.invalidate(...keys)` — deletes entries, notifies subscribers
- `cache.subscribe(key, fn)` — unsubscribe fn; used by `useCachedFetch`
- `cache.clear()` — wipes cache (on sign-out via `useAuth`)

⚠️ **Module-level state must be bound to a user id AND cleared on sign-out — `cache.clear()` alone isn't enough.** Most keys aren't user-scoped (`capsules`, `profile`, `notifications`, `groups`, `awards:<id>` — only `tier:${userId}` is); `useCachedFetch`'s `inFlight` registry is module-level, so a departing user's request can resolve after `cache.clear()`, write into a shared key, and get served by `useFocusEffect` with no RLS check — leaking their capsules/profile/notifications/private `my_vote`/`i_upvoted` flags to the next user. `uploadQueue` had the mirror bug: `tasks` survived sign-out and `runTask` re-read the session at execution time, uploading the previous user's media under the next user's credentials. **Both halves required**: (1) capture the user id at `enqueue()`/fetch start and drop stale work (`resetCachedFetchState()`/`uploadQueue.reset()` are the clear-side; the identity check is the real defense); (2) `useAuth`'s SIGNED_OUT branch calls both alongside `cache.clear()`/`blockStore.clear()`/the stashes. `uploadQueue.reset()` bumps `cacheGeneration` before clearing its dedup Maps, matching `work()`'s drain-clear ordering. **New module-level state needs the same treatment.**

**`useCachedFetch<T>(key, fetcher, deps)`** (`src/hooks/useCachedFetch.ts`) — `{ data, loading, refresh }`. On focus, a fresh `cache.get(key)` renders instantly and **skips the network call entirely** (TTL governs every focus); on miss/expiry it fetches. `refresh()` always force-fetches regardless of TTL. On invalidation elsewhere, keeps showing current data while refetching (no blank flash). Concurrent fetches for the same key dedupe via a module-level in-flight registry (e.g. `cache.invalidate('capsules')` from three subscribers triggers one network call, not three).

`CapsuleDetailScreen`/`AwardsSection` hand-roll the same `cache.get`-then-fetch pattern instead of using this hook, since both have local optimistic-update state (reactions, upvotes) the hook's read-only `data` can't hold.

**Cache keys:**
- `capsules` — HomeScreen list
- `capsule:${id}` — capsule row + members
- `media:${id}` — raw `media` rows (3min TTL; separate from signed-URL cache so a hit skips the DB read too)
- `signedUrls:${id}` — batched signed URLs (50min TTL, under the 1hr signed-URL validity)
- `videoThumb:${id}` — local video thumbnail frame (6hr TTL, local file URI)
- `awards:${id}` — superlatives categories + winners (hand-rolled, not via the hook)
- `profile` — ProfileScreen hero data
- `tier:${userId}` — mirrored `users.subscription_tier` for `useEntitlements()` (5min TTL; a purchase needs no wait since RevenueCat's listener flips `isPro` immediately). Cleared by `cache.clear()` on sign-out.
- `notifications` — NotificationsScreen; also read by the Alerts tab badge (`CustomTabBar` in `AppNavigator.tsx`) via `cache.subscribe`, updating instantly instead of polling; falls back to a `count/head` query only when empty. Badge shows the grouped-unread count, capped "9+".
- `group:${id}`, `group-members:${id}`, `group-capsules:${id}`, `groups` — Group screens. `listMyGroups`/`getGroup` (`src/lib/groups.ts`) fetch `memberCount` via an embedded `group_members(count)` aggregate — one query, not two.

**Invalidation pattern:** mutating screens call `cache.invalidate()` with all affected keys — e.g. creating a capsule invalidates `capsules` + `profile`; uploading/deleting media or unlocking invalidates `signedUrls:${id}` **and** `media:${id}` together.
