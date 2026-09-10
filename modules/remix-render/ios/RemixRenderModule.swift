import ExpoModulesCore
import AVFoundation
import CoreMedia
import UIKit

// Eszközön futó videó-render AVFoundation-nel — a Remix ingyenes export-útja.
//
// A JS (`src/lib/nativeRender.ts`) egy render-tervet ad JSON-ként; itt
// AVMutableComposition + AVMutableVideoComposition épül belőle, majd
// AVAssetExportSession renderel H.264 MP4-et a megadott kimeneti útra.
//
// A v1 a rövidvideó gyakori esetét fedi le KORREKTEN: a videó-szegmensek
// egymás után (vágással + sebességgel) egy fix vászonra (aspect-fill),
// a szegmensek saját hangja + a külön hang-szegmensek keverve. A fejlett
// effektek (fejlett átmenetek, 3D, AI-szűrők) továbbra is a felhő-render sajátjai.

struct RenderVideoSegment: Codable {
  let uri: String
  let atSec: Double
  let inSec: Double
  let durationSec: Double
  let speed: Double
  let volume: Double
  let filter: String
}

struct RenderAudioSegment: Codable {
  let uri: String
  let atSec: Double
  let inSec: Double
  let durationSec: Double
  let volume: Double
}

struct RenderPlan: Codable {
  let width: Int
  let height: Int
  let fps: Int
  let background: String
  let video: [RenderVideoSegment]
  let audio: [RenderAudioSegment]
}

enum RenderError: Error, LocalizedError {
  case badPlan
  case noVideo
  case noTracks(String)
  case exportFailed(String)

  var errorDescription: String? {
    switch self {
    case .badPlan: return "Érvénytelen render-terv."
    case .noVideo: return "Nincs helyi videóklip az eszközön-renderhez."
    case .noTracks(let s): return "A forrás nem tartalmaz sávot: \(s)"
    case .exportFailed(let s): return "Az export nem sikerült: \(s)"
    }
  }
}

public class RemixRenderModule: Module {
  private var progressTimer: Timer?

