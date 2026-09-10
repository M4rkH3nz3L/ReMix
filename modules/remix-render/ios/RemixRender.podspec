Pod::Spec.new do |s|
  s.name           = 'RemixRender'
  s.version        = '1.0.0'
  s.summary        = 'On-device video render (AVFoundation) for Remix'
  s.description    = 'A Remix idővonalat MP4-be kompozitálja az eszközön, szerver nélkül.'
  s.author         = 'Remix'
  s.homepage       = 'https://remix.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
