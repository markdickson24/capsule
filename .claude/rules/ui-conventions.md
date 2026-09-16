---
paths:
  - "src/**/*.tsx"
  - "App.tsx"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## iOS / Web Layout Gotchas

- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `flex: 1` + `aspectRatio`.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — guard with `Platform.OS !== 'web'`. Use the `expo-file-system/legacy` import path.
- `Alert.alert` silently no-ops for multi-button dialogs on web (the callback-gated action never runs) — use inline `<Text>` error state and `<ConfirmModal>` (`src/components/ConfirmModal.tsx`) for confirmations.
- `DateTimePicker` with `display="spinner"` renders the native iOS wheel. Use `Platform.OS === 'web' ? 'default' : 'spinner'`.
- Import `SafeAreaView` from `react-native-safe-area-context`, never `react-native` (deprecated). Normal screens get the provider from `NavigationContainer`. **Inside a `<Modal>`** (a separate native view hierarchy the outer provider can't reach) wrap content in its own `<SafeAreaProvider>` or insets come back zero.
- **Don't use `KeyboardAvoidingView`** — broken on iOS under the New Architecture (`newArchEnabled: true`), silently fails to move content above the keyboard. Track keyboard height yourself: `Keyboard.addListener('keyboardWillShow'/'keyboardWillHide', e => setKbHeight(e.endCoordinates?.height ?? 0))` (`keyboardDidShow/Hide` on Android), then offset — `transform: [{ translateY: -kbHeight }]` (`PreviewScreen`'s caption panel) or `paddingBottom: kbHeight` on a `justifyContent:'flex-end'` overlay (`CapsuleDetailScreen`'s `MediaViewerModal` caption editor, where KAV also can't measure its frame origin inside a `<Modal>`). Any new bottom-of-screen text field needs this pattern.
<!-- History: this bit both caption fields — a plain screen and a modal — before being fixed. -->

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

**`#555555` (muted) vs. `#888888` (secondary):** `#555555` on `#0A0A0A` is ≈2.5:1 — below WCAG AA (4.5:1). **Reserve `#555555` for true decoration** (uppercase micro-labels, section headers, "(optional)" annotations, divider words, inactive icon tint). **Real content — dates, counts, empty-state copy, hint text, button labels — needs `#888888` or brighter** (≈5:1, passes AA). Default new muted text to `#888888` unless clearly decorative.

**Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`** (else VoiceOver/TalkBack just reads "button") — anywhere the only content is an `Ionicons` glyph (close ✕, camera controls, `⋯` overflow, swap/dismiss/decline). A `Text`-child button already has an accessible name for free. Tab labels and countdown/badge `Text` also need `maxFontSizeMultiplier` (≈1.3) to avoid clipping at large Dynamic Type.

## Image Loading (`expo-image`)

Use `Image` from `expo-image`, never `react-native` — native disk + memory caching.

```tsx
import { Image } from 'expo-image';

// expo-image uses `source` as string (not { uri }), `contentFit` (not resizeMode)
<Image source={url} contentFit="cover" transition={200} />
```

- `transition={200}` for fade-in
- `contentFit` replaces `resizeMode`: `"contain"` for full-screen viewer, `"cover"` for thumbnails
- Applied in: CapsuleDetailScreen (viewer + grid + gallery), ProfileScreen (Avatar), PreviewScreen, OnboardingScreen

## Animations (`src/lib/animations.ts`)

Built-in `Animated` API only (no `react-native-reanimated`).

- `useFadeIn(delay?, duration?)` — opacity 0→1
- `useSlideUp(delay?, duration?)` — opacity 0→1 + translateY 20→0
- `useListItemEntrance(index, baseDelay?)` — staggered, 60ms/item, caps at index 8

All three use `useIsFocused()` but animate **once per screen instance** (`hasAnimatedRef`) — first focus only; later re-focuses snap to final state (avoids replaying a ~300–780ms entrance over already-instant `useCachedFetch` data). A true unmount+remount replays it.

**Rules of Hooks:** call before any early return (e.g. `if (loading) return <Skeleton />`) — moving them after one causes "Rendered more hooks than during the previous render" errors.

**Screen transitions** (`AppNavigator.tsx`): Tabs/Onboarding `animation: 'fade'`; Settings `animation: 'slide_from_bottom'`; Preview `animation: 'none'` (instant camera preview); others default `slide_from_right`.

## Skeleton Loaders (`src/components/Skeleton.tsx`)

Shimmer placeholders for `useCachedFetch` screens.

- `SkeletonBox` — base, configurable width/height/borderRadius, `Animated.loop`+`interpolate` shimmer
- `SkeletonCard` — HomeScreen capsule card placeholder
- `SkeletonProfileCard` — ProfileScreen hero card placeholder
- Colors: `#1A1A1A` base, `#2A2A2A` shimmer highlight

