import assert from 'node:assert/strict';
import { parseDeepLink } from './deepLinkRoute';

async function main() {
  // Basic reset-password with a real PKCE code.
  assert.deepEqual(
    parseDeepLink('capsule://reset-password?code=abc123'),
    { kind: 'reset', code: 'abc123' },
    'reset-password with a code param',
  );

  // Attacker implicit-flow URL: the exact shape that caused the session-fixation
  // bug. The fragment must be discarded outright — no access_token/refresh_token
  // should ever reach the returned object, and code must be null so the hook
  // performs no session-establishing call at all (a null code is a no-op, not
  // an attempt to exchange garbage for a session).
  {
    const r = parseDeepLink('capsule://reset-password#access_token=EVIL&refresh_token=EVIL2');
    assert.deepEqual(r, { kind: 'reset', code: null }, 'implicit-flow attack URL yields no code');
    assert.equal(
      Object.keys(r as object).sort().join(','),
      'code,kind',
      'result object has ONLY kind/code — no access_token/refresh_token field of any kind',
    );
  }

  // A fragment cannot smuggle a fake query string onto the reset branch.
  assert.deepEqual(
    parseDeepLink('capsule://reset-password#?code=EVIL'),
    { kind: 'reset', code: null },
    'query-shaped fragment is not read as a real query',
  );

  // The substring-routing regression: the old handler used
  // `url.includes('reset-password')`, which matched this URL and misrouted it
  // into the reset-password/session-hijack path even though it's really a
  // join link.
  assert.deepEqual(
    parseDeepLink('capsule://join/aaaa-bbbb?ref=reset-password'),
    { kind: 'join', capsuleId: 'aaaa-bbbb' },
    'substring "reset-password" in a query value must not trigger the reset branch',
  );
  assert.deepEqual(
    parseDeepLink('capsule://join/aaaa-bbbb#reset-password'),
    { kind: 'join', capsuleId: 'aaaa-bbbb' },
    'substring "reset-password" in a fragment must not trigger the reset branch',
  );

  // capsule/<id> open routes, with and without the camera segment.
  assert.deepEqual(
    parseDeepLink('capsule://capsule/abc-123'),
    { kind: 'open', capsuleId: 'abc-123', camera: false },
    'capsule/<id> opens without camera',
  );
  assert.deepEqual(
    parseDeepLink('capsule://capsule/abc-123/camera'),
    { kind: 'open', capsuleId: 'abc-123', camera: true },
    'capsule/<id>/camera opens with camera preselected',
  );

  // join/<id>.
  assert.deepEqual(
    parseDeepLink('capsule://join/abc-123'),
    { kind: 'join', capsuleId: 'abc-123' },
    'join/<id>',
  );

  // Non-capsule schemes, and look-alike schemes, must all be rejected.
  assert.equal(parseDeepLink('https://getcapsuleapp.com/join/x'), null, 'https is not capsule://');
  assert.equal(parseDeepLink('evil://reset-password?code=x'), null, 'evil scheme rejected');
  assert.equal(parseDeepLink('javascript:alert(1)'), null, 'javascript: rejected');
  assert.equal(parseDeepLink('capsulex://join/x'), null, 'look-alike scheme "capsulex://" rejected by strict prefix check');
  assert.equal(
    parseDeepLink('https://evil.com/#capsule://reset-password?code=x'),
    null,
    'a URL that merely CONTAINS "capsule://" later on is rejected',
  );

  // Malformed / empty inputs.
  assert.equal(parseDeepLink(null), null, 'null input');
  assert.equal(parseDeepLink(undefined), null, 'undefined input');
  assert.equal(parseDeepLink(''), null, 'empty string input');
  assert.equal(parseDeepLink('capsule://'), null, 'bare scheme, no path');
  assert.equal(parseDeepLink('capsule://reset-password/extra'), null, 'reset-password with an extra segment');
  assert.equal(parseDeepLink('capsule://join'), null, 'join with no id segment');
  assert.equal(parseDeepLink('capsule://join/a/b'), null, 'join with too many segments');
  assert.equal(parseDeepLink('capsule://capsule/a/notcamera'), null, 'capsule/<id>/<not-camera> rejected');

  // Invalid id charset (anchored regex — the old code's unanchored version
  // would have let a partial match like this through).
  assert.equal(parseDeepLink('capsule://join/../../etc'), null, 'path-traversal-shaped id rejected');
  assert.equal(parseDeepLink('capsule://join/a%20b'), null, 'percent-encoded id rejected');

  // Case-insensitive scheme match (RFC 3986), even though iOS normally
  // lowercases it for us.
  assert.deepEqual(
    parseDeepLink('CAPSULE://join/abc'),
    { kind: 'join', capsuleId: 'abc' },
    'scheme comparison is case-insensitive',
  );

  console.log('deepLinkRoute: all assertions passed');
}
main();
