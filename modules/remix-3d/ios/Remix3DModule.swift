import ExpoModulesCore
import ARKit
import AVFoundation
import ModelIO
import RealityKit
import SceneKit
import UIKit
#if canImport(RoomPlan)
import RoomPlan
#endif

// 🧊 Remix 3D — natív képességek, rekonstrukció, export, pillanatkép (3D-Studio.md §5).
//
// Elv: a JS (`src/lib/remix3dNative.ts`) csak opcionálisan oldja fel a modult
// (Androidon / Expo Go-ban nincs → a 3D Stúdió rejtve, §1.1). Minden hosszú művelet
// megszakítható, a haladás eseményként jön. A hibák EMBER-OLVASHATÓ okot adnak
// (nem fejlesztői zsargont) — a JS i18n-kulcsra képezi le az `code`-ot.

enum Remix3DError: Error, LocalizedError {
  case unsupported(String)
  case badInput(String)
  case failed(String)
  case cancelled

  var errorDescription: String? {
    switch self {
    case .unsupported(let what): return "unsupported:\(what)"
    case .badInput(let what): return "badInput:\(what)"
    case .failed(let why): return "failed:\(why)"
    case .cancelled: return "cancelled"
    }
  }
}

private func fileURL(_ s: String) throws -> URL {
  if let u = URL(string: s), u.isFileURL { return u }
  if s.hasPrefix("/") { return URL(fileURLWithPath: s) }
  throw Remix3DError.badInput("path")
}

public class Remix3DModule: Module {
  /// a futó fotogrammetria (megszakításhoz)
  private var reconstructTask: Task<Void, Never>?
  private var cancelReconstruct: (() -> Void)?
  /// a futó turntable-render megszakítás-jelzője
  private var renderCancelled = false

