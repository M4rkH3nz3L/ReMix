package expo.modules.remixrender

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

/**
 * ⚡ A közös hang-DSP magjai (a `src/lib/dspKernels.ts` JS-változatának pontos tükre: float32 olvasás →
 * double számolás → float32 írás, ugyanaz a sorrend). Állapot nélküli: az állapot a JS `Float64Array`-ben.
 */
object DspKernels {
  private fun dbToLin(db: Double): Double = 10.0.pow(db / 20.0)

  private fun compGainDb(levelDb: Double, thr: Double, ratio: Double, knee: Double): Double {
    val over = levelDb - thr
    val half = knee / 2
    if (over <= -half) return 0.0
    if (over >= half) return (1 / ratio - 1) * over
    return ((1 / ratio - 1) * (over + half).pow(2)) / (2 * knee)
  }

  private fun highShelfNorm(f: Double, gainDb: Double, sr: Double): DoubleArray {
    val a = 10.0.pow(gainDb / 40.0)
    val w = (2 * Math.PI * f) / sr
    val c = cos(w)
    val alpha = (sin(w) / 2) * sqrt(2.0)
    val sq = 2 * sqrt(a) * alpha
    val b0 = a * (a + 1 + (a - 1) * c + sq)
    val b1 = -2 * a * (a - 1 + (a + 1) * c)
    val b2 = a * (a + 1 + (a - 1) * c - sq)
    val a0 = a + 1 - (a - 1) * c + sq
    val a1 = 2 * (a - 1 - (a + 1) * c)
    val a2 = a + 1 - (a - 1) * c - sq
    return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
  }

  private fun biquad(buf: FloatArray, n: Int, k: DoubleArray, ko: Int, s: DoubleArray, o: Int) {
    var x1 = s[o]; var x2 = s[o + 1]; var y1 = s[o + 2]; var y2 = s[o + 3]
    val b0 = k[ko]; val b1 = k[ko + 1]; val b2 = k[ko + 2]; val a1 = k[ko + 3]; val a2 = k[ko + 4]
    for (i in 0 until n) {
      val x = buf[i].toDouble()
      val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = x; y2 = y1; y1 = y
      buf[i] = y.toFloat()
    }
    s[o] = (x1); s[o + 1] = (x2); s[o + 2] = (y1); s[o + 3] = (y2)
  }

