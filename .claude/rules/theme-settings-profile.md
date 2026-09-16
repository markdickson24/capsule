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

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Theme System

Accent color is user-customizable. All screens use `useTheme()` from `src/context/ThemeContext.tsx` — never hardcode `#FF6B35` in app screens.

```tsx
const { accentColor, onAccentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient } = useTheme();
```

`ThemeProvider` wraps `NavigationContainer` in `App.tsx`. Loads `users.accent_color` **and `users.home_layout`** from Supabase on login (one query), resets both to defaults on logout. `setAccentColor`/`setHomeLayout` update state instantly, persist in the background.

⚠️ **Never hardcode `'#fff'` for text/icons on an accent background — use `onAccentColor`.** Pro users pick arbitrary colors; white on a pale accent is invisible (white on `#FFF9C4` is **1.07:1**; the shipped palette measured **1.91–4.20:1**, worst on teal/green/amber). `onAccentColor` (**`src/lib/accentContrast.ts`**, `onAccent(hex)`) flips to near-black `#0A0A0A` above relative luminance **0.38**, else stays `#FFFFFF`.

**Threshold is 0.38, deliberately not the widely-copied 0.179** (`polished`'s `readableColor` value, which maximizes the WCAG ratio rather than legibility — at 0.179 seven of ten presets, including brand coral, flip to dark text). 0.38 (Andrew Somers/Myndex, APCA author: "middle contrast for TEXT under averaged, typical conditions") flips exactly the three unreadable presets plus pale custom colors while keeping white on dark custom colors (navy). Uses simple 2.2-gamma luminance, not WCAG's piecewise curve. `contrastRatio()` in the same module is WCAG-correct but exists only for tests/reporting — never makes the flip decision.

⚠️ **Known-open:** the seven presets keeping white sit at **2.84–4.20:1**, under AA's 4.5 — fixes unreadability, not compliance (deliberate brand-preservation call, see HANDOFF's button-contrast item). Don't lower the threshold to "fix" this without revisiting that decision.

**Call-site rules:** conditionally-accent surfaces (mode chips, selected capsule chips, upvote pills, invite tabs) gate the override on the same condition as the background (else they sit on a dark surface and must stay white). Components receiving `accentColor` as a prop rather than the hook (`MemberBubble` in `GroupDetailScreen`, `DatePicker`/`RecurrenceAnchorPicker`) call `onAccent(accentColor)` locally instead of growing their prop signature. Bare accent surfaces with no content (tab underline, progress dots, profile hero glow, export progress bar) need nothing.

When `accentGradient` is set, `onAccentColor` decides on the gradient's **lighter stop** (`onAccentForGradient`) — text must stay readable at the lightest point, and `accentColor` only tracks the first stop.

**Accent gradients (Pro cosmetic).** `accentGradient: [string, string] | null` (from `users.accent_gradient`, via `parseGradient`/`serializeGradient` in `src/lib/accentPresets.ts`) — null = solid, default for everyone. `setAccentGradient(g)` also writes `accent_color = g[0]` to keep the solid token coherent; picking a solid via `setAccentColor` clears `accentGradient` to null. **`src/lib/accentPresets.ts`**: `ACCENT_PRESETS` (10 solids, free) and `ACCENT_GRADIENTS` (6 pairs, Pro-only) — `SettingsScreen` shows presets to everyone, gates `<ColorPicker>` and gradient swatches behind `isPro` (locked row + `proGateHit`). **Grandfathered, never reset** — no migration/trigger touches an existing `accent_color`/`accent_gradient`, so a pre-shipped custom color or downgraded former-Pro user keeps it. **`src/components/AccentSurface.tsx`** — drop-in accent `View`, renders `LinearGradient` when set else solid; used on exactly **two** surfaces (`ProfileScreen`'s hero glow bar, the camera tab button in `AppNavigator`'s `CustomTabBar`) — elsewhere reads solid `accentColor` by design. In `SettingsScreen`, Pro users preview gradients directly on the swatches (persist immediately on tap); "Save Color" previews only the solid `pending` color.

