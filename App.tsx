import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from './src/hooks/useAuth';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useDeepLinks } from './src/hooks/useDeepLinks';
import { useShareIntent } from './src/hooks/useShareIntent';
import { navigationRef } from './src/lib/navigationRef';
import AuthNavigator from './src/navigation/AuthNavigator';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { ShareIntentProvider } from './src/lib/ShareIntentProvider';

function RootNavigator() {
  const { session, loading } = useAuth();
  usePushNotifications(session?.user.id);
  useDeepLinks();
  useShareIntent(session);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FF6B35" size="large" />
      </View>
    );
  }

  return session ? <AppNavigator /> : <AuthNavigator />;
}

const linking = {
  prefixes: ['capsule://'],
};

export default function App() {
  return (
    <ShareIntentProvider>
      <ThemeProvider>
        <NavigationContainer ref={navigationRef} linking={linking}>
          <StatusBar style="light" />
          <RootNavigator />
        </NavigationContainer>
      </ThemeProvider>
    </ShareIntentProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
