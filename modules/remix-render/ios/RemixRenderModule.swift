import ExpoModulesCore
import AVFoundation
import CoreMedia
import UIKit
import Vision

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
  // ⏩ opcionális: a gyorsított hangklip sebessége (forrás-mp / idővonal-mp); hiányzó = 1
  let speed: Double?
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

enum ForegroundError: LocalizedError {
  case unsupported
  case noSubject
  case badImage

  var errorDescription: String? {
    switch self {
    case .unsupported: return "UNSUPPORTED"
    case .noSubject: return "NO_SUBJECT"
    case .badImage: return "BAD_IMAGE"
    }
  }
}

public class RemixRenderModule: Module {
  /// A kép álló helyzetbe forgatva, legfeljebb 2048 pont hosszú oldallal: a maszk a látható képhez igazodjon.
  private static func uprightImage(uri: String) throws -> CGImage {
    let path = uri.hasPrefix("file://") ? (URL(string: uri)?.path ?? uri) : uri
    guard let image = UIImage(contentsOfFile: path) else { throw ForegroundError.badImage }
    let scale = min(1, 2048 / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let cg = upright.cgImage else { throw ForegroundError.badImage }
    return cg
  }

  static func foregroundMask(uri: String, outputPath: String) throws -> String {
    guard #available(iOS 17.0, *) else { throw ForegroundError.unsupported }
    let handler = VNImageRequestHandler(cgImage: try uprightImage(uri: uri), options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    do {
      try handler.perform([request])
    } catch {
      // a szimulátoron és a régi Neural Engine-en a kérés nem fut
      throw ForegroundError.unsupported
    }
    guard let result = request.results?.first, !result.allInstances.isEmpty else {
      throw ForegroundError.noSubject
    }
    let mask = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
    let output = outputPath.hasPrefix("file://") ? URL(string: outputPath)! : URL(fileURLWithPath: outputPath)
    let gray = CGColorSpace(name: CGColorSpace.genericGrayGamma2_2)!
    try CIContext().writePNGRepresentation(of: CIImage(cvPixelBuffer: mask), to: output, format: .L8, colorSpace: gray)
    return output.absoluteString
  }

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

    // ⏩ képesség-jelző: ez a build a hang-szegmens `speed` mezőjét is skálázza (a régi build
    // csendben figyelmen kívül hagyná → a JS ilyenkor a felhő-útra küldi a gyorsított hangot)
    Constant("supportsAudioSpeed") { true }

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

    // 🎧 hosszú forrás szakaszos dekódolása: a fájlnak CSAK a [start, start+duration) ablaka,
    // 44,1 kHz-es, összefésült 32 bites lebegőpontos PCM-ként (a forrás csatornaszámával) egy
    // nyers fájlba — a keverő így 20 percnél hosszabb forrást is a memória töredékével játszik.
    Constant("supportsDecodeWindow") { true }

    /// 🎙️⏱️ a hangrendszer késései (mp) a jelenlegi munkamenetben — a felvétel késés-kompenzációjához
    Function("ioLatency") { () -> [String: Any] in
      let s = AVAudioSession.sharedInstance()
      let route = s.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
      return ["output": s.outputLatency, "input": s.inputLatency, "buffer": s.ioBufferDuration, "category": s.category.rawValue, "route": route, "options": s.categoryOptions.rawValue]
    }

    AsyncFunction("decodeWindow") { (uri: String, start: Double, duration: Double, outputPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let info = try RemixRenderModule.decodeWindow(url: self.fileURL(uri), start: start, duration: duration, outputPath: outputPath)
          DispatchQueue.main.async { promise.resolve(info) }
        } catch {
          DispatchQueue.main.async { promise.reject(error) }
        }
      }
    }

    // a futó render tényleges leállítása (a JS AbortSignal → ide jut)
    // A téma maszkja az eszközön (Vision, iOS 17+): a kép nem hagyja el a telefont.
    AsyncFunction("foregroundMask") { (uri: String, outputPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let url = try RemixRenderModule.foregroundMask(uri: uri, outputPath: outputPath)
          DispatchQueue.main.async { promise.resolve(url) }
        } catch {
          DispatchQueue.main.async { promise.reject(error) }
        }
      }
    }

