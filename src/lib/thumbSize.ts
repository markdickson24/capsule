// Short side of the stored grid thumbnail. The grid's largest cell is a third
// of the screen (~147pt on the widest iPhone), so 480px covers 3x density.
export const GRID_THUMB_PX = 480;

/**
 * The ImageManipulator resize for a grid thumbnail: scale the SHORT side down
 * to GRID_THUMB_PX, keeping aspect ratio. Null when the image is unreadable or
 * already small enough (never upscale). Only one dimension is given so
 * ImageManipulator derives the other.
 */
export function thumbResize(
  size: { width: number; height: number } | null,
): { width: number } | { height: number } | null {
  if (!size || Math.min(size.width, size.height) <= GRID_THUMB_PX) return null;
  return size.width <= size.height ? { width: GRID_THUMB_PX } : { height: GRID_THUMB_PX };
}