  public func definition() -> ModuleDefinition {
    Name("RemixRender")

    Events("onProgress")

    AsyncFunction("exportPlan") { (planJson: String, outputPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try self.render(planJson: planJson, outputPath: outputPath)
          DispatchQueue.main.async { promise.resolve(url) }
        } catch {
          DispatchQueue.main.async { promise.reject("ERR_RENDER", error.localizedDescription) }
        }
      }
    }
  }

  private func fileURL(_ uri: String) -> URL {
    if uri.hasPrefix("file://") { return URL(string: uri)! }
    return URL(fileURLWithPath: uri)
  }

  private func render(planJson: String, outputPath: String) throws -> String {
    guard let data = planJson.data(using: .utf8),
          let plan = try? JSONDecoder().decode(RenderPlan.self, from: data) else {
      throw RenderError.badPlan
    }
    if plan.video.isEmpty { throw RenderError.noVideo }

    let composition = AVMutableComposition()
    guard let compVideo = composition.addMutableTrack(
      withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let compAudio = composition.addMutableTrack(
        withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      throw RenderError.noTracks("composition")
    }

    let fps = max(1, plan.fps)
    let timescale = CMTimeScale(600)
    let renderSize = CGSize(width: plan.width, height: plan.height)

    var instructions: [AVMutableVideoCompositionInstruction] = []
    var cursor = CMTime.zero // a videó-idővonal aktuális vége (egymás után fűzünk)

    for seg in plan.video {
      let asset = AVURLAsset(url: fileURL(seg.uri))
      guard let srcVideo = asset.tracks(withMediaType: .video).first else { continue }

      let speed = seg.speed > 0 ? seg.speed : 1.0
      let sourceConsumed = seg.durationSec * speed
      let start = CMTime(seconds: max(0, seg.inSec), preferredTimescale: timescale)
      let srcRange = CMTimeRange(
        start: start,
        duration: CMTime(seconds: sourceConsumed, preferredTimescale: timescale))

      let insertAt = cursor
      do {
        try compVideo.insertTimeRange(srcRange, of: srcVideo, at: insertAt)
      } catch {
        continue
      }
      // a beszúrt szegmens saját hangja (ha van), azonos időzítéssel
      if let srcAudio = asset.tracks(withMediaType: .audio).first {
        try? compAudio.insertTimeRange(srcRange, of: srcAudio, at: insertAt)
      }

      // sebesség: a beszúrt tartományt a kívánt idővonal-hosszra skálázzuk
      let targetDur = CMTime(seconds: seg.durationSec, preferredTimescale: timescale)
      if abs(speed - 1.0) > 0.001 {
        let insertedRange = CMTimeRange(start: insertAt, duration: srcRange.duration)
        compVideo.scaleTimeRange(insertedRange, toDuration: targetDur)
        compAudio.scaleTimeRange(insertedRange, toDuration: targetDur)
      }

      // réteg-utasítás: a forrást a vászonra igazítjuk (aspect-fill, középre)
      let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: compVideo)
      let transform = self.aspectFillTransform(
        natural: srcVideo.naturalSize,
        preferred: srcVideo.preferredTransform,
        canvas: renderSize)
      layer.setTransform(transform, at: insertAt)

      let inst = AVMutableVideoCompositionInstruction()
      inst.timeRange = CMTimeRange(start: insertAt, duration: targetDur)
      inst.layerInstructions = [layer]
      instructions.append(inst)

      cursor = CMTimeAdd(insertAt, targetDur)
    }

    if cursor == .zero { throw RenderError.noVideo }

    // külön hang-szegmensek (zene/voiceover/SFX) — az abszolút idejükre helyezve
    for seg in plan.audio {
      let asset = AVURLAsset(url: fileURL(seg.uri))
      guard let srcAudio = asset.tracks(withMediaType: .audio).first else { continue }
      guard let extra = composition.addMutableTrack(
        withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
      let srcRange = CMTimeRange(
        start: CMTime(seconds: max(0, seg.inSec), preferredTimescale: timescale),
        duration: CMTime(seconds: seg.durationSec, preferredTimescale: timescale))
      let at = CMTime(seconds: max(0, seg.atSec), preferredTimescale: timescale)
      try? extra.insertTimeRange(srcRange, of: srcAudio, at: at)
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
    videoComposition.instructions = instructions

    // kimenet
    let outURL = self.fileURL(outputPath)
    try? FileManager.default.removeItem(at: outURL)

    guard let export = AVAssetExportSession(
      asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw RenderError.exportFailed("nincs export-session")
    }
    export.outputURL = outURL
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true
    export.videoComposition = videoComposition

    // progressz-jelzés (0–1) a JS felé
    DispatchQueue.main.async {
      self.progressTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
        self.sendEvent("onProgress", ["progress": Double(export.progress)])
      }
    }

    let sema = DispatchSemaphore(value: 0)
    export.exportAsynchronously { sema.signal() }
    sema.wait()

    DispatchQueue.main.async {
      self.progressTimer?.invalidate()
      self.progressTimer = nil
      self.sendEvent("onProgress", ["progress": 1.0])
    }

    if export.status != .completed {
      throw RenderError.exportFailed(export.error?.localizedDescription ?? "ismeretlen")
    }
    return outURL.absoluteString
  }

  // A forrást a vászonra tölti (aspect-fill), a preferredTransform (forgatás)
  // figyelembevételével, középre igazítva.
  private func aspectFillTransform(
    natural: CGSize, preferred: CGAffineTransform, canvas: CGSize
  ) -> CGAffineTransform {
    // a forgatás utáni tényleges méret
    let rotated = natural.applying(CGAffineTransform(
      a: preferred.a, b: preferred.b, c: preferred.c, d: preferred.d, tx: 0, ty: 0))
    let w = abs(rotated.width)
    let h = abs(rotated.height)
    guard w > 0, h > 0 else { return preferred }

    let scale = max(canvas.width / w, canvas.height / h)
    let scaledW = w * scale
    let scaledH = h * scale
    let tx = (canvas.width - scaledW) / 2
    let ty = (canvas.height - scaledH) / 2

    return preferred
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(CGAffineTransform(translationX: tx, y: ty))
  }
}
