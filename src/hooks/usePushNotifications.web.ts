export function usePushNotifications(_userId?: string) {}

export async function requestPushPermission(_userId: string): Promise<boolean> {
  return false;
}

export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  return 'unavailable';
}
