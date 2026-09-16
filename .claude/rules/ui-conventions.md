---
paths:
  - "src/**/*.tsx"
  - "App.tsx"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## iOS / Web Layout Gotchas

- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `flex: 1` + `aspectRatio`.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — always guard with `Platform.OS !== 'web'`. Use `expo-file-system/legacy` import path.
- `Alert.alert` does not work reliably on web — use inline error state rendered as `<Text>` for errors, and `<ConfirmModal>` (`src/components/ConfirmModal.tsx`) for confirmation dialogs. A multi-button `Alert.alert` silently no-ops on web, so any action gated behind its callback never runs.
- `DateTimePicker` with `display="spinner"` renders the native iOS wheel picker. Use `Platform.OS === 'web' ? 'default' : 'spinner'` for cross-platform.
- Import `SafeAreaView` from `react-native-safe-area-context`, never from `react-native` (the latter is deprecated). For normal screens the provider is supplied by React Navigation's `NavigationContainer`, so no explicit `SafeAreaProvider` is needed. **Inside a React Native `<Modal>` it IS needed** — a `Modal` renders in a separate native view hierarchy the outer provider can't reach, so `SafeAreaView` returns zero insets and content slides under the notch. Wrap the modal's content in its own `<SafeAreaProvider>`.
- **`KeyboardAvoidingView` is broken on iOS under the New Architecture** (this app has `newArchEnabled: true`) — it silently fails to move its content, leaving the input **under the keyboard**. This bit BOTH caption fields (a plain screen *and* a modal). **Don't use `KeyboardAvoidingView`; track the keyboard height yourself** and apply it as an offset: `Keyboard.addListener('keyboardWillShow'/'keyboardWillHide', e => setKbHeight(e.endCoordinates?.height ?? 0))` (use `keyboardDidShow/Hide` on Android), then lift the bottom bar/panel by that height — `transform: [{ translateY: -kbHeight }]` on `PreviewScreen`'s caption panel, or `paddingBottom: kbHeight` on a full-height `justifyContent:'flex-end'` overlay for `CapsuleDetailScreen`'s `MediaViewerModal` caption editor. (The modal case is doubly bad: KAV also can't measure its frame origin inside a `<Modal>`'s separate window — but the manual-height approach handles both.) Any new text field near the bottom of the screen needs this pattern, not KAV.

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

**Text muted (`#555555`) vs. text secondary (`#888888`):** `#555555` on `#0A0A0A` is ≈2.5:1 contrast — below WCAG AA (4.5:1) for body text. **Reserve `#555555` for true decoration** (uppercase structural micro-labels like section headers, the "(optional)" annotation, divider words, icon tint on inactive/unselected elements). **Any text that's actual content the user needs to read — dates, counts, empty-state copy, hint/helper text, button labels — must use `#888888` or brighter**, which passes AA (≈5:1). When adding new muted text, default to `#888888` unless it's clearly decorative in the sense above.

**Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`** — otherwise VoiceOver/TalkBack just reads "button" with no name. Applies anywhere the only visible content is an `Ionicons` glyph (close ✕'s, camera controls, the `⋯` overflow, swap/dismiss/decline icon buttons, etc.) — a button with a `Text` child already gets an accessible name for free and doesn't need one added. Tab labels and countdown/badge `Text` also carry `maxFontSizeMultiplier` (≈1.3) so large Dynamic Type settings don't clip these tight, fixed-height layouts.

## Image Loading (`expo-image`)

All remote images use `Image` from `expo-image`, **not** from `react-native`. `expo-image` provides native disk + memory caching — after the first download, images load from cache on subsequent views.

```tsx
import { Image } from 'expo-image';

// expo-image uses `source` as string (not { uri }), `contentFit` (not resizeMode)
<Image source={url} contentFit="cover" transition={200} />
```

- `transition={200}` for smooth fade-in as images load
- `contentFit` replaces `resizeMode`: `"contain"` for full-screen viewer, `"cover"` for thumbnails
- Applied in: CapsuleDetailScreen (viewer + grid + gallery), ProfileScreen (Avatar), PreviewScreen, OnboardingScreen

## Animations (`src/lib/animations.ts`)

Reusable entrance animation hooks using the built-in `Animated` API (no `react-native-reanimated`).

- `useFadeIn(delay?, duration?)` — opacity 0→1
- `useSlideUp(delay?, duration?)` — opacity 0→1 + translateY 20→0
- `useListItemEntrance(index, baseDelay?)` — staggered fade+slide for list items (60ms per item, caps at index 8)

All three hooks use `useIsFocused()` from React Navigation, but only play the entrance animation **once per screen instance** (a `hasAnimatedRef` guard) — on the first focus after mount. On every subsequent re-focus (e.g. switching tabs back to an already-mounted screen), values snap directly to their final state instead of resetting and replaying; data from `useCachedFetch` is typically already instant on a re-focus, so replaying a ~300–780ms entrance animation on top of it just made already-fast navigation look slow. A genuine unmount+remount (e.g. pushing a new stack screen) still gets the full entrance animation, since `hasAnimatedRef` lives with the component instance.

**Rules of Hooks:** these hooks must be called before any early returns (e.g. `if (loading) return <Skeleton />`). Moving them after an early return causes "Rendered more hooks than during the previous render" errors.

**Screen transitions** configured in `AppNavigator.tsx`:
- Tabs/Onboarding: `animation: 'fade'`
- Settings: `animation: 'slide_from_bottom'`
- Preview: `animation: 'none'` (instant camera preview)
- All others: default `slide_from_right`

## Skeleton Loaders (`src/components/Skeleton.tsx`)

Shimmer-animated loading placeholders for screens that use `useCachedFetch`.

- `SkeletonBox` — base component with configurable width, height, borderRadius; uses `Animated.loop` with `interpolate` for shimmer
- `SkeletonCard` — capsule card placeholder for HomeScreen
- `SkeletonProfileCard` — hero card placeholder matching ProfileScreen layout (glow bar, avatar circle, name/bio/stats, action rows)
- All use dark theme colors (`#1A1A1A` base, `#2A2A2A` shimmer highlight)

