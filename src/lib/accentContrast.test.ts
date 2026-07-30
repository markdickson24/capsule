import assert from 'node:assert/strict';
import {
  accentLuminance,
  contrastRatio,
  onAccent,
  onAccentForGradient,
  ON_ACCENT_DARK,
  ON_ACCENT_LIGHT,
  TEXT_FLIP_LUMINANCE,
} from './accentContrast';
import { ACCENT_PRESETS, ACCENT_GRADIENTS } from './accentPresets';

// The flip point is 0.38, not the widely-copied 0.179. See the module's doc
// comment: 0.179 maximizes the WCAG *ratio*, which is a different goal than
// legibility, and would flip 7 of the 10 shipped presets — including the brand
// coral — to dark text. 0.38 is the perceptual middle-contrast point for text.
assert.equal(TEXT_FLIP_LUMINANCE, 0.38);

// ---------------------------------------------------------------------------
// The three presets that are genuinely unreadable with white text must flip.
// White on these measures 1.91–2.03:1, far under any usable threshold.
// ---------------------------------------------------------------------------
assert.equal(onAccent('#F5A623'), ON_ACCENT_DARK); // amber, white was 2.03:1
assert.equal(onAccent('#30D158'), ON_ACCENT_DARK); // green, white was 2.02:1
assert.equal(onAccent('#32D0C6'), ON_ACCENT_DARK); // teal,  white was 1.91:1

// ---------------------------------------------------------------------------
// The brand coral keeps white — a deliberate product decision. This is the
// assertion that pins the 0.38 threshold: at 0.179 the coral would flip and
// every primary button in the app would change appearance.
// ---------------------------------------------------------------------------
assert.equal(onAccent('#FC6A5B'), ON_ACCENT_LIGHT); // brand coral (default)
assert.equal(onAccent('#FF6B35'), ON_ACCENT_LIGHT); // classic orange
assert.equal(onAccent('#FF3B7F'), ON_ACCENT_LIGHT); // magenta
assert.equal(onAccent('#4C8DFF'), ON_ACCENT_LIGHT); // blue
assert.equal(onAccent('#7B61FF'), ON_ACCENT_LIGHT); // indigo
assert.equal(onAccent('#B36BFF'), ON_ACCENT_LIGHT); // violet
assert.equal(onAccent('#FF5CA8'), ON_ACCENT_LIGHT); // pink

// Every shipped preset must resolve to one of the two tokens — no undefined,
// no pass-through of the input.
for (const p of ACCENT_PRESETS) {
  const fg = onAccent(p);
  assert.ok(fg === ON_ACCENT_LIGHT || fg === ON_ACCENT_DARK, `preset ${p} -> ${fg}`);
}

// ---------------------------------------------------------------------------
// Arbitrary custom colors — the actual bug report. A Pro user picking anything
// pale must get dark text.
// ---------------------------------------------------------------------------
assert.equal(onAccent('#FFF9C4'), ON_ACCENT_DARK); // pale yellow
assert.equal(onAccent('#FFD54F'), ON_ACCENT_DARK); // light amber
assert.equal(onAccent('#A8E6CF'), ON_ACCENT_DARK); // mint
assert.equal(onAccent('#FFFF00'), ON_ACCENT_DARK); // pure yellow
assert.equal(onAccent('#00FF00'), ON_ACCENT_DARK); // pure green
assert.equal(onAccent('#FFFFFF'), ON_ACCENT_DARK); // white

// ...and anything dark must KEEP white. A fixed "always dark text" fix would
// have broken exactly these, turning one unreadable case into another.
assert.equal(onAccent('#1A237E'), ON_ACCENT_LIGHT); // navy
assert.equal(onAccent('#000000'), ON_ACCENT_LIGHT); // black
assert.equal(onAccent('#2A2A2A'), ON_ACCENT_LIGHT); // near-black (border token)

// ---------------------------------------------------------------------------
// Boundary behavior around the threshold itself.
// ---------------------------------------------------------------------------
// Grey ramp: crosses the flip point exactly once, and in the right direction.
{
  const flips: string[] = [];
  for (let v = 0; v <= 255; v++) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    flips.push(onAccent(hex));
  }
  const firstDark = flips.indexOf(ON_ACCENT_DARK);
  assert.ok(firstDark > 0, 'a grey ramp must flip to dark somewhere');
  // Monotonic: everything below the flip is light, everything at/above is dark.
  assert.ok(flips.slice(0, firstDark).every((f) => f === ON_ACCENT_LIGHT));
  assert.ok(flips.slice(firstDark).every((f) => f === ON_ACCENT_DARK));
}

