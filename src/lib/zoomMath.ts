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
  const clamped = Math.min(bound, Math.max(-bound, offset));
  // Normalize -0 to 0: when bound is 0 (unzoomed) and offset is negative,
  // Math.min(0, Math.max(-0, offset)) yields -0. node:assert/strict's `equal`
  // uses Object.is, which treats -0 !== 0, and there is no meaningful
  // difference between them as a pan offset.
  return clamped === 0 ? 0 : clamped;
}

/**
 * True when a released gesture should reset to unzoomed. Written as a negated
 * `>=` so a NaN scale returns true and resolves to a known-good state.
 */
export function shouldSnapBack(scale: number): boolean {
  return !(scale >= SNAP_BACK_BELOW);
}
