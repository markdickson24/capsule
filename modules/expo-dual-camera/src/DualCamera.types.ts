import type { ViewProps } from 'react-native';

/**
 * How the two lenses are arranged in the preview + composite frame.
 * - `sideBySide` — back | front halves.
 * - `pip` — full-frame back with a small rounded front bubble in the top-right corner.
 */
export type DualCameraLayout = 'sideBySide' | 'pip';

export type DualCaptureResult = {
  /** file:// URI of the composited still (both lenses merged into one JPEG). */
  uri: string;
  width: number;
  height: number;
  /**
   * PiP only: file:// URI of the swapped composite (front as the full frame, back
   * as the bubble). Lets the viewer offer a BeReal-style tap-to-swap. Undefined for
   * the side-by-side layout.
   */
  altUri?: string;
};

export type DualCameraInitError = {
  message: string;
};

export type DualCameraViewProps = ViewProps & {
  /** Lens arrangement: `sideBySide` (default) or `pip`. */
  layout?: DualCameraLayout;
  /** Mirror the front-lens half (matches the single-camera selfie behavior). Default true. */
  mirrorFront?: boolean;
  /** Fired if the multi-cam session can't start (unsupported device, permissions, hardware cost). */
  onInitError?: (event: { nativeEvent: DualCameraInitError }) => void;
};

/** Result of a dual-camera video recording. */
export type DualVideoResult = {
  /** file:// URI of the composited MP4 (both lenses merged, layout at time of recording). */
  uri: string;
};

/** Imperative handle exposed by <DualCameraView ref={...} />. */
export type DualCameraViewRef = {
  /** Capture both lenses and composite into a single JPEG. Rejects if the session isn't ready. */
  capturePhoto: () => Promise<DualCaptureResult>;
  /**
   * Start dual-camera video recording. Resolves when recording ends (via stopRecording or
   * maxDuration). Rejects if the session isn't ready or a recording is already in progress.
   */
  recordAsync: (options?: { maxDuration?: number }) => Promise<DualVideoResult>;
  /** Stop an in-progress recording. The recordAsync promise resolves with the output URI. */
  stopRecording: () => void;
};
