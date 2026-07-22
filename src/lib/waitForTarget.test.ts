import assert from 'node:assert/strict';
import { waitForTarget, Rect, MeasureFn } from './waitForTarget';

// Injected clock: `now` advances by whatever `sleep` is asked to wait.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

async function main() {
  const rect: Rect = { x: 1, y: 2, width: 3, height: 4 };

  // Resolves once the registry starts returning a measure fn that yields a valid rect.
  let calls = 0;
  const getLate = (_id: string): MeasureFn | undefined =>
    (++calls >= 3) ? async () => rect : undefined;
  const c1 = fakeClock();
  const hit = await waitForTarget('x', getLate, { interval: 150, timeout: 2500, now: c1.now, sleep: c1.sleep });
  assert.deepEqual(hit, rect, 'resolves the rect once the target registers');

  // Zero-size rect is treated as not-ready (returns null on timeout).
  const c2 = fakeClock();
  const zero = await waitForTarget('x', () => async () => ({ x: 0, y: 0, width: 0, height: 0 }), { interval: 150, timeout: 600, now: c2.now, sleep: c2.sleep });
  assert.equal(zero, null, 'zero-size rect never satisfies');

  // Never registers -> null on timeout.
  const c3 = fakeClock();
  const miss = await waitForTarget('x', () => undefined, { interval: 150, timeout: 600, now: c3.now, sleep: c3.sleep });
  assert.equal(miss, null, 'missing target resolves null after timeout');

  console.log('waitForTarget: all assertions passed');
}
main();
