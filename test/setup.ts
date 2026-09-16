// Global Jest setup for Tier 1 (component) tests. Runs after the jest-expo
// preset's own setup (which already mocks expo-modules-core and the native
// module registry — see jest-expo/src/preset/setup.js).
//
// Keep this file to ONLY the mocks that are genuinely required. Most of the
// app's native deps (expo-image, expo-haptics, expo-location, expo-file-system,
// @supabase/supabase-js, react-native-safe-area-context, react-native-svg,
// @react-navigation/*, etc.) import cleanly under jest-expo with no mock at
// all — adding one anyway is dead code to maintain.

// Dummy Supabase env vars so any module that transitively imports
// src/lib/supabase.ts (which reads these with a non-null assertion at module
// load) doesn't throw `supabaseUrl is required.` merely by being imported.
// Individual test files still jest.mock('.../lib/supabase') to control the
// actual data — this is just a safety net for the import itself.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// expo-video: the JS wrapper subclasses a native class that jest-expo's mock
// module doesn't supply, so importing it throws
// `TypeError: Cannot read properties of undefined (reading 'prototype')`.
// CapsuleDetailScreen.tsx imports { useVideoPlayer, VideoView } directly, so
// nothing in that screen loads without this.
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: jest.fn(() => ({
      play: jest.fn(),
      pause: jest.fn(),
      replace: jest.fn(),
      loop: false,
      muted: false,
      currentTime: 0,
      duration: 0,
      addListener: jest.fn(() => ({ remove: jest.fn() })),
    })),
    VideoView: (props: any) => React.createElement(View, props),
    createVideoPlayer: jest.fn(),
    isPictureInPictureSupported: jest.fn(() => false),
  };
});

// react-native-purchases / react-native-purchases-ui ship untranspiled ESM
// (`SyntaxError: Unexpected token 'export'` under jest-expo's default
// transformIgnorePatterns). Reached via src/lib/purchases.native.ts, which
// the jest-expo/ios preset resolves to for any `../lib/purchases` import
// (e.g. CapsuleDetailScreen.tsx, useEntitlements.ts).
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn(() => Promise.resolve({ customerInfo: {} })),
    logOut: jest.fn(() => Promise.resolve({})),
    getCustomerInfo: jest.fn(() => Promise.resolve({ entitlements: { active: {} } })),
    getOfferings: jest.fn(() => Promise.resolve({ current: null })),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  },
  LOG_LEVEL: { DEBUG: 'DEBUG', VERBOSE: 'VERBOSE', WARN: 'WARN', ERROR: 'ERROR' },
}));

jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: {
    presentPaywall: jest.fn(() => Promise.resolve('NOT_PRESENTED')),
    presentPaywallIfNeeded: jest.fn(() => Promise.resolve('NOT_PRESENTED')),
  },
  PAYWALL_RESULT: { NOT_PRESENTED: 'NOT_PRESENTED', PURCHASED: 'PURCHASED', CANCELLED: 'CANCELLED', ERROR: 'ERROR', RESTORED: 'RESTORED' },
}));

// @react-native-async-storage/async-storage's native module is null under
// jest — use the package's own shipped jest mock rather than hand-rolling one.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
