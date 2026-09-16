---
paths:
  - "src/**"
  - "modules/**"
  - "supabase/**"
  - "netlify/**"
  - "targets/**"
  - "App.tsx"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Project Structure

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
