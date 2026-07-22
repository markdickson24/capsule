import React from 'react';
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

function RootNavigator() {
  const { session, loading } = useAuth();
  usePushNotifications(session?.user.id);
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
            <NavigationContainer ref={navigationRef} linking={linking}>
              <StatusBar style="light" />
              <RootNavigator />
              <ToastHost />
            </NavigationContainer>
          </TourProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </ShareIntentProvider>
  );
}

export default App;

