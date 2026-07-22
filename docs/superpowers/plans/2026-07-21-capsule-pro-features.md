# Capsule Pro Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three remaining Capsule Pro perks (visible Pro badge, owner-only bulk ZIP export, presets-only-free/custom+gradient-Pro palettes) and scrub every "full-res / original-quality" marketing claim to match what actually ships.

**Architecture:** All three perks are cosmetic/client-side gates (like video length) — no security boundary. One additive DB column (`users.accent_gradient`) backs gradient themes. Platform splits (`.native.ts`/`.web.ts`/`.ts`) handle the native-only ZIP module. Gradients render on only three named surfaces via a shared `AccentSurface`.

**Tech Stack:** React Native + Expo ~54, TypeScript, Supabase, `expo-linear-gradient`, `react-native-zip-archive` (native ZIP), `fflate` (web ZIP), `expo-sharing`, `expo-file-system/legacy`.

## Global Constraints

- Design tokens: background `#0A0A0A`, surface `#1A1A1A`, border `#2A2A2A`, text primary `#FFFFFF`, secondary `#888888`, muted `#555555` (decoration only — never body text/content).
- Accent color: always `useTheme().accentColor`. Never hardcode `#FF6B35` in app screens (static fallback inside `StyleSheet.create` is fine). Apply accent as inline style override.
- Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`.
- No `Alert.alert` for confirm/cancel on web — use `ConfirmModal`. Errors as inline `<Text>`. Any user-initiated mutation that fails must `toast.show(...)`.
- `expo-file-system` APIs are native-only — guard `Platform.OS !== 'web'`, import from `expo-file-system/legacy`.
- Platform-split idiom: `.native.ts` real impl / `.web.ts` stub / bare `.ts` re-exports the web stub (as `src/lib/purchases.*` and `usePushNotifications.*` do).
- New `users` column → `grant select (col)` (and `update (col)` where the client writes it) to `authenticated` in the SAME migration. A missing grant 403s the ENTIRE `select()`.
- Entitlements-loading rule: any gate on the current user's OWN `isPro` fires only on `!loading && !isPro`. Gates on a fetched `ownerTier` have no such race.
- `getSession()` never on web / inside screens — use `sessionStore.get()`.
- Prod migrations: apply via `mcp__supabase__apply_migration`; verify live with a rolled-back fixture (`begin; … ; rollback;`). No destructive SQL on prod. The gradient migration is additive (add column + grant) — safe.
- No JS test framework in this repo. Pure-logic modules get a `node:assert/strict` script run with `npx tsx <file>` (precedent: `src/lib/recurrence.test.ts`). RN screens/components are verified with `npx tsc --noEmit` (introduce no NEW type errors in files you touch) plus a careful read — do NOT invent a component test harness.
- CLAUDE.md is updated ONCE, in the final task (Task 10), to keep the multi-feature doc coherent and avoid churn — individual feature tasks do NOT edit CLAUDE.md.
- `subscription_tier` stays the un-forgeable source of truth (guarded by `guard_subscription_tier`). Nothing here weakens that.

**Baseline type-check note:** before starting, run `npx tsc --noEmit` once and save the output — the project may have pre-existing errors unrelated to this work. Your bar per task is "no NEW errors referencing the files this task created/modified," not "zero errors globally."

---

### Task 1: Pro badge component + all four placements

**Files:**
- Create: `src/components/ProBadge.tsx`
- Modify: `src/screens/app/ProfileScreen.tsx` (name row ~363, add `useEntitlements`)
- Modify: `src/screens/app/PublicProfileScreen.tsx` (`Profile` type ~31, select ~212, name ~280)
- Modify: `src/screens/app/HomeScreen.tsx` (query ~237, `CapsuleCard` cardTop ~107-114)
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (members sheet map ~2270)

**Interfaces:**
- Produces: `export default function ProBadge({ size }: { size?: 'sm' | 'md' })` — self-contained pill; reads `accentColor` from `useTheme()` internally. Caller decides *whether* to render it (based on tier); ProBadge itself takes no tier prop.

- [ ] **Step 1: Create the ProBadge component**

Create `src/components/ProBadge.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

/**
 * Small "PRO" pill marking a Capsule Pro user. The caller decides whether to
 * render it (based on the subject's subscription_tier / isPro); this component
 * only draws the pill. Not a touchable — decorative status marker.
 */
export default function ProBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { accentColor } = useTheme();
  const md = size === 'md';
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}55` },
        md && styles.badgeMd,
      ]}
      accessibilityLabel="Capsule Pro"
    >
      <Ionicons name="sparkles" size={md ? 12 : 10} color={accentColor} />
      <Text
        style={[styles.text, { color: accentColor }, md && styles.textMd]}
        maxFontSizeMultiplier={1.3}
      >
        PRO
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeMd: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, gap: 4 },
  text: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  textMd: { fontSize: 11 },
});
```

- [ ] **Step 2: Badge own ProfileScreen**

In `src/screens/app/ProfileScreen.tsx`, add imports near the other imports:

```tsx
import ProBadge from '../../components/ProBadge';
import { useEntitlements } from '../../hooks/useEntitlements';
```

Inside the `ProfileScreen` component body (near the top, with the other hooks), add:

```tsx
  const { isPro } = useEntitlements();
```

Replace the hero name line (~363) `<Text style={styles.name}>{profile?.display_name}</Text>` with:

```tsx
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile?.display_name}</Text>
              {isPro && <ProBadge size="md" />}
            </View>
```

Add to that file's `StyleSheet.create`:

```tsx
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
```

- [ ] **Step 3: Badge others' PublicProfileScreen**

In `src/screens/app/PublicProfileScreen.tsx`:

Add import:
```tsx
import ProBadge from '../../components/ProBadge';
```

Extend the `Profile` type (~31) to include the tier:
```tsx
type Profile = { id: string; display_name: string; bio: string | null; avatar_url: string | null; subscription_tier?: string };
```

Add `subscription_tier` to the select (~212):
```tsx
      supabase.from('users').select('id, display_name, bio, avatar_url, subscription_tier').eq('id', userId).single(),
```

Replace the name line (~280) `<Text style={styles.name}>{profile?.display_name}</Text>` with:
```tsx
        <View style={styles.nameRow}>
          <Text style={styles.name}>{profile?.display_name}</Text>
          {profile?.subscription_tier === 'pro' && <ProBadge size="md" />}
        </View>
```

