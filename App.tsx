import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from './src/hooks/useAuth';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import AuthNavigator from './src/navigation/AuthNavigator';
import AppNavigator from './src/navigation/AppNavigator';

function RootNavigator() {
  const { session, loading } = useAuth();
  usePushNotifications(session?.user.id);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FF6B35" size="large" />
      </View>
    );
  }

  return session ? <AppNavigator /> : <AuthNavigator />;
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <RootNavigator />
    </NavigationContainer>
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
