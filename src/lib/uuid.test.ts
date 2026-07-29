import assert from 'node:assert/strict';
import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// IMPORTANT — what this file can and cannot verify, and why.
//
// `src/lib/uuid.ts` now delegates to `expo-crypto`'s `Crypto.randomUUID()`.
// `expo-crypto` transitively imports `expo-modules-core` -> `react-native`,
// and `react-native/index.js` uses Flow syntax (`typeof` type imports) that
// esbuild (tsx's transformer) cannot parse outside a Metro/Babel pipeline.
// Confirmed directly: running `npx tsx` against a one-line script that does
// `import { randomUUID } from './src/lib/uuid'` fails with
//   "Transform failed with 1 error: .../react-native/index.js:27:7:
//    ERROR: Unexpected "typeof""
// This is a real constraint of the RN/Expo ecosystem, not a bug in the fix —
// `src/lib/uuid.ts` can only actually execute inside the RN/Hermes runtime
// (or a jest/RN-preset test environment with proper transforms), neither of
// which this repo has configured (no test framework is set up, matching the
// convention `recurrence.test.ts` documents). Because of this, this file:
//
//   1. Statically verifies the SOURCE of `uuid.ts` actually wires up
//      `expo-crypto`'s `randomUUID` (catches "reverted to Math.random()" or
//      "forgot the import" regressions) without executing it.
//   2. Verifies the RFC 4122 v4 UUID shape + uniqueness contract against
//      Node's built-in `crypto.randomUUID()` — the same underlying primitive
//      `expo-crypto`'s own web implementation delegates to
//      (`ExpoCrypto.web.ts`: `randomUUID() { return getCrypto().randomUUID(); }`,
//      i.e. `globalThis.crypto.randomUUID()`, which Node's `node:crypto`
//      implements identically per the WHATWG/W3C Web Crypto spec both target).
//
// What this does NOT do: actually invoke `src/lib/uuid.ts`'s exported
// `randomUUID()`, or exercise the native iOS/Android CSPRNG path. Those can
// only be verified by running inside the app (RN/Hermes) or Expo Go/EAS
// build. Do not read a green run of this file as proof the native path
// works — it verifies the wiring and the format/uniqueness contract only.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'uuid.ts'), 'utf8');

// 1. Source-level wiring check — catches a regression back to Math.random()
//    or a broken/removed import, without needing to execute the RN-only code.
//    The function BODY (not the whole file — the doc comment above it
//    legitimately mentions "Math.random()" in prose, explaining what this
//    replaced) must not reference Math.random.
{
  assert.match(
    source,
    /import \* as Crypto from ['"]expo-crypto['"]/,
    'uuid.ts must import the expo-crypto module'
  );
  assert.match(
    source,
    /return Crypto\.randomUUID\(\)/,
    'uuid.ts must delegate to Crypto.randomUUID() (the expo-crypto CSPRNG), not a hand-rolled generator'
  );

  const bodyMatch = source.match(/export function randomUUID\(\): string \{([\s\S]*?)\n\}/);
  assert.ok(bodyMatch, 'could not locate randomUUID() function body in uuid.ts to inspect');
  const body = bodyMatch![1];
  assert.doesNotMatch(
    body,
    /Math\.random/,
    'randomUUID()\'s function BODY must not call Math.random() (CWE-338 — Hermes Math.random is a seeded xorshift128+, not a CSPRNG)'
  );
}

// 2. RFC 4122 v4 shape contract, exercised via node:crypto's randomUUID() —
//    the same primitive expo-crypto's own web path (`globalThis.crypto.randomUUID()`)
//    delegates to. Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where the
//    version nibble is literally '4' and the variant nibble is one of 8/9/a/b.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

{
  const id = nodeRandomUUID();
  assert.match(id, UUID_V4_RE, `expected RFC 4122 v4 shape, got: ${id}`);
}

// 3. No duplicates across a large sample (birthday-collision sanity check —
//    this is exactly the property Math.random()'s predictable internal state
//    threatened; a CSPRNG should show zero collisions at this sample size).
{
  const N = 10_000;
  const seen = new Set<string>();
  for (let i = 0; i < N; i++) {
    const id = nodeRandomUUID();
    assert.match(id, UUID_V4_RE, `sample ${i} failed v4 shape check: ${id}`);
    assert.ok(!seen.has(id), `duplicate UUID generated at sample ${i}: ${id}`);
    seen.add(id);
  }
  assert.equal(seen.size, N);
}

console.log('uuid.test.ts: all checks passed (source wiring + v4 shape/uniqueness contract).');
console.log(
  'NOTE: expo-crypto\'s randomUUID() itself was NOT executed (transitively requires react-native,'
);
console.log(
  'which cannot be parsed by esbuild/tsx outside Metro — see file header). This run verifies the'
);
console.log('wiring in uuid.ts and the v4 shape/uniqueness contract via node:crypto only.');
