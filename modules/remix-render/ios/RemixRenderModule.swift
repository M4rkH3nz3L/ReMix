import ExpoModulesCore
import AVFoundation
import CoreMedia
import UIKit

// Eszközön futó videó-render AVFoundation-nel — a Remix ingyenes export-útja.
//
// A JS (`src/lib/nativeRender.ts`) egy render-tervet ad JSON-ként; itt
// AVMutableComposition + AVMutableVideoComposition épül belőle, majd
// AVAssetExportSession renderel MP4-et a megadott kimeneti útra.
//
// A v2 a rövidvideó gyakori esetét fedi le KORREKTEN: a videó-szegmensek
// egymás után (vágással + sebességgel + klip-hangerővel) egy fix vászonra
// (aspect-fill), a szegmensek saját hangja + a külön hang-szegmensek keverve
// (AVAudioMix). A terv opcionális mezői: `watermark` (ReMix-vízjel a nem-fizető
// tiernek), `codec` ('hevc' → HEVC-preset, ha az eszköz tudja), `bitRate`
// (cél-bitráta → fájlméret-plafon közelítés, mert az export-session nem fogad
// nyers bitrátát). A futó export a `cancel()`-lel ténylegesen leáll
// (`cancelExport`), a részfájl törlődik. A fejlett effektek (szűrők, átmenetek,
// 3D, AI) továbbra is a felhő-render sajátjai.

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
  // opcionális terv-mezők — a JS csak akkor küldi, ha van (régi tervek is érvényesek)
  let watermark: Bool?
  let codec: String?
  let bitRate: Int?
}

enum RenderError: Error, LocalizedError {
  case badPlan
  case noVideo
  case noTracks(String)
  case exportFailed(String)
  case badSegment(String)
  case cancelled

  var errorDescription: String? {
    switch self {
    case .badPlan: return "Érvénytelen render-terv."
    case .noVideo: return "Nincs helyi videóklip az eszközön-renderhez."
    case .noTracks(let s): return "A forrás nem tartalmaz sávot: \(s)"
    case .exportFailed(let s): return "Az export nem sikerült: \(s)"
    case .badSegment(let s): return "Egy klip nem olvasható, az export leállt (nem hagyjuk ki csendben): \(s)"
    case .cancelled: return "A render megszakítva."
    }
  }
}

public class RemixRenderModule: Module {
  private var progressTimer: Timer?
  // a futó export + a megszakítás-jelző — a JS `cancel()` másik szálról jön
  private let stateLock = NSLock()
  private var activeExport: AVAssetExportSession?
  private var cancelRequested = false
  // SOROS queue: egyszerre EGY render fut. Gyors cancel→újraindítás esetén a
  // régi export még pöröghet, miközben az új már jönne — konkurens futásnál
  // közös lenne az activeExport/progressTimer (és akár a kimeneti fájl is).
  private let renderQueue = DispatchQueue(label: "expo.remixrender.render", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("RemixRender")

    Events("onProgress")

    AsyncFunction("exportPlan") { (planJson: String, outputPath: String, promise: Promise) in
      self.renderQueue.async {
        do {
          let url = try self.render(planJson: planJson, outputPath: outputPath)
          DispatchQueue.main.async { promise.resolve(url) }
        } catch {
          // promise.reject(error): az UnexpectedException a localizedDescription-t
          // adja tovább a JS-nek — a (code, description) alak a bridge-ben elveszik
          DispatchQueue.main.async { promise.reject(error) }
        }
      }
    }

    // a futó render tényleges leállítása (a JS AbortSignal → ide jut)
    AsyncFunction("cancel") { () in
      self.stateLock.lock()
      self.cancelRequested = true
      let session = self.activeExport
      self.stateLock.unlock()
      session?.cancelExport()
    }
  }

  private func fileURL(_ uri: String) -> URL {
    if uri.hasPrefix("file://") { return URL(string: uri)! }
    return URL(fileURLWithPath: uri)
  }

