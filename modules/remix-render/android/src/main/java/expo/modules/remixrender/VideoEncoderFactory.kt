package expo.modules.remixrender

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat

/** Fázis E — cél-kodek + bitráta a render-tervből (a RenderSettings-ből származik). */
class EncoderSpec(val codec: String = "h264", val bitRate: Int = 0)

/**
 * Fázis E — a videó-enkóder létrehozása a kívánt kodekkel: **HEVC**, ha az eszköz
 * enkódere támogatja (kisebb fájl), különben **H.264-fallback**. A bitráta a
 * tervből jön (0 = automatikus a felbontásból). A dekódolt-surface-input mód
 * közös a transzkód/kompozit pipeline-nal.
 */
object VideoEncoderFactory {
  private const val H264 = "video/avc"
  private const val HEVC = "video/hevc"

  class Configured(val codec: MediaCodec, val mime: String, val hevc: Boolean)

  fun createConfigured(width: Int, height: Int, fps: Int, spec: EncoderSpec): Configured {
    val wantHevc = spec.codec.equals("hevc", ignoreCase = true)
    val bitRate = if (spec.bitRate > 0) spec.bitRate else bitRateFor(width, height)
    val frameRate = if (fps > 0) fps else 30
    val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)

    var mime = if (wantHevc) HEVC else H264
    var format = buildFormat(mime, width, height, frameRate, bitRate)
    var encName = list.findEncoderForFormat(format)
    if (encName == null && wantHevc) {
      // nincs HEVC-enkóder ezen az eszközön → H.264-fallback
      mime = H264
      format = buildFormat(mime, width, height, frameRate, bitRate)
      encName = list.findEncoderForFormat(format)
    }
    val encoder =
      if (encName != null) MediaCodec.createByCodecName(encName) else MediaCodec.createEncoderByType(mime)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    return Configured(encoder, mime, mime == HEVC)
  }

  private fun buildFormat(mime: String, w: Int, h: Int, fps: Int, bitRate: Int): MediaFormat {
    val f = MediaFormat.createVideoFormat(mime, w, h)
    f.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
    f.setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
    f.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
    f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    return f
  }

  fun bitRateFor(w: Int, h: Int): Int =
    (w.toLong() * h.toLong() * 4L).toInt().coerceIn(2_000_000, 24_000_000)
}
