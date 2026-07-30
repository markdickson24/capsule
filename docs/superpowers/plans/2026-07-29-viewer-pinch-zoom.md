# Pinch-to-Zoom in the Media Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pinch to zoom and drag to pan photos in Capsule's full-screen media viewer.

**Architecture:** The viewer already owns one axis-locked `PanResponder` that handles paging (`h`) and swipe-to-close (`v`). This adds a third axis, `zoom`, driven by reading `evt.nativeEvent.touches` — no gesture library. The pure math lives in a separate, unit-tested module; the gesture wiring stays in `MediaViewerModal`.

**Tech Stack:** React Native 0.81.5 `PanResponder` + built-in `Animated`, expo-image, TypeScript. No new dependencies.

Spec: `docs/superpowers/specs/2026-07-29-viewer-pinch-zoom-design.md`

## Global Constraints

- **No new dependencies.** `react-native-gesture-handler` and `react-native-reanimated` are absent from `package.json` and `node_modules`, and must stay that way. Use `PanResponder` + `Animated` only.
- **`useNativeDriver: true` on every animation touching `zoomScale` / `panX` / `panY`, without exception.** React Native permanently latches an `Animated.Value` to the native driver the first time `useNativeDriver: true` runs on it; mixing drivers on a component-lifetime value works once and then silently stops responding. This repo already shipped that bug in the members bottom sheet (see CLAUDE.md).
- **Photos only. `VideoSlide` must not be modified at all** — no `nativeControls` change, no tap handler, no wrapper.
- **The photo-only gate lives in the gesture branch, not the render.** A pinch on a video must not accumulate scale state.
- Zoom range `[1, 4]`. Snap back to exactly `1` below `1.05`.
- Tests are bare `node:assert/strict` scripts run with `npx tsx <file>`, ending in `console.log('<name>: all assertions passed')`. No test framework exists or should be added.
- Transform order is `[{translateX}, {translateY}, {scale}]` — translate before scale, so pan tracks the finger 1:1 (translation is applied in untransformed coordinate space).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/zoomMath.ts` | **New.** Pure: pinch distance, scale clamping, pan bounds, snap-back rule. No React, no RN imports. |
| `src/lib/zoomMath.test.ts` | **New.** Unit tests. |
| `src/screens/app/CapsuleDetailScreen.tsx` | **Modify.** `MediaViewerModal` only: animated values, gesture routing, per-cell transform, reset on page change. `VideoSlide` untouched. |
| `CLAUDE.md` | **Modify.** Document the gesture-axis model and the native-driver constraint. |

---

## Task 1: Pure zoom math

**Files:**
- Create: `src/lib/zoomMath.ts`
- Test: `src/lib/zoomMath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MIN_ZOOM: number`, `MAX_ZOOM: number`, `SNAP_BACK_BELOW: number`, `TouchPoint` type (`{ pageX: number; pageY: number }`), `distanceBetween(a: TouchPoint, b: TouchPoint): number`, `clampScale(scale: number): number`, `scaleFromPinch(baseScale: number, startDistance: number, currentDistance: number): number`, `panBound(scale: number, dimension: number): number`, `clampPan(offset: number, scale: number, dimension: number): number`, `shouldSnapBack(scale: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/zoomMath.test.ts`:

```ts
import assert from 'node:assert/strict';
import {
  clampPan,
  clampScale,
  distanceBetween,
  panBound,
  scaleFromPinch,
  shouldSnapBack,
  MAX_ZOOM,
  MIN_ZOOM,
  SNAP_BACK_BELOW,
} from './zoomMath';

assert.equal(MIN_ZOOM, 1);
assert.equal(MAX_ZOOM, 4);
assert.equal(SNAP_BACK_BELOW, 1.05);

// --- distanceBetween -------------------------------------------------------
// 3-4-5 triangle.
assert.equal(distanceBetween({ pageX: 0, pageY: 0 }, { pageX: 3, pageY: 4 }), 5);
// Order does not matter.
assert.equal(distanceBetween({ pageX: 3, pageY: 4 }, { pageX: 0, pageY: 0 }), 5);
// Two fingers landing on the exact same pixel is physically possible and must
// yield 0, not NaN — scaleFromPinch depends on this being a real number.
assert.equal(distanceBetween({ pageX: 7, pageY: 7 }, { pageX: 7, pageY: 7 }), 0);

// --- clampScale ------------------------------------------------------------
assert.equal(clampScale(2), 2);
assert.equal(clampScale(0.3), MIN_ZOOM);
assert.equal(clampScale(99), MAX_ZOOM);
assert.equal(clampScale(MIN_ZOOM), MIN_ZOOM);
assert.equal(clampScale(MAX_ZOOM), MAX_ZOOM);
// Non-finite input must degrade to "not zoomed" rather than propagate.
assert.equal(clampScale(NaN), MIN_ZOOM);
assert.equal(clampScale(Infinity), MIN_ZOOM);
assert.equal(clampScale(-Infinity), MIN_ZOOM);

// --- scaleFromPinch --------------------------------------------------------
// Fingers move twice as far apart -> twice the scale.
assert.equal(scaleFromPinch(1, 100, 200), 2);
// Fingers come together -> scale shrinks, clamped at 1.
assert.equal(scaleFromPinch(2, 200, 100), 1);
// Continues from the scale the pinch started at, not from 1.
assert.equal(scaleFromPinch(2, 100, 150), 3);
// Clamped at the top.
assert.equal(scaleFromPinch(3, 100, 400), MAX_ZOOM);
// A zero or negative start distance would divide by zero. Must return the base
// scale, never NaN/Infinity — this is the two-fingers-same-pixel case.
assert.equal(scaleFromPinch(2, 0, 150), 2);
assert.equal(scaleFromPinch(1, -5, 150), 1);
assert.ok(Number.isFinite(scaleFromPinch(1, 0, 0)));

// --- panBound --------------------------------------------------------------
// Not zoomed -> no room to pan at all. This is what makes the "1 touch,
// scale === 1" gesture branch fall through to the existing paging behavior.
assert.equal(panBound(1, 400), 0);
assert.equal(panBound(0.5, 400), 0);
// At 2x on a 400pt axis the image overflows by 400pt, 200 on each side.
assert.equal(panBound(2, 400), 200);
assert.equal(panBound(3, 400), 400);

// --- clampPan --------------------------------------------------------------
assert.equal(clampPan(50, 2, 400), 50);
assert.equal(clampPan(500, 2, 400), 200);
assert.equal(clampPan(-500, 2, 400), -200);
// Not zoomed -> pinned to centre regardless of offset.
assert.equal(clampPan(120, 1, 400), 0);
assert.equal(clampPan(-120, 1, 400), 0);
// Exactly at the bound stays put.
assert.equal(clampPan(200, 2, 400), 200);

// --- shouldSnapBack --------------------------------------------------------
assert.equal(shouldSnapBack(1), true);
assert.equal(shouldSnapBack(1.04), true);
assert.equal(shouldSnapBack(SNAP_BACK_BELOW), false);
assert.equal(shouldSnapBack(2), false);
assert.equal(shouldSnapBack(MAX_ZOOM), false);
// A corrupted scale must resolve to "snap back to a known-good state".
assert.equal(shouldSnapBack(NaN), true);

console.log('zoomMath.test.ts: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx src/lib/zoomMath.test.ts
```

Expected: FAIL — `Cannot find module './zoomMath'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/zoomMath.ts`:

```ts
// Pure math for pinch-to-zoom in the full-screen media viewer.
//
// No React, no react-native imports — so it can be unit-tested under plain
// node via `npx tsx`, the same way src/lib/recurrence.ts is.
//
// Every function here is defensive about non-finite input. Pinch input comes
// from raw touch coordinates, and two fingers landing on the same pixel makes
// the distance 0; a NaN or Infinity leaking into an Animated.Value corrupts the
// transform with no visible error, so the safe direction is always "not zoomed".

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Below this, a released pinch snaps back to exactly MIN_ZOOM. */
export const SNAP_BACK_BELOW = 1.05;

export type TouchPoint = { pageX: number; pageY: number };

/** Straight-line distance between two touches. */
export function distanceBetween(a: TouchPoint, b: TouchPoint): number {
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Bounds a scale to [MIN_ZOOM, MAX_ZOOM]. Non-finite input degrades to MIN_ZOOM. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Scale for an in-progress pinch: the scale the gesture started at, multiplied
 * by how much the finger spread has grown.
 *
 * A start distance of 0 (two fingers on one pixel) would divide by zero, so it
 * returns the base scale unchanged.
 */
export function scaleFromPinch(
  baseScale: number,
  startDistance: number,
  currentDistance: number
): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) return clampScale(baseScale);
  return clampScale(baseScale * (currentDistance / startDistance));
}

/**
 * How far the image may be panned from centre on one axis.
 *
 * At scale s the image occupies `s × dimension`, overflowing the viewport by
 * `(s - 1) × dimension` — half of it on each side. At scale 1 this is 0, which
 * is what keeps an unzoomed image pinned to centre.
 */
export function panBound(scale: number, dimension: number): number {
  if (!Number.isFinite(scale) || scale <= MIN_ZOOM) return 0;
  return ((scale - MIN_ZOOM) * dimension) / 2;
}

/** Bounds a pan offset so the image can never be dragged past its own edge. */
export function clampPan(offset: number, scale: number, dimension: number): number {
  const bound = panBound(scale, dimension);
  return Math.min(bound, Math.max(-bound, offset));
}

/**
 * True when a released gesture should reset to unzoomed. Written as a negated
 * `>=` so a NaN scale returns true and resolves to a known-good state.
 */
export function shouldSnapBack(scale: number): boolean {
  return !(scale >= SNAP_BACK_BELOW);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx src/lib/zoomMath.test.ts
```

Expected: PASS — prints `zoomMath.test.ts: all assertions passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zoomMath.ts src/lib/zoomMath.test.ts
git commit -m "Add pure zoom math for the media viewer

Pinch distance, scale clamping, pan bounds and the snap-back rule, extracted so
they can be unit-tested under node. Every function degrades non-finite input to
'not zoomed' — two fingers on one pixel makes the pinch distance 0, and a NaN
reaching an Animated.Value corrupts the transform with no visible error."
```

---

## Task 2: Wire zoom into MediaViewerModal

**Files:**
- Modify: `src/screens/app/CapsuleDetailScreen.tsx` (`MediaViewerModal` only — around lines 773-778, 819-825, 859-896, 906-912)

**Interfaces:**
- Consumes: `distanceBetween`, `scaleFromPinch`, `clampPan`, `shouldSnapBack` from `../../lib/zoomMath` (Task 1).
- Produces: no exports. Behavior verified by manual QA in Task 2 Step 7.

- [ ] **Step 1: Add the import**

At the top of `src/screens/app/CapsuleDetailScreen.tsx`, alongside the other `../../lib/` imports:

```ts
import { clampPan, distanceBetween, scaleFromPinch, shouldSnapBack } from '../../lib/zoomMath';
```

- [ ] **Step 2: Add animated values and gesture state**

In `MediaViewerModal`, immediately after the existing `bgOpacity` declaration (currently line 775) and before the `axis` ref:

```ts
  // Pinch-to-zoom state (photos only).
  //
  // ⚠️ Every animation on these three MUST pass useNativeDriver: true. React
  // Native permanently latches an Animated.Value to the native driver the first
  // time a native-driven animation runs on it; mixing drivers on a
  // component-lifetime value works for one cycle and then silently stops
  // responding. This repo already shipped that bug in the members bottom sheet.
  const zoomScale = useRef(new Animated.Value(1)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // JS-side mirrors of the above. Animated.Value has no synchronous getter, and
  // the gesture handlers need the current values to do their math each move.
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // Snapshots taken at the start of a gesture.
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const panStart = useRef({ x: 0, y: 0 });
```

- [ ] **Step 3: Widen the axis type and add the reset helper**

Change the `axis` ref (currently line 778) from:

```ts
  const axis = useRef<'none' | 'h' | 'v'>('none');
```

to:

```ts
  const axis = useRef<'none' | 'h' | 'v' | 'zoom'>('none');
```

Then add directly below it:

```ts
  // Return to fit-to-window immediately, with no animation. Used when changing
  // photo, where an animated unzoom would visibly play during the page slide.
  const resetZoom = () => {
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    pinchStartDistance.current = 0;
    zoomScale.setValue(1);
    panX.setValue(0);
    panY.setValue(0);
  };
```

- [ ] **Step 4: Reset zoom when the photo changes**

In `goToIndex` (currently line 819), add `resetZoom()` as the first statement:

```ts
  const goToIndex = (index: number) => {
    resetZoom();
    setEditingCaption(false);
    currentIndexRef.current = index;
    setCurrentIndex(index);
    setCurrentItemId(items[index]?.id ?? null);
    Animated.spring(translateX, { toValue: -index * SCREEN_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
  };
```

- [ ] **Step 5: Replace the PanResponder**

Replace the whole `panResponder` block (currently lines 859-896) with:

```ts
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        axis.current = 'none';
        pinchStartDistance.current = 0;
        // Snapshot where the image already sits, so a pan continues from here
        // rather than jumping back to centre.
        panStart.current = { ...panRef.current };
      },
      onPanResponderMove: (evt, { dx, dy }) => {
        const touches = evt.nativeEvent.touches;
        // Photo-only gate lives HERE, not in the render. If a pinch on a video
        // were allowed to run and only the drawing were suppressed, the scale
        // state would still accumulate and leak into the next photo.
        const isPhoto = items[currentIndexRef.current]?.mediaType === 'photo';

        // --- two fingers: pinch ---
        if (touches.length === 2 && isPhoto) {
          axis.current = 'zoom';
          const distance = distanceBetween(touches[0], touches[1]);
          if (pinchStartDistance.current === 0) {
            // First frame of this pinch — record the baseline and wait.
            pinchStartDistance.current = distance;
            pinchStartScale.current = scaleRef.current;
            return;
          }
          const nextScale = scaleFromPinch(pinchStartScale.current, pinchStartDistance.current, distance);
          scaleRef.current = nextScale;
          zoomScale.setValue(nextScale);
          // Re-clamp the existing pan against the new scale: zooming back out
          // shrinks the allowed range, and without this the image would be left
          // stranded off-centre with no way to recover it.
          const cx = clampPan(panRef.current.x, nextScale, SCREEN_WIDTH);
          const cy = clampPan(panRef.current.y, nextScale, SCREEN_HEIGHT);
          panRef.current = { x: cx, y: cy };
          panX.setValue(cx);
          panY.setValue(cy);
          return;
        }

        // A pinch stays a pinch for the rest of the gesture, even if one finger
        // lifts — otherwise releasing a finger mid-zoom would page or dismiss.
        if (axis.current === 'zoom') return;

        // --- one finger while zoomed: pan the image ---
        if (scaleRef.current > 1 && isPhoto) {
          const cx = clampPan(panStart.current.x + dx, scaleRef.current, SCREEN_WIDTH);
          const cy = clampPan(panStart.current.y + dy, scaleRef.current, SCREEN_HEIGHT);
          panRef.current = { x: cx, y: cy };
          panX.setValue(cx);
          panY.setValue(cy);
          return;
        }

        // --- unzoomed: existing axis-locked paging / swipe-to-close ---
        if (axis.current === 'none') {
          if (dy > 8 && dy > Math.abs(dx)) axis.current = 'v';
          else if (Math.abs(dx) > 8) axis.current = 'h';
        }
        if (axis.current === 'v' && dy > 0) {
          translateY.setValue(dy);
          bgOpacity.setValue(Math.max(0, 1 - dy / (SCREEN_HEIGHT * 0.45)));
        } else if (axis.current === 'h') {
          translateX.setValue(-currentIndexRef.current * SCREEN_WIDTH + dx);
        }
      },
      onPanResponderRelease: (_, { dx, dy, vx, vy }) => {
        // Anything zoom-related ends here — never page or dismiss out of a zoom.
        if (axis.current === 'zoom' || scaleRef.current > 1) {
          if (shouldSnapBack(scaleRef.current)) {
            scaleRef.current = 1;
            panRef.current = { x: 0, y: 0 };
            Animated.parallel([
              Animated.spring(zoomScale, { toValue: 1, useNativeDriver: true, bounciness: 0 }),
              Animated.spring(panX, { toValue: 0, useNativeDriver: true, bounciness: 0 }),
              Animated.spring(panY, { toValue: 0, useNativeDriver: true, bounciness: 0 }),
            ]).start();
          }
          axis.current = 'none';
          pinchStartDistance.current = 0;
          return;
        }

        if (axis.current === 'v') {
          if (dy > 120 || vy > 1.5) {
            Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }).start(onClose);
          } else {
            Animated.parallel([
              Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
              Animated.spring(bgOpacity, { toValue: 1, useNativeDriver: true }),
            ]).start();
          }
        } else {
          const idx = currentIndexRef.current;
          let next = idx;
          if ((dx < -SCREEN_WIDTH * 0.25 || vx < -0.5) && idx < items.length - 1) next = idx + 1;
          else if ((dx > SCREEN_WIDTH * 0.25 || vx > 0.5) && idx > 0) next = idx - 1;
          goToIndex(next);
        }
        axis.current = 'none';
        pinchStartDistance.current = 0;
      },
    })
  ).current;
