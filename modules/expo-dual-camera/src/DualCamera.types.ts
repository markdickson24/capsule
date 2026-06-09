import type { ViewProps } from 'react-native';

/** How the two lenses are arranged in the composite frame. Phase 1 ships `sideBySide`. */
export type DualCameraLayout = 'sideBySide';

export type DualCaptureResult = {
  /** file:// URI of the composited still (both lenses merged into one JPEG). */
  uri: string;
  width: number;
  height: number;
};

export type DualCameraInitError = {
  message: string;
};

export type DualCameraViewProps = ViewProps & {
  /** Lens arrangement. Only `sideBySide` is implemented in Phase 1. */
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
