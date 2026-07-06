Pod::Spec.new do |s|
  s.name           = 'ExpoVideoStitcher'
  s.version        = '1.0.0'
  s.summary        = 'Concatenates video segments into a single MP4 for Capsule'
  s.description    = 'Local Expo module wrapping AVMutableComposition + AVAssetExportSession for seamless video stitching.'
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
