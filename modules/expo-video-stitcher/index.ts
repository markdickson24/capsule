import { Platform } from 'react-native';

let nativeModule: { stitchVideos?: (uris: string[]) => Promise<{ uri: string }> } | null = null;

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
