import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createVideoPlayer } from 'expo-video';

// expo-image-picker's ImagePickerAsset.duration is documented as
// milliseconds and IS milliseconds on iOS/Android, but the web shim
// (ExponentImagePicker.web.ts) sets it straight from HTMLVideoElement's
// `duration`, which the DOM defines in SECONDS — an inconsistency in the
// library itself, not something to "fix" here. Normalize to ms so callers
// get a consistent unit on both platforms.
//
// Missing/unreadable duration (null/undefined) deliberately fails OPEN —
// it's treated as 0ms rather than throwing or being flagged. A video whose
// metadata the picker couldn't read is far more likely to be a picker quirk
// than an actual multi-hour file, and callers that gate on this value should
// treat 0/unknown as "don't block."
export function assetDurationMs(asset: ImagePicker.ImagePickerAsset): number {
  const raw = asset.duration ?? 0;
  return Platform.OS === 'web' ? raw * 1000 : raw;
}

/** Best-effort local-file video duration in ms. undefined on web / failure
 * (caller then treats the clip as ungated — fail-open, client-only limit). */
export async function probeVideoDurationMs(uri: string): Promise<number | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const player = createVideoPlayer(uri);
    for (let i = 0; i < 20; i++) {
      const d = player.duration;
      if (d && d > 0) { player.release(); return Math.round(d * 1000); }
      await new Promise((r) => setTimeout(r, 100));
    }
    player.release();
    return undefined;
  } catch {
    return undefined;
  }
}
