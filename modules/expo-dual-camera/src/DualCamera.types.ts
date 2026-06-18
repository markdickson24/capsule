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

/** Imperative handle exposed by <DualCameraView ref={...} />. */
export type DualCameraViewRef = {
  /** Capture both lenses and composite into a single JPEG. Rejects if the session isn't ready. */
  capturePhoto: () => Promise<DualCaptureResult>;
};
