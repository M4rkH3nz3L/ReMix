package expo.modules.remixrender

import java.io.RandomAccessFile

/**
 * 🎧 MP3 frame-index: a fájl frame-fejléceiből (a hang dekódolása nélkül) minden frame helye és
 * hossza. Az Android MediaExtractor mp3-keresése pontatlan (mérve: a keresés utáni időbélyegek nem
 * a valódi helyet mutatják — a 40 s-os és a 22 perces ablak egyetlen eltolásnál sem illeszkedett),
 * ezért a szakaszos dekódolás mp3-nál ebből az indexből, frame-pontosan adja a dekódernek a hangot.
 * MPEG-1/2/2.5 Layer III; az ID3v2-címke és a Xing/Info (LAME) fejléc-frame kimarad.
 */
class Mp3Index private constructor(
  val offsets: LongArray,
  val sizes: IntArray,
  val count: Int,
  val sampleRate: Int,
  val samplesPerFrame: Int,
) {
  companion object {
    private val BITRATES_V1 = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
    private val BITRATES_V2 = intArrayOf(0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0)
    private val RATES_V1 = intArrayOf(44100, 48000, 32000, 0)

    fun build(path: String): Mp3Index? {
      RandomAccessFile(path, "r").use { f ->
        val len = f.length()
        var pos = 0L
        // ID3v2 címke átugrása (szinkron-biztos méret)
        val head = ByteArray(10)
        f.seek(0)
        if (f.read(head) == 10 && head[0] == 'I'.code.toByte() && head[1] == 'D'.code.toByte() && head[2] == '3'.code.toByte()) {
          val size = ((head[6].toInt() and 0x7f) shl 21) or ((head[7].toInt() and 0x7f) shl 14) or ((head[8].toInt() and 0x7f) shl 7) or (head[9].toInt() and 0x7f)
          pos = 10L + size + (if (head[5].toInt() and 0x10 != 0) 10 else 0)
        }
        var offsets = LongArray(4096)
        var sizes = IntArray(4096)
        var n = 0
        var rate = 0
        var spf = 0
        val buf = ByteArray(64 * 1024)
        var bufStart = -1L
        var bufLen = 0
        fun byteAt(p: Long): Int {
          if (p < bufStart || p >= bufStart + bufLen) {
            f.seek(p)
            bufLen = f.read(buf).coerceAtLeast(0)
            bufStart = p
            if (bufLen == 0) return -1
          }
          return buf[(p - bufStart).toInt()].toInt() and 0xff
        }
        while (pos + 4 <= len) {
          val b0 = byteAt(pos)
          val b1 = byteAt(pos + 1)
          if (b0 != 0xff || (b1 and 0xe0) != 0xe0) {
            pos++
            continue
          }
          val b2 = byteAt(pos + 2)
          val version = (b1 shr 3) and 3 // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
          val layer = (b1 shr 1) and 3 // 1 = Layer III
          val brIdx = (b2 shr 4) and 0xf
          val srIdx = (b2 shr 2) and 3
          val padding = (b2 shr 1) and 1
          if (version == 1 || layer != 1 || brIdx == 0 || brIdx == 15 || srIdx == 3) {
            pos++
            continue
          }
          val v1 = version == 3
          val sr = RATES_V1[srIdx] / (if (v1) 1 else if (version == 2) 2 else 4)
          val br = (if (v1) BITRATES_V1 else BITRATES_V2)[brIdx] * 1000
          val size = (if (v1) 144 else 72) * br / sr + padding
          if (size < 24 || pos + size > len) break
          // a következő fejlécnek is ott kell lennie (hamis szinkron ellen) — az utolsó frame kivétel
          if (pos + size + 2 <= len) {
            val n0 = byteAt(pos + size)
            val n1 = byteAt(pos + size + 1)
            if (n0 != 0xff || (n1 and 0xe0) != 0xe0) {
              pos++
              continue
            }
          }
          if (n == offsets.size) {
            offsets = offsets.copyOf(n * 2)
            sizes = sizes.copyOf(n * 2)
          }
          offsets[n] = pos
          sizes[n] = size
          n++
          rate = sr
          spf = if (v1) 1152 else 576
          pos += size
        }
        if (n == 0) return null
        // Xing/Info (LAME) fejléc-frame: nem hang, kimarad
        f.seek(offsets[0])
        val first = ByteArray(minOf(sizes[0], 200))
        f.readFully(first)
        val s = String(first, Charsets.ISO_8859_1)
        val skip = if (s.contains("Xing") || s.contains("Info")) 1 else 0
        return Mp3Index(offsets.copyOfRange(skip, n), sizes.copyOfRange(skip, n), n - skip, rate, spf)
      }
    }
  }
}
