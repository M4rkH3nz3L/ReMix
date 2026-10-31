import CoreGraphics
import Foundation
import ImageIO
import ModelIO
import simd

// 📦 Szabványos 3D-formátumok (a LiDAR-modellek kivitele + tárolása) — a KÉSZÜLÉKEN.
//
// Egy semleges köztes forma (`ModelData`: részenként pozíció/normál/UV/szín/index +
// alapszín és textúra) — ebbe olvas a ModelIO (USDZ/OBJ/PLY) és a saját GLB-olvasó, és
// ebből írnak a saját írók: GLB (glTF 2.0), bináris FBX 7.4, OBJ+MTL+textúrák (zip),
// PLY (csúcs-színnel), STL. Szándékosan UIKit/SceneKit-mentes → macOS-en is fordul
// és tesztelhető (gltf-validator, assimp). Az UV a ModelIO konvenciója szerint él
// (v felfelé); a glTF-író/-olvasó fordít.
//
// Elv: az EREDETI fájlt sosem írjuk — minden kivitel új fájl; az egységváltás EGYSZER,
// az opciókban történik (nincs dupla skálázás — az STL-író sem skáláz magától).

struct ModelPart {
  var name: String
  var positions: [SIMD3<Float>] = []
  var normals: [SIMD3<Float>] = []
  var uvs: [SIMD2<Float>] = []
  /// csúcs-szín 0–1
  var colors: [SIMD3<Float>] = []
  var indices: [UInt32] = []
  var baseColor = SIMD4<Float>(1, 1, 1, 1)
  var texture: CGImage?
  /// pontfelhő-rész (nincs lap)
  var points = false
}

struct ModelData {
  var parts: [ModelPart] = []
  /// a színek/textúrák szándékosan elhagyva (export-opció) → az írók nem színeznek
  var plain = false

  /// van-e bármilyen szín-információ (textúra, csúcs-szín, nem-fehér alapszín)
  var hasColor: Bool {
    !plain && parts.contains { $0.texture != nil || !$0.colors.isEmpty || $0.baseColor != SIMD4<Float>(1, 1, 1, 1) }
  }

  var isPoints: Bool { !parts.isEmpty && parts.allSatisfy { $0.points } }
  var hasTexture: Bool { parts.contains { $0.texture != nil && !$0.uvs.isEmpty } }
  var triangleCount: Int { parts.filter { !$0.points }.reduce(0) { $0 + $1.indices.count / 3 } }
  var pointCount: Int { parts.filter { $0.points }.reduce(0) { $0 + $1.positions.count } }

  var bounds: (SIMD3<Float>, SIMD3<Float>) {
    var mn = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
    var mx = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
    for p in parts {
      for v in p.positions {
        mn = simd_min(mn, v)
        mx = simd_max(mx, v)
      }
    }
    return mn.x > mx.x ? (.zero, .zero) : (mn, mx)
  }

  /// `{triangles, points, min, max}` — a JS ugyanazt a formát kapja, mint az `inspectModel`-nél
  var info: [String: Any] {
    let (mn, mx) = bounds
    return [
      "triangles": triangleCount,
      "points": pointCount,
      "textured": hasTexture,
      "min": ["x": mn.x, "y": mn.y, "z": mn.z],
      "max": ["x": mx.x, "y": mx.y, "z": mx.z],
    ]
  }
}

/// a kivitel beállításai (a JS `model3dExport.exportOptionsJson`-ja adja)
struct ExportOptions {
  /// glb | fbx | obj | usdz | usd | ply | stl
  var format = "glb"
  var rotation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
  /// méter → cél-egység (m 1, cm 100, mm 1000) — a glTF/USD mindig méter
  var scale: Float = 1
  /// egyszerűsítés rács-mérete méterben (0 = eredeti geometria)
  var cell: Float = 0
  /// textúrák és csúcs-színek
  var textures = true
  /// textúra max. oldalhossza px (0 = eredeti)
  var maxTexture = 0

  var hasRotation: Bool { abs(rotation.real) < 0.99999 }
  /// a geometria és a textúra változatlan (csak forgatás / egység)
  var keepsContent: Bool { cell <= 0 && textures && maxTexture <= 0 }

  static func parse(_ json: String?) -> ExportOptions {
    var o = ExportOptions()
    guard let json = json, let d = json.data(using: .utf8),
          let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return o }
    if let f = j["format"] as? String { o.format = f.lowercased() }
    if let r = j["rotation"] as? [Double], r.count == 4 {
      let q = simd_quatf(ix: Float(r[0]), iy: Float(r[1]), iz: Float(r[2]), r: Float(r[3]))
      if simd_length(q.vector) > 0 { o.rotation = simd_normalize(q) }
    }
    if let s = j["scale"] as? Double, s > 0 { o.scale = Float(s) }
    if let c = j["cell"] as? Double, c > 0 { o.cell = Float(c) }
    if let t = j["textures"] as? Bool { o.textures = t }
    if let m = j["maxTexture"] as? Int, m > 0 { o.maxTexture = m }
    return o
  }
}

enum Remix3DFormats {
  // ── 📥 beolvasás ─────────────────────────────────────────────────────────────

  static func load(_ url: URL) throws -> ModelData {
    let ext = url.pathExtension.lowercased()
    if ext == "glb" {
      return try readGLB(url)
    }
    if ext == "gltf" {
      return try readGLTF(url)
    }
    if ext == "fbx" {
      return try readFBX(url)
    }
    if ext == "zip" {
      return try readZip(url)
    }
    if ext == "ply", let (pts, cols) = readPointPLY(url) {
      var part = ModelPart(name: "points", positions: pts)
      part.colors = cols.map { SIMD3<Float>(Float($0.x), Float($0.y), Float($0.z)) / 255 }
      part.points = true
      return ModelData(parts: [part])
    }
    let asset = MDLAsset(url: url)
    asset.loadTextures()
    var model = ModelData()
    for case let mesh as MDLMesh in asset.childObjects(of: MDLMesh.self) {
      model.parts.append(contentsOf: parts(of: mesh))
    }
    guard !model.parts.isEmpty else { throw Remix3DError.failed("emptyMesh") }
    return model
  }

