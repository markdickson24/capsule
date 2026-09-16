// Turning an unknown caught value into something Sentry can actually show.
//
// Why this exists: `reportError` used to do `new Error(String(error))` for any
// non-Error value. But every Supabase `{ data, error }` destructure hands back a
// PLAIN OBJECT — postgrest-js only constructs a real `PostgrestError` on the
// `throwOnError` path, and returns the raw `JSON.parse(body)` result otherwise.
// So `String(error)` produced the literal string "[object Object]" and the
// message/code/details/hint were destroyed, collapsing every such report into
// one undebuggable Sentry issue (REACT-NATIVE-7, live in production).
//
// This module is pure and dependency-free on purpose: `src/lib/sentry.ts` can't
// be imported by an `npx tsx` test (it pulls in @sentry/react-native and
// expo-constants), so the logic lives here and is covered by
// src/lib/errorFields.test.ts. Keep it free of imports.
//
// `describeError` must NEVER throw — it runs inside catch blocks, where a second
// throw would replace a reported failure with an unhandled one. Every property
// read is individually guarded (an exotic object can have a throwing getter) and
// the whole body has a final catch.

export type ErrorDescriptor = {
  /** Human-readable message for `new Error(...)`. Never empty. */
  message: string;
  /** Value for `err.name` if the source object carried one; null to leave 'Error'. */
  name: string | null;
  /** Scalar own-properties worth attaching as Sentry extras (code/details/hint/...). */
  fields: Record<string, string | number | boolean | null>;
};

const MAX_FIELDS = 20;
const MAX_VALUE_CHARS = 500;
// `message` becomes the Error message, `name` becomes err.name, `stack` is noise.
const SKIP_KEYS = new Set(['message', 'name', 'stack']);

function clamp(v: string): string {
  return v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS)}…` : v;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unstringifiable value]';
  }
}

/**
 * Describe any caught value. Intended for NON-Error values — `reportError`
 * short-circuits real Errors so their message/stack/grouping stay untouched —
 * but behaves sanely if handed one.
 */
export function describeError(error: unknown): ErrorDescriptor {
  try {
    // Primitives (and null/undefined) keep the historic String() behaviour.
    if (typeof error !== 'object' || error === null) {
      return { message: safeString(error), name: null, fields: {} };
    }
    const obj = error as Record<string, unknown>;

    let message = '';
    try {
      if (typeof obj.message === 'string' && obj.message.trim() !== '') {
        message = clamp(obj.message);
      }
    } catch {
      /* throwing getter — fall through to the next strategy */
    }
    if (message === '') {
      try {
        const json = JSON.stringify(obj);
        if (typeof json === 'string' && json !== '') message = clamp(json);
      } catch {
        /* circular ref or throwing toJSON — fall through */
      }
    }
    if (message === '') message = safeString(error);

    let name: string | null = null;
    try {
      if (typeof obj.name === 'string' && obj.name.trim() !== '') name = clamp(obj.name);
    } catch {
      /* throwing getter */
    }

    // Scalars only: an object/array/function value in Sentry extras is noise at
    // best, and could carry something unvetted. NOTE ON PII: a Postgres error's
    // `details` can in principle embed row values (a unique violation reads
    // "Key (col)=(val) already exists"). Every client-reachable unique
    // constraint in this app is over UUIDs, so this is not a live leak, but it
    // is why values are clamped and why nothing non-scalar is copied — see the
    // "extra is structured context — never PII" rule in CLAUDE.md.
    const fields: Record<string, string | number | boolean | null> = {};
    try {
      let n = 0;
      for (const key of Object.keys(obj)) {
        if (n >= MAX_FIELDS) break;
        if (SKIP_KEYS.has(key)) continue;
        let value: unknown;
        try {
          value = obj[key];
        } catch {
          continue; // throwing getter
        }
        if (value === null || typeof value === 'boolean' || typeof value === 'number') {
          fields[key] = value as null | boolean | number;
          n += 1;
        } else if (typeof value === 'string') {
          fields[key] = clamp(value);
          n += 1;
        }
      }
    } catch {
      /* exotic object (Proxy with a throwing ownKeys trap) — keep the message */
    }

    return { message, name, fields };
  } catch {
    return { message: '[undescribable error]', name: null, fields: {} };
  }
}
