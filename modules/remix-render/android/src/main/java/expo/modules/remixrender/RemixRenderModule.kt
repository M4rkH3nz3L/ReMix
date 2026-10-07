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
  // A folyamatban lévő render megszakítás-jele (a JS `cancel()` állítja, a motor-loopok figyelik).
  @Volatile
  private var cancelRequested = false

  override fun definition() = ModuleDefinition {
    Name("RemixRender")

    Events("onProgress")

    AsyncFunction("exportPlan") { planJson: String, outputPath: String, promise: Promise ->
      cancelRequested = false
      try {
        promise.resolve(render(planJson, outputPath))
      } catch (e: RenderCancelledException) {
        promise.reject("ERR_RENDER_CANCELLED", e.message ?: "megszakítva", e)
      } catch (e: Exception) {
        promise.reject("ERR_RENDER", e.message ?: "render hiba", e)
      }
    }

    // A futó render megszakítása — a natív decode/encode loop a következő
    // iterációnál kilép, a részfájlt törli. (Az `exportPlan` indításkor nullázza.)
    AsyncFunction("cancel") {
      cancelRequested = true
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

    if (plan.optBoolean("watermark", false)) {
      throw IllegalStateException("A vízjel beégetése jelenleg a felhő-renderre esik.")
    }

    val outFile = File(toPath(outputPath)).absolutePath
    val planW = plan.optInt("width", 0)
    val planH = plan.optInt("height", 0)
    val fps = plan.optInt("fps", 30)
    val progress = { p: Double -> sendEvent("onProgress", mapOf("progress" to p)) }
    val isCancelled = { cancelRequested }

    val seg = video.getJSONObject(0)
    val extraAudio = audio != null && audio.length() > 0
    val multi = video.length() > 1

    // Multi-segment / külön hang-sáv / egyedi hangerő → kompozit (Fázis C).
    if (multi || extraAudio || seg.optDouble("volume", 1.0) != 1.0) {
      return "file://" + ComposeEngine.compose(video, audio, planW, planH, fps, isCancelled, outFile, progress)
    }

    // ── egy klip, nincs külön hang, teljes hangerő → A/B gyors út ──
    val src = toPath(seg.getString("uri"))
    val inSec = seg.optDouble("inSec", 0.0)
    val durationSec = seg.optDouble("durationSec", 0.0)
    val speed = seg.optDouble("speed", 1.0)
    val filter = seg.optString("filter", "none")

    // Szűrő feloldása (a worker FILTERS-tükre); ismeretlen szűrő → felhő.
    val preset = FilterPresets.get(filter)
    if (filter != "none" && preset == null) {
      throw IllegalStateException("Ismeretlen szűrő ($filter) — a felhő-renderre esik.")
    }
    val filterRgb = preset?.rgb ?: -1
    val filterOpacity = preset?.opacity ?: 0f

    // speed==1 ÉS nincs szűrő: gyors, veszteségmentes remux (A); képarány-eltérésnél transzkód (B1).
    if (speed == 1.0 && preset == null) {
      return try {
        "file://" + RemuxEngine.remuxTrim(src, inSec, durationSec, planW, planH, isCancelled, outFile, progress)
      } catch (_: AspectMismatchException) {
        "file://" + TranscodeEngine.transcode(src, inSec, durationSec, planW, planH, fps, 1.0, -1, 0f, isCancelled, outFile, progress)
      }
    }

    // sebesség és/vagy szűrő → transzkód (B1/B2/B3); remux itt nem opció.
    return "file://" +
      TranscodeEngine.transcode(src, inSec, durationSec, planW, planH, fps, speed, filterRgb, filterOpacity, isCancelled, outFile, progress)
  }
}
