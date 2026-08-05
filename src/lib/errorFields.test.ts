// Run with: npx tsx src/lib/errorFields.test.ts
// Mirrors the src/lib/tierLimits.test.ts precedent (no jest in this repo).
import assert from 'node:assert/strict';
import { describeError } from './errorFields';

// The finding's real case: a plain PostgREST error object. Before the fix this
// reported as "Error: [object Object]" with code/details/hint destroyed.
const pg = {
  code: '42501',
  details: null,
  hint: null,
  message: 'permission denied for function _superlative_target_valid',
};
let d = describeError(pg);
assert.equal(d.message, 'permission denied for function _superlative_target_valid');
assert.equal(d.name, null); // plain PostgREST objects carry no name; nothing is synthesized
assert.deepEqual(d.fields, { code: '42501', details: null, hint: null });

// No usable message -> JSON fallback, still better than "[object Object]".
d = describeError({ code: 'PGRST301' });
assert.equal(d.message, '{"code":"PGRST301"}');
assert.deepEqual(d.fields, { code: 'PGRST301' });
assert.equal(describeError({}).message, '{}');

// A circular object must not throw (JSON.stringify does).
const circ: any = { code: 'X' };
circ.self = circ;
d = describeError(circ);
assert.equal(typeof d.message, 'string');
assert.deepEqual(d.fields, { code: 'X' });

// `name` is promoted to err.name; non-scalar / undefined values are dropped.
d = describeError({
  name: 'PostgrestError',
  message: 'boom',
  code: '23505',
  ctx: { a: 1 },
  fn: () => {},
  u: undefined,
});
assert.equal(d.name, 'PostgrestError');
assert.deepEqual(d.fields, { code: '23505' });

// Primitives keep the pre-fix String() behaviour exactly.
assert.equal(describeError('boom').message, 'boom');
assert.equal(describeError(null).message, 'null');
assert.equal(describeError(undefined).message, 'undefined');
assert.equal(describeError(42).message, '42');
assert.equal(describeError([1, 2]).message, '[1,2]');

// Throwing getters must never escape — this runs inside catch blocks.
const nasty = {
  get message() {
    throw new Error('x');
  },
  get code() {
    throw new Error('y');
  },
  hint: 'ok',
};
d = describeError(nasty);
assert.equal(typeof d.message, 'string');
assert.deepEqual(d.fields, { hint: 'ok' });

// Long values are clamped (500 chars + an ellipsis).
d = describeError({ message: 'a'.repeat(900), details: 'b'.repeat(900) });
assert.equal(d.message.length, 501);
assert.equal((d.fields.details as string).length, 501);

// Sane on a real Error too, even though reportError short-circuits those.
assert.equal(describeError(new Error('real')).message, 'real');
assert.equal(describeError(new Error('real')).name, 'Error');

console.log('errorFields.test.ts: all assertions passed');