Add to that file's styles:
```tsx
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
```

- [ ] **Step 4: Badge the owner on Home capsule cards**

In `src/screens/app/HomeScreen.tsx`, add the owner tier to the capsule embed (~237). Change the `.select(...)` to:

```tsx
        .select('capsule_id, archived_at, capsules(id, owner_id, title, description, status, unlock_at, unlock_mode, contribution_start_at, owner:users!capsules_owner_id_fkey(subscription_tier))')
```

Add the import:
```tsx
import ProBadge from '../../components/ProBadge';
```

In `CapsuleCard`, the owner tier is reachable as `(capsule as any).owner?.subscription_tier` (the map at ~244 spreads `row.capsules`, which now carries `owner`). Add a badge in the `cardTop` row. Replace the `cardTop` block (~107-114) with:

```tsx
        <View style={styles.cardTop}>
          <Ionicons
            name={isLocked ? 'time-outline' : 'lock-open-outline'}
            size={isGrid ? 20 : 24}
            color={isLocked ? '#888888' : '#30D158'}
          />
          <View style={styles.cardTopRight}>
            {(capsule as any).owner?.subscription_tier === 'pro' && <ProBadge />}
            <CountdownBadge unlockAt={capsule.unlock_at} status={capsule.status} unlockMode={capsule.unlock_mode} contributionStartAt={contributionStartAt} />
          </View>
        </View>
```

Add to HomeScreen styles:
```tsx
  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
```

(If `cardTop` already uses `justifyContent: 'space-between'`, the `marginLeft: 'auto'` is harmless; keep it so the group hugs the right edge in both list and grid.)

- [ ] **Step 5: Badge the owner in the CapsuleDetail members sheet**

In `src/screens/app/CapsuleDetailScreen.tsx`, add the import:
```tsx
import ProBadge from '../../components/ProBadge';
```

`ownerTier` is already in render scope (~1716). In the members `.map` (~2270), add a badge to the owner's row. Replace the `roleBadge` block:

```tsx
                    <View style={styles.roleBadge}>
                      <Ionicons name={roleIonicon[m.role] ?? 'person-outline'} size={11} color="#888888" />
                      <Text style={styles.roleText}>{roleLabel[m.role]}</Text>
                    </View>
```

with:

```tsx
                    {m.role === 'owner' && ownerTier === 'pro' && <ProBadge />}
                    <View style={styles.roleBadge}>
                      <Ionicons name={roleIonicon[m.role] ?? 'person-outline'} size={11} color="#888888" />
                      <Text style={styles.roleText}>{roleLabel[m.role]}</Text>
                    </View>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `ProBadge.tsx`, `ProfileScreen.tsx`, `PublicProfileScreen.tsx`, `HomeScreen.tsx`, or the members-sheet edit in `CapsuleDetailScreen.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProBadge.tsx src/screens/app/ProfileScreen.tsx src/screens/app/PublicProfileScreen.tsx src/screens/app/HomeScreen.tsx src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Add Pro badge on profiles and capsule owners"
```

---

### Task 2: `accent_gradient` column + types

**Files:**
- Create: `supabase/migrations/20260721150000_accent_gradient.sql`
- Modify: `src/types/database.ts` (`User` type ~31)

**Interfaces:**
- Produces: `users.accent_gradient text` (nullable, format `"#hexA,#hexB"`, null = solid accent), selectable + updatable by `authenticated`. `User` type gains `accent_gradient: string | null`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260721150000_accent_gradient.sql`:

```sql
-- Premium palettes: Pro users can set a 2-color gradient accent. Stored as
-- "#hexA,#hexB" (null = solid accent, the default for everyone). Additive and
-- non-destructive. Column-level grant is REQUIRED — a new users column gets no
-- SELECT grant by default (table grant was revoked), which 403s the whole
-- select(). Gating that only Pro may set this is client-side (cosmetic, not a
-- security boundary); no trigger needed.
alter table public.users add column if not exists accent_gradient text;

grant select (accent_gradient) on public.users to authenticated;
grant update (accent_gradient) on public.users to authenticated;
```

- [ ] **Step 2: Apply the migration to prod**

Use `mcp__supabase__apply_migration` with name `accent_gradient` and the SQL above (project `ezxxvvmesegegkdeniri`).

- [ ] **Step 3: Verify the column + grant live (rolled back)**

Use `mcp__supabase__execute_sql` to confirm the column exists and `authenticated` can read/write it without 42501. Run:

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
-- SELECT must not raise 42501 permission denied:
select accent_gradient from public.users limit 1;
rollback;
```

Expected: the select returns (0+ rows) with no `42501 permission denied`. Also confirm the column type via:
```sql
select column_name, data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='accent_gradient';
```
Expected: one row, `text`.

- [ ] **Step 4: Update the User type**

In `src/types/database.ts`, change the `User` type (~31) to include the gradient. Replace:
```tsx
export type User = Tables<'users'> & { subscription_tier: SubscriptionTier };
```
with:
```tsx
export type User = Tables<'users'> & { subscription_tier: SubscriptionTier; accent_gradient: string | null };
```
(The generated `Tables<'users'>` won't include the just-added column until types are regenerated; this intersection makes it available to call sites now.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `database.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260721150000_accent_gradient.sql src/types/database.ts
git commit -m "Add users.accent_gradient column (+ grant) for Pro gradient themes"
```

---

### Task 3: Accent presets module + tests

**Files:**
- Create: `src/lib/accentPresets.ts`
- Create: `src/lib/accentPresets.test.ts`

**Interfaces:**
- Produces:
  - `ACCENT_PRESETS: string[]` — ~10 curated solid hexes (includes `#FC6A5B` and `#FF6B35`).
  - `ACCENT_GRADIENTS: [string, string][]` — ~6 curated 2-color pairs.
  - `parseGradient(value: string | null | undefined): [string, string] | null` — splits `"#a,#b"` → tuple; null/invalid → null.
  - `serializeGradient(g: [string, string]): string` — tuple → `"#a,#b"`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/accentPresets.test.ts`:

```ts
import assert from 'node:assert/strict';
import { ACCENT_PRESETS, ACCENT_GRADIENTS, parseGradient, serializeGradient } from './accentPresets';

