import assert from 'node:assert/strict';
import { galleryItemLayout, GALLERY_ROW_GAP } from './galleryLayout';

const thumbSize = 120;
const rowHeight = thumbSize + GALLERY_ROW_GAP;

// `index` arrives already in ROW space (VirtualizedList's index space for a
// numColumns>1 FlatList is Math.ceil(data.length/numColumns) — see
// galleryLayout.ts's module doc) — row 0, 1, 2, 3, ... regardless of how many
// columns there are. Offset must grow linearly with the row index; a formula
// that re-divides by numColumns would flatten rows 0-2 to the same offset and
// under-report every row from there on.
assert.deepEqual(galleryItemLayout(thumbSize, 0), { length: rowHeight, offset: 0, index: 0 });
assert.deepEqual(galleryItemLayout(thumbSize, 1), { length: rowHeight, offset: rowHeight * 1, index: 1 });
assert.deepEqual(galleryItemLayout(thumbSize, 2), { length: rowHeight, offset: rowHeight * 2, index: 2 });
assert.deepEqual(galleryItemLayout(thumbSize, 3), { length: rowHeight, offset: rowHeight * 3, index: 3 });
assert.deepEqual(galleryItemLayout(thumbSize, 10), { length: rowHeight, offset: rowHeight * 10, index: 10 });

// The row's `length` includes the separator gap so consecutive offsets have
// no unaccounted-for space between them.
assert.equal(
  galleryItemLayout(thumbSize, 5).offset - galleryItemLayout(thumbSize, 4).offset,
  galleryItemLayout(thumbSize, 4).length
);

// A custom row gap is honored (defaults to the modal's real 2px separator).
assert.deepEqual(galleryItemLayout(100, 2, 0), { length: 100, offset: 200, index: 2 });

console.log('galleryLayout.test.ts: all assertions passed');
