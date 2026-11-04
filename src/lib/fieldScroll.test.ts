import assert from 'node:assert/strict';
import { fieldScrollOffset, FIELD_SCROLL_PADDING } from './fieldScroll';

assert.equal(FIELD_SCROLL_PADDING, 24);

// Top-level Name field: form wrapper sits 70pt below the header, field at 0
// inside it → scroll to 70 - 24.
assert.equal(fieldScrollOffset([70, 0]), 46);

// Description under "More options": form wrapper 70, section 300, expanded
// body 40, field 0 inside the body. The old code used only the field's own y
// (0) and scrolled to the very top; the real offset is the sum.
assert.equal(fieldScrollOffset([70, 300, 40, 0]), 386);

// A field near the top never yields a negative offset.
assert.equal(fieldScrollOffset([10, 0]), 0);

// Any ancestor not yet laid out (collapsed section) → null, caller skips the scroll.
assert.equal(fieldScrollOffset([70, undefined, 40, 0]), null);
assert.equal(fieldScrollOffset([]), null);

// Custom padding.
assert.equal(fieldScrollOffset([100, 50], 0), 150);

console.log('fieldScroll: all assertions passed');
