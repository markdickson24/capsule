import assert from 'node:assert/strict';
import { summarizeAwards } from './awardSummary';

// Empty is its own sentence — the collapsed row is the ONLY thing an owner
// sees, so "0 awards" would read as a count rather than as a prompt to act.
assert.equal(summarizeAwards([]), 'No default awards yet');

// Singular vs plural.
assert.equal(
  summarizeAwards([{ label: 'Best Dressed', target_type: 'person' }]),
  '1 award · Best Dressed',
);
assert.equal(
  summarizeAwards([
    { label: 'Best Dressed', target_type: 'person' },
    { label: 'Best Photo', target_type: 'media' },
  ]),
  '2 awards · Best Dressed, Best Photo',
);

// Every label is joined in full — the collapsed <Text> carries numberOfLines={1}
// and truncates with a native ellipsis, so this must NOT pre-truncate (doing
// both would produce a double ellipsis at some widths).
assert.equal(
  summarizeAwards([
    { label: 'Most likely to lose the group chat', target_type: 'person' },
    { label: 'Photo that needs no caption', target_type: 'media' },
    { label: 'First one on the dance floor', target_type: 'person' },
    { label: 'Best accidental candid', target_type: 'media' },
  ]),
  '4 awards · Most likely to lose the group chat, Photo that needs no caption, ' +
    'First one on the dance floor, Best accidental candid',
);

// target_type never appears in the summary — the icon carries that in the
// expanded chip list, and repeating it here would blow the one-line budget.
assert.ok(!summarizeAwards([{ label: 'Best Photo', target_type: 'media' }]).includes('media'));

console.log('awardSummary tests passed');
