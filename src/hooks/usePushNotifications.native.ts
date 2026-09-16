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
      } else if (data?.groupId) {
        navigationRef.navigate('GroupDetail', { groupId: data.groupId });
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
        } else if (data?.groupId) {
          navigationRef.navigate('GroupDetail', { groupId: data.groupId });
        } else if (data?.screen === 'Notifications') {
          navigationRef.navigate('Tabs', { screen: 'Notifications' });
        }
      };
      if (navigationRef.isReady()) {
        navigate();
      } else {
        // Bounded poll (mirrors useDeepLinks' navigateWhenReady-style waits) —
        // a cold-launch tap that never sees navigationRef become ready must
        // not leak a forever-running interval.
        let attempts = 0;
        const maxAttempts = 50; // ~5s at 100ms
        const interval = setInterval(() => {
          attempts++;
          if (navigationRef.isReady()) {
            clearInterval(interval);
            navigate();
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            console.warn('[PushNotifications] gave up waiting for navigationRef to be ready');
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
 * Clears this user's push token. Call sites must run this BEFORE
 * supabase.auth.signOut(), never from useAuth's SIGNED_OUT handler — by the
 * time that event fires the client's session is already gone, so the UPDATE
 * would run unauthenticated and RLS would silently reject it (0 rows
 * affected, no error). Without this, a shared/handed-off device keeps the
 * departing user's Expo push token on their `users` row; permission is
 * device/OS-scoped rather than account-scoped, so the next user who signs in
 * on the same device re-registers the SAME token with no new prompt
 * (`registerToken` above only checks `getPermissionsAsync`), and the
 * departing user's capsule-title pushes keep arriving on the new user's
 * screen. Best-effort: a failure here is no worse than the pre-existing bug.
 *
 * Only ProfileScreen's Sign Out button calls this — NOT the delete-account
 * flow. `delete_my_account` destroys the auth user, so by the time its
 * `onDeleted` callback runs the JWT is already dead and this UPDATE would be
 * a guaranteed-zero-rows unauthenticated call for no benefit (the row itself
 * is typically already gone too, per the RPC's cascade). See the reverted
 * da38749/14db716 history for why that call site was removed rather than
 * kept as a "harmless" no-op.
 */
export async function clearPushToken(userId: string): Promise<void> {
  try {
    await supabase
      .from('users')
      .update({ push_token: null })
      .eq('id', userId);
  } catch (e) {
    console.warn('[PushNotifications] clearPushToken failed:', e);
  }
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
