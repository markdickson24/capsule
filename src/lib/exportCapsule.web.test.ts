import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { buildZipBlobParts } from './exportCapsule.web';

const files = [
  { name: 'a.txt', data: new TextEncoder().encode('hello') },
  { name: 'b.txt', data: new TextEncoder().encode('world') },
];

const zip = buildZipBlobParts(files);
assert.ok(zip instanceof Uint8Array, 'returns a Uint8Array');
assert.ok(zip.length > 0, 'non-empty zip');

// Round-trip: unzip and confirm contents.
const out = unzipSync(zip);
assert.equal(new TextDecoder().decode(out['a.txt']), 'hello');
assert.equal(new TextDecoder().decode(out['b.txt']), 'world');

console.log('exportCapsule.web: zip round-trip passed');
