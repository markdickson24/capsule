# Capsule Pro Features — Design Spec

**Date:** 2026-07-21
**Status:** Approved (design), pending spec review
**Scope:** Build the three remaining unbuilt Capsule Pro perks and correct the paywall/marketing copy to match what actually ships.

## Goal

Turn the paid "Capsule Pro" tier from "un-forgeable but mostly invisible" into something a user can *see* and *use*. Three perks, plus a copy correction:

1. **Pro badge** — a visible marker that a user is on Pro.
2. **Bulk ZIP export** — download a whole unlocked capsule as one `.zip`.
3. **Premium palettes** — free users pick from curated presets only; Pro unlocks the custom color picker + gradient accents.
4. **Remove the full-res / "original-quality" promise** everywhere (paywall, Settings copy, `docs/monetization-strategy.md`). We resize every upload to 1920px; we do not store or export originals, and we ship no filters. The marketing must stop implying otherwise.

Enforcement note: all three perks are **cosmetic / client-side gates** (like video length), not security boundaries — nobody can leak another user's data by faking Pro here. The one server touch is a new nullable `users.accent_gradient` column. `subscription_tier` remains the un-forgeable source of truth (guarded by the `guard_subscription_tier` trigger).

---

## Feature A — Pro badge

### What
A small, reusable `<ProBadge>` pill: accent-tinted background, a `sparkles` (or `star`) Ionicon + the text `PRO`, `accessibilityLabel="Capsule Pro"`. One component, used in four places.

### Data source
`users.subscription_tier` is a **client-readable** column (`'free' | 'pro'`). Two read paths:
- **Own profile:** use `useEntitlements().isPro` (already reactive, no fetch).
- **Other users / capsule owners:** read `subscription_tier` off the relevant `users` row / owner embed.

Show the badge iff the subject's tier is `'pro'`.

### Placements
| Screen | Where | Tier source |
|---|---|---|
| `ProfileScreen` (own) | Right of the display name (hero card) | `useEntitlements().isPro` |
| `PublicProfileScreen` (others) | Right of the display name | add `subscription_tier` to the profile `select` (line ~212) |
| `HomeScreen` capsule cards | Next to the owner's name/attribution on each card | add owner `subscription_tier` to the Home capsule query's `owner` embed |
| `CapsuleDetailScreen` members list | Next to the **owner** row only | `ownerTier` already in render scope (owner embed exists) |

Only the **owner** is badged in the capsule contexts (per decision — not every Pro member).

### Files
- Create `src/components/ProBadge.tsx`.
- Modify `ProfileScreen.tsx` (hero name row), `PublicProfileScreen.tsx` (name row + select), `HomeScreen.tsx` (card owner attribution + query), `CapsuleDetailScreen.tsx` (members list owner row).

### No DB change. No server change.

---

## Feature B — Bulk ZIP export

### What
An **"Export capsule"** action, owner-only, shown only when **the owner is Pro** and the capsule is **unlocked**. Downloads every media item in the capsule (photos at stored 1920px, videos as-is), zips them, and hands the user the file (native share sheet / web download).

### Gating
- Visible only to the owner (`isOwner`) on an **unlocked** capsule (media is signable).
- If the owner taps it while **not Pro** → `proGateHit({ currentUserIsHost: true, title: 'Export your capsule', ownerMessage: 'Upgrade to Capsule Pro to download this whole capsule as a zip.' })` → limit sheet → paywall. (We still *show* the row to a non-Pro owner so the perk is discoverable; tapping upsells.)
- Not shown to guests at all.

### Flow
1. Collect signed URLs for all media (the screen already signs them in `fetchPhotos` — reuse `MediaItem.signedUrl` / `alt`; skip nothing, include videos).
2. Show a progress modal ("Preparing your download… n / N").
3. Download each remote file into a temp working dir.
4. Zip the dir → `<capsule title>.zip`.
5. Deliver: native → `expo-sharing` `shareAsync`; web → blob `<a download>`.
6. Clean up the temp dir.

### Zip engine (decision)
- **Native:** `react-native-zip-archive` — zips **from disk** (streams files), which is safe for a 1000-photo / large-video capsule where an in-memory zip would OOM the phone. **This is a native module → it requires a fresh dev/EAS build to run on device** (same class as `trimVideo`/dual-camera; it will be a no-op/unavailable in Expo Go). Add via `npx expo install react-native-zip-archive` (autolinks; no config plugin needed) and guard the import so web/Expo Go degrade gracefully.
- **Web:** `fflate` (pure JS) — zip the downloaded `Uint8Array`s in memory; browsers have the headroom and there is no native module on web.

