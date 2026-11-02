# UI, theme and shared components

Part of the Capsule architecture docs, indexed from `CLAUDE.md`. Describes the system as it is now; update in the same change that alters it.

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

---

## Theme System

The primary accent color is user-customizable. All app screens use `useTheme()` from `src/context/ThemeContext.tsx` — never hardcode `#FF6B35` in app screens.

```tsx
const { accentColor, onAccentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient } = useTheme();
```

`ThemeProvider` wraps `NavigationContainer` in `App.tsx`. It loads `users.accent_color` **and `users.home_layout`** from Supabase on login (one query) and resets both to defaults on logout. `setAccentColor` / `setHomeLayout` update state instantly and persist to Supabase in the background.

⚠️ **Never hardcode `'#fff'` for text or icons sitting ON an accent background — use `onAccentColor`.** Pro users pick arbitrary custom colors, and white on a pale accent is invisible (white on `#FFF9C4` is **1.07:1**). Even the shipped palette failed: white measured **1.91–4.20:1** on all 10 presets, worst on teal/green/amber. `onAccentColor` comes from **`src/lib/accentContrast.ts`** (`onAccent(hex)`), which flips to near-black `#0A0A0A` when the accent's relative luminance exceeds **0.38**, and stays `#FFFFFF` otherwise.

**The threshold is 0.38, and it is deliberately NOT the widely-copied 0.179.** That constant (used by `polished`'s `readableColor`) is the luminance where contrast-with-black equals contrast-with-white, so it *maximizes the WCAG ratio* — a different goal than legibility. At 0.179, **seven of the ten presets flip to dark text, including the brand coral**, changing every primary button in the app. 0.38 comes from [Andrew Somers (Myndex)](https://gist.github.com/Myndex/e1025706436736166561d339fd667493), author of APCA and lead of WCAG 3's contrast work: *"0.38 Y is about middle contrast for TEXT under averaged, typical conditions."* It flips exactly the three unreadable presets plus any pale custom color, and — unlike a naive "always use dark text" fix — correctly **keeps white on dark custom colors** like navy. Luminance uses the simple 2.2 gamma that 0.38 is calibrated against, not WCAG's piecewise curve (they agree to ~0.005 for real colors anyway; the threshold is what matters). `contrastRatio()` in the same module *is* WCAG-correct and exists for tests/reporting only — it never makes the flip decision.

⚠️ **Known-open:** the seven presets that keep white still sit at **2.84–4.20:1**, under AA's 4.5. This fixes unreadability, not compliance — a deliberate product call to preserve the brand look (see HANDOFF's button-contrast item). Not a bug to "fix" by lowering the threshold without that decision being revisited.

Two call-site rules. **Conditionally-accent surfaces** (mode chips, selected capsule chips, upvote pills, invite tabs) must gate the override on the same condition as the background — they sit on a dark surface otherwise and must stay white. **Components that receive `accentColor` as a prop** rather than from the hook (`MemberBubble` in `GroupDetailScreen`, the `DatePicker`/`RecurrenceAnchorPicker` sub-components) call `onAccent(accentColor)` locally instead of growing their prop signatures. Bare accent surfaces with no content on them (tab underline, progress dots, the profile hero glow, the export progress bar) need nothing.

When an `accentGradient` is set, `onAccentColor` decides on the gradient's **lighter stop** (`onAccentForGradient`) — text has to stay readable at the accent's lightest point, and `accentColor` only tracks the *first* stop, so the solid path alone would under-report how light the surface actually gets.

**Accent gradients (Pro cosmetic).** `accentGradient: [string, string] | null` (from `users.accent_gradient`, parsed via `parseGradient`/`serializeGradient` in `src/lib/accentPresets.ts`) — null means solid, the default for everyone. `setAccentGradient(g)` also writes `accent_color = g[0]` in the same update so the app-wide solid token stays coherent for every screen that only reads `accentColor`; picking a plain solid via `setAccentColor` clears `accentGradient` back to null. **`src/lib/accentPresets.ts`** is the source of the palette: `ACCENT_PRESETS` (10 solids, free for everyone) and `ACCENT_GRADIENTS` (6 two-color pairs, Pro-only). `SettingsScreen`'s Appearance section shows the preset swatches to everyone; the custom `<ColorPicker>` and the gradient swatches are gated behind `isPro` (a locked row + `proGateHit` for non-Pro, same pattern as the other tier gates — see "Monetization"). **Grandfathered, never reset:** there's no migration or trigger that touches an existing `accent_color`/`accent_gradient`, so a user who set a custom color before this shipped (or a downgraded former-Pro user) keeps it. **`src/components/AccentSurface.tsx`** is a drop-in replacement for an accent-colored `View`: renders a `LinearGradient` when `accentGradient` is set, else the solid `accentColor` `View`. Used on exactly **two** surfaces — `ProfileScreen`'s hero glow bar and the camera tab button (`AppNavigator`'s `CustomTabBar`); everywhere else in the app still reads solid `accentColor` directly, by design (a gradient on every accent-colored element would be visual noise, not a coherent theme). In `SettingsScreen`, Pro users still *preview* their gradient directly on the gradient swatches themselves — the "Save Color" button intentionally previews the solid `pending` color, since gradient swatches persist immediately on tap (no pending-gradient state).

