// Learn more https://docs.expo.dev/guides/customizing-metro
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Required by @sentry/react-native (and any modern package using the
// "exports" field instead of the legacy "main" field for subpath resolution).
config.resolver.unstable_enablePackageExports = true;

module.exports = config;