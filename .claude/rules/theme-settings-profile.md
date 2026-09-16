---
paths:
  - "src/context/ThemeContext.tsx"
  - "src/lib/accent*"
  - "src/components/AccentSurface.tsx"
  - "src/components/ColorPicker.tsx"
  - "src/lib/communityLinks.ts"
  - "src/screens/app/SettingsScreen.tsx"
  - "src/screens/app/ProfileScreen.tsx"
  - "src/screens/app/HomeScreen.tsx"
  - "src/navigation/**"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

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

## Settings Screen (`SettingsScreen`)

**Appearance is tier-aware.** The preset swatch grid (`ACCENT_PRESETS`) is always shown. The shared `<ColorPicker>` (`src/components/ColorPicker.tsx`) and the gradient swatch grid (`ACCENT_GRADIENTS`) only render for `isPro`; a non-Pro user sees a single locked "Custom color & gradient themes" row (`disabled` while `entitlementsLoading`) that calls `proGateHit` instead. Tracks a `pending` color (local state) so the user can preview/cancel before committing — picking a gradient calls `setAccentGradient` directly (not staged in `pending`, since a gradient isn't a single hex). Save writes to `users.accent_color` via `ThemeContext.setAccentColor` and navigates back; the original color is passed as `originalValue` to `<ColorPicker>` to show a small "before" swatch. See "Theme System" for the gradient data model.

**Capsule Pro section** (native-only, `Platform.OS !== 'web'`) — reads `isPro` from `useEntitlements()`. Non-Pro: an "Upgrade to Capsule Pro" button (`presentPaywall()`) + a "Restore Purchases" row (`restorePurchases()`, toasts the result). Pro: a "Manage Subscription" row (`presentCustomerCenter()` — the RevenueCat-hosted manage/cancel/refund UI) instead. The Pro pitch line here is capability-only ("Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export") — no full-res/original-quality claim; see "Monetization" for the full purchase stack.

**Community section** — three `SettingsRow`s (`Linking.openURL`) to the Discord invite, Instagram, and TikTok, using `logo-discord`/`logo-instagram`/`logo-tiktok` Ionicons. The URLs live in **`src/lib/communityLinks.ts`** (`DISCORD_URL`/`INSTAGRAM_URL`/`TIKTOK_URL`) — the single source of truth, also used by Onboarding step 5's "Join our Discord community" link. Update a handle there and both surfaces follow.

## ColorPicker (`src/components/ColorPicker.tsx`)

Controlled component. Props: `{ value: string; onChange: (hex) => void; originalValue?: string }`. Internals:
- 2D saturation/brightness panel: two stacked `LinearGradient`s (white→hue horizontal, transparent→black vertical)
- Hue slider: full-spectrum `LinearGradient` strip
- Touch via `onStartShouldSetResponder` / `onResponderMove` — `locationX`/`locationY` from `nativeEvent` are relative to the touched view (no page coordinate math needed)
- Hex input for precision — updates the HSV state on valid 6-char hex
- Exports `hsvToHex(h, s, v)` and `hexToHsv(hex)` for callers that need raw conversions

## Profile Screen (`ProfileScreen.tsx`)

Hero card design with accent-colored glow:
- 3px accent glow bar at top of card, avatar ring with accent border
- Stats row: Capsules, Unlocked, Friends — counts fetched from `capsule_members` with joins
- Action rows: Edit Profile (opens inline modal), Appearance (navigates to Settings)
- Sign out as a text link at bottom
- Uses `useCachedFetch<ProfileData>('profile', ...)` — skeleton shown on first load only
