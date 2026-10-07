package expo.modules.remixrender

import kotlin.math.max
import kotlin.math.min

/**
 * Fázis B2 (hang-ág) — a forrás hangsávját a `[startUs, endUs]` tartományra vágja,
 * a `speed` szerint **újramintázza** (PCM lineáris interpoláció → a hossz
 * `/speed`-re változik, a videóval szinkronban marad), majd **AAC-re
 * újrakódolja** (a közös [PcmCodec]-kel).
 *
 * ⚠️ Egyszerű lineáris resample → a hangmagasság a sebességgel változik
 * (gyorsításnál magasabb). A hangmagasság-tartó tempóváltás (WSOLA/Sonic) külön,
 * követő lépés; a felhő-render tempó-korrektet ad.
 */
object AudioSpeedEncoder {
  /** `null`, ha nincs dekódolható/újrakódolható hang (a hívó ilyenkor hang nélkül folytat). */
  fun encode(
    srcPath: String,
    audioTrack: Int,
    startUs: Long,
    endUs: Long,
    speed: Double,
  ): PcmCodec.Encoded? {
    val pcm = PcmCodec.decode(srcPath, audioTrack, startUs, endUs) ?: return null
    val resampled = resample(pcm.samples, pcm.channels, speed)
    if (resampled.isEmpty()) return null
    return PcmCodec.encodeAac(resampled, pcm.sampleRate, pcm.channels)
  }

  /** 16-bit interleaved PCM (ShortArray) → sebesség szerint retime-olt ByteArray. */
  private fun resample(samples: ShortArray, channels: Int, speed: Double): ByteArray {
    val inFrames = samples.size / channels
    if (inFrames <= 1) return shortsToBytes(samples)
    if (speed == 1.0) return shortsToBytes(samples)
    val outFrames = max(1, (inFrames / speed).toInt())
    val out = ByteArray(outFrames * channels * 2)
    for (j in 0 until outFrames) {
      val srcPos = j * speed
      val i0 = srcPos.toInt()
      val i1 = min(i0 + 1, inFrames - 1)
      val frac = srcPos - i0
      for (c in 0 until channels) {
        val s0 = samples[i0 * channels + c].toInt()
        val s1 = samples[i1 * channels + c].toInt()
        val v = (s0 + (s1 - s0) * frac).toInt().coerceIn(-32768, 32767)
        val off = (j * channels + c) * 2
        out[off] = (v and 0xFF).toByte()
        out[off + 1] = ((v shr 8) and 0xFF).toByte()
      }
    }
    return out
  }

  private fun shortsToBytes(samples: ShortArray): ByteArray {
    val out = ByteArray(samples.size * 2)
    for (i in samples.indices) {
      val v = samples[i].toInt()
      out[i * 2] = (v and 0xFF).toByte()
      out[i * 2 + 1] = ((v shr 8) and 0xFF).toByte()
    }
    return out
  }
}
