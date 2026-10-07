package expo.modules.remixrender

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Fázis B2 (hang-ág) — a forrás hangsávját a `[startUs, endUs]` tartományra vágja,
 * a `speed` szerint **újramintázza** (PCM lineáris interpoláció → a hossz
 * `/speed`-re változik, a videóval szinkronban marad), majd **AAC-re
 * újrakódolja**. A kész AAC-csomagokat + a muxer-hez kellő kimeneti formátumot
 * adja vissza (a [TranscodeEngine] a videó-track mellé fűzi egy muxerbe).
 *
 * ⚠️ Egyszerű lineáris resample → a hangmagasság a sebességgel változik
 * (gyorsításnál magasabb). A hangmagasság-tartó tempóváltás (WSOLA/Sonic) külön,
 * követő lépés; a felhő-render AVFoundation/FFmpeg-gel tempó-korrektet ad.
 */
object AudioSpeedEncoder {
  private const val TIMEOUT_US = 10_000L
  private const val AAC_MIME = "audio/mp4a-latm"

  class Encoded(
    val format: MediaFormat,
    val packets: List<Packet>,
  )

  class Packet(val data: ByteArray, val ptsUs: Long, val flags: Int)

  /** `null`, ha nincs dekódolható/újrakódolható hang (a hívó ilyenkor hang nélkül folytat). */
  fun encode(
    srcPath: String,
    audioTrack: Int,
    startUs: Long,
    endUs: Long,
    speed: Double,
  ): Encoded? {
    // 1) dekódolás PCM-re a tartományon
    val extractor = MediaExtractor()
    extractor.setDataSource(srcPath)
    extractor.selectTrack(audioTrack)
    val inFormat = extractor.getTrackFormat(audioTrack)
    val decoderMime = inFormat.getString(MediaFormat.KEY_MIME) ?: return null
    val decoder = MediaCodec.createDecoderByType(decoderMime)
    decoder.configure(inFormat, null, null, 0)
    decoder.start()
    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val pcm = ByteArrayOutputStream()
    var sampleRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone) {
        if (!inputDone) {
          val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val sampleTime = extractor.sampleTime
            if (sampleTime < 0L || (endUs != Long.MAX_VALUE && sampleTime > endUs)) {
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
        if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val f = decoder.outputFormat
          if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        } else if (outIndex >= 0) {
          val ptsUs = info.presentationTimeUs
          if (info.size > 0 && ptsUs >= startUs && (endUs == Long.MAX_VALUE || ptsUs <= endUs)) {
            val outBuf = decoder.getOutputBuffer(outIndex)!!
            val chunk = ByteArray(info.size)
            outBuf.position(info.offset)
            outBuf.get(chunk, 0, info.size)
            pcm.write(chunk)
          }
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          decoder.releaseOutputBuffer(outIndex, false)
        }
      }
    } finally {
      try { decoder.stop() } catch (_: Exception) {}
      try { decoder.release() } catch (_: Exception) {}
      extractor.release()
    }

    if (channels <= 0 || sampleRate <= 0) return null
    val inBytes = pcm.toByteArray()
    if (inBytes.isEmpty()) return null

    // 2) PCM újramintázás a sebesség szerint (16-bit LE, interleaved)
    val resampled = resample(inBytes, channels, speed)

    // 3) AAC-újrakódolás
    return encodeAac(resampled, sampleRate, channels)
  }

  private fun resample(pcm: ByteArray, channels: Int, speed: Double): ByteArray {
    val bytesPerFrame = 2 * channels
    val inFrames = pcm.size / bytesPerFrame
    if (inFrames <= 1 || speed == 1.0) return pcm
    val outFrames = max(1, (inFrames / speed).toInt())
    val out = ByteArray(outFrames * bytesPerFrame)
    for (j in 0 until outFrames) {
      val srcPos = j * speed
      val i0 = srcPos.toInt()
      val i1 = min(i0 + 1, inFrames - 1)
      val frac = srcPos - i0
      for (c in 0 until channels) {
        val s0 = readSample(pcm, i0, c, channels)
        val s1 = readSample(pcm, i1, c, channels)
        val v = (s0 + (s1 - s0) * frac).toInt().coerceIn(-32768, 32767)
        val off = (j * channels + c) * 2
        out[off] = (v and 0xFF).toByte()
        out[off + 1] = ((v shr 8) and 0xFF).toByte()
      }
    }
    return out
  }

  private fun readSample(pcm: ByteArray, frame: Int, ch: Int, channels: Int): Int {
    val off = (frame * channels + ch) * 2
    val lo = pcm[off].toInt() and 0xFF
    val hi = pcm[off + 1].toInt()
    return (hi shl 8) or lo
  }

  private fun encodeAac(pcm: ByteArray, sampleRate: Int, channels: Int): Encoded? {
    val format = MediaFormat.createAudioFormat(AAC_MIME, sampleRate, channels)
    format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
    format.setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    val encoder = MediaCodec.createEncoderByType(AAC_MIME)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    encoder.start()

    val packets = ArrayList<Packet>()
    var outFormat: MediaFormat? = null
    val info = MediaCodec.BufferInfo()
    val bytesPerFrame = 2 * channels
    var inputOffset = 0
    var framesSubmitted = 0L
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone) {
        if (!inputDone) {
          val inIndex = encoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0) {
            val inBuf = encoder.getInputBuffer(inIndex)!!
            val capacity = inBuf.capacity()
            val remaining = pcm.size - inputOffset
            if (remaining <= 0) {
              encoder.queueInputBuffer(inIndex, 0, 0, ptsForFrame(framesSubmitted, sampleRate), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              val chunk = min(capacity, remaining)
              // egész frame-ekre igazítva
              val aligned = (chunk / bytesPerFrame) * bytesPerFrame
              val toWrite = if (aligned > 0) aligned else chunk
              inBuf.clear()
              inBuf.put(pcm, inputOffset, toWrite)
              val pts = ptsForFrame(framesSubmitted, sampleRate)
              encoder.queueInputBuffer(inIndex, 0, toWrite, pts, 0)
              inputOffset += toWrite
              framesSubmitted += (toWrite / bytesPerFrame).toLong()
            }
          }
        }
        val outIndex = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
        if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          outFormat = encoder.outputFormat
        } else if (outIndex >= 0) {
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!isConfig && info.size > 0) {
            val outBuf = encoder.getOutputBuffer(outIndex)!!
            val data = ByteArray(info.size)
            outBuf.position(info.offset)
            outBuf.get(data, 0, info.size)
            packets.add(Packet(data, info.presentationTimeUs, info.flags))
          }
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          encoder.releaseOutputBuffer(outIndex, false)
        }
      }
    } finally {
      try { encoder.stop() } catch (_: Exception) {}
      try { encoder.release() } catch (_: Exception) {}
    }

    val fmt = outFormat ?: return null
    if (packets.isEmpty()) return null
    return Encoded(fmt, packets)
  }

  private fun ptsForFrame(frame: Long, sampleRate: Int): Long =
    (frame * 1_000_000.0 / sampleRate).toLong()
}
