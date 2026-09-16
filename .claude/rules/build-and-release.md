---
paths:
  - "patches/**"
  - "eas.json"
  - "app.json"
  - "package.json"
  - "ios/**"
  - "scripts/**"
  - ".env*"
  - "supabase/functions/**"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Native Patches (`patches/`)

`patch-package` runs from `postinstall` (EAS applies patches every build). ⚠️ **A patch to RN's iOS core source only takes effect if RN builds from source.** Expo SDK 54 ships a precompiled `React.framework` by default (`RCT_USE_PREBUILT_RNCORE=1`) — a patched `RCTTurboModule.mm` in node_modules then never compiles, shipping the crash anyway. <!-- History: build 24 shipped the pristine prebuilt framework and crashed identically; confirmed by downloading the IPA and finding zero patch strings in the binary. --> `eas.json`'s production profile sets `RCT_USE_PREBUILT_RNCORE=0` to build from source, making the patch real (cost: ~5min → ~15-20min iOS builds). If that env var is ever removed, the patch silently stops applying — verify by downloading the IPA and `strings`-ing the React binary for `suppressed (would corrupt JS runtime off-thread)`.

- **`react-native+0.81.5.patch`** — `RCTTurboModule.mm`: an `NSException` in an **async void** TurboModule method used to be converted to a JS error *on the TurboModule thread* and thrown through a dispatch block — off-thread runtime access races the JS thread, corrupting the Hermes heap (production: SIGSEGV in `HiddenClass::addProperty` on iOS 26.5.2 adding camera-roll media to a capsule). Patch makes the async-void catch `NSLog` + continue (`[TurboModule] NSException in async void method …` names the thrower); sync path unchanged. Upstream open, no fix (facebook/react-native#54859, expo/expo#44606) — on a React Native bump, check whether the void path got the `isSync`-gated treatment and drop the patch only if so.

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_REVENUECAT_IOS_KEY=...      # appl_... — REQUIRED, no fallback key; see "Monetization"
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=...  # goog_... — not configured yet (no Android app in RevenueCat)
EXPO_PUBLIC_SENTRY_DSN=...              # unset = never inits; set = release-only reporting, see "Error Monitoring"
EXPO_PUBLIC_SENTRY_ENV=...              # optional override for the Sentry `environment` tag (else production/development)
```

**Server-side secrets** (Supabase Edge Function secrets — never `EXPO_PUBLIC_`, must not reach the client bundle):

```
REVENUECAT_WEBHOOK_SECRET=...  # shared secret RevenueCat sends as the Authorization header
REVENUECAT_API_KEY=...         # RevenueCat V2 key, customer_information:customers:read ONLY
CRON_SECRET=...                # project-wide, read by every cron-triggered function
```

**The App Store reviewer account's credential is NOT in the repo and must never be reintroduced.** `scripts/reviewer-seed/*.mjs` read `REVIEWER_EMAIL`/`REVIEWER_PASSWORD` from the environment and fail fast when unset; `seed.sql` takes it as a psql variable (`-v reviewer_password=…`). <!-- History: previously hardcoded in four tracked files — a live production login for a comp-Pro account, which with users SELECT USING (true) was also an authenticated foothold to enumerate every profile. --> Remains in git history prior to the `20260802` fix (`users` SELECT is `USING (true)`) — treat any pre-fix clone as compromised. Keep the value only in the password manager and App Store Connect review notes; `docs/REVIEWER_ACCOUNT.md` has a pre-submission item to rotate it and re-verify `subscription_tier = 'pro'`.

`REVENUECAT_API_KEY` must be the **read-only** V2 key, not the full-access key the RevenueCat MCP uses — least privilege (a leak only exposes entitlement reads). Webhook fails closed (500, tier untouched, RevenueCat retries) when unset — **set the secret before deploying**.

App config: `app.json`. Bundle ID: `com.markdickson.capsule`. EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`.

**iOS deployment target is 15.5**, pinned via `expo-build-properties` (`app.json`'s `ios.deploymentTarget`). `react-native-zip-archive` (Pro ZIP-export dependency) requires 15.5; SDK 54's default 15.1 fails `pod install` (and EAS production builds). `ios/` is gitignored (regenerated on prebuild) — `app.json` is the durable source; don't hand-edit `ios/Podfile.properties.json`/the pbxproj.

**EAS build profiles** (`eas.json`):
- `production` — iOS: `simulator: false`, `autoIncrement: true` (bumps `buildNumber` each build). `appVersionSource: "remote"` so version is managed by EAS, not `app.json`.
- No `preview` profile defined yet — Android preview APKs use `eas build --profile preview` with the default config.

**TestFlight deployment:**
```bash
eas build --platform ios --profile production   # Build the binary
eas submit --platform ios --profile production  # Submit to App Store Connect / TestFlight
```