**No flash of default orange on launch.** `accentColor`/`homeLayout` used to start at their hardcoded defaults and only update once the Supabase fetch resolved inside a `useEffect` (which runs after first paint) — so every launch briefly rendered the wrong color. Fixed with a persistent per-user cache (`cap_theme_v1:<userId>`), mirroring `sessionStore.ts`'s `readWebSessionSync` pattern:
- **Web:** a synchronous `localStorage` read feeds the `accentColor`/`homeLayout` `useState` lazy initializers directly — since `sessionStore.get()` is already synchronously populated at module load on web, this seeds the real cached color before the very first render, so there's no flash at all.
- **Native:** session restore is async, so the user ID isn't known that early. `loadPrefs` instead does a fast local `AsyncStorage` read (no network, single-digit ms) before the Supabase fetch, applying the cached color almost immediately rather than waiting on the network round-trip.
- `setAccentColor`/`setHomeLayout` write through to this cache too, so a manual change is also available instantly on the next launch. Only fixes it from the *second* launch onward per user — the very first launch after a fresh sign-in has nothing cached yet.

**Home layout preference** (`homeLayout: 'list' | 'grid'`, default `'list'`) — `HomeScreen` renders its capsule `FlatList` as one-column comfortable cards (`list`) or two-column compact cards (`grid`), chosen via a small list/grid toggle in the Home header. The `FlatList` takes `key={homeLayout}` (forces remount when `numColumns` changes) and `columnWrapperStyle` only in grid. `CapsuleCard` takes a `variant` prop; the grid variant drops the description and shrinks. Per-user, synced like `accent_color`.

**`CountdownBadge` (`HomeScreen`)** — the card query selects `unlock_mode` alongside `unlock_at`/`status` specifically so a locked `proximity` capsule can render "Unlocks together" (people icon) instead of a countdown to `unlock_at` — that column is a placeholder never used to actually unlock a proximity capsule (see "Proximity Unlock"), so counting down to it is a promise the app breaks. `both` keeps the real countdown since its date is genuine. `CapsuleDetailScreen` already handled this correctly (hides the ring for `proximity`); Home couldn't until it started fetching `unlock_mode`. **The badge ticks live** via a self-rescheduling `setTimeout` (per-second once under an hour remains, so minutes+seconds show — `Nd Nh` → `Nh Nm` → `Nm Ns` → `Ns` left; per-minute beyond); at zero it shows "Unlocking…"/"Starting…" until the status flip lands. **Home self-refreshes at the unlock moment** (a `useEffect` on `allCapsules` that wakes ~at the soonest locked time/`both` capsule's `unlock_at` and re-checks every 15s past it — the cron flips up to ~60s late — engaging only within 24h of unlock), so a card flips to "Unlocked" without a manual refresh even while sitting on the list. This complements the `AppState` foreground refetch (see "CapsuleDetailScreen … unlock reconciliation").

**Auth screens (LoginScreen, SignUpScreen, WelcomeScreen) keep the static `#FF6B35`** — no user is loaded at that point.

**For StyleSheet.create():** keep `#FF6B35` as a static fallback in style definitions. Apply `accentColor` as an inline override in JSX: `style={[styles.btn, { backgroundColor: accentColor }]}`.

---

## iOS / Web Layout Gotchas