// Presets are non-empty, valid 6-digit hexes, and include the two brand colors.
assert.ok(ACCENT_PRESETS.length >= 8, 'expected at least 8 presets');
for (const h of ACCENT_PRESETS) assert.match(h, /^#[0-9a-fA-F]{6}$/, `bad preset hex: ${h}`);
assert.ok(ACCENT_PRESETS.includes('#FC6A5B'), 'brand pink/red missing');
assert.ok(ACCENT_PRESETS.includes('#FF6B35'), 'classic orange missing');

// Gradients are pairs of valid hexes.
assert.ok(ACCENT_GRADIENTS.length >= 4, 'expected at least 4 gradients');
for (const [a, b] of ACCENT_GRADIENTS) {
  assert.match(a, /^#[0-9a-fA-F]{6}$/);
  assert.match(b, /^#[0-9a-fA-F]{6}$/);
}

// Round-trip.
assert.equal(serializeGradient(['#FC6A5B', '#FF6B35']), '#FC6A5B,#FF6B35');
assert.deepEqual(parseGradient('#FC6A5B,#FF6B35'), ['#FC6A5B', '#FF6B35']);

// Robustness.
assert.equal(parseGradient(null), null);
assert.equal(parseGradient(''), null);
assert.equal(parseGradient('#FC6A5B'), null, 'single color is not a gradient');
assert.equal(parseGradient('not,colors'), null, 'invalid hexes rejected');
assert.deepEqual(parseGradient('  #fc6a5b , #ff6b35 '), ['#fc6a5b', '#ff6b35'], 'trims whitespace');

console.log('accentPresets: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/lib/accentPresets.test.ts`
Expected: FAIL — cannot find module `./accentPresets`.

- [ ] **Step 3: Implement the module**

Create `src/lib/accentPresets.ts`:

```ts
// Curated accent palette. Free users pick a solid from ACCENT_PRESETS; Pro
// users additionally get the free-form ColorPicker and ACCENT_GRADIENTS.
// Pure data + parsing — no network, importable anywhere (incl. Settings).

export const ACCENT_PRESETS: string[] = [
  '#FC6A5B', // brand pink/red
  '#FF6B35', // classic orange (default)
  '#FF3B7F', // magenta
  '#F5A623', // amber
  '#30D158', // green
  '#32D0C6', // teal
  '#4C8DFF', // blue
  '#7B61FF', // indigo
  '#B36BFF', // violet
  '#FF5CA8', // pink
];

export const ACCENT_GRADIENTS: [string, string][] = [
  ['#FC6A5B', '#FF3B7F'], // sunset
  ['#FF6B35', '#F5A623'], // ember
  ['#4C8DFF', '#7B61FF'], // dusk
  ['#32D0C6', '#30D158'], // aurora
  ['#B36BFF', '#FF5CA8'], // orchid
  ['#7B61FF', '#4C8DFF'], // twilight
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Split a stored "#a,#b" gradient into a tuple; null/invalid → null. */
export function parseGradient(value: string | null | undefined): [string, string] | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => s.trim());
  if (parts.length !== 2) return null;
  if (!HEX_RE.test(parts[0]) || !HEX_RE.test(parts[1])) return null;
  return [parts[0], parts[1]];
}

/** Serialize a gradient tuple to the stored "#a,#b" form. */
export function serializeGradient(g: [string, string]): string {
  return `${g[0]},${g[1]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/lib/accentPresets.test.ts`
Expected: PASS — prints `accentPresets: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/accentPresets.ts src/lib/accentPresets.test.ts
git commit -m "Add accent presets + gradient parsing helpers"
```

---

### Task 4: ThemeContext gradient support

**Files:**
- Modify: `src/context/ThemeContext.tsx`

**Interfaces:**
- Consumes: `parseGradient`, `serializeGradient` from Task 3; `users.accent_gradient` column from Task 2.
- Produces: `useTheme()` gains `accentGradient: [string, string] | null` and `setAccentGradient(g: [string, string] | null): Promise<void>`. Contract: `setAccentGradient(g)` persists the gradient AND sets `accent_color = g[0]` so the app-wide solid stays coherent; `setAccentGradient(null)` clears the gradient. `setAccentColor(solid)` now ALSO clears the gradient (choosing a solid ends gradient mode).

- [ ] **Step 1: Extend the cached theme shape + context type**

In `src/context/ThemeContext.tsx`:

Add the import at top:
```tsx
import { parseGradient, serializeGradient } from '../lib/accentPresets';
```

Extend `CachedTheme` (~14):
```tsx
type CachedTheme = { accentColor?: string; homeLayout?: HomeLayout; accentGradient?: string | null };
```

Extend `ThemeContextType` (~56):
```tsx
type ThemeContextType = {
  accentColor: string;
  setAccentColor: (color: string) => Promise<void>;
  homeLayout: HomeLayout;
  setHomeLayout: (layout: HomeLayout) => Promise<void>;
  accentGradient: [string, string] | null;
  setAccentGradient: (g: [string, string] | null) => Promise<void>;
};
```

Extend the default context (~63):
```tsx
const ThemeContext = createContext<ThemeContextType>({
  accentColor: DEFAULT_ACCENT,
  setAccentColor: async () => {},
  homeLayout: DEFAULT_HOME_LAYOUT,
  setHomeLayout: async () => {},
  accentGradient: null,
  setAccentGradient: async () => {},
});
```

- [ ] **Step 2: Seed gradient from cache + add state**

Add a lazy initializer alongside `initialAccentColor`/`initialHomeLayout` (~93):
```tsx
function initialAccentGradient(): [string, string] | null {
  const session = sessionStore.get();
  if (session?.user) {
    const cached = readCachedThemeSync(session.user.id);
    if (cached?.accentGradient) return parseGradient(cached.accentGradient);
  }
  return null;
}
```

In `ThemeProvider`, add state (~97):
```tsx
  const [accentGradient, setAccentGradientState] = useState<[string, string] | null>(initialAccentGradient);
```

- [ ] **Step 3: Load gradient from Supabase + write-through cache**

In `loadPrefs` (~102), extend the select and application. Replace the `.select('accent_color, home_layout')` line with:
```tsx
          .select('accent_color, home_layout, accent_gradient')
```

Immediately after `if (layout === 'grid' || layout === 'list') setHomeLayoutState(layout);` (~121), add:
```tsx
        const grad = parseGradient((data as any)?.accent_gradient);
        setAccentGradientState(grad);
```

Extend the `writeCachedTheme` call inside `loadPrefs` (~123) to include the gradient. Replace that call with:
```tsx
        if (accent || layout === 'grid' || layout === 'list') {
          writeCachedTheme(userId, {
            accentColor: accent ?? cached?.accentColor ?? DEFAULT_ACCENT,
            homeLayout: (layout === 'grid' || layout === 'list') ? layout : (cached?.homeLayout ?? DEFAULT_HOME_LAYOUT),
            accentGradient: (data as any)?.accent_gradient ?? null,
          });
        }
```

Apply the cached gradient during the fast cache-then-network read (~106, after the cached homeLayout apply):
```tsx
      if (cached?.accentGradient !== undefined) setAccentGradientState(parseGradient(cached.accentGradient));
```

- [ ] **Step 4: Reset gradient on sign-out**

In the `onAuthStateChange` `SIGNED_OUT` branch (~136), add:
```tsx
        setAccentGradientState(null);
```

- [ ] **Step 5: Update `writeCachedTheme` signature + setters**

`writeCachedTheme` takes `Required<CachedTheme>` (~47). Since `CachedTheme` now has three fields, every existing caller must pass `accentGradient`. Update the signature to accept the gradient and update `setAccentColor`/`setHomeLayout` to pass it.

Change `writeCachedTheme` (~47) param type to `CachedTheme & { accentColor: string; homeLayout: HomeLayout }` (gradient optional) OR keep `Required` and always pass all three. Use this exact body:
```tsx
function writeCachedTheme(userId: string, prefs: { accentColor: string; homeLayout: HomeLayout; accentGradient: string | null }) {
  const value = JSON.stringify(prefs);
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(`${THEME_CACHE_PREFIX}${userId}`, value); } catch {}
  } else {
    AsyncStorage.setItem(`${THEME_CACHE_PREFIX}${userId}`, value).catch(() => {});
  }
}
```

Rewrite `setAccentColor` (~149) to clear the gradient (choosing a solid ends gradient mode):
```tsx
  async function setAccentColor(color: string) {
    setAccentColorState(color);
    setAccentGradientState(null);
    const session = sessionStore.get();
    if (session) {
      writeCachedTheme(session.user.id, { accentColor: color, homeLayout, accentGradient: null });
      const { error } = await supabase.from('users').update({ accent_color: color, accent_gradient: null }).eq('id', session.user.id);
      if (error) toast.show("Couldn't save your color — try again.");
    }
  }
```

Update `setHomeLayout` (~162) `writeCachedTheme` call to pass the current gradient:
```tsx
      writeCachedTheme(session.user.id, { accentColor, homeLayout: layout, accentGradient: accentGradient ? serializeGradient(accentGradient) : null });
```

Add `setAccentGradient` after `setHomeLayout`:
```tsx
  // Pro-only (gate is in the UI). Persists the gradient AND sets accent_color to
  // its first color, so every non-gradient surface keeps a coherent solid.
  async function setAccentGradient(g: [string, string] | null) {
    setAccentGradientState(g);
    const solid = g ? g[0] : accentColor;
    if (g) setAccentColorState(solid);
    const session = sessionStore.get();
    if (session) {
      const serialized = g ? serializeGradient(g) : null;
      writeCachedTheme(session.user.id, { accentColor: solid, homeLayout, accentGradient: serialized });
      const { error } = await supabase.from('users').update({ accent_gradient: serialized, accent_color: solid }).eq('id', session.user.id);
      if (error) toast.show("Couldn't save your theme — try again.");
    }
  }
```

- [ ] **Step 6: Expose the new values on the provider**

Update the provider value (~172):
```tsx
    <ThemeContext.Provider value={{ accentColor, setAccentColor, homeLayout, setHomeLayout, accentGradient, setAccentGradient }}>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `ThemeContext.tsx`. (In particular, all `writeCachedTheme` call sites now pass `accentGradient`.)

- [ ] **Step 8: Commit**

```bash
git add src/context/ThemeContext.tsx
git commit -m "Add gradient accent support to ThemeContext"
```

---

### Task 5: AccentSurface component

**Files:**
- Create: `src/components/AccentSurface.tsx`

**Interfaces:**
- Consumes: `useTheme().accentGradient` / `accentColor` (Task 4); `expo-linear-gradient`.
- Produces: `export default function AccentSurface(props: { style?; children?; start?; end? })` — renders an `expo-linear-gradient` `LinearGradient` when a gradient is set, else a solid `View` backgrounded with `accentColor`. Both accept `style` and `children` identically so callers can swap a plain accent-colored `View` for `<AccentSurface>` with no other change.

- [ ] **Step 1: Confirm `expo-linear-gradient` is installed**

Run: `grep expo-linear-gradient package.json`
Expected: a version line. If ABSENT, run `npx expo install expo-linear-gradient` and stage `package.json`/`package-lock.json` with this task's commit. (It is already a common Expo dep; check before adding.)

- [ ] **Step 2: Create the component**

Create `src/components/AccentSurface.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

/**
 * A surface tinted by the user's accent. Renders a LinearGradient when the user
 * (Pro) has a gradient theme set, otherwise a solid View backed by accentColor.
 * Drop-in replacement for an accent-colored View — same style/children props.
 * Used only on the three "premium showcase" surfaces (profile hero glow, camera
 * tab button, Settings save button); the rest of the app uses the solid
 * accentColor token directly.
 */
export default function AccentSurface({
  style,
  children,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}) {
  const { accentColor, accentGradient } = useTheme();
  if (accentGradient) {
    return (
      <LinearGradient colors={accentGradient} start={start} end={end} style={style}>
        {children}
      </LinearGradient>
    );
  }
  return <View style={[style, { backgroundColor: accentColor }]}>{children}</View>;
}

// (no local styles — the caller owns layout via `style`)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = StyleSheet;
```

(Drop the `_unused`/`StyleSheet` import if your lint config doesn't require a use — it's only there to avoid an unused-import error if a stricter config is on. Prefer simply not importing `StyleSheet`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `AccentSurface.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/AccentSurface.tsx package.json package-lock.json
git commit -m "Add AccentSurface (gradient-or-solid accent surface)"
```

---

### Task 6: Tier-aware Settings Appearance section + copy scrub

**Files:**
- Modify: `src/screens/app/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `ACCENT_PRESETS`, `ACCENT_GRADIENTS` (Task 3); `useTheme()` `accentColor`/`setAccentColor`/`accentGradient`/`setAccentGradient` (Task 4); `useEntitlements()` (`isPro`, `loading`); `proGateHit` (`src/lib/proGate.ts`); existing `ColorPicker`.

- [ ] **Step 1: Add imports**

In `src/screens/app/SettingsScreen.tsx`, add:
```tsx
import { ACCENT_PRESETS, ACCENT_GRADIENTS } from '../../lib/accentPresets';
import { proGateHit } from '../../lib/proGate';
```

Extend the `useTheme` destructure (~36) and `useEntitlements` (~37):
```tsx
  const { accentColor, setAccentColor, accentGradient, setAccentGradient } = useTheme();
  const { isPro, loading: entitlementsLoading } = useEntitlements();
```

- [ ] **Step 2: Replace the Appearance section**

Replace the entire Appearance `<View style={styles.section}>…</View>` block (~122-136) with a tier-aware version:

```tsx
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Appearance</Text>
            <Text style={styles.helper}>Choose your accent color</Text>

            {/* Preset swatches — available to everyone. */}
            <View style={styles.swatchGrid}>
              {ACCENT_PRESETS.map((hex) => {
                const selected = !accentGradient && pending.toLowerCase() === hex.toLowerCase();
                return (
                  <TouchableOpacity
                    key={hex}
                    style={[styles.swatch, { backgroundColor: hex }, selected && styles.swatchSelected]}
                    onPress={() => { setPending(hex); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Accent color ${hex}`}
                  >
                    {selected && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Pro: custom picker + gradients. Free: a locked upsell row.
                Gate on !loading && !isPro so a real Pro user isn't briefly locked. */}
            {isPro ? (
              <>
                <Text style={styles.helper}>Custom color</Text>
                <ColorPicker value={pending} onChange={setPending} originalValue={accentColor} />
                <Text style={styles.helper}>Gradient themes</Text>
                <View style={styles.swatchGrid}>
                  {ACCENT_GRADIENTS.map((g) => {
                    const isSel = !!accentGradient && accentGradient[0] === g[0] && accentGradient[1] === g[1];
                    return (
                      <TouchableOpacity
                        key={g.join('')}
                        onPress={() => { setAccentGradient(g); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Gradient theme ${g[0]} to ${g[1]}`}
                        style={[styles.gradSwatchWrap, isSel && styles.swatchSelected]}
                      >
                        <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradSwatch}>
                          {isSel && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </LinearGradient>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : (
              <TouchableOpacity
                style={styles.lockedRow}
                activeOpacity={0.75}
                disabled={entitlementsLoading}
                onPress={() => proGateHit({
                  currentUserIsHost: true,
                  title: 'Custom colors & gradients',
                  ownerMessage: 'Upgrade to Capsule Pro for a custom color picker and gradient themes.',
                  guestMessage: '',
                })}
                accessibilityRole="button"
                accessibilityLabel="Unlock custom colors and gradients with Capsule Pro"
              >
                <Ionicons name="sparkles" size={18} color={accentColor} />
                <Text style={styles.lockedRowLabel}>Custom color & gradient themes</Text>
                <View style={[styles.proTag, { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}55` }]}>
                  <Text style={[styles.proTagText, { color: accentColor }]}>PRO</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: pending }]}
              onPress={handleSaveColor}
              disabled={saving}
            >
              {saving
                ? <LoadingBrand size="small" color="#fff" />
                : <Text style={styles.primaryBtnText}>Save Color</Text>
              }
            </TouchableOpacity>
          </View>
```

Add the `LinearGradient` import:
```tsx
import { LinearGradient } from 'expo-linear-gradient';
```

- [ ] **Step 3: Add the new styles**

Add to `SettingsScreen`'s `StyleSheet.create`:
```tsx
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 8 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#FFFFFF' },
  gradSwatchWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  gradSwatch: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4 },
  lockedRowLabel: { color: '#FFFFFF', fontSize: 15, flex: 1 },
  proTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  proTagText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
```

- [ ] **Step 4: Scrub the "full-quality export" copy (Feature D)**

Replace the non-Pro upgrade helper (~104-106):
```tsx
                  <Text style={styles.helper}>
                    Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export.
                  </Text>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `SettingsScreen.tsx`. (Note the swatch `pending`-vs-gradient selection: `handleSaveColor` still calls `setAccentColor(pending)`, which correctly clears any gradient when the user saves a solid — matching the Task 4 contract. Gradient selection persists immediately via `setAccentGradient`, independent of the Save button.)

- [ ] **Step 6: Commit**

```bash
git add src/screens/app/SettingsScreen.tsx
git commit -m "Gate custom colors/gradients behind Pro; presets for free"
```

---

### Task 7: Wire AccentSurface into profile hero glow + camera tab button

**Files:**
- Modify: `src/screens/app/ProfileScreen.tsx` (hero glow ~358)
- Modify: `src/navigation/AppNavigator.tsx` (camera button ~99-107)

**Interfaces:**
- Consumes: `AccentSurface` (Task 5).

- [ ] **Step 1: Profile hero glow → AccentSurface**

In `src/screens/app/ProfileScreen.tsx`, add the import:
```tsx
import AccentSurface from '../../components/AccentSurface';
```

Replace the hero glow bar (~358):
```tsx
          <View style={[styles.heroGlow, { backgroundColor: accentColor }]} />
```
with:
```tsx
          <AccentSurface style={styles.heroGlow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
```
(The `heroGlow` style already carries the layout/size; `AccentSurface` supplies the fill — solid or horizontal gradient.)

- [ ] **Step 2: Camera tab button → AccentSurface**

In `src/navigation/AppNavigator.tsx`, add the import:
```tsx
import AccentSurface from '../components/AccentSurface';
```

The camera button (~99-107) is a `<TouchableOpacity>` with `backgroundColor: accentColor`. Wrap its inner content in an `AccentSurface` filling the button, and remove the solid `backgroundColor` from the touchable so the gradient shows. Replace the camera `TouchableOpacity` block (~99-108) with:

```tsx
                  <TouchableOpacity
                    style={[styles.cameraBtn, isFocused && styles.cameraBtnActive, Platform.select({
                      default: { shadowColor: accentColor, shadowOpacity: isFocused ? 0.75 : 0.5, shadowRadius: isFocused ? 16 : 12, shadowOffset: { width: 0, height: 4 } },
                      web: {},
                    })]}
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel="Open camera"
                  >
                    <AccentSurface style={styles.cameraBtnFill}>
                      <Ionicons name="camera" size={26} color="#FFFFFF" />
                    </AccentSurface>
                  </TouchableOpacity>
```

Add to `AppNavigator`'s styles (the fill must round to the button and center the icon):
```tsx
  cameraBtnFill: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
```

Note: keep the existing `cameraBtn` style but add `overflow: 'hidden'` to it so the gradient fill is clipped to the button's rounding. Find the `cameraBtn` style (~213) and add `overflow: 'hidden',` to it. Verify the icon was previously a direct child of the touchable at ~107 — the replacement moves it inside `AccentSurface`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `ProfileScreen.tsx` or `AppNavigator.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/ProfileScreen.tsx src/navigation/AppNavigator.tsx
git commit -m "Render gradient accent on profile glow + camera tab button"
```

---

### Task 8: exportCapsule module (native ZIP / web ZIP) + web test

**Files:**
- Create: `src/lib/exportCapsule.ts` (types + web-stub fallback re-export)
- Create: `src/lib/exportCapsule.web.ts`
- Create: `src/lib/exportCapsule.native.ts`
- Create: `src/lib/exportCapsule.web.test.ts`
- Modify: `package.json` (deps)

**Interfaces:**
- Produces:
  - `export type ExportItem = { url: string; filename: string }` — a signed media URL + the name it should have in the zip.
  - `export function isExportSupported(): boolean` — false on web-in-Expo-Go / when the native module is missing; true where export can run.
  - `export async function exportCapsule(opts: { title: string; items: ExportItem[]; onProgress?: (done: number, total: number) => void }): Promise<void>` — downloads every item, zips them, and delivers the zip (native: share sheet; web: browser download). Throws on failure (caller toasts).
  - Web-only internal helper (exported for test): `export function buildZipBlobParts(files: { name: string; data: Uint8Array }[]): Uint8Array` — assembles a zip via `fflate.zipSync`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npx expo install expo-sharing
npm install fflate react-native-zip-archive
```
Expected: `package.json` gains `expo-sharing`, `fflate`, `react-native-zip-archive`. (`expo-file-system` is already a dep.) Stage `package.json` + `package-lock.json` with this task.

- [ ] **Step 2: Write the failing web-zip test**

Create `src/lib/exportCapsule.web.test.ts`:

```ts
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { buildZipBlobParts } from './exportCapsule.web';

const files = [
  { name: 'a.txt', data: new TextEncoder().encode('hello') },
  { name: 'b.txt', data: new TextEncoder().encode('world') },
];

const zip = buildZipBlobParts(files);
assert.ok(zip instanceof Uint8Array, 'returns a Uint8Array');
assert.ok(zip.length > 0, 'non-empty zip');

// Round-trip: unzip and confirm contents.
const out = unzipSync(zip);
assert.equal(new TextDecoder().decode(out['a.txt']), 'hello');
assert.equal(new TextDecoder().decode(out['b.txt']), 'world');

console.log('exportCapsule.web: zip round-trip passed');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx src/lib/exportCapsule.web.test.ts`
Expected: FAIL — cannot find `buildZipBlobParts` in `./exportCapsule.web`.

- [ ] **Step 4: Implement the shared types + fallback**

Create `src/lib/exportCapsule.ts`:
```ts
// TS-resolution fallback. React Native's Metro bundler picks .native.ts /
// .web.ts by platform; this bare .ts is what the TypeScript compiler and any
// non-platform import resolve to. Re-export the web stub (safe everywhere).
export * from './exportCapsule.web';
```

- [ ] **Step 5: Implement the web path**

Create `src/lib/exportCapsule.web.ts`:
```ts
import { zipSync } from 'fflate';

export type ExportItem = { url: string; filename: string };

export function isExportSupported(): boolean {
  return typeof document !== 'undefined';
}

/** Assemble a zip (store, no compression — media is already compressed). */
export function buildZipBlobParts(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const record: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) record[f.name] = [f.data, { level: 0 }];
  return zipSync(record);
}

export async function exportCapsule(opts: {
  title: string;
  items: ExportItem[];
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { title, items, onProgress } = opts;
  const files: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < items.length; i++) {
    const res = await fetch(items[i].url);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    files.push({ name: items[i].filename, data: buf });
    onProgress?.(i + 1, items.length);
  }
  const zip = buildZipBlobParts(files);
  // Browser download via an anchor element.
  const blob = new Blob([zip], { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${sanitize(title)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function sanitize(name: string): string {
  return (name || 'capsule').replace(/[^\w\-. ]+/g, '_').trim() || 'capsule';
}
```

- [ ] **Step 6: Run the web test to verify it passes**

Run: `npx tsx src/lib/exportCapsule.web.test.ts`
Expected: PASS — prints `exportCapsule.web: zip round-trip passed`.

- [ ] **Step 7: Implement the native path**

Create `src/lib/exportCapsule.native.ts`:
```ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ExportItem = { url: string; filename: string };

// react-native-zip-archive is a native module — absent in Expo Go / on web.
// Guard the require so those environments degrade instead of crashing.
let zipFolder: ((source: string, target: string) => Promise<string>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  zipFolder = require('react-native-zip-archive').zip;
} catch {
  zipFolder = null;
}

export function isExportSupported(): boolean {
  return Platform.OS !== 'web' && zipFolder !== null;
}

// Exported for signature-parity with the web module; unused on native (the web
// test covers the zip round-trip). Kept so callers can import from either side.
export function buildZipBlobParts(_files: { name: string; data: Uint8Array }[]): Uint8Array {
  throw new Error('buildZipBlobParts is web-only');
}

export async function exportCapsule(opts: {
  title: string;
  items: ExportItem[];
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { title, items, onProgress } = opts;
  if (!zipFolder) throw new Error('Export needs a full build (unavailable here).');

  // Stream each remote file to a temp working dir on disk (never through the JS
  // bridge as one giant buffer — safe for large capsules), then zip the dir.
  const work = `${FileSystem.cacheDirectory}export-${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(work, { intermediates: true });
  try {
    for (let i = 0; i < items.length; i++) {
      const dest = `${work}${items[i].filename}`;
      const { status } = await FileSystem.downloadAsync(items[i].url, dest);
      if (status !== 200) throw new Error(`download failed (${status})`);
      onProgress?.(i + 1, items.length);
    }
    const safe = (title || 'capsule').replace(/[^\w\-. ]+/g, '_').trim() || 'capsule';
    const target = `${FileSystem.cacheDirectory}${safe}.zip`;
    await zipFolder(work, target);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target, { mimeType: 'application/zip', dialogTitle: `Export ${title}` });
    }
  } finally {
    // Best-effort cleanup of the working dir.
    FileSystem.deleteAsync(work, { idempotent: true }).catch(() => {});
  }
}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing the `exportCapsule.*` files. (If `react-native-zip-archive` ships no types, the `require` is untyped by design — that's why it's a guarded `require`, not an `import`.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/exportCapsule.ts src/lib/exportCapsule.web.ts src/lib/exportCapsule.native.ts src/lib/exportCapsule.web.test.ts package.json package-lock.json
git commit -m "Add bulk capsule ZIP export (native disk-zip / web fflate)"
```

---

### Task 9: CapsuleDetail export action + progress modal + upsell copy scrub

**Files:**
- Create: `src/components/ExportProgressModal.tsx`
- Modify: `src/screens/app/CapsuleDetailScreen.tsx`

**Interfaces:**
- Consumes: `exportCapsule`, `isExportSupported`, `ExportItem` (Task 8); `proGateHit` (`src/lib/proGate.ts`); `useEntitlements`; existing `photos: MediaItem[]` (each has `signedUrl` + `media_type`); `ownerTier`, `isOwner`, `capsule.status`.

- [ ] **Step 1: Create the progress modal**

Create `src/components/ExportProgressModal.tsx`:
```tsx
import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import LoadingBrand from './LoadingBrand';
import { useTheme } from '../context/ThemeContext';

export default function ExportProgressModal({
  visible, done, total,
}: { visible: boolean; done: number; total: number }) {
  const { accentColor } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <LoadingBrand size="small" color={accentColor} />
          <Text style={styles.title}>Preparing your download…</Text>
          <Text style={styles.sub}>{total > 0 ? `${done} / ${total}` : ''}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 28, alignItems: 'center', gap: 12, minWidth: 220 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  sub: { color: '#888888', fontSize: 13 },
});
```

- [ ] **Step 2: Add export state + handler to CapsuleDetailScreen**

In `src/screens/app/CapsuleDetailScreen.tsx`, add imports:
```tsx
import ExportProgressModal from '../../components/ExportProgressModal';
import { exportCapsule, isExportSupported, ExportItem } from '../../lib/exportCapsule';
import { proGateHit } from '../../lib/proGate';
```
(If `proGateHit` is already imported in this file, do not duplicate it.)

Add state near the other `useState`s in the component (e.g. by `proNudgeDismissed`):
```tsx
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });
```

Add the handler (place it near the other handlers, after render-scope vars like `isOwner`, `ownerTier`, `isPro`, `photos` are defined — i.e. it can be a closure inside the component body that reads them):
```tsx
  async function handleExport() {
    if (ownerTier !== 'pro') {
      proGateHit({
        currentUserIsHost: true,
        title: 'Export your capsule',
        ownerMessage: 'Upgrade to Capsule Pro to download this whole capsule as a zip.',
        guestMessage: '',
      });
      return;
    }
    const items: ExportItem[] = photos
      .filter(p => !!p.signedUrl)
      .map((p, i) => {
        const ext = p.media_type === 'video' ? 'mp4' : 'jpg';
        return { url: p.signedUrl as string, filename: `${String(i + 1).padStart(3, '0')}.${ext}` };
      });
    if (items.length === 0) { toast.show('Nothing to export yet.'); return; }
    setExportProgress({ done: 0, total: items.length });
    setExporting(true);
    try {
      await exportCapsule({
        title: capsule.title,
        items,
        onProgress: (done, total) => setExportProgress({ done, total }),
      });
    } catch (e: any) {
      toast.show(e?.message ? `Export failed: ${e.message}` : 'Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  }
```

(Confirm `MediaItem` exposes `signedUrl` and `media_type`. Per the file's `MediaItem` type and `fetchPhotos`, `signedUrl` is the full-res 1920px signed URL and `media_type` is `'photo' | 'video'`. If a field name differs, adapt to the actual `MediaItem` shape — do NOT invent fields.)

- [ ] **Step 3: Add the export button in the Media section header**

Find the Media `sectionRow` (~1924-1930):
```tsx
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Media</Text>
          {photos.length > 0 && canSeePhotos && (
            <Text style={styles.photoCount}>{photos.length}</Text>
          )}
        </View>
```
Replace with (adds an owner-only export affordance on unlocked capsules where export can run):
```tsx
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Media</Text>
          <View style={styles.mediaHeaderRight}>
            {photos.length > 0 && canSeePhotos && (
              <Text style={styles.photoCount}>{photos.length}</Text>
            )}
            {isOwner && capsule.status === 'unlocked' && isExportSupported() && photos.length > 0 && (
              <TouchableOpacity
                onPress={handleExport}
                disabled={exporting}
                hitSlop={8}
                style={styles.exportBtn}
                accessibilityRole="button"
                accessibilityLabel="Export capsule as zip"
              >
                <Ionicons name="download-outline" size={18} color={accentColor} />
                <Text style={[styles.exportBtnText, { color: accentColor }]}>Export</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
```

Add styles to CapsuleDetailScreen's `StyleSheet.create`:
```tsx
  mediaHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  exportBtnText: { fontSize: 14, fontWeight: '600' },
```

- [ ] **Step 4: Mount the progress modal**

Near the other modals rendered by this screen (e.g. by the members `Modal` at the end of the return), add:
```tsx
      <ExportProgressModal visible={exporting} done={exportProgress.done} total={exportProgress.total} />
```

- [ ] **Step 5: Scrub the post-unlock upsell copy (Feature D)**

Replace the Pro-nudge sub copy (~1904):
```tsx
              <Text style={styles.inviteNudgeSub}>Longer videos, unlimited capsules, and one-tap capsule export.</Text>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `ExportProgressModal.tsx` or `CapsuleDetailScreen.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ExportProgressModal.tsx src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Add owner-only capsule ZIP export action + progress UI"
```

---

### Task 10: Docs — monetization strategy scrub, CLAUDE.md, paywall note

**Files:**
- Modify: `docs/monetization-strategy.md`
- Modify: `CLAUDE.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Scrub full-res / original-quality from the strategy doc**

Open `docs/monetization-strategy.md`. Find every reference to "original-quality", "original quality", "full-res", "full resolution", "originals", and storage-of-originals framing (around the Pro feature line ~194 and the matrix rows ~202-214, and any "5GB … original-quality" line). Edit each so it:
- Replaces "original-quality export" / "full-res" with "download your whole capsule (zip export)".
- Removes any promise that originals are stored (we resize to 1920px). If a storage-size row implies stored originals, reword it to describe capacity without the "original quality" claim, or delete the misleading clause.
- Removes any mention of filters (we ship none).

Read the surrounding lines and make the edits precise; do not leave a dangling "and " or broken table row. After editing, run:
```bash
grep -in "original\|full-res\|full resolution\|filter" docs/monetization-strategy.md
```
Expected: no remaining line promises original/full-res media or filters (matches that are clearly unrelated — e.g. "originally" in prose about history — are fine; use judgment).

- [ ] **Step 2: Update CLAUDE.md — Monetization → perks now shipped**

In `CLAUDE.md`, in the Monetization section (and Utilities/Components where the codebase inventories live), document the new surface. Add concise entries in the established voice:
- **`src/components/ProBadge.tsx`** — small "PRO" pill; rendered on own profile, others' `PublicProfileScreen`, and next to the capsule **owner** on Home cards + the CapsuleDetail members sheet. Reads the subject's `subscription_tier` / `useEntitlements().isPro` at the call site (ProBadge itself takes only `size`).
- **`src/lib/accentPresets.ts`** — `ACCENT_PRESETS` (free solids), `ACCENT_GRADIENTS` (Pro pairs), `parseGradient`/`serializeGradient`. Free users pick presets only; Pro unlocks the custom `ColorPicker` + gradients (a deliberate takeaway — existing custom colors are grandfathered, never reset).
- **`users.accent_gradient`** (nullable text `"#a,#b"`, null = solid) in the schema table + a note that it needs its column-level `select`/`update` grant (migration `20260721150000_accent_gradient.sql`). Gating is client-side/cosmetic (no trigger).
- **`ThemeContext`** now exposes `accentGradient: [string,string] | null` + `setAccentGradient`; setting a gradient also sets `accent_color = gradient[0]` (keeps the app-wide solid coherent); choosing a solid clears the gradient.
- **`src/components/AccentSurface.tsx`** — renders a `LinearGradient` when a gradient is set, else a solid accent `View`. Used ONLY on 3 surfaces (profile hero glow, camera tab button, Settings save button); everywhere else uses the solid `accentColor`.
- **`src/lib/exportCapsule.{native,web,ts}`** + `ExportProgressModal` — owner-only, owner-Pro, unlocked-capsule ZIP export. Native disk-zips via `react-native-zip-archive` (**needs a full dev/EAS build — no-op in Expo Go**, `isExportSupported()` guards it); web zips via `fflate`. Entry in CapsuleDetail's Media header; non-Pro owner tap → `proGateHit`.
- Note the tier copy no longer promises full-res/original-quality anywhere.

Follow the update-claude-md skill: edit the existing sections in place; keep it terse and decision-oriented; reflect the new column in the schema table + the Design System/Theme section for the gradient.

- [ ] **Step 3: Add the paywall manual-step note**

Append a short note to this plan file's end (or to `docs/monetization-strategy.md`'s launch section) recording the remaining MANUAL dashboard step (not a code change):
> **Paywall copy (manual, RevenueCat dashboard):** remove any "original quality / full-res" bullet from the hosted paywall; reword to "Download your whole capsule." Leave as an unpublished draft for the user to publish (same as the prior paywall redesign).

- [ ] **Step 4: Commit**

```bash
git add docs/monetization-strategy.md CLAUDE.md docs/superpowers/plans/2026-07-21-capsule-pro-features.md
git commit -m "Scrub full-res/original-quality claims; document Pro perks in CLAUDE.md"
```

---

## Self-Review

**1. Spec coverage:**
- Feature A (Pro badge) → Task 1 (component + 4 placements). ✅
- Feature B (ZIP export) → Task 8 (module) + Task 9 (UI/action). ✅ Native build caveat surfaced in Task 8/9/10.
- Feature C (palettes) → Task 2 (column) + Task 3 (presets) + Task 4 (ThemeContext) + Task 5 (AccentSurface) + Task 6 (Settings UI) + Task 7 (gradient surfaces). Grandfathering = no migration touches existing `accent_color` (Task 2 is additive). ✅
- Feature D (copy scrub) → Task 6 (Settings copy), Task 9 (upsell copy), Task 10 (strategy doc + paywall note). ✅
- Constraints (column grant, entitlements-loading, platform split, no test harness invention, CLAUDE.md once) → Global Constraints + threaded per task. ✅

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Each code step shows complete code. The one soft spot — Task 9's dependence on `MediaItem` field names (`signedUrl`, `media_type`) — is explicitly flagged to verify against the real type rather than assume, which is correct guidance, not a placeholder.

**3. Type consistency:** `ExportItem`/`exportCapsule`/`isExportSupported`/`buildZipBlobParts` identical across Tasks 8→9. `accentGradient: [string,string] | null` + `setAccentGradient` identical across Tasks 4→5→6. `parseGradient`/`serializeGradient` identical across Tasks 3→4. `ProBadge({ size })` identical across Task 1 call sites. `writeCachedTheme`'s new third field threaded through every caller in Task 4.

---

## Post-implementation note (Task 10)

**Paywall copy (manual, RevenueCat dashboard):** remove any "original quality / full-res" bullet from the hosted paywall; reword to "Download your whole capsule." Leave as an unpublished draft for the user to publish (same as the prior paywall redesign). Not done by this task — no code/dashboard-API path touches the hosted paywall's copy; `docs/monetization-strategy.md` and `CLAUDE.md` are scrubbed, but the dashboard-built paywall itself (Paywall AI Editor, attached to the `default` offering — see CLAUDE.md → Monetization → "RevenueCat dashboard configuration") is a separate artifact that still needs a human edit + republish.
