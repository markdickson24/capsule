// Supabase auth errors surface raw API English ("User already registered",
// "Password should be at least 6 characters"). Map the handful of common
// codes to friendly copy with a next action, so an error moment doesn't read
// as the app being janky.

export type MappedAuthError = {
  message: string;
  /** Set when the friendly copy should offer a tappable next step. */
  action?: 'signIn';
};

export function mapAuthError(raw: string): MappedAuthError {
  const m = raw.toLowerCase();

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
