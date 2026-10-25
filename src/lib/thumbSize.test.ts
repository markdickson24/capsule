import assert from 'node:assert/strict';
import { GRID_THUMB_PX, thumbResize } from './thumbSize';

// Portrait camera photo (1920x2560): width is the short side.
assert.deepEqual(thumbResize({ width: 1920, height: 2560 }), { width: GRID_THUMB_PX });
// Landscape photo: height is the short side, so a wide panorama isn't squashed to 480 wide.
assert.deepEqual(thumbResize({ width: 4032, height: 3024 }), { height: GRID_THUMB_PX });
// Square photo resizes by width.
assert.deepEqual(thumbResize({ width: 1080, height: 1080 }), { width: GRID_THUMB_PX });
// Already-small image (a screenshot thumbnail): never upscale.
assert.equal(thumbResize({ width: 400, height: 900 }), null);
assert.equal(thumbResize({ width: GRID_THUMB_PX, height: 2000 }), null);
// Image.getSize failed: re-encode only, no resize.
assert.equal(thumbResize(null), null);

console.log('thumbSize: all assertions passed');
