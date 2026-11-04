// Supabase auth errors surface raw API English ("User already registered",
// "Password should be at least 6 characters"). Map the handful of common
// codes to friendly copy with a next action, so an error moment doesn't read
// as the app being janky.

export type MappedAuthError = {
  message: string;
  /** Set when the friendly copy should offer a tappable next step. */
  action?: 'signIn';
};

export const AUTH_NETWORK_MESSAGE = "Couldn't reach Capsule. Check your connection and try again.";

/**
 * True for an auth call that never got an HTTP answer: auth-js wraps a failed
 * fetch in AuthRetryableFetchError with status 0 and the platform's message
 * ("Network request failed" on React Native). That is the user's connection,
 * not a bug, so callers show AUTH_NETWORK_MESSAGE and skip Sentry
 * (REACT-NATIVE-N: Sign in with Apple from a network that couldn't reach us).
 */
export function isAuthNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; status?: unknown; message?: unknown };
  if (e.name === 'AuthRetryableFetchError') return true;
  return (
    (e.status === 0 || e.status === undefined) &&
    typeof e.message === 'string' &&
    /network request failed|failed to fetch|load failed/i.test(e.message)
  );
}

export function mapAuthError(raw: string): MappedAuthError {
  const m = raw.toLowerCase();

  if (m.includes('network request failed') || m.includes('failed to fetch')) {
    return { message: AUTH_NETWORK_MESSAGE };
  }

  if (m.includes('already registered') || m.includes('already exists')) {
    return { message: 'That email already has an account.', action: 'signIn' };
  }
  if (m.includes('invalid login credentials')) {
    return { message: 'Incorrect email or password.' };
  }
  if (m.includes('email not confirmed')) {
    return { message: 'Please confirm your email before signing in — check your inbox for the link.' };
  }
  if (m.includes('password should be at least')) {
    return { message: 'Password must be at least 8 characters.' };
  }

  return { message: raw };
}
