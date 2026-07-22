# New-User Coach-Mark Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A skippable, one-time, multi-screen coach-mark tour that runs for genuinely-new users right after onboarding, spotlighting real UI elements and adapting to whether they created a capsule.

**Architecture:** A custom `TourProvider` near the app root holds a target registry (`Map<id, measureFn>`) and a controller that drives `navigationRef` across screens; a `TourOverlay` dims everything except a spotlight hole around the measured target (four dim panels — no SVG, web+native) and shows a tooltip with Back/Next/Skip. Elements register via a `useTourTarget(id)` callback ref. Pure logic (step lists, poll loop) is extracted into unit-tested modules.

**Tech Stack:** React Native + Expo ~54, TypeScript, React Navigation v7 (`navigationRef`), AsyncStorage, `measureInWindow`. No new dependencies.

## Global Constraints

- Dark-theme tokens: background `#0A0A0A`, surface `#1A1A1A`, border `#2A2A2A`, text primary `#FFFFFF`, secondary `#888888`; muted `#555555` decoration-only (never body copy).
- Accent via `useTheme().accentColor` — never hardcode `#FF6B35` (static fallback in `StyleSheet.create` ok).
- Icon-only / control touchables need `accessibilityRole="button"` + `accessibilityLabel`; overlay is `accessibilityViewIsModal`.
- Must work on **web and native** — no native-only API without a `Platform` guard (`measureInWindow`, `navigationRef`, the four-panel dim all work on both).
- One-time flags use the existing `cap_*` AsyncStorage idiom (best-effort, swallow errors), like `cap_camera_coach_seen`.
- No new dependencies. No `users`/DB change. No change to *what* onboarding does beyond one flag write.
- Target-wrapper Views use `collapsable={false}` so Android doesn't flatten them (breaks `measureInWindow`).
- No JS test framework here except `npx tsx` scripts (pure logic) + `npx tsc --noEmit` (type check; project has ~95 PRE-EXISTING unrelated errors — the `@expo/vector-icons` module-resolution error is pre-existing project-wide). Do NOT invent a component test harness. Per task: no NEW errors referencing files you touched.
- CLAUDE.md updated once, in the final task.

**Baseline type-check note:** run `npx tsc --noEmit` once before starting and save the count; your bar is "no NEW errors referencing files this task created/modified."

---

### Task 1: Pure step-list module + storage flags

**Files:**
- Create: `src/lib/tourSteps.ts`
- Create: `src/lib/tourSteps.test.ts`
- Create: `src/lib/tourStorage.ts`

**Interfaces:**
- Produces:
  - `type TourScreen = 'Home' | 'CapsuleDetail'`
  - `type TourStep = { id: string; targetId: string | null; screen: TourScreen; params?: Record<string, unknown>; title: string; body: string }`
  - `buildTourSteps(ctx: { hasCapsule: boolean; capsuleId: string | null }): TourStep[]`
  - `tourStorage`: `setTourPending()`, `consumeTourPending(): Promise<boolean>`, `markTourSeen()`, `tourSeen(): Promise<boolean>` (all `Promise`, best-effort).

- [ ] **Step 1: Write the failing test**

Create `src/lib/tourSteps.test.ts`:

```ts
import assert from 'node:assert/strict';
import { buildTourSteps } from './tourSteps';

// Has-capsule branch: threads capsuleId into CapsuleDetail steps, ends on a null-target finish card.
const withCap = buildTourSteps({ hasCapsule: true, capsuleId: 'cap-123' });
assert.ok(withCap.length >= 8, 'has-capsule branch should be the long one');
assert.equal(withCap[0].screen, 'Home', 'starts on Home (the capsule card)');
assert.equal(withCap[0].targetId, 'capsule-card');
const detailSteps = withCap.filter(s => s.screen === 'CapsuleDetail');
assert.ok(detailSteps.length >= 4, 'has-capsule branch visits the capsule');
for (const s of detailSteps) assert.equal((s.params as any)?.capsuleId, 'cap-123', 'capsuleId threaded');
assert.ok(withCap.some(s => s.targetId === 'home-scan'), 'includes the join/scan stop');
const last = withCap[withCap.length - 1];
assert.equal(last.targetId, null, 'finish card has no target');

// No-capsule branch: leads with joining, no CapsuleDetail steps, create framed as optional.
const noCap = buildTourSteps({ hasCapsule: false, capsuleId: null });
assert.equal(noCap[0].targetId, 'home-scan', 'no-capsule branch leads with joining');
assert.ok(noCap.some(s => s.targetId === 'tab:Create'), 'still explains how to create');
assert.ok(!noCap.some(s => s.screen === 'CapsuleDetail'), 'no capsule-detail stops without a capsule');
assert.equal(noCap[noCap.length - 1].targetId, null, 'finish card last');

// Every non-finish step names a target.
for (const s of [...withCap, ...noCap]) {
  if (s.id !== 'finish') assert.ok(s.targetId, `step ${s.id} needs a target`);
}

console.log('tourSteps: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/lib/tourSteps.test.ts`
Expected: FAIL — cannot find module `./tourSteps`.