  public func definition() -> ModuleDefinition {
    Name("Remix3D")
    Events("onReconstructProgress", "onRenderProgress")

    // ── képességek (a LiDAR-kapu forrása) ──────────────────────────────────
    // (az ObjectCaptureSession.isSupported main-actorhoz kötött → fő szálon fut)
    AsyncFunction("capabilities") { () -> [String: Bool] in
      let mesh = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
      var objectCapture = false
      if #available(iOS 17.0, *) {
        objectCapture = MainActor.assumeIsolated { ObjectCaptureSession.isSupported } && PhotogrammetrySession.isSupported
      }
      var roomPlan = false
      #if canImport(RoomPlan)
      if #available(iOS 16.0, *) {
        roomPlan = RoomCaptureSession.isSupported
      }
      #endif
      // LiDAR-proxy: a háló-rekonstrukció CSAK LiDAR-os eszközön támogatott
      return [
        "hasLiDAR": mesh,
        "supportsSceneReconstruction": mesh,
        "supportsObjectCapture": objectCapture,
        "supportsRoomPlan": roomPlan,
      ]
    }.runOnQueue(.main)

    // ── fotogrammetria: képkészlet → USDZ (a készüléken) ────────────────────
    AsyncFunction("reconstruct") { (imagesDir: String, outputPath: String, quality: String, promise: Promise) in
      guard #available(iOS 17.0, *) else {
        promise.reject(Remix3DError.unsupported("photogrammetry"))
        return
      }
      do {
        let input = try fileURL(imagesDir)
        let output = try fileURL(outputPath)
        try? FileManager.default.removeItem(at: output)
        let session = try PhotogrammetrySession(input: input, configuration: PhotogrammetrySession.Configuration())
        // iOS-en a fotogrammetria részletessége CSAK `.reduced` (SDK-ban ellenőrizve, iOS 27);
        // a `quality` a JS-oldali beállítás (képszám/átfedés), itt nem ad finomabb hálót
        _ = quality
        let detail: PhotogrammetrySession.Request.Detail = .reduced
        self.cancelReconstruct = { session.cancel() }
        self.reconstructTask = Task {
          do {
            for try await out in session.outputs {
              switch out {
              case .requestProgress(_, let fraction):
                self.sendEvent("onReconstructProgress", ["progress": fraction])
              case .requestComplete:
                promise.resolve(output.absoluteString)
              case .requestError(_, let error):
                promise.reject(Remix3DError.failed(error.localizedDescription))
              case .processingCancelled:
                promise.reject(Remix3DError.cancelled)
              default:
                break
              }
            }
          } catch {
            promise.reject(Remix3DError.failed(error.localizedDescription))
          }
          self.cancelReconstruct = nil
        }
        try session.process(requests: [.modelFile(url: output, detail: detail)])
      } catch {
        promise.reject(Remix3DError.failed(error.localizedDescription))
      }
    }

    AsyncFunction("cancelReconstruct") { () -> Bool in
      guard let c = self.cancelReconstruct else { return false }
      c()
      return true
    }

    // ── export: USDZ → OBJ / STL / PLY (ModelIO, a készüléken) ──────────────
    AsyncFunction("exportModel") { (inputPath: String, outputPath: String) -> String in
      let input = try fileURL(inputPath)
      let output = try fileURL(outputPath)
      let ext = output.pathExtension.lowercased()
      try? FileManager.default.removeItem(at: output)
      if ext == input.pathExtension.lowercased() {
        try FileManager.default.copyItem(at: input, to: output)
        return output.absoluteString
      }
      // 🖨️ STL: saját bináris író MILLIMÉTERBEN (a szeletelők mm-t várnak; a ModelIO
      // méterben írna → a nyomat 1000× kisebb lenne), a csomópont-transzformokkal együtt
      if ext == "stl" {
        try Remix3DRender.writeBinarySTL(asset: MDLAsset(url: input), to: output, scale: 1000)
        return output.absoluteString
      }
      guard MDLAsset.canExportFileExtension(ext) else {
        throw Remix3DError.unsupported("export:\(ext)")
      }
      let asset = MDLAsset(url: input)
      try asset.export(to: output)
      return output.absoluteString
    }

    // ── pillanatkép egy fájlból (bélyegkép / „Kép a modellből" fix kamerával) ─
    AsyncFunction("snapshotFile") { (modelPath: String, outputPath: String, width: Int, height: Int, yaw: Double, pitch: Double, transparent: Bool) -> String in
      let scene = try SCNScene(url: try fileURL(modelPath), options: nil)
      let png = try Remix3DRender.snapshot(scene: scene, pointOfView: nil, yaw: yaw, pitch: pitch, width: width, height: height, transparent: transparent)
      let out = try fileURL(outputPath)
      try png.write(to: out)
      return out.absoluteString
    }

    // ── 🎬 „Videó a modellből": 360°-os forgó felvétel → H.264 MP4 (a készüléken) ──
    // A kamera a `snapshotFile` orbitján kering (WYSIWYG az állóképpel); haladás az
    // `onRenderProgress` eseményen, megszakítás a `cancelRender`-rel.
    AsyncFunction("renderTurntable") { (modelPath: String, outputPath: String, width: Int, height: Int, seconds: Double, fps: Int, pitch: Double, background: String?, promise: Promise) in
      self.renderCancelled = false
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let out = try Remix3DRender.turntable(
            modelURL: try fileURL(modelPath),
            outURL: try fileURL(outputPath),
            width: width,
            height: height,
            seconds: seconds,
            fps: fps,
            pitch: pitch,
            background: background,
            isCancelled: { self.renderCancelled },
            progress: { p in self.sendEvent("onRenderProgress", ["progress": p]) }
          )
          promise.resolve(out.absoluteString)
        } catch let e as Remix3DError {
          promise.reject(e)
        } catch {
          promise.reject(Remix3DError.failed(error.localizedDescription))
        }
      }
    }

    AsyncFunction("cancelRender") { () -> Bool in
      self.renderCancelled = true
      return true
    }

    // ── háló-statisztika (háromszögszám + befoglaló doboz, méterben) ─────────
    AsyncFunction("inspectModel") { (modelPath: String) -> [String: Any] in
      let asset = MDLAsset(url: try fileURL(modelPath))
      // a fotogrammetria USDZ-je a hálókat egy Xform ALÁ teszi → a felső szint üres lenne
      // (ezért mentett a doc 0 háromszöget); a teljes hierarchiát bejárjuk
      var triangles = 0
      for case let mesh as MDLMesh in asset.childObjects(of: MDLMesh.self) {
        for sub in mesh.submeshes as? [MDLSubmesh] ?? [] {
          triangles += sub.indexCount / 3
        }
      }
      let b = asset.boundingBox
      return [
        "triangles": triangles,
        "min": ["x": b.minBounds.x, "y": b.minBounds.y, "z": b.minBounds.z],
        "max": ["x": b.maxBounds.x, "y": b.maxBounds.y, "z": b.maxBounds.z],
      ]
    }
  }
}

/// Közös SceneKit-renderelés (a néző és a fájl-pillanatkép ugyanazt használja → WYSIWYG).
enum Remix3DRender {
  /// függőleges látószög (fok) — a néző, az állókép és a forgó videó ugyanazzal dolgozik
  static let fieldOfView: Double = 45

