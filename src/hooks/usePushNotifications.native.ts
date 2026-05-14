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

async function registerToken(userId: string) {
  if (Platform.OS === 'web') return;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

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
