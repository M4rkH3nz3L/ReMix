import Compression
import CoreGraphics
import Foundation
import simd

// 📥 3D-import a KÉSZÜLÉKEN: bináris FBX (Blender / Maya / 3ds Max / Unity) és zip-csomag
// (OBJ + MTL + textúrák, vagy bármely más modell zip-ben). UIKit-mentes → macOS-en is
// tesztelhető. A GLB/glTF a `Remix3DFormats`-ban, a USDZ/OBJ/PLY/STL a ModelIO-n át megy.

extension Remix3DFormats {
  // ── FBX (bináris, 7.x) ──────────────────────────────────────────────────────

  final class FBXRecord {
    enum Value {
      case int(Int64), double(Double), string(String), raw(Data), ints([Int64]), doubles([Double])
    }

    let name: String
    var props: [Value] = []
    var children: [FBXRecord] = []
    init(name: String) { self.name = name }

    func child(_ n: String) -> FBXRecord? { children.first { $0.name == n } }
    func all(_ n: String) -> [FBXRecord] { children.filter { $0.name == n } }

    var int: Int64? { if case .int(let v)? = props.first { return v }; return nil }
    var string: String? { if case .string(let v)? = props.first { return v }; return nil }
    var doubles: [Double] {
      switch props.first {
      case .doubles(let a)?: return a
      case .ints(let a)?: return a.map(Double.init)
      default: return []
      }
    }
    var ints: [Int64] {
      switch props.first {
      case .ints(let a)?: return a
      case .doubles(let a)?: return a.map { Int64($0) }
      default: return []
      }
    }

    /// Properties70 „P" bejegyzés értékei név szerint (a 4. utáni elemek)
    func p70(_ prop: String) -> [Double]? {
      guard let p70 = child("Properties70") else { return nil }
      for p in p70.all("P") {
        guard case .string(let n)? = p.props.first, n == prop else { continue }
        return p.props.dropFirst(4).compactMap {
          switch $0 {
          case .double(let d): return d
          case .int(let i): return Double(i)
          default: return nil
          }
        }
      }
      return nil
    }
  }

  /// DEFLATE (zlib-fejléccel) → nyers bájtok; `expected` a várt méret
  static func inflate(_ data: Data, expected: Int, zlibHeader: Bool = true) -> Data? {
    let body = zlibHeader && data.count > 2 ? data.subdata(in: 2..<data.count) : data
    var out = Data(count: max(expected, 1))
    let n = out.withUnsafeMutableBytes { dst -> Int in
      body.withUnsafeBytes { src -> Int in
        guard let d = dst.bindMemory(to: UInt8.self).baseAddress,
              let s = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
        return compression_decode_buffer(d, expected, s, body.count, nil, COMPRESSION_ZLIB)
      }
    }
    guard n == expected else { return nil }
    return out.prefix(n)
  }

