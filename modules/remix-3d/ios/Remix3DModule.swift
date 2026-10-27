import ExpoModulesCore
import ARKit
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

  public func definition() -> ModuleDefinition {
    Name("Remix3D")
    Events("onReconstructProgress")

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

    // ── háló-statisztika (háromszögszám + befoglaló doboz, méterben) ─────────
    AsyncFunction("inspectModel") { (modelPath: String) -> [String: Any] in
      let asset = MDLAsset(url: try fileURL(modelPath))
      var triangles = 0
      for i in 0..<asset.count {
        if let mesh = asset.object(at: i) as? MDLMesh {
          for sub in mesh.submeshes as? [MDLSubmesh] ?? [] {
            triangles += sub.indexCount / 3
          }
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
      cam.camera = SCNCamera()
      cam.camera?.fieldOfView = 45
      let d = Double(max(radius, 0.01)) * 1.15 / sin((45.0 * .pi / 180.0) / 2)
      let cp = cos(pitch)
      cam.position = SCNVector3(
        Float(Double(center.x) + d * cp * sin(yaw)),
        Float(Double(center.y) + d * sin(pitch)),
        Float(Double(center.z) + d * cp * cos(yaw))
      )
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
}