- **Never use percentage widths (`width: '33.33%'`) inside a ScrollView on iOS** — they compute to 0. Use `flex: 1` + `aspectRatio`.
- `expo-file-system` APIs (`getInfoAsync`, `uploadAsync`) are native-only — always guard with `Platform.OS !== 'web'`. Use `expo-file-system/legacy` import path.
- `Alert.alert` does not work reliably on web — use inline error state rendered as `<Text>` for errors, and `<ConfirmModal>` (`src/components/ConfirmModal.tsx`) for confirmation dialogs. A multi-button `Alert.alert` silently no-ops on web, so any action gated behind its callback never runs.
- `DateTimePicker` with `display="spinner"` renders the native iOS wheel picker. Use `Platform.OS === 'web' ? 'default' : 'spinner'` for cross-platform.
- Import `SafeAreaView` from `react-native-safe-area-context`, never from `react-native` (the latter is deprecated). For normal screens the provider is supplied by React Navigation's `NavigationContainer`, so no explicit `SafeAreaProvider` is needed. **Inside a React Native `<Modal>` it IS needed** — a `Modal` renders in a separate native view hierarchy the outer provider can't reach, so `SafeAreaView` returns zero insets and content slides under the notch. Wrap the modal's content in its own `<SafeAreaProvider>`.
- **`KeyboardAvoidingView` is broken on iOS under the New Architecture** (this app has `newArchEnabled: true`) — it silently fails to move its content, leaving the input **under the keyboard**. This bit BOTH caption fields (a plain screen *and* a modal). **Don't use `KeyboardAvoidingView`; track the keyboard height yourself** and apply it as an offset: `Keyboard.addListener('keyboardWillShow'/'keyboardWillHide', e => setKbHeight(e.endCoordinates?.height ?? 0))` (use `keyboardDidShow/Hide` on Android), then lift the bottom bar/panel by that height — `transform: [{ translateY: -kbHeight }]` on `PreviewScreen`'s caption panel, or `paddingBottom: kbHeight` on a full-height `justifyContent:'flex-end'` overlay for `CapsuleDetailScreen`'s `MediaViewerModal` caption editor. (The modal case is doubly bad: KAV also can't measure its frame origin inside a `<Modal>`'s separate window — but the manual-height approach handles both.) Any new text field near the bottom of the screen needs this pattern, not KAV.

---

## Onboarding (`OnboardingScreen`)

A 5-step personalized flow ("Onboarding v2" — full design rationale in `designs/ONBOARDING_V2.md`) that runs after new sign-ups. Gated by `users.onboarded_at`:
- AppNavigator first checks a **local flag** (`sessionStore.wasOnboarded(userId)`, an `AsyncStorage` boolean keyed per user — see `markOnboarded`/`wasOnboarded` in `src/lib/sessionStore.ts`). If set, routes straight to `'Tabs'` with **no network round-trip** — this used to block first paint on every launch behind a `users.onboarded_at` query (up to a 5s timeout). The flag is written the moment a `users.onboarded_at` query confirms `true`, and again when the wizard itself completes.
- If the local flag isn't set (first launch, fresh install, or genuinely not yet onboarded), falls back to the original behavior: queries `users.onboarded_at`. If null → `initialRouteName = 'Onboarding'`. Otherwise → `'Tabs'` (and the local flag gets written for next launch). On query error or 5s timeout, falls through to Tabs (don't strand the user).
- `users.onboarded_at` remains the server source of truth — the local flag only exists to skip the round-trip for returning users; nothing in the app currently un-sets `onboarded_at`, so a stale-true local flag isn't a real-world risk.
- `saveProfile()` writes `display_name` + optionally `avatar_url` and stamps `onboarded_at = now()`, then calls `sessionStore.markOnboarded(userId)` followed by `setTourPending()` (arms the new-user coach-mark tour — see "New-User Tour" below). It runs at the end of step 3 (both "Create my capsule" and every skip-to-Home path) — so a user killed mid-wizard before step 3 correctly re-enters it, and one who completed step 3 never does.
- Exits use `navigation.replace('Tabs', …)` (no back stack to the wizard). Bio and accent color are **not** collected here anymore — they live in Edit Profile and Settings.