```

- [ ] **Step 6: Wrap ONLY the image in the transform**

⚠️ **Do not put the transform on the photo cell `View` itself.** That cell
(currently lines 912-948) also contains the dual-photo **swap button**
(`styles.swapBubble`, lines 937-947). Scaling the cell would scale and translate
that button with the image — at 4x it balloons and drifts off-screen. The
transform goes on a wrapper around the `<Image>` alone, leaving the swap button
as an unscaled sibling.

The photo branch currently reads (abridged):

```tsx
                  <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', backgroundColor: '#000' }}>
                    <Image
                      source={{ /* ...unchanged... */ }}
                      style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                      contentFit="contain"
                      transition={150}
                    />
                    {/* Dual (PiP) photo — tap the corner bubble to swap which lens is the main frame. */}
                    {item.altSignedUrl && (
                      <TouchableOpacity style={styles.swapBubble} /* ...unchanged... */>
                        <Ionicons name="sync-outline" size={16} color="#FFFFFF" />
                      </TouchableOpacity>
                    )}
                  </View>
```

Leave the outer `View`, the `<Image>` props, and the whole `TouchableOpacity`
block exactly as they are. Insert an `Animated.View` around the `<Image>` only:

```tsx
                  <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', backgroundColor: '#000' }}>
                    <Animated.View
                      style={{
                        width: SCREEN_WIDTH,
                        height: SCREEN_HEIGHT,
                        // Applied to every photo cell, not just the current one.
                        // That is safe because zoom is always 1 whenever more
                        // than one cell can be seen: paging is suppressed while
                        // zoomed, and goToIndex resets zoom. Keeping it
                        // unconditional avoids swapping a native-driven
                        // transform on and off a mounted view.
                        //
                        // Order matters: translate BEFORE scale, so the pan is
                        // applied in untransformed space and tracks the finger
                        // 1:1 — the assumption clampPan's bound encodes.
                        transform: [{ translateX: panX }, { translateY: panY }, { scale: zoomScale }],
                      }}
                    >
                      <Image
                        source={{ /* ...unchanged... */ }}
                        style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                        contentFit="contain"
                        transition={150}
                      />
                    </Animated.View>
                    {/* swap button stays here, OUTSIDE the Animated.View — unscaled */}
                    {item.altSignedUrl && (
                      <TouchableOpacity style={styles.swapBubble} /* ...unchanged... */>
                        <Ionicons name="sync-outline" size={16} color="#FFFFFF" />
                      </TouchableOpacity>
                    )}
                  </View>