  private func isCancelRequested() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return cancelRequested
  }

  private func render(planJson: String, outputPath: String) throws -> String {
    guard let data = planJson.data(using: .utf8),
          let plan = try? JSONDecoder().decode(RenderPlan.self, from: data) else {
      throw RenderError.badPlan
    }
    if plan.video.isEmpty { throw RenderError.noVideo }

    // új render → az előző megszakítás-jelző nem érvényes rá
    stateLock.lock()
    cancelRequested = false
    stateLock.unlock()

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
    // klip-hangerő (0 = némítva) — eddig elnyelődött, a néma klip is szólt
    let mainAudioParams = AVMutableAudioMixInputParameters(track: compAudio)
    var mixParams: [AVMutableAudioMixInputParameters] = []
    var cursor = CMTime.zero // a videó-idővonal aktuális vége
    let fileName = { (uri: String) in (uri as NSString).lastPathComponent }

    for seg in plan.video {
      let asset = AVURLAsset(url: fileURL(seg.uri))
      // B12: hiányzó / olvashatatlan szegmens → HIBA (eddig `continue` — a kész videóból
      // csendben kimaradt egy rész)
      guard let srcVideo = asset.tracks(withMediaType: .video).first else {
        throw RenderError.badSegment(fileName(seg.uri))
      }

      let speed = seg.speed > 0 ? seg.speed : 1.0
      let sourceConsumed = seg.durationSec * speed
      let start = CMTime(seconds: max(0, seg.inSec), preferredTimescale: timescale)
      let srcRange = CMTimeRange(
        start: start,
        duration: CMTime(seconds: sourceConsumed, preferredTimescale: timescale))

      // B11: a klip a SAJÁT idővonal-helyére kerül (`atSec`) — a rés fekete (üres
      // tartomány + háttér-utasítás), nem fűzzük egymáshoz a klipeket (eddig a rések
      // eltűntek → más hossz/időzítés, mint a preview, csúszó hang és felirat)
      let atTime = CMTime(seconds: max(0, seg.atSec), preferredTimescale: timescale)
      if CMTimeCompare(atTime, cursor) > 0 {
        let gap = CMTimeRange(start: cursor, end: atTime)
        compVideo.insertEmptyTimeRange(gap)
        let gapInst = AVMutableVideoCompositionInstruction()
        gapInst.timeRange = gap
        gapInst.backgroundColor = UIColor.black.cgColor
        instructions.append(gapInst)
        cursor = atTime
      }
      let insertAt = cursor
      do {
        try compVideo.insertTimeRange(srcRange, of: srcVideo, at: insertAt)
      } catch {
        throw RenderError.badSegment("\(fileName(seg.uri)) — \(error.localizedDescription)")
      }
      // a beszúrt szegmens saját hangja (ha van — a néma videó legális), azonos időzítéssel
      if let srcAudio = asset.tracks(withMediaType: .audio).first {
        do {
          try compAudio.insertTimeRange(srcRange, of: srcAudio, at: insertAt)
        } catch {
          throw RenderError.badSegment("\(fileName(seg.uri)) (hang) — \(error.localizedDescription)")
        }
      }
      mainAudioParams.setVolume(Float(max(0, min(1, seg.volume))), at: insertAt)

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
    mixParams.append(mainAudioParams)

    // külön hang-szegmensek (zene/voiceover/SFX) — az abszolút idejükre helyezve
    for seg in plan.audio {
      let asset = AVURLAsset(url: fileURL(seg.uri))
      guard let srcAudio = asset.tracks(withMediaType: .audio).first else {
        throw RenderError.badSegment(fileName(seg.uri))
      }
      guard let extra = composition.addMutableTrack(
        withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw RenderError.noTracks("audio")
      }
      let srcRange = CMTimeRange(
        start: CMTime(seconds: max(0, seg.inSec), preferredTimescale: timescale),
        duration: CMTime(seconds: seg.durationSec, preferredTimescale: timescale))
      let at = CMTime(seconds: max(0, seg.atSec), preferredTimescale: timescale)
      do {
        try extra.insertTimeRange(srcRange, of: srcAudio, at: at)
      } catch {
        throw RenderError.badSegment("\(fileName(seg.uri)) — \(error.localizedDescription)")
      }
      let params = AVMutableAudioMixInputParameters(track: extra)
      params.setVolume(Float(max(0, min(1, seg.volume))), at: .zero)
      mixParams.append(params)
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
    videoComposition.instructions = instructions

    // 🏷️ ReMix-vízjel (exportPolicy: ingyen on-device + nem-fizető tier) — a
    // kompozíció jobb-alsó sarkára, CoreAnimation réteggel (origó: bal-alsó)
    if plan.watermark == true {
      let parent = CALayer()
      parent.frame = CGRect(origin: .zero, size: renderSize)
      let videoLayer = CALayer()
      videoLayer.frame = parent.frame
      parent.addSublayer(videoLayer)

      let fontSize = max(14, renderSize.height * 0.032)
      let margin = renderSize.height * 0.02
      let text = CATextLayer()
      text.string = "ReMix"
      text.font = "HelveticaNeue-Bold" as CFTypeRef
      text.fontSize = fontSize
      text.alignmentMode = .right
      text.foregroundColor = UIColor(white: 1.0, alpha: 0.72).cgColor
      text.shadowColor = UIColor.black.cgColor
      text.shadowOpacity = 0.6
      text.shadowOffset = CGSize(width: 0, height: 1)
      text.shadowRadius = 2
      text.contentsScale = 2
      let boxWidth = renderSize.width * 0.5
      text.frame = CGRect(
        x: renderSize.width - boxWidth - margin,
        y: margin,
        width: boxWidth,
        height: fontSize * 1.4)
      parent.addSublayer(text)
      videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
        postProcessingAsVideoLayer: videoLayer, in: parent)
    }

    // kimenet
    let outURL = self.fileURL(outputPath)
    try? FileManager.default.removeItem(at: outURL)

    // 🎞️ kodek: 'hevc' → HEVC-preset, ha az eszköz/kompozíció tudja; különben H.264
    let wantHevc = plan.codec == "hevc"
    let hevcOk = wantHevc &&
      AVAssetExportSession.exportPresets(compatibleWith: composition)
        .contains(AVAssetExportPresetHEVCHighestQuality)
    let preset = hevcOk ? AVAssetExportPresetHEVCHighestQuality : AVAssetExportPresetHighestQuality

    guard let export = AVAssetExportSession(asset: composition, presetName: preset) else {
      throw RenderError.exportFailed("nincs export-session")
    }
    export.outputURL = outURL
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true
    export.videoComposition = videoComposition
    let mix = AVMutableAudioMix()
    mix.inputParameters = mixParams
    export.audioMix = mix
    // B13: NINCS fájlméret-plafon. A korábbi `fileLengthLimit = bitráta × hossz × 1.08`
    // VBR-nél (minden platform-preset az) levágta a videó VÉGÉT. Az export-session nem
    // fogad nyers bitrátát — a preset minősége dönt; a csonka videónál ez a kisebb rossz.

    // megszakítás: a sessiont regisztráljuk, hogy a `cancel()` elérje; ha a
    // kérés már az indítás előtt megjött, el se kezdjük
    stateLock.lock()
    let alreadyCancelled = cancelRequested
    activeExport = export
    stateLock.unlock()
    if alreadyCancelled {
      stateLock.lock()
      activeExport = nil
      stateLock.unlock()
      throw RenderError.cancelled
    }

    // progressz-jelzés (0–1) a JS felé
    DispatchQueue.main.async {
      self.progressTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
        self?.sendEvent("onProgress", ["progress": Double(export.progress)])
      }
    }

    let sema = DispatchSemaphore(value: 0)
    export.exportAsynchronously { sema.signal() }
    sema.wait()

    stateLock.lock()
    activeExport = nil
    let wasCancelled = cancelRequested
    stateLock.unlock()

    DispatchQueue.main.async {
      self.progressTimer?.invalidate()
      self.progressTimer = nil
      self.sendEvent("onProgress", ["progress": 1.0])
    }

    if export.status == .cancelled || wasCancelled {
      try? FileManager.default.removeItem(at: outURL) // részfájl takarítása
      throw RenderError.cancelled
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
