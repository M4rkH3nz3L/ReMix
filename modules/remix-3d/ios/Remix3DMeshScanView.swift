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
  /// ☁️ pontfelhő-mód: a LiDAR-mélységből színes pontok gyűlnek (szálbiztos tároló)
  nonisolated let cloud = PointCloudAccumulator()

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

  /// `mode`: "mesh" (alap) | "points" (színes pontfelhő is gyűlik)
  func start(mode: String? = nil) throws {
    cloud.reset(collecting: mode == "points")
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
    if case .normal = frame.camera.trackingState {
      cloud.add(frame)
    }
    let pointCount = cloud.count
    Task { @MainActor in
      guard Date().timeIntervalSince(self.lastEmit) > 0.5 else { return }
      self.lastEmit = Date()
      self.onScanState(["tracking": tracking, "triangles": faces, "light": lux, "points": pointCount])
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
      AsyncFunction("start") { (view: Remix3DMeshScanView, mode: String?) in
        try MainActor.assumeIsolated { try view.start(mode: mode) }
      }.runOnQueue(.main)
      // ☁️ a gyűjtött színes pontfelhő → PLY (pont + RGB)
      AsyncFunction("exportPoints") { (view: Remix3DMeshScanView, outputPath: String) -> [String: Any] in
        let url = URL(string: outputPath) ?? URL(fileURLWithPath: outputPath)
        let (pts, cols) = view.cloud.snapshot()
        guard !pts.isEmpty else { throw Remix3DError.failed("emptyCloud") }
        try Remix3DRender.writePointPLY(points: pts, colors: cols, to: url)
        var mn = pts[0], mx = pts[0]
        for p in pts { mn = simd_min(mn, p); mx = simd_max(mx, p) }
        return [
          "uri": url.absoluteString,
          "points": pts.count,
          "min": ["x": mn.x, "y": mn.y, "z": mn.z],
          "max": ["x": mx.x, "y": mx.y, "z": mx.z],
        ]
      }
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

/// ☁️ Színes pontfelhő-gyűjtő: minden 6. képkockán a LiDAR-mélységtérkép MAGAS megbízhatóságú
/// pontjai világ-koordinátába, a kamera képéből vett színnel; 5 mm-es voxel-ritkítás, max.
/// 1,5 M pont (memória-plafon). Az ARSession delegált-szálán fut → zárral védett.
final class PointCloudAccumulator: @unchecked Sendable {
  private let lock = NSLock()
  private var collecting = false
  private var frameNo = 0
  private var voxels: [SIMD3<Int32>: Int] = [:]
  private var points: [SIMD3<Float>] = []
  private var colors: [SIMD3<UInt8>] = []
  private let voxel: Float = 0.005
  private let cap = 1_500_000

  var count: Int {
    lock.lock(); defer { lock.unlock() }
    return points.count
  }

  func reset(collecting: Bool) {
    lock.lock(); defer { lock.unlock() }
    self.collecting = collecting
    frameNo = 0
    voxels.removeAll()
    points.removeAll()
    colors.removeAll()
  }

  func snapshot() -> ([SIMD3<Float>], [SIMD3<UInt8>]) {
    lock.lock(); defer { lock.unlock() }
    return (points, colors)
  }

  func add(_ frame: ARFrame) {
    lock.lock()
    frameNo += 1
    let go = collecting && frameNo % 6 == 0 && points.count < cap
    lock.unlock()
    guard go, let depth = frame.sceneDepth else { return }
    let depthMap = depth.depthMap
    let conf = depth.confidenceMap
    let image = frame.capturedImage
    CVPixelBufferLockBaseAddress(depthMap, .readOnly)
    if let c = conf { CVPixelBufferLockBaseAddress(c, .readOnly) }
    CVPixelBufferLockBaseAddress(image, .readOnly)
    defer {
      CVPixelBufferUnlockBaseAddress(depthMap, .readOnly)
      if let c = conf { CVPixelBufferUnlockBaseAddress(c, .readOnly) }
      CVPixelBufferUnlockBaseAddress(image, .readOnly)
    }
    let dw = CVPixelBufferGetWidth(depthMap), dh = CVPixelBufferGetHeight(depthMap)
    let iw = CVPixelBufferGetWidthOfPlane(image, 0), ih = CVPixelBufferGetHeightOfPlane(image, 0)
    guard dw > 0, dh > 0, iw > 0, ih > 0,
          let dBase = CVPixelBufferGetBaseAddress(depthMap),
          let yBase = CVPixelBufferGetBaseAddressOfPlane(image, 0),
          let uvBase = CVPixelBufferGetBaseAddressOfPlane(image, 1) else { return }
    let dRow = CVPixelBufferGetBytesPerRow(depthMap)
    let cRow = conf.map { CVPixelBufferGetBytesPerRow($0) } ?? 0
    let cBase = conf.flatMap { CVPixelBufferGetBaseAddress($0) }
    let yRow = CVPixelBufferGetBytesPerRowOfPlane(image, 0)
    let uvRow = CVPixelBufferGetBytesPerRowOfPlane(image, 1)
    // a kép-intrinsics a mélységtérkép felbontására skálázva
    let k = frame.camera.intrinsics
    let sx = Float(dw) / Float(iw), sy = Float(dh) / Float(ih)
    let fx = k.columns.0.x * sx, fy = k.columns.1.y * sy
    let cx = k.columns.2.x * sx, cy = k.columns.2.y * sy
    let camT = frame.camera.transform

    var newPts: [SIMD3<Float>] = []
    var newCols: [SIMD3<UInt8>] = []
    newPts.reserveCapacity(dw * dh / 4)
    newCols.reserveCapacity(dw * dh / 4)
    var y = 0
    while y < dh {
      var x = 0
      while x < dw {
        if let cb = cBase {
          let c = cb.advanced(by: y * cRow + x).load(as: UInt8.self)
          if c < UInt8(ARConfidenceLevel.high.rawValue) { x += 2; continue }
        }
        let d = dBase.advanced(by: y * dRow + x * 4).load(as: Float32.self)
        if d > 0.1 && d < 5 {
          let px = (Float(x) - cx) / fx * d
          let py = (Float(y) - cy) / fy * d
          let w = camT * SIMD4<Float>(px, -py, -d, 1)
          newPts.append(SIMD3<Float>(w.x, w.y, w.z))
          // szín a YCbCr képből (BT.601)
          let ix = min(iw - 1, Int(Float(x) / sx)), iy = min(ih - 1, Int(Float(y) / sy))
          let Y = Float(yBase.advanced(by: iy * yRow + ix).load(as: UInt8.self))
          let uv = uvBase.advanced(by: (iy / 2) * uvRow + (ix / 2) * 2)
          let Cb = Float(uv.load(as: UInt8.self)) - 128
          let Cr = Float(uv.advanced(by: 1).load(as: UInt8.self)) - 128
          func clamp(_ v: Float) -> UInt8 { UInt8(max(0, min(255, v))) }
          newCols.append(SIMD3<UInt8>(clamp(Y + 1.402 * Cr), clamp(Y - 0.344 * Cb - 0.714 * Cr), clamp(Y + 1.772 * Cb)))
        }
        x += 2
      }
      y += 2
    }
    lock.lock(); defer { lock.unlock() }
    for (i, p) in newPts.enumerated() {
      if points.count >= cap { break }
      let key = SIMD3<Int32>(Int32((p.x / voxel).rounded(.down)), Int32((p.y / voxel).rounded(.down)), Int32((p.z / voxel).rounded(.down)))
      if voxels[key] == nil {
        voxels[key] = points.count
        points.append(p)
        colors.append(newCols[i])
      }
    }
  }
}
