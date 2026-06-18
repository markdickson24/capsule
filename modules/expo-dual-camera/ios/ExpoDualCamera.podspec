Pod::Spec.new do |s|
  s.name           = 'ExpoDualCamera'
  s.version        = '1.0.0'
  s.summary        = 'Simultaneous front+back (multi-cam) camera for Capsule'
  s.description    = 'Local Expo module wrapping AVCaptureMultiCamSession for side-by-side dual capture.'
  s.author         = ''
  s.homepage       = 'https://github.com/markdickson/capsule'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
