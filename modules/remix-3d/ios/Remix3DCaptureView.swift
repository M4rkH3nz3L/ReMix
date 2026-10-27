import ExpoModulesCore
import RealityKit
import SwiftUI
import UIKit

// 🧊 Tárgy-szken (Object Capture, iOS 17+) — 3D-Studio.md §2.1.
//
// A RealityKit `ObjectCaptureSession` vezetett rögzítést ad (a tárgy kijelölése,
// körbejárás, lefedettség); a képek egy KÖNYVTÁRBA kerülnek, amiből a modul
// `reconstruct` függvénye készít USDZ-t. A natív SwiftUI `ObjectCaptureView`-t
// hosztoljuk; az állapot és a visszajelzés (túl közel / sötét / gyors) eseményként
// megy a JS-nek, ami EMBER-OLVASHATÓ útmutatást mutat (i18n).

@available(iOS 17.0, *)
@MainActor
final class CaptureController: ObservableObject {
  @Published var session: ObjectCaptureSession?
  var onState: ((String, [String]) -> Void)?
  private var observer: Task<Void, Never>?
  private var feedbackObserver: Task<Void, Never>?

  func start(imagesDir: URL) {
    try? FileManager.default.createDirectory(at: imagesDir, withIntermediateDirectories: true)
    let s = ObjectCaptureSession()
    session = s
    s.start(imagesDirectory: imagesDir, configuration: ObjectCaptureSession.Configuration())
    observer = Task { @MainActor in
      for await state in s.stateUpdates {
        self.onState?(Self.name(of: state), [])
      }
    }
    feedbackObserver = Task { @MainActor in
      for await fb in s.feedbackUpdates {
        self.onState?(Self.name(of: s.state), fb.map { String(describing: $0) })
      }
    }
  }

  func detect() -> Bool { session?.startDetecting() ?? false }
  func capture() { session?.startCapturing() }
  func newPass() { session?.beginNewScanPass() }
  func finish() { session?.finish() }
  func cancel() {
    session?.cancel()
    observer?.cancel()
    feedbackObserver?.cancel()
  }

  static func name(of state: ObjectCaptureSession.CaptureState) -> String {
    switch state {
    case .initializing: return "initializing"
    case .ready: return "ready"
    case .detecting: return "detecting"
    case .capturing: return "capturing"
    case .finishing: return "finishing"
    case .completed: return "completed"
    case .failed: return "failed"
    @unknown default: return "unknown"
    }
  }
}

@available(iOS 17.0, *)
struct CaptureRoot: View {
  @ObservedObject var controller: CaptureController
  var body: some View {
    if let s = controller.session {
      ObjectCaptureView(session: s)
    } else {
      Color.black
    }
  }
}

@MainActor
final class Remix3DCaptureView: ExpoView {
  let onCaptureState = EventDispatcher()
  private var host: UIViewController?
  private var controllerBox: AnyObject?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    if #available(iOS 17.0, *) {
      let controller = CaptureController()
      controller.onState = { [weak self] state, feedback in
        self?.onCaptureState(["state": state, "feedback": feedback])
      }
      controllerBox = controller
      let vc = UIHostingController(rootView: CaptureRoot(controller: controller))
      vc.view.backgroundColor = .black
      addSubview(vc.view)
      host = vc
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    host?.view.frame = bounds
  }

  @available(iOS 17.0, *)
  private var controller: CaptureController? { controllerBox as? CaptureController }

  func start(imagesDir: String) throws {
    guard #available(iOS 17.0, *), let c = controller else { throw Remix3DError.unsupported("objectCapture") }
    let url = URL(string: imagesDir) ?? URL(fileURLWithPath: imagesDir)
    c.start(imagesDir: url)
  }

  func command(_ name: String) throws -> Bool {
    guard #available(iOS 17.0, *), let c = controller else { throw Remix3DError.unsupported("objectCapture") }
    switch name {
    case "detect": return c.detect()
    case "capture": c.capture()
    case "newPass": c.newPass()
    case "finish": c.finish()
    case "cancel": c.cancel()
    default: throw Remix3DError.badInput("command")
    }
    return true
  }
}

public class Remix3DCaptureViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Remix3DCaptureView")
    View(Remix3DCaptureView.self) {
      Events("onCaptureState")
      // az ObjectCaptureSession main-actorhoz kötött → a nézet-függvények a fő szálon
      AsyncFunction("start") { (view: Remix3DCaptureView, imagesDir: String) in
        try MainActor.assumeIsolated { try view.start(imagesDir: imagesDir) }
      }.runOnQueue(.main)
      AsyncFunction("command") { (view: Remix3DCaptureView, name: String) -> Bool in
        try MainActor.assumeIsolated { try view.command(name) }
      }.runOnQueue(.main)
    }
  }
}
