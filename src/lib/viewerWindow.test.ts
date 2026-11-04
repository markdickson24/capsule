import assert from 'node:assert/strict';
import { shouldMountVideoPlayer } from './viewerWindow';

// The video on screen gets a player.
assert.equal(shouldMountVideoPlayer(4, 4), true);
// The neighbours on either side are preloaded so a swipe lands on a loaded video.
assert.equal(shouldMountVideoPlayer(3, 4), true);
assert.equal(shouldMountVideoPlayer(5, 4), true);
// Anything further away holds no player: opening the viewer on a capsule with
// 40 videos must not create 40 AVPlayers on the main thread (REACT-NATIVE-H/K).
assert.equal(shouldMountVideoPlayer(2, 4), false);
assert.equal(shouldMountVideoPlayer(6, 4), false);
assert.equal(shouldMountVideoPlayer(39, 0), false);
// First slide: only itself and the next one.
assert.equal(shouldMountVideoPlayer(0, 0), true);
assert.equal(shouldMountVideoPlayer(1, 0), true);

console.log('viewerWindow: all assertions passed');