  /// közös kamera: kis zNear + automatikus z-tartomány (a SceneKit alap 1 m-es zNear-je
  /// a 30 cm-nél kisebb tárgyat levágná)
  static func makeCamera() -> SCNCamera {
    let c = SCNCamera()
    c.fieldOfView = CGFloat(fieldOfView)
    c.zNear = 0.001
    c.automaticallyAdjustsZRange = true
    return c
  }

  /// a kamera távolsága úgy, hogy a gömb a SZŰKEBB látószögbe is beférjen (portré
  /// képaránynál a vízszintes a szűkebb — e nélkül a 9:16-os videó oldalt vágott)
  static func orbitDistance(radius: Float, aspect: Double) -> Double {
    let vHalf = (fieldOfView * .pi / 180.0) / 2
    let hHalf = atan(tan(vHalf) * max(aspect, 0.05))
    return Double(max(radius, 0.005)) * 1.15 / sin(min(vHalf, hHalf))
  }

  /// az orbit-kamera helye a befoglaló gömb körül (a JS `model3dOrbit` konvenciója: +Y fel)
  static func orbitPosition(center: SCNVector3, radius: Float, yaw: Double, pitch: Double, aspect: Double = 1) -> SCNVector3 {
    let d = orbitDistance(radius: radius, aspect: aspect)
    let cp = cos(pitch)
    return SCNVector3(
      Float(Double(center.x) + d * cp * sin(yaw)),
      Float(Double(center.y) + d * sin(pitch)),
      Float(Double(center.z) + d * cp * cos(yaw))
    )
  }

