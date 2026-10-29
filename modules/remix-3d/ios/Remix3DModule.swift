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
    // `optionsJson`: a stúdió „megjelenése" (forgatás) — a kivitt fájl azt adja, amit a néző mutat
    AsyncFunction("exportModel") { (inputPath: String, outputPath: String, optionsJson: String?) -> String in
      let input = try fileURL(inputPath)
      let output = try fileURL(outputPath)
      let ext = output.pathExtension.lowercased()
      let look = Remix3DRender.Look.parse(optionsJson)
      try? FileManager.default.removeItem(at: output)
      if look.hasRotation {
        switch ext {
        case "usdz":
          // a forgatás a csomópont-transzformba kerül; a textúrák/anyagok megmaradnak
          let scene = try Remix3DRender.loadScene(input)
          Remix3DRender.wrapContent(scene, look: look)
          guard scene.write(to: output, options: nil, delegate: nil, progressHandler: nil) else {
            throw Remix3DError.failed("usdzWrite")
          }
          return output.absoluteString
        case "obj":
          try Remix3DRender.writeOBJ(Remix3DRender.rotated(Remix3DRender.collectMesh(MDLAsset(url: input)), by: look.rotation), to: output)
          return output.absoluteString
        case "ply":
          try Remix3DRender.writePLY(Remix3DRender.rotated(Remix3DRender.collectMesh(MDLAsset(url: input)), by: look.rotation), to: output)
          return output.absoluteString
        default:
          break
        }
      }
      if ext == input.pathExtension.lowercased() {
        try FileManager.default.copyItem(at: input, to: output)
        return output.absoluteString
      }
      // 🖨️ STL: saját bináris író MILLIMÉTERBEN (a szeletelők mm-t várnak; a ModelIO
      // méterben írna → a nyomat 1000× kisebb lenne), a csomópont-transzformokkal együtt
      if ext == "stl" {
        var mesh = Remix3DRender.collectMesh(MDLAsset(url: input))
        if look.hasRotation { mesh = Remix3DRender.rotated(mesh, by: look.rotation) }
        try Remix3DRender.writeSTL(mesh, to: output, scale: 1000)
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
    AsyncFunction("snapshotFile") { (modelPath: String, outputPath: String, width: Int, height: Int, yaw: Double, pitch: Double, transparent: Bool, optionsJson: String?) -> String in
      let scene = try Remix3DRender.loadScene(try fileURL(modelPath))
      let look = Remix3DRender.Look.parse(optionsJson)
      Remix3DRender.wrapContent(scene, look: look)
      Remix3DRender.addLights(to: scene, look: look)
      let png = try Remix3DRender.snapshot(scene: scene, pointOfView: nil, yaw: yaw, pitch: pitch, width: width, height: height, transparent: transparent)
      let out = try fileURL(outputPath)
      try png.write(to: out)
      return out.absoluteString
    }

    // ── 🎬 „Videó a modellből": 360°-os forgó felvétel → H.264 MP4 (a készüléken) ──
    // A kamera a `snapshotFile` orbitján kering (WYSIWYG az állóképpel); haladás az
    // `onRenderProgress` eseményen, megszakítás a `cancelRender`-rel.
    AsyncFunction("renderTurntable") { (modelPath: String, outputPath: String, width: Int, height: Int, seconds: Double, fps: Int, pitch: Double, background: String?, optionsJson: String?, promise: Promise) in
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
            look: Remix3DRender.Look.parse(optionsJson),
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

    // ── ✂️ háló-feldolgozás (textúra nélküli szkenhez): forgatás beégetése + padló
    // levágása + egyszerűsítés → új OBJ. `{"rotation":[…],"cutY":0.02,"cell":0.004}`
    AsyncFunction("processMesh") { (inputPath: String, outputPath: String, optionsJson: String?) -> [String: Any] in
      let look = Remix3DRender.Look.parse(optionsJson)
      var opts: [String: Any] = [:]
      if let j = optionsJson, let d = j.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
        opts = o
      }
      var mesh = Remix3DRender.collectMesh(MDLAsset(url: try fileURL(inputPath)))
      if look.hasRotation { mesh = Remix3DRender.rotated(mesh, by: look.rotation) }
      if let cut = opts["cutY"] as? Double { mesh = Remix3DRender.cutBelow(mesh, minY: Float(cut)) }
      if let cell = opts["cell"] as? Double, cell > 0 { mesh = Remix3DRender.simplified(mesh, cell: Float(cell)) }
      guard mesh.triangleCount > 0 else { throw Remix3DError.failed("emptyMesh") }
      let out = try fileURL(outputPath)
      try Remix3DRender.writeOBJ(mesh, to: out)
      var info = Remix3DRender.info(mesh)
      info["uri"] = out.absoluteString
      return info
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
    look: Look = Look(),
    isCancelled: () -> Bool,
    progress: (Double) -> Void
  ) throws -> URL {
    let w = max(2, (width / 2) * 2)
    let h = max(2, (height / 2) * 2)
    let rate = max(1, min(fps, 60))
    let frames = max(1, Int((seconds * Double(rate)).rounded()))
    guard let device = MTLCreateSystemDefaultDevice() else { throw Remix3DError.unsupported("metal") }
    let scene = try loadScene(modelURL)
    scene.background.contents = color(hex: background) ?? UIColor(red: 0.067, green: 0.078, blue: 0.125, alpha: 1)
    let renderer = SCNRenderer(device: device, options: nil)
    renderer.scene = scene
    let (_, center, radius) = wrapContent(scene, look: look)
    addLights(to: scene, look: look)
    renderer.autoenablesDefaultLighting = false
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
    renderer.autoenablesDefaultLighting = scene.rootNode.childNode(withName: "remixLights", recursively: false) == nil
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

  // ── 🎛️ közös „megjelenés": forgatás + fény (néző = állókép = videó = export) ──────

  struct Look {
    var rotation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
    var preset = "studio"
    var exposure: Float = 1
    var hasRotation: Bool { abs(rotation.real) < 0.99999 }

    /// `{"rotation":[x,y,z,w],"preset":"studio","exposure":1}` → Look (hiányzó → alap)
    static func parse(_ json: String?) -> Look {
      var l = Look()
      guard let json = json, let d = json.data(using: .utf8),
            let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return l }
      if let r = o["rotation"] as? [Double], r.count == 4 {
        let q = simd_quatf(ix: Float(r[0]), iy: Float(r[1]), iz: Float(r[2]), r: Float(r[3]))
        if simd_length(q.vector) > 0 { l.rotation = simd_normalize(q) }
      }
      if let p = o["preset"] as? String { l.preset = p }
      if let e = o["exposure"] as? Double { l.exposure = Float(max(0.25, min(2, e))) }
      return l
    }
  }

  /// a jelenet tartalma egy közös csomópont alá, a befoglaló DOBOZ közepe körül forgatva
  /// (a középpont és a sugár a forgatástól független → a keretezés stabil)
  @discardableResult
  static func wrapContent(_ scene: SCNScene, look: Look) -> (content: SCNNode, center: SCNVector3, radius: Float) {
    let content = SCNNode()
    content.name = "remixContent"
    for c in scene.rootNode.childNodes {
      c.removeFromParentNode()
      content.addChildNode(c)
    }
    let (mn, mx) = content.boundingBox
    let center = SCNVector3((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2)
    let d = SIMD3<Float>(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z)
    content.pivot = SCNMatrix4MakeTranslation(center.x, center.y, center.z)
    content.position = center
    content.simdOrientation = look.rotation
    scene.rootNode.addChildNode(content)
    return (content, center, simd_length(d) / 2)
  }

  /// fény-preset (studio / outdoor / night) × expozíció — saját fények, nem a SceneKit alapja
  @discardableResult
  static func addLights(to scene: SCNScene, look: Look) -> SCNNode {
    scene.rootNode.childNode(withName: "remixLights", recursively: false)?.removeFromParentNode()
    let rig = SCNNode()
    rig.name = "remixLights"
    func add(_ type: SCNLight.LightType, _ intensity: Float, _ color: UIColor, pitch: Float = 0, yaw: Float = 0) {
      let l = SCNLight()
      l.type = type
      l.intensity = CGFloat(intensity * look.exposure)
      l.color = color
      let n = SCNNode()
      n.light = l
      n.eulerAngles = SCNVector3(pitch, yaw, 0)
      rig.addChildNode(n)
    }
    switch look.preset {
    case "outdoor":
      add(.ambient, 550, UIColor(red: 0.85, green: 0.9, blue: 1, alpha: 1))
      add(.directional, 1500, UIColor(red: 1, green: 0.96, blue: 0.88, alpha: 1), pitch: -.pi / 3, yaw: .pi / 5)
    case "night":
      add(.ambient, 140, UIColor(red: 0.55, green: 0.62, blue: 0.9, alpha: 1))
      add(.directional, 650, UIColor(red: 0.75, green: 0.8, blue: 1, alpha: 1), pitch: -.pi / 6, yaw: -.pi / 3)
    default: // studio: kulcs + derítő + környezet
      add(.ambient, 350, .white)
      add(.directional, 900, .white, pitch: -.pi / 4, yaw: .pi / 6)
      add(.directional, 380, .white, pitch: -.pi / 10, yaw: -.pi * 2 / 3)
    }
    scene.rootNode.addChildNode(rig)
    return rig
  }


  // ── ☁️ pontfelhő: színes PLY írása / beolvasása (SceneKit pont-geometria) ──────────

  static func writePointPLY(points: [SIMD3<Float>], colors: [SIMD3<UInt8>], to url: URL) throws {
    var data = Data()
    let header = "ply\nformat binary_little_endian 1.0\ncomment ReMix 3D pointcloud\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    data.append(header.data(using: .ascii)!)
    data.reserveCapacity(header.count + points.count * 15)
    for (i, p) in points.enumerated() {
      for c in [p.x, p.y, p.z] {
        var le = c.bitPattern.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
      }
      let col = i < colors.count ? colors[i] : SIMD3<UInt8>(200, 200, 200)
      data.append(contentsOf: [col.x, col.y, col.z])
    }
    try? FileManager.default.removeItem(at: url)
    try data.write(to: url)
  }

  /// a SAJÁT (lap nélküli, binary_little_endian, x y z [+ r g b]) PLY-pontfelhő beolvasása;
  /// más PLY (pl. háló lapokkal) → nil (a hívó a ModelIO-s betöltést használja)
  static func readPointPLY(_ url: URL) -> (points: [SIMD3<Float>], colors: [SIMD3<UInt8>])? {
    guard let data = try? Data(contentsOf: url),
          let end = data.range(of: "end_header\n".data(using: .ascii)!) else { return nil }
    guard let header = String(data: data.subdata(in: 0..<end.lowerBound), encoding: .ascii),
          header.contains("binary_little_endian"), !header.contains("element face") else { return nil }
    var count = 0
    for line in header.split(separator: "\n") where line.hasPrefix("element vertex") {
      count = Int(line.split(separator: " ").last ?? "0") ?? 0
    }
    let hasColor = header.contains("property uchar red")
    let stride = 12 + (hasColor ? 3 : 0)
    let body = end.upperBound
    guard count > 0, data.count >= body + count * stride else { return nil }
    var pts = [SIMD3<Float>](); pts.reserveCapacity(count)
    var cols = [SIMD3<UInt8>](); cols.reserveCapacity(count)
    data.withUnsafeBytes { raw in
      for i in 0..<count {
        let o = body + i * stride
        let x = Float(bitPattern: raw.loadUnaligned(fromByteOffset: o, as: UInt32.self).littleEndian)
        let y = Float(bitPattern: raw.loadUnaligned(fromByteOffset: o + 4, as: UInt32.self).littleEndian)
        let z = Float(bitPattern: raw.loadUnaligned(fromByteOffset: o + 8, as: UInt32.self).littleEndian)
        pts.append(SIMD3<Float>(x, y, z))
        if hasColor {
          cols.append(SIMD3<UInt8>(raw[o + 12], raw[o + 13], raw[o + 14]))
        }
      }
    }
    return (pts, cols)
  }

  /// modell-fájl → jelenet: a saját pontfelhő-PLY pont-geometriaként, minden más SceneKit/ModelIO-val
  static func loadScene(_ url: URL) throws -> SCNScene {
    if url.pathExtension.lowercased() == "ply", let (pts, cols) = readPointPLY(url) {
      let scene = SCNScene()
      let vertices = SCNGeometrySource(vertices: pts.map { SCNVector3($0.x, $0.y, $0.z) })
      var sources = [vertices]
      if !cols.isEmpty {
        let rgba = cols.map { SIMD4<Float>(Float($0.x) / 255, Float($0.y) / 255, Float($0.z) / 255, 1) }
        let colorData = rgba.withUnsafeBufferPointer { Data(buffer: $0) }
        sources.append(SCNGeometrySource(
          data: colorData,
          semantic: .color,
          vectorCount: rgba.count,
          usesFloatComponents: true,
          componentsPerVector: 4,
          bytesPerComponent: MemoryLayout<Float>.size,
          dataOffset: 0,
          dataStride: MemoryLayout<SIMD4<Float>>.stride
        ))
      }
      let indices = (0..<UInt32(pts.count)).map { $0 }
      let element = SCNGeometryElement(indices: indices, primitiveType: .point)
      element.pointSize = 0.006
      element.minimumPointScreenSpaceRadius = 1.5
      element.maximumPointScreenSpaceRadius = 6
      let geometry = SCNGeometry(sources: sources, elements: [element])
      geometry.firstMaterial?.lightingModel = .constant
      scene.rootNode.addChildNode(SCNNode(geometry: geometry))
      return scene
    }
    return try SCNScene(url: url, options: nil)
  }

  // ── 🔺 háló-adat: minden háromszög világ-koordinátában (a csomópont-transzformokkal) ──

  struct MeshData {
    var positions: [SIMD3<Float>] = []
    var indices: [UInt32] = []
    var triangleCount: Int { indices.count / 3 }

    var bounds: (SIMD3<Float>, SIMD3<Float>) {
      guard var mn = positions.first else { return (.zero, .zero) }
      var mx = mn
      for p in positions {
        mn = simd_min(mn, p)
        mx = simd_max(mx, p)
      }
      return (mn, mx)
    }
  }

  /// az asset összes hálója → indexelt, csúcs-deduplikált háló (világ-koordináta, méter)
  static func collectMesh(_ asset: MDLAsset) -> MeshData {
    var out = MeshData()
    var lookup: [SIMD3<Float>: UInt32] = [:]
    for case let mesh as MDLMesh in asset.childObjects(of: MDLMesh.self) {
      guard let pos = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributePosition, as: .float3) else { continue }
      let world = MDLTransform.globalTransform(with: mesh, atTime: 0)
      func vertex(_ i: Int) -> UInt32 {
        let p = pos.dataStart.advanced(by: i * pos.stride).assumingMemoryBound(to: Float.self)
        let v = world * SIMD4<Float>(p[0], p[1], p[2], 1)
        let w = SIMD3<Float>(v.x, v.y, v.z)
        if let k = lookup[w] { return k }
        let k = UInt32(out.positions.count)
        out.positions.append(w)
        lookup[w] = k
        return k
      }
      for sub in mesh.submeshes as? [MDLSubmesh] ?? [] where sub.geometryType == .triangles {
        let buf = sub.indexBuffer.map()
        for k in 0..<sub.indexCount {
          let i: Int
          switch sub.indexType {
          case .uInt32: i = Int(buf.bytes.load(fromByteOffset: k * 4, as: UInt32.self))
          case .uInt16: i = Int(buf.bytes.load(fromByteOffset: k * 2, as: UInt16.self))
          default: i = Int(buf.bytes.load(fromByteOffset: k, as: UInt8.self))
          }
          out.indices.append(vertex(i))
        }
        out.indices.removeLast(out.indices.count % 3)
      }
    }
    return out
  }

  /// forgatás a befoglaló doboz közepe körül (a néző `wrapContent`-jével egyezően)
  static func rotated(_ m: MeshData, by q: simd_quatf) -> MeshData {
    let (mn, mx) = m.bounds
    let c = (mn + mx) / 2
    var r = m
    r.positions = m.positions.map { c + q.act($0 - c) }
    return r
  }

  /// a `minY` (méter) ALATT teljesen elhelyezkedő háromszögek elhagyása (padló levágása)
  static func cutBelow(_ m: MeshData, minY: Float) -> MeshData {
    var out = MeshData()
    var remap: [UInt32: UInt32] = [:]
    func keep(_ i: UInt32) -> UInt32 {
      if let k = remap[i] { return k }
      let k = UInt32(out.positions.count)
      out.positions.append(m.positions[Int(i)])
      remap[i] = k
      return k
    }
    var t = 0
    while t + 2 < m.indices.count {
      let a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2]
      let top = max(m.positions[Int(a)].y, m.positions[Int(b)].y, m.positions[Int(c)].y)
      if top >= minY {
        out.indices.append(contentsOf: [keep(a), keep(b), keep(c)])
      }
      t += 3
    }
    return out
  }

  /// egyszerűsítés csúcs-klaszterezéssel: a `cell` méretű rácsba eső csúcsok egybeolvadnak
  static func simplified(_ m: MeshData, cell: Float) -> MeshData {
    guard cell > 0 else { return m }
    var out = MeshData()
    var cellIndex: [SIMD3<Int32>: UInt32] = [:]
    var sums: [SIMD3<Float>] = []
    var counts: [Float] = []
    var remap = [UInt32](repeating: 0, count: m.positions.count)
    for (i, p) in m.positions.enumerated() {
      let key = SIMD3<Int32>(Int32((p.x / cell).rounded(.down)), Int32((p.y / cell).rounded(.down)), Int32((p.z / cell).rounded(.down)))
      if let k = cellIndex[key] {
        remap[i] = k
        sums[Int(k)] += p
        counts[Int(k)] += 1
      } else {
        let k = UInt32(sums.count)
        cellIndex[key] = k
        sums.append(p)
        counts.append(1)
        remap[i] = k
      }
    }
    out.positions = zip(sums, counts).map { $0 / $1 }
    var t = 0
    while t + 2 < m.indices.count {
      let a = remap[Int(m.indices[t])], b = remap[Int(m.indices[t + 1])], c = remap[Int(m.indices[t + 2])]
      if a != b && b != c && a != c {
        out.indices.append(contentsOf: [a, b, c])
      }
      t += 3
    }
    return out
  }

  // ── ✍️ írók (textúra nélküli hálók — a nyers / feldolgozott szkenhez és az exporthoz) ──

  static func writeOBJ(_ m: MeshData, to url: URL) throws {
    var text = "# ReMix 3D\n"
    text.reserveCapacity(m.positions.count * 32 + m.indices.count * 8)
    for p in m.positions {
      text += "v \(p.x) \(p.y) \(p.z)\n"
    }
    var t = 0
    while t + 2 < m.indices.count {
      text += "f \(m.indices[t] + 1) \(m.indices[t + 1] + 1) \(m.indices[t + 2] + 1)\n"
      t += 3
    }
    try? FileManager.default.removeItem(at: url)
    try text.write(to: url, atomically: true, encoding: .utf8)
  }

  static func writePLY(_ m: MeshData, to url: URL) throws {
    var data = Data()
    let header = "ply\nformat binary_little_endian 1.0\ncomment ReMix 3D\nelement vertex \(m.positions.count)\nproperty float x\nproperty float y\nproperty float z\nelement face \(m.triangleCount)\nproperty list uchar int vertex_indices\nend_header\n"
    data.append(header.data(using: .ascii)!)
    for p in m.positions {
      for c in [p.x, p.y, p.z] {
        var le = c.bitPattern.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
      }
    }
    var t = 0
    while t + 2 < m.indices.count {
      data.append(3)
      for k in 0..<3 {
        var le = Int32(m.indices[t + k]).littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
      }
      t += 3
    }
    try? FileManager.default.removeItem(at: url)
    try data.write(to: url)
  }

  /// 🖨️ bináris STL, `scale`-lel (1000 → mm — a szeletelők mm-t várnak)
  static func writeSTL(_ m: MeshData, to url: URL, scale: Float) throws {
    guard m.triangleCount > 0 else { throw Remix3DError.failed("emptyMesh") }
    var data = Data(count: 80)
    var count = UInt32(m.triangleCount).littleEndian
    withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }
    func put(_ v: SIMD3<Float>) {
      for c in [v.x, v.y, v.z] {
        var le = c.bitPattern.littleEndian
        withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
      }
    }
    var t = 0
    while t + 2 < m.indices.count {
      let a = m.positions[Int(m.indices[t])] * scale
      let b = m.positions[Int(m.indices[t + 1])] * scale
      let c = m.positions[Int(m.indices[t + 2])] * scale
      let n = simd_cross(b - a, c - a)
      let len = simd_length(n)
      put(len > 0 ? n / len : .zero)
      put(a); put(b); put(c)
      data.append(contentsOf: [0, 0])
      t += 3
    }
    try? FileManager.default.removeItem(at: url)
    try data.write(to: url)
  }

  /// `{triangles, min, max}` — a JS ugyanazt a formát kapja, mint az `inspectModel`-nél
  static func info(_ m: MeshData) -> [String: Any] {
    let (mn, mx) = m.bounds
    return [
      "triangles": m.triangleCount,
      "min": ["x": mn.x, "y": mn.y, "z": mn.z],
      "max": ["x": mx.x, "y": mx.y, "z": mx.z],
    ]
  }
}