```

The caption banner (currently lines 952-956) already sits outside this branch, in
the slide cell, so it stays unscaled with no change needed. Do not touch the
video branch's `View` tags.

A mismatched tag here will surface as a syntax error in Step 7's `tsc` run.

- [ ] **Step 7: Verify**

```bash
npx tsx src/lib/zoomMath.test.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "TS2307" | grep -v "Cannot find name 'Netlify'" | grep -v "^supabase/functions/" | grep -v "^netlify/"
```

Expected: test passes; the `tsc` filter prints nothing (the excluded patterns are pre-existing repo-wide noise — missing `@expo/vector-icons` types and Deno globals — not caused by this change).

Then confirm by reading the file that:
- `VideoSlide` is byte-identical to before this task.
- Every `Animated.spring` / `Animated.timing` added in Step 5 passes `useNativeDriver: true`.
- No `Animated.Value` other than `zoomScale`, `panX`, `panY` was added.

- [ ] **Step 8: Commit**

```bash
git add src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Add pinch-to-zoom and pan to the media viewer

Extends the viewer's existing axis-locked PanResponder with a 'zoom' axis read
from evt.nativeEvent.touches — no gesture library, matching CameraScreen's
existing pinch idiom.

Two fingers on a photo pinch between 1x and 4x; one finger while zoomed pans,
clamped so the image cannot be dragged past its own edge. Paging and
swipe-to-close are suppressed while zoomed, and changing photo resets to
fit-to-window.

