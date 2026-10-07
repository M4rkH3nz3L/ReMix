package expo.modules.remixrender

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.remixrender.gl.InputSurface
import expo.modules.remixrender.gl.OutputSurface
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min

/**
 * Fázis B1 — single-clip **transzkód**: a forrást a cél-vászonra (aspect-fill)
 * skálázza és H.264-re újrakódolja egy **decode → OpenGL → encode** pipeline-nal
 * (MediaCodec dekóder → [OutputSurface] → GL → [InputSurface] → MediaCodec enkóder
 * → MediaMuxer). A `[inSec, inSec+durationSec]` tartományra **pontosan** vág
 * (újrakódolás → nincs keyframe-kényszer), a hangsávot pedig **változatlanul
 * átmásolja** (a hang-mix/volume a Fázis C-re marad).
 *
 * Szándékosan **Expo-független** → instrumentált teszttel az eszközön futtatható.
 * A CTS `ExtractDecodeEditEncodeMuxTest` szerkezetét követi.
 */
object TranscodeEngine {
  private const val TIMEOUT_US = 10_000L
  private const val VIDEO_MIME = "video/avc"

  /** @return a kész kimeneti fájl abszolút elérési útja (file:// nélkül). */
  fun transcode(
    srcPath: String,
    inSec: Double,
    durationSec: Double,
    canvasWidth: Int,
    canvasHeight: Int,
    fps: Int,
    speed: Double,
    outputPath: String,
    onProgress: (Double) -> Unit,
  ): String {
    val startUs = (inSec * 1_000_000.0).toLong()
    val endUs =
      if (durationSec > 0.0) ((inSec + durationSec) * 1_000_000.0).toLong() else Long.MAX_VALUE
    val canvasW = evenDim(canvasWidth)
    val canvasH = evenDim(canvasHeight)
    val playbackSpeed = if (speed > 0.0) speed else 1.0

    val extractor = MediaExtractor()
    extractor.setDataSource(srcPath)
    var videoTrack = -1
    var audioTrack = -1
    var videoFormat: MediaFormat? = null
    var audioFormat: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val fmt = extractor.getTrackFormat(i)
      val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("video/") && videoTrack < 0) {
        videoTrack = i
        videoFormat = fmt
      } else if (mime.startsWith("audio/") && audioTrack < 0) {
        audioTrack = i
        audioFormat = fmt
      }
    }
    val vFmt = videoFormat ?: run {
      extractor.release()
      throw IllegalStateException("A forrásban nincs videósáv.")
    }

    val rotation = if (vFmt.containsKey(MediaFormat.KEY_ROTATION)) vFmt.getInteger(MediaFormat.KEY_ROTATION) else 0
    val srcW = vFmt.getInteger(MediaFormat.KEY_WIDTH)
    val srcH = vFmt.getInteger(MediaFormat.KEY_HEIGHT)
    val dispW = if (rotation == 90 || rotation == 270) srcH else srcW
    val dispH = if (rotation == 90 || rotation == 270) srcW else srcH

    val out = File(outputPath)
    out.parentFile?.mkdirs()
    if (out.exists()) out.delete()

    var encoder: MediaCodec? = null
    var decoder: MediaCodec? = null
    var inputSurface: InputSurface? = null
    var outputSurface: OutputSurface? = null
    var muxer: MediaMuxer? = null

    try {
      // Sebesség-váltásnál a hangot külön decode→resample→AAC ágon hozzuk időbe
      // (a videó-codecek előtt, hogy ne fusson egyszerre túl sok codec). speed==1 → sima copy.
      val reencodeAudio = playbackSpeed != 1.0
      val encodedAudio = if (reencodeAudio && audioTrack >= 0 && audioFormat != null) {
        AudioSpeedEncoder.encode(srcPath, audioTrack, startUs, endUs, playbackSpeed)
      } else {
        null
      }

      // ── enkóder (cél-vászon) + GL input-surface ──
      val outFormat = MediaFormat.createVideoFormat(VIDEO_MIME, canvasW, canvasH)
      outFormat.setInteger(
        MediaFormat.KEY_COLOR_FORMAT,
        MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
      )
      outFormat.setInteger(MediaFormat.KEY_BIT_RATE, bitRateFor(canvasW, canvasH))
      outFormat.setInteger(MediaFormat.KEY_FRAME_RATE, if (fps > 0) fps else 30)
      outFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      encoder = MediaCodec.createEncoderByType(VIDEO_MIME)
      encoder.configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      inputSurface = InputSurface(encoder.createInputSurface())
      inputSurface.makeCurrent()
      encoder.start()

      // ── dekóder → GL output-surface (az enkóder kontextusában jön létre) ──
      outputSurface = OutputSurface()
      outputSurface.setAspectFill(dispW, dispH, canvasW, canvasH)
      val decoderMime = vFmt.getString(MediaFormat.KEY_MIME)!!
      decoder = MediaCodec.createDecoderByType(decoderMime)
      decoder.configure(vFmt, outputSurface.surface, null, 0)
      decoder.start()

      extractor.selectTrack(videoTrack)
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

      muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      var muxVideoTrack = -1
      var muxAudioTrack = -1
      var muxerStarted = false

      val info = MediaCodec.BufferInfo()
      var decoderInputDone = false
      var decoderOutputDone = false
      var encoderOutputDone = false
      var firstPtsUs = -1L
      val spanUs = if (endUs == Long.MAX_VALUE) 0L else (endUs - startUs)
      var lastEmitted = 0.0
      onProgress(0.02)

      while (!encoderOutputDone) {
        // 1) dekóder etetése a video-sávból a [.., endUs] tartományig
        if (!decoderInputDone) {
          val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val sampleTime = extractor.sampleTime
            if (sampleTime < 0L || (endUs != Long.MAX_VALUE && sampleTime > endUs)) {
              decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              decoderInputDone = true
            } else {
              val buf = decoder.getInputBuffer(inIndex)!!
              val size = extractor.readSampleData(buf, 0)
              if (size < 0) {
                decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                decoderInputDone = true
              } else {
                decoder.queueInputBuffer(inIndex, 0, size, sampleTime, 0)
                extractor.advance()
              }
            }
          }
        }

        // 2) dekóder ürítése → GL-rajz az enkóder surface-ére (tartományon belül)
        if (!decoderOutputDone) {
          val outIndex = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
          if (outIndex >= 0) {
            val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            val ptsUs = info.presentationTimeUs
            val render = info.size > 0 &&
              ptsUs >= startUs &&
              (endUs == Long.MAX_VALUE || ptsUs <= endUs)
            decoder.releaseOutputBuffer(outIndex, render)
            if (render) {
              outputSurface.awaitNewImage()
              outputSurface.drawImage()
              if (firstPtsUs < 0L) firstPtsUs = ptsUs
              val outPtsUs = ((ptsUs - firstPtsUs).toDouble() / playbackSpeed).toLong()
              inputSurface.setPresentationTime(outPtsUs * 1000L)
              inputSurface.swapBuffers()
              if (spanUs > 0L) {
                val p = ((ptsUs - startUs).toDouble() / spanUs).coerceIn(0.0, 0.98)
                if (p - lastEmitted >= 0.02) {
                  onProgress(p)
                  lastEmitted = p
                }
              }
            }
            if (eos) {
              encoder.signalEndOfInputStream()
              decoderOutputDone = true
            }
          }
        }

        // 3) enkóder ürítése → muxer
        val encIndex = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
        if (encIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          if (muxerStarted) throw RuntimeException("az enkóder-formátum kétszer változott")
          muxVideoTrack = muxer.addTrack(encoder.outputFormat)
          if (reencodeAudio) {
            if (encodedAudio != null) muxAudioTrack = muxer.addTrack(encodedAudio.format)
          } else if (audioTrack >= 0 && audioFormat != null) {
            muxAudioTrack = muxer.addTrack(audioFormat)
          }
          muxer.start()
          muxerStarted = true
          // a (sebesség-korrigált) hang-csomagokat azonnal kiírjuk
          if (reencodeAudio && encodedAudio != null && muxAudioTrack >= 0) {
            val audioInfo = MediaCodec.BufferInfo()
            for (pkt in encodedAudio.packets) {
              audioInfo.offset = 0
              audioInfo.size = pkt.data.size
              audioInfo.presentationTimeUs = pkt.ptsUs
              audioInfo.flags = pkt.flags
              muxer.writeSampleData(muxAudioTrack, ByteBuffer.wrap(pkt.data), audioInfo)
            }
          }
        } else if (encIndex >= 0) {
          val encBuf = encoder.getOutputBuffer(encIndex)!!
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
            info.size = 0 // a codec-config nem minta
          }
          if (info.size > 0 && muxerStarted) {
            encBuf.position(info.offset)
            encBuf.limit(info.offset + info.size)
            muxer.writeSampleData(muxVideoTrack, encBuf, info)
          }
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          encoder.releaseOutputBuffer(encIndex, false)
          if (eos) encoderOutputDone = true
        }
      }

      // ── hang-sáv változatlan átmásolása (csak speed==1; a resample-elt már kint van) ──
      if (!reencodeAudio && audioTrack >= 0 && audioFormat != null && muxAudioTrack >= 0) {
        copyAudio(srcPath, audioTrack, startUs, endUs, if (firstPtsUs >= 0L) firstPtsUs else startUs, muxer, muxAudioTrack, audioFormat)
      }

      muxer.stop()
      onProgress(1.0)
      return out.absolutePath
    } catch (e: Exception) {
      try {
        if (out.exists()) out.delete()
      } catch (_: Exception) {
      }
      throw e
    } finally {
      try { decoder?.stop() } catch (_: Exception) {}
      try { decoder?.release() } catch (_: Exception) {}
      try { encoder?.stop() } catch (_: Exception) {}
      try { encoder?.release() } catch (_: Exception) {}
      try { outputSurface?.release() } catch (_: Exception) {}
      try { inputSurface?.release() } catch (_: Exception) {}
      try { muxer?.release() } catch (_: Exception) {}
      extractor.release()
    }
  }

  private fun copyAudio(
    srcPath: String,
    audioTrack: Int,
    startUs: Long,
    endUs: Long,
    ptsOffsetUs: Long,
    muxer: MediaMuxer,
    muxAudioTrack: Int,
    audioFormat: MediaFormat,
  ) {
    val ex = MediaExtractor()
    ex.setDataSource(srcPath)
    ex.selectTrack(audioTrack)
    ex.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
    val maxInput =
      if (audioFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
        min(max(audioFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE), 64 * 1024), 2 shl 20)
      } else {
        256 * 1024
      }
    val buffer = ByteBuffer.allocate(maxInput)
    val info = MediaCodec.BufferInfo()
    try {
      while (true) {
        val sampleTime = ex.sampleTime
        if (sampleTime < 0L) break
        if (endUs != Long.MAX_VALUE && sampleTime > endUs) break
        val size = ex.readSampleData(buffer, 0)
        if (size < 0) break
        info.offset = 0
        info.size = size
        info.presentationTimeUs = max(0L, sampleTime - ptsOffsetUs)
        info.flags =
          if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
            MediaCodec.BUFFER_FLAG_KEY_FRAME
          } else {
            0
          }
        muxer.writeSampleData(muxAudioTrack, buffer, info)
        ex.advance()
      }
    } finally {
      ex.release()
    }
  }

  private fun bitRateFor(w: Int, h: Int): Int = (w.toLong() * h.toLong() * 4L).toInt().coerceIn(2_000_000, 24_000_000)

  private fun evenDim(n: Int): Int = if (n % 2 == 0) n else n + 1
}
