package expo.modules.remixrender

import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Fázis C (hang) — több hang-forrás (videó-szegmensek saját hangja + külön
 * zene/voiceover sávok) **additív keverése** egy közös stereo/44.1k PCM-pufferbe
 * (forrásonként időbeli eltolás + hangerő + sebesség-retime + fel/le-mixelés),
 * majd AAC-újrakódolás a [PcmCodec]-kel. Ez adja az iOS AVFoundation-hangmix
 * párját az eszközön-renderhez.
 */
object AudioMixer {
  private const val MIX_RATE = 44_100
  private const val MIX_CH = 2

  /**
   * @param consumedUs a forrásból fogyasztott hossz (= `timelineDurUs * speed`);
   *   audio[] sávnál (speed=1) == `timelineDurUs`.
   */
  class Source(
    val srcPath: String,
    val trackIndex: Int,
    val inUs: Long,
    val consumedUs: Long,
    val timelineOffsetUs: Long,
    val timelineDurUs: Long,
    val volume: Float,
  )

  /** `null`, ha egyetlen forrás sem adott dekódolható hangot. */
  fun mix(sources: List<Source>, totalDurUs: Long): PcmCodec.Encoded? {
    if (sources.isEmpty() || totalDurUs <= 0L) return null
    val totalFrames = (totalDurUs / 1_000_000.0 * MIX_RATE).roundToInt()
    if (totalFrames <= 0) return null
    val accum = FloatArray(totalFrames * MIX_CH)
    var any = false

    for (s in sources) {
      val pcm = PcmCodec.decode(s.srcPath, s.trackIndex, s.inUs, s.inUs + s.consumedUs) ?: continue
      val pcmFrames = pcm.samples.size / pcm.channels
      if (pcmFrames <= 0) continue
      any = true
      val outStart = (s.timelineOffsetUs / 1_000_000.0 * MIX_RATE).roundToInt()
      val outLen = (s.timelineDurUs / 1_000_000.0 * MIX_RATE).roundToInt()
      if (outLen <= 0) continue
      val inSec = s.inUs / 1_000_000.0
      val consumedSec = s.consumedUs / 1_000_000.0
      val startSec = pcm.startUs / 1_000_000.0

      for (f in 0 until outLen) {
        val outFrame = outStart + f
        if (outFrame < 0) continue
        if (outFrame >= totalFrames) break
        // a kimeneti pozícióhoz tartozó forrás-idő (sebesség a consumedSec-ben van)
        val sourceSec = inSec + (f.toDouble() / outLen) * consumedSec
        val srcFrameF = (sourceSec - startSec) * pcm.sampleRate
        if (srcFrameF < 0.0) continue
        val i0 = min(srcFrameF.toInt(), pcmFrames - 1)
        val i1 = min(i0 + 1, pcmFrames - 1)
        val frac = (srcFrameF - i0).toFloat()
        val base = outFrame * MIX_CH
        for (cc in 0 until MIX_CH) {
          val sc = if (cc < pcm.channels) cc else 0 // mono → mindkét csatornára
          val a = pcm.samples[i0 * pcm.channels + sc].toInt()
          val b = pcm.samples[i1 * pcm.channels + sc].toInt()
          val v = (a + (b - a) * frac) * s.volume
          accum[base + cc] += v
        }
      }
    }
    if (!any) return null

    // float → 16-bit (clamp) → bytes
    val out = ByteArray(accum.size * 2)
    for (i in accum.indices) {
      val v = accum[i].roundToInt().coerceIn(-32768, 32767)
      out[i * 2] = (v and 0xFF).toByte()
      out[i * 2 + 1] = ((v shr 8) and 0xFF).toByte()
    }
    return PcmCodec.encodeAac(out, MIX_RATE, MIX_CH)
  }
}
