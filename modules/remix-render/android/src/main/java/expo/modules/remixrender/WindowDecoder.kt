package expo.modules.remixrender

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong
import kotlin.math.sin

/**
 * 🎧 Hosszú forrás szakaszosan Androidon — az iOS `decodeWindow` (AVAssetReader) párja: a fájlnak
 * CSAK a `[start, start + duration)` ablakát dekódolja, 44,1 kHz-es, összefésült float32-ként a
 * kimeneti fájlba (legfeljebb 2 csatorna). A JS (`longSource.ts`) ±0,1 s ráhagyással kéri, és a
 * ráhagyást levágja — így a mintavétel-átalakító szélei nem esnek a hallható részbe.
 *
 * - Keresés a kezdet előtt 0,3 s-mal (a tömörített kodekek bejáratása), a minták helye az
 *   időbélyegükből (frame-index) — a kért tartomány mintára pontos.
 * - 44,1 kHz-es forrásnál bitpontos másolás; más mintavételnél Blackman-ablakos sinc-interpoláció
 *   (nem lineáris: a 48 → 44,1 kHz-nél a lineáris aliasol és tompít).
 * - 16 bites és float kimenetű dekódert is kezel.
 */
object WindowDecoder {
  private const val OUT_SR = 44100
  /** ennyi frame-mel a kért rész előtt kezd (a bit-tartály és a szűrőbank bejáratása) */
  private const val MP3_WARM_FRAMES = 10
  private val mp3Cache = LinkedHashMap<String, Mp3Index>()
  private fun mp3Index(path: String): Mp3Index? = synchronized(mp3Cache) {
    mp3Cache[path] ?: Mp3Index.build(path)?.also {
      mp3Cache[path] = it
      if (mp3Cache.size > 4) mp3Cache.remove(mp3Cache.keys.first())
    }
  }
  private const val TIMEOUT_US = 10_000L
  /** a sinc-mag fél-szélessége (forrás-mintában, levágásnál nagyobb) */
  private const val TAPS = 24

  class Result(val frames: Int, val channels: Int, val encoderDelay: Int, val firstPtsUs: Long, val mime: String, val outInfo: String)