  /// `#rrggbb` → UIColor (érvénytelen → nil)
  static func color(hex: String?) -> UIColor? {
    guard var h = hex?.trimmingCharacters(in: .whitespaces), !h.isEmpty else { return nil }
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((v >> 16) & 0xff) / 255,
      green: CGFloat((v >> 8) & 0xff) / 255,
      blue: CGFloat(v & 0xff) / 255,
      alpha: 1
    )
  }

  /// UIImage → BGRA pixel-buffer (az AVAssetWriter-adapter pooljából)
  static func pixelBuffer(_ image: UIImage, width: Int, height: Int, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
    var out: CVPixelBuffer?
    if let pool = pool {
      CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out)
    } else {
      let attrs = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      ] as CFDictionary
      CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, attrs, &out)
    }
    guard let pb = out, let cg = image.cgImage else { return nil }
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }
    guard let ctx = CGContext(
      data: CVPixelBufferGetBaseAddress(pb),
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
    return pb
  }

  /// 360°-os forgó felvétel → MP4. Páros méretre kerekít (H.264), soros képkocka-írás.
  static func turntable(
    modelURL: URL,
    outURL: URL,
    width: Int,
    height: Int,
    seconds: Double,
    fps: Int,
    pitch: Double,
    background: String?,
    isCancelled: () -> Bool,
    progress: (Double) -> Void
  ) throws -> URL {
    let w = max(2, (width / 2) * 2)
    let h = max(2, (height / 2) * 2)
    let rate = max(1, min(fps, 60))
    let frames = max(1, Int((seconds * Double(rate)).rounded()))
    guard let device = MTLCreateSystemDefaultDevice() else { throw Remix3DError.unsupported("metal") }
    let scene = try SCNScene(url: modelURL, options: nil)
    scene.background.contents = color(hex: background) ?? UIColor(red: 0.067, green: 0.078, blue: 0.125, alpha: 1)
    let renderer = SCNRenderer(device: device, options: nil)
    renderer.scene = scene
    renderer.autoenablesDefaultLighting = true
    let (center, radius) = scene.rootNode.boundingSphere
    let cam = SCNNode()
    cam.camera = makeCamera()
    scene.rootNode.addChildNode(cam)
    defer { cam.removeFromParentNode() }
    renderer.pointOfView = cam
    let aspect = Double(w) / Double(h)

    try? FileManager.default.removeItem(at: outURL)
    let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: w,
      AVVideoHeightKey: h,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: w * h * 6],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: w,
      kCVPixelBufferHeightKey as String: h,
    ])
    writer.add(input)
    guard writer.startWriting() else {
      throw Remix3DError.failed(writer.error?.localizedDescription ?? "writer")
    }
    writer.startSession(atSourceTime: .zero)

    for i in 0..<frames {
      if isCancelled() {
        writer.cancelWriting()
        try? FileManager.default.removeItem(at: outURL)
        throw Remix3DError.cancelled
      }
      let yaw = 2 * Double.pi * Double(i) / Double(frames)
      cam.position = orbitPosition(center: center, radius: radius, yaw: yaw, pitch: pitch, aspect: aspect)
      cam.look(at: center)
      let image = renderer.snapshot(atTime: Double(i) / Double(rate), with: CGSize(width: w, height: h), antialiasingMode: .multisampling4X)
      guard let pb = pixelBuffer(image, width: w, height: h, pool: adaptor.pixelBufferPool) else {
        writer.cancelWriting()
        throw Remix3DError.failed("frame")
      }
      while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.005)
      }
      adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: CMTimeScale(rate)))
      progress(Double(i + 1) / Double(frames))
    }
    input.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    guard writer.status == .completed else {
      throw Remix3DError.failed(writer.error?.localizedDescription ?? "finish")
    }
    return outURL
  }

  static func snapshot(scene: SCNScene, pointOfView: SCNNode?, yaw: Double, pitch: Double, width: Int, height: Int, transparent: Bool) throws -> Data {
    guard let device = MTLCreateSystemDefaultDevice() else { throw Remix3DError.unsupported("metal") }
    let renderer = SCNRenderer(device: device, options: nil)
    renderer.scene = scene
    renderer.autoenablesDefaultLighting = true
    let previousBackground = scene.background.contents
    if transparent { scene.background.contents = UIColor.clear }
    defer { scene.background.contents = previousBackground }
    if let pov = pointOfView {
      renderer.pointOfView = pov
    } else {
      // fix orbit-kamera a befoglaló gömb köré (a JS `model3dOrbit` konvenciója: +Y fel)
      let (center, radius) = scene.rootNode.boundingSphere
      let cam = SCNNode()
      cam.camera = makeCamera()
      cam.position = orbitPosition(center: center, radius: radius, yaw: yaw, pitch: pitch, aspect: Double(width) / Double(max(height, 1)))
      cam.look(at: center)
      scene.rootNode.addChildNode(cam)
      defer { cam.removeFromParentNode() }
      renderer.pointOfView = cam
      let image = renderer.snapshot(atTime: 0, with: CGSize(width: width, height: height), antialiasingMode: .multisampling4X)
      guard let data = image.pngData() else { throw Remix3DError.failed("png") }
      return data
    }
    let image = renderer.snapshot(atTime: 0, with: CGSize(width: width, height: height), antialiasingMode: .multisampling4X)
    guard let data = image.pngData() else { throw Remix3DError.failed("png") }
    return data
  }

  /// 🖨️ bináris STL — minden háló minden háromszöge, a csomópont-transzformokkal világ-
  /// koordinátába, `scale`-lel szorozva (1000 → mm). A normál a háromszögből számolódik.
  static func writeBinarySTL(asset: MDLAsset, to url: URL, scale: Float) throws {
    var tris: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] = []
    for case let mesh as MDLMesh in asset.childObjects(of: MDLMesh.self) {
      guard let pos = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributePosition, as: .float3) else { continue }
      let world = MDLTransform.globalTransform(with: mesh, atTime: 0)
      func vertex(_ i: Int) -> SIMD3<Float> {
        let p = pos.dataStart.advanced(by: i * pos.stride).assumingMemoryBound(to: Float.self)
        let v = world * SIMD4<Float>(p[0], p[1], p[2], 1)
        return SIMD3<Float>(v.x, v.y, v.z) * scale
      }
      for sub in mesh.submeshes as? [MDLSubmesh] ?? [] where sub.geometryType == .triangles {
        let buf = sub.indexBuffer.map()
        var idx: [Int] = []
        idx.reserveCapacity(sub.indexCount)
        for k in 0..<sub.indexCount {
          switch sub.indexType {
          case .uInt32: idx.append(Int(buf.bytes.load(fromByteOffset: k * 4, as: UInt32.self)))
          case .uInt16: idx.append(Int(buf.bytes.load(fromByteOffset: k * 2, as: UInt16.self)))
          default: idx.append(Int(buf.bytes.load(fromByteOffset: k, as: UInt8.self)))
          }
        }
        var t = 0
        while t + 2 < idx.count {
          tris.append((vertex(idx[t]), vertex(idx[t + 1]), vertex(idx[t + 2])))
          t += 3
        }
      }
    }
    guard !tris.isEmpty else { throw Remix3DError.failed("emptyMesh") }
    var data = Data(count: 80)
    var count = UInt32(tris.count).littleEndian
    withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }
    func put(_ v: SIMD3<Float>) {
      for c in [v.x, v.y, v.z] {
        var le = c.bitPattern.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
      }
    }
    for (a, b, c) in tris {
      let n = simd_cross(b - a, c - a)
      let len = simd_length(n)
      put(len > 0 ? n / len : SIMD3<Float>(0, 0, 0))
      put(a); put(b); put(c)
      data.append(contentsOf: [0, 0])
    }
    try? FileManager.default.removeItem(at: url)
    try data.write(to: url)
  }
}