  fun run(kind: Int, l: FloatArray, r: FloatArray, n: Int, p: DoubleArray, st: DoubleArray, aux: FloatArray?, auxLen: Int) {
    when (kind) {
      0 -> { biquad(l, n, p, 0, st, 0); biquad(r, n, p, 0, st, 4) }
      1 -> {
        var env = st[0]
        val att = p[2]; val rel = p[3]
        for (i in 0 until n) {
          val li = l[i].toDouble(); val ri = r[i].toDouble()
          val pw = (li * li + ri * ri) / 2
          env += (pw - env) * (if (pw > env) att else rel)
          val g = if (env > 1e-12) dbToLin(compGainDb(10 * log10(env), p[0], p[1], p[4])) else 1.0
          l[i] = ((l[i].toDouble() * g).toFloat())
          r[i] = ((r[i].toDouble() * g).toFloat())
        }
        st[0] = (env)
      }
      2 -> {
        var env = st[0]; var gain = st[1]
        val thrDb = p[0]; val floorDb = p[1]; val ratio = p[2]; val att = p[3]; val rel = p[4]
        for (i in 0 until n) {
          val pk = max(abs(l[i].toDouble()), abs(r[i].toDouble()))
          env += (pk - env) * (if (pk > env) att else rel)
          val lev = 20 * log10(env + 1e-12)
          val targetDb = if (lev >= thrDb) 0.0 else max(floorDb, (lev - thrDb) * (ratio - 1))
          val target = dbToLin(targetDb)
          gain += (target - gain) * (if (target > gain) att else rel)
          l[i] = ((l[i].toDouble() * gain).toFloat())
          r[i] = ((r[i].toDouble() * gain).toFloat())
        }
        st[0] = (env); st[1] = (gain)
      }
      3 -> {
        var gain = st[0]
        val limit = p[0]; val rel = p[1]
        for (i in 0 until n) {
          val pk = max(abs(l[i].toDouble()), abs(r[i].toDouble()))
          val need = if (pk * gain > limit) limit / pk else 1.0
          gain = if (need < gain) need else gain + (1 - gain) * rel
          if (pk * gain > limit) gain = limit / pk
          l[i] = ((l[i].toDouble() * gain).toFloat())
          r[i] = ((r[i].toDouble() * gain).toFloat())
        }
        st[0] = (gain)
      }
      4 -> {
        val k = p[0]; val norm = p[1]
        for (i in 0 until n) {
          l[i] = ((tanh(k * l[i].toDouble()) * norm).toFloat())
          r[i] = ((tanh(k * r[i].toDouble()) * norm).toFloat())
        }
      }
      5 -> {
        val line = aux ?: return
        val len = auxLen
        var w = st[0].toInt()
        val dl = p[0].toInt(); val dr = p[1].toInt()
        for (i in 0 until n) {
          line[w] = (((l[i].toDouble() + r[i].toDouble()) / 2).toFloat())
          w = (w + 1) % len
          l[i] = (line[(w - 1 - dl + 2 * len) % len])
          r[i] = (line[(w - 1 - dr + 2 * len) % len])
        }
        st[0] = (w.toDouble())
      }
      6 -> {
        val all = aux ?: return
        val len = auxLen / 2
        val taps = p[2].toInt()
        for (ch in 0 until 2) {
          val buf = if (ch == 0) l else r
          val base = ch * len
          var w = st[ch].toInt()
          for (i in 0 until n) {
            val xf = buf[i]
            val x = xf.toDouble()
            all[base + w] = (xf)
            w = (w + 1) % len
            var y = x * p[0]
            for (k in 0 until taps) {
              val d = p[3 + k].toInt()
              y += all[base + ((w - 1 - d + 2 * len) % len)].toDouble() * p[3 + taps + k]
            }
            buf[i] = ((y * p[1]).toFloat())
          }
          st[ch] = (w.toDouble())
        }
      }
      7 -> {
        val hl = l.copyOf(n)
        val hr = r.copyOf(n)
        biquad(hl, n, p, 5, st, 16)
        biquad(hr, n, p, 5, st, 20)
        val floor = p[0]; val att = p[1]; val rel = p[2]; val sr = p[3]
        val pos = p[4].toInt()
        var envHi = st[0]; var envAll = st[1]; var gain = st[2]
        var b0 = st[3]; var b1 = st[4]; var b2 = st[5]; var a1 = st[6]; var a2 = st[7]
        for (i in 0 until n) {
          val hli = hl[i].toDouble(); val hri = hr[i].toDouble(); val li = l[i].toDouble(); val ri = r[i].toDouble()
          val ph = (hli * hli + hri * hri) / 2
          val pa = (li * li + ri * ri) / 2
          envHi += (ph - envHi) * (if (ph > envHi) att else rel)
          envAll += (pa - envAll) * (if (pa > envAll) att else rel)
          val ratio = if (envAll > 1e-12) envHi / envAll else 0.0
          val target = if (ratio > 0.3) max(floor, (0.3 / ratio).pow(2)) else 1.0
          gain += (target - gain) * (if (target < gain) att else rel)
          if ((pos + i) % 32 == 0) {
            val c = highShelfNorm(6000.0, 20 * log10(gain), sr)
            b0 = c[0]; b1 = c[1]; b2 = c[2]; a1 = c[3]; a2 = c[4]
          }
          for (ch in 0 until 2) {
            val buf = if (ch == 0) l else r
            val o = if (ch == 0) 8 else 12
            val x = buf[i].toDouble()
            val y = b0 * x + b1 * st[o] + b2 * st[o + 1] - a1 * st[o + 2] - a2 * st[o + 3]
            st[o + 1] = (st[o]); st[o] = (x); st[o + 3] = (st[o + 2]); st[o + 2] = (y)
            buf[i] = (y.toFloat())
          }
        }
        st[0] = (envHi); st[1] = (envAll); st[2] = (gain)
        st[3] = (b0); st[4] = (b1); st[5] = (b2); st[6] = (a1); st[7] = (a2)
      }
    }
  }
}
