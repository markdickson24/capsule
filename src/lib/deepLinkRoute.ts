// Pure, deterministic router for `capsule://` deep links.
//
// SECURITY CONTEXT (CWE-384, session fixation): iOS custom URL schemes are
// unauthenticated — ANY website can fire `capsule://...` at this app with no
// user consent. The old handler in `useDeepLinks.ts` routed on
// `url.includes('reset-password')` — a substring match anywhere in the whole
// URL string — and then fed attacker-controlled `#access_token=`/
// `#refresh_token=` straight into `supabase.auth.setSession()`. A malicious
// page could silently log the victim into the ATTACKER's account. This module
// is the fix: strict, structural parsing with the fragment discarded before
// anything else is even looked at.
//
// WHY NOT THE GLOBAL `URL` CLASS: React Native 0.81 replaces the global `URL`
// with its own polyfill (`Libraries/Blob/URL.js`), installed by
// `Libraries/Core/setUpXHR.js`. That polyfill's host/pathname parsing only
// understands `http(s)://` (its regex is
// `/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/`). For a custom scheme like
// `capsule://join/abc`, `new URL(...).host` and `.pathname` both come back as
// `''` / `'/'` on-device. The constructor also doesn't throw on malformed
// input (so `try/catch` around it is not a validity check) and it MUTATES the
// input string. Routing on the RN polyfill would silently break every deep
// link in the app; testing against Node's correct WHATWG `URL` instead would
// make the test lie about what actually runs on the phone. So: no `URL`, no
// `URLSearchParams`, just string ops that behave identically under Node and
// Hermes.

const SCHEME = 'capsule://';

// Capsule/group ids are UUIDs. Anchored so a partial match can't sneak
// path-traversal or query-injection characters through (the old code used an
// UNanchored `[a-zA-Z0-9-]+`, which only needed to match *somewhere* in the
// string).
const ID_PATTERN = /^[a-zA-Z0-9-]+$/;

export type DeepLinkRoute =
  | { kind: 'reset'; code: string | null }
  | { kind: 'open'; capsuleId: string; camera: boolean }
  | { kind: 'join'; capsuleId: string };

/**
 * Parses `query` (already stripped of everything before the `?`, and never
 * containing fragment data — see `parseDeepLink`) and returns the decoded
 * value of the `code` param, or `null` if it's absent, empty, or malformed.
 */
function getQueryParam(query: string, key: string): string | null {
  if (!query) return null;
  // Split on '&' for pairs, then EACH pair on only its FIRST '=' — a value
  // (e.g. a base64-ish PKCE code) may legitimately contain '=' itself.
  const pairs = query.split('&');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    const k = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    if (k !== key) continue;
    const rawValue = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    if (rawValue === '') return null;
    // Deliberately NOT translating '+' to a space here: that's an
    // application/x-www-form-urlencoded convention, but a PKCE `code` is
    // base64url-safe text where a literal '+' must survive untouched.
    try {
      const decoded = decodeURIComponent(rawValue);
      return decoded === '' ? null : decoded;
    } catch {
      // Malformed %-escape — treat as if the param were never supplied.
      return null;
    }
  }
  return null;
}

/**
 * Routes a raw deep-link URL string to a structural intent. Returns `null`
 * for anything not recognized as a well-formed `capsule://` link.
 *
 * The returned value for the `reset` branch can only ever carry a `code`
 * (a PKCE authorization code, meant for `supabase.auth.exchangeCodeForSession`)
 * — never a token. That's not a filtering choice made after the fact; the
 * fragment (where `#access_token=`/`#refresh_token=` would live under the
 * legacy Supabase implicit flow) is discarded in step 1, before query or path
 * parsing even begins, so there is no code path by which fragment data could
 * reach the returned object.
 */
export function parseDeepLink(url: string | null | undefined): DeepLinkRoute | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  // Strict, case-insensitive prefix check on the scheme — never a substring
  // search. URI schemes are case-insensitive per RFC 3986; iOS normally hands
  // us a lowercased scheme but we don't rely on that. This also rejects a
  // string that merely CONTAINS "capsule://" later on (e.g. an attacker page
  // at `https://evil.com/#capsule://...`), and rejects a look-alike scheme
  // like `capsulex://` since the comparison is against the full 10-char
  // prefix "capsule://", not just the word "capsule".
  if (url.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return null;

  let rest = url.slice(SCHEME.length);

  // Strip the fragment FIRST, unconditionally, before query or path parsing.
  // This is the load-bearing line for the vulnerability this module fixes:
  // it removes the entire `#access_token=...&refresh_token=...` implicit-flow
  // attack surface, and also stops a fragment from smuggling a fake query
  // string (e.g. `capsule://reset-password#?code=EVIL` must NOT be read as a
  // real `?code=` query).
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) rest = rest.slice(0, hashIdx);

  // Then split off the query.
  const qIdx = rest.indexOf('?');
  const pathPart = qIdx === -1 ? rest : rest.slice(0, qIdx);
  const queryPart = qIdx === -1 ? '' : rest.slice(qIdx + 1);

  // Split the path on '/', dropping empty segments (handles the `//` right
  // after the scheme, e.g. `capsule://join/abc` -> ['join', 'abc']).
  const segments = pathPart.split('/').filter((s) => s.length > 0);

  // Route on segments[0] with an exact, case-sensitive equality check —
  // never `.includes()`, a regex substring test, or `.startsWith()` on the
  // whole URL. This is what fixes the substring-routing bug: the old code's
  // `url.includes('reset-password')` matched even
  // `capsule://join/abc?ref=reset-password`.
  switch (segments[0]) {
    case 'reset-password': {
      if (segments.length !== 1) return null;
      return { kind: 'reset', code: getQueryParam(queryPart, 'code') };
    }
    case 'capsule': {
      if (segments.length === 2) {
        const capsuleId = segments[1];
        if (!ID_PATTERN.test(capsuleId)) return null;
        return { kind: 'open', capsuleId, camera: false };
      }
      if (segments.length === 3 && segments[2] === 'camera') {
        const capsuleId = segments[1];
        if (!ID_PATTERN.test(capsuleId)) return null;
        return { kind: 'open', capsuleId, camera: true };
      }
      return null;
    }
    case 'join': {
      if (segments.length !== 2) return null;
      const capsuleId = segments[1];
      if (!ID_PATTERN.test(capsuleId)) return null;
      return { kind: 'join', capsuleId };
    }
    default:
      return null;
  }
}
