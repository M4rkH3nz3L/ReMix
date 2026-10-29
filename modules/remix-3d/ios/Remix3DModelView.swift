import ExpoModulesCore
import SceneKit
import UIKit

// 🧊 3D-néző (3D-Studio.md §8.1) — SceneKit, beépített orbit-vezérléssel:
// 1 ujj = forgatás, 2 ujj = nagyítás/eltolás, dupla koppintás = vissza a kezdő nézetre.
// A pillanatkép a nézet AKTUÁLIS kamerájából készül (WYSIWYG — „Kép a modellből").

final class Remix3DModelView: ExpoView {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()

  private let scnView = SCNView()
  private var turntable: SCNNode?
  private var loadedUri: String?
  /// a SAJÁT kamera: a modell befoglaló gömbjére és a nézet képarányára illesztve
  /// (a SceneKit automatikus kamerája túl közelről / oldalt vágva mutatta a modellt)
  private let cameraNode = SCNNode()
  private var modelCenter = SCNVector3Zero
  private var modelRadius: Float = 0
  /// a betöltés után még nem volt érvényes méret (0×0) → az első layoutnál illesztünk
  private var needsFit = false
  /// az automatikus forgás kért állapota (új modellnél / a betöltés előtt is megmarad)
  private var autoRotateOn = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    scnView.allowsCameraControl = true
    scnView.autoenablesDefaultLighting = true
    scnView.antialiasingMode = .multisampling4X
    scnView.backgroundColor = .clear
    cameraNode.camera = Remix3DRender.makeCamera()
    addSubview(scnView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scnView.frame = bounds
    if needsFit && bounds.width > 0 && bounds.height > 0 {
      fitCamera()
    }
  }

  /// a kamera a modell köré, a nézet képarányához illesztve (a szűkebb látószöggel)
  private func fitCamera() {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let aspect = Double(bounds.width / bounds.height)
    cameraNode.position = Remix3DRender.orbitPosition(center: modelCenter, radius: modelRadius, yaw: .pi / 6, pitch: .pi / 9, aspect: aspect)
    cameraNode.look(at: modelCenter)
    scnView.pointOfView = cameraNode
    scnView.defaultCameraController.target = modelCenter
    needsFit = false
  }

  func setModelUri(_ uri: String?) {
    guard let uri = uri, uri != loadedUri else { return }
    loadedUri = uri
    guard let url = URL(string: uri) ?? (uri.hasPrefix("/") ? URL(fileURLWithPath: uri) : nil) else {
      onError(["code": "badInput"])
      return
    }
    do {
      let scene = try SCNScene(url: url, options: nil)
      // egy forgatható „asztal" csomópont alá tesszük a modellt (automatikus forgáshoz)
      let table = SCNNode()
      for child in scene.rootNode.childNodes {
        child.removeFromParentNode()
        table.addChildNode(child)
      }
      // a forgás a modell KÖZEPE körül (a szabad szken AR-világkoordinátában van — az origó
      // körüli forgás kilendítené a képből); a pivot + pozíció együtt nem mozdítja a modellt
      let (center, radius) = table.boundingSphere
      table.pivot = SCNMatrix4MakeTranslation(center.x, center.y, center.z)
      table.position = center
      scene.rootNode.addChildNode(table)
      cameraNode.removeFromParentNode()
      scene.rootNode.addChildNode(cameraNode)
      turntable = table
      modelCenter = center
      modelRadius = radius
      scnView.scene = scene
      needsFit = true
      fitCamera()
      applyAutoRotate()
      onLoad(["radius": radius])
    } catch {
      onError(["code": "failed", "message": error.localizedDescription])
    }
  }

  func setBackground(_ hex: String?) {
    scnView.backgroundColor = hex.flatMap(UIColor.init(remixHex:)) ?? .clear
  }

  func setAutoRotate(_ on: Bool) {
    autoRotateOn = on
    applyAutoRotate()
  }

  private func applyAutoRotate() {
    guard let table = turntable else { return }
    table.removeAction(forKey: "turntable")
    if autoRotateOn {
      let spin = SCNAction.repeatForever(SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 12))
      table.runAction(spin, forKey: "turntable")
    }
  }

  /// háló-megjelenítés: "off" | "overlay" (a felületen) | "only" (csak a háló)
  func setWireframe(_ mode: String?) {
    switch mode {
    case "overlay":
      scnView.debugOptions = [.showWireframe]
    case "only":
      scnView.debugOptions = [.renderAsWireframe]
    default:
      scnView.debugOptions = []
    }
  }

  func snapshot(width: Int, height: Int, transparent: Bool) throws -> Data {
    guard let scene = scnView.scene else { throw Remix3DError.badInput("noScene") }
    return try Remix3DRender.snapshot(scene: scene, pointOfView: scnView.pointOfView, yaw: 0, pitch: 0, width: width, height: height, transparent: transparent)
  }
}

public class Remix3DModelViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Remix3DModelView")
    View(Remix3DModelView.self) {
      Events("onLoad", "onError")
      Prop("modelUri") { (view: Remix3DModelView, uri: String?) in view.setModelUri(uri) }
      Prop("background") { (view: Remix3DModelView, hex: String?) in view.setBackground(hex) }
      Prop("autoRotate") { (view: Remix3DModelView, on: Bool) in view.setAutoRotate(on) }
      Prop("wireframe") { (view: Remix3DModelView, mode: String?) in view.setWireframe(mode) }
      // a SceneKit-nézet állapotát (kamera) a fő szálon olvassuk
      AsyncFunction("snapshot") { (view: Remix3DModelView, outputPath: String, width: Int, height: Int, transparent: Bool) -> String in
        let data = try MainActor.assumeIsolated { try view.snapshot(width: width, height: height, transparent: transparent) }
        let url = URL(string: outputPath) ?? URL(fileURLWithPath: outputPath)
        try data.write(to: url)
        return url.absoluteString
      }.runOnQueue(.main)
    }
  }
}

extension UIColor {
  /// #rrggbb → UIColor (érvénytelennél nil)
  convenience init?(remixHex: String) {
    var s = remixHex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    self.init(
      red: CGFloat((v >> 16) & 0xff) / 255,
      green: CGFloat((v >> 8) & 0xff) / 255,
      blue: CGFloat(v & 0xff) / 255,
      alpha: 1
    )
  }
}
