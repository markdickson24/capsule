// Scroll-to-field offsets for forms whose fields are nested inside wrapper Views.
//
// onLayout's `y` is relative to the view's *parent*, not the ScrollView's
// content. A field nested inside wrappers (an animated form container, a
// collapsible "More options" body) therefore reports a small y even when it
// sits far down the screen. To scroll to it, sum the y of every ancestor up
// to the ScrollView content plus the field's own y.

/** How far above the field to stop, so its label isn't flush with the top edge. */
export const FIELD_SCROLL_PADDING = 24;

/**
 * Content-space scroll offset for a field, given the onLayout `y` of each
 * view from the outermost wrapper down to the field itself. Returns null if
 * any of them hasn't laid out yet (e.g. a collapsed section).
 */
export function fieldScrollOffset(
  chain: ReadonlyArray<number | undefined>,
  padding: number = FIELD_SCROLL_PADDING,
): number | null {
  if (chain.length === 0) return null;
  let y = 0;
  for (const part of chain) {
    if (part == null) return null;
    y += part;
  }
  return Math.max(0, y - padding);
}
