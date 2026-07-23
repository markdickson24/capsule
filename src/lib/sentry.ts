// Central Sentry wiring for the app. Everything Sentry-related routes through
// here so init options, PII policy, and the manual-capture helper live in one
// place. Import `reportError` in any catch block that would otherwise swallow
// or only-toast an error (see the "toast on failure" convention in CLAUDE.md).
//
// Decisions baked in (see the monetization/ops notes):
//  - User is identified by Supabase user id ONLY. sendDefaultPii is false and
//    beforeSend strips email/ip/username as a belt-and-suspenders scrub, so no
//    customer PII lands in Sentry — appropriate for a private photo app.
//  - Events are sent only in RELEASE builds (TestFlight / App Store). __DEV__ is
//    true under Metro/Expo dev, so the SDK is initialized-but-disabled there and
//    the dashboard stays free of local dev / HMR noise.
//  - Performance tracing only (no Session Replay — it records the user's screen).
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** True only when a DSN exists — gates `Sentry.wrap` in App.tsx. */
export const hasSentryDsn = !!DSN;

/**
 * Send events only in release builds. __DEV__ is false in TestFlight/App Store
 * builds and true under Metro. When false, `Sentry.init` still runs (so
 * instrumentation is wired) but the SDK transmits nothing.
 */
const sentryEnabled = !!DSN && !__DEV__;

/**
 * React Navigation integration instance. Register it with the
 * NavigationContainer ref (see App.tsx) so screen changes become breadcrumbs
 * and performance transactions.
 */
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

/** Initialize Sentry once at module load (called from App.tsx). */
export function initSentry() {
  if (!DSN) return; // nothing to send to — leave the SDK uninitialized

  Sentry.init({
    dsn: DSN,
    enabled: sentryEnabled,
    // Distinguish TestFlight/preview from App Store if a build injects it;
    // otherwise release builds report as 'production', dev as 'development'.
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? (__DEV__ ? 'development' : 'production'),
    // Group events by app version + build. release = bundleId@version, dist =
    // native build number — mirrors how the Sentry Expo plugin names uploads.
    release: `${Constants.expoConfig?.ios?.bundleIdentifier ?? 'com.markdickson.capsule'}@${
      Constants.expoConfig?.version ?? '0.0.0'
    }`,
    dist: Constants.nativeBuildVersion ?? undefined,
    // Privacy: id only. No email/IP/username, even if an integration adds it.
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.2,
    enableNative: true,
    integrations: [navigationIntegration],
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
  });
}

/** Attach (or clear, on sign-out) the current user by Supabase id only. */
export function setSentryUser(userId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Central manual-capture helper. Use in catch blocks where the app currently
 * swallows an error or only shows a toast, so background failures become
 * visible in Sentry. Safe no-op when Sentry isn't initialized/enabled.
 *
 * @param where  short tag naming the call site, e.g. 'uploadQueue.runTask'
 * @param extra  arbitrary structured context (ids, counts) — never PII
 */
export function reportError(
  error: unknown,
  { where, extra }: { where?: string; extra?: Record<string, unknown> } = {},
) {
  const err = error instanceof Error ? error : new Error(String(error));
  if (!where && !extra) {
    Sentry.captureException(err);
    return;
  }
  Sentry.withScope((scope) => {
    if (where) scope.setTag('where', where);
    if (extra) scope.setExtras(extra);
    Sentry.captureException(err);
  });
}