- [ ] **Step 3: Implement `tourSteps.ts`**

Create `src/lib/tourSteps.ts`:

```ts
// Pure step-list builder for the new-user coach-mark tour. No React/RN imports —
// unit-testable. Two branches: a full walkthrough when the user has a capsule,
// and a shorter join-first path when they don't. Copy is warm + concrete.

export type TourScreen = 'Home' | 'CapsuleDetail';

export type TourStep = {
  id: string;
  targetId: string | null; // registry id to spotlight; null = centered finish card
  screen: TourScreen;
  params?: Record<string, unknown>;
  title: string;
  body: string;
};

const FINISH_WITH_CAP: TourStep = {
  id: 'finish', targetId: null, screen: 'Home',
  title: "You're all set 🎉", body: "That's the tour. Go make some memories.",
};
const FINISH_NO_CAP: TourStep = {
  id: 'finish', targetId: null, screen: 'Home',
  title: "You're all set 🎉", body: 'Join a capsule or start your own whenever you like.',
};

export function buildTourSteps(ctx: { hasCapsule: boolean; capsuleId: string | null }): TourStep[] {
  if (ctx.hasCapsule && ctx.capsuleId) {
    const p = { capsuleId: ctx.capsuleId };
    return [
      { id: 'card', targetId: 'capsule-card', screen: 'Home', title: 'Your first capsule', body: "It's sealed until its unlock date. Let's look inside." },
      { id: 'countdown', targetId: 'capsule-countdown', screen: 'CapsuleDetail', params: p, title: 'Everyone unlocks together', body: 'The photos reveal for everyone the moment this countdown hits zero.' },
      { id: 'add-media', targetId: 'capsule-add-media', screen: 'CapsuleDetail', params: p, title: 'Add your photos', body: 'Drop in photos and videos here — they stay hidden until it unlocks.' },
      { id: 'invite', targetId: 'capsule-invite', screen: 'CapsuleDetail', params: p, title: 'Better with people', body: 'Invite your crew. They add their photos too, and everyone reveals together.' },
      { id: 'awards', targetId: 'capsule-awards', screen: 'CapsuleDetail', params: p, title: 'Fun awards', body: 'After it unlocks, everyone votes on these. Tweak them now if you like.' },
      { id: 'scan', targetId: 'home-scan', screen: 'Home', title: "Joining a friend's capsule", body: 'Got an invite? Scan their QR code or open their link to jump into a capsule too — no setup needed.' },
      { id: 'camera', targetId: 'tab:Camera', screen: 'Home', title: 'Capture anytime', body: 'Tap the camera to shoot straight into a capsule.' },
      { id: 'alerts', targetId: 'tab:Notifications', screen: 'Home', title: 'Your alerts', body: 'Invites and unlock alerts land here.' },
      { id: 'profile', targetId: 'tab:Profile', screen: 'Home', title: 'You', body: 'Profile, friends, and settings live here.' },
      FINISH_WITH_CAP,
    ];
  }
  return [
    { id: 'scan', targetId: 'home-scan', screen: 'Home', title: 'Joining is the fastest start', body: 'Got an invite? Scan a friend’s QR code or open their link to jump straight into their capsule.' },
    { id: 'create', targetId: 'tab:Create', screen: 'Home', title: 'Or start your own', body: "Whenever you're ready, tap Create to make your own time-locked capsule." },
    { id: 'camera', targetId: 'tab:Camera', screen: 'Home', title: 'Capture anytime', body: 'Tap the camera to shoot a photo or video — it flows into a capsule.' },
    { id: 'alerts', targetId: 'tab:Notifications', screen: 'Home', title: 'Your alerts', body: 'Invites and unlock alerts land here.' },
    { id: 'profile', targetId: 'tab:Profile', screen: 'Home', title: 'You', body: 'Profile, friends, and settings live here.' },
    FINISH_NO_CAP,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/lib/tourSteps.test.ts`
Expected: PASS — prints `tourSteps: all assertions passed`.

- [ ] **Step 5: Implement `tourStorage.ts`**