  fun decodeWindow(srcPath: String, startSec: Double, durSec: Double, outPath: String): Result {
    val ex = MediaExtractor()
    ex.setDataSource(srcPath)
    val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      ?: run { ex.release(); throw IllegalArgumentException("nincs hangsáv") }
    ex.selectTrack(track)
    val inFormat = ex.getTrackFormat(track)
    val mime = inFormat.getString(MediaFormat.KEY_MIME)!!
    var srcRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var srcCh = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val encoderDelay = if (inFormat.containsKey(MediaFormat.KEY_ENCODER_DELAY)) inFormat.getInteger(MediaFormat.KEY_ENCODER_DELAY) else 0
    var firstPts = -1L
    val start = max(0.0, startSec)
    val outFrames = max(0L, (durSec * OUT_SR).roundToLong()).toInt()

    // 🎧 mp3: saját frame-index (az extractor mp3-keresése pontatlan) — a frame-ek közvetlenül a dekódernek
    val mp3 = if (mime == "audio/mpeg") mp3Index(srcPath) else null
    val decoder = MediaCodec.createDecoderByType(mime)
    decoder.configure(inFormat, null, null, 0)
    decoder.start()
    var nextFrame = 0
    var mp3Base = 0L
    var mp3Delay = 0L
    var mp3File: java.io.RandomAccessFile? = null
    if (mp3 != null) {
      srcRate = mp3.sampleRate
      // a tartalom 0. mintája = a dekódolt folyam 0. mintája: az Android mp3-dekódere a formátum
      // `encoder-delay` kulcsából maga levágja a kódoló (576) és a saját (529) késleltetését — mérve:
      // a 576 + 529 levonásával mindhárom helyen (1 s, 40 s, 22 perc) pontosan −1105 minta lett
      val delay = 0L
      mp3Delay = delay
      val need = floor(start * srcRate).toLong() - TAPS * 4 + delay
      nextFrame = max(0L, need / mp3.samplesPerFrame - MP3_WARM_FRAMES).toInt()
      mp3Base = nextFrame.toLong() * mp3.samplesPerFrame - delay
      mp3File = java.io.RandomAccessFile(srcPath, "r")
    } else {
      ex.seekTo(max(0.0, start - 0.3).times(1e6).toLong(), MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    }
    var mp3Out = 0L

    // a gyűjtött forrás-minták (csatornánként), az első frame indexe a forrásban
    var buf = Array(2) { FloatArray(0) }
    var have = 0
    var firstFrame = -1L
    var pcmFloat = false
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    // a szükséges forrás-tartomány (frame) — a mintavétel-átalakító mag széleivel
    fun needFrom() = floor(start * srcRate).toLong() - TAPS * 4
    fun needTo() = ((start + durSec) * srcRate).toLong() + TAPS * 4 + 2
    try {
      while (!outputDone) {
        if (!inputDone) {
          val inIndex = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIndex >= 0 && mp3 != null) {
            // a következő mp3-frame a saját indexből (pontos hely és sorszám)
            // a frame tartalmi sorszáma (frame · minta − késleltetés) a kért vég után → kész
            if (nextFrame >= mp3.count || nextFrame.toLong() * mp3.samplesPerFrame - mp3Delay > needTo() + mp3.samplesPerFrame * 2) {
              decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              val bytes = ByteArray(mp3.sizes[nextFrame])
              mp3File!!.seek(mp3.offsets[nextFrame])
              mp3File.readFully(bytes)
              val ib = decoder.getInputBuffer(inIndex)!!
              ib.clear()
              ib.put(bytes)
              decoder.queueInputBuffer(inIndex, 0, bytes.size, nextFrame.toLong() * mp3.samplesPerFrame * 1_000_000L / srcRate, 0)
              nextFrame++
            }
          } else if (inIndex >= 0) {
            val size = ex.readSampleData(decoder.getInputBuffer(inIndex)!!, 0)
            if (size < 0) {
              decoder.queueInputBuffer(inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(inIndex, 0, size, ex.sampleTime, 0)
              ex.advance()
            }
          }
        }
        val outIndex = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
        if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val f = decoder.outputFormat
          if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) srcRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) srcCh = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          pcmFloat = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
        } else if (outIndex >= 0) {
          if (info.size > 0) {
            // mp3: a dekódolt minták folytonos sorszáma (a betáplált első frame-től), nem az időbélyeg
            val frame0 = if (mp3 != null) mp3Base + mp3Out else (info.presentationTimeUs * srcRate / 1_000_000.0).roundToLong()
            val bb = decoder.getOutputBuffer(outIndex)!!.duplicate().order(ByteOrder.LITTLE_ENDIAN)
            bb.position(info.offset)
            bb.limit(info.offset + info.size)
            val bytesPerSample = if (pcmFloat) 4 else 2
            val n = info.size / (bytesPerSample * srcCh)
            if (mp3 != null) mp3Out += n
            if (firstFrame < 0) {
              firstFrame = frame0
              firstPts = info.presentationTimeUs
            }
            // a gyűjtés a frame-indexek szerint (a puffer helye a firstFrame-től)
            val at = (frame0 - firstFrame).toInt()
            if (at >= 0 && frame0 + n >= needFrom()) {
              val need = at + n
              if (need > buf[0].size) buf = Array(2) { c -> buf[c].copyOf(max(need, buf[c].size * 2)) }
              for (i in 0 until n) {
                for (c in 0 until min(2, srcCh)) {
                  val v = if (pcmFloat) bb.getFloat() else bb.getShort() / 32768f
                  buf[c][at + i] = v
                }
                for (c in 2 until srcCh) if (pcmFloat) bb.getFloat() else bb.getShort()
              }
              have = max(have, need)
            }
            if (frame0 > needTo()) outputDone = true
          }
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          decoder.releaseOutputBuffer(outIndex, false)
        }
      }
    } finally {
      try { decoder.stop() } catch (_: Exception) {}
      try { decoder.release() } catch (_: Exception) {}
      ex.release()
      mp3File?.close()
    }

    val ch = max(1, min(2, srcCh))
    val out = ByteBuffer.allocate(outFrames * ch * 4).order(ByteOrder.LITTLE_ENDIAN)
    val base = firstFrame.coerceAtLeast(0)
    if (srcRate == OUT_SR) {
      // bitpontos: az ablak eleje egész minta
      val s0 = (start * OUT_SR).roundToLong()
      for (i in 0 until outFrames) {
        val k = (s0 + i - base).toInt()
        for (c in 0 until ch) out.putFloat(if (k in 0 until have) buf[c][k] else 0f)
      }
    } else {
      // Blackman-ablakos sinc: a levágás a kisebbik Nyquist 95%-a. A mag előre kiszámolt táblából
      // (egységenként 512 pont, lineáris interpolációval), a súlyok kimeneti mintánként egyszer, a
      // csatornák közvetlenül a tömbből — lambda (dobozolt Long/Double) nélkül (mérve: a lambdás
      // változat 48 kHz-es 20 s-os ablakon az emulátoron ~9 s volt)
      val ratio = srcRate.toDouble() / OUT_SR
      val cutoff = 0.95 * min(1.0, 1.0 / ratio)
      val half = (TAPS / cutoff).toInt()
      val res = 512
      val limit = half * res
      val table = FloatArray(limit + 2) { j ->
        val x = j.toDouble() / res
        val sinc = if (x < 1e-9) 1.0 else sin(PI * x * cutoff) / (PI * x * cutoff)
        val w = if (x >= half) 0.0 else 0.42 + 0.5 * cos(PI * x / half) + 0.08 * cos(2 * PI * x / half)
        (cutoff * sinc * w).toFloat()
      }
      val taps = 2 * half
      // a súly-minta `period` kimeneti mintánként ismétlődik (48 → 44,1 kHz: 147), ezért fázisonként
      // egyszer számolódik; a fázis az ablak kezdetétől számít (a kezdő tört rész mindegyikben ugyanaz)
      var g = srcRate; var h = OUT_SR
      while (h != 0) { val r = g % h; g = h; h = r }
      val period = OUT_SR / g
      val cache = if (period <= 4096) FloatArray(period * taps) else null
      val filled = BooleanArray(if (cache != null) period else 0)
      val scratch = FloatArray(taps)
      // a pozíció a fázisból: p0 + (i / period)·(srcRate / g) + (f0 + fázis·ratio) — így ugyanaz a
      // fázis mindig ugyanazt a tört részt és egész lépést adja (a mintánkénti lebegőpontos számolás
      // egész-közeli pozíción hol 0,9999-et, hol 0,0000-t adott: a tárolt súly egy mintát csúszott)
      val p0 = start * srcRate
      val base0 = floor(p0).toLong()
      val f0 = p0 - base0
      val step = (srcRate / g).toLong()
      for (i in 0 until outFrames) {
        val phase = if (cache != null) i % period else -1
        val offs = if (cache != null) f0 + phase * ratio else f0 + i * ratio
        val whole = floor(offs).toLong()
        val frac = offs - whole
        val centre = base0 + (if (cache != null) (i / period) * step + whole else whole)
        val weights: FloatArray
        val w0: Int
        if (cache != null && filled[phase]) {
          weights = cache; w0 = phase * taps
        } else {
          for (t in 0 until taps) {
            // a k = t − half + 1 mag-pont távolsága: |pos − (centre + k)|
            val ax = abs(frac - (t - half + 1)) * res
            val j = ax.toInt()
            scratch[t] = if (j >= limit) 0f else { val f = (ax - j).toFloat(); table[j] + (table[j + 1] - table[j]) * f }
          }
          if (cache != null) {
            System.arraycopy(scratch, 0, cache, phase * taps, taps)
            filled[phase] = true
            weights = cache; w0 = phase * taps
          } else {
            weights = scratch; w0 = 0
          }
        }
        val k0 = (centre - half + 1 - base).toInt()
        for (c in 0 until ch) {
          val src = buf[c]
          var acc = 0f
          if (k0 >= 0 && k0 + taps <= have) {
            for (t in 0 until taps) acc += src[k0 + t] * weights[w0 + t]
          } else {
            for (t in 0 until taps) {
              val k = k0 + t
              if (k in 0 until have) acc += src[k] * weights[w0 + t]
            }
          }
          out.putFloat(acc)
        }
      }
    }
    BufferedOutputStream(FileOutputStream(File(outPath))).use { it.write(out.array()) }
    return Result(outFrames, ch, encoderDelay, firstPts, mime, "rate=$srcRate ch=$srcCh float=$pcmFloat have=$have first=$firstFrame")
  }
}
