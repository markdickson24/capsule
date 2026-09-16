---
paths:
  - "src/**"
  - "modules/**"
  - "supabase/**"
  - "netlify/**"
  - "targets/**"
  - "App.tsx"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Project Structure

```
modules/
  expo-dual-camera/        # Simultaneous front+back capture; see "Dual Camera"
  expo-video-stitcher/     # Concatenates video segments into one MP4; also exports trimVideo() for trimming
src/
  components/
    AwardsSection.tsx        # Superlatives UI in CapsuleDetail: voting/tallying/finalized cards
    ColorPicker.tsx          # HSV picker: SV panel, hue slider, hex input
    ConfirmModal.tsx         # Cross-platform confirm dialog; use instead of Alert.alert
    DatePicker.tsx           # Date/time picker: calendar grid, month/year picker, presets, haptics
    JoinCapsuleConfirm.tsx   # Confirm sheet for capsule://join; never writes membership itself; see "Deep links"
    RetryPrompt.tsx          # Inline retry button shown after useLoadingTimeout fires
    SealedMoment.tsx         # Full-screen "sealed" ceremony after capsule create; navigates to CapsuleDetail
    Skeleton.tsx             # Shimmer skeleton loaders (SkeletonBox, SkeletonCard, etc.)
    SuggestCategoryModal.tsx # Bottom sheet to propose a superlative category
    VoteSheet.tsx            # Bottom sheet to cast/change a vote
    VotingWindowPicker.tsx   # 24h/48h/7d/custom-hours picker for voting window
  context/
    ThemeContext.tsx         # accentColor per-user, loaded from Supabase on auth
  hooks/
    useAuth.ts              # Session listener; returns { session, loading }
    useCachedFetch.ts       # Cache-aware fetch hook: show cached, refresh in background
    useLoadingTimeout.ts    # { timedOut, reset } after Nms of loading
    useDeepLinks.ts         # Handles capsule://join/<id> and capsule://reset-password
    usePushNotifications.native.ts  # Token registration + tap routing (iOS/Android only)
    usePushNotifications.web.ts     # No-op stub for web
    usePushNotifications.ts         # TS fallback stub
    useShareIntent.native.ts        # Consumes expo-share-intent, routes to Preview or stash
    useShareIntent.web.ts           # No-op stub for web
    useShareIntent.ts               # TS fallback stub
    useRevenueCat.ts         # RevenueCat lifecycle: configure once, logIn/logOut on session; see "Monetization"
    useEntitlements.ts       # Reactive { isPro }; UI-only, not the real gate; see "Monetization"
  lib/
    animations.ts           # Animation hooks: useFadeIn, useSlideUp, useListItemEntrance
    cache.ts                # In-memory cache: TTL, invalidation, pub/sub
    avatarUrl.ts             # transformAvatarUrl() — pass-through, render API disabled
    mediaUrl.ts              # transformMediaUrl() — resized capsule media via render API
    supabase.ts             # Supabase client + web accessToken override
    sessionStore.ts         # Sync session cache; also onboarded-flag + session-expired flags
    shareIntentStash.ts     # Stash for media shared while signed out
    ShareIntentProvider.{native,web,tsx}  # Platform-split provider wrapper
    uuid.ts                 # randomUUID() — expo-crypto CSPRNG, never Math.random
    googleAuth.ts           # signInWithGoogle() via expo-auth-session (PKCE)
    deepLinkRoute.ts        # parseDeepLink() — pure capsule:// router; never use global URL class; see "Deep links"
    navigationRef.ts        # Imperative nav ref for use outside components
    purchases.native.ts     # RevenueCat SDK wrapper (native only); see "Monetization"
    purchases.web.ts        # No-op stub for web
    purchases.ts             # TS-resolution fallback (re-exports web stub)
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
    navigation.ts           # Param lists: AuthStack, AppTab, AppStack
    database.ts             # Capsule, User, etc. row types; keep in sync with DB
supabase/
  functions/
    unlock-capsules/         # Marks due capsules unlocked + pushes; cron every minute, Bearer CRON_SECRET
    send-invite-push/        # Sends invite push; reads push_token via service role
    send-superlative-pushes/ # Sends suggested/closing_soon/won pushes; cron with close_superlative_windows
    dispatch-capsule-start/  # Claims capsules whose contribution_start_at arrived; notifies + pushes; see "Capsule Start Date"
    revenuecat-webhook/      # Mirrors Pro entitlement into users.subscription_tier; see "Monetization"
  migrations/                # Timestamped SQL migrations; source of truth over supabase-schema.sql (which has drifted)
```