## Retry on slow loads (`useLoadingTimeout` + `RetryPrompt`)

Every screen that fetches data on mount/focus shows a retry affordance if loading
takes longer than 8 seconds, instead of an indefinite spinner/skeleton (RN's
`fetch()` has no default timeout — a dead connection can hang 30s-2min).

- **`src/hooks/useLoadingTimeout.ts`** — `useLoadingTimeout(loading, timeoutMs = 8000)` returns `{ timedOut, reset }`. Arms an 8s timer whenever `loading` is `true`; clears it and resets `timedOut` to `false` the moment `loading` goes `false`. Exposes `reset()` because a retry tap doesn't produce a `loading: false→true` edge (the fetch just restarts under the same `true`) — **every `onRetry` handler must call `reset()` before kicking off the new fetch**, or the timeout will never re-arm on a second hang. This is the one detail to double-check when wiring a new screen.
- **`src/components/RetryPrompt.tsx`** — `{ onRetry, message?, compact? }`. Renders inline (not a modal/popup) — a message + a "Retry" button styled with dark-theme tokens and `accentColor` from `useTheme()`. `compact` shrinks padding/text for small inline contexts (`AwardsSection`'s `loadingBox`, `PublicProfileScreen`'s `InviteToCapsuleModal`); the default (non-compact) fills the screen like the skeleton it replaces.
- **Wiring pattern:** `if (loading) { if (timedOut) return <RetryPrompt onRetry={...} />; return <...skeleton...>; }` — the retry prompt **replaces** the skeleton/spinner rather than showing alongside it.
- **`useCachedFetch`'s `refresh` takes an optional `force` param** (`refresh(force?: boolean)`) specifically for this: the hook dedupes concurrent fetches per key via a module-level in-flight registry, so calling `refresh()` on a genuinely hung fetch would just re-await the same stuck promise. `refresh(true)` discards the stale in-flight entry first so a real new request fires. Every retry handler on a `useCachedFetch` screen calls `refresh(true)`, never bare `refresh()`.
- **Hand-rolled (non-hook) screens** just call their own fetch function again on retry, but **must replicate however that function currently clears its `loading` state** — some fetch functions clear it internally (`AwardsSection.fetchCategories`, `FriendsScreen.load`), others rely on the caller chaining `.finally(() => setLoading(false))` (`ManageMembersScreen.fetchMembers`, `PublicProfileScreen.load`, `EditCapsuleScreen.loadCapsule`). Check before assuming.
- **Applied to:** HomeScreen, NotificationsScreen, ProfileScreen, GroupDetailScreen (primary `groupLoading` gate only — the secondary `capsulesLoading` `ListEmptyComponent` spinner is non-blocking and deliberately left out), CapsuleDetailScreen (cold-load skeleton only — the warm-cache path already shows content instantly and refreshes silently in the background, so there's no visible loading UI to attach a retry button to), AwardsSection, FriendsScreen, EditCapsuleScreen, ManageMembersScreen, PublicProfileScreen + its nested `InviteToCapsuleModal`.
- **Not touched:** `LoadingBrandScreen`'s use in `AppNavigator.tsx`'s onboarding/route-resolution gate — that's a different kind of "loading" (route resolution, not a data-fetch-on-mount screen) and already has its own 5s timeout fallback to `Tabs`.

## ConfirmModal (`src/components/ConfirmModal.tsx`)

Cross-platform confirmation dialog — **use instead of `Alert.alert` for any confirm/cancel decision**, because a multi-button `Alert.alert` silently no-ops on web (the destructive action gated behind its callback never runs).

Controlled component. Props: `{ visible, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel }`. Renders a transparent `Modal` with a dark-theme card. `destructive` colors the confirm button `#FF3B30`; `loading` swaps the confirm label for a spinner and disables both buttons. The caller owns the `visible` state and the async work — keep `visible` true and `loading` true while the action runs, then close. Used for delete confirmation in `EditCapsuleScreen` and `CapsuleDetailScreen`.

## DatePicker (`src/components/DatePicker.tsx`)

Shared date/time picker used by `CreateScreen` and `EditCapsuleScreen`. Controlled component.

Props: `{ label, value, onChange, optional?, contextLabel? }`.

- Collapsed state shows the selected date/time with a "change" link; tapping expands inline
- Quick preset buttons: "In 1 month", "In 3 months", "In 6 months", "In 1 year"
- **Custom calendar grid** (no external library):
  - Day view: 7-column grid, accent-colored circle on selected day, accent border on today, past days dimmed (#333)
  - Tappable month/year header ("June 2026 ▼") switches to month picker mode
  - Month picker: 4×3 month grid with year navigation arrows (◀ ▶)
- Collapsible time row with native `DateTimePicker` (spinner on iOS, default on web)
- `contextLabel` shows a live preview sentence below the picker (e.g. "Capsule unlocks for everyone on Jun 30, 2026 at 3:00 PM")
- `optional` prop adds an "enabled" toggle — when off, `onChange(null)` is called
- **Haptics** via `expo-haptics`: Light impact on day/month select and quick presets; Selection feedback on month/year navigation arrows. All no-op on web.
