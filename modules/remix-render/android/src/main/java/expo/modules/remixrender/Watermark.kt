package expo.modules.remixrender

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max

/**
 * 🏷️ ReMix-vízjel Androidon (exportPolicy: ingyen on-device + nem-fizető tier) — az iOS
 * CATextLayer-vízjel párja: ugyanaz a felirat, méret és hely (jobb-alsó sarok, 72%-os
 * fehér, árnyékkal). Teljes-vásznas, átlátszó PNG, amit a kompozit [OverlayRender]-je a
 * teljes hosszon a kép fölé rajzol. Eddig a vízjeles terv kivételt dobott → az ingyenes
 * Android-felhasználó egyáltalán nem tudott exportálni (PRO-VIDEO B9).
 */
object Watermark {
  fun writePng(canvasW: Int, canvasH: Int, dir: File): File {
    val bmp = Bitmap.createBitmap(canvasW, canvasH, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val fontSize = max(14f, canvasH * 0.032f)
    val margin = canvasH * 0.02f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb((0.72f * 255).toInt(), 255, 255, 255)
      textSize = fontSize
      typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
      textAlign = Paint.Align.RIGHT
      setShadowLayer(2f, 0f, 1f, Color.argb(153, 0, 0, 0))
    }
    // alapvonal: az alsó margó fölött (a szöveg-doboz alja ≈ margin, mint iOS-en)
    canvas.drawText("ReMix", canvasW - margin, canvasH - margin - paint.descent(), paint)
    dir.mkdirs()
    val out = File(dir, ".remix_watermark_${canvasW}x${canvasH}.png")
    FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bmp.recycle()
    return out
  }

  /** a vízjel overlay-bejegyzése (a teljes hosszra, animáció nélkül) */
  fun overlayItem(png: File): JSONObject =
    JSONObject()
      .put("png", png.absolutePath)
      .put("atSec", 0.0)
      .put("durationSec", 1_000_000.0)
      .put("opacity", 1.0)
      .put("anim", "none")
}