    AsyncFunction("cancel") { () in
      self.stateLock.lock()
      self.cancelRequested = true
      let session = self.activeExport
      self.stateLock.unlock()
      session?.cancelExport()
    }
  }

  /// a hang-ablak dekódolása (AVAssetReader, 44,1 kHz, float32, összefésült, forrás-csatornaszám)
  static func decodeWindow(url: URL, start: Double, duration: Double, outputPath: String) throws -> [String: Any] {
    // 🎧 mp3: az AVAssetReader időtartománya mp3-nál pontatlan (mérve: 576 / −1494 minta csúszás) —
    // az AVAudioFile mintapontosan keres, és a kódolói késleltetést is kezeli
    if url.pathExtension.lowercased() == "mp3" {
      return try decodeWindowAudioFile(url: url, start: start, duration: duration, outputPath: outputPath)
    }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .audio).first else {
      throw RenderError.noTracks("audio")
    }
    var channels = 2
    if let desc = track.formatDescriptions.first,
       let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc as! CMAudioFormatDescription) {
      channels = max(1, min(2, Int(asbd.pointee.mChannelsPerFrame)))
    }
    let reader = try AVAssetReader(asset: asset)
    // mintára kerekítve (a CMTime(seconds:) csonkol: 19,9 × 44100 = 877589,999… → egy mintával korábbi
    // kezdet, mérve a szakaszhatáron)
    reader.timeRange = CMTimeRange(
      start: CMTime(value: CMTimeValue((max(0, start) * 44100).rounded()), timescale: 44100),
      duration: CMTime(value: CMTimeValue((max(0, duration) * 44100).rounded()), timescale: 44100))
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 44100,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsNonInterleaved: false,
      AVLinearPCMIsBigEndianKey: false,
    ]
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else {
      throw RenderError.exportFailed(reader.error?.localizedDescription ?? "hang-ablak olvasása")
    }
    var data = Data()
    while let sample = output.copyNextSampleBuffer() {
      if let block = CMSampleBufferGetDataBuffer(sample) {
        let length = CMBlockBufferGetDataLength(block)
        var chunk = Data(count: length)
        _ = chunk.withUnsafeMutableBytes { ptr in
          CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
        }
        data.append(chunk)
      }
    }
    if reader.status == .failed {
      throw RenderError.exportFailed(reader.error?.localizedDescription ?? "hang-ablak olvasása")
    }
    try data.write(to: URL(fileURLWithPath: outputPath))
    return ["frames": data.count / (4 * channels), "channels": channels]
  }

  /** a Xing/Info-fejléc kódoló-címkéjének (LAME, Lavc) késleltetése (minta); nincs ilyen fejléc → 0 */
  static func lameEncoderDelay(_ url: URL) -> Int {
    guard let h = try? FileHandle(forReadingFrom: url) else { return 0 }
    defer { try? h.close() }
    let head = h.readData(ofLength: 256 * 1024)
    let bytes = [UInt8](head)
    var start = 0
    // ID3v2 átugrása (szinkron-biztos méret)
    if bytes.count > 10, bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 {
      start = 10 + (Int(bytes[6] & 0x7f) << 21 | Int(bytes[7] & 0x7f) << 14 | Int(bytes[8] & 0x7f) << 7 | Int(bytes[9] & 0x7f))
    }
    // a Xing/Info fejléc után (a jelzőbitek szerinti mezőkkel) jön a kódoló-címke (LAME… vagy Lavc…);
    // a késleltetés a címke 21–22. bájtjának 12 bitje
    let xing: [UInt8] = Array("Xing".utf8)
    let info: [UInt8] = Array("Info".utf8)
    var i = start
    while i + 8 < bytes.count && i < start + 4096 {
      let tag = Array(bytes[i..<(i + 4)])
      if tag == xing || tag == info {
        let flags = Int(bytes[i + 4]) << 24 | Int(bytes[i + 5]) << 16 | Int(bytes[i + 6]) << 8 | Int(bytes[i + 7])
        var at = i + 8
        if flags & 1 != 0 { at += 4 }
        if flags & 2 != 0 { at += 4 }
        if flags & 4 != 0 { at += 100 }
        if flags & 8 != 0 { at += 4 }
        if at + 23 < bytes.count {
          return Int(bytes[at + 21]) << 4 | Int(bytes[at + 22]) >> 4
        }
        return 0
      }
      i += 1
    }
    return 0
  }

  /** az mp3-ablak AVAudioFile-lal: mintapontos `framePosition`, 44,1 kHz-től eltérőnél AVAudioConverter */
  static func decodeWindowAudioFile(url: URL, start: Double, duration: Double, outputPath: String) throws -> [String: Any] {
    let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
    let src = file.processingFormat
    let channels = max(1, min(2, Int(src.channelCount)))
    let outFrames = Int((max(0, duration) * 44100).rounded())
    var out = [Float](repeating: 0, count: outFrames * channels)
    let srcRate = src.sampleRate
    // az AVAudioFile a dekóder késleltetését levágja, a LAME-kódolóét (576) nem (mérve: +576 minta) — a fejlécből
    let encoderDelay = AVAudioFramePosition(lameEncoderDelay(url))
    let startFrame = AVAudioFramePosition((max(0, start) * srcRate).rounded()) + encoderDelay
    if startFrame < file.length {
      file.framePosition = startFrame
      let want = AVAudioFrameCount(min(Double(file.length - startFrame), Double(outFrames) * srcRate / 44100 + 256))
      guard let inBuf = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: max(1, want)) else { throw RenderError.exportFailed("hang-ablak puffer") }
      try file.read(into: inBuf, frameCount: want)
      if abs(srcRate - 44100) < 0.5 {
        let n = min(Int(inBuf.frameLength), outFrames)
        for c in 0..<channels {
          let ch = inBuf.floatChannelData![min(c, Int(src.channelCount) - 1)]
          for i in 0..<n { out[i * channels + c] = ch[i] }
        }
      } else {
        guard let dstFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: AVAudioChannelCount(channels), interleaved: false),
              let conv = AVAudioConverter(from: src, to: dstFormat),
              let outBuf = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: AVAudioFrameCount(outFrames + 64)) else {
          throw RenderError.exportFailed("hang-átalakító")
        }
        // .normal: az átalakító a saját késleltetését kiegyenlíti (a .none-nal ~15 minta csúszás, mérve)
        conv.primeMethod = .normal
        var given = false
        var err: NSError?
        _ = conv.convert(to: outBuf, error: &err) { _, status in
          if given { status.pointee = .endOfStream; return nil }
          given = true
          status.pointee = .haveData
          return inBuf
        }
        if let err { throw err }
        let n = min(Int(outBuf.frameLength), outFrames)
        for c in 0..<channels {
          let ch = outBuf.floatChannelData![c]
          for i in 0..<n { out[i * channels + c] = ch[i] }
        }
      }
    }
    let data = out.withUnsafeBufferPointer { Data(buffer: $0) }
    try data.write(to: URL(fileURLWithPath: outputPath))
    return ["frames": outFrames, "channels": channels]
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
    mainAudioParams.audioTimePitchAlgorithm = .spectral
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
      // ⏩ a gyorsított hangklip `durationSec · speed` forrást fogyaszt, majd a cél-hosszra skálázzuk
      // (a hangmagasságot az export `.spectral` algoritmusa tartja — mint a felhő atempo-ja)
      let audioSpeed = (seg.speed ?? 1) > 0 ? (seg.speed ?? 1) : 1.0
      let srcRange = CMTimeRange(
        start: CMTime(seconds: max(0, seg.inSec), preferredTimescale: timescale),
        duration: CMTime(seconds: seg.durationSec * audioSpeed, preferredTimescale: timescale))
      let at = CMTime(seconds: max(0, seg.atSec), preferredTimescale: timescale)
      do {
        try extra.insertTimeRange(srcRange, of: srcAudio, at: at)
      } catch {
        throw RenderError.badSegment("\(fileName(seg.uri)) — \(error.localizedDescription)")
      }
      if abs(audioSpeed - 1.0) > 0.001 {
        extra.scaleTimeRange(
          CMTimeRange(start: at, duration: srcRange.duration),
          toDuration: CMTime(seconds: seg.durationSec, preferredTimescale: timescale))
      }
      let params = AVMutableAudioMixInputParameters(track: extra)
      params.audioTimePitchAlgorithm = .spectral
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
    // ⏩ a skálázott (gyorsított) hang hangmagasság-tartással — a videó- és a hangklipeké is
    export.audioTimePitchAlgorithm = .spectral
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
