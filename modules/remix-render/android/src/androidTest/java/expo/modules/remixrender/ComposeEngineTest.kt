package expo.modules.remixrender

import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A Fázis C kompozit-motor on-device verifikációja: (1) két videó-szegmens
 * összefűzése folytonos PTS-sel (~2s), (2) egy külön hang-sáv bekeverése egy
 * videó-szegmens mellé. Mindkettő a fixture-ből (240×240, h264+aac).
 */
@RunWith(AndroidJUnit4::class)
class ComposeEngineTest {
  private fun fixture(name: String): File {
    val inst = InstrumentationRegistry.getInstrumentation()
    val f = File(inst.targetContext.cacheDir, name)
    inst.context.assets.open("remux_sample.mp4").use { input ->
      f.outputStream().use { output -> input.copyTo(output) }
    }
    return f
  }

  private fun vseg(path: String, atSec: Double, inSec: Double, dur: Double): JSONObject =
    JSONObject()
      .put("uri", path)
      .put("atSec", atSec)
      .put("inSec", inSec)
      .put("durationSec", dur)
      .put("speed", 1.0)
      .put("volume", 1.0)
      .put("filter", "none")

  private fun probe(path: String): Triple<Boolean, Boolean, Long> {
    val ex = MediaExtractor()
    var hasVideo = false
    var hasAudio = false
    var durUs = 0L
    try {
      ex.setDataSource(path)
      for (i in 0 until ex.trackCount) {
        val fmt = ex.getTrackFormat(i)
        val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/")) {
          hasVideo = true
          if (fmt.containsKey(MediaFormat.KEY_DURATION)) durUs = fmt.getLong(MediaFormat.KEY_DURATION)
        }
        if (mime.startsWith("audio/")) hasAudio = true
      }
    } finally {
      ex.release()
    }
    return Triple(hasVideo, hasAudio, durUs)
  }

  @Test
  fun composesTwoSegmentsContinuous() {
    val src = fixture("compose_src.mp4")
    val out = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "compose_out.mp4")
    if (out.exists()) out.delete()

    val video = JSONArray()
      .put(vseg(src.absolutePath, 0.0, 0.0, 1.0)) // [0..1s]
      .put(vseg(src.absolutePath, 1.0, 1.0, 1.0)) // [1..2s] forrás-ablak 1..2s
    val resultPath = ComposeEngine.compose(video, null, 240, 240, 30, { false }, out.absolutePath) {}

    val (hasVideo, hasAudio, durUs) = probe(File(resultPath).absolutePath)
    assertTrue("a kimenet létrejött", File(resultPath).exists() && File(resultPath).length() > 0)
    assertTrue("van videósáv", hasVideo)
    assertTrue("van (összefűzött) hangsáv", hasAudio)
    assertTrue("a két szegmens hossza ~2s (mért: ${durUs}us)", durUs in 1_600_000L..2_400_000L)
  }

  @Test
  fun mixesSeparateAudioTrack() {
    val src = fixture("mix_src.mp4")
    val out = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "mix_out.mp4")
    if (out.exists()) out.delete()

    val video = JSONArray().put(vseg(src.absolutePath, 0.0, 0.0, 1.0))
    val audio = JSONArray().put(
      JSONObject()
        .put("uri", src.absolutePath)
        .put("atSec", 0.0)
        .put("inSec", 0.0)
        .put("durationSec", 1.0)
        .put("volume", 0.5),
    )
    val resultPath = ComposeEngine.compose(video, audio, 240, 240, 30, { false }, out.absolutePath) {}

    val (hasVideo, hasAudio, durUs) = probe(File(resultPath).absolutePath)
    assertTrue("a kimenet létrejött", File(resultPath).exists() && File(resultPath).length() > 0)
    assertTrue("van videósáv", hasVideo)
    assertTrue("van (kevert) hangsáv", hasAudio)
    assertTrue("a hossz ~1s (mért: ${durUs}us)", durUs in 700_000L..1_400_000L)
  }
}
