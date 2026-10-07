package expo.modules.remixrender

import android.graphics.Color
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
      1.0,
      -1,
      0f,
      { false },
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

  @Test
  fun speedsUpClipWithResampledAudio() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir

    val src = File(cache, "speed_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }
    val outFile = File(cache, "speed_out.mp4")
    if (outFile.exists()) outFile.delete()

    // 1s forrás-tartomány 2× sebességgel → ~0.5s kimenet, 240×240 vászon (identitás-skála)
    val progress = ArrayList<Double>()
    val resultPath = TranscodeEngine.transcode(
      src.absolutePath,
      1.0,
      1.0,
      240,
      240,
      30,
      2.0,
      -1,
      0f,
      { false },
      outFile.absolutePath,
    ) { p -> progress.add(p) }

    val result = File(resultPath)
    assertTrue("a kimeneti fájl létrejött és nem üres", result.exists() && result.length() > 0)

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
      assertTrue("a kimenet tartalmaz (újramintázott) hangsávot", hasAudio)
      assertTrue(
        "2× sebességnél a hossz ~0.5s (mért: ${videoDurUs}us)",
        videoDurUs in 300_000L..750_000L,
      )
    } finally {
      ex.release()
    }
  }

  @Test
  fun appliesColorFilterDesaturates() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir
    val src = File(cache, "filter_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }

    // ugyanaz a klip szűrő nélkül és „mono" (0x808080 @0.45) szűrővel
    val plain = File(cache, "filter_plain.mp4")
    if (plain.exists()) plain.delete()
    TranscodeEngine.transcode(src.absolutePath, 1.0, 1.0, 240, 240, 30, 1.0, -1, 0f, { false }, plain.absolutePath) {}

    val mono = File(cache, "filter_mono.mp4")
    if (mono.exists()) mono.delete()
    TranscodeEngine.transcode(src.absolutePath, 1.0, 1.0, 240, 240, 30, 1.0, 0x808080, 0.45f, { false }, mono.absolutePath) {}

    val plainSpread = avgChannelSpread(plain.absolutePath)
    val monoSpread = avgChannelSpread(mono.absolutePath)
    // a szürke-overlay a csatorna-szórást (szín-eltérést) érdemben csökkenti
    assertTrue(
      "a mono szűrő csökkenti a szín-szórást (plain=$plainSpread, mono=$monoSpread)",
      monoSpread in 1.0..(plainSpread * 0.85),
    )
  }

  @Test
  fun cancelAbortsRenderAndDeletesOutput() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir
    val src = File(cache, "cancel_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }
    val out = File(cache, "cancel_out.mp4")
    if (out.exists()) out.delete()

    // a megszakítás-jel az első progressznél igazra vált → a motor-loop kilép
    var cancel = false
    var cancelled = false
    try {
      TranscodeEngine.transcode(
        src.absolutePath,
        0.0,
        2.0,
        320,
        180,
        30,
        1.0,
        -1,
        0f,
        { cancel },
        out.absolutePath,
      ) { _ -> cancel = true }
    } catch (e: RenderCancelledException) {
      cancelled = true
    }

    assertTrue("megszakításkor RenderCancelledException-t dob", cancelled)
    assertFalse("a részfájl törlődött (nem marad szemét)", out.exists())
  }

  @Test
  fun invalidSourceThrowsCleanlyWithoutGarbage() {
    val cache = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
    val out = File(cache, "invalid_out.mp4")
    if (out.exists()) out.delete()
    var threw = false
    try {
      TranscodeEngine.transcode(
        "/nem/letezik/forras.mp4",
        0.0,
        1.0,
        320,
        180,
        30,
        1.0,
        -1,
        0f,
        { false },
        out.absolutePath,
      ) {}
    } catch (e: Exception) {
      threw = true // tiszta kivétel (nem crash) → a hívó a felhő-renderre esik
    }
    assertTrue("hibás forrás tiszta kivételt dob", threw)
    assertFalse("hibánál sem marad részfájl", out.exists())
  }

  @Test
  fun hevcRequestedProducesPlayableOutput() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir
    val src = File(cache, "hevc_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }
    val out = File(cache, "hevc_out.mp4")
    if (out.exists()) out.delete()

    // HEVC-t kérünk; ha az emulátoron nincs HEVC-enkóder → H.264-fallback. Mindkét
    // esetben valid, újra-megnyitható MP4 (a lényeg: a kodek-választás nem tör el).
    TranscodeEngine.transcode(
      src.absolutePath, 0.0, 1.0, 240, 240, 30, 1.0, -1, 0f, EncoderSpec("hevc", 0), { false }, out.absolutePath,
    ) {}

    assertTrue("a kimenet létrejött", out.exists() && out.length() > 0)
    val ex = MediaExtractor()
    try {
      ex.setDataSource(out.absolutePath)
      var mime: String? = null
      for (i in 0 until ex.trackCount) {
        val m = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (m.startsWith("video/")) mime = m
      }
      assertTrue("van videósáv h264/hevc kodekkel (lett: $mime)", mime == "video/hevc" || mime == "video/avc")
    } finally {
      ex.release()
    }
  }

  @Test
  fun lowerBitrateProducesSmallerFile() {
    val inst = InstrumentationRegistry.getInstrumentation()
    val cache = inst.targetContext.cacheDir
    val src = File(cache, "br_src.mp4")
    inst.context.assets.open("remux_sample.mp4").use { input ->
      src.outputStream().use { output -> input.copyTo(output) }
    }
    val hi = File(cache, "br_hi.mp4")
    val lo = File(cache, "br_lo.mp4")
    if (hi.exists()) hi.delete()
    if (lo.exists()) lo.delete()

    TranscodeEngine.transcode(
      src.absolutePath, 0.0, 2.0, 320, 240, 30, 1.0, -1, 0f, EncoderSpec("h264", 12_000_000), { false }, hi.absolutePath,
    ) {}
    TranscodeEngine.transcode(
      src.absolutePath, 0.0, 2.0, 320, 240, 30, 1.0, -1, 0f, EncoderSpec("h264", 500_000), { false }, lo.absolutePath,
    ) {}

    assertTrue("mindkét kimenet létrejött", hi.length() > 0 && lo.length() > 0)
    assertTrue(
      "az alacsonyabb bitráta kisebb fájlt ad (hi=${hi.length()}, lo=${lo.length()})",
      lo.length() < hi.length(),
    )
  }

  /** Az első képkocka átlagos csatorna-szórása (max-min RGB) — a „színesség" mértéke. */
  private fun avgChannelSpread(path: String): Double {
    val mmr = MediaMetadataRetriever()
    try {
      mmr.setDataSource(path)
      val bmp = mmr.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        ?: return 0.0
      var sum = 0.0
      var count = 0
      val step = 8
      var y = 0
      while (y < bmp.height) {
        var x = 0
        while (x < bmp.width) {
          val p = bmp.getPixel(x, y)
          val r = Color.red(p)
          val g = Color.green(p)
          val b = Color.blue(p)
          sum += (maxOf(r, g, b) - minOf(r, g, b)).toDouble()
          count++
          x += step
        }
        y += step
      }
      bmp.recycle()
      return if (count > 0) sum / count else 0.0
    } finally {
      mmr.release()
    }
  }
}