Videos are gated out in the gesture branch rather than the render, so a pinch on
a video cannot accumulate scale state that leaks into the next photo.
VideoSlide is unchanged."
```

---

## Task 3: Document it

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1-2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Document the viewer's gesture model**

In `CLAUDE.md`, find the `**MediaViewerModal**` bullet in the "CapsuleDetailScreen Key Patterns" section (it currently begins "full-screen swipe carousel. Gesture axis is locked on first movement"). Append to that bullet:

```markdown
  **Pinch-to-zoom (photos only).** The single `PanResponder` carries a third
  axis, `zoom`, driven by reading `evt.nativeEvent.touches` — there is no
  gesture library in this project (`react-native-gesture-handler` and
  `react-native-reanimated` are absent from `package.json` *and* `node_modules`),
  so two-finger handling is hand-rolled, the same way `CameraScreen` does its
  pinch. Two touches scale between 1x and 4x; one touch while `scale > 1` pans,
  clamped to `±(scale − 1) × dimension / 2` so the image can't be dragged past
  its own edge. Paging and swipe-to-close are both suppressed while zoomed, and
  `goToIndex` resets zoom, so scale is always 1 whenever more than one slide is
  visible. The pure math is `src/lib/zoomMath.ts` (unit-tested); the gesture
  wiring is in the viewer.
  ⚠️ **Videos are excluded, and the gate is in the gesture branch — not the
  render.** `VideoSlide` uses expo-video's default `nativeControls`, whose
  overlay consumes touches, so a pinch likely never reaches the handler anyway;
  and scaling the container would distort the controls. If the gate were only on
  the drawing, a pinch on a video would still accumulate scale state that
  nothing displays and then leak into the next photo.
  ⚠️ **`zoomScale`/`panX`/`panY` must animate with `useNativeDriver: true`
  everywhere.** They're component-lifetime `useRef` values, so they have exactly
  the exposure that made the members sheet stop responding on its second open —
  see that entry below.
  ⚠️ **Transform order is `[{translateX}, {translateY}, {scale}]`.** Translate
  before scale means the pan is applied in untransformed space and tracks the
  finger 1:1, which is the assumption `clampPan`'s bound encodes. Reordering it
  silently makes panning drift at high zoom.
