import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppTabParamList, AppStackParamList } from '../types/navigation';
import LoadingBrand, { LoadingBrandScreen } from '../components/LoadingBrand';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { cache } from '../lib/cache';
import { haptics } from '../lib/haptics';
import { useTheme } from '../context/ThemeContext';
import { useTour, measureNode } from '../context/TourContext';
import AccentSurface from '../components/AccentSurface';
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
import BlockedUsersScreen from '../screens/app/BlockedUsersScreen';
import OnboardingScreen from '../screens/app/OnboardingScreen';
import FriendsScreen from '../screens/app/FriendsScreen';
import QRScannerScreen from '../screens/app/QRScannerScreen';
import GroupDetailScreen from '../screens/app/GroupDetailScreen';
import ManageGroupScreen from '../screens/app/ManageGroupScreen';
import CreateGroupScreen from '../screens/app/CreateGroupScreen';

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
  const { registerTarget, unregisterTarget } = useTour();
  const makeTabRef = React.useCallback((routeName: string) => (node: any) => {
    const id = `tab:${routeName}`;
    if (node) registerTarget(id, () => measureNode(node));
    else unregisterTarget(id);
  }, [registerTarget, unregisterTarget]);

  // Badge is derived from the `notifications` cache the Alerts screen already
  // fills, instead of an independent per-tab-switch query throttled to 60s (which
  // left the badge stale for up to a minute after reading — BUGS.md #10). When the
  // cache is populated the count is the length of that grouped list; when it's been
  // invalidated (or never loaded — e.g. cold start before visiting Alerts) we fall
  // back to a lightweight count query. Subscribing means the badge updates the
  // instant a notification is read/dismissed/received.
  useEffect(() => {
    let active = true;
    async function fetchCount() {
      const session = sessionStore.get();
      if (!session) return;
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .is('read_at', null);
      if (active) setUnreadCount(count ?? 0);
    }
    function recompute() {
      const cached = cache.get<{ notifications: unknown[] }>('notifications');
      if (cached?.notifications) setUnreadCount(cached.notifications.length);
      else fetchCount();
    }
    recompute();
    const unsubscribe = cache.subscribe('notifications', recompute);
    return () => { active = false; unsubscribe(); };
  }, []);

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const config = TAB_CONFIG[route.name];
          const isCamera = route.name === 'Camera';

          const onPress = () => {
            if (isCamera) haptics.medium();
            else haptics.light();
            if (!isFocused) navigation.navigate(route.name);
          };

          if (isCamera) {
            return (
              <View key={route.key} style={styles.cameraSlot}>
                <View style={styles.cameraRing}>
                  <TouchableOpacity
                    ref={makeTabRef(route.name)}
                    {...({ collapsable: false } as any)}
                    style={[styles.cameraBtn, isFocused && styles.cameraBtnActive, Platform.select({
                      default: { shadowColor: accentColor, shadowOpacity: isFocused ? 0.75 : 0.5, shadowRadius: isFocused ? 16 : 12, shadowOffset: { width: 0, height: 4 } },
                      web: {},
                    })]}
                    onPress={onPress}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Open camera"
                  >
                    <AccentSurface style={styles.cameraBtnFill}>
                      <Ionicons name="camera" size={26} color="#FFFFFF" />
                    </AccentSurface>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          const showBadge = route.name === 'Notifications' && unreadCount > 0;

          return (
            <TouchableOpacity
              key={route.key}
              ref={makeTabRef(route.name)}
              {...({ collapsable: false } as any)}
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
                    <Text style={styles.badgeText} maxFontSizeMultiplier={1.3}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, isFocused && { color: accentColor }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
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
    color: '#888888',
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
    elevation: 8,
    overflow: 'hidden',
  },
  cameraBtnFill: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  cameraBtnActive: {},
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
  const { accentColor } = useTheme();
  const [initialRoute, setInitialRoute] = useState<'Onboarding' | 'Tabs' | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const session = sessionStore.get();
    if (!session) { setInitialRoute('Tabs'); return; }

    const userId = session.user.id;

    sessionStore.wasOnboarded(userId).then(flag => {
      if (cancelled) return;

      if (flag) {
        // Fast path: a previous launch already confirmed this user is
        // onboarded — skip the network round-trip entirely instead of
        // blocking first paint on it. onboarded_at never un-sets in practice.
        setInitialRoute('Tabs');
        return;
      }

      // Slow path (first launch, fresh install, or not yet onboarded): fall
      // back to the original network check.
      let resolved = false;
      timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          setInitialRoute('Tabs');
        }
      }, 5000);

      Promise.resolve(
        supabase
          .from('users')
          .select('onboarded_at')
          .eq('id', userId)
          .single()
      )
        .then(({ data, error }) => {
          if (resolved || cancelled) return;
          resolved = true;
          if (timeout) clearTimeout(timeout);
          if (error) {
            setInitialRoute('Tabs');
            return;
          }
          const onboarded = !!(data as any)?.onboarded_at;
          if (onboarded) sessionStore.markOnboarded(userId);
          setInitialRoute(onboarded ? 'Tabs' : 'Onboarding');
        })
        .catch(() => {
          if (resolved || cancelled) return;
          resolved = true;
          if (timeout) clearTimeout(timeout);
          setInitialRoute('Tabs');
        });
    });

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  if (initialRoute === null) return <LoadingBrandScreen />;

  return (
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="Tabs" component={TabNavigator} options={{ animation: 'fade' }} />
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
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <Stack.Screen name="Friends" component={FriendsScreen} />
      <Stack.Screen name="QRScanner" component={QRScannerScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
      <Stack.Screen name="ManageGroup" component={ManageGroupScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="CreateGroup" component={CreateGroupScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="CreateCapsule" component={CreateScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
