import assert from 'node:assert/strict';
import { buildTourSteps } from './tourSteps';

// Has-capsule branch: threads capsuleId into CapsuleDetail steps, ends on a null-target finish card.
const withCap = buildTourSteps({ hasCapsule: true, capsuleId: 'cap-123' });
assert.ok(withCap.length >= 8, 'has-capsule branch should be the long one');
assert.equal(withCap[0].screen, 'Home', 'starts on Home (the capsule card)');
assert.equal(withCap[0].targetId, 'capsule-card');
const detailSteps = withCap.filter(s => s.screen === 'CapsuleDetail');
assert.ok(detailSteps.length >= 4, 'has-capsule branch visits the capsule');
for (const s of detailSteps) assert.equal((s.params as any)?.capsuleId, 'cap-123', 'capsuleId threaded');
assert.ok(withCap.some(s => s.targetId === 'home-scan'), 'includes the join/scan stop');
const last = withCap[withCap.length - 1];
assert.equal(last.targetId, null, 'finish card has no target');

// No-capsule branch: leads with joining, no CapsuleDetail steps, create framed as optional.
const noCap = buildTourSteps({ hasCapsule: false, capsuleId: null });
assert.equal(noCap[0].targetId, 'home-scan', 'no-capsule branch leads with joining');
assert.ok(noCap.some(s => s.targetId === 'tab:Create'), 'still explains how to create');
assert.ok(!noCap.some(s => s.screen === 'CapsuleDetail'), 'no capsule-detail stops without a capsule');
assert.equal(noCap[noCap.length - 1].targetId, null, 'finish card last');

// Every non-finish step names a target.
for (const s of [...withCap, ...noCap]) {
  if (s.id !== 'finish') assert.ok(s.targetId, `step ${s.id} needs a target`);
}

console.log('tourSteps: all assertions passed');
