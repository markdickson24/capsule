import { Platform } from 'react-native';

let nativeModule: {
  stitchVideos?: (uris: string[]) => Promise<{ uri: string }>;
  trimVideo?: (uri: string, maxSeconds: number) => Promise<{ uri: string }>;
} | null = null;

if (Platform.OS !== 'web') {
  try {
    const expo = require('expo') as typeof import('expo');
    nativeModule = expo.requireNativeModule('ExpoVideoStitcher');
  } catch {
    nativeModule = null;
  }
}

/**
 * Concatenates an ordered list of video file URIs into a single MP4.
 * Resolves with the file:// URI of the stitched output.
 */
export async function stitchVideos(uris: string[]): Promise<{ uri: string }> {
  if (!nativeModule?.stitchVideos) {
    throw new Error('ExpoVideoStitcher is not available on this platform.');
  }
  return nativeModule.stitchVideos(uris);
}

/**
 * Trim a video to its first `maxSeconds` seconds. Returns the file:// URI of a
 * NEW trimmed temp file (original untouched); result duration is <= maxSeconds.
 * Native-only; throws on web / when the module is unavailable.
 */
export async function trimVideo(uri: string, maxSeconds: number): Promise<string> {
  if (!nativeModule?.trimVideo) {
    throw new Error('ExpoVideoStitcher.trimVideo is not available on this platform.');
  }
  const { uri: out } = await nativeModule.trimVideo(uri, maxSeconds);
  return out;
}
