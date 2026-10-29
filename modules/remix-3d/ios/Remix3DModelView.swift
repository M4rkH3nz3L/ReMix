import ExpoModulesCore
import SceneKit
import UIKit

// 🧊 3D-néző (3D-Studio.md §8.1) — SceneKit, beépített orbit-vezérléssel:
// 1 ujj = forgatás, 2 ujj = nagyítás/eltolás, dupla koppintás = vissza a kezdő nézetre.
// A pillanatkép a nézet AKTUÁLIS kamerájából készül (WYSIWYG — „Kép a modellből").

final class Remix3DModelView: ExpoView {
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  /// 📏 mérés-módban a koppintott felületi pont (modell-koordináta, méter)
  let onTapPoint = EventDispatcher()

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
  /// 📏 mérés: koppintás → felületi pont; a jelölők az „asztal" alatt (a modellel forognak)
  private var measureMode = false
  private let markers = SCNNode()
  private var measureLines: [Double] = []
  private var measureDots: [Double] = []
  /// 🎛️ a modell forgatása + fény (a JS-dokumentumból; az exportok ugyanezt kapják)
  private var look = Remix3DRender.Look()
  private var content: SCNNode?
  /// ✂️ padló-levágás előnézete: vízszintes sík a megadott (megjelenítési) magasságban
  private let cutPlane = SCNNode()
  private var cutY: Double? = nil

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    scnView.allowsCameraControl = true
    scnView.autoenablesDefaultLighting = false
    scnView.antialiasingMode = .multisampling4X
    scnView.backgroundColor = .clear
    cameraNode.camera = Remix3DRender.makeCamera()
    addSubview(scnView)
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    tap.numberOfTapsRequired = 1
    scnView.addGestureRecognizer(tap)
  }

  @objc private func handleTap(_ g: UITapGestureRecognizer) {
    guard measureMode, let content = content else { return }
    let at = g.location(in: scnView)
    let hits = scnView.hitTest(at, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue, .ignoreHiddenNodes: true])
    // a saját jelölőinket és a vágósíkot kihagyjuk (a modell felülete számít)
    var found: SCNHitTestResult?
    for h in hits where !isUnder(h.node, markers) && !isUnder(h.node, cutPlane) {
      found = h
      break
    }
    guard let hit = found else { return }
    // a MODELL saját koordinátáiba (a forgatás nélkül) → a mérés a modellen marad
    let local = content.convertPosition(hit.worldCoordinates, from: nil)
    onTapPoint(["x": local.x, "y": local.y, "z": local.z])
  }

  /// `node` az `ancestor` maga vagy annak leszármazottja-e (az SCNNode-nak nincs ilyen API-ja)
  private func isUnder(_ node: SCNNode, _ ancestor: SCNNode) -> Bool {
    var p: SCNNode? = node
    while let c = p {
      if c === ancestor { return true }
      p = c.parent
    }
    return false
  }

  func setMeasureMode(_ on: Bool) {
    measureMode = on
  }

  /// mérési vonalak: 6 szám / szakasz (a, b) — modell-koordináta, méter
  func setMeasureLines(_ flat: [Double]) {
    measureLines = flat
    rebuildMarkers()
  }

  /// függő (még pár nélküli) pontok: 3 szám / pont
  func setMeasureDots(_ flat: [Double]) {
    measureDots = flat
    rebuildMarkers()
  }

  private func rebuildMarkers() {
    markers.childNodes.forEach { $0.removeFromParentNode() }
    let r = CGFloat(max(modelRadius, 0.02)) * 0.018
    let color = UIColor(red: 1, green: 0.84, blue: 0.2, alpha: 1)
    func dot(_ p: SCNVector3) {
      let s = SCNSphere(radius: r)
      s.firstMaterial?.diffuse.contents = color
      s.firstMaterial?.lightingModel = .constant
      s.firstMaterial?.readsFromDepthBuffer = false
      let n = SCNNode(geometry: s)
      n.position = p
      n.renderingOrder = 100
      markers.addChildNode(n)
    }
    var i = 0
    while i + 2 < measureDots.count {
      dot(SCNVector3(Float(measureDots[i]), Float(measureDots[i + 1]), Float(measureDots[i + 2])))
      i += 3
    }
    i = 0
    while i + 5 < measureLines.count {
      let a = SCNVector3(Float(measureLines[i]), Float(measureLines[i + 1]), Float(measureLines[i + 2]))
      let b = SCNVector3(Float(measureLines[i + 3]), Float(measureLines[i + 4]), Float(measureLines[i + 5]))
      dot(a)
      dot(b)
      let d = SCNVector3(b.x - a.x, b.y - a.y, b.z - a.z)
      let len = CGFloat(sqrt(d.x * d.x + d.y * d.y + d.z * d.z))
      if len > 0 {
        let c = SCNCylinder(radius: r * 0.35, height: len)
        c.firstMaterial?.diffuse.contents = color
        c.firstMaterial?.lightingModel = .constant
        c.firstMaterial?.readsFromDepthBuffer = false
        let n = SCNNode(geometry: c)
        n.position = SCNVector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
        // a henger alapból az Y-tengely mentén áll → a szakasz irányába fordítjuk
        n.look(at: SCNVector3(b.x, b.y, b.z), up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 1, 0))
        n.renderingOrder = 99
        markers.addChildNode(n)
      }
      i += 6
    }
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
      let scene = try Remix3DRender.loadScene(url)
      // a modell a közös tartalom-csomópontba (forgatás a doboz közepe körül — ugyanúgy,
      // mint az állóképnél / videónál / exportnál), az fölé egy forgatható „asztal"
      let (contentNode, center, radius) = Remix3DRender.wrapContent(scene, look: look)
      contentNode.removeFromParentNode()
      let table = SCNNode()
      // a forgás a modell KÖZEPE körül (a szabad szken AR-világkoordinátában van — az origó
      // körüli forgás kilendítené a képből); a pivot + pozíció együtt nem mozdítja a modellt
      table.pivot = SCNMatrix4MakeTranslation(center.x, center.y, center.z)
      table.position = center
      table.addChildNode(contentNode)
      scene.rootNode.addChildNode(table)
      Remix3DRender.addLights(to: scene, look: look)
      content = contentNode
      markers.removeFromParentNode()
      contentNode.addChildNode(markers)
      cutPlane.removeFromParentNode()
      table.addChildNode(cutPlane)
      cameraNode.removeFromParentNode()
      scene.rootNode.addChildNode(cameraNode)
      turntable = table
      modelCenter = center
      modelRadius = radius
      scnView.scene = scene
      needsFit = true
      fitCamera()
      rebuildMarkers()
      rebuildCutPlane()
      applyAutoRotate()
      onLoad(["radius": radius])
    } catch {
      onError(["code": "failed", "message": error.localizedDescription])
    }
  }

  /// forgatás kvaternióként `[x, y, z, w]` (a doboz közepe körül)
  func setRotation(_ q: [Double]) {
    look.rotation = q.count == 4
      ? simd_normalize(simd_quatf(ix: Float(q[0]), iy: Float(q[1]), iz: Float(q[2]), r: Float(q[3])))
      : simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
    content?.simdOrientation = look.rotation
  }

  /// fény-preset (studio / outdoor / night)
  func setLightingPreset(_ preset: String?) {
    look.preset = preset ?? "studio"
    relight()
  }

  /// expozíció (0.25–2)
  func setExposure(_ exposure: Double?) {
    look.exposure = Float(max(0.25, min(2, exposure ?? 1)))
    relight()
  }

  private func relight() {
    if let scene = scnView.scene {
      Remix3DRender.addLights(to: scene, look: look)
    }
  }

  /// ✂️ a padló-levágás síkja (megjelenítési magasság, méter); nil → rejtett
  func setCutPlane(_ y: Double?) {
    cutY = y
    rebuildCutPlane()
  }

  private func rebuildCutPlane() {
    cutPlane.childNodes.forEach { $0.removeFromParentNode() }
    cutPlane.geometry = nil
    guard let y = cutY, modelRadius > 0 else { return }
    let size = CGFloat(modelRadius) * 2.6
    let plane = SCNPlane(width: size, height: size)
    plane.firstMaterial?.diffuse.contents = UIColor(red: 1, green: 0.3, blue: 0.35, alpha: 0.35)
    plane.firstMaterial?.isDoubleSided = true
    plane.firstMaterial?.lightingModel = .constant
    plane.firstMaterial?.writesToDepthBuffer = false
    cutPlane.geometry = plane
    cutPlane.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
    cutPlane.position = SCNVector3(modelCenter.x, Float(y), modelCenter.z)
    cutPlane.renderingOrder = 50
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
      Events("onLoad", "onError", "onTapPoint")
      Prop("modelUri") { (view: Remix3DModelView, uri: String?) in view.setModelUri(uri) }
      Prop("background") { (view: Remix3DModelView, hex: String?) in view.setBackground(hex) }
      Prop("autoRotate") { (view: Remix3DModelView, on: Bool) in view.setAutoRotate(on) }
      Prop("wireframe") { (view: Remix3DModelView, mode: String?) in view.setWireframe(mode) }
      Prop("measureMode") { (view: Remix3DModelView, on: Bool) in view.setMeasureMode(on) }
      Prop("measureLines") { (view: Remix3DModelView, flat: [Double]) in view.setMeasureLines(flat) }
      Prop("measureDots") { (view: Remix3DModelView, flat: [Double]) in view.setMeasureDots(flat) }
      Prop("modelRotation") { (view: Remix3DModelView, q: [Double]) in view.setRotation(q) }
      Prop("lightingPreset") { (view: Remix3DModelView, preset: String?) in view.setLightingPreset(preset) }
      Prop("exposure") { (view: Remix3DModelView, e: Double?) in view.setExposure(e) }
      Prop("cutPlaneY") { (view: Remix3DModelView, y: Double?) in view.setCutPlane(y) }
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
