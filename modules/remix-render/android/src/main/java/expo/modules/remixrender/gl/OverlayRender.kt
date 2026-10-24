package expo.modules.remixrender.gl

import android.graphics.BitmapFactory
import android.opengl.GLES20
import android.opengl.GLUtils
import org.json.JSONArray
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.PI
import kotlin.math.sin

/**
 * 🖼️ Overlay-réteg a kompozithoz: előre raszterizált, TELJES-vásznas PNG-k
 * (szöveg/felirat — a JS a preview-komponensből fotózza, így pixel-hű) idő-
 * ablakkal és a preview belépő-animációinak ZÁRT KÉPLETŰ másával (fade/slide/
 * pop/pulse/shake — a TextOverlay.tsx görbéi 1:1). A textúra csak az aktív
 * ablak alatt él (belépéskor dekód+feltöltés, kilépéskor törlés) — sok felirat
 * esetén sincs GPU-memória-halmozás. Premultiplied alfával blendel (az Android
 * Bitmap alapból premultiplied).
 */
class OverlayRender(overlays: JSONArray?) {
  private class Item(
    val png: String,
    val fromUs: Long,
    val durUs: Long,
    val opacity: Float,
    val anim: String,
    /** belépő-animáció eltolás-amplitúdója a vászon-magasság arányában */
    val ampNorm: Float,
    /** animáció-horgony (a szöveg-doboz közepe) 0–1 vászon-koordinátában */
    val anchorX: Float,
    val anchorY: Float,
  ) {
    var texture = -1
  }

  private val items = ArrayList<Item>()
  private var program = 0
  private var aPositionHandle = 0
  private var aUvHandle = 0
  private var uAlphaHandle = 0
  private var uScaleHandle = 0
  private var uTranslateYHandle = 0
  private var uAnchorHandle = 0

  // teljes-vásznas quad; a V-koordináta fordított (a bitmap 0. sora a kép TETEJE)
  private val vertexData = floatArrayOf(
    // X,  Y,   U, V
    -1f, -1f, 0f, 1f,
    1f, -1f, 1f, 1f,
    -1f, 1f, 0f, 0f,
    1f, 1f, 1f, 0f,
  )
  private val vertices: FloatBuffer = ByteBuffer
    .allocateDirect(vertexData.size * 4)
    .order(ByteOrder.nativeOrder())
    .asFloatBuffer()
    .apply { put(vertexData); position(0) }

  init {
    if (overlays != null) {
      for (i in 0 until overlays.length()) {
        val o = overlays.getJSONObject(i)
        val durUs = (o.optDouble("durationSec", 0.0) * 1_000_000.0).toLong()
        if (durUs <= 0L) continue
        items.add(
          Item(
            png = o.getString("png").removePrefix("file://"),
            fromUs = (o.optDouble("atSec", 0.0) * 1_000_000.0).toLong(),
            durUs = durUs,
            opacity = o.optDouble("opacity", 1.0).toFloat().coerceIn(0f, 1f),
            anim = o.optString("anim", "none"),
            ampNorm = o.optDouble("ampNorm", 0.0).toFloat(),
            anchorX = o.optDouble("anchorX", 0.5).toFloat(),
            anchorY = o.optDouble("anchorY", 0.5).toFloat(),
          ),
        )
      }
      items.sortBy { it.fromUs }
    }
  }

  fun hasAny(): Boolean = items.isNotEmpty()

  /**
   * A preview belépő-görbéinek mása (TextOverlay.tsx `animatedProps`, t mp-ben):
   * alpha + skála + lefelé-eltolás (vászon-arányban).
   */
  private fun curve(item: Item, tUs: Long): Triple<Float, Float, Float> {
    val t = tUs / 1_000_000.0
    fun clamp01(v: Double) = v.coerceIn(0.0, 1.0).toFloat()
    return when (item.anim) {
      "fade" -> Triple(clamp01(t / 0.4), 1f, 0f)
      "slide" -> {
        val e = clamp01(t / 0.4)
        Triple(e, 1f, (1f - e) * item.ampNorm)
      }
      "pop" -> {
        val p = clamp01(t / 0.3).toDouble()
        val scale = if (p < 1.0) 1.2 * p * (2.0 - p) else 1.0
        Triple(clamp01(p * 2.0), scale.toFloat(), 0f)
      }
      "pulse" -> Triple(1f, (1.0 + 0.05 * sin(t * PI * 3.0)).toFloat(), 0f)
      "shake" -> Triple(1f, 1f, (sin(t * PI * 14.0) * item.ampNorm).toFloat())
      else -> Triple(1f, 1f, 0f)
    }
  }

