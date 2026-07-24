Pod::Spec.new do |s|
  s.name           = 'ExpoLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'ActivityKit Live Activity bridge for Capsule'
  s.description    = 'Starts, updates and ends the capsule contribution-window Live Activity.'
  s.author         = ''
  s.homepage       = 'https://github.com/markdickson24/capsule'
  s.platforms      = { :ios => '15.5' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Compiles BOTH ExpoLiveActivityModule.swift and the shared
  # CapsuleActivityAttributes.swift into the app target. The widget extension
  # compiles the same attributes file via its symlink in targets/liveactivity/.
  s.source_files = "**/*.{h,m,swift}"
end