Create `src/lib/tourStorage.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time flags for the new-user tour, per-install (mirrors cap_camera_coach_seen).
// PENDING is set the moment onboarding completes and consumed (read-and-delete)
// by Home the first time it loads; SEEN is set on finish or skip so the tour
// never runs twice. All best-effort — failures never block the app.
const SEEN_KEY = 'cap_tour_seen';
const PENDING_KEY = 'cap_tour_pending';

export async function setTourPending(): Promise<void> {
  try { await AsyncStorage.setItem(PENDING_KEY, '1'); } catch {}
}

/** Returns true exactly once after onboarding completes, then clears the flag. */
export async function consumeTourPending(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    if (v) { await AsyncStorage.removeItem(PENDING_KEY); return true; }
  } catch {}
  return false;
}

export async function markTourSeen(): Promise<void> {
  try { await AsyncStorage.setItem(SEEN_KEY, '1'); } catch {}
}

export async function tourSeen(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SEEN_KEY)) === '1'; } catch { return false; }
}
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` (no NEW errors referencing `tourSteps.ts`/`tourStorage.ts`).

```bash
git add src/lib/tourSteps.ts src/lib/tourSteps.test.ts src/lib/tourStorage.ts
git commit -m "Add tour step-list builder + one-time storage flags"
```

---

### Task 2: `waitForTarget` polling helper

**Files:**
- Create: `src/lib/waitForTarget.ts`
- Create: `src/lib/waitForTarget.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { x: number; y: number; width: number; height: number }`
  - `type MeasureFn = () => Promise<Rect | null>`
  - `waitForTarget(id: string, getMeasure: (id: string) => MeasureFn | undefined, opts?: { timeout?: number; interval?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<Rect | null>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/waitForTarget.test.ts`:

```ts
import assert from 'node:assert/strict';
import { waitForTarget, Rect, MeasureFn } from './waitForTarget';

// Injected clock: `now` advances by whatever `sleep` is asked to wait.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

async function main() {
  const rect: Rect = { x: 1, y: 2, width: 3, height: 4 };

  // Resolves once the registry starts returning a measure fn that yields a valid rect.
  let calls = 0;
  const getLate = (_id: string): MeasureFn | undefined =>
    (++calls >= 3) ? async () => rect : undefined;
  const c1 = fakeClock();
  const hit = await waitForTarget('x', getLate, { interval: 150, timeout: 2500, now: c1.now, sleep: c1.sleep });
  assert.deepEqual(hit, rect, 'resolves the rect once the target registers');

  // Zero-size rect is treated as not-ready (returns null on timeout).
  const c2 = fakeClock();
  const zero = await waitForTarget('x', () => async () => ({ x: 0, y: 0, width: 0, height: 0 }), { interval: 150, timeout: 600, now: c2.now, sleep: c2.sleep });
  assert.equal(zero, null, 'zero-size rect never satisfies');

  // Never registers -> null on timeout.
  const c3 = fakeClock();
  const miss = await waitForTarget('x', () => undefined, { interval: 150, timeout: 600, now: c3.now, sleep: c3.sleep });
  assert.equal(miss, null, 'missing target resolves null after timeout');

  console.log('waitForTarget: all assertions passed');
}
main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/lib/waitForTarget.test.ts`
Expected: FAIL — cannot find module `./waitForTarget`.

- [ ] **Step 3: Implement**

Create `src/lib/waitForTarget.ts`:

```ts
// Pure polling helper: waits until a target's measure fn is registered AND yields
// a valid on-screen rect, or resolves null after a timeout. Clock is injectable
// so it's unit-testable without real timers.

export type Rect = { x: number; y: number; width: number; height: number };
export type MeasureFn = () => Promise<Rect | null>;

export async function waitForTarget(
  id: string,
  getMeasure: (id: string) => MeasureFn | undefined,
  opts?: { timeout?: number; interval?: number; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<Rect | null> {
  const timeout = opts?.timeout ?? 2500;
  const interval = opts?.interval ?? 150;
  const now = opts?.now ?? (() => Date.now());
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const start = now();
  // Poll until the deadline; check-then-sleep so a target that's ready on the
  // first tick resolves immediately.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fn = getMeasure(id);
    if (fn) {
      const rect = await fn();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    if (now() - start >= timeout) return null;
    await sleep(interval);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/lib/waitForTarget.test.ts`
Expected: PASS — prints `waitForTarget: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/waitForTarget.ts src/lib/waitForTarget.test.ts
git commit -m "Add waitForTarget polling helper for tour targets"
```

---

### Task 3: TourContext (registry + controller + hooks)

**Files:**
- Create: `src/context/TourContext.tsx`

**Interfaces:**
- Consumes: `buildTourSteps`/`TourStep` (Task 1), `tourStorage` (Task 1), `waitForTarget`/`Rect`/`MeasureFn` (Task 2), `navigationRef` (`src/lib/navigationRef.ts`).
- Produces:
  - `TourProvider({ children })` — renders `{children}` (overlay is wired in Task 4).
  - `useTour(): { active: boolean; steps: TourStep[]; stepIndex: number; currentRect: Rect | null; startTour(steps: TourStep[]): void; next(): void; back(): void; skip(): void; registerTarget(id: string, fn: MeasureFn): void; unregisterTarget(id: string): void }`
  - `useTourTarget(id: string): (node: any) => void` — a stable callback ref.

- [ ] **Step 1: Implement the context**

Create `src/context/TourContext.tsx`:

```tsx
import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { navigationRef } from '../lib/navigationRef';
import { buildTourSteps, TourStep } from '../lib/tourSteps';
import { waitForTarget, Rect, MeasureFn } from '../lib/waitForTarget';
import { markTourSeen } from '../lib/tourStorage';

type TourContextType = {
  active: boolean;
  steps: TourStep[];
  stepIndex: number;
  currentRect: Rect | null;
  startTour: (steps: TourStep[]) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  registerTarget: (id: string, fn: MeasureFn) => void;
  unregisterTarget: (id: string) => void;
};

const noop = () => {};
const TourContext = createContext<TourContextType>({
  active: false, steps: [], stepIndex: 0, currentRect: null,
  startTour: noop, next: noop, back: noop, skip: noop,
  registerTarget: noop, unregisterTarget: noop,
});

// Measure a native node to window coordinates; resolves null if it's gone/zero-size.
export function measureNode(node: any): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    try {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        if (width > 0 && height > 0) resolve({ x, y, width, height });
        else resolve(null);
      });
    } catch { resolve(null); }
  });
}

function currentRouteName(): string | undefined {
  try { return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined; } catch { return undefined; }
}

function navigateForStep(step: TourStep) {
  if (!navigationRef.isReady()) return;
  if (currentRouteName() === step.screen) return;
  if (step.screen === 'Home') {
    navigationRef.navigate('Tabs' as never, { screen: 'Home' } as never);
  } else if (step.screen === 'CapsuleDetail') {
    navigationRef.navigate('CapsuleDetail' as never, step.params as never);
  }
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const registry = useRef(new Map<string, MeasureFn>()).current;
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const runToken = useRef(0); // invalidates in-flight goToStep when a new run/skip happens

  const registerTarget = useCallback((id: string, fn: MeasureFn) => { registry.set(id, fn); }, [registry]);
  const unregisterTarget = useCallback((id: string) => { registry.delete(id); }, [registry]);

  const finish = useCallback(() => {
    runToken.current++;
    setActive(false);
    setCurrentRect(null);
    markTourSeen();
  }, []);

  const goToStep = useCallback(async (list: TourStep[], i: number, token: number, skips: number) => {
    if (token !== runToken.current) return;            // superseded
    if (i < 0 || i >= list.length || skips > list.length) { finish(); return; }
    const step = list[i];
    navigateForStep(step);
    if (step.targetId == null) { setStepIndex(i); setCurrentRect(null); return; } // finish card
    const rect = await waitForTarget(step.targetId, (id) => registry.get(id));
    if (token !== runToken.current) return;
    if (!rect) { goToStep(list, i + 1, token, skips + 1); return; }               // unmeasurable → skip
    setStepIndex(i); setCurrentRect(rect);
  }, [registry, finish]);

  const startTour = useCallback((list: TourStep[]) => {
    if (!list.length) return;
    const token = ++runToken.current;
    setSteps(list); setStepIndex(0); setCurrentRect(null); setActive(true);
    goToStep(list, 0, token, 0);
  }, [goToStep]);

  const next = useCallback(() => { goToStep(steps, stepIndex + 1, runToken.current, 0); }, [goToStep, steps, stepIndex]);
  const back = useCallback(() => { goToStep(steps, stepIndex - 1, runToken.current, 0); }, [goToStep, steps, stepIndex]);
  const skip = useCallback(() => { finish(); }, [finish]);

  return (
    <TourContext.Provider value={{ active, steps, stepIndex, currentRect, startTour, next, back, skip, registerTarget, unregisterTarget }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour() { return useContext(TourContext); }

// Stable callback ref: attach to any element to register it as a tour target.
export function useTourTarget(id: string): (node: any) => void {
  const { registerTarget, unregisterTarget } = useTour();
  return useCallback((node: any) => {
    if (node) registerTarget(id, () => measureNode(node));
    else unregisterTarget(id);
  }, [id, registerTarget, unregisterTarget]);
}

// Re-export for callers that build steps + start in one place.
export { buildTourSteps };
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (no NEW errors referencing `TourContext.tsx`).

```bash
git add src/context/TourContext.tsx
git commit -m "Add TourContext: target registry + cross-screen controller"
```

---

### Task 4: TourOverlay (spotlight + tooltip) wired into the provider

**Files:**
- Create: `src/components/TourOverlay.tsx`
- Modify: `src/context/TourContext.tsx` (render the overlay)

**Interfaces:**
- Consumes: `useTour()` (Task 3), `useTheme()` (`src/context/ThemeContext.tsx`).

- [ ] **Step 1: Create the overlay**

Create `src/components/TourOverlay.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTour } from '../context/TourContext';
import { useTheme } from '../context/ThemeContext';

const DIM = 'rgba(0,0,0,0.72)';
const TOOLTIP_W = 300;

export default function TourOverlay() {
  const { active, steps, stepIndex, currentRect, next, back, skip } = useTour();
  const { accentColor } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = Dimensions.get('window');

  if (!active) return null;
  const step = steps[stepIndex];
  if (!step) return null;

  const isLast = stepIndex === steps.length - 1;
  const rect = currentRect;

  // Tooltip placement: below the target if it's in the top ~60% of the screen,
  // else above. No target (finish card) => centered.
  let tooltipTop: number;
  if (!rect) {
    tooltipTop = SH / 2 - 90;
  } else if (rect.y + rect.height < SH * 0.6) {
    tooltipTop = rect.y + rect.height + 14;
  } else {
    tooltipTop = rect.y - 14 - 170; // approx card height; clamped below
  }
  tooltipTop = Math.max(insets.top + 12, Math.min(tooltipTop, SH - insets.bottom - 190));
  const tooltipLeft = Math.max(12, Math.min((SW - TOOLTIP_W) / 2, SW - TOOLTIP_W - 12));

  const swallow = (e: any) => { e.stopPropagation?.(); };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
      {/* Dim panels forming a hole around `rect` (or full-screen dim when null). */}
      {rect ? (
        <>
          <Pressable style={[styles.panel, { left: 0, top: 0, width: SW, height: Math.max(0, rect.y) }]} onPress={swallow} />
          <Pressable style={[styles.panel, { left: 0, top: rect.y + rect.height, width: SW, height: Math.max(0, SH - (rect.y + rect.height)) }]} onPress={swallow} />
          <Pressable style={[styles.panel, { left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.height }]} onPress={swallow} />
          <Pressable style={[styles.panel, { left: rect.x + rect.width, top: rect.y, width: Math.max(0, SW - (rect.x + rect.width)), height: rect.height }]} onPress={swallow} />
          {/* Transparent catcher over the hole so the real element can't be tapped mid-tour. */}
          <Pressable style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: 12, borderWidth: 2, borderColor: accentColor }} onPress={swallow} />
        </>
      ) : (
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} onPress={swallow} />
      )}

      {/* Tooltip card */}
      <View style={[styles.card, { top: tooltipTop, left: tooltipLeft, width: TOOLTIP_W }]}>
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>{step.title}</Text>
        <Text style={styles.body} maxFontSizeMultiplier={1.4}>{step.body}</Text>

        <View style={styles.dots}>
          {steps.map((s, i) => (
            <View key={s.id} style={[styles.dot, { backgroundColor: i === stepIndex ? accentColor : '#3A3A3A' }]} />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={skip} accessibilityRole="button" accessibilityLabel="Skip tour" hitSlop={8}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
          <View style={styles.rightActions}>
            {stepIndex > 0 && (
              <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Previous step" hitSlop={8} style={styles.backBtn}>
                <Text style={styles.backText}>Back</Text>
              </Pressable>
            )}
            <Pressable onPress={isLast ? skip : next} accessibilityRole="button" accessibilityLabel={isLast ? 'Finish tour' : 'Next step'} style={[styles.nextBtn, { backgroundColor: accentColor }]}>
              <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', backgroundColor: DIM },
  card: {
    position: 'absolute', backgroundColor: '#1A1A1A', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: '#2A2A2A',
    ...Platform.select({ default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }, web: {} }),
  },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 6 },
  body: { color: '#888888', fontSize: 14, lineHeight: 20 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 14, marginBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  skip: { color: '#888888', fontSize: 14, fontWeight: '500' },
  backBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  backText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  nextBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10 },
  nextText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
```

- [ ] **Step 2: Render the overlay from the provider**

In `src/context/TourContext.tsx`, add the import at the top:
```tsx
import TourOverlay from '../components/TourOverlay';
```

Change the provider's return so the overlay renders above children:
```tsx
  return (
    <TourContext.Provider value={{ active, steps, stepIndex, currentRect, startTour, next, back, skip, registerTarget, unregisterTarget }}>
      {children}
      {active && <TourOverlay />}
    </TourContext.Provider>
  );
```
(`TourOverlay` calls `useTour()`, which reads this same context — valid because it renders inside the provider.)

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (no NEW errors referencing `TourOverlay.tsx` / `TourContext.tsx`).

```bash
git add src/components/TourOverlay.tsx src/context/TourContext.tsx
git commit -m "Add TourOverlay spotlight + tooltip; render it from TourProvider"
```

---

### Task 5: Mount TourProvider + register tab-bar targets

**Files:**
- Modify: `App.tsx` (~36-49)
- Modify: `src/navigation/AppNavigator.tsx` (`CustomTabBar`, ~83-145)

**Interfaces:**
- Consumes: `TourProvider`, `useTour` (Task 3).

- [ ] **Step 1: Mount the provider**

In `App.tsx`, add the import:
```tsx
import { TourProvider } from './src/context/TourContext';
```

Wrap `NavigationContainer` with `TourProvider` (inside `SafeAreaProvider`, so the overlay reads insets and renders above the navigator). Replace the `<SafeAreaProvider> … </SafeAreaProvider>` body:
```tsx
        <SafeAreaProvider>
          <TourProvider>
            <NavigationContainer ref={navigationRef} linking={linking}>
              <StatusBar style="light" />
              <RootNavigator />
              <ToastHost />
            </NavigationContainer>
          </TourProvider>
        </SafeAreaProvider>
```

- [ ] **Step 2: Register the tab-bar targets**

In `src/navigation/AppNavigator.tsx`, inside `CustomTabBar`, add the import + a per-tab callback-ref factory.

Add import near the top:
```tsx
import { useTour } from '../context/TourContext';
import { measureNode } from '../context/TourContext';
```
(Or a single line: `import { useTour, measureNode } from '../context/TourContext';`)

Inside `CustomTabBar`, near the existing `const { accentColor } = useTheme();`, add:
```tsx
  const { registerTarget, unregisterTarget } = useTour();
  const makeTabRef = React.useCallback((routeName: string) => (node: any) => {
    const id = `tab:${routeName}`;
    if (node) registerTarget(id, () => measureNode(node));
    else unregisterTarget(id);
  }, [registerTarget, unregisterTarget]);
```

Attach the ref to BOTH the camera button and the normal tab button so `tab:Camera`, `tab:Create`, `tab:Notifications`, `tab:Profile`, `tab:Home` all register.

For the camera branch, add `ref={makeTabRef(route.name)}` + `collapsable={false}` to the `<TouchableOpacity style={[styles.cameraBtn, …]}>`:
```tsx
                  <TouchableOpacity
                    ref={makeTabRef(route.name)}
                    collapsable={false}
                    style={[styles.cameraBtn, isFocused && styles.cameraBtnActive, Platform.select({
                      default: { shadowColor: accentColor, shadowOpacity: isFocused ? 0.75 : 0.5, shadowRadius: isFocused ? 16 : 12, shadowOffset: { width: 0, height: 4 } },
                      web: {},
                    })]}
                    onPress={onPress}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Open camera"
                  >
```

For the normal tab `<TouchableOpacity key={route.key} style={styles.tab} …>`, add the ref + `collapsable={false}`:
```tsx
            <TouchableOpacity
              key={route.key}
              ref={makeTabRef(route.name)}
              collapsable={false}
              style={styles.tab}
              onPress={onPress}
              activeOpacity={0.7}
            >
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (no NEW errors referencing `App.tsx` / `AppNavigator.tsx`). (`TouchableOpacity` accepts a `ref`; `measureInWindow` resolves on its host view.)

```bash
git add App.tsx src/navigation/AppNavigator.tsx
git commit -m "Mount TourProvider and register bottom-tab tour targets"
```

---

### Task 6: HomeScreen — card + scan targets + the trigger

**Files:**
- Modify: `src/screens/app/HomeScreen.tsx` (`CapsuleCard` ~89-131, `scanBtn` ~360-370, `renderItem` ~406-414, top-of-component + effect)

**Interfaces:**
- Consumes: `useTour`, `useTourTarget`, `buildTourSteps` (Task 3); `consumeTourPending`, `tourSeen` (Task 1).

- [ ] **Step 1: Add imports**

In `src/screens/app/HomeScreen.tsx`:
```tsx
import { useTour, useTourTarget, buildTourSteps } from '../../context/TourContext';
import { consumeTourPending, tourSeen } from '../../lib/tourStorage';
```

- [ ] **Step 2: Let `CapsuleCard` accept a tour ref**

Change the `CapsuleCard` signature (~89) to accept an optional `innerRef` and attach it to the outer `Animated.View` (~100):
```tsx
function CapsuleCard({ capsule, onPress, onLongPress, index, variant = 'list', innerRef }: { capsule: CapsuleWithCountdown; onPress: () => void; onLongPress?: () => void; index: number; variant?: HomeLayout; innerRef?: (node: any) => void }) {
```
And on the outer `Animated.View`:
```tsx
    <Animated.View ref={innerRef} collapsable={false} style={[entrance, isGrid && styles.gridCell]}>
```

- [ ] **Step 3: Wire the card + scan refs + trigger in `HomeScreen`**

Near the other hooks at the top of the `HomeScreen` component (by `const { accentColor, homeLayout, setHomeLayout } = useTheme();`), add:
```tsx
  const { startTour } = useTour();
  const capsuleCardRef = useTourTarget('capsule-card');
  const scanRef = useTourTarget('home-scan');
```

Attach `scanRef` to the QR button (~362). Add `ref={scanRef}` to that `TouchableOpacity`:
```tsx
          <TouchableOpacity
            ref={scanRef}
            onPress={() => navigation.navigate('QRScanner')}
            hitSlop={8}
            style={styles.scanBtn}
            accessibilityRole="button"
            accessibilityLabel="Scan QR code to join a capsule"
          >
```
(Keep whatever props are already there; only add `ref={scanRef}`.)

Pass `capsuleCardRef` to the FIRST capsule card in `renderItem` (~406):
```tsx
          renderItem={({ item, index }) => (
            <CapsuleCard
              capsule={item}
              index={index}
              variant={homeLayout}
              innerRef={index === 0 ? capsuleCardRef : undefined}
              onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: item.id })}
              onLongPress={() => setMenuCapsule(item)}
            />
          )}
```
(Match the existing `CapsuleCard` props — only add `innerRef`. If the existing call passes props differently, keep them and just add the `innerRef` line.)

Add the trigger effect after `capsules`/`archivedCapsules` are computed (they read `allCapsules`):
```tsx
  // Fire the one-time new-user tour the first time Home loads after onboarding.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      if (!(await consumeTourPending())) return;   // read-and-clear; runs at most once
      if (await tourSeen()) return;
      if (cancelled) return;
      const active = (allCapsules ?? []).filter(c => !c.archived_at);
      const cap = active[0] ?? null;
      startTour(buildTourSteps({ hasCapsule: !!cap, capsuleId: cap?.id ?? null }));
    })();
    return () => { cancelled = true; };
  }, [loading]);
```
(Place it with the other `useEffect`s in the component body, after `loading`/`allCapsules` are in scope. `useEffect` is already imported in this file; if not, add it to the `react` import.)

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` (no NEW errors referencing `HomeScreen.tsx`).

```bash
git add src/screens/app/HomeScreen.tsx
git commit -m "Wire Home capsule-card + scan tour targets and the tour trigger"
```

---

### Task 7: CapsuleDetail — register the four in-capsule targets

**Files:**
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (CountdownRing ~1867, DefaultAwardsCard ~1890, Invite button ~1908, Add Media button ~2192)

**Interfaces:**
- Consumes: `useTourTarget` (Task 3).

- [ ] **Step 1: Add the import + refs**

In `src/screens/app/CapsuleDetailScreen.tsx`, add:
```tsx
import { useTourTarget } from '../../context/TourContext';
```

In the main `CapsuleDetailScreen` component body (near the other hooks), add:
```tsx
  const countdownTourRef = useTourTarget('capsule-countdown');
  const addMediaTourRef = useTourTarget('capsule-add-media');
  const inviteTourRef = useTourTarget('capsule-invite');
  const awardsTourRef = useTourTarget('capsule-awards');
```

- [ ] **Step 2: Attach each ref by wrapping the target in a measurable View**

Wrap the `CountdownRing` (~1867) so it's measurable:
```tsx
              <View ref={countdownTourRef} collapsable={false}>
                <CountdownRing unlockAt={capsule.unlock_at} createdAt={(capsule as any).created_at} />
              </View>
```

Wrap `DefaultAwardsCard` (~1890):
```tsx
          <View ref={awardsTourRef} collapsable={false}>
            <DefaultAwardsCard
              /* keep the existing props exactly */
            />
          </View>
```
(Preserve the existing `DefaultAwardsCard` props — only wrap it.)

Add `ref={inviteTourRef}` + `collapsable={false}` to the `+ Invite` `TouchableOpacity` (~1908):
```tsx
              <TouchableOpacity ref={inviteTourRef} collapsable={false} style={[styles.inviteBtn, { backgroundColor: `${accentColor}20` }]} onPress={() => setShowInvite(true)}>
                <Text style={[styles.inviteBtnText, { color: accentColor }]}>+ Invite</Text>
              </TouchableOpacity>
```

Add `ref={addMediaTourRef}` + `collapsable={false}` to the `+ Add Media` button (~2192 — attach to the enclosing `TouchableOpacity` whose child `Text` is `+ Add Media`; find that touchable and add the ref):
```tsx
              <TouchableOpacity ref={addMediaTourRef} collapsable={false} /* keep existing style + onPress */>
                <Text style={styles.addPhotoBtnText}>+ Add Media</Text>
              </TouchableOpacity>
```
(Read the actual element around line 2192 and add the ref to the touchable that contains the `+ Add Media` text, preserving all existing props. If that control is conditionally rendered — e.g. only for uploaders — that's fine; when absent, the tour step auto-skips.)

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (no NEW errors referencing `CapsuleDetailScreen.tsx`).

```bash
git add src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Register capsule countdown/add-media/invite/awards tour targets"
```

---

### Task 8: Onboarding trigger flag + CLAUDE.md

**Files:**
- Modify: `src/screens/app/OnboardingScreen.tsx` (`saveProfile` ~242)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `setTourPending` (Task 1).

- [ ] **Step 1: Set the pending flag on onboarding completion**

In `src/screens/app/OnboardingScreen.tsx`, add the import:
```tsx
import { setTourPending } from '../../lib/tourStorage';
```

In `saveProfile()`, right after `sessionStore.markOnboarded(userId);` (the true completion point that every exit path hits), add:
```tsx
    sessionStore.markOnboarded(userId);
    setTourPending(); // arm the one-time new-user tour; Home consumes it on first load
    return true;
```

- [ ] **Step 2: End-to-end sanity (manual, documented)**

There is no automated E2E harness. Confirm by reading the wired chain that: onboarding `saveProfile` → `setTourPending` → Home effect `consumeTourPending()` (true once) → `startTour(buildTourSteps(...))` → overlay renders → Next drives `navigationRef` → `skip`/last-step `Done` calls `markTourSeen()`. Note in the commit that on-device verification (esp. the native measure timing + the CapsuleDetail navigation hop) is pending a run, mirroring how other native-timing features in this repo are build-verified.

- [ ] **Step 3: Update CLAUDE.md**

Add a concise section (terse decision-and-reason voice, per the update-claude-md convention) documenting the tour. Put it near the Onboarding / Navigation area:
- **New-user tour** — `TourProvider`/`useTour`/`useTourTarget` (`src/context/TourContext.tsx`) + `TourOverlay` (`src/components/TourOverlay.tsx`): a one-time coach-mark walkthrough that spotlights real elements (four dim panels around a `measureInWindow` rect — works web+native, no SVG) and drives `navigationRef` across screens. Steps come from `buildTourSteps(...)` (`src/lib/tourSteps.ts`); adaptive branch (has-capsule = full Home→CapsuleDetail walkthrough; no-capsule = join-first, create-optional). Elements register via `useTourTarget(id)` callback refs (tab bar ids `tab:<Route>`, `home-scan`, `capsule-card`, `capsule-{countdown,add-media,invite,awards}`); an unmeasurable target auto-skips its step. Gated by `cap_tour_pending` (set in `OnboardingScreen.saveProfile`, consumed once by Home) + `cap_tour_seen` (set on finish/skip) via `src/lib/tourStorage.ts` — per-install, mirrors `cap_camera_coach_seen`. In-capsule stops target what a fresh **locked** capsule shows (no post-unlock `AwardsSection`). `waitForTarget` (`src/lib/waitForTarget.ts`) is the pure, unit-tested poll loop.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/OnboardingScreen.tsx CLAUDE.md
git commit -m "Arm new-user tour on onboarding completion; document in CLAUDE.md"
```

---

## Self-Review

**1. Spec coverage:**
- Custom engine (registry, controller, overlay, four-panel dim, web+native) → Tasks 3-4. ✅
- Adaptive step lists + join-first / create-optional copy → Task 1 (`buildTourSteps`). ✅
- Targets: tab bar → Task 5; card + scan + trigger → Task 6; countdown/add-media/invite/awards → Task 7. ✅
- Trigger + persistence (`cap_tour_pending`/`cap_tour_seen`, consume-once, set-on-completion) → Task 1 (storage) + Task 6 (consume) + Task 8 (set). ✅
- Cross-screen nav via `navigationRef`; auto-skip unmeasurable; tour-driven navigation → Task 3. ✅
- Testing: `tourSteps` + `waitForTarget` unit tests → Tasks 1-2. ✅
- Mount inside ThemeProvider/SafeAreaProvider → Task 5. ✅
- CLAUDE.md → Task 8. ✅

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The two spots that say "keep existing props" (Add Media touchable, DefaultAwardsCard) are explicit *preserve-and-wrap* instructions with the surrounding code shown, not vague placeholders — correct given those elements' full prop lists are long and unrelated to the change.

**3. Type consistency:** `Rect`/`MeasureFn` identical across Tasks 2→3. `TourStep`/`buildTourSteps` identical across Tasks 1→3→6. `useTour()` shape (incl. `registerTarget`/`unregisterTarget`/`startTour`/`next`/`back`/`skip`) identical across Tasks 3→4→5→6. `useTourTarget(id) => (node)=>void` identical across Tasks 3→6→7. `measureNode` exported from Task 3, consumed in Task 5. Target ids match `tourSteps.ts` (`tab:Camera`/`tab:Create`/`tab:Notifications`/`tab:Profile`, `home-scan`, `capsule-card`, `capsule-countdown`/`-add-media`/`-invite`/`-awards`).
