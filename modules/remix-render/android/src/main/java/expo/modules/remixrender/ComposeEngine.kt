package expo.modules.remixrender

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.remixrender.gl.InputSurface
import expo.modules.remixrender.gl.OutputSurface
import org.json.JSONArray
import java.io.File
import java.nio.ByteBuffer

/**
 * Fázis C — **multi-segment kompozit**: több videó-szegmens egymás után EGY
 * folytonos H.264-encoderbe (folytonos PTS), szegmensenként saját vágás +
 * sebesség + vászon-skálázás (aspect-fill) + szűrő. A hang az összes forrás
 * ([AudioMixer]) — a szegmensek saját hangja + a külön zene/voiceover sávok —
 * egyetlen AAC-be keverve, időzítve. Ez az iOS AVFoundation-kompozit párja.
 *
 * A szegmensek az `atSec` idővonalon, sorrendben, egymáshoz csatolva (a gap-ek
 * fekete-kitöltése külön, követő lépés — a tipikus idővonal folytonos).
 */
object ComposeEngine {
  private const val TIMEOUT_US = 10_000L
  private const val VIDEO_MIME = "video/avc"

  private class VSeg(
    val uri: String,
    val atUs: Long,
    val inUs: Long,
    val timelineDurUs: Long,
    val speed: Double,
    val volume: Float,
    val filterRgb: Int,
    val filterOpacity: Float,
  )

  fun compose(
    video: JSONArray,
    audio: JSONArray?,
    canvasWidth: Int,
    canvasHeight: Int,
    fps: Int,
    isCancelled: () -> Boolean = { false },
    outputPath: String,
    onProgress: (Double) -> Unit,
  ): String {
    val canvasW = evenDim(canvasWidth)
    val canvasH = evenDim(canvasHeight)

    // ── szegmensek parse + rendezés ──
    val segs = ArrayList<VSeg>()
    for (i in 0 until video.length()) {
      val o = video.getJSONObject(i)
      val speed = o.optDouble("speed", 1.0).let { if (it > 0.0) it else 1.0 }
      val durUs = (o.optDouble("durationSec", 0.0) * 1_000_000.0).toLong()
      val preset = FilterPresets.get(o.optString("filter", "none"))
      segs.add(
        VSeg(
          uri = toPath(o.getString("uri")),
          atUs = (o.optDouble("atSec", 0.0) * 1_000_000.0).toLong(),
          inUs = (o.optDouble("inSec", 0.0) * 1_000_000.0).toLong(),
          timelineDurUs = durUs,
          speed = speed,
          volume = o.optDouble("volume", 1.0).toFloat(),
          filterRgb = preset?.rgb ?: -1,
          filterOpacity = preset?.opacity ?: 0f,
        ),
      )
    }
    segs.sortBy { it.atUs }
    if (segs.isEmpty()) throw IllegalStateException("Nincs videó-szegmens a kompozithoz.")

    // közös idővonal-nullpont (videó + hang legkorábbi kezdete)
    var firstAtUs = segs.first().atUs
    if (audio != null) {
      for (i in 0 until audio.length()) {
        val a = (audio.getJSONObject(i).optDouble("atSec", 0.0) * 1_000_000.0).toLong()
        if (a < firstAtUs) firstAtUs = a
      }
    }
    var totalDurUs = 0L
    for (s in segs) totalDurUs = maxOf(totalDurUs, s.atUs - firstAtUs + s.timelineDurUs)
    if (audio != null) {
      for (i in 0 until audio.length()) {
        val a = audio.getJSONObject(i)
        val end = (a.optDouble("atSec", 0.0) * 1_000_000.0).toLong() - firstAtUs +
          (a.optDouble("durationSec", 0.0) * 1_000_000.0).toLong()
        totalDurUs = maxOf(totalDurUs, end)
      }
    }

    val out = File(outputPath)
    out.parentFile?.mkdirs()
    if (out.exists()) out.delete()

    // ── hang-mix elő (hogy a muxer-track a videó formátumváltása előtt ismert legyen) ──
    val encodedAudio = buildAudio(segs, audio, firstAtUs, totalDurUs)

    var encoder: MediaCodec? = null
    var inputSurface: InputSurface? = null
    var outputSurface: OutputSurface? = null
    var muxer: MediaMuxer? = null
    try {
      val outFormat = MediaFormat.createVideoFormat(VIDEO_MIME, canvasW, canvasH)
      outFormat.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      outFormat.setInteger(MediaFormat.KEY_BIT_RATE, bitRateFor(canvasW, canvasH))
      outFormat.setInteger(MediaFormat.KEY_FRAME_RATE, if (fps > 0) fps else 30)
      outFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      encoder = MediaCodec.createEncoderByType(VIDEO_MIME)
      encoder.configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      inputSurface = InputSurface(encoder.createInputSurface())
      inputSurface.makeCurrent()
      encoder.start()
      outputSurface = OutputSurface()

      muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      var muxVideoTrack = -1
      var muxAudioTrack = -1
      var muxerStarted = false
      val encInfo = MediaCodec.BufferInfo()
      val enc = encoder
      val mux = muxer

      // enkóder ürítése → muxer (a format-change-nél indítja a muxert + beírja a hangot)
      fun drainEncoder(end: Boolean) {
        while (true) {
          val encIndex = enc.dequeueOutputBuffer(encInfo, if (end) TIMEOUT_US else 0L)
          if (encIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
            if (!end) return else continue
          }
          if (encIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            if (muxerStarted) throw RuntimeException("az enkóder-formátum kétszer változott")
            muxVideoTrack = mux.addTrack(enc.outputFormat)
            if (encodedAudio != null) muxAudioTrack = mux.addTrack(encodedAudio.format)
            mux.start()
            muxerStarted = true
            if (encodedAudio != null && muxAudioTrack >= 0) {
              val ai = MediaCodec.BufferInfo()
              for (pkt in encodedAudio.packets) {
                ai.offset = 0; ai.size = pkt.data.size; ai.presentationTimeUs = pkt.ptsUs; ai.flags = pkt.flags
                mux.writeSampleData(muxAudioTrack, ByteBuffer.wrap(pkt.data), ai)
              }
            }
            continue
          }
          if (encIndex < 0) return
          val encBuf = enc.getOutputBuffer(encIndex)!!
          if (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) encInfo.size = 0
          if (encInfo.size > 0 && muxerStarted) {
            encBuf.position(encInfo.offset)
            encBuf.limit(encInfo.offset + encInfo.size)
            mux.writeSampleData(muxVideoTrack, encBuf, encInfo)
          }
          val eos = encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          enc.releaseOutputBuffer(encIndex, false)
          if (eos) return
        }
      }

      // ── szegmensek dekódolása sorban, folytonos PTS-sel ──
      for (seg in segs) {
        if (isCancelled()) throw RenderCancelledException()
        decodeSegment(seg, canvasW, canvasH, firstAtUs, outputSurface, inputSurface, totalDurUs, isCancelled, onProgress) {
          drainEncoder(false)
        }
      }
      enc.signalEndOfInputStream()
      drainEncoder(true)

      muxer.stop()
      onProgress(1.0)
      return out.absolutePath
    } catch (e: Exception) {
      try { if (out.exists()) out.delete() } catch (_: Exception) {}
      throw e
    } finally {
      try { outputSurface?.release() } catch (_: Exception) {}
      try { encoder?.stop() } catch (_: Exception) {}
      try { encoder?.release() } catch (_: Exception) {}
      try { inputSurface?.release() } catch (_: Exception) {}
      try { muxer?.release() } catch (_: Exception) {}
    }
  }