**No flash of default orange on launch.** Fixed with a persistent per-user cache (`cap_theme_v1:<userId>`, mirroring `sessionStore.ts`'s `readWebSessionSync`): <!-- History: accentColor/homeLayout used to start hardcoded and only update after the post-paint Supabase fetch resolved, so every launch briefly showed the wrong color. --> web feeds a synchronous `localStorage` read directly into the `useState` lazy initializers (`sessionStore.get()` is already synchronous there — no flash at all); native's `loadPrefs` does a fast local `AsyncStorage` read (no network, single-digit ms) before the Supabase fetch. `setAccentColor`/`setHomeLayout` write through to this cache too — fixes it only from the *second* launch onward per user.

**Home layout preference** (`homeLayout: 'list' | 'grid'`, default `'list'`) — `HomeScreen`'s capsule `FlatList` renders one-column comfortable cards (`list`) or two-column compact (`grid`), toggled in the Home header. `FlatList` takes `key={homeLayout}` (forces remount on `numColumns` change) + `columnWrapperStyle` only in grid. `CapsuleCard` takes a `variant` prop (grid drops description, shrinks). Per-user, synced like `accent_color`.

**`CountdownBadge` (`HomeScreen`)** — the card query selects `unlock_mode` alongside `unlock_at`/`status` so a locked `proximity` capsule renders "Unlocks together" (people icon) instead of counting down to `unlock_at` (a placeholder never used to actually unlock proximity capsules — see "Proximity Unlock"); `both` keeps the real countdown (genuine date). Badge ticks live via self-rescheduling `setTimeout` (per-second under an hour: `Nd Nh` → `Nh Nm` → `Nm Ns` → `Ns` left; per-minute beyond); at zero shows "Unlocking…"/"Starting…" until the flip lands. **Home self-refreshes at the unlock moment** (`useEffect` on `allCapsules` wakes ~at the soonest locked time/`both` capsule's `unlock_at`, rechecks every 15s past — cron flips up to ~60s late — only within 24h of unlock), complementing the `AppState` foreground refetch (see `CapsuleDetailScreen`'s unlock reconciliation).

**Auth screens (LoginScreen, SignUpScreen, WelcomeScreen) keep static `#FF6B35`** — no user is loaded yet.

**For `StyleSheet.create()`:** keep `#FF6B35` as a static fallback; apply `accentColor` as an inline JSX override: `style={[styles.btn, { backgroundColor: accentColor }]}`.

## Settings Screen (`SettingsScreen`)

**Appearance is tier-aware.** Preset swatch grid (`ACCENT_PRESETS`) always shown; `<ColorPicker>` (`src/components/ColorPicker.tsx`) and gradient grid (`ACCENT_GRADIENTS`) only render for `isPro` — non-Pro sees a locked "Custom color & gradient themes" row (`disabled` while `entitlementsLoading`) calling `proGateHit`. Tracks a `pending` color (local state) for preview/cancel before commit — a gradient pick calls `setAccentGradient` directly (not staged, not a single hex). Save writes `users.accent_color` via `ThemeContext.setAccentColor` and navigates back; original color passed as `originalValue` to `<ColorPicker>` for a "before" swatch.

**Capsule Pro section** (native-only, `Platform.OS !== 'web'`) — reads `isPro` from `useEntitlements()`. Non-Pro: "Upgrade to Capsule Pro" (`presentPaywall()`) + "Restore Purchases" (`restorePurchases()`, toasts result). Pro: "Manage Subscription" (`presentCustomerCenter()`). Pitch is capability-only ("Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export") — no full-res/original-quality claim.

**Community section** — three `SettingsRow`s (`Linking.openURL`) to Discord/Instagram/TikTok (`logo-discord`/`logo-instagram`/`logo-tiktok` Ionicons). URLs live in **`src/lib/communityLinks.ts`** (`DISCORD_URL`/`INSTAGRAM_URL`/`TIKTOK_URL`) — single source of truth, also used by Onboarding step 5's Discord link.

## ColorPicker (`src/components/ColorPicker.tsx`)

Controlled. Props: `{ value: string; onChange: (hex) => void; originalValue?: string }`.
- 2D saturation/brightness panel: two stacked `LinearGradient`s (white→hue horizontal, transparent→black vertical)
- Hue slider: full-spectrum `LinearGradient` strip
- Touch via `onStartShouldSetResponder`/`onResponderMove` — `locationX`/`locationY` from `nativeEvent` are relative to the touched view
- Hex input updates HSV state on a valid 6-char hex
- Exports `hsvToHex(h, s, v)` and `hexToHsv(hex)` for raw conversions

## Profile Screen (`ProfileScreen.tsx`)

Hero card with accent glow:
- 3px accent glow bar at top, avatar ring with accent border
- Stats row: Capsules, Unlocked, Friends (from `capsule_members` joins)
- Action rows: Edit Profile (inline modal), Appearance (→ Settings)
- Sign out as a text link at bottom
- Uses `useCachedFetch<ProfileData>('profile', ...)` — skeleton shown on first load only
