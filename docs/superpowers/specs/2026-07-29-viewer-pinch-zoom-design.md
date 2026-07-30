# Pinch-to-zoom in the media viewer — design

_2026-07-29 · branch `feat/viewer-pinch-zoom`_

## Problem

`MediaViewerModal` (`src/screens/app/CapsuleDetailScreen.tsx`) shows media
full-screen at fit-to-window and offers no way to inspect detail. On a photo of
a group, a whiteboard, or a document, there is no way to look closer.

## Constraints discovered

- **No gesture library exists.** `react-native-gesture-handler` and
  `react-native-reanimated` are absent from `package.json` *and* from
  `node_modules` — not even transitive. The viewer is hand-rolled on
  `PanResponder` + built-in `Animated`.
- **One PanResponder owns the whole viewer** (`CapsuleDetailScreen.tsx:859-896`),
  axis-locked on first movement: `v` (downward) closes the modal with a
  background fade, `h` pages between items via `translateX`. Zoom has to share
  that gesture space.
- **`CameraScreen` already implements pinch with a raw `PanResponder`**, so
  two-finger gesture handling has an in-repo precedent to follow.
- **`VideoSlide` does not set `nativeControls`**, so expo-video's default native
  controls are active. That overlay consumes touches, so a pinch would likely
  never reach the `PanResponder`, and scaling the container would distort the
  controls along with the video. This is why video is excluded — see below.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Gesture implementation | Extend the existing `PanResponder` | No new native dependency, so it ships in the build already being planned — no extra EAS/provisioning churn mid-submission. Matches `CameraScreen`'s existing pinch idiom. |
| Surfaces | Full-screen viewer, **photos only** | The grid/gallery would fight the `FlatList` scroll gesture, and nobody inspects detail from a thumbnail. |
| Interactions | Pinch to zoom + drag to pan | Double-tap-to-zoom and rubber-band-past-limits deliberately excluded. |
| Video | **Excluded entirely** — `VideoSlide` is not modified | Zooming video would require disabling native controls (the overlay eats the touches), which costs the scrubber and adds a tap-to-pause replacement. All of the device-only risk in this feature sat there; photos carry none of it. |

Accepted cost of the `PanResponder` route: gesture tracking runs on the JS
thread, so zoom may feel marginally less silky than a native-thread
implementation. The viewer's existing paging already works this way.

## Architecture

### Where the transform goes

Zoom applies to the **individual slide cell of the current index**, never the
slide row. The row's `translateX` *is* the paging mechanism — scaling it would
scale every slide at once and corrupt the page math (each slide is positioned at
`index * SCREEN_WIDTH`). Non-current slides keep an identity transform.

### Gesture routing

`onPanResponderMove` currently ignores its event argument (`(_, {dx, dy})`). It
starts reading `evt.nativeEvent.touches` to distinguish:

| Touches | Condition | Behavior |
|---|---|---|
| 2 | current item is a **photo** | **Pinch.** Scale = `baseScale × (currentDistance / startDistance)`, clamped `[1, 4]`. Sets `axis.current = 'zoom'`. |
| 2 | current item is a **video** | Ignored — falls through to today's behavior. |
| 1 | `scale > 1` | **Pan** the zoomed image, clamped to its own edges. |
| 1 | `scale === 1` | Today's behavior — unchanged. |

⚠️ **The photo-only gate must live in the gesture branch, not just the render.**
If the pinch branch ran for videos and only the render were gated, a two-finger
gesture on a video would silently accumulate scale state that nothing draws —
and then the *next* photo could inherit a non-1 scale, or panning would engage
with nothing zoomed. Gate at the source so video slides behave exactly as they
do today.

`axis.current = 'zoom'` locks out both paging and swipe-to-close for the
duration of the gesture, so a two-finger pinch can never be misread as a
downward swipe and dismiss the viewer mid-zoom.

On release: a scale below `1.05` springs back to exactly `1` and clears the pan
(prevents a near-1 scale leaving the image subtly off-centre and un-pannable).
Otherwise the scale and pan persist for continued inspection.

**Paging is suppressed while zoomed.** To move to the next photo, pinch back
out. Allowing a page-flip once panned to the edge is the fancier behavior and is
deliberately out of scope.

**Zoom resets on photo change** — `goToIndex` clears scale and pan, so arriving
at a new photo always starts fit-to-window.

### Pan clamping

Maximum offset on each axis is `(scale - 1) × dimension / 2`, so the image can
never be dragged past its own edge into empty space. At `scale === 1` the bound
is `0`, which is what makes the "1 touch, scale === 1" branch fall through to
existing behavior cleanly.

### ⚠️ Native-driver consistency

Every animation on the new `scale` / `panX` / `panY` values must use
`useNativeDriver: true`, without exception.

This repo has already shipped this bug: CLAUDE.md records the members bottom
sheet, where mixing drivers on a single component-lifetime `Animated.Value`
worked on the first open/close cycle and then silently stopped responding to
drags forever, because React Native permanently latches a value to the native
driver the first time `useNativeDriver: true` runs on it. The new values are
component-lifetime `useRef`s with the same exposure.

### Video is not modified

`VideoSlide` is untouched: native controls stay on, playback behavior is
unchanged, and no tap handler is added. Excluding video also removes the
tap-detection problem entirely — the viewer's `onStartShouldSetPanResponder`
returns `true`, so it claims every touch before any child `Pressable` could see
it, and a tap-to-pause would have had to be reverse-engineered out of
`onPanResponderRelease`. None of that is needed now.

## Testability

The gesture wiring is manual QA, but the math is pure and extracts to
**`src/lib/zoomMath.ts`**, tested with `node:assert/strict` under `npx tsx`,
matching the `src/lib/recurrence.test.ts` convention:

- `distanceBetween(touchA, touchB)` — pinch distance.
- `clampScale(next)` — bounds to `[1, 4]`.
- `clampPan(offset, scale, dimension)` — bounds to `±(scale - 1) × dimension / 2`.
- `shouldSnapBack(scale)` — the `< 1.05` reset rule.

Test cases include `scale === 1` producing a zero pan bound, the snap-back
boundary from both sides, and degenerate two-touch input (identical points →
zero distance, which must not produce `NaN` or `Infinity` scale).

## Out of scope

- **Video zoom** — deliberately deferred. Would need `nativeControls={false}`
  (losing the scrubber), a replacement tap-to-pause detected inside
  `onPanResponderRelease`, and on-device verification that a scaled video layer
  renders acceptably. All of this feature's unverifiable risk lived there.
- Double-tap to zoom, rubber-banding past limits.
- Zoom in the 3-up grid or `MediaGalleryModal`.
- Page-flip while zoomed at the pan edge.
- Any new native dependency.

## Files

| File | Change |
|---|---|
| `src/lib/zoomMath.ts` | new — pure clamping/distance helpers |
| `src/lib/zoomMath.test.ts` | new — unit tests |
| `src/screens/app/CapsuleDetailScreen.tsx` | `MediaViewerModal` gesture routing + per-slide transform on photo cells. `VideoSlide` unchanged. |
| `CLAUDE.md` | document the gesture-axis model and the native-driver constraint |
