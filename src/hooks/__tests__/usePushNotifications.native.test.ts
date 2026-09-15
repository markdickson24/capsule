import { supabase } from '../../lib/supabase';
import * as PushNotificationsNative from '../usePushNotifications.native';

// Regression test for: a shared device's push_token is never cleared on
// sign-out, so a second user who signs in afterward can silently inherit the
// first user's Expo push token (permission is device/OS-scoped, not
// account-scoped) and receive their private capsule-title pushes. See
// CLAUDE.md "Push Notifications" and useAuth.ts's SIGNED_OUT handler comment
// for why the clear must happen via an explicit call before sign-out rather
// than inside the SIGNED_OUT branch itself (the session — and thus RLS
// authorization to write this user's own row — is already gone by then).

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'test-project' } } },
  easConfig: { projectId: 'test-project' },
}));

describe('clearPushToken', () => {
  it('nulls push_token for the given user id', async () => {
    const eqMock = jest.fn(() => Promise.resolve({ error: null }));
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });

    // This is the part that fails against current code: usePushNotifications
    // .native.ts has no exported way to clear a user's push token at all.
    expect(typeof PushNotificationsNative.clearPushToken).toBe('function');

    await PushNotificationsNative.clearPushToken('user-a');

    expect(supabase.from).toHaveBeenCalledWith('users');
    expect(updateMock).toHaveBeenCalledWith({ push_token: null });
    expect(eqMock).toHaveBeenCalledWith('id', 'user-a');
  });
});
