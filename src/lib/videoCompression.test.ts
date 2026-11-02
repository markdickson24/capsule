import assert from 'node:assert/strict';
import {
  AUDIO_BITRATE,
  MAX_VIDEO_BITRATE,
  MAX_VIDEO_DIMENSION,
  MIN_VIDEO_BITRATE,
  STORAGE_UPLOAD_LIMIT_BYTES,
  VIDEO_BUDGET_BYTES,
  videoBitrateFor,
  videoCompressionPlan,
} from './videoCompression';

const MB = 1024 * 1024;
// Worst-case bytes for a clip at a given video bitrate, with 10% encoder overshoot.
const worstCaseBytes = (videoBitrate: number, sec: number) =>
  ((videoBitrate + AUDIO_BITRATE) * 1.1 * sec) / 8;

// The 113.7 MB library video from REACT-NATIVE-E (4K, ~30s) is re-encoded.
const plan4k = videoCompressionPlan({ width: 3840, height: 2160, durationSec: 30 }, 113_718_964);
assert.ok(plan4k);
assert.equal(plan4k.maxDimension, MAX_VIDEO_DIMENSION);

// A Pro max-length clip (120s) fits under the Storage limit even with overshoot.
const bitrate120 = videoBitrateFor(120);
assert.ok(worstCaseBytes(bitrate120, 120) < STORAGE_UPLOAD_LIMIT_BYTES);
// ...and is still a watchable 1080p bitrate (~2.8 Mbps), not the floor.
assert.ok(bitrate120 > 2_500_000 && bitrate120 < 3_000_000);

// A free-tier 30s clip gets a higher bitrate than a 120s one, and still fits.
const bitrate30 = videoBitrateFor(30);
assert.ok(bitrate30 > bitrate120);
assert.ok(worstCaseBytes(bitrate30, 30) < STORAGE_UPLOAD_LIMIT_BYTES);

// A 5s clip is capped at the max bitrate instead of ballooning to fill the budget.
assert.equal(videoBitrateFor(5), MAX_VIDEO_BITRATE);
// A very long clip bottoms out at the floor rather than going unwatchable.
assert.equal(videoBitrateFor(60 * 60), MIN_VIDEO_BITRATE);
// Unknown duration (probe returned 0/NaN): use the max bitrate, the size check backstops it.
assert.equal(videoBitrateFor(0), MAX_VIDEO_BITRATE);
assert.equal(videoBitrateFor(NaN), MAX_VIDEO_BITRATE);

// A 40s 1080p dual-camera recording at 8 Mbps (~40 MB) is already fine: upload as-is.
assert.equal(videoCompressionPlan({ width: 1080, height: 1920, durationSec: 40 }, 40 * MB), null);
// A 90s 1080p recording (~90 MB) is over budget: re-encode despite being 1080p.
const plan1080Long = videoCompressionPlan({ width: 1920, height: 1080, durationSec: 90 }, 90 * MB);
assert.ok(plan1080Long);
assert.equal(plan1080Long.videoBitrate, videoBitrateFor(90));
// A short 4K clip under budget is still brought down to 1080p (resolution alone triggers it).
assert.ok(videoCompressionPlan({ width: 2160, height: 3840, durationSec: 5 }, 30 * MB));
// Exactly at the budget and 1080p: no re-encode.
assert.equal(videoCompressionPlan({ width: 1920, height: 1080, durationSec: 60 }, VIDEO_BUDGET_BYTES), null);

console.log('videoCompression: all assertions passed');
