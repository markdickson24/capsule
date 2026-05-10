import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { AppTabParamList, AppStackParamList } from '../types/navigation';
import HomeScreen from '../screens/app/HomeScreen';
import CreateScreen from '../screens/app/CreateScreen';
import NotificationsScreen from '../screens/app/NotificationsScreen';
import ProfileScreen from '../screens/app/ProfileScreen';
import CapsuleDetailScreen from '../screens/app/CapsuleDetailScreen';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

function icon(emoji: string) {
  return () => <Text style={{ fontSize: 22 }}>{emoji}</Text>;
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111111', borderTopColor: '#222222' },
        tabBarActiveTintColor: '#FF6B35',
        tabBarInactiveTintColor: '#555555',
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: icon('🏠'), tabBarLabel: 'Home' }} />
      <Tab.Screen name="Create" component={CreateScreen} options={{ tabBarIcon: icon('➕'), tabBarLabel: 'New' }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ tabBarIcon: icon('🔔'), tabBarLabel: 'Alerts' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: icon('👤'), tabBarLabel: 'Profile' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="CapsuleDetail" component={CapsuleDetailScreen} />
    </Stack.Navigator>
  );
}
