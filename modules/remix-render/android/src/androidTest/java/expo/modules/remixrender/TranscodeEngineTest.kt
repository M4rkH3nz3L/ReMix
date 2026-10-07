package expo.modules.remixrender

import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A Fázis B1 transzkód-motor on-device (emulátor/eszköz) verifikációja. A 240×240
 * (1:1) h264+aac fixture-t egy **320×180 (16:9)** vászonra skálázza (aspect-fill),
 * az `[1.0s, 2.0s]` tartományra vágva, a decode→GL→encode pipeline-nal. Ellenőrzi,
 * hogy a kimenet: létezik, **320×180** videósávot ad, van hangsávja, a hossz ~1s,
 * és a progressz elérte az 1.0-t.
 *
 * Futtatás: `./gradlew :remix-render:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class TranscodeEngineTest {
  @Test
  fun transcodesAndScalesClipToCanvas() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir

    val src = File(cache, "transcode_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }
    val outFile = File(cache, "transcode_out.mp4")
    if (outFile.exists()) outFile.delete()

    val progress = ArrayList<Double>()
    val resultPath = TranscodeEngine.transcode(
      src.absolutePath,
      1.0,
      1.0,
      320,
      180,
      30,
      outFile.absolutePath,
    ) { p -> progress.add(p) }

    val result = File(resultPath)
    assertTrue("a kimeneti fájl létrejött és nem üres", result.exists() && result.length() > 0)
    assertTrue(
      "a progressz elérte az 1.0-t (utolsó: ${progress.lastOrNull()})",
      progress.isNotEmpty() && progress.last() >= 0.99,
    )

    val ex = MediaExtractor()
    try {
      ex.setDataSource(result.absolutePath)
      var videoW = -1
      var videoH = -1
      var hasAudio = false
      var videoDurUs = 0L
      for (i in 0 until ex.trackCount) {
        val fmt = ex.getTrackFormat(i)
        val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/")) {
          videoW = fmt.getInteger(MediaFormat.KEY_WIDTH)
          videoH = fmt.getInteger(MediaFormat.KEY_HEIGHT)
          if (fmt.containsKey(MediaFormat.KEY_DURATION)) {
            videoDurUs = fmt.getLong(MediaFormat.KEY_DURATION)
          }
        }
        if (mime.startsWith("audio/")) {
          hasAudio = true
        }
      }
      assertEquals("a kimenet szélessége = vászon", 320, videoW)
      assertEquals("a kimenet magassága = vászon", 180, videoH)
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