  private fun ensureProgram() {
    if (program != 0) return
    val vs = compile(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
    val fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
    program = GLES20.glCreateProgram()
    GLES20.glAttachShader(program, vs)
    GLES20.glAttachShader(program, fs)
    GLES20.glLinkProgram(program)
    val status = IntArray(1)
    GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0)
    if (status[0] != GLES20.GL_TRUE) {
      val log = GLES20.glGetProgramInfoLog(program)
      GLES20.glDeleteProgram(program)
      program = 0
      throw RuntimeException("overlay-program linkelési hiba: $log")
    }
    aPositionHandle = GLES20.glGetAttribLocation(program, "aPosition")
    aUvHandle = GLES20.glGetAttribLocation(program, "aUv")
    uAlphaHandle = GLES20.glGetUniformLocation(program, "uAlpha")
    uScaleHandle = GLES20.glGetUniformLocation(program, "uScale")
    uTranslateYHandle = GLES20.glGetUniformLocation(program, "uTranslateY")
    uAnchorHandle = GLES20.glGetUniformLocation(program, "uAnchor")
  }

  private fun compile(type: Int, src: String): Int {
    val shader = GLES20.glCreateShader(type)
    GLES20.glShaderSource(shader, src)
    GLES20.glCompileShader(shader)
    val ok = IntArray(1)
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0)
    if (ok[0] == 0) {
      val log = GLES20.glGetShaderInfoLog(shader)
      GLES20.glDeleteShader(shader)
      throw RuntimeException("overlay-shader hiba: $log")
    }
    return shader
  }

  /** PNG → textúra az aktív ablak elején (lazy); hibánál az overlay kimarad. */
  private fun ensureTexture(item: Item): Boolean {
    if (item.texture != -1) return true
    val bmp = try {
      BitmapFactory.decodeFile(item.png)
    } catch (_: Exception) {
      null
    } ?: return false
    val tex = IntArray(1)
    GLES20.glGenTextures(1, tex, 0)
    item.texture = tex[0]
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, item.texture)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
    bmp.recycle()
    return true
  }

  private fun releaseTexture(item: Item) {
    if (item.texture != -1) {
      GLES20.glDeleteTextures(1, intArrayOf(item.texture), 0)
      item.texture = -1
    }
  }

  /** Az adott kimeneti PTS-nél aktív overlay-k rárajzolása (a videó-frame UTÁN). */
  fun drawAt(ptsUs: Long) {
    if (items.isEmpty()) return
    var drawing = false
    for (item in items) {
      val t = ptsUs - item.fromUs
      if (t < 0L || t >= item.durUs) {
        // az ablakon kívül: a már nem kellő textúra felszabadul
        if (item.texture != -1 && t >= item.durUs) releaseTexture(item)
        continue
      }
      if (!ensureTexture(item)) continue
      if (!drawing) {
        ensureProgram()
        GLES20.glUseProgram(program)
        GLES20.glEnable(GLES20.GL_BLEND)
        // premultiplied alfa (Android Bitmap) → (ONE, ONE_MINUS_SRC_ALPHA)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        vertices.position(0)
        GLES20.glVertexAttribPointer(aPositionHandle, 2, GLES20.GL_FLOAT, false, 16, vertices)
        GLES20.glEnableVertexAttribArray(aPositionHandle)
        vertices.position(2)
        GLES20.glVertexAttribPointer(aUvHandle, 2, GLES20.GL_FLOAT, false, 16, vertices)
        GLES20.glEnableVertexAttribArray(aUvHandle)
        drawing = true
      }
      val (alpha, scale, tyNorm) = curve(item, t)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, item.texture)
      GLES20.glUniform1f(uAlphaHandle, alpha * item.opacity)
      GLES20.glUniform1f(uScaleHandle, scale)
      // lefelé-eltolás: a kép-tér +y lefelé → clip-tér −y; vászon-arány → clip-fél-magasság ×2
      GLES20.glUniform1f(uTranslateYHandle, -2f * tyNorm)
      // horgony kép-térből clip-térbe (y tükrözve)
      GLES20.glUniform2f(uAnchorHandle, item.anchorX * 2f - 1f, 1f - item.anchorY * 2f)
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }
    if (drawing) {
      GLES20.glDisable(GLES20.GL_BLEND)
    }
  }

  fun release() {
    for (item in items) releaseTexture(item)
    if (program != 0) {
      GLES20.glDeleteProgram(program)
      program = 0
    }
  }

  companion object {
    private const val VERTEX_SHADER =
      "attribute vec2 aPosition;\n" +
        "attribute vec2 aUv;\n" +
        "varying vec2 vUv;\n" +
        "uniform float uScale;\n" +
        "uniform float uTranslateY;\n" +
        "uniform vec2 uAnchor;\n" +
        "void main() {\n" +
        "  vec2 p = (aPosition - uAnchor) * uScale + uAnchor;\n" +
        "  p.y += uTranslateY;\n" +
        "  gl_Position = vec4(p, 0.0, 1.0);\n" +
        "  vUv = aUv;\n" +
        "}\n"

    private const val FRAGMENT_SHADER =
      "precision mediump float;\n" +
        "varying vec2 vUv;\n" +
        "uniform sampler2D sTexture;\n" +
        "uniform float uAlpha;\n" +
        "void main() {\n" +
        "  vec4 c = texture2D(sTexture, vUv);\n" +
        "  gl_FragColor = c * uAlpha;\n" + // premultiplied: rgb ÉS alfa is szorzódik
        "}\n"
  }
}
