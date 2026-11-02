// Sizing decisions for re-encoding videos before upload. Pure so it can be
// asserted under tsx; the native re-encode lives in expo-video-stitcher
// (compressVideo) and the wiring in uploadQueue.prepareForUpload.
//
// Supabase Storage rejects any object over the project's global upload limit
// (50 MB) with "413 EntityTooLarge", which the client saw as "Storage 400"
// (REACT-NATIVE-E). Library videos used to upload untouched — a 4K iPhone clip
// passes 50 MB in seconds — and dual-camera recordings run ~60 MB/min.

/** Supabase project-wide upload limit. Anything larger fails server-side. */
export const STORAGE_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

/** Target size for a re-encode. Headroom under the limit because the encoder's
 *  average bitrate is a target, not a ceiling (~10% overshoot is normal). */
export const VIDEO_BUDGET_BYTES = 42 * 1024 * 1024;

/** 1080p: the long side, so portrait and landscape are capped alike. */
export const MAX_VIDEO_DIMENSION = 1920;

export const AUDIO_BITRATE = 128_000;
export const MIN_VIDEO_BITRATE = 1_500_000;
export const MAX_VIDEO_BITRATE = 6_000_000;

export type VideoProbe = { width: number; height: number; durationSec: number };

/**
 * Video bitrate that fits a clip of `durationSec` into VIDEO_BUDGET_BYTES,
 * clamped so short clips aren't bloated and long ones aren't unwatchable.
 */
export function videoBitrateFor(durationSec: number): number {
  if (!(durationSec > 0)) return MAX_VIDEO_BITRATE;
  const fit = (VIDEO_BUDGET_BYTES * 8) / durationSec - AUDIO_BITRATE;
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, fit)));
}

/**
 * Whether a video needs re-encoding before upload, and at what bitrate.
 * Returns null to upload the original as-is.
 */
export function videoCompressionPlan(
  probe: VideoProbe,
  sizeBytes: number,
): { maxDimension: number; videoBitrate: number } | null {
  const longSide = Math.max(probe.width, probe.height);
  if (longSide <= MAX_VIDEO_DIMENSION && sizeBytes <= VIDEO_BUDGET_BYTES) return null;
  return { maxDimension: MAX_VIDEO_DIMENSION, videoBitrate: videoBitrateFor(probe.durationSec) };
}