A shared `src/lib/exportCapsule.ts` module exposes one `exportCapsule({ title, items, onProgress })` with a platform split (`.native.ts` / `.web.ts` / `.ts` fallback — same idiom as `purchases`/`usePushNotifications`).

### Build/verification caveat (call out to user)
The native path **cannot be verified without a new EAS/dev build** — I can write and self-review the code, but "runs on device" is gated on a build the user triggers. Web path is verifiable in the browser.

### Files
- Create `src/lib/exportCapsule.native.ts`, `src/lib/exportCapsule.web.ts`, `src/lib/exportCapsule.ts` (fallback re-export of web).
- Create `src/components/ExportProgressModal.tsx` (or inline in CapsuleDetail — implementer's call; prefer a small component).
- Modify `CapsuleDetailScreen.tsx` (add the owner action + wiring).
- Modify `package.json` (deps: `react-native-zip-archive`, `fflate`, and `expo-sharing` if not already present).

---

## Feature C — Premium palettes (presets-only free / custom + gradient Pro)

### What (this is a deliberate takeaway from current free behavior)
Today **every** user has the full custom HSV `ColorPicker`. New model:
- **Free:** a curated **preset palette** only (~10 solid swatches). The free-form custom picker and gradients are Pro-gated.
- **Pro:** the full custom `ColorPicker` **+ gradient accents** (2-color presets).

### Grandfathering (decision)
Existing free users who already set a custom accent color **keep it** — we never forcibly reset or snap their color. The gate applies to *new* selections: a free user opening Settings sees the preset swatches (their current color highlighted if it matches one; if it doesn't, it still renders as their live accent but to *change* it they pick a preset or upgrade). No migration touches existing `accent_color` values.

### Preset palette
Define `src/lib/accentPresets.ts` — `ACCENT_PRESETS: string[]` (~10 curated hexes) including the brand pink/red `#FC6A5B` and the classic default `#FF6B35`. Pure data module (no network), importable by both `SettingsScreen` and the picker.

### Gradient accents
- **Storage:** new nullable column `users.accent_gradient` (text, format `"#hexA,#hexB"`; null = solid accent). Must `grant select, update (accent_gradient) to authenticated` in the same migration (per the column-grant footgun rule in CLAUDE.md — a new column gets no grant by default and would 403 the whole `select`).
- **ThemeContext:** add `accentGradient: [string, string] | null` to context + a `setAccentGradient(value: [string,string] | null)` setter (persists to `users.accent_gradient`, mirrors the existing cache-through pattern; add to `cap_theme_v1` cache payload). When a gradient is set, `accentColor` (the solid token used app-wide) resolves to `accentGradient[0]` so every existing consumer keeps working with a sensible solid.
- **Rendering scope (decision — key surfaces only, not app-wide):** render the gradient via `expo-linear-gradient` on a small, high-visibility set:
  1. `ProfileScreen` hero glow bar (the 3px accent bar).
  2. The camera **center tab button** (`CustomTabBar`).
  3. The Settings "Save Color" primary button (as a live preview of the chosen gradient).

  Everywhere else uses the solid `accentColor` (= `accentGradient[0]`). This keeps the feature from touching every screen while still making Pro visibly "premium." Provide a tiny helper/component `src/components/AccentSurface.tsx` (renders a `LinearGradient` when `accentGradient` is set, else a solid `View`/background) so the three sites share one implementation.

### Settings UI
`SettingsScreen` Appearance section becomes tier-aware:
- **Free:** render a preset swatch grid (from `ACCENT_PRESETS`). Below it, a locked "Custom color & gradients" row with a `sparkles` icon → `proGateHit({ currentUserIsHost: true, title: 'Custom colors', ownerMessage: 'Upgrade to Capsule Pro for custom colors and gradient themes.' })`.
- **Pro:** render the preset grid **+** the full `<ColorPicker>` **+** a gradient section (a row of 2-color gradient preset swatches; selecting one calls `setAccentGradient`, selecting a solid preset or using the picker calls `setAccentGradient(null)` + `setAccentColor`).
- Gradient presets: define `ACCENT_GRADIENTS: [string,string][]` in `accentPresets.ts` (~6 tasteful pairs).

Gate reads: use `useEntitlements().isPro`, and **respect the entitlements-loading rule** — while `loading`, don't lock the UI (show the Pro affordances optimistically or a neutral state), gate only on `!loading && !isPro`, so a genuine Pro user is never briefly downgraded.

### Files
- Create `src/lib/accentPresets.ts`, `src/components/AccentSurface.tsx`.
- Modify `ThemeContext.tsx` (gradient state/setter/cache), `SettingsScreen.tsx` (tier-aware Appearance UI), `ProfileScreen.tsx` (hero glow → AccentSurface), `AppNavigator.tsx` (`CustomTabBar` camera button → AccentSurface).
- Migration: `supabase/migrations/2026072114xxxx_accent_gradient.sql` (add column + grant). Apply to prod via `apply_migration`.
- Update `src/types/database.ts` `User` type (`accent_gradient: string | null`).

---

## Feature D — Remove full-res / original-quality claims

Scrub every promise of "original quality" / "full-res originals" / "5GB" storage-of-originals framing, since we resize to 1920px and store nothing larger. Replace with honest "download your whole capsule" (export) language.

### Sites
- `SettingsScreen.tsx` line ~104–106 helper: "…and full-quality export." → e.g. "Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export."
- `docs/monetization-strategy.md`: the Pro feature matrix (line ~194 and matrix rows ~202–214) — remove "original-quality export" / any "original/full-res" wording; keep "export" but as "download your capsule (zip)". Remove filters if mentioned. Remove/repair the "5GB … original-quality" line so it doesn't promise stored originals.
- **Paywall (RevenueCat, dashboard):** the hosted paywall draft's feature bullets — remove any "original quality"/"full-res" bullet; reword to "Download your whole capsule." This is a dashboard edit (edit-paywall-ai / manual), left as an **unpublished draft** for the user to publish (same as the prior paywall redesign). Not a code change; note it in the plan as a manual step.

---

## Cross-cutting constraints (verbatim, bind every task)

- **Design tokens:** background `#0A0A0A`, surface `#1A1A1A`, border `#2A2A2A`, text primary `#FFFFFF`, secondary `#888888`, muted `#555555` (decoration only — never body text). Accent = `useTheme().accentColor` (never hardcode `#FF6B35` in app screens; static fallback in `StyleSheet.create` is fine).
- **Icon-only touchables** need `accessibilityRole="button"` + `accessibilityLabel`.
- **No `Alert.alert`** for confirms on web — use `ConfirmModal`. Errors as inline `<Text>`. Any user-initiated mutation that fails must `toast.show(...)`.
- **`expo-file-system`** APIs are native-only — guard `Platform.OS !== 'web'`, import from `expo-file-system/legacy`.
- **Platform split idiom:** `.native.ts` real / `.web.ts` stub / bare `.ts` fallback re-exporting web (as `purchases`/`usePushNotifications` do).
- **New `users` column → `grant select (col)` (and `update` where the client writes it) to `authenticated` in the same migration.** Missing grant 403s the entire `select`.
- **Entitlements-loading rule:** any gate on the current user's own `isPro` must fire only on `!loading && !isPro`.
- **`getSession()` never on web / in screens** — use `sessionStore.get()`.
- **Prod migrations:** apply via `apply_migration`; verify live with a rolled-back fixture; **no destructive SQL on prod without explicit approval** (memory). The gradient migration is additive (add column + grant) — safe.
- **No test framework** in this repo (only `recurrence.test.ts` via `tsx`). "Tests" for new pure modules (`accentPresets`, `exportCapsule` zip assembly on web via `fflate`) are plain `node:assert` + `tsx` scripts where they add value; RN screen wiring is verified by reading + (where possible) the web build, not unit tests. Plans must be honest about this rather than inventing a test harness.
- **Update `CLAUDE.md`** in the same change (project skill): new component/lib/column/context field all need doc entries.

---

## Out of scope (YAGNI)
- No filters / editing tools.
- No storage of original-resolution uploads (explicitly the opposite — Feature D).
- No Android ZIP device verification beyond code (no Android build pipeline configured here).
- No badging of non-owner Pro members in capsule contexts.
- No forced migration of existing custom accent colors.
- Gradient rendering is **not** extended app-wide in this pass (only the three named surfaces).

## Build order
A (badge — small, self-contained) → C (palettes — DB + theming) → B (export — needs native module + build) → D (copy scrub, can fold into each). D's paywall edit is a manual dashboard step at the end.
