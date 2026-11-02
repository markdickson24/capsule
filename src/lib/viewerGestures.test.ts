import assert from 'node:assert/strict';
import { VIDEO_TIMEBAR_ZONE_PT, viewerClaimsTouch } from './viewerGestures';

const H = 874; // iPhone 17 Pro screen height in points

// Dragging the video timebar (just above the home indicator) belongs to the native controls, not paging.
assert.equal(viewerClaimsTouch(true, H - 90, H), false);
assert.equal(viewerClaimsTouch(true, H - VIDEO_TIMEBAR_ZONE_PT, H), false);
// Just above the band, a video still swipes to the next item / down to close.
assert.equal(viewerClaimsTouch(true, H - VIDEO_TIMEBAR_ZONE_PT - 1, H), true);
// The lower-middle of a video (not the bottom half rule) still pages.
assert.equal(viewerClaimsTouch(true, H * 0.7, H), true);
assert.equal(viewerClaimsTouch(true, 120, H), true);
// Photos page and pinch from anywhere, bottom included.
assert.equal(viewerClaimsTouch(false, H - 90, H), true);

console.log('viewerGestures: all assertions passed');
