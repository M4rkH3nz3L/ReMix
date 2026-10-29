import CoreGraphics
import Foundation
import ModelIO
import SceneKit
import SceneKit.ModelIO
import simd

// 🧊→🎬 A semleges `ModelData` SceneKit/ModelIO-oldala: a néző a GLB-t (és minden saját
// formát) ezen át tölti be, és ezen át készül a USDZ / USD kivitel. UIKit-mentes (macOS-en
// is renderelhető → a megjelenés ellenőrizhető a telefon nélkül).

extension Remix3DFormats {
  /// a háromszöges részek → ModelIO-asset (anyaggal: alapszín vagy beágyazott textúra)
  static func mdlAsset(_ m: ModelData) -> MDLAsset {
    let alloc = MDLMeshBufferDataAllocator()
    let asset = MDLAsset(bufferAllocator: alloc)
    var textureCache: [ObjectIdentifier: MDLTexture] = [:]
    for (pi, var p) in m.parts.enumerated() where !p.points && !p.indices.isEmpty {
      ensureNormals(&p)
      let desc = MDLVertexDescriptor()
      var buffers: [MDLMeshBuffer] = []
      func attribute<T>(_ name: String, _ format: MDLVertexFormat, _ values: [T]) {
        let i = buffers.count
        desc.attributes[i] = MDLVertexAttribute(name: name, format: format, offset: 0, bufferIndex: i)
        desc.layouts[i] = MDLVertexBufferLayout(stride: MemoryLayout<T>.stride)
        buffers.append(alloc.newBuffer(with: values.withUnsafeBufferPointer { Data(buffer: $0) }, type: .vertex))
      }
      attribute(MDLVertexAttributePosition, .float3, p.positions)
      attribute(MDLVertexAttributeNormal, .float3, p.normals)
      let textured = p.texture != nil && p.uvs.count == p.positions.count
      if textured {
        attribute(MDLVertexAttributeTextureCoordinate, .float2, p.uvs)
      }
      if p.colors.count == p.positions.count {
        attribute(MDLVertexAttributeColor, .float3, p.colors)
      }
      let material = MDLMaterial(name: safeName(p.name, pi), scatteringFunction: MDLPhysicallyPlausibleScatteringFunction())
      if textured, let img = p.texture {
        let key = ObjectIdentifier(img)
        let tex = textureCache[key] ?? {
          let px = rgba(img)
          return MDLTexture(
            data: Data(px.data),
            topLeftOrigin: true,
            name: "baseColor_\(textureCache.count)",
            dimensions: vector_int2(Int32(px.width), Int32(px.height)),
            rowStride: px.width * 4,
            channelCount: 4,
            channelEncoding: .uInt8,
            isCube: false
          )
        }()
        textureCache[key] = tex
        let sampler = MDLTextureSampler()
        sampler.texture = tex
        material.setProperty(MDLMaterialProperty(name: "baseColor", semantic: .baseColor, textureSampler: sampler))
      } else {
        material.setProperty(MDLMaterialProperty(name: "baseColor", semantic: .baseColor, float3: SIMD3<Float>(p.baseColor.x, p.baseColor.y, p.baseColor.z)))
      }
      material.setProperty(MDLMaterialProperty(name: "roughness", semantic: .roughness, float: 1))
      material.setProperty(MDLMaterialProperty(name: "metallic", semantic: .metallic, float: 0))
      let ib = alloc.newBuffer(with: p.indices.withUnsafeBufferPointer { Data(buffer: $0) }, type: .index)
      let sub = MDLSubmesh(indexBuffer: ib, indexCount: p.indices.count, indexType: .uInt32, geometryType: .triangles, material: material)
      let mesh = MDLMesh(vertexBuffers: buffers, vertexCount: p.positions.count, descriptor: desc, submeshes: [sub])
      mesh.name = safeName(p.name, pi)
      asset.add(mesh)
    }
    return asset
  }

  /// pontfelhő-csomópont (állandó megvilágítás, képernyő-méretkorlátos pontok)
  static func pointNode(points: [SIMD3<Float>], colors: [SIMD3<Float>]) -> SCNNode {
    let vertices = SCNGeometrySource(vertices: points.map { SCNVector3($0.x, $0.y, $0.z) })
    var sources = [vertices]
    if colors.count == points.count {
      let rgba = colors.map { SIMD4<Float>($0.x, $0.y, $0.z, 1) }
      sources.append(SCNGeometrySource(
        data: rgba.withUnsafeBufferPointer { Data(buffer: $0) },
        semantic: .color,
        vectorCount: rgba.count,
        usesFloatComponents: true,
        componentsPerVector: 4,
        bytesPerComponent: MemoryLayout<Float>.size,
        dataOffset: 0,
        dataStride: MemoryLayout<SIMD4<Float>>.stride
      ))
    }
    let element = SCNGeometryElement(indices: (0..<UInt32(points.count)).map { $0 }, primitiveType: .point)
    element.pointSize = 0.006
    element.minimumPointScreenSpaceRadius = 1.5
    element.maximumPointScreenSpaceRadius = 6
    let geometry = SCNGeometry(sources: sources, elements: [element])
    geometry.firstMaterial?.lightingModel = .constant
    return SCNNode(geometry: geometry)
  }

  /// a teljes modell jelenetként (háromszögek a ModelIO-n át + pontfelhő-részek)
  static func scene(_ m: ModelData) -> SCNScene {
    let tris = ModelData(parts: m.parts.filter { !$0.points }, plain: m.plain)
    let scene = tris.parts.isEmpty ? SCNScene() : SCNScene(mdlAsset: mdlAsset(tris))
    for p in m.parts where p.points {
      scene.rootNode.addChildNode(pointNode(points: p.positions, colors: p.colors))
    }
    return scene
  }

  /// USDZ (SceneKit — a textúra beágyazva) vagy USD/USDC/USDA (ModelIO, ha az eszköz tudja)
  static func writeUSD(_ m: ModelData, ext: String, to url: URL) throws {
    guard !m.isPoints else { throw Remix3DError.unsupported("export:\(ext)") }
    try? FileManager.default.removeItem(at: url)
    if ext == "usdz" {
      guard scene(m).write(to: url, options: nil, delegate: nil, progressHandler: nil) else {
        throw Remix3DError.failed("usdzWrite")
      }
      return
    }
    guard MDLAsset.canExportFileExtension(ext) else { throw Remix3DError.unsupported("export:\(ext)") }
    try mdlAsset(m).export(to: url)
  }
}
