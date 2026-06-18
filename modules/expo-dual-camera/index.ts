import { Platform } from 'react-native';
import * as React from 'react';

import type {
  DualCameraViewProps,
  DualCameraViewRef,
  DualCaptureResult,
} from './src/DualCamera.types';

export type {
  DualCameraViewProps,
  DualCameraViewRef,
  DualCaptureResult,
  DualCameraLayout,
  DualCaptureResult as DualCameraCaptureResult,
} from './src/DualCamera.types';

// The native module + view only exist in a native build. On web (and before a
// prebuild has linked the module) `require('expo')` resolution succeeds but the
// native registration is absent, so guard every access and fall back gracefully.
let nativeModule: { isSupported?: boolean } | null = null;
let NativeView: React.ComponentType<any> | null = null;

if (Platform.OS !== 'web') {
  try {
    // Lazy require so web bundling never touches the native bridge.
    const expo = require('expo') as typeof import('expo');
    nativeModule = expo.requireNativeModule('ExpoDualCamera');
    NativeView = expo.requireNativeView('ExpoDualCamera');
  } catch {
    nativeModule = null;
    NativeView = null;
  }
}

/**
 * True only on a device whose hardware + OS can run a simultaneous front+back
 * capture session. Use this to decide whether to surface the "Dual" camera mode.
 */
export const isDualCameraSupported: boolean =
  Platform.OS !== 'web' && !!nativeModule?.isSupported && NativeView != null;

/**
 * Simultaneous front+back dual-camera preview. `layout` selects `sideBySide`
 * (default) or `pip`. Renders nothing when the device/platform is unsupported,
 * so callers should gate on `isDualCameraSupported`.
 */
export const DualCameraView = React.forwardRef<DualCameraViewRef, DualCameraViewProps>(
  (props, ref) => {
    if (!NativeView) return null;
    return React.createElement(NativeView, { ...props, ref });
  }
);

DualCameraView.displayName = 'DualCameraView';