Steps (state machine inside the one screen; dynamic copy comes from `src/lib/onboardingMoments.ts` — the `MOMENTS` matrix keyed on `OccasionKey`, exporting title seeds, date chips, flavor lines, and invite nudges per occasion):
1. **Name + avatar.** Display name required (max 30). Avatar upload **starts in the background the moment it's picked** (`avatarUrlPromise` ref) so a failure isn't discovered at finish-time; `resolveAvatarUrl()` awaits it, retries once, and degrades to a toast (never blocks completion). A live member-row preview chip renders the name/avatar as they type.
2. **"What are you waiting for?"** Six moment cards (mapping 1:1 to `capsules.occasion`) + an optional 60-char free-text line. Tapping a card advances immediately; typed free text **becomes the capsule title verbatim** (always beats the seed — never rewrite the user's words). Skip → `skipToHome()`.
3. **First capsule, pre-built.** A capsule card with inline-editable title, occasion-aware date chips (first chip pre-selected) + "Pick my own date" (expands the shared `DatePickerField`), and a surprise-mode promise line. "Create my capsule" runs `saveProfile()` then `create_capsule_with_owner(...)` (see "Key RLS Constraints") followed by `set_default_superlatives` best-effort. Always `owner_preview_locked: true`, `unlock_mode: 'time'`, 48h voting.
4. **Notification primer** (forward-only, reached only when a capsule was created). Names the user's capsule + date; "Yes, notify me" calls `requestPushPermission` (the app's only native-prompt call site); "maybe later" sets the `cap_notif_reprime:<userId>` AsyncStorage flag. On web the button is copy-only ("Sounds good").
5. **Sealed ceremony** (forward-only). Lock scale-in + `haptics.success()` + live countdown (30s tick). Actions: **Invite people** (`Share.share` of the `capsule://join/<id>` link; on failure/web falls back to navigating into the capsule where the full invite UI lives), **Add the first photo** (→ Camera tab), or "take me home".

Footer only exists for steps 1–3 (`Back` from 2–3; contextual `Next`/skip). Steps 4–5 render their own primary actions in-body. Don't render placeholder `<View>`s for missing footer buttons or they'll consume row width.

---

## New-User Tour

A one-time coach-mark walkthrough for new users, run once after onboarding completes. Custom-built (no third-party tour library) so it works identically on web and native with no SVG dependency.

- **`TourProvider`/`useTour`/`useTourTarget`/`measureNode`** (`src/context/TourContext.tsx`) — the engine. Mounted in `App.tsx` inside `ThemeProvider` → `SafeAreaProvider`, as a sibling wrapping the navigator. Holds the current step list + index, a registry of target ids → measure refs, and drives `navigationRef` to switch screens between steps. Elements opt in via `useTourTarget(id)`, a callback ref that registers/unregisters itself with the provider on mount/unmount.
- **`TourOverlay`** (`src/components/TourOverlay.tsx`) — renders four dim panels around a `measureInWindow` rect (top/bottom/left/right of the spotlighted element) plus a tooltip card with title/body/Next/Skip. No SVG mask — just four positioned opaque `View`s, so it's identical on web and native.
- **`buildTourSteps(ctx)`** (`src/lib/tourSteps.ts`) — pure, unit-tested step-list builder (no React/RN imports). Two branches: `hasCapsule` → full walkthrough (`capsule-card` → `CapsuleDetail`'s `capsule-countdown`/`-add-media`/`-invite`/`-awards` → back to Home's `home-scan`/`tab:Camera`/`tab:Notifications`/`tab:Profile` → finish); no capsule → shorter join-first path (`home-scan` → `tab:Create` (optional) → `tab:Camera`/`tab:Notifications`/`tab:Profile` → finish). The in-capsule stops target what a **freshly-created, still-locked** capsule actually shows — no post-unlock `AwardsSection`, since a brand-new user's first capsule is always locked.
- **Target ids** — tab bar: `tab:Camera`, `tab:Create`, `tab:Notifications`, `tab:Profile` (`CustomTabBar` in `AppNavigator.tsx`); Home: `home-scan`, `capsule-card`; CapsuleDetail: `capsule-countdown`, `capsule-add-media`, `capsule-invite`, `capsule-awards`. A target that never mounts/measures (e.g. a screen size where an element is offscreen) auto-skips its step rather than hanging.
- **`waitForTarget`** (`src/lib/waitForTarget.ts`) — pure, unit-tested poll loop the provider uses to wait for a newly-navigated screen's target to register before spotlighting it (handles the cross-screen nav timing, since `navigationRef.navigate()` doesn't resolve when the destination has finished mounting).
- **Trigger + persistence** (`src/lib/tourStorage.ts`, `AsyncStorage`, per-install — mirrors `cap_camera_coach_seen`): `OnboardingScreen.saveProfile()` calls `setTourPending()` right after `sessionStore.markOnboarded(userId)` — the true completion point every exit path (create-capsule and every skip-to-Home) hits. `HomeScreen` consumes the flag once on load (`consumeTourPending()`, read-and-delete) and starts the tour only if `cap_tour_seen` isn't already set. `markTourSeen()` is called on finish (last step's Done) or Skip, so the tour never runs twice for the same install.

