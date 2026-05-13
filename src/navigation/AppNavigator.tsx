import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppTabParamList, AppStackParamList } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import HomeScreen from '../screens/app/HomeScreen';
import CreateScreen from '../screens/app/CreateScreen';
import CameraScreen from '../screens/app/CameraScreen';
import NotificationsScreen from '../screens/app/NotificationsScreen';
import ProfileScreen from '../screens/app/ProfileScreen';
import CapsuleDetailScreen from '../screens/app/CapsuleDetailScreen';
import PublicProfileScreen from '../screens/app/PublicProfileScreen';
import PreviewScreen from '../screens/app/PreviewScreen';
import ResetPasswordScreen from '../screens/app/ResetPasswordScreen';
import EditCapsuleScreen from '../screens/app/EditCapsuleScreen';
import ManageMembersScreen from '../screens/app/ManageMembersScreen';
import SettingsScreen from '../screens/app/SettingsScreen';

const Tab = createBottomTabNavigator<AppTabParamList>();
const Stack = createNativeStackNavigator<AppStackParamList>();

type TabConfig = { icon: keyof typeof Ionicons.glyphMap; iconFilled: keyof typeof Ionicons.glyphMap; label: string };
const TAB_CONFIG: Record<string, TabConfig> = {
  Home:          { icon: 'home-outline',          iconFilled: 'home',          label: 'Home' },
  Create:        { icon: 'add-circle-outline',    iconFilled: 'add-circle',    label: 'Create' },
  Camera:        { icon: 'camera-outline',        iconFilled: 'camera',        label: '' },
  Notifications: { icon: 'notifications-outline', iconFilled: 'notifications', label: 'Alerts' },
  Profile:       { icon: 'person-outline',        iconFilled: 'person',        label: 'Profile' },
};

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { accentColor } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    async function fetchCount() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .is('read_at', null);
      setUnreadCount(count ?? 0);
    }
    fetchCount();
  }, [state.index]);

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
                <View style={styles.cameraRing}>
                  <TouchableOpacity
                    style={[styles.cameraBtn, { backgroundColor: accentColor, shadowColor: accentColor }, isFocused && styles.cameraBtnActive]}
                    onPress={onPress}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="camera" size={26} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          const showBadge = route.name === 'Notifications' && unreadCount > 0;

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tab}
              onPress={onPress}
              activeOpacity={0.7}
            >
              <View>
                <Ionicons
                  name={isFocused ? config.iconFilled : config.icon}
                  size={22}
                  color={isFocused ? accentColor : '#555555'}
                />
                {showBadge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, isFocused && { color: accentColor }]}>
                {config.label}
              </Text>
              {isFocused && <View style={[styles.underline, { backgroundColor: accentColor }]} />}
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
    transform: [{ translateY: -10 }],
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
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
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      <Stack.Screen name="EditCapsule" component={EditCapsuleScreen} />
      <Stack.Screen name="ManageMembers" component={ManageMembersScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
