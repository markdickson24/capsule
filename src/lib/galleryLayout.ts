// Pure layout math for MediaGalleryModal's FlatList (CapsuleDetailScreen.tsx).
//
// No React/react-native imports — unit-tested under plain node via `npx tsx`,
// same convention as src/lib/zoomMath.ts / src/lib/recurrence.ts.
//
// ⚠️ For a FlatList with `numColumns > 1`, VirtualizedList's entire index space
// is in ROW units, not flat-item units: FlatList.js's `_getItemCount` returns
// `Math.ceil(data.length / numColumns)`, and that same row index is what gets
// passed into `getItemLayout(data, index)`. So `index` here is already
// 0, 1, 2, ... per ROW — never divide it by `numColumns` again.

/** Row gap rendered by MediaGalleryModal's `ItemSeparatorComponent`. */
export const GALLERY_ROW_GAP = 2;

export interface GalleryItemLayout {
  length: number;
  offset: number;
  index: number;
}

/**
 * `getItemLayout` for MediaGalleryModal's 3-column FlatList. `index` is the
 * row index VirtualizedList hands in (see module doc above) — the offset for
 * row `i` is simply `i * (thumbSize + rowGap)`, folding in the separator
 * height so estimated offsets/spacer sizes match real measured layout.
 */
export function galleryItemLayout(
  thumbSize: number,
  index: number,
  rowGap: number = GALLERY_ROW_GAP
): GalleryItemLayout {
  const rowHeight = thumbSize + rowGap;
  return {
    length: rowHeight,
    offset: rowHeight * index,
    index,
  };
}