// Exactly at the threshold, dark wins (the comparison is `< flip ? light : dark`).
{
  // Mid grey sits above 0.38 luminance, so it must be dark.
  assert.equal(onAccent('#B0B0B0'), ON_ACCENT_DARK);
  assert.equal(onAccent('#404040'), ON_ACCENT_LIGHT);
}

// ---------------------------------------------------------------------------
// Malformed input must never throw and must never make things WORSE than the
// pre-fix behavior, which was always white.
// ---------------------------------------------------------------------------
assert.equal(onAccent(''), ON_ACCENT_LIGHT);
assert.equal(onAccent(null), ON_ACCENT_LIGHT);
assert.equal(onAccent(undefined), ON_ACCENT_LIGHT);
assert.equal(onAccent('not-a-color'), ON_ACCENT_LIGHT);
assert.equal(onAccent('#FFF'), ON_ACCENT_LIGHT); // 3-digit unsupported -> fallback
assert.equal(onAccent('#GGGGGG'), ON_ACCENT_LIGHT);
assert.equal(onAccent('#FFFFFFFF'), ON_ACCENT_LIGHT);
// Case-insensitive, and a missing leading '#' is tolerated.
assert.equal(onAccent('#f5a623'), ON_ACCENT_DARK);
assert.equal(onAccent('F5A623'), ON_ACCENT_DARK);

// ---------------------------------------------------------------------------
// accentLuminance — the raw signal.
// ---------------------------------------------------------------------------
assert.equal(accentLuminance('#000000'), 0);
assert.equal(accentLuminance('#FFFFFF'), 1);
assert.ok(Math.abs(accentLuminance('#FC6A5B') - 0.318) < 0.005);
assert.ok(Math.abs(accentLuminance('#32D0C6') - 0.504) < 0.005);
// Green is weighted most heavily, blue least (per sRGB coefficients).
assert.ok(accentLuminance('#00FF00') > accentLuminance('#FF0000'));
assert.ok(accentLuminance('#FF0000') > accentLuminance('#0000FF'));

// ---------------------------------------------------------------------------
// contrastRatio — WCAG 2.x, used to prove the fix actually improves things.
// ---------------------------------------------------------------------------
assert.ok(Math.abs(contrastRatio('#FFFFFF', '#000000') - 21) < 0.01);
assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01); // symmetric
assert.ok(Math.abs(contrastRatio('#FFFFFF', '#FFFFFF') - 1) < 0.01);

// The whole point: for every preset, the color we choose must beat the color
// we replaced. Where we keep white nothing regresses; where we flip, contrast
// must strictly improve.
for (const p of ACCENT_PRESETS) {
  const chosen = contrastRatio(p, onAccent(p));
  const white = contrastRatio(p, ON_ACCENT_LIGHT);
  assert.ok(chosen >= white, `${p}: chosen ${chosen} < white ${white}`);
}

// The three flipped presets clear AA for normal text with real margin.
for (const p of ['#F5A623', '#30D158', '#32D0C6']) {
  assert.ok(contrastRatio(p, onAccent(p)) >= 4.5, `${p} must pass AA after flip`);
}

// A pale custom color goes from unreadable to comfortably compliant.
assert.ok(contrastRatio('#FFF9C4', ON_ACCENT_LIGHT) < 1.5);
assert.ok(contrastRatio('#FFF9C4', onAccent('#FFF9C4')) > 15);

// ---------------------------------------------------------------------------
// Gradients decide on the LIGHTER stop — text must stay readable at the
// accent's lightest point, not its average.
// ---------------------------------------------------------------------------
assert.equal(onAccentForGradient(['#FC6A5B', '#FF3B7F']), ON_ACCENT_LIGHT); // both dark-ish
assert.equal(onAccentForGradient(['#1A237E', '#FFF9C4']), ON_ACCENT_DARK);  // one pale stop
assert.equal(onAccentForGradient(['#FFF9C4', '#1A237E']), ON_ACCENT_DARK);  // order-independent
assert.equal(onAccentForGradient(null), ON_ACCENT_LIGHT);
assert.equal(onAccentForGradient(undefined), ON_ACCENT_LIGHT);

// Every shipped gradient resolves to a real token.
for (const g of ACCENT_GRADIENTS) {
  const fg = onAccentForGradient(g);
  assert.ok(fg === ON_ACCENT_LIGHT || fg === ON_ACCENT_DARK, `gradient ${g} -> ${fg}`);
}

console.log('accentContrast.test.ts: all assertions passed');