  static func parseFBX(_ data: Data) throws -> [FBXRecord] {
    guard data.count > 27, String(data: data.prefix(18), encoding: .ascii) == "Kaydara FBX Binary" else {
      // az ASCII FBX-et a Blender sem olvassa → érthető hiba
      throw Remix3DError.unsupported("import:fbxAscii")
    }
    let version = Int(data.u32(at: 23))
    let wide = version >= 7500
    var pos = 27

    func u32() -> UInt32 { defer { pos += 4 }; return data.u32(at: pos) }
    func u64() -> UInt64 { defer { pos += 8 }; return data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: pos, as: UInt64.self).littleEndian } }
    func off() -> Int { wide ? Int(u64()) : Int(u32()) }

    func readArray<T>(_ size: Int, _ conv: (UnsafeRawBufferPointer, Int) -> T) throws -> [T] {
      let count = Int(u32()), enc = u32(), clen = Int(u32())
      guard pos + clen <= data.count else { throw Remix3DError.badInput("fbx") }
      let raw = data.subdata(in: pos..<(pos + clen))
      pos += clen
      let bytes: Data
      if enc == 1 {
        guard let inflated = inflate(raw, expected: count * size) else { throw Remix3DError.badInput("fbx:zlib") }
        bytes = inflated
      } else {
        bytes = raw
      }
      guard bytes.count >= count * size else { throw Remix3DError.badInput("fbx") }
      return bytes.withUnsafeBytes { b in (0..<count).map { conv(b, $0 * size) } }
    }

    func readNode() throws -> FBXRecord? {
      let end = off(), numProps = off()
      _ = off() // propListLen
      let nameLen = Int(data[pos]); pos += 1
      let name = String(data: data.subdata(in: pos..<(pos + nameLen)), encoding: .utf8) ?? ""
      pos += nameLen
      if end == 0 { return nil } // null-rekord
      let rec = FBXRecord(name: name)
      for _ in 0..<numProps {
        let code = data[pos]; pos += 1
        switch code {
        case UInt8(ascii: "Y"): rec.props.append(.int(Int64(Int16(bitPattern: UInt16(data[pos]) | UInt16(data[pos + 1]) << 8)))); pos += 2
        case UInt8(ascii: "C"): rec.props.append(.int(Int64(data[pos]))); pos += 1
        case UInt8(ascii: "I"): rec.props.append(.int(Int64(Int32(bitPattern: u32()))))
        case UInt8(ascii: "F"): rec.props.append(.double(Double(Float(bitPattern: u32()))))
        case UInt8(ascii: "D"): rec.props.append(.double(Double(bitPattern: u64())))
        case UInt8(ascii: "L"): rec.props.append(.int(Int64(bitPattern: u64())))
        case UInt8(ascii: "S"), UInt8(ascii: "R"):
          let len = Int(u32())
          let bytes = data.subdata(in: pos..<(pos + len)); pos += len
          rec.props.append(code == UInt8(ascii: "S") ? .string(String(decoding: bytes, as: UTF8.self)) : .raw(bytes))
        case UInt8(ascii: "d"): rec.props.append(.doubles(try readArray(8) { b, o in Double(bitPattern: b.loadUnaligned(fromByteOffset: o, as: UInt64.self).littleEndian) }))
        case UInt8(ascii: "f"): rec.props.append(.doubles(try readArray(4) { b, o in Double(Float(bitPattern: b.loadUnaligned(fromByteOffset: o, as: UInt32.self).littleEndian)) }))
        case UInt8(ascii: "i"): rec.props.append(.ints(try readArray(4) { b, o in Int64(Int32(bitPattern: b.loadUnaligned(fromByteOffset: o, as: UInt32.self).littleEndian)) }))
        case UInt8(ascii: "l"): rec.props.append(.ints(try readArray(8) { b, o in Int64(bitPattern: b.loadUnaligned(fromByteOffset: o, as: UInt64.self).littleEndian) }))
        case UInt8(ascii: "b"): rec.props.append(.ints(try readArray(1) { b, o in Int64(b[o]) }))
        default: throw Remix3DError.badInput("fbx:prop")
        }
      }
      while pos < end {
        if let c = try readNode() { rec.children.append(c) } else { break }
      }
      pos = end
      return rec
    }

    var roots: [FBXRecord] = []
    while pos < data.count - 13 {
      guard let n = try readNode() else { break }
      roots.append(n)
    }
    return roots
  }

  static func readFBX(_ url: URL) throws -> ModelData {
    let roots = try parseFBX(try Data(contentsOf: url))
    guard let objects = roots.first(where: { $0.name == "Objects" }) else { throw Remix3DError.badInput("fbx") }
    let globals = roots.first { $0.name == "GlobalSettings" }
    // egység: UnitScaleFactor = cm / egység → méter
    let unitToMeters = Float((globals?.p70("UnitScaleFactor")?.first ?? 1) / 100)
    let upAxis = Int(globals?.p70("UpAxis")?.first ?? 1)

    var byId: [Int64: FBXRecord] = [:]
    for o in objects.children { if let id = o.int { byId[id] = o } }
    // kapcsolatok: gyerek → szülők (sorrendben)
    var parents: [Int64: [Int64]] = [:]
    var childrenOf: [Int64: [Int64]] = [:]
    var texSlot: [Int64: Int64] = [:] // textúra → anyag (DiffuseColor / BaseColor)
    for c in roots.first(where: { $0.name == "Connections" })?.all("C") ?? [] {
      guard c.props.count >= 3, case .string(let kind) = c.props[0],
            case .int(let child) = c.props[1], case .int(let parent) = c.props[2] else { continue }
      parents[child, default: []].append(parent)
      childrenOf[parent, default: []].append(child)
      if kind == "OP", c.props.count >= 4, case .string(let slot) = c.props[3],
         slot.contains("Diffuse") || slot.contains("BaseColor") || slot.contains("Base Color") {
        texSlot[child] = parent
      }
    }

    func euler(_ d: [Double]) -> simd_quatf {
      guard d.count >= 3 else { return simd_quatf(ix: 0, iy: 0, iz: 0, r: 1) }
      let r = d.map { Float($0) * .pi / 180 }
      // FBX alap (eEulerXYZ): előbb X, majd Y, majd Z → q = qz · qy · qx
      return simd_quatf(angle: r[2], axis: [0, 0, 1]) * simd_quatf(angle: r[1], axis: [0, 1, 0]) * simd_quatf(angle: r[0], axis: [1, 0, 0])
    }
    func localMatrix(_ m: FBXRecord) -> simd_float4x4 {
      let t = m.p70("Lcl Translation") ?? [0, 0, 0]
      let s = m.p70("Lcl Scaling") ?? [1, 1, 1]
      let rot = euler(m.p70("PreRotation") ?? [0, 0, 0]) * euler(m.p70("Lcl Rotation") ?? [0, 0, 0])
      var T = matrix_identity_float4x4
      T.columns.3 = SIMD4(Float(t[0]), Float(t[1]), Float(t[2]), 1)
      let S = simd_float4x4(diagonal: SIMD4(Float(s[0]), Float(s[1]), Float(s[2]), 1))
      return T * simd_float4x4(rot) * S
    }
    func worldMatrix(_ modelId: Int64, depth: Int = 0) -> simd_float4x4 {
      guard let m = byId[modelId], depth < 64 else { return matrix_identity_float4x4 }
      let parent = (parents[modelId] ?? []).first { byId[$0]?.name == "Model" }
      let local = localMatrix(m)
      return parent.map { worldMatrix($0, depth: depth + 1) * local } ?? local
    }
    var imageCache: [Int64: CGImage] = [:]
    func textureImage(forMaterial mat: Int64) -> CGImage? {
      guard let texId = texSlot.first(where: { $0.value == mat })?.key else { return nil }
      if let c = imageCache[texId] { return c }
      for vid in childrenOf[texId] ?? [] {
        guard let video = byId[vid], video.name == "Video" else { continue }
        if case .raw(let bytes)? = video.child("Content")?.props.first, bytes.count > 0, let img = decodeImage(bytes) {
          imageCache[texId] = img
          return img
        }
      }
      // külső fájl a modell mellett
      if let tex = byId[texId] {
        for key in ["RelativeFilename", "FileName"] {
          if let name = tex.child(key)?.string, !name.isEmpty {
            let file = url.deletingLastPathComponent().appendingPathComponent((name as NSString).lastPathComponent)
            if let d = try? Data(contentsOf: file), let img = decodeImage(d) {
              imageCache[texId] = img
              return img
            }
          }
        }
      }
      return nil
    }

    /// a Model-csomópont neve (a binárisban „név\0\1Model")
    func modelName(_ id: Int64?) -> String {
      guard let id, let m = byId[id], m.props.count > 1, case .string(let full) = m.props[1] else { return "fbx" }
      let n = full.components(separatedBy: "\u{0}").first ?? ""
      return n.isEmpty ? "fbx" : n
    }

    var model = ModelData()
    for (geoId, geo) in byId where geo.name == "Geometry" {
      guard case .string(let kind)? = geo.props.last, kind == "Mesh",
            let verts = geo.child("Vertices")?.doubles, !verts.isEmpty,
            let poly = geo.child("PolygonVertexIndex")?.ints, !poly.isEmpty else { continue }
      let modelIds = (parents[geoId] ?? []).filter { byId[$0]?.name == "Model" }
      let owner = modelIds.first
      var world = owner.map { worldMatrix($0) } ?? matrix_identity_float4x4
      let unit = simd_float4x4(diagonal: SIMD4(unitToMeters, unitToMeters, unitToMeters, 1))
      var axis = matrix_identity_float4x4
      if upAxis == 2 { axis = simd_float4x4(simd_quatf(angle: -.pi / 2, axis: [1, 0, 0])) }
      world = axis * unit * world
      let m3 = simd_float3x3(
        SIMD3(world.columns.0.x, world.columns.0.y, world.columns.0.z),
        SIMD3(world.columns.1.x, world.columns.1.y, world.columns.1.z),
        SIMD3(world.columns.2.x, world.columns.2.y, world.columns.2.z))
      let nm = m3.determinant != 0 ? m3.inverse.transpose : m3

      // rétegek
      let normLayer = geo.child("LayerElementNormal")
      let normals = normLayer?.child("Normals")?.doubles ?? []
      let normIdx = normLayer?.child("NormalsIndex")?.ints ?? []
      let normMap = normLayer?.child("MappingInformationType")?.string ?? ""
      let uvLayer = geo.child("LayerElementUV")
      let uvs = uvLayer?.child("UV")?.doubles ?? []
      let uvIdx = uvLayer?.child("UVIndex")?.ints ?? []
      let uvMap = uvLayer?.child("MappingInformationType")?.string ?? ""
      let matLayer = geo.child("LayerElementMaterial")
      let matIndices = matLayer?.child("Materials")?.ints ?? []
      let matAllSame = (matLayer?.child("MappingInformationType")?.string ?? "AllSame") == "AllSame"
      let materials = (owner.map { childrenOf[$0] ?? [] } ?? []).filter { byId[$0]?.name == "Material" }

      // anyagonként egy rész; a csúcsok (pozíció, UV) szerint deduplikálva
      struct Key: Hashable { let p: Int64; let u: Int64 }
      var parts: [Int: (ModelPart, [Key: UInt32])] = [:]
      var corner = 0
      var polyIndex = 0
      var polyStart = 0
      var cornerKeys: [(Key, SIMD3<Float>, SIMD2<Float>?, SIMD3<Float>?)] = []
      func flush() {
        let mi = matAllSame ? 0 : Int(polyIndex < matIndices.count ? matIndices[polyIndex] : 0)
        if parts[mi] == nil {
          var part = ModelPart(name: modelName(owner))
          if mi < materials.count, let mat = byId[materials[mi]] {
            if let c = mat.p70("DiffuseColor") ?? mat.p70("Diffuse"), c.count >= 3 {
              part.baseColor = SIMD4(Float(c[0]), Float(c[1]), Float(c[2]), 1)
            }
            part.texture = textureImage(forMaterial: materials[mi])
            if part.texture != nil { part.baseColor = SIMD4(1, 1, 1, 1) }
          }
          parts[mi] = (part, [:])
        }
        var entry = parts[mi]!
        var local: [UInt32] = []
        for (key, p, uv, n) in cornerKeys {
          if let k = entry.1[key] { local.append(k); continue }
          let k = UInt32(entry.0.positions.count)
          entry.1[key] = k
          entry.0.positions.append(p)
          if let uv { entry.0.uvs.append(uv) }
          if let n { entry.0.normals.append(n) }
          local.append(k)
        }
        // sokszög → háromszög-legyező
        if local.count >= 3 {
          for i in 1..<(local.count - 1) { entry.0.indices.append(contentsOf: [local[0], local[i], local[i + 1]]) }
        }
        parts[mi] = entry
        cornerKeys.removeAll(keepingCapacity: true)
        polyIndex += 1
        polyStart = corner
      }
      _ = polyStart
      for raw in poly {
        let last = raw < 0
        let vi = Int(last ? ~raw : raw)
        guard vi * 3 + 2 < verts.count else { corner += 1; if last { flush() }; continue }
        let w = world * SIMD4(Float(verts[vi * 3]), Float(verts[vi * 3 + 1]), Float(verts[vi * 3 + 2]), 1)
        var uvKey: Int64 = -1
        var uv: SIMD2<Float>?
        if !uvs.isEmpty {
          let base = uvMap.hasPrefix("ByPolygonVertex") ? corner : vi
          let ui = uvIdx.isEmpty ? base : (base < uvIdx.count ? Int(uvIdx[base]) : -1)
          if ui >= 0, ui * 2 + 1 < uvs.count {
            uvKey = Int64(ui)
            uv = SIMD2(Float(uvs[ui * 2]), Float(uvs[ui * 2 + 1]))
          }
        }
        var n: SIMD3<Float>?
        if !normals.isEmpty {
          let base = normMap.hasPrefix("ByPolygonVertex") ? corner : vi
          let ni = normIdx.isEmpty ? base : (base < normIdx.count ? Int(normIdx[base]) : -1)
          if ni >= 0, ni * 3 + 2 < normals.count {
            let v = nm * SIMD3(Float(normals[ni * 3]), Float(normals[ni * 3 + 1]), Float(normals[ni * 3 + 2]))
            n = simd_length(v) > 0 ? simd_normalize(v) : nil
          }
        }
        cornerKeys.append((Key(p: Int64(vi), u: uvKey), SIMD3(w.x, w.y, w.z), uv, n))
        corner += 1
        if last { flush() }
      }
      for (_, entry) in parts.sorted(by: { $0.key < $1.key }) {
        var part = entry.0
        if part.uvs.count != part.positions.count { part.uvs = []; part.texture = nil }
        if part.normals.count != part.positions.count { part.normals = [] }
        if !part.indices.isEmpty { model.parts.append(part) }
      }
    }
    guard !model.parts.isEmpty else { throw Remix3DError.failed("emptyMesh") }
    return model
  }

  // ── 🗜️ zip-csomag (STORE + DEFLATE) ─────────────────────────────────────────

  /// a zip kicsomagolása egy ideiglenes mappába → a benne lévő modell beolvasása
  /// (prioritás: GLB › glTF › FBX › USDZ › OBJ › PLY › STL); az OBJ a mellette lévő
  /// MTL-t és textúrákat is megtalálja
  static func readZip(_ url: URL) throws -> ModelData {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("remix3d_zip_\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let files = try unzip(try Data(contentsOf: url), to: dir)
    let order = ["glb", "gltf", "fbx", "usdz", "usdc", "usda", "usd", "obj", "ply", "stl"]
    for ext in order {
      if let f = files.first(where: { $0.pathExtension.lowercased() == ext && !$0.lastPathComponent.hasPrefix(".") && !$0.path.contains("__MACOSX") }) {
        return try load(f)
      }
    }
    throw Remix3DError.unsupported("import:zipNoModel")
  }

  static func unzip(_ data: Data, to dir: URL) throws -> [URL] {
    // a központi könyvtár vége (EOCD)
    var eocd = -1
    var i = data.count - 22
    while i >= max(0, data.count - 65_557) {
      if data.u32(at: i) == 0x0605_4B50 { eocd = i; break }
      i -= 1
    }
    guard eocd >= 0 else { throw Remix3DError.badInput("zip") }
    let u16 = { (o: Int) -> Int in Int(data[o]) | Int(data[o + 1]) << 8 }
    let count = u16(eocd + 10)
    var p = Int(data.u32(at: eocd + 16))
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var out: [URL] = []
    var total = 0
    for _ in 0..<count {
      guard p + 46 <= data.count, data.u32(at: p) == 0x0201_4B50 else { throw Remix3DError.badInput("zip") }
      let method = u16(p + 10)
      let csize = Int(data.u32(at: p + 20)), usize = Int(data.u32(at: p + 24))
      let nlen = u16(p + 28), elen = u16(p + 30), clen = u16(p + 32)
      let local = Int(data.u32(at: p + 42))
      let name = String(decoding: data.subdata(in: (p + 46)..<(p + 46 + nlen)), as: UTF8.self)
      p += 46 + nlen + elen + clen
      if name.hasSuffix("/") { continue }
      // zip-bomba / útvonal-kiszökés elleni védelem
      total += usize
      guard total < 1_500_000_000, !name.contains("..") else { throw Remix3DError.badInput("zip") }
      let lnlen = u16(local + 26), lelen = u16(local + 28)
      let start = local + 30 + lnlen + lelen
      guard start + csize <= data.count else { throw Remix3DError.badInput("zip") }
      let raw = data.subdata(in: start..<(start + csize))
      let body: Data
      switch method {
      case 0: body = raw
      case 8:
        guard let d = inflate(raw, expected: usize, zlibHeader: false) else { throw Remix3DError.badInput("zip:deflate") }
        body = d
      default: continue
      }
      let target = dir.appendingPathComponent(name)
      try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      try body.write(to: target)
      out.append(target)
    }
    return out
  }
}