  /// egy ModelIO-háló → részek (submesh-enként), világ-koordinátában
  private static func parts(of mesh: MDLMesh) -> [ModelPart] {
    guard let pos = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributePosition, as: .float3) else { return [] }
    let nrm = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeNormal, as: .float3)
    let tex = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeTextureCoordinate, as: .float2)
    let col = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeColor, as: .float3)
      ?? mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributeColor, as: .float4)
    let world = MDLTransform.globalTransform(with: mesh, atTime: 0)
    let m3 = simd_float3x3(
      SIMD3<Float>(world.columns.0.x, world.columns.0.y, world.columns.0.z),
      SIMD3<Float>(world.columns.1.x, world.columns.1.y, world.columns.1.z),
      SIMD3<Float>(world.columns.2.x, world.columns.2.y, world.columns.2.z)
    )
    let normalMatrix = m3.determinant != 0 ? m3.inverse.transpose : m3
    func f(_ a: MDLVertexAttributeData, _ i: Int) -> UnsafePointer<Float> {
      UnsafePointer(a.dataStart.advanced(by: i * a.stride).assumingMemoryBound(to: Float.self))
    }
    var out: [ModelPart] = []
    let subs = mesh.submeshes as? [MDLSubmesh] ?? []
    for (si, sub) in subs.enumerated() where sub.geometryType == .triangles {
      var part = ModelPart(name: subs.count > 1 ? "\(mesh.name.isEmpty ? "mesh" : mesh.name)_\(si)" : (mesh.name.isEmpty ? "mesh" : mesh.name))
      var remap: [Int: UInt32] = [:]
      let buf = sub.indexBuffer(asIndexType: .uInt32).map()
      let count = sub.indexCount - sub.indexCount % 3
      part.indices.reserveCapacity(count)
      for k in 0..<count {
        let i = Int(buf.bytes.load(fromByteOffset: k * 4, as: UInt32.self))
        if let r = remap[i] {
          part.indices.append(r)
          continue
        }
        let r = UInt32(part.positions.count)
        remap[i] = r
        let p = f(pos, i)
        let w = world * SIMD4<Float>(p[0], p[1], p[2], 1)
        part.positions.append(SIMD3<Float>(w.x, w.y, w.z))
        if let nrm {
          let n = f(nrm, i)
          let v = normalMatrix * SIMD3<Float>(n[0], n[1], n[2])
          let l = simd_length(v)
          part.normals.append(l > 0 ? v / l : SIMD3<Float>(0, 1, 0))
        }
        if let tex {
          let t = f(tex, i)
          part.uvs.append(SIMD2<Float>(t[0], t[1]))
        }
        if let col {
          let c = f(col, i)
          part.colors.append(SIMD3<Float>(c[0], c[1], c[2]))
        }
        part.indices.append(r)
      }
      if let mat = sub.material, let p = mat.property(with: .baseColor) {
        switch p.type {
        case .texture:
          if let img = p.textureSamplerValue?.texture?.imageFromTexture()?.takeUnretainedValue() {
            part.texture = img
          }
        case .float3:
          part.baseColor = SIMD4<Float>(p.float3Value, 1)
        case .float4:
          part.baseColor = p.float4Value
        case .color:
          if let c = p.color, let comps = c.components, comps.count >= 3 {
            part.baseColor = SIMD4<Float>(Float(comps[0]), Float(comps[1]), Float(comps[2]), comps.count > 3 ? Float(comps[3]) : 1)
          }
        default:
          break
        }
      }
      if part.texture == nil { part.uvs = [] }
      if !part.indices.isEmpty { out.append(part) }
    }
    return out
  }

  // ── 🛠️ átalakítás (az opciók szerint; az eredeti adat érintetlen) ───────────────

  static func apply(_ input: ModelData, _ o: ExportOptions) -> ModelData {
    var m = input
    if o.hasRotation {
      let (mn, mx) = m.bounds
      let c = (mn + mx) / 2
      for i in m.parts.indices {
        m.parts[i].positions = m.parts[i].positions.map { c + o.rotation.act($0 - c) }
        m.parts[i].normals = m.parts[i].normals.map { o.rotation.act($0) }
      }
    }
    if !o.textures {
      m.plain = true
      for i in m.parts.indices {
        m.parts[i].texture = nil
        m.parts[i].uvs = []
        m.parts[i].colors = []
        m.parts[i].baseColor = SIMD4<Float>(0.8, 0.8, 0.8, 1)
      }
    } else if o.maxTexture > 0 {
      var cache: [ObjectIdentifier: CGImage] = [:]
      for i in m.parts.indices {
        guard let t = m.parts[i].texture else { continue }
        let key = ObjectIdentifier(t)
        let small = cache[key] ?? downscale(t, maxSide: o.maxTexture)
        cache[key] = small
        m.parts[i].texture = small
      }
    }
    if o.cell > 0 {
      m.parts = m.parts.map { simplify($0, cell: o.cell) }.filter { !$0.indices.isEmpty || $0.points }
    }
    if o.scale != 1 {
      for i in m.parts.indices {
        m.parts[i].positions = m.parts[i].positions.map { $0 * o.scale }
      }
    }
    return m
  }

  /// egyszerűsítés csúcs-klaszterezéssel — a UV-varratok mentén NEM olvaszt össze (a kulcs
  /// a pozíció-cella ÉS a kvantált UV), így a textúra nem csúszik el
  static func simplify(_ p: ModelPart, cell: Float) -> ModelPart {
    guard cell > 0, !p.points, !p.positions.isEmpty else { return p }
    struct Key: Hashable {
      var c: SIMD3<Int32>
      var u: SIMD2<Int32>
    }
    let hasN = p.normals.count == p.positions.count
    let hasUV = p.uvs.count == p.positions.count
    let hasC = p.colors.count == p.positions.count
    var cells: [Key: UInt32] = [:]
    var sumP: [SIMD3<Float>] = [], sumN: [SIMD3<Float>] = [], sumUV: [SIMD2<Float>] = [], sumC: [SIMD3<Float>] = []
    var counts: [Float] = []
    var remap = [UInt32](repeating: 0, count: p.positions.count)
    for (i, v) in p.positions.enumerated() {
      let c = SIMD3<Int32>(Int32((v.x / cell).rounded(.down)), Int32((v.y / cell).rounded(.down)), Int32((v.z / cell).rounded(.down)))
      let u = hasUV ? SIMD2<Int32>(Int32((p.uvs[i].x * 512).rounded(.down)), Int32((p.uvs[i].y * 512).rounded(.down))) : .zero
      let key = Key(c: c, u: u)
      if let k = cells[key] {
        remap[i] = k
        let j = Int(k)
        sumP[j] += v
        if hasN { sumN[j] += p.normals[i] }
        if hasUV { sumUV[j] += p.uvs[i] }
        if hasC { sumC[j] += p.colors[i] }
        counts[j] += 1
      } else {
        let k = UInt32(sumP.count)
        cells[key] = k
        remap[i] = k
        sumP.append(v)
        if hasN { sumN.append(p.normals[i]) }
        if hasUV { sumUV.append(p.uvs[i]) }
        if hasC { sumC.append(p.colors[i]) }
        counts.append(1)
      }
    }
    var out = p
    out.positions = zip(sumP, counts).map { $0 / $1 }
    out.normals = hasN ? sumN.map { simd_length($0) > 0 ? simd_normalize($0) : SIMD3<Float>(0, 1, 0) } : []
    out.uvs = hasUV ? zip(sumUV, counts).map { $0 / $1 } : []
    out.colors = hasC ? zip(sumC, counts).map { $0 / $1 } : []
    out.indices = []
    var t = 0
    while t + 2 < p.indices.count {
      let a = remap[Int(p.indices[t])], b = remap[Int(p.indices[t + 1])], c = remap[Int(p.indices[t + 2])]
      if a != b && b != c && a != c {
        out.indices.append(contentsOf: [a, b, c])
      }
      t += 3
    }
    return out
  }

  /// hiányzó / elcsúszott normálok → terület-súlyozott csúcs-normálok
  static func ensureNormals(_ p: inout ModelPart) {
    guard !p.points, p.normals.count != p.positions.count else { return }
    var acc = [SIMD3<Float>](repeating: .zero, count: p.positions.count)
    var t = 0
    while t + 2 < p.indices.count {
      let a = Int(p.indices[t]), b = Int(p.indices[t + 1]), c = Int(p.indices[t + 2])
      let n = simd_cross(p.positions[b] - p.positions[a], p.positions[c] - p.positions[a])
      acc[a] += n
      acc[b] += n
      acc[c] += n
      t += 3
    }
    p.normals = acc.map { simd_length($0) > 0 ? simd_normalize($0) : SIMD3<Float>(0, 1, 0) }
  }

  // ── 🖼️ képek (ImageIO — UIKit nélkül) ───────────────────────────────────────

  static func png(_ img: CGImage) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, img, nil)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
  }

  static func decodeImage(_ d: Data) -> CGImage? {
    guard let src = CGImageSourceCreateWithData(d as CFData, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
  }

  static func downscale(_ img: CGImage, maxSide: Int) -> CGImage {
    let w = img.width, h = img.height
    guard maxSide > 0, max(w, h) > maxSide else { return img }
    let s = Double(maxSide) / Double(max(w, h))
    let nw = max(1, Int(Double(w) * s)), nh = max(1, Int(Double(h) * s))
    guard let ctx = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return img }
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: nw, height: nh))
    return ctx.makeImage() ?? img
  }

  /// RGBA8 pixelek (felső sor elöl) — a csúcs-szín mintavételezéséhez és az MDLTexture-höz
  static func rgba(_ img: CGImage) -> (data: [UInt8], width: Int, height: Int) {
    let w = img.width, h = img.height
    var px = [UInt8](repeating: 0, count: w * h * 4)
    px.withUnsafeMutableBytes { raw in
      guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
      ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    return (px, w, h)
  }

  /// a rész csúcs-színei: saját szín → textúra-minta az UV-n → alapszín
  static func vertexColors(_ p: ModelPart, cache: inout [ObjectIdentifier: (data: [UInt8], width: Int, height: Int)]) -> [SIMD3<Float>] {
    if p.colors.count == p.positions.count { return p.colors }
    if let t = p.texture, p.uvs.count == p.positions.count {
      let key = ObjectIdentifier(t)
      let px = cache[key] ?? rgba(t)
      cache[key] = px
      return p.uvs.map { uv in
        let u = uv.x - floor(uv.x), v = uv.y - floor(uv.y)
        let x = min(px.width - 1, max(0, Int(u * Float(px.width))))
        // ModelIO-UV: v felfelé → a kép sora fentről számol
        let y = min(px.height - 1, max(0, Int((1 - v) * Float(px.height))))
        let o = (y * px.width + x) * 4
        return SIMD3<Float>(Float(px.data[o]), Float(px.data[o + 1]), Float(px.data[o + 2])) / 255
      }
    }
    let c = SIMD3<Float>(p.baseColor.x, p.baseColor.y, p.baseColor.z)
    return [SIMD3<Float>](repeating: c, count: p.positions.count)
  }

  // ── ✍️ írás (formátum szerint) ─────────────────────────────────────────────────

  /// a megadott formátumba ír; az OBJ textúrával zip-be kerül → a TÉNYLEGES fájl URL-je
  /// (atomikusan: ideiglenes fájlba ír, és csak a kész fájl kerül a helyére)
  @discardableResult
  static func write(_ m: ModelData, options o: ExportOptions, to url: URL) throws -> URL {
    let format = o.format
    var target = url
    let tmp = url.deletingLastPathComponent().appendingPathComponent(".tmp_\(UUID().uuidString)_\(url.lastPathComponent)")
    defer { try? FileManager.default.removeItem(at: tmp) }
    switch format {
    case "glb":
      try writeGLB(m, to: tmp)
    case "fbx":
      guard !m.isPoints else { throw Remix3DError.unsupported("export:fbx") }
      // FBX: a UnitScaleFactor cm/egység (m → 100, cm → 1, mm → 0.1) — a koordináták már a cél-egységben
      try writeFBX(m, to: tmp, unitCentimeters: Double(100 / o.scale))
    case "obj":
      guard !m.isPoints else { throw Remix3DError.unsupported("export:obj") }
      if m.hasTexture {
        target = url.deletingPathExtension().appendingPathExtension("zip")
        try writeOBJZip(m, baseName: url.deletingPathExtension().lastPathComponent, to: tmp)
      } else {
        try writeOBJ(m, to: tmp)
      }
    case "ply":
      try writePLY(m, to: tmp)
    case "stl":
      guard !m.isPoints else { throw Remix3DError.unsupported("export:stl") }
      try writeSTL(m, to: tmp)
    default:
      throw Remix3DError.unsupported("export:\(format)")
    }
    try? FileManager.default.removeItem(at: target)
    try FileManager.default.moveItem(at: tmp, to: target)
    return target
  }

  // ── GLB (glTF 2.0 bináris) ───────────────────────────────────────────────────

  static func writeGLB(_ input: ModelData, to url: URL) throws {
    var bin = Data()
    var bufferViews: [[String: Any]] = []
    var accessors: [[String: Any]] = []
    var meshes: [[String: Any]] = []
    var nodes: [[String: Any]] = []
    var materials: [[String: Any]] = []
    var images: [[String: Any]] = []
    var textures: [[String: Any]] = []
    var imageIndex: [ObjectIdentifier: Int] = [:]

    func align() {
      while bin.count % 4 != 0 { bin.append(0) }
    }
    func view(_ d: Data, target: Int?) -> Int {
      align()
      var v: [String: Any] = ["buffer": 0, "byteOffset": bin.count, "byteLength": d.count]
      if let target { v["target"] = target }
      bin.append(d)
      bufferViews.append(v)
      return bufferViews.count - 1
    }
    func vec3(_ a: [SIMD3<Float>], minMax: Bool) -> Int {
      var d = Data(capacity: a.count * 12)
      var mn = SIMD3<Float>(repeating: .greatestFiniteMagnitude), mx = -mn
      for v in a {
        d.f32(v.x); d.f32(v.y); d.f32(v.z)
        mn = simd_min(mn, v); mx = simd_max(mx, v)
      }
      var acc: [String: Any] = ["bufferView": view(d, target: 34962), "componentType": 5126, "count": a.count, "type": "VEC3"]
      if minMax {
        acc["min"] = [mn.x, mn.y, mn.z].map(Double.init)
        acc["max"] = [mx.x, mx.y, mx.z].map(Double.init)
      }
      accessors.append(acc)
      return accessors.count - 1
    }

    for var p in input.parts where !p.positions.isEmpty {
      ensureNormals(&p)
      var attrs: [String: Any] = ["POSITION": vec3(p.positions, minMax: true)]
      if !p.points {
        attrs["NORMAL"] = vec3(p.normals, minMax: false)
      }
      let textured = p.texture != nil && p.uvs.count == p.positions.count
      if textured {
        var d = Data(capacity: p.uvs.count * 8)
        for uv in p.uvs {
          d.f32(uv.x); d.f32(1 - uv.y) // glTF: v lefelé
        }
        accessors.append(["bufferView": view(d, target: 34962), "componentType": 5126, "count": p.uvs.count, "type": "VEC2"])
        attrs["TEXCOORD_0"] = accessors.count - 1
      }
      if p.colors.count == p.positions.count {
        attrs["COLOR_0"] = vec3(p.colors.map { simd_clamp($0, .zero, SIMD3<Float>(repeating: 1)) }, minMax: false)
      }
      var material: [String: Any] = ["name": p.name]
      var pbr: [String: Any] = [
        "baseColorFactor": [p.baseColor.x, p.baseColor.y, p.baseColor.z, p.baseColor.w].map(Double.init),
        "metallicFactor": 0.0,
        "roughnessFactor": 1.0,
      ]
      if textured, let tex = p.texture {
        let key = ObjectIdentifier(tex)
        if imageIndex[key] == nil, let pngData = png(tex) {
          images.append(["bufferView": view(pngData, target: nil), "mimeType": "image/png"])
          textures.append(["source": images.count - 1, "sampler": 0])
          imageIndex[key] = textures.count - 1
        }
        if let ti = imageIndex[key] {
          pbr["baseColorTexture"] = ["index": ti]
        }
      }
      material["pbrMetallicRoughness"] = pbr
      materials.append(material)
      var prim: [String: Any] = ["attributes": attrs, "material": materials.count - 1, "mode": p.points ? 0 : 4]
      if !p.points {
        var d = Data(capacity: p.indices.count * 4)
        for i in p.indices { d.u32(i) }
        accessors.append(["bufferView": view(d, target: 34963), "componentType": 5125, "count": p.indices.count, "type": "SCALAR"])
        prim["indices"] = accessors.count - 1
      }
      meshes.append(["name": p.name, "primitives": [prim]])
      nodes.append(["name": p.name, "mesh": meshes.count - 1])
    }
    guard !meshes.isEmpty else { throw Remix3DError.failed("emptyMesh") }
    align()

    var json: [String: Any] = [
      "asset": ["version": "2.0", "generator": "ReMix 3D Studio"],
      "scene": 0,
      "scenes": [["name": "ReMix", "nodes": Array(0..<nodes.count)]],
      "nodes": nodes,
      "meshes": meshes,
      "materials": materials,
      "accessors": accessors,
      "bufferViews": bufferViews,
      "buffers": [["byteLength": bin.count]],
    ]
    if !images.isEmpty {
      json["images"] = images
      json["textures"] = textures
      json["samplers"] = [["magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497]]
    }
    var jsonData = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
    while jsonData.count % 4 != 0 { jsonData.append(0x20) }

    var out = Data()
    out.u32(0x4654_6C67) // „glTF"
    out.u32(2)
    out.u32(UInt32(12 + 8 + jsonData.count + 8 + bin.count))
    out.u32(UInt32(jsonData.count))
    out.u32(0x4E4F_534A) // JSON
    out.append(jsonData)
    out.u32(UInt32(bin.count))
    out.u32(0x004E_4942) // BIN
    out.append(bin)
    try out.write(to: url)
  }

  /// GLB beolvasása (a gyakori részhalmaz: háromszög/pont primitívek, csomópont-hierarchia,
  /// TRS/mátrix, alapszín + beágyazott baseColor-textúra) → világ-koordinátás részek
  static func readGLB(_ url: URL) throws -> ModelData {
    let data = try Data(contentsOf: url)
    guard data.count >= 20, data.u32(at: 0) == 0x4654_6C67 else { throw Remix3DError.badInput("glb") }
    var offset = 12
    var json: [String: Any] = [:]
    var bin = Data()
    while offset + 8 <= data.count {
      let len = Int(data.u32(at: offset))
      let type = data.u32(at: offset + 4)
      let start = offset + 8
      guard start + len <= data.count else { break }
      let chunk = data.subdata(in: start..<(start + len))
      if type == 0x4E4F_534A {
        json = (try JSONSerialization.jsonObject(with: chunk)) as? [String: Any] ?? [:]
      } else if type == 0x004E_4942 {
        bin = chunk
      }
      offset = start + len
    }
    return try parseGLTF(json: json, glbBin: bin, base: url.deletingLastPathComponent())
  }

  /// 📄 glTF 2.0 (.gltf JSON) — a pufferek/képek `data:` URI-ból vagy a fájl melletti
  /// relatív fájlokból (Blender „glTF Separate" / „Embedded" export is)
  static func readGLTF(_ url: URL) throws -> ModelData {
    let data = try Data(contentsOf: url)
    guard let json = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      throw Remix3DError.badInput("gltf")
    }
    return try parseGLTF(json: json, glbBin: nil, base: url.deletingLastPathComponent())
  }

  /// `data:` vagy relatív URI → bájtok
  private static func gltfResource(_ uri: String, base: URL) -> Data? {
    if uri.hasPrefix("data:") {
      guard let comma = uri.firstIndex(of: ",") else { return nil }
      return Data(base64Encoded: String(uri[uri.index(after: comma)...]))
    }
    let decoded = uri.removingPercentEncoding ?? uri
    // biztonság: csak a modell mappáján BELÜLI fájl (nincs ../ kiszökés)
    let file = base.appendingPathComponent(decoded).standardizedFileURL
    guard file.path.hasPrefix(base.standardizedFileURL.path) else { return nil }
    return try? Data(contentsOf: file)
  }

  /// a glTF közös feldolgozója (GLB: a BIN-chunk a 0. puffer, ha annak nincs uri-ja)
  private static func parseGLTF(json: [String: Any], glbBin: Data?, base: URL) throws -> ModelData {
    let bufferDefs = json["buffers"] as? [[String: Any]] ?? []
    let buffers: [Data] = bufferDefs.enumerated().map { i, b in
      if let uri = b["uri"] as? String { return gltfResource(uri, base: base) ?? Data() }
      return i == 0 ? (glbBin ?? Data()) : Data()
    }
    let views = json["bufferViews"] as? [[String: Any]] ?? []
    let accs = json["accessors"] as? [[String: Any]] ?? []
    let meshes = json["meshes"] as? [[String: Any]] ?? []
    let nodes = json["nodes"] as? [[String: Any]] ?? []
    let mats = json["materials"] as? [[String: Any]] ?? []
    let texs = json["textures"] as? [[String: Any]] ?? []
    let imgs = json["images"] as? [[String: Any]] ?? []

    func viewData(_ vi: Int) -> (Data, Int?)? {
      guard vi >= 0, vi < views.count else { return nil }
      let v = views[vi]
      let bi = v["buffer"] as? Int ?? 0
      guard bi >= 0, bi < buffers.count else { return nil }
      let bin = buffers[bi]
      let off = v["byteOffset"] as? Int ?? 0
      let len = v["byteLength"] as? Int ?? 0
      guard off + len <= bin.count else { return nil }
      return (bin.subdata(in: off..<(off + len)), v["byteStride"] as? Int)
    }
    let compSize = [5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4]
    let typeComps = ["SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4]
    /// accessor → lebegőpontos komponensek (normalizált egészeket is)
    func floats(_ ai: Int) -> (comps: Int, values: [Float])? {
      guard ai >= 0, ai < accs.count else { return nil }
      let a = accs[ai]
      guard let vi = a["bufferView"] as? Int, let (d, stride) = viewData(vi),
            let ct = a["componentType"] as? Int, let cs = compSize[ct],
            let comps = typeComps[a["type"] as? String ?? ""], let count = a["count"] as? Int else { return nil }
      let base = a["byteOffset"] as? Int ?? 0
      let normalized = a["normalized"] as? Bool ?? false
      let st = stride ?? comps * cs
      guard count == 0 || base + (count - 1) * st + comps * cs <= d.count else { return nil }
      var out = [Float](); out.reserveCapacity(count * comps)
      d.withUnsafeBytes { raw in
        for i in 0..<count {
          for c in 0..<comps {
            let o = base + i * st + c * cs
            let v: Float
            switch ct {
            case 5126: v = Float(bitPattern: raw.loadUnaligned(fromByteOffset: o, as: UInt32.self).littleEndian)
            case 5121: v = normalized ? Float(raw[o]) / 255 : Float(raw[o])
            case 5123: let x = raw.loadUnaligned(fromByteOffset: o, as: UInt16.self).littleEndian; v = normalized ? Float(x) / 65535 : Float(x)
            case 5125: v = Float(raw.loadUnaligned(fromByteOffset: o, as: UInt32.self).littleEndian)
            case 5120: let x = Int8(bitPattern: raw[o]); v = normalized ? max(Float(x) / 127, -1) : Float(x)
            default: let x = raw.loadUnaligned(fromByteOffset: o, as: Int16.self).littleEndian; v = normalized ? max(Float(x) / 32767, -1) : Float(x)
            }
            out.append(v)
          }
        }
      }
      return (comps, out)
    }
    func ints(_ ai: Int) -> [UInt32]? {
      guard ai >= 0, ai < accs.count else { return nil }
      let a = accs[ai]
      guard let vi = a["bufferView"] as? Int, let (d, _) = viewData(vi),
            let ct = a["componentType"] as? Int, let cs = compSize[ct], let count = a["count"] as? Int else { return nil }
      let base = a["byteOffset"] as? Int ?? 0
      guard base + count * cs <= d.count else { return nil }
      var out = [UInt32](); out.reserveCapacity(count)
      d.withUnsafeBytes { raw in
        for i in 0..<count {
          let o = base + i * cs
          switch ct {
          case 5125: out.append(raw.loadUnaligned(fromByteOffset: o, as: UInt32.self).littleEndian)
          case 5123: out.append(UInt32(raw.loadUnaligned(fromByteOffset: o, as: UInt16.self).littleEndian))
          default: out.append(UInt32(raw[o]))
          }
        }
      }
      return out
    }
    var imageCache: [Int: CGImage] = [:]
    func image(texture ti: Int) -> CGImage? {
      guard ti >= 0, ti < texs.count, let si = texs[ti]["source"] as? Int, si < imgs.count else { return nil }
      if let c = imageCache[si] { return c }
      var bytes: Data?
      if let bv = imgs[si]["bufferView"] as? Int { bytes = viewData(bv)?.0 }
      else if let uri = imgs[si]["uri"] as? String { bytes = gltfResource(uri, base: base) }
      guard let d = bytes, let img = decodeImage(d) else { return nil }
      imageCache[si] = img
      return img
    }
    func localMatrix(_ n: [String: Any]) -> simd_float4x4 {
      if let m = n["matrix"] as? [Double], m.count == 16 {
        let f = m.map(Float.init)
        return simd_float4x4(SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]), SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15]))
      }
      var m = matrix_identity_float4x4
      if let s = n["scale"] as? [Double], s.count == 3 {
        m = simd_float4x4(diagonal: SIMD4(Float(s[0]), Float(s[1]), Float(s[2]), 1))
      }
      if let r = n["rotation"] as? [Double], r.count == 4 {
        m = simd_float4x4(simd_quatf(ix: Float(r[0]), iy: Float(r[1]), iz: Float(r[2]), r: Float(r[3]))) * m
      }
      if let t = n["translation"] as? [Double], t.count == 3 {
        var tm = matrix_identity_float4x4
        tm.columns.3 = SIMD4(Float(t[0]), Float(t[1]), Float(t[2]), 1)
        m = tm * m
      }
      return m
    }

    var model = ModelData()
    func visit(_ ni: Int, _ parent: simd_float4x4, depth: Int) {
      guard ni >= 0, ni < nodes.count, depth < 64 else { return }
      let n = nodes[ni]
      let world = parent * localMatrix(n)
      if let mi = n["mesh"] as? Int, mi < meshes.count {
        let m3 = simd_float3x3(
          SIMD3<Float>(world.columns.0.x, world.columns.0.y, world.columns.0.z),
          SIMD3<Float>(world.columns.1.x, world.columns.1.y, world.columns.1.z),
          SIMD3<Float>(world.columns.2.x, world.columns.2.y, world.columns.2.z)
        )
        let nm = m3.determinant != 0 ? m3.inverse.transpose : m3
        let prims = meshes[mi]["primitives"] as? [[String: Any]] ?? []
        for (pi, prim) in prims.enumerated() {
          let mode = prim["mode"] as? Int ?? 4
          guard mode == 4 || mode == 0, let attrs = prim["attributes"] as? [String: Int],
                let pa = attrs["POSITION"], let pos = floats(pa), pos.comps == 3 else { continue }
          var part = ModelPart(name: (meshes[mi]["name"] as? String ?? "mesh") + (prims.count > 1 ? "_\(pi)" : ""))
          part.points = mode == 0
          let vc = pos.values.count / 3
          part.positions = (0..<vc).map { i in
            let w = world * SIMD4<Float>(pos.values[i * 3], pos.values[i * 3 + 1], pos.values[i * 3 + 2], 1)
            return SIMD3<Float>(w.x, w.y, w.z)
          }
          if let na = attrs["NORMAL"], let nr = floats(na), nr.comps == 3, nr.values.count == vc * 3 {
            part.normals = (0..<vc).map { i in
              let v = nm * SIMD3<Float>(nr.values[i * 3], nr.values[i * 3 + 1], nr.values[i * 3 + 2])
              return simd_length(v) > 0 ? simd_normalize(v) : SIMD3<Float>(0, 1, 0)
            }
          }
          if let ca = attrs["COLOR_0"], let cl = floats(ca), cl.comps >= 3, cl.values.count == vc * cl.comps {
            part.colors = (0..<vc).map { i in SIMD3<Float>(cl.values[i * cl.comps], cl.values[i * cl.comps + 1], cl.values[i * cl.comps + 2]) }
          }
          if let mi = prim["material"] as? Int, mi < mats.count {
            let pbr = mats[mi]["pbrMetallicRoughness"] as? [String: Any] ?? [:]
            if let f = pbr["baseColorFactor"] as? [Double], f.count == 4 {
              part.baseColor = SIMD4(Float(f[0]), Float(f[1]), Float(f[2]), Float(f[3]))
            }
            if let bt = pbr["baseColorTexture"] as? [String: Any], let ti = bt["index"] as? Int, let img = image(texture: ti),
               let ta = attrs["TEXCOORD_\(bt["texCoord"] as? Int ?? 0)"], let uv = floats(ta), uv.comps == 2, uv.values.count == vc * 2 {
              part.texture = img
              // glTF v lefelé → ModelIO-konvenció (v felfelé)
              part.uvs = (0..<vc).map { i in SIMD2<Float>(uv.values[i * 2], 1 - uv.values[i * 2 + 1]) }
            }
          }
          if !part.points {
            if let ia = prim["indices"] as? Int, let idx = ints(ia) {
              part.indices = Array(idx.prefix(idx.count - idx.count % 3)).filter { Int($0) < vc }
              if part.indices.count % 3 != 0 { part.indices = [] }
            } else {
              part.indices = (0..<UInt32(vc - vc % 3)).map { $0 }
            }
            if part.indices.isEmpty { continue }
          }
          model.parts.append(part)
        }
      }
      for c in n["children"] as? [Int] ?? [] {
        visit(c, world, depth: depth + 1)
      }
    }
    let scenes = json["scenes"] as? [[String: Any]] ?? []
    var roots: [Int]
    if let si = json["scene"] as? Int ?? (scenes.isEmpty ? nil : 0), si < scenes.count, let r = scenes[si]["nodes"] as? [Int] {
      roots = r
    } else {
      let children = Set(nodes.flatMap { $0["children"] as? [Int] ?? [] })
      roots = (0..<nodes.count).filter { !children.contains($0) }
    }
    for r in roots { visit(r, matrix_identity_float4x4, depth: 0) }
    guard !model.parts.isEmpty else { throw Remix3DError.failed("emptyMesh") }
    return model
  }

  // ── OBJ (+ MTL + textúrák zip-ben) ──────────────────────────────────────────

  private static func objText(_ m: ModelData, mtl: String?, textureNames: [ObjectIdentifier: String]) -> (obj: String, mtl: String) {
    var obj = "# ReMix 3D Studio\n"
    var mtlText = "# ReMix 3D Studio\n"
    if let mtl { obj += "mtllib \(mtl)\n" }
    var vBase = 1, tBase = 1, nBase = 1
    var colorCache: [ObjectIdentifier: (data: [UInt8], width: Int, height: Int)] = [:]
    for (pi, var p) in m.parts.enumerated() where !p.points {
      ensureNormals(&p)
      let hasUV = mtl != nil && p.uvs.count == p.positions.count && p.texture != nil
      // textúra nélküli részen a csúcs-szín (ha van) a „v x y z r g b" kiterjesztéssel
      let cols: [SIMD3<Float>]? = mtl == nil && p.colors.count == p.positions.count ? vertexColors(p, cache: &colorCache) : nil
      obj += "o \(safeName(p.name, pi))\n"
      for (i, v) in p.positions.enumerated() {
        if let cols {
          let c = cols[i]
          obj += "v \(v.x) \(v.y) \(v.z) \(c.x) \(c.y) \(c.z)\n"
        } else {
          obj += "v \(v.x) \(v.y) \(v.z)\n"
        }
      }
      if hasUV { for t in p.uvs { obj += "vt \(t.x) \(t.y)\n" } }
      for n in p.normals { obj += "vn \(n.x) \(n.y) \(n.z)\n" }
      if mtl != nil {
        let mname = "mat_\(pi)"
        obj += "usemtl \(mname)\n"
        mtlText += "newmtl \(mname)\nKa 0 0 0\nKd \(p.baseColor.x) \(p.baseColor.y) \(p.baseColor.z)\nKs 0 0 0\nd \(p.baseColor.w)\nillum 1\n"
        if hasUV, let t = p.texture, let file = textureNames[ObjectIdentifier(t)] { mtlText += "map_Kd \(file)\n" }
        mtlText += "\n"
      }
      var t = 0
      while t + 2 < p.indices.count {
        obj += "f"
        for k in 0..<3 {
          let i = Int(p.indices[t + k])
          obj += hasUV ? " \(vBase + i)/\(tBase + i)/\(nBase + i)" : " \(vBase + i)//\(nBase + i)"
        }
        obj += "\n"
        t += 3
      }
      vBase += p.positions.count
      if hasUV { tBase += p.uvs.count }
      nBase += p.normals.count
    }
    return (obj, mtlText)
  }

  static func writeOBJ(_ m: ModelData, to url: URL) throws {
    // egyfájlos OBJ: a szín (alapszín / textúra-minta) a „v x y z r g b" csúcs-színbe kerül
    var colored = m
    if m.hasColor {
      var cache: [ObjectIdentifier: (data: [UInt8], width: Int, height: Int)] = [:]
      for i in colored.parts.indices {
        colored.parts[i].colors = vertexColors(colored.parts[i], cache: &cache)
      }
    }
    let (obj, _) = objText(colored, mtl: nil, textureNames: [:])
    try obj.write(to: url, atomically: false, encoding: .utf8)
  }

  static func writeOBJZip(_ m: ModelData, baseName: String, to url: URL) throws {
    let base = safeFileName(baseName)
    var names: [ObjectIdentifier: String] = [:]
    var files: [(String, Data)] = []
    for p in m.parts {
      guard let t = p.texture, names[ObjectIdentifier(t)] == nil, let d = png(t) else { continue }
      let file = "\(base)_tex\(names.count).png"
      names[ObjectIdentifier(t)] = file
      files.append((file, d))
    }
    let (obj, mtl) = objText(m, mtl: "\(base).mtl", textureNames: names)
    files.insert(("\(base).mtl", Data(mtl.utf8)), at: 0)
    files.insert(("\(base).obj", Data(obj.utf8)), at: 0)
    try zipStore(files).write(to: url)
  }

  // ── PLY (bináris, csúcs-színnel) ────────────────────────────────────────────

  static func writePLY(_ m: ModelData, to url: URL) throws {
    var positions: [SIMD3<Float>] = []
    var colors: [SIMD3<Float>] = []
    var faces: [UInt32] = []
    var cache: [ObjectIdentifier: (data: [UInt8], width: Int, height: Int)] = [:]
    let colored = m.hasColor
    for p in m.parts {
      let base = UInt32(positions.count)
      positions.append(contentsOf: p.positions)
      if colored { colors.append(contentsOf: vertexColors(p, cache: &cache)) }
      if !p.points { faces.append(contentsOf: p.indices.map { $0 + base }) }
    }
    guard !positions.isEmpty else { throw Remix3DError.failed("emptyMesh") }
    var header = "ply\nformat binary_little_endian 1.0\ncomment ReMix 3D Studio\nelement vertex \(positions.count)\nproperty float x\nproperty float y\nproperty float z\n"
    if colored { header += "property uchar red\nproperty uchar green\nproperty uchar blue\n" }
    if !faces.isEmpty { header += "element face \(faces.count / 3)\nproperty list uchar int vertex_indices\n" }
    header += "end_header\n"
    var data = Data(header.utf8)
    data.reserveCapacity(header.count + positions.count * 15 + faces.count / 3 * 13)
    for (i, v) in positions.enumerated() {
      data.f32(v.x); data.f32(v.y); data.f32(v.z)
      if colored {
        let c = simd_clamp(colors[i], .zero, SIMD3<Float>(repeating: 1)) * 255
        data.append(contentsOf: [UInt8(c.x.rounded()), UInt8(c.y.rounded()), UInt8(c.z.rounded())])
      }
    }
    var t = 0
    while t + 2 < faces.count {
      data.append(3)
      data.u32(faces[t]); data.u32(faces[t + 1]); data.u32(faces[t + 2])
      t += 3
    }
    try data.write(to: url)
  }

  // ── STL (bináris; az egység az opciókból — itt NINCS skálázás) ────────────────

  static func writeSTL(_ m: ModelData, to url: URL) throws {
    let tris = m.triangleCount
    guard tris > 0 else { throw Remix3DError.failed("emptyMesh") }
    var data = Data(count: 80)
    data.reserveCapacity(84 + tris * 50)
    data.u32(UInt32(tris))
    for p in m.parts where !p.points {
      var t = 0
      while t + 2 < p.indices.count {
        let a = p.positions[Int(p.indices[t])], b = p.positions[Int(p.indices[t + 1])], c = p.positions[Int(p.indices[t + 2])]
        let n = simd_cross(b - a, c - a)
        let len = simd_length(n)
        for v in [len > 0 ? n / len : .zero, a, b, c] {
          data.f32(v.x); data.f32(v.y); data.f32(v.z)
        }
        data.append(contentsOf: [0, 0])
        t += 3
      }
    }
    try data.write(to: url)
  }

  // ── FBX 7.4 bináris (Blender / Maya / 3ds Max — a textúra beágyazva) ─────────

  final class FBXNode {
    enum Prop {
      case i16(Int16), bool(Bool), i32(Int32), f64(Double), i64(Int64), str(String), raw(Data), f64s([Double]), i32s([Int32])
    }

    let name: String
    var props: [Prop]
    var children: [FBXNode]

    init(_ name: String, _ props: [Prop] = [], _ children: [FBXNode] = []) {
      self.name = name
      self.props = props
      self.children = children
    }

    func encode(_ d: inout Data) {
      let start = d.count
      d.u32(0); d.u32(UInt32(props.count)); d.u32(0)
      let nameBytes = Array(name.utf8)
      d.append(UInt8(nameBytes.count))
      d.append(contentsOf: nameBytes)
      let ps = d.count
      for p in props {
        switch p {
        case .i16(let v): d.append(UInt8(ascii: "Y")); d.u16(UInt16(bitPattern: v))
        case .bool(let v): d.append(UInt8(ascii: "C")); d.append(v ? 1 : 0)
        case .i32(let v): d.append(UInt8(ascii: "I")); d.u32(UInt32(bitPattern: v))
        case .f64(let v): d.append(UInt8(ascii: "D")); d.f64(v)
        case .i64(let v): d.append(UInt8(ascii: "L")); d.u64(UInt64(bitPattern: v))
        case .str(let s): d.append(UInt8(ascii: "S")); let b = Array(s.utf8); d.u32(UInt32(b.count)); d.append(contentsOf: b)
        case .raw(let r): d.append(UInt8(ascii: "R")); d.u32(UInt32(r.count)); d.append(r)
        case .f64s(let a):
          d.append(UInt8(ascii: "d")); d.u32(UInt32(a.count)); d.u32(0); d.u32(UInt32(a.count * 8))
          for v in a { d.f64(v) }
        case .i32s(let a):
          d.append(UInt8(ascii: "i")); d.u32(UInt32(a.count)); d.u32(0); d.u32(UInt32(a.count * 4))
          for v in a { d.u32(UInt32(bitPattern: v)) }
        }
      }
      d.setU32(UInt32(d.count - ps), at: start + 8)
      if !children.isEmpty || props.isEmpty {
        for c in children { c.encode(&d) }
        d.append(Data(count: 13))
      }
      d.setU32(UInt32(d.count), at: start)
    }
  }

  private static func doubles(_ a: [SIMD3<Float>]) -> [Double] {
    var out = [Double](); out.reserveCapacity(a.count * 3)
    for v in a {
      out.append(Double(v.x)); out.append(Double(v.y)); out.append(Double(v.z))
    }
    return out
  }

  static func writeFBX(_ m: ModelData, to url: URL, unitCentimeters: Double = 100) throws {
    typealias N = FBXNode
    func P(_ name: String, _ type: String, _ label: String, _ flags: String, _ values: [FBXNode.Prop]) -> N {
      N("P", [.str(name), .str(type), .str(label), .str(flags)] + values)
    }
    var nextId: Int64 = 1_000_000
    func newId() -> Int64 { nextId += 1; return nextId }

    var objects: [N] = []
    var connections: [N] = []
    var textureIds: [ObjectIdentifier: Int64] = [:]
    var counts = (model: 0, geometry: 0, material: 0, texture: 0, video: 0)

    for (pi, var p) in m.parts.enumerated() where !p.points && !p.indices.isEmpty {
      ensureNormals(&p)
      let name = safeName(p.name, pi)
      let geoId = newId(), modelId = newId(), matId = newId()
      // a sokszög utolsó indexe bitenként negált (az FBX így zárja a lapot)
      var polygon = [Int32](); polygon.reserveCapacity(p.indices.count)
      var t = 0
      while t + 2 < p.indices.count {
        polygon.append(Int32(p.indices[t]))
        polygon.append(Int32(p.indices[t + 1]))
        polygon.append(~Int32(p.indices[t + 2]))
        t += 3
      }
      var geoChildren: [N] = [
        N("Vertices", [.f64s(doubles(p.positions))]),
        N("PolygonVertexIndex", [.i32s(polygon)]),
        N("GeometryVersion", [.i32(124)]),
        N("LayerElementNormal", [.i32(0)], [
          N("Version", [.i32(101)]), N("Name", [.str("")]),
          N("MappingInformationType", [.str("ByVertice")]), N("ReferenceInformationType", [.str("Direct")]),
          N("Normals", [.f64s(doubles(p.normals))]),
        ]),
      ]
      var layer: [N] = [N("Version", [.i32(100)]), N("LayerElement", [], [N("Type", [.str("LayerElementNormal")]), N("TypedIndex", [.i32(0)])])]
      let textured = p.texture != nil && p.uvs.count == p.positions.count
      if textured {
        geoChildren.append(N("LayerElementUV", [.i32(0)], [
          N("Version", [.i32(101)]), N("Name", [.str("UVMap")]),
          N("MappingInformationType", [.str("ByPolygonVertex")]), N("ReferenceInformationType", [.str("IndexToDirect")]),
          N("UV", [.f64s(p.uvs.flatMap { uv -> [Double] in [Double(uv.x), Double(uv.y)] })]),
          N("UVIndex", [.i32s(p.indices.map { Int32($0) })]),
        ]))
        layer.append(N("LayerElement", [], [N("Type", [.str("LayerElementUV")]), N("TypedIndex", [.i32(0)])]))
      }
      if p.colors.count == p.positions.count {
        geoChildren.append(N("LayerElementColor", [.i32(0)], [
          N("Version", [.i32(101)]), N("Name", [.str("Col")]),
          N("MappingInformationType", [.str("ByPolygonVertex")]), N("ReferenceInformationType", [.str("IndexToDirect")]),
          N("Colors", [.f64s(p.colors.flatMap { c -> [Double] in [Double(c.x), Double(c.y), Double(c.z), 1] })]),
          N("ColorIndex", [.i32s(p.indices.map { Int32($0) })]),
        ]))
        layer.append(N("LayerElement", [], [N("Type", [.str("LayerElementColor")]), N("TypedIndex", [.i32(0)])]))
      }
      geoChildren.append(N("LayerElementMaterial", [.i32(0)], [
        N("Version", [.i32(101)]), N("Name", [.str("")]),
        N("MappingInformationType", [.str("AllSame")]), N("ReferenceInformationType", [.str("IndexToDirect")]),
        N("Materials", [.i32s([0])]),
      ]))
      layer.append(N("LayerElement", [], [N("Type", [.str("LayerElementMaterial")]), N("TypedIndex", [.i32(0)])]))
      geoChildren.append(N("Layer", [.i32(0)], layer))
      objects.append(N("Geometry", [.i64(geoId), .str("\(name)\u{0}\u{1}Geometry"), .str("Mesh")], geoChildren))

      objects.append(N("Model", [.i64(modelId), .str("\(name)\u{0}\u{1}Model"), .str("Mesh")], [
        N("Version", [.i32(232)]),
        N("Properties70", [], [P("DefaultAttributeIndex", "int", "Integer", "", [.i32(0)])]),
        N("Shading", [.bool(true)]),
        N("Culling", [.str("CullingOff")]),
      ]))
      let bc = p.baseColor
      objects.append(N("Material", [.i64(matId), .str("mat_\(pi)\u{0}\u{1}Material"), .str("")], [
        N("Version", [.i32(102)]),
        N("ShadingModel", [.str("phong")]),
        N("MultiLayer", [.i32(0)]),
        N("Properties70", [], [
          P("DiffuseColor", "Color", "", "A", [.f64(Double(bc.x)), .f64(Double(bc.y)), .f64(Double(bc.z))]),
          P("DiffuseFactor", "Number", "", "A", [.f64(1)]),
          P("SpecularFactor", "Number", "", "A", [.f64(0)]),
          P("Opacity", "double", "Number", "", [.f64(Double(bc.w))]),
        ]),
      ]))
      counts.model += 1; counts.geometry += 1; counts.material += 1
      connections.append(N("C", [.str("OO"), .i64(modelId), .i64(0)]))
      connections.append(N("C", [.str("OO"), .i64(geoId), .i64(modelId)]))
      connections.append(N("C", [.str("OO"), .i64(matId), .i64(modelId)]))

      if textured, let tex = p.texture {
        let key = ObjectIdentifier(tex)
        var texId = textureIds[key]
        if texId == nil, let pngData = png(tex) {
          let tid = newId(), vid = newId()
          let file = "texture_\(counts.texture).png"
          objects.append(N("Video", [.i64(vid), .str("\(file)\u{0}\u{1}Video"), .str("Clip")], [
            N("Type", [.str("Clip")]),
            N("Properties70", [], [P("Path", "KString", "XRefUrl", "", [.str(file)])]),
            N("UseMipMap", [.i32(0)]),
            N("Filename", [.str(file)]),
            N("RelativeFilename", [.str(file)]),
            N("Content", [.raw(pngData)]),
          ]))
          objects.append(N("Texture", [.i64(tid), .str("\(file)\u{0}\u{1}Texture"), .str("")], [
            N("Type", [.str("TextureVideoClip")]),
            N("Version", [.i32(202)]),
            N("TextureName", [.str("\(file)\u{0}\u{1}Texture")]),
            N("Properties70", [], [P("UseMaterial", "bool", "", "", [.i32(1)])]),
            N("Media", [.str("\(file)\u{0}\u{1}Video")]),
            N("FileName", [.str(file)]),
            N("RelativeFilename", [.str(file)]),
            N("ModelUVTranslation", [.f64(0), .f64(0)]),
            N("ModelUVScaling", [.f64(1), .f64(1)]),
            N("Texture_Alpha_Source", [.str("None")]),
            N("Cropping", [.i32(0), .i32(0), .i32(0), .i32(0)]),
          ]))
          connections.append(N("C", [.str("OO"), .i64(vid), .i64(tid)]))
          counts.texture += 1; counts.video += 1
          textureIds[key] = tid
          texId = tid
        }
        if let texId {
          connections.append(N("C", [.str("OP"), .i64(texId), .i64(matId), .str("DiffuseColor")]))
        }
      }
    }
    guard counts.model > 0 else { throw Remix3DError.failed("emptyMesh") }

    func objType(_ t: String, _ n: Int) -> N { N("ObjectType", [.str(t)], [N("Count", [.i32(Int32(n))])]) }
    var defs: [N] = [N("Version", [.i32(100)]), N("Count", [.i32(Int32(counts.model + counts.geometry + counts.material + counts.texture + counts.video + 1))])]
    defs.append(objType("GlobalSettings", 1))
    defs.append(objType("Model", counts.model))
    defs.append(objType("Geometry", counts.geometry))
    defs.append(objType("Material", counts.material))
    if counts.texture > 0 {
      defs.append(objType("Texture", counts.texture))
      defs.append(objType("Video", counts.video))
    }

    let root: [N] = [
      N("FBXHeaderExtension", [], [
        N("FBXHeaderVersion", [.i32(1003)]),
        N("FBXVersion", [.i32(7400)]),
        N("Creator", [.str("ReMix 3D Studio")]),
      ]),
      N("Creator", [.str("ReMix 3D Studio")]),
      N("GlobalSettings", [], [
        N("Version", [.i32(1000)]),
        N("Properties70", [], [
          P("UpAxis", "int", "Integer", "", [.i32(1)]),
          P("UpAxisSign", "int", "Integer", "", [.i32(1)]),
          P("FrontAxis", "int", "Integer", "", [.i32(2)]),
          P("FrontAxisSign", "int", "Integer", "", [.i32(1)]),
          P("CoordAxis", "int", "Integer", "", [.i32(0)]),
          P("CoordAxisSign", "int", "Integer", "", [.i32(1)]),
          P("OriginalUpAxis", "int", "Integer", "", [.i32(1)]),
          P("OriginalUpAxisSign", "int", "Integer", "", [.i32(1)]),
          P("UnitScaleFactor", "double", "Number", "", [.f64(unitCentimeters)]),
          P("OriginalUnitScaleFactor", "double", "Number", "", [.f64(unitCentimeters)]),
        ]),
      ]),
      N("Documents", [], [N("Count", [.i32(0)])]),
      N("References", []),
      N("Definitions", [], defs),
      N("Objects", [], objects),
      N("Connections", [], connections),
    ]

    var d = Data()
    d.append(contentsOf: Array("Kaydara FBX Binary  ".utf8))
    d.append(contentsOf: [0x00, 0x1A, 0x00])
    d.u32(7400)
    for n in root { n.encode(&d) }
    d.append(Data(count: 13))
    // lábléc (a Blender / az FBX SDK formája)
    d.append(contentsOf: [0xFA, 0xBC, 0xAB, 0x09, 0xD0, 0xC8, 0xD4, 0x66, 0xB1, 0x76, 0xFB, 0x83, 0x1C, 0xF7, 0x26, 0x7E])
    d.append(Data(count: 4))
    var pad = ((d.count + 15) & ~15) - d.count
    if pad == 0 { pad = 16 }
    d.append(Data(count: pad))
    d.u32(7400)
    d.append(Data(count: 120))
    d.append(contentsOf: [0xF8, 0x5A, 0x8C, 0x6A, 0xDE, 0xF5, 0xD9, 0x7E, 0xEC, 0xE9, 0x0C, 0xE3, 0x75, 0x8F, 0x29, 0x0B])
    try d.write(to: url)
  }

  // ── ☁️ saját pontfelhő-PLY ─────────────────────────────────────────────────

  static func writePointPLY(points: [SIMD3<Float>], colors: [SIMD3<UInt8>], to url: URL) throws {
    var data = Data()
    let header = "ply\nformat binary_little_endian 1.0\ncomment ReMix 3D pointcloud\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    data.append(Data(header.utf8))
    data.reserveCapacity(header.count + points.count * 15)
    for (i, p) in points.enumerated() {
      data.f32(p.x); data.f32(p.y); data.f32(p.z)
      let col = i < colors.count ? colors[i] : SIMD3<UInt8>(200, 200, 200)
      data.append(contentsOf: [col.x, col.y, col.z])
    }
    try? FileManager.default.removeItem(at: url)
    try data.write(to: url)
  }

  /// lap nélküli, binary_little_endian, x y z [+ r g b] PLY-pontfelhő; más PLY → nil
  static func readPointPLY(_ url: URL) -> (points: [SIMD3<Float>], colors: [SIMD3<UInt8>])? {
    guard let data = try? Data(contentsOf: url),
          let end = data.range(of: Data("end_header\n".utf8)) else { return nil }
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

  // ── 🗜️ zip (STORE — tömörítés nélkül; a PNG úgyis tömör) ──────────────────────

  private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
    var c = UInt32(n)
    for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  static func crc32(_ d: Data) -> UInt32 {
    var c: UInt32 = 0xFFFF_FFFF
    d.withUnsafeBytes { raw in
      for b in raw { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
    }
    return c ^ 0xFFFF_FFFF
  }

  static func zipStore(_ files: [(String, Data)]) -> Data {
    var out = Data()
    var central = Data()
    for (name, body) in files {
      let nameBytes = Data(name.utf8)
      let crc = crc32(body)
      let offset = UInt32(out.count)
      out.u32(0x0403_4B50); out.u16(20); out.u16(0x0800); out.u16(0); out.u16(0); out.u16(0x21)
      out.u32(crc); out.u32(UInt32(body.count)); out.u32(UInt32(body.count))
      out.u16(UInt16(nameBytes.count)); out.u16(0)
      out.append(nameBytes); out.append(body)
      central.u32(0x0201_4B50); central.u16(20); central.u16(20); central.u16(0x0800); central.u16(0); central.u16(0); central.u16(0x21)
      central.u32(crc); central.u32(UInt32(body.count)); central.u32(UInt32(body.count))
      central.u16(UInt16(nameBytes.count)); central.u16(0); central.u16(0); central.u16(0); central.u16(0)
      central.u32(0); central.u32(offset)
      central.append(nameBytes)
    }
    let cdOffset = UInt32(out.count)
    out.append(central)
    out.u32(0x0605_4B50); out.u16(0); out.u16(0)
    out.u16(UInt16(files.count)); out.u16(UInt16(files.count))
    out.u32(UInt32(central.count)); out.u32(cdOffset); out.u16(0)
    return out
  }

  // ── nevek ─────────────────────────────────────────────────────────────────

  static func safeName(_ s: String, _ i: Int) -> String {
    let cleaned = s.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-" ? Character($0) : "_" }
    let r = String(cleaned).trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    return r.isEmpty ? "part_\(i)" : r
  }

  static func safeFileName(_ s: String) -> String {
    let r = s.replacingOccurrences(of: "[\\\\/:*?\"<>|\\s]+", with: "_", options: .regularExpression)
    return r.isEmpty ? "model" : r
  }
}

// ── bájt-segédek (little-endian) ─────────────────────────────────────────────

extension Data {
  mutating func u16(_ v: UInt16) { var le = v.littleEndian; Swift.withUnsafeBytes(of: &le) { append(contentsOf: $0) } }
  mutating func u32(_ v: UInt32) { var le = v.littleEndian; Swift.withUnsafeBytes(of: &le) { append(contentsOf: $0) } }
  mutating func u64(_ v: UInt64) { var le = v.littleEndian; Swift.withUnsafeBytes(of: &le) { append(contentsOf: $0) } }
  mutating func f32(_ v: Float) { u32(v.bitPattern) }
  mutating func f64(_ v: Double) { u64(v.bitPattern) }

  mutating func setU32(_ v: UInt32, at offset: Int) {
    var le = v.littleEndian
    Swift.withUnsafeBytes(of: &le) { replaceSubrange(offset..<(offset + 4), with: $0) }
  }

  func u32(at offset: Int) -> UInt32 {
    withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self).littleEndian }
  }
}
