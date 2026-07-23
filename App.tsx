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
import { navigationRef } from './src/lib/navigationRef';
import AuthNavigator from './src/navigation/AuthNavigator';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { TourProvider } from './src/context/TourContext';
import { ShareIntentProvider } from './src/lib/ShareIntentProvider';
import { LoadingBrandScreen } from './src/components/LoadingBrand';
import ToastHost from './src/components/ToastHost';
import { LimitSheetHost } from './src/components/LimitSheet';

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

  if (loading) return <LoadingBrandScreen />;

  return session ? <AppNavigator /> : <AuthNavigator />;
}

const linking = {
  prefixes: ['capsule://'],
};

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
              linking={linking}
              onReady={() => navigationIntegration.registerNavigationContainer(navigationRef)}
            >
              <StatusBar style="light" />
              <RootNavigator />
              <ToastHost />
              <LimitSheetHost />
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
