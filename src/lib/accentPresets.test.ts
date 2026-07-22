import assert from 'node:assert/strict';
import { ACCENT_PRESETS, ACCENT_GRADIENTS, parseGradient, serializeGradient } from './accentPresets';

// Presets are non-empty, valid 6-digit hexes, and include the two brand colors.
assert.ok(ACCENT_PRESETS.length >= 8, 'expected at least 8 presets');
for (const h of ACCENT_PRESETS) assert.match(h, /^#[0-9a-fA-F]{6}$/, `bad preset hex: ${h}`);
assert.ok(ACCENT_PRESETS.includes('#FC6A5B'), 'brand pink/red missing');
assert.ok(ACCENT_PRESETS.includes('#FF6B35'), 'classic orange missing');

// Gradients are pairs of valid hexes.
assert.ok(ACCENT_GRADIENTS.length >= 4, 'expected at least 4 gradients');
for (const [a, b] of ACCENT_GRADIENTS) {
  assert.match(a, /^#[0-9a-fA-F]{6}$/);
  assert.match(b, /^#[0-9a-fA-F]{6}$/);
}

// Round-trip.
assert.equal(serializeGradient(['#FC6A5B', '#FF6B35']), '#FC6A5B,#FF6B35');
assert.deepEqual(parseGradient('#FC6A5B,#FF6B35'), ['#FC6A5B', '#FF6B35']);

// Robustness.
assert.equal(parseGradient(null), null);
assert.equal(parseGradient(''), null);
assert.equal(parseGradient('#FC6A5B'), null, 'single color is not a gradient');
assert.equal(parseGradient('not,colors'), null, 'invalid hexes rejected');
assert.deepEqual(parseGradient('  #fc6a5b , #ff6b35 '), ['#fc6a5b', '#ff6b35'], 'trims whitespace');

console.log('accentPresets: all assertions passed');
