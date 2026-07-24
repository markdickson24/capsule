import { Platform } from 'react-native';

export type StartConfig = {
  capsuleId: string;
  title: string;
  accentHex: string;
  windowStartMs: number;
  deadlineMs: number;
  photoCount: number;
  memberCount: number;
};

type NativeLiveActivity = {
  isSupported: () => boolean;
  start: (config: StartConfig) => Promise<string | null>;
  update: (capsuleId: string, photoCount: number, memberCount: number) => Promise<void>;
  end: (capsuleId: string, immediate: boolean) => Promise<void>;
  listActive: () => Promise<string[]>;
};

// The native module only exists in a native iOS build. On web, Android, and in
// Expo Go (before a prebuild has linked it) requireNativeModule throws, so
// guard every access and degrade to "unsupported" — same idiom as
// modules/expo-dual-camera/index.ts.
let nativeModule: NativeLiveActivity | null = null;

if (Platform.OS === 'ios') {
  try {
    const expo = require('expo') as typeof import('expo');
    nativeModule = expo.requireNativeModule('ExpoLiveActivity');
  } catch {
    nativeModule = null;
  }
}

/**
 * True only on iOS 16.2+ where the user hasn't disabled Live Activities for
 * the app. Gate all UI on this — a false value must render no toggle at all.
 */
export function isLiveActivitySupported(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isSupported();
  } catch {
    return false;
  }
}

export async function startLiveActivity(config: StartConfig): Promise<string | null> {
  if (!nativeModule) return null;
  return nativeModule.start(config);
}

export async function updateLiveActivity(
  capsuleId: string,
  photoCount: number,
  memberCount: number
): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.update(capsuleId, photoCount, memberCount);
}

export async function endLiveActivity(capsuleId: string, immediate = false): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.end(capsuleId, immediate);
}

export async function listActiveLiveActivities(): Promise<string[]> {
  if (!nativeModule) return [];
  return nativeModule.listActive();
}
