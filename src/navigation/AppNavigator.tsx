import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppTabParamList, AppStackParamList } from '../types/navigation';
import HomeScreen from '../screens/app/HomeScreen';
import CreateScreen from '../screens/app/CreateScreen';
import CameraScreen from '../screens/app/CameraScreen';
import NotificationsScreen from '../screens/app/NotificationsScreen';
import ProfileScreen from '../screens/app/ProfileScreen';
import CapsuleDetailScreen from '../screens/app/CapsuleDetailScreen';
import PublicProfileScreen from '../screens/app/PublicProfileScreen';
import PreviewScreen from '../screens/app/PreviewScreen';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

const TAB_CONFIG: Record<string, { emoji: string; label: string }> = {
  Home:          { emoji: '🏠', label: 'Home' },
  Create:        { emoji: '✨', label: 'Create' },
  Camera:        { emoji: '📷', label: '' },
  Notifications: { emoji: '🔔', label: 'Alerts' },
  Profile:       { emoji: '👤', label: 'Profile' },
};

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const config = TAB_CONFIG[route.name];
          const isCamera = route.name === 'Camera';

          const onPress = () => {
            if (!isFocused) navigation.navigate(route.name);
          };

          if (isCamera) {
            return (
              <View key={route.key} style={styles.cameraSlot}>
                {/* Ring in screen bg color carves the button off the bar */}
                <View style={styles.cameraRing}>
                  <TouchableOpacity
                    style={[styles.cameraBtn, isFocused && styles.cameraBtnActive]}
                    onPress={onPress}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.cameraEmoji}>{config.emoji}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tab}
              onPress={onPress}
              activeOpacity={0.7}
            >
              <Text style={[styles.emoji, { opacity: isFocused ? 1 : 0.4 }]}>
                {config.emoji}
              </Text>
              <Text style={[styles.label, isFocused && styles.labelActive]}>
                {config.label}
              </Text>
              {isFocused && <View style={styles.underline} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#111111',
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
  },
  bar: {
    flexDirection: 'row',
    height: 60,
    alignItems: 'flex-end',
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  emoji: {
    fontSize: 22,
  },
  label: {
    fontSize: 11,
    color: '#555555',
    fontWeight: '500',
  },
  labelActive: {
    color: '#FF6B35',
  },
  underline: {
    width: 18,
    height: 2,
    backgroundColor: '#FF6B35',
    borderRadius: 1,
  },
  cameraSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  cameraRing: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#0A0A0A', // screen background — carves a notch in the bar
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -20 }],
  },
  cameraBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B35',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  cameraBtnActive: {
    shadowOpacity: 0.75,
    shadowRadius: 16,
  },
  cameraEmoji: {
    fontSize: 26,
  },
});

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Create" component={CreateScreen} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="CapsuleDetail" component={CapsuleDetailScreen} />
      <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
      <Stack.Screen
        name="Preview"
        component={PreviewScreen}
        options={{ animation: 'none' }}
      />
    </Stack.Navigator>
  );
}
