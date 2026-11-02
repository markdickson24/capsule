# Caching, utilities, monitoring and builds

Part of the Capsule architecture docs, indexed from `CLAUDE.md`. Describes the system as it is now; update in the same change that alters it.

## Utilities

- `src/lib/uuid.ts` — `randomUUID()`, backed by **`expo-crypto`'s CSPRNG** (native on iOS/Android; `globalThis.crypto.randomUUID()` on web). Use this instead of `crypto.randomUUID()` — the `crypto` global is not reliably typed in the Expo TS config. ⚠️ **Never revert this to `Math.random()`**: Hermes' `Math.random` is a seeded xorshift128+, so observing outputs allows state recovery and prediction (2026-07-29 audit, M-3, CWE-338). `expo-crypto` is already a dependency and already linked in `ios/Pods`, and its `randomUUID()` is **synchronous** on both native and web — the signature is unchanged, so no call site needs touching. `src/lib/uuid.test.ts` statically asserts the wiring to catch a regression.
- `src/lib/haptics.ts` — `haptics.{light,medium,heavy,selection,success,warning,error}()`. Central wrapper over `expo-haptics`; no-ops on web and swallows errors so call sites need no platform guard. **Use this for all tactile feedback** rather than importing `expo-haptics` directly. Wired into: tab bar taps (light; camera button medium), camera shutter (medium), reactions (light), notification accept (success) / decline (light), Home layout toggle (selection), and `DatePicker` (its local `haptic()`/`hapticSelection()` now delegate to this wrapper rather than calling `expo-haptics` directly).
- `src/lib/googleAuth.ts` — `signInWithGoogle()`. Returns `{ error?: string }`.
- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient }`. `ThemeProvider` must wrap the app. See "Theme System" for the gradient (Pro cosmetic).
- `src/lib/sessionStore.ts` — `sessionStore.get()` / `sessionStore.set()`. Module-level session cache, updated by `useAuth` on every `onAuthStateChange` event. **Always use `sessionStore.get()` instead of `await supabase.auth.getSession()` inside screens.** `getSession()` on web hangs when the access token is expired because it blocks on an internal refresh network call. `sessionStore.get()` is synchronous and never hangs.
- `src/lib/limitSheet.ts` — `limitSheet.show({ title, message, icon?, actions })` / `.hide()`. Module-level global "you hit a limit" bottom sheet, rendered by `<LimitSheetHost>` (mounted once near the app root next to `<ToastHost>`) — **mirrors the `toast`/`ToastHost` pub/sub pattern exactly**. `actions` are `{ label, style?: 'primary'|'secondary'|'destructive', onPress }`; the host **dismisses the sheet FIRST, then runs the action's `onPress`** after the ~220ms dismiss finishes (instant under Reduce Motion). This ordering matters: an action that presents a **native** modal (the RevenueCat paywall via `presentPaywall`) must not fire while this RN `<Modal>` is still animating out — doing so glitches on iOS (the video-length / recurring-group upgrade bug). An `onPress` still must not call `limitSheet.show(...)` to re-open (the sheet was just dismissed); an async `onPress` is fine (the long work shows state on the underlying screen). Driven by `proGateHit` (every tier gate) and the Preview video-length sheet. Component: `src/components/LimitSheet.tsx` — dismiss via backdrop tap, an action, or **swipe-down** (a `PanResponder` on the card makes the grab handle a real affordance; animations use `useNativeDriver: false` so the JS-thread drag can share the `translateY` value, same rule as the members sheet). Honors OS **Reduce Motion** (snaps instead of animating).
- `src/lib/mediaDuration.ts` — `assetDurationMs(asset)`: an ImagePicker asset's video length in ms, normalizing the web-shim-returns-seconds gotcha. Feeds `PendingMedia.durationMs`, which the Preview video-length gate reads (unset = fail-open).
- `src/lib/toast.ts` — `toast.show(message, action?)`. Module-level global toast, rendered by `<ToastHost>` (mounted once near the app root, so it survives navigation). `action` is optional: `{ label: string; onPress: () => void }` renders a tappable inline action (e.g. "Undo") next to the message — tapping it fires `onPress` then dismisses the toast immediately, same as the auto-dismiss timer. Used for the archive/restore Undo (see "Owner-Only Capsule Actions"). **Rule: any user-initiated mutation that fails must toast** — a background write with no feedback on error becomes a mystery bug report ("my restore didn't work") that can't be reproduced. Swept across `persistRead` (NotificationsScreen), `setAccentColor`/`setHomeLayout` (ThemeContext), the per-member `send-invite-push` loop and `set_default_superlatives` call (CreateScreen) — all previously silent on failure.
- `src/lib/sentry.ts` — the single home for all Sentry wiring (see "Error Monitoring" below). Exports `initSentry()`, `setSentryUser(id|null)`, `reportError(err, { where?, extra? })`, `navigationIntegration`, and `hasSentryDsn`. **Use `reportError` in any catch block that would otherwise swallow an error or only toast** — it's the manual-capture counterpart to the toast rule above (toast = tell the user, `reportError` = tell you).

---

## Cache System (`src/lib/cache.ts`)

In-memory cache (lost on cold start — no persistence) with TTL, key-based invalidation, and pub/sub listeners. Reduces loading times by showing cached data instantly while fetching fresh data in the background.

- `cache.get<T>(key, ttl?)` — returns cached data or null if expired (default 15 min TTL)
- `cache.set<T>(key, data)` — stores data with timestamp
- `cache.invalidate(...keys)` — deletes entries and notifies all subscribers for those keys
- `cache.subscribe(key, fn)` — returns unsubscribe function; used by `useCachedFetch` for cross-screen reactivity
- `cache.clear()` — wipes entire cache (called on sign out via `useAuth`)

⚠️ **Module-level state must be bound to a user id AND cleared on sign-out — `cache.clear()` alone is not enough.** Cache keys are mostly *not* user-scoped (`capsules`, `profile`, `notifications`, `groups`, `awards:<id>` — only `tier:${userId}` is), and `useCachedFetch`'s `inFlight` registry is module-level, so a request issued with the departing user's token could resolve *after* `cache.clear()` and write that user's data back under a shared key; `useFocusEffect` then treats the fresh hit as authoritative and **skips the network call entirely**, so no RLS check ever runs to correct it — the next user saw the previous user's capsules, profile stats, notifications, and their private `my_vote`/`i_upvoted` flags. The `uploadQueue` had the mirror-image bug: `tasks` survived sign-out and `runTask` re-read the session at execution time, so the next user saw the previous user's local media as retryable tiles and Retry uploaded it under *their* credentials. Both now do two things, and **both halves are required**: (1) capture the user id at `enqueue()`/fetch start and drop the work if it no longer matches (`resetCachedFetchState()` / `uploadQueue.reset()` are the clear-side; the identity check is the real defense), and (2) `useAuth`'s SIGNED_OUT branch calls both alongside `cache.clear()`/`blockStore.clear()`/the stashes. `uploadQueue.reset()` bumps `cacheGeneration` **before** clearing the three dedup Maps, matching `work()`'s drain-clear ordering. **New module-level state needs the same treatment.**

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
- `tier:${userId}` — the signed-in user's mirrored `users.subscription_tier`, read by `useEntitlements()` as the second Pro source (5min TTL, short because it mirrors a webhook write; a *purchase* needs no TTL wait since RevenueCat's listener flips `isPro` immediately). Cleared by `cache.clear()` on sign-out, so an account switch can't inherit the previous user's tier.
- `notifications` — NotificationsScreen. **The Alerts tab badge (`CustomTabBar` in `AppNavigator.tsx`) also reads this key** (PERFORMANCE.md #11): it `cache.subscribe`s to `notifications` and sets the unread count from the cached (grouped) list's length, so the badge updates the instant a notification is read/dismissed/received — no throttled per-tab-switch query, no up-to-60s stale lag (BUGS.md #10). It falls back to a lightweight `count/head` query only when the cache is empty (cold start before Alerts is visited, or right after an invalidate). Because the cached list is *grouped* (reactions collapse into one card), the badge shows the grouped-unread count, capped at "9+".
- `group:${id}`, `group-members:${id}`, `group-capsules:${id}`, `groups` — GroupDetailScreen / HomeScreen / ManageGroupScreen (see "Groups" section above for the full feature). `listMyGroups`/`getGroup` (`src/lib/groups.ts`) fetch `memberCount` via a PostgREST embedded `group_members(count)` aggregate in the *same* query (PERFORMANCE.md #6) — one round-trip, no member-row payload, instead of a second query that pulled every member row just to count them.

**Invalidation pattern:** screens that mutate data call `cache.invalidate()` with all affected keys. Example: creating a capsule invalidates `capsules` and `profile` (stats changed). Uploading/deleting media or a capsule unlocking invalidates both `signedUrls:${id}` and `media:${id}` together — invalidating only the signed-URL cache while `media:${id}` is one mutation site is not enough.

---

## Error Monitoring (Sentry)

Crash + error reporting via `@sentry/react-native` (v7.2.0). **All Sentry config lives in `src/lib/sentry.ts`** — never call `Sentry.init` or read `EXPO_PUBLIC_SENTRY_DSN` elsewhere.

- **Init:** `App.tsx` calls `initSentry()` once at module load, then `export default hasSentryDsn ? Sentry.wrap(App) : App` (the wrap adds the error boundary + touch/native crash capture; passthrough when no DSN). The `@sentry/react-native/expo` config plugin in `app.json` (org `capsule-60`, project `react-native`) handles source-map upload at EAS build time.
- **Enabled only in RELEASE builds.** `sentryEnabled = !!DSN && !__DEV__`. Under Metro/Expo dev `__DEV__` is true, so the SDK is initialized-but-`enabled:false` — instrumentation is wired but nothing transmits, keeping the dashboard free of local dev / HMR noise. `initSentry()` still returns early (never inits) when `EXPO_PUBLIC_SENTRY_DSN` is unset.
- **Privacy: user id ONLY.** `sendDefaultPii: false`, and a `beforeSend` hook deletes `event.user.email`/`ip_address`/`username` as a belt-and-suspenders scrub. `useAuth`'s `settle()` calls `setSentryUser(session?.user.id ?? null)` on every session update (set on sign-in, cleared to null on sign-out) — so events group per user with **no** email/IP, appropriate for a private photo app. Never widen this to attach PII without a deliberate decision.
- **Navigation instrumentation:** `navigationIntegration` (a `reactNavigationIntegration`) is registered via `NavigationContainer`'s `onReady` (`registerNavigationContainer(navigationRef)`), so route changes become breadcrumbs + performance transactions.
- **Performance tracing only, no Session Replay** (`tracesSampleRate: 0.2`). Replay records the user's screen — a privacy concern for this app — so it's deliberately omitted.
- **`environment`** = `EXPO_PUBLIC_SENTRY_ENV` if set, else `production` (release) / `development` (dev). **`release`** = `<bundleId>@<version>`, **`dist`** = native build number — mirrors how the Expo plugin names source-map uploads so events symbolicate.
- **Manual capture convention:** call `reportError(err, { where: 'module.fn', extra: {...} })` in catch blocks that swallow/only-toast. `where` is a short call-site tag; `extra` is structured context (ids/counts) — **never PII**. Already wired into the highest-value silent-failure paths: `uploadQueue.runTask` (media-loss), `purchases.configure`/`identifyUser`/`presentPaywall` (revenue pipeline), and `SettingsScreen` account deletion. New swallowed-error paths should use it too. A non-Error value (e.g. Supabase's plain `{ message, code, details, hint }` object, which every `{ data, error }` destructure returns — postgrest-js only builds a real `PostgrestError` on the `throwOnError` path) is normalized by `describeError` (`src/lib/errorFields.ts`, pure + unit-tested) into a real message plus its scalar fields as extras; it used to become `Error: [object Object]`, which collapsed every such report into one undebuggable issue.

---

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

---

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_REVENUECAT_IOS_KEY=...      # appl_... — REQUIRED; if unset, purchases are disabled (no fallback key), see "Monetization"
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=...  # goog_... — not yet configured (no Android app in RevenueCat yet)
EXPO_PUBLIC_SENTRY_DSN=...              # unset = Sentry never inits; set = release-only reporting, see "Error Monitoring"
EXPO_PUBLIC_SENTRY_ENV=...              # optional — overrides the Sentry `environment` tag (else production/development)
```

