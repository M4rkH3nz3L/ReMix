package expo.modules.remixrender

import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A Fázis A remux-motor on-device (emulátor/eszköz) verifikációja. A teszt a
 * csomagolt `remux_sample.mp4` fixture-t (240×240, h264+aac, keyframe-ek 0/1/2s-nél)
 * a cache-be másolja, kivágja az `[1.0s, 2.0s]` tartományt a [RemuxEngine]-nel,
 * majd a kimenetet ÚJRA megnyitja és ellenőrzi: létezik, van benne videó- ÉS
 * hangsáv, a hossz ~1s, és a progressz elérte az 1.0-t.
 *
 * Futtatás: `./gradlew :remix-render:connectedDebugAndroidTest` (fut emulátoron/eszközön).
 */
@RunWith(AndroidJUnit4::class)
class RemuxEngineTest {
  @Test
  fun remuxTrimsLocalClipToPlayableMp4() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir

    // fixture → cache
    val src = File(cache, "remux_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }
    val outFile = File(cache, "remux_out.mp4")
    if (outFile.exists()) outFile.delete()

    // remux: [1.0s, 2.0s], vászon 240×240 (= forrás 1:1 képarány)
    val progress = ArrayList<Double>()
    val resultPath = RemuxEngine.remuxTrim(
      src.absolutePath,
      1.0,
      1.0,
      240,
      240,
      outFile.absolutePath,
    ) { p -> progress.add(p) }

    val result = File(resultPath)
    assertTrue("a kimeneti fájl létrejött és nem üres", result.exists() && result.length() > 0)
    assertTrue(
      "a progressz elérte az 1.0-t (utolsó: ${progress.lastOrNull()})",
      progress.isNotEmpty() && progress.last() >= 0.99,
    )

    // a kimenet újra megnyitható + van videó ÉS hang sáv + a hossz ~1s
    val ex = MediaExtractor()
    try {
      ex.setDataSource(result.absolutePath)
      var hasVideo = false
      var hasAudio = false
      var videoDurUs = 0L
      for (i in 0 until ex.trackCount) {
        val fmt = ex.getTrackFormat(i)
        val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/")) {
          hasVideo = true
          if (fmt.containsKey(MediaFormat.KEY_DURATION)) {
            videoDurUs = fmt.getLong(MediaFormat.KEY_DURATION)
          }
        }
        if (mime.startsWith("audio/")) {
          hasAudio = true
        }
      }
      assertTrue("a kimenet tartalmaz videósávot", hasVideo)
      assertTrue("a kimenet tartalmaz hangsávot", hasAudio)
      assertTrue(
        "a videó hossza ~1s (mért: ${videoDurUs}us)",
        videoDurUs in 700_000L..1_400_000L,
      )
    } finally {
      ex.release()
    }
  }
}
