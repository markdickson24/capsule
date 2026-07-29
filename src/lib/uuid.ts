import * as Crypto from 'expo-crypto';

/**
 * CSPRNG-backed RFC 4122 v4 UUID, via expo-crypto (native CSPRNG on iOS/Android,
 * globalThis.crypto.randomUUID() on web). Use this instead of the global
 * `crypto.randomUUID()` directly — the `crypto` global isn't reliably typed in
 * this Expo TS config. This previously generated UUIDs with Math.random(),
 * which in Hermes is a seeded xorshift128+, not cryptographically secure
 * (CWE-338) — expo-crypto's randomUUID() is synchronous on both native and web,
 * so this is a drop-in replacement with no call-site changes needed.
 */
export function randomUUID(): string {
  return Crypto.randomUUID();
}
