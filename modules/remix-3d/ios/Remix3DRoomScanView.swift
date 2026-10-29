import ExpoModulesCore
import UIKit
#if canImport(RoomPlan)
import RoomPlan
#endif

// 🏠 Szoba-szken (3D-Studio.md §2.2) — Apple RoomPlan: a LiDAR a falakat, ajtókat,
// ablakokat és a bútorokat ÉLŐBEN ismeri fel (a RoomCaptureView maga mutatja az
// útmutatást és a felépülő szobát). Kész-kor: parametrikus USDZ + KÖNNYŰ összegzés a
// JS-nek a SAJÁT sémánkban (`RawRoom` — `roomPlanSummary.ts`), nem a RoomPlan típusaiban.

@MainActor
final class Remix3DRoomScanView: ExpoView {
  let onRoomState = EventDispatcher()

  #if canImport(RoomPlan)
  private var captureView: UIView?
  private var delegateBox: AnyObject?
  #endif

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    #if canImport(RoomPlan)
    captureView?.frame = bounds
    #endif
  }

  func start() throws {
    #if canImport(RoomPlan)
    guard #available(iOS 17.0, *), RoomCaptureSession.isSupported else {
      throw Remix3DError.unsupported("roomPlan")
    }
    let view = RoomCaptureView(frame: bounds)
    let box = RoomDelegate(owner: self)
    view.delegate = box
    view.captureSession.delegate = box
    captureView?.removeFromSuperview()
    captureView = view
    delegateBox = box
    addSubview(view)
    view.captureSession.run(configuration: RoomCaptureSession.Configuration())
    onRoomState(["state": "scanning"])
    #else
    throw Remix3DError.unsupported("roomPlan")
    #endif
  }

  /// a szken leállítása → a RoomPlan feldolgozza → USDZ + összegzés (a Promise-on)
  func finish(output: URL, promise: Promise) {
    #if canImport(RoomPlan)
    guard #available(iOS 17.0, *), let view = captureView as? RoomCaptureView, let box = delegateBox as? RoomDelegate else {
      promise.reject(Remix3DError.failed("notStarted"))
      return
    }
    box.pending = (output, promise)
    onRoomState(["state": "processing"])
    view.captureSession.stop()
    #else
    promise.reject(Remix3DError.unsupported("roomPlan"))
    #endif
  }

  func cancel() {
    #if canImport(RoomPlan)
    if #available(iOS 17.0, *), let view = captureView as? RoomCaptureView {
      view.captureSession.stop()
    }
    #endif
  }
}

#if canImport(RoomPlan)
@available(iOS 17.0, *)
@MainActor
final class RoomDelegate: NSObject, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
  weak var owner: Remix3DRoomScanView?
  var pending: (URL, Promise)?

  init(owner: Remix3DRoomScanView) {
    self.owner = owner
  }

  required init?(coder: NSCoder) { nil }
  func encode(with coder: NSCoder) {}

  nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    true
  }

  nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    Task { @MainActor in
      guard let (url, promise) = self.pending else { return }
      self.pending = nil
      if let error = error {
        promise.reject(Remix3DError.failed(error.localizedDescription))
        return
      }
      do {
        try? FileManager.default.removeItem(at: url)
        try processedResult.export(to: url, exportOptions: .parametric)
        var info = RoomDelegate.summary(processedResult)
        info["uri"] = url.absoluteString
        self.owner?.onRoomState(["state": "done"])
        promise.resolve(info)
      } catch {
        promise.reject(Remix3DError.failed(error.localizedDescription))
      }
    }
  }

  /// a RoomPlan-eredmény → a `RawRoom` séma (falak/nyílások/objektumok + padló-sarkok)
  static func summary(_ room: CapturedRoom) -> [String: Any] {
    func surface(_ s: CapturedRoom.Surface) -> [String: Any] {
      let t = s.transform
      let c0 = t.columns.0
      // a felület helyi X-tengelye világban → a függőleges tengely körüli irány (yaw)
      let yaw = atan2(-Double(c0.z), Double(c0.x))
      return [
        "id": s.identifier.uuidString,
        "width": s.dimensions.x,
        "height": s.dimensions.y,
        "center": ["x": t.columns.3.x, "y": t.columns.3.y, "z": t.columns.3.z],
        "yaw": yaw,
      ]
    }
    var floor: [[String: Float]] = []
    if let f = room.floors.first {
      for p in f.polygonCorners {
        let w = f.transform * SIMD4<Float>(p.x, p.y, p.z, 1)
        floor.append(["x": w.x, "z": w.z])
      }
    }
    var minB = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
    var maxB = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
    for s in room.walls + room.floors {
      let c = SIMD3<Float>(s.transform.columns.3.x, s.transform.columns.3.y, s.transform.columns.3.z)
      let r = simd_length(s.dimensions) / 2
      minB = simd_min(minB, c - r)
      maxB = simd_max(maxB, c + r)
    }
    if minB.x > maxB.x { minB = .zero; maxB = .zero }
    return [
      "room": [
        "walls": room.walls.map(surface),
        "doors": room.doors.map(surface),
        "windows": room.windows.map(surface),
        "openings": room.openings.map(surface),
        "objects": room.objects.map { o -> [String: Any] in
          [
            "id": o.identifier.uuidString,
            "category": String(describing: o.category),
            "dimensions": ["x": o.dimensions.x, "y": o.dimensions.y, "z": o.dimensions.z],
          ]
        },
        "floor": floor,
      ],
      "min": ["x": minB.x, "y": minB.y, "z": minB.z],
      "max": ["x": maxB.x, "y": maxB.y, "z": maxB.z],
    ]
  }
}
#endif

public class Remix3DRoomScanViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Remix3DRoomScanView")
    View(Remix3DRoomScanView.self) {
      Events("onRoomState")
      AsyncFunction("start") { (view: Remix3DRoomScanView) in
        try MainActor.assumeIsolated { try view.start() }
      }.runOnQueue(.main)
      AsyncFunction("finish") { (view: Remix3DRoomScanView, outputPath: String, promise: Promise) in
        let url = URL(string: outputPath) ?? URL(fileURLWithPath: outputPath)
        MainActor.assumeIsolated { view.finish(output: url, promise: promise) }
      }.runOnQueue(.main)
      AsyncFunction("cancel") { (view: Remix3DRoomScanView) in
        MainActor.assumeIsolated { view.cancel() }
      }.runOnQueue(.main)
    }
  }
}
