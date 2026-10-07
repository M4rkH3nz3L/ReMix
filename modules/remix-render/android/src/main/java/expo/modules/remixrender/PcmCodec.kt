package expo.modules.remixrender

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.ByteArrayOutputStream
import kotlin.math.min

/**
 * Közös hang-mag: egy sáv dekódolása 16-bites PCM-re (ablakkal) + PCM→AAC
 * újrakódolás. A sebesség-enkóder (Fázis B2) és a multi-track mixer (Fázis C)
 * is erre épül.
 */
object PcmCodec {
  private const val TIMEOUT_US = 10_000L
  private const val AAC_MIME = "audio/mp4a-latm"

  class Encoded(val format: MediaFormat, val packets: List<Packet>)
  class Packet(val data: ByteArray, val ptsUs: Long, val flags: Int)

  /** Dekódolt PCM-ablak: interleaved 16-bit, a `startUs` az első minta ideje a forrásban. */
  class Pcm(val samples: ShortArray, val sampleRate: Int, val channels: Int, val startUs: Long)

  /** A megadott hang-sáv `[startUs, endUs]` ablakának dekódolása 16-bit PCM-re. */
  fun decode(srcPath: String, trackIndex: Int, startUs: Long, endUs: Long): Pcm? {
    val extractor = MediaExtractor()
    extractor.setDataSource(srcPath)
    extractor.selectTrack(trackIndex)
    val inFormat = extractor.getTrackFormat(trackIndex)
    val mime = inFormat.getString(MediaFormat.KEY_MIME) ?: return null
    val decoder = MediaCodec.createDecoderByType(mime)
    decoder.configure(inFormat, null, null, 0)
    decoder.start()
    extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    var sampleRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val bytes = ByteArrayOutputStream()
    var firstPtsUs = -1L
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
            if (firstPtsUs < 0L) firstPtsUs = ptsUs
            val outBuf = decoder.getOutputBuffer(outIndex)!!
            val chunk = ByteArray(info.size)
            outBuf.position(info.offset)
            outBuf.get(chunk, 0, info.size)
            bytes.write(chunk)
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

    if (sampleRate <= 0 || channels <= 0) return null
    val raw = bytes.toByteArray()
    if (raw.isEmpty()) return null
    val shorts = ShortArray(raw.size / 2)
    var j = 0
    var i = 0
    while (i + 1 < raw.size) {
      val lo = raw[i].toInt() and 0xFF
      val hi = raw[i + 1].toInt()
      shorts[j++] = ((hi shl 8) or lo).toShort()
      i += 2
    }
    return Pcm(shorts, sampleRate, channels, if (firstPtsUs >= 0L) firstPtsUs else startUs)
  }

  /** 16-bit interleaved PCM → AAC-LC. A kész csomagok + a muxerhez kellő formátum. */
  fun encodeAac(pcm: ByteArray, sampleRate: Int, channels: Int): Encoded? {
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
              val aligned = (chunk / bytesPerFrame) * bytesPerFrame
              val toWrite = if (aligned > 0) aligned else chunk
              inBuf.clear()
              inBuf.put(pcm, inputOffset, toWrite)
              encoder.queueInputBuffer(inIndex, 0, toWrite, ptsForFrame(framesSubmitted, sampleRate), 0)
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
