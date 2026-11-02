import { Platform } from 'react-native';

let nativeModule: {
  stitchVideos?: (uris: string[]) => Promise<{ uri: string }>;
  trimVideo?: (uri: string, maxSeconds: number) => Promise<{ uri: string }>;
  probeVideo?: (uri: string) => Promise<{ width: number; height: number; durationSec: number }>;
  compressVideo?: (uri: string, maxDimension: number, videoBitrate: number) => Promise<{ uri: string }>;
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

/**
 * Displayed (post-rotation) width/height and duration of a local video.
 * Returns null when the native module isn't available (web, Android).
 */
export async function probeVideo(
  uri: string,
): Promise<{ width: number; height: number; durationSec: number } | null> {
  if (!nativeModule?.probeVideo) return null;
  return nativeModule.probeVideo(uri);
}

/**
 * Re-encode to H.264/AAC MP4: long side capped at `maxDimension`, at most
 * 30fps, video at `videoBitrate` bps, HDR tone-mapped to SDR. Returns the
 * file:// URI of a NEW temp file (original untouched), or null when the native
 * module isn't available. Throws if the encode fails.
 */
export async function compressVideo(
  uri: string,
  maxDimension: number,
  videoBitrate: number,
): Promise<string | null> {
  if (!nativeModule?.compressVideo) return null;
  const { uri: out } = await nativeModule.compressVideo(uri, maxDimension, videoBitrate);
  return out;
}
