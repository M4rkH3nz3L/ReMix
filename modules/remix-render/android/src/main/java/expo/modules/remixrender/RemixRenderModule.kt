package expo.modules.remixrender

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

/**
 * Eszközön futó render Androidon — az iOS AVFoundation-motor párja.
 *
 * v1: az egyszerű, egy-videós esetet KORREKTEN kezeli (a helyi klip átmásolása
 * a kimenetre), az összetett projekteket pedig egyértelmű üzenettel a felhő-
 * render (Pro) felé irányítja. A teljes Android-kompozitálás (MediaCodec +
 * MediaMuxer, több sáv + sebesség + vászon) külön, követő lépés — a JS-oldal
 * és a Pro-modell attól függetlenül már kész.
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

  private fun toFile(uri: String): File =
    if (uri.startsWith("file://")) File(uri.removePrefix("file://")) else File(uri)

  private fun render(planJson: String, outputPath: String): String {
    val plan = JSONObject(planJson)
    val video = plan.optJSONArray("video")
    val audio = plan.optJSONArray("audio")
    if (video == null || video.length() == 0) {
      throw IllegalArgumentException("Nincs helyi videóklip az eszközön-renderhez.")
    }

    val single = video.length() == 1
    val seg = video.getJSONObject(0)
    val trivial = single &&
      (audio == null || audio.length() == 0) &&
      seg.optDouble("speed", 1.0) == 1.0 &&
      seg.optDouble("inSec", 0.0) == 0.0 &&
      seg.optString("filter", "none") == "none"

    if (!trivial) {
      throw IllegalStateException(
        "Az Android eszközön-render most csak egyszerű vágást támogat — " +
          "összetett projekthez használd a felhő-rendert (Pro)."
      )
    }

    // triviális eset: a forrás átmásolása a kimenetre
    sendEvent("onProgress", mapOf("progress" to 0.1))
    val src = toFile(seg.getString("uri"))
    val out = toFile(outputPath)
    out.parentFile?.mkdirs()
    if (out.exists()) out.delete()
    src.copyTo(out, overwrite = true)
    sendEvent("onProgress", mapOf("progress" to 1.0))
    return "file://" + out.absolutePath
  }
}
