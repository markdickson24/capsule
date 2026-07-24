/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'widget',
  // MUST NOT sanitize to "Capsule" (the main app target) or "CapsuleShare"
  // (the existing share extension). A name collision previously made
  // EAS/fastlane sign the main app with the wrong provisioning profile.
  name: 'CapsuleLiveActivity',
  bundleIdentifier: '.liveactivity',
  frameworks: ['SwiftUI', 'ActivityKit', 'WidgetKit'],
  deploymentTarget: '16.2',
});