```

- [ ] **Step 2: Verify the claims against the code**

Re-read the edited section against `src/screens/app/CapsuleDetailScreen.tsx` and `src/lib/zoomMath.ts`. Confirm the zoom range, the clamp formula, the transform order, and the axis name `'zoom'` all match the implementation exactly. CLAUDE.md is the source of truth for future sessions — a wrong claim here is worse than no claim.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document viewer pinch-to-zoom in CLAUDE.md

Covers the third gesture axis, why videos are gated in the gesture branch rather
than the render, the native-driver requirement on the new Animated.Values, and
why the transform order is load-bearing."
```

---

## Notes for the reviewer

- **Fixed, not a small approximation:** the original version of this plan clamped pan bounds against `SCREEN_WIDTH`/`SCREEN_HEIGHT`, describing the risk as "a fully-panned image can show a sliver of black beyond its edge." That estimate was wrong — because the photo renders with `contentFit="contain"` and is letterboxed on one axis, the real effect was that a letterboxed photo could be dragged **completely off screen**, leaving the user staring at black with no way back short of closing and reopening the viewer (e.g. a 390×844 device showing a 16:9 photo at 4x zoom: the meaningful vertical bound is ~163pt, but the screen-based clamp allowed 1266pt of travel). Fixed by clamping against the image's actual contain-fit rendered size instead of the screen: `MediaViewerModal` now records each photo's intrinsic pixel size from expo-image's `onLoad` (keyed by media id in a ref, so it doesn't trigger re-renders), derives the rendered `dispW`/`dispH` via the same `contentFit="contain"` math, and passes those to `clampPan` in both the pinch re-clamp and the one-finger pan branch — falling back to the screen dimensions only while a photo's intrinsic size isn't known yet (not yet loaded).
- **Watch the swap button.** The photo cell also holds the dual-photo swap
  bubble; the transform must wrap the `<Image>` only, or that button scales and
  drifts off-screen at high zoom. Step 6 has the exact structure. Worth
  eyeballing on a dual-camera photo specifically.
- **Not covered by tests:** the gesture wiring itself. Only the math is unit-tested — the `PanResponder` branches need manual QA on a device. Worth checking specifically: pinching and releasing below 1.05 snaps cleanly back; pinching a *video* does nothing at all and still pages normally; and swiping to the next photo after zooming arrives fit-to-window.
- **No rebuild required** for testing — this is JS-only, no native dependency added, so it runs in the existing dev client.