**Server-side secrets** (Supabase Edge Function secrets — never `EXPO_PUBLIC_`,
these must not reach the client bundle):

```
REVENUECAT_WEBHOOK_SECRET=...  # shared secret RevenueCat sends as the Authorization header
REVENUECAT_API_KEY=...         # RevenueCat V2 key, customer_information:customers:read ONLY
CRON_SECRET=...                # project-wide, read by every cron-triggered function
```

**The App Store reviewer account's credential is NOT in the repo and must never be reintroduced.** `scripts/reviewer-seed/*.mjs` read `REVIEWER_EMAIL`/`REVIEWER_PASSWORD` from the environment and fail fast when unset; `seed.sql` takes it as a psql variable (`-v reviewer_password=…`). It was previously hardcoded in four tracked files — a live production login for a comp-Pro account, and with `users` SELECT being `USING (true)`, an authenticated foothold that could enumerate every profile. It remains in git history prior to the `20260802` fix, so **treat any pre-fix clone as compromised**. Keep the value only in the password manager and App Store Connect review notes; `docs/REVIEWER_ACCOUNT.md` carries a pre-submission item to rotate it and re-verify `subscription_tier = 'pro'`.

`REVENUECAT_API_KEY` must be the **read-only** V2 key, not the full-access key
used by the RevenueCat MCP — least privilege, since a leak of this one only
exposes customer entitlement reads. The webhook fails closed (500, tier
untouched, RevenueCat retries) when it is unset, so **set the secret before
deploying**.

App config: `app.json`. Bundle ID: `com.markdickson.capsule`. EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`.

**iOS deployment target is 15.5**, pinned via the `expo-build-properties` plugin in `app.json` (`ios.deploymentTarget`). `react-native-zip-archive` (the Pro capsule ZIP-export dependency) requires 15.5; the Expo SDK 54 default of 15.1 made `pod install` fail with an incompatible-version error, which would also break EAS production builds. Because `ios/` is gitignored (Expo CNG, regenerated on prebuild), `app.json` is the durable source — don't hand-edit `ios/Podfile.properties.json` / the pbxproj as the fix (those get regenerated).

**EAS build profiles** (`eas.json`):
- `production` — iOS: `simulator: false`, `autoIncrement: true` (bumps `buildNumber` each build). `appVersionSource: "remote"` so version is managed by EAS, not `app.json`.
- No `preview` profile defined yet — Android preview APKs use `eas build --profile preview` with the default config.

**TestFlight deployment:**
```bash
eas build --platform ios --profile production   # Build the binary
eas submit --platform ios --profile production  # Submit to App Store Connect / TestFlight
```