## Retry on slow loads (`useLoadingTimeout` + `RetryPrompt`)

Screens fetching on mount/focus show a retry affordance after 8 seconds instead of an indefinite spinner (RN's `fetch()` has no timeout; dead connections can hang 30s–2min).

- **`src/hooks/useLoadingTimeout.ts`** — `useLoadingTimeout(loading, timeoutMs = 8000)` → `{ timedOut, reset }`. Arms an 8s timer while `loading`, resets on `false`. **Every `onRetry` must call `reset()` before refetching** — a retry tap doesn't produce a `loading: false→true` edge, so the timeout won't re-arm otherwise.
- **`src/components/RetryPrompt.tsx`** — `{ onRetry, message?, compact? }`. Inline message + "Retry" button, dark theme + `accentColor` from `useTheme()`. `compact` for small contexts (`AwardsSection`'s `loadingBox`, `PublicProfileScreen`'s `InviteToCapsuleModal`).
- **Wiring:** `if (loading) { if (timedOut) return <RetryPrompt onRetry={...} />; return <...skeleton...>; }` — replaces, not overlays, the skeleton.
- **`useCachedFetch`'s `refresh(force?: boolean)`** — fetches are deduped per key via a module-level in-flight registry, so bare `refresh()` on a hung fetch just re-awaits the same stuck promise. `refresh(true)` discards the stale entry first. Retry handlers must call `refresh(true)`, never bare `refresh()`.
- **Hand-rolled (non-hook) screens** just re-call their fetch on retry, but must replicate however it currently clears `loading` — some internally (`AwardsSection.fetchCategories`, `FriendsScreen.load`), others via caller `.finally(() => setLoading(false))` (`ManageMembersScreen.fetchMembers`, `PublicProfileScreen.load`, `EditCapsuleScreen.loadCapsule`). Check before assuming.
- **Applied to:** HomeScreen, NotificationsScreen, ProfileScreen, GroupDetailScreen (`groupLoading` gate only — `capsulesLoading`'s `ListEmptyComponent` spinner is non-blocking and excluded), CapsuleDetailScreen (cold-load skeleton only), AwardsSection, FriendsScreen, EditCapsuleScreen, ManageMembersScreen, PublicProfileScreen + `InviteToCapsuleModal`.
- **Not touched:** `LoadingBrandScreen` in `AppNavigator.tsx`'s route-resolution gate — a different kind of loading, with its own 5s fallback to `Tabs`.

## ConfirmModal (`src/components/ConfirmModal.tsx`)

Cross-platform confirm dialog — **use instead of `Alert.alert`** (a multi-button `Alert.alert` silently no-ops on web). Controlled: `{ visible, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel }`. `destructive` colors the confirm button `#FF3B30`; `loading` swaps the label for a spinner and disables both buttons. Caller owns `visible` state and the async work. Used in `EditCapsuleScreen` and `CapsuleDetailScreen` delete confirmations.

## DatePicker (`src/components/DatePicker.tsx`)

Shared, controlled; used by `CreateScreen`/`EditCapsuleScreen`. Props: `{ label, value, onChange, optional?, contextLabel? }`.

- Collapsed state shows the selected date/time with a "change" link; tap to expand inline
- Quick presets: "In 1 month", "In 3 months", "In 6 months", "In 1 year"
- **Custom calendar grid** (no external library):
  - Day view: 7-column grid, accent circle on selected day, accent border on today, past days dimmed (`#333`)
  - Tappable month/year header ("June 2026 ▼") → month picker mode
  - Month picker: 4×3 month grid with year navigation arrows (◀ ▶)
- Collapsible time row, native `DateTimePicker` (spinner on iOS, default on web)
- `contextLabel` — live preview sentence (e.g. "Capsule unlocks for everyone on Jun 30, 2026 at 3:00 PM")
- `optional` adds an "enabled" toggle; off → `onChange(null)`
- **Haptics** via `expo-haptics`: Light on day/month select and quick presets; Selection on month/year nav arrows. No-op on web.