---

## Settings Screen (`SettingsScreen`)

**Appearance is tier-aware.** The preset swatch grid (`ACCENT_PRESETS`) is always shown. The shared `<ColorPicker>` (`src/components/ColorPicker.tsx`) and the gradient swatch grid (`ACCENT_GRADIENTS`) only render for `isPro`; a non-Pro user sees a single locked "Custom color & gradient themes" row (`disabled` while `entitlementsLoading`) that calls `proGateHit` instead. Tracks a `pending` color (local state) so the user can preview/cancel before committing — picking a gradient calls `setAccentGradient` directly (not staged in `pending`, since a gradient isn't a single hex). Save writes to `users.accent_color` via `ThemeContext.setAccentColor` and navigates back; the original color is passed as `originalValue` to `<ColorPicker>` to show a small "before" swatch. See "Theme System" for the gradient data model.

**Capsule Pro section** (native-only, `Platform.OS !== 'web'`) — reads `isPro` from `useEntitlements()`. Non-Pro: an "Upgrade to Capsule Pro" button (`presentPaywall()`) + a "Restore Purchases" row (`restorePurchases()`, toasts the result). Pro: a "Manage Subscription" row (`presentCustomerCenter()` — the RevenueCat-hosted manage/cancel/refund UI) instead. The Pro pitch line here is capability-only ("Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export") — no full-res/original-quality claim; see "Monetization" for the full purchase stack.

**Community section** — three `SettingsRow`s (`Linking.openURL`) to the Discord invite, Instagram, and TikTok, using `logo-discord`/`logo-instagram`/`logo-tiktok` Ionicons. The URLs live in **`src/lib/communityLinks.ts`** (`DISCORD_URL`/`INSTAGRAM_URL`/`TIKTOK_URL`) — the single source of truth, also used by Onboarding step 5's "Join our Discord community" link. Update a handle there and both surfaces follow.

---

## Profile Screen (`ProfileScreen.tsx`)

Hero card design with accent-colored glow:
- 3px accent glow bar at top of card, avatar ring with accent border
- Stats row: Capsules, Unlocked, Friends — counts fetched from `capsule_members` with joins
- Action rows: Edit Profile (opens inline modal), Appearance (navigates to Settings)
- Sign out as a text link at bottom
- Uses `useCachedFetch<ProfileData>('profile', ...)` — skeleton shown on first load only

---

## ColorPicker (`src/components/ColorPicker.tsx`)

Controlled component. Props: `{ value: string; onChange: (hex) => void; originalValue?: string }`. Internals:
- 2D saturation/brightness panel: two stacked `LinearGradient`s (white→hue horizontal, transparent→black vertical)
- Hue slider: full-spectrum `LinearGradient` strip
- Touch via `onStartShouldSetResponder` / `onResponderMove` — `locationX`/`locationY` from `nativeEvent` are relative to the touched view (no page coordinate math needed)
- Hex input for precision — updates the HSV state on valid 6-char hex
- Exports `hsvToHex(h, s, v)` and `hexToHsv(hex)` for callers that need raw conversions

---

## ConfirmModal (`src/components/ConfirmModal.tsx`)

Cross-platform confirmation dialog — **use instead of `Alert.alert` for any confirm/cancel decision**, because a multi-button `Alert.alert` silently no-ops on web (the destructive action gated behind its callback never runs).

Controlled component. Props: `{ visible, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel }`. Renders a transparent `Modal` with a dark-theme card. `destructive` colors the confirm button `#FF3B30`; `loading` swaps the confirm label for a spinner and disables both buttons. The caller owns the `visible` state and the async work — keep `visible` true and `loading` true while the action runs, then close. Used for delete confirmation in `EditCapsuleScreen` and `CapsuleDetailScreen`.

---

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

---

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

---

## Skeleton Loaders (`src/components/Skeleton.tsx`)

Shimmer-animated loading placeholders for screens that use `useCachedFetch`.

- `SkeletonBox` — base component with configurable width, height, borderRadius; uses `Animated.loop` with `interpolate` for shimmer
- `SkeletonCard` — capsule card placeholder for HomeScreen
- `SkeletonProfileCard` — hero card placeholder matching ProfileScreen layout (glow bar, avatar circle, name/bio/stats, action rows)
- All use dark theme colors (`#1A1A1A` base, `#2A2A2A` shimmer highlight)

---

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
