package expo.modules.remixrender

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

/**
 * Eszközön futó render Androidon — az iOS AVFoundation-motor párja.
 *
 * Fázis A (ez a réteg): **single-clip remux vágással** — a tényleges mux-logika a
 * [RemuxEngine]-ben van (Expo-függetlenül, hogy instrumentált teszttel is fusson).
 * Ez a modul csak a render-terv jogosultságát dönti el, és delegál: egyetlen helyi
 * videóklip, sebesség=1, nincs szűrő/vízjel/külön hang-sáv, és a klip képaránya a
 * vászonéval egyezik → veszteségmentes remux a `[inSec, inSec+durationSec]`-re.
 *
 * Minden más eset (vászon-skálázás, sebesség, szűrő, több szegmens, hang-mix,
 * vízjel) átkódolást igényel → az a Fázis B–C (decode→GL→encode), addig tiszta
 * hibával a felhő-render (Pro) felé esik.
 */
class RemixRenderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RemixRender")

    Events("onProgress")

    AsyncFunction("exportPlan") { planJson: String, outputPath: String, promise: Promise ->
      try {
        promise.resolve(render(planJson, outputPath))
      } catch (e: Exception) {
        promise.reject("ERR_RENDER", e.message ?: "render hiba", e)
      }
    }
  }

  private fun toPath(uri: String): String =
    if (uri.startsWith("file://")) uri.removePrefix("file://") else uri

  private fun render(planJson: String, outputPath: String): String {
    val plan = JSONObject(planJson)
    val video = plan.optJSONArray("video")
    val audio = plan.optJSONArray("audio")
    if (video == null || video.length() == 0) {
      throw IllegalArgumentException("Nincs helyi videóklip az eszközön-renderhez.")
    }

    val single = video.length() == 1
    val seg = video.getJSONObject(0)
    val extraAudio = audio != null && audio.length() > 0

    // Egyelőre csak az egy-klipes eset megy helyben (A/B); a több szegmens, külön
    // hang-sáv, egyedi hangerő és a vízjel a Fázis C / felhő sajátja.
    val singleClipLocal = single &&
      !extraAudio &&
      seg.optDouble("volume", 1.0) == 1.0 &&
      !plan.optBoolean("watermark", false)
    if (!singleClipLocal) {
      throw IllegalStateException(
        "Az Android eszközön-render jelenleg egy klipet támogat (vágás + vászon-" +
          "skálázás) — több sáv, hang-mix, egyedi hangerő és vízjel a felhő-renderre esik (Pro)."
      )
    }

    val src = toPath(seg.getString("uri"))
    val outFile = File(toPath(outputPath)).absolutePath
    val inSec = seg.optDouble("inSec", 0.0)
    val durationSec = seg.optDouble("durationSec", 0.0)
    val planW = plan.optInt("width", 0)
    val planH = plan.optInt("height", 0)
    val speed = seg.optDouble("speed", 1.0)
    val filter = seg.optString("filter", "none")
    val progress = { p: Double -> sendEvent("onProgress", mapOf("progress" to p)) }

    val fps = plan.optInt("fps", 30)

    // Szűrő egyelőre a Fázis B3 / felhő.
    if (filter != "none") {
      throw IllegalStateException("Szűrő egyelőre a felhő-renderre esik (Android Fázis B3 készül).")
    }

    // speed==1: gyors, veszteségmentes remux (A); képarány-eltérésnél transzkód (B1).
    if (speed == 1.0) {
      return try {
        "file://" + RemuxEngine.remuxTrim(src, inSec, durationSec, planW, planH, outFile, progress)
      } catch (_: AspectMismatchException) {
        "file://" + TranscodeEngine.transcode(src, inSec, durationSec, planW, planH, fps, 1.0, outFile, progress)
      }
    }

    // speed != 1: transzkód sebességgel (B2) — remux itt nem opció.
    return "file://" + TranscodeEngine.transcode(src, inSec, durationSec, planW, planH, fps, speed, outFile, progress)
  }
}