  /** Egy szegmens dekód→GL→encode a folytonos encoderbe; `pump` üríti az encodert. */
  private fun decodeSegment(
    seg: VSeg,
    canvasW: Int,
    canvasH: Int,
    firstAtUs: Long,
    outputSurface: OutputSurface,
    inputSurface: InputSurface,
    totalDurUs: Long,
    isCancelled: () -> Boolean,
    onProgress: (Double) -> Unit,
    pump: () -> Unit,
  ) {
    val extractor = MediaExtractor()
    extractor.setDataSource(seg.uri)
    var videoTrack = -1
    var videoFormat: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val f = extractor.getTrackFormat(i)
      val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("video/")) { videoTrack = i; videoFormat = f; break }
    }
    val vFmt = videoFormat ?: run { extractor.release(); throw IllegalStateException("A szegmensben nincs videósáv: ${seg.uri}") }

    val rotation = if (vFmt.containsKey(MediaFormat.KEY_ROTATION)) vFmt.getInteger(MediaFormat.KEY_ROTATION) else 0
    val w = vFmt.getInteger(MediaFormat.KEY_WIDTH)
    val h = vFmt.getInteger(MediaFormat.KEY_HEIGHT)
    val dispW = if (rotation == 90 || rotation == 270) h else w
    val dispH = if (rotation == 90 || rotation == 270) w else h
    outputSurface.setAspectFill(dispW, dispH, canvasW, canvasH)
    outputSurface.setFilter(if (seg.filterRgb >= 0) seg.filterRgb else 0, if (seg.filterRgb >= 0) seg.filterOpacity else 0f)

    val decoder = MediaCodec.createDecoderByType(vFmt.getString(MediaFormat.KEY_MIME)!!)
    decoder.configure(vFmt, outputSurface.surface, null, 0)
    decoder.start()
    extractor.selectTrack(videoTrack)
    extractor.seekTo(seg.inUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val consumedUs = (seg.timelineDurUs * seg.speed).toLong()
    val endInUs = seg.inUs + consumedUs
    val segBaseUs = seg.atUs - firstAtUs
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone) {
        if (isCancelled()) throw RenderCancelledException()
        if (!inputDone) {
          val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val sampleTime = extractor.sampleTime
            if (sampleTime < 0L || sampleTime > endInUs) {
              decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              val buf = decoder.getInputBuffer(inIndex)!!
              val size = extractor.readSampleData(buf, 0)
              if (size < 0) {
                decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                decoder.queueInputBuffer(inIndex, 0, size, sampleTime, 0)
                extractor.advance()
              }
            }
          }
        }
        val outIndex = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
        if (outIndex >= 0) {
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          val ptsUs = info.presentationTimeUs
          // félig nyílt ablak [inUs, endInUs) → a szegmens-határon nincs duplikált PTS
          val render = info.size > 0 && ptsUs >= seg.inUs && ptsUs < endInUs
          decoder.releaseOutputBuffer(outIndex, render)
          if (render) {
            outputSurface.awaitNewImage()
            outputSurface.drawImage()
            val outPtsUs = segBaseUs + ((ptsUs - seg.inUs).toDouble() / seg.speed).toLong()
            inputSurface.setPresentationTime(outPtsUs * 1000L)
            inputSurface.swapBuffers()
            if (totalDurUs > 0L) {
              onProgress((outPtsUs.toDouble() / totalDurUs).coerceIn(0.0, 0.98))
            }
            pump()
          }
          if (eos) outputDone = true
        }
      }
    } finally {
      try { decoder.stop() } catch (_: Exception) {}
      try { decoder.release() } catch (_: Exception) {}
      extractor.release()
    }
  }

  /** A videó-szegmensek saját hangja + a külön audio[] sávok mix-forrásai. */
  private fun buildAudio(
    segs: List<VSeg>,
    audio: JSONArray?,
    firstAtUs: Long,
    totalDurUs: Long,
  ): PcmCodec.Encoded? {
    val sources = ArrayList<AudioMixer.Source>()
    for (seg in segs) {
      if (seg.volume <= 0f) continue
      val track = firstTrack(seg.uri, "audio/") ?: continue
      sources.add(
        AudioMixer.Source(
          srcPath = seg.uri,
          trackIndex = track,
          inUs = seg.inUs,
          consumedUs = (seg.timelineDurUs * seg.speed).toLong(),
          timelineOffsetUs = seg.atUs - firstAtUs,
          timelineDurUs = seg.timelineDurUs,
          volume = seg.volume,
        ),
      )
    }
    if (audio != null) {
      for (i in 0 until audio.length()) {
        val a = audio.getJSONObject(i)
        val uri = toPath(a.getString("uri"))
        val track = firstTrack(uri, "audio/") ?: continue
        val durUs = (a.optDouble("durationSec", 0.0) * 1_000_000.0).toLong()
        sources.add(
          AudioMixer.Source(
            srcPath = uri,
            trackIndex = track,
            inUs = (a.optDouble("inSec", 0.0) * 1_000_000.0).toLong(),
            consumedUs = durUs,
            timelineOffsetUs = (a.optDouble("atSec", 0.0) * 1_000_000.0).toLong() - firstAtUs,
            timelineDurUs = durUs,
            volume = a.optDouble("volume", 1.0).toFloat(),
          ),
        )
      }
    }
    if (sources.isEmpty()) return null
    return AudioMixer.mix(sources, totalDurUs)
  }

  private fun firstTrack(srcPath: String, prefix: String): Int? {
    val ex = MediaExtractor()
    try {
      ex.setDataSource(srcPath)
      for (i in 0 until ex.trackCount) {
        val mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith(prefix)) return i
      }
      return null
    } catch (_: Exception) {
      return null
    } finally {
      ex.release()
    }
  }

  private fun toPath(uri: String): String = if (uri.startsWith("file://")) uri.removePrefix("file://") else uri
  private fun bitRateFor(w: Int, h: Int): Int = (w.toLong() * h.toLong() * 4L).toInt().coerceIn(2_000_000, 24_000_000)
  private fun evenDim(n: Int): Int = if (n % 2 == 0) n else n + 1
}
