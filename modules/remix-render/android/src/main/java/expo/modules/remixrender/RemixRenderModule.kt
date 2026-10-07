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

    // Fázis A jogosultság: egy klip, nincs transzkódolási kényszer.
    val remuxable = single &&
      !extraAudio &&
      seg.optDouble("speed", 1.0) == 1.0 &&
      seg.optDouble("volume", 1.0) == 1.0 &&
      seg.optString("filter", "none") == "none" &&
      !plan.optBoolean("watermark", false)

    if (!remuxable) {
      throw IllegalStateException(
        "Az Android eszközön-render jelenleg egy klip vágását (remux) támogatja — " +
          "vászon-skálázás, sebesség, szűrő, több sáv, hang-mix és vízjel a " +
          "felhő-renderre esik (Pro)."
      )
    }

    val result = RemuxEngine.remuxTrim(
      toPath(seg.getString("uri")),
      seg.optDouble("inSec", 0.0),
      seg.optDouble("durationSec", 0.0),
      plan.optInt("width", 0),
      plan.optInt("height", 0),
      File(toPath(outputPath)).absolutePath,
    ) { progress -> sendEvent("onProgress", mapOf("progress" to progress)) }

    return "file://" + result
  }
}
