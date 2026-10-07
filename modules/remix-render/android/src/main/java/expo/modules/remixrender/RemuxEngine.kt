package expo.modules.remixrender

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Fázis A remux-motor — szándékosan **Expo-független** (nincs `Module`/`sendEvent`
 * függés), hogy instrumentált teszttel az emulátoron/eszközön is futtatható legyen
 * (lásd `android/app/src/androidTest/.../RemuxEngineTest.kt`).
 *
 * A kijelölt `[inSec, inSec+durationSec]` tartományt a forrás összes sávjával
 * (videó + hang) ÚJRAKÓDOLÁS NÉLKÜL muxolja ki: `MediaExtractor` → `MediaMuxer`.
 * A videó a tartomány elé eső legközelebbi keyframe-től indul
 * (`SEEK_TO_PREVIOUS_SYNC`) — így dekódolható marad —, a kimeneti PTS pedig 0-ra
 * tolódik. Nem skáláz: ha a klip képaránya eltér a vászonétól, kivételt dob (a
 * hívó a felhő-renderre esik vissza).
 */
object RemuxEngine {
  /**
   * @param planWidth/planHeight a cél-vászon; ha >0, a forrás képarányát ehhez
   *   méri (eltérés → kivétel). 0 esetén a képarány-ellenőrzés kimarad.
   * @return a kész kimeneti fájl abszolút elérési útja (file:// előtag NÉLKÜL).
   */
  fun remuxTrim(
    srcPath: String,
    inSec: Double,
    durationSec: Double,
    planWidth: Int,
    planHeight: Int,
    isCancelled: () -> Boolean = { false },
    outputPath: String,
    onProgress: (Double) -> Unit,
  ): String {
    val startUs = (inSec * 1_000_000.0).toLong()
    val endUs =
      if (durationSec > 0.0) ((inSec + durationSec) * 1_000_000.0).toLong() else Long.MAX_VALUE

    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(srcPath)
    } catch (e: Exception) {
      extractor.release()
      throw e
    }
    val out = File(outputPath)
    var muxer: MediaMuxer? = null
    try {
      // 1) sávok begyűjtése + képarány-ellenőrzés + buffer-méret
      val formats = ArrayList<Pair<Int, MediaFormat>>()
      var maxInputSize = 1 shl 20 // 1 MB alsó korlát
      var rotation = 0
      var hasVideo = false
      for (i in 0 until extractor.trackCount) {
        val fmt = extractor.getTrackFormat(i)
        val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/")) {
          hasVideo = true
          rotation = if (fmt.containsKey(MediaFormat.KEY_ROTATION)) {
            fmt.getInteger(MediaFormat.KEY_ROTATION)
          } else {
            0
          }
          val w = fmt.getInteger(MediaFormat.KEY_WIDTH)
          val h = fmt.getInteger(MediaFormat.KEY_HEIGHT)
          val dispW = if (rotation == 90 || rotation == 270) h else w
          val dispH = if (rotation == 90 || rotation == 270) w else h
          if (planWidth > 0 && planHeight > 0) {
            val srcAspect = dispW.toDouble() / dispH.toDouble()
            val planAspect = planWidth.toDouble() / planHeight.toDouble()
            if (abs(srcAspect - planAspect) > 0.02) {
              // nem remuxolható — a hívó a transzkódra (Fázis B) vált
              throw AspectMismatchException(
                "A klip képaránya ($dispW×$dispH) eltér a vászonétól ($planWidth×$planHeight) — skálázás kell."
              )
            }
          }
          formats.add(Pair(i, fmt))
        } else if (mime.startsWith("audio/")) {
          formats.add(Pair(i, fmt))
        }
        if (fmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
          maxInputSize = max(maxInputSize, fmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
        }
      }
      if (!hasVideo) {
        throw IllegalStateException("A forrásban nincs videósáv.")
      }
      maxInputSize = min(maxInputSize, 12 shl 20) // 12 MB felső korlát (OOM-védelem)

      // 2) muxer felépítése + sávok leképezése
      out.parentFile?.mkdirs()
      if (out.exists()) out.delete()
      muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val indexMap = HashMap<Int, Int>()
      for ((track, fmt) in formats) {
        indexMap[track] = muxer.addTrack(fmt)
        extractor.selectTrack(track)
      }
      if (rotation != 0) muxer.setOrientationHint(rotation)
      muxer.start()

      // 3) keyframe-igazított seek + minta-másolás a tartományon
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val buffer = ByteBuffer.allocate(maxInputSize)
      val info = MediaCodec.BufferInfo()
      val totalUs = if (endUs == Long.MAX_VALUE) 0L else (endUs - startUs)
      var firstPtsUs = -1L
      var lastEmitted = 0.0
      onProgress(0.02)

      while (true) {
        if (isCancelled()) throw RenderCancelledException()
        val sampleTime = extractor.sampleTime
        if (sampleTime < 0L) break // EOS
        if (endUs != Long.MAX_VALUE && sampleTime > endUs) break
        val muxTrack = indexMap[extractor.sampleTrackIndex]
        if (muxTrack == null) {
          extractor.advance()
          continue
        }
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        if (firstPtsUs < 0L) firstPtsUs = sampleTime
        info.offset = 0
        info.size = size
        info.presentationTimeUs = max(0L, sampleTime - firstPtsUs)
        info.flags =
          if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
            MediaCodec.BUFFER_FLAG_KEY_FRAME
          } else {
            0
          }
        muxer.writeSampleData(muxTrack, buffer, info)

        if (totalUs > 0L) {
          val p = ((sampleTime - startUs).toDouble() / totalUs).coerceIn(0.0, 0.99)
          if (p - lastEmitted >= 0.02) {
            onProgress(p)
            lastEmitted = p
          }
        }
        extractor.advance()
      }

      muxer.stop()
      onProgress(1.0)
      return out.absolutePath
    } catch (e: Exception) {
      try {
        if (out.exists()) out.delete()
      } catch (_: Exception) {
        // takarítási hiba — az eredeti kivételt dobjuk tovább
      }
      throw e
    } finally {
      try {
        muxer?.release()
      } catch (_: Exception) {
      }
      extractor.release()
    }
  }
}
