Pod::Spec.new do |s|
  s.name           = 'Remix3D'
  s.version        = '0.1.0'
  s.summary        = 'LiDAR 3D capture, reconstruction and viewing for Remix'
  s.description    = 'Object Capture (RealityKit) + fotogrammetria + SceneKit-néző — csak LiDAR-os iOS/iPadOS eszközön.'
  s.author         = 'Remix'
  s.homepage       = 'https://remix.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'RealityKit', 'SceneKit', 'ModelIO', 'SwiftUI'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
