export function usePushNotifications(_userId?: string) {}

export async function requestPushPermission(_userId: string): Promise<boolean> {
  return false;
}

// No-op: push tokens are only ever registered natively (see
// usePushNotifications.native.ts), so there's nothing to clear on web.
export async function clearPushToken(_userId: string): Promise<void> {}
