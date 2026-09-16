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

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

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
