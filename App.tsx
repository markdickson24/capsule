import React from 'react';
import * as Sentry from '@sentry/react-native';
import { initSentry, navigationIntegration, hasSentryDsn } from './src/lib/sentry';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from './src/hooks/useAuth';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useRevenueCat } from './src/hooks/useRevenueCat';
import { useDeepLinks } from './src/hooks/useDeepLinks';
import { useShareIntent } from './src/hooks/useShareIntent';
import { useLiveActivities } from './src/hooks/useLiveActivities';
import { navigationRef } from './src/lib/navigationRef';
import AuthNavigator from './src/navigation/AuthNavigator';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { TourProvider } from './src/context/TourContext';
import { ShareIntentProvider } from './src/lib/ShareIntentProvider';
import { LoadingBrandScreen } from './src/components/LoadingBrand';
import ToastHost from './src/components/ToastHost';
import { LimitSheetHost } from './src/components/LimitSheet';
import { JoinCapsuleConfirmHost } from './src/components/JoinCapsuleConfirm';

// Init Sentry once at module load. No-op when EXPO_PUBLIC_SENTRY_DSN is unset,
// and initialized-but-disabled in dev builds. All config lives in src/lib/sentry.
initSentry();

function RootNavigator() {
  const { session, loading } = useAuth();
  usePushNotifications(session?.user.id);
  // Configure RevenueCat once and log the user in/out as the session changes,
  // so purchases tie to the Supabase user id (and the webhook can map them).
  // Mirrors usePushNotifications' lifecycle. No-op on web via the stub.
  useRevenueCat(session?.user.id);
  useDeepLinks(session);
  useShareIntent(session);
  // Keeps the lock-screen countdown in sync with capsules that are open for
  // photos. iOS-only; no-ops elsewhere and on iOS < 16.2.
  useLiveActivities(session?.user.id);

  if (loading) return <LoadingBrandScreen />;

  return session ? <AppNavigator /> : <AuthNavigator />;
}

// No `linking` prop on NavigationContainer, deliberately. `useDeepLinks` owns
// every capsule:// URL via its own Linking listener + getInitialURL, and routes
// through navigationRef. Passing `prefixes` here made React Navigation a SECOND
// consumer of the same URLs — and with no `config` it auto-derives screen names
// from path segments, so `capsule://capsule/<id>/camera` became a navigate to a
// screen literally named "capsule":
//   The action 'NAVIGATE' with payload {"name":"capsule",...} was not handled
//   by any navigator. Do you have a screen named 'capsule'?
// Every shape hit this (join/<id>, reset-password/, capsule/<id>) — the Live
// Activity tap just surfaced it first. Adding a `config` instead would fix the
// parse but leave two things navigating for one tap.
function App() {
  return (
    <ShareIntentProvider>
      <ThemeProvider>
        {/* Root SafeAreaProvider so overlays rendered as siblings of the navigator
            (e.g. ToastHost) can read insets — RN Navigation only provides one
            around the navigator's screens, not its sibling children. */}
        <SafeAreaProvider>
          <TourProvider>
            <NavigationContainer
              ref={navigationRef}
              onReady={() => navigationIntegration.registerNavigationContainer(navigationRef)}
            >
              <StatusBar style="light" />
              <RootNavigator />
              <ToastHost />
              <LimitSheetHost />
              <JoinCapsuleConfirmHost />
            </NavigationContainer>
          </TourProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </ShareIntentProvider>
  );
}

// Wraps the root component so Sentry captures unhandled errors and
// React render exceptions. When DSN is unset, this is a passthrough.
export default hasSentryDsn ? Sentry.wrap(App) : App;
