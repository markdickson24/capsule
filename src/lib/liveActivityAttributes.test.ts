import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// CapsuleActivityAttributes must be ONE type compiled into both the app target
// and the widget extension. It's a symlink, but if any tooling replaces it
// with a copy, the two can drift and ActivityKit silently stops matching the
// activity type at runtime. Compare contents, which holds either way.
const canonical = readFileSync('modules/expo-live-activity/ios/CapsuleActivityAttributes.swift', 'utf8');
const target = readFileSync('targets/liveactivity/CapsuleActivityAttributes.swift', 'utf8');

assert.equal(
  target,
  canonical,
  'targets/liveactivity/CapsuleActivityAttributes.swift has drifted from the canonical copy in modules/expo-live-activity/ios/ — re-create the symlink.'
);

console.log('liveActivityAttributes drift guard passed');
