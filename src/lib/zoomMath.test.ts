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
