import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../lib/navigationRef';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function usePushNotifications(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    registerToken(userId);
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (!navigationRef.isReady()) return;
      if (data?.capsuleId) {
        navigationRef.navigate('CapsuleDetail', { capsuleId: data.capsuleId });
      } else if (data?.screen === 'Notifications') {
        navigationRef.navigate('Tabs', { screen: 'Notifications' });
      }
    });

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, string>;
      const navigate = () => {
        if (data?.capsuleId) {
          navigationRef.navigate('CapsuleDetail', { capsuleId: data.capsuleId });
        } else if (data?.screen === 'Notifications') {
          navigationRef.navigate('Tabs', { screen: 'Notifications' });
        }
      };
      if (navigationRef.isReady()) {
        navigate();
      } else {
        const interval = setInterval(() => {
          if (navigationRef.isReady()) {
            clearInterval(interval);
            navigate();
          }
        }, 100);
      }
    });

    return () => sub.remove();
  }, []);
}

// Launch-path registration: NEVER requests permission. iOS gives exactly one
// shot at the native prompt, and firing it cold at launch (it used to stack on
// top of Onboarding step 1 for fresh sign-ups) burns it at the worst possible
// moment. This only refreshes the token for users who already granted; the
// actual ask happens via requestPushPermission() below, behind Onboarding v2's
// contextual primer.
async function registerToken(userId: string) {
  if (Platform.OS === 'web') return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  let token: string | undefined;
  try {
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    token = result.data;
  } catch (e) {
    console.warn('[PushNotifications] getExpoPushTokenAsync failed:', e);
    return;
  }

  if (!token) return;

  await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId);
}

/**
 * Read-only permission status, so a contextual primer can decide whether to
 * show a soft ask *before* the native dialog. Never prompts. 'unavailable' on
 * web (the stub) so callers can treat it as "don't show a primer."
 */
export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  if (Platform.OS === 'web') return 'unavailable';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  return 'denied';
}

/**
 * The one place the native permission prompt is allowed to fire. Called from
 * the Onboarding "Don't miss it" primer (and any future contextual re-ask).
 * Returns whether pushes ended up enabled; registers the token on grant.
 */
export async function requestPushPermission(userId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return false;

  await registerToken(userId);
  return true;
}
