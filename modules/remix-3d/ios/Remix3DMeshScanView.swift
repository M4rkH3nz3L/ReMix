import ARKit
import ExpoModulesCore
import ModelIO
import RealityKit
import UIKit

// 🧊 Szabad szken ÉLŐ HÁLÓVAL (3D-Studio.md §2.3) — ARKit scene reconstruction.
//
// A LiDAR valós időben építi a háromszöghálót; a RealityKit `showSceneUnderstanding`
// a hálót a kameraképre rajzolja — a felhasználó LÁTJA, mi van már meg (a profi
// szkenner-appok élménye). Kész-kor az összes `ARMeshAnchor` geometriája VILÁG-
// koordinátában egy ModelIO-hálóvá áll össze, és fájlba exportálódik.

@MainActor
final class Remix3DMeshScanView: ExpoView, ARSessionDelegate {
  let onScanState = EventDispatcher()

  private let arView = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
  private var lastEmit = Date.distantPast

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    arView.debugOptions.insert(.showSceneUnderstanding)
    arView.environment.sceneUnderstanding.options = [.occlusion]
    arView.renderOptions.insert(.disableMotionBlur)
    arView.session.delegate = self
    addSubview(arView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
  }

  func start() throws {
    guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) else {
      throw Remix3DError.unsupported("sceneReconstruction")
    }
    let config = ARWorldTrackingConfiguration()
    config.sceneReconstruction = .mesh
    config.environmentTexturing = .none
    if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      config.frameSemantics.insert(.sceneDepth)
    }
    arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }

  func pause() {
    arView.session.pause()
  }

  // ── élő állapot a JS-nek (max. 2×/s): háromszögszám, követés minősége ──────
  nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
    let tracking: String
    switch frame.camera.trackingState {
    case .normal: tracking = "normal"
    case .notAvailable: tracking = "notAvailable"
    case .limited(let reason):
      switch reason {
      case .excessiveMotion: tracking = "excessiveMotion"
      case .insufficientFeatures: tracking = "insufficientFeatures"
      case .initializing: tracking = "initializing"
      case .relocalizing: tracking = "relocalizing"
      @unknown default: tracking = "limited"
      }
    }
    let faces = frame.anchors.compactMap { $0 as? ARMeshAnchor }.reduce(0) { $0 + $1.geometry.faces.count }
    let lux = frame.lightEstimate?.ambientIntensity ?? 1000
    Task { @MainActor in
      guard Date().timeIntervalSince(self.lastEmit) > 0.5 else { return }
      self.lastEmit = Date()
      self.onScanState(["tracking": tracking, "triangles": faces, "light": lux])
    }
  }

  /// az összes háló-darab → egy világ-koordinátás háló → fájl (kiterjesztés szerinti formátum)
  func exportMesh(to output: URL) throws -> [String: Any] {
    guard let frame = arView.session.currentFrame else { throw Remix3DError.failed("noFrame") }
    let anchors = frame.anchors.compactMap { $0 as? ARMeshAnchor }
    guard !anchors.isEmpty else { throw Remix3DError.failed("emptyMesh") }

    var positions: [SIMD3<Float>] = []
    var indices: [UInt32] = []
    for anchor in anchors {
      let g = anchor.geometry
      let base = UInt32(positions.count)
      let vb = g.vertices
      for i in 0..<vb.count {
        let ptr = vb.buffer.contents().advanced(by: vb.offset + vb.stride * i)
        let v = ptr.assumingMemoryBound(to: SIMD3<Float>.self).pointee
        let w = anchor.transform * SIMD4<Float>(v.x, v.y, v.z, 1)
        positions.append(SIMD3<Float>(w.x, w.y, w.z))
      }
      let fb = g.faces
      let bpi = fb.bytesPerIndex
      for f in 0..<fb.count {
        for k in 0..<fb.indexCountPerPrimitive {
          let ptr = fb.buffer.contents().advanced(by: (f * fb.indexCountPerPrimitive + k) * bpi)
          let idx: UInt32 = bpi == 4 ? ptr.assumingMemoryBound(to: UInt32.self).pointee : UInt32(ptr.assumingMemoryBound(to: UInt16.self).pointee)
          indices.append(base + idx)
        }
      }
    }

    let allocator = MDLMeshBufferDataAllocator()
    let vData = positions.withUnsafeBufferPointer { Data(buffer: $0) }
    let iData = indices.withUnsafeBufferPointer { Data(buffer: $0) }
    let vBuffer = allocator.newBuffer(with: vData, type: .vertex)
    let iBuffer = allocator.newBuffer(with: iData, type: .index)
    let submesh = MDLSubmesh(indexBuffer: iBuffer, indexCount: indices.count, indexType: .uInt32, geometryType: .triangles, material: nil)
    let descriptor = MDLVertexDescriptor()
    descriptor.attributes[0] = MDLVertexAttribute(name: MDLVertexAttributePosition, format: .float3, offset: 0, bufferIndex: 0)
    descriptor.layouts[0] = MDLVertexBufferLayout(stride: MemoryLayout<SIMD3<Float>>.stride)
    let mesh = MDLMesh(vertexBuffer: vBuffer, vertexCount: positions.count, descriptor: descriptor, submeshes: [submesh])
    mesh.addNormals(withAttributeNamed: MDLVertexAttributeNormal, creaseThreshold: 0.5)
    let asset = MDLAsset()
    asset.add(mesh)

    try? FileManager.default.removeItem(at: output)
    let ext = output.pathExtension.lowercased()
    guard MDLAsset.canExportFileExtension(ext) else { throw Remix3DError.unsupported("export:\(ext)") }
    try asset.export(to: output)
    let b = asset.boundingBox
    return [
      "uri": output.absoluteString,
      "triangles": indices.count / 3,
      "min": ["x": b.minBounds.x, "y": b.minBounds.y, "z": b.minBounds.z],
      "max": ["x": b.maxBounds.x, "y": b.maxBounds.y, "z": b.maxBounds.z],
    ]
  }
}

public class Remix3DMeshScanViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Remix3DMeshScanView")
    View(Remix3DMeshScanView.self) {
      Events("onScanState")
      AsyncFunction("start") { (view: Remix3DMeshScanView) in
        try MainActor.assumeIsolated { try view.start() }
      }.runOnQueue(.main)
      AsyncFunction("pause") { (view: Remix3DMeshScanView) in
        MainActor.assumeIsolated { view.pause() }
      }.runOnQueue(.main)
      AsyncFunction("exportMesh") { (view: Remix3DMeshScanView, outputPath: String) -> [String: Any] in
        let url = URL(string: outputPath) ?? URL(fileURLWithPath: outputPath)
        return try MainActor.assumeIsolated { try view.exportMesh(to: url) }
      }.runOnQueue(.main)
    }
  }
}
