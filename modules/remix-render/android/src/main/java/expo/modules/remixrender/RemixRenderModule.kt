package expo.modules.remixrender

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
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

    // 🎧 hosszú forrás szakaszosan (az iOS decodeWindow párja): csak az ablak dekódolódik,
    // 44,1 kHz float32, összefésülve a kimeneti fájlba
    Constant("supportsDecodeWindow") { true }

    // 🎙️⏱️ a hangrendszer késései (mp): a kimeneti a rejtett AudioManager.getOutputLatency-ből (ms), a puffer a tulajdonságokból
    Function("ioLatency") {
      val am = appContext.reactContext?.getSystemService(android.content.Context.AUDIO_SERVICE) as? android.media.AudioManager
      val outMs = try {
        am?.javaClass?.getMethod("getOutputLatency", Int::class.javaPrimitiveType)?.invoke(am, android.media.AudioManager.STREAM_MUSIC) as? Int
      } catch (e: Exception) { null }
      val frames = am?.getProperty(android.media.AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)?.toDoubleOrNull()
      val rate = am?.getProperty(android.media.AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toDoubleOrNull()
      mapOf("output" to (outMs?.div(1000.0) ?: -1.0), "input" to -1.0, "buffer" to (if (frames != null && rate != null && rate > 0) frames / rate else -1.0), "category" to "android")
    }

    // 🎬→🎵 a videó hangsávja külön M4A-ba, átkódolás nélkül (MediaMuxer) — AAC hangsávnál; hangsáv
    // nélkül / nem AAC-nál hiba (a hívó érthető üzenetet ad)
    AsyncFunction("extractAudio") { uri: String, outputPath: String, promise: Promise ->
      try {
        promise.resolve(extractAudioTrack(toPath(uri), toPath(outputPath)))
      } catch (e: Exception) {
        promise.reject("ERR_EXTRACT_AUDIO", e.message ?: "hang kinyerése", e)
      }
    }

    AsyncFunction("decodeWindow") { uri: String, start: Double, duration: Double, outputPath: String, promise: Promise ->
      try {
        val r = WindowDecoder.decodeWindow(toPath(uri), start, duration, toPath(outputPath))
        promise.resolve(mapOf("frames" to r.frames, "channels" to r.channels, "encoderDelay" to r.encoderDelay, "firstPtsUs" to r.firstPtsUs, "mime" to r.mime, "out" to r.outInfo))
      } catch (e: Exception) {
        promise.reject("ERR_DECODE_WINDOW", e.message ?: "hang-ablak olvasása", e)
      }
    }

    // ⚡ a közös hang-DSP forró ciklusai natívan (a `src/lib/dspKernels.ts` tükre, azonos aritmetikával és
    // sorrenddel); helyben dolgozik, az állapot a JS `Float64Array`-jében marad
    Function("dspRun") { kind: Int, l: expo.modules.kotlin.typedarray.Float32Array, r: expo.modules.kotlin.typedarray.Float32Array, p: expo.modules.kotlin.typedarray.Float64Array, st: expo.modules.kotlin.typedarray.Float64Array, aux: expo.modules.kotlin.typedarray.Float32Array? ->
      val n = l.length
      if (n == 0) return@Function
      // tömeges másolás primitív tömbökbe (az elemenkénti Buffer.get/put a debug ART-ban lassú), számolás, vissza
      val o = java.nio.ByteOrder.nativeOrder()
      val lb = l.toDirectBuffer().order(o).asFloatBuffer()
      val rb = r.toDirectBuffer().order(o).asFloatBuffer()
      val pb = p.toDirectBuffer().order(o).asDoubleBuffer()
      val sb = st.toDirectBuffer().order(o).asDoubleBuffer()
      val ab = aux?.toDirectBuffer()?.order(o)?.asFloatBuffer()
      val la = FloatArray(n).also { lb.get(it) }
      val ra = FloatArray(r.length).also { rb.get(it) }
      val pa = DoubleArray(p.length).also { pb.get(it) }
      val sa = DoubleArray(st.length).also { sb.get(it) }
      val auxLen = aux?.length ?: 0
      val aa = ab?.let { FloatArray(auxLen).also { a -> ab.get(a) } }
      DspKernels.run(kind, la, ra, n, pa, sa, aa, auxLen)
      lb.rewind(); lb.put(la)
      rb.rewind(); rb.put(ra)
      sb.rewind(); sb.put(sa)
      if (ab != null && aa != null) { ab.rewind(); ab.put(aa) }
    }

    // 🗣️ a telefonon lévő beszédhangok (csak a net nélkül is szólók)
    AsyncFunction("ttsVoices") { promise: Promise ->
      withTts(promise) { engine ->
        val voices = (engine.voices ?: emptySet()).filter {
          !it.isNetworkConnectionRequired && !it.features.contains(android.speech.tts.TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
        }
        promise.resolve(voices.map { mapOf("id" to it.name, "name" to it.name, "language" to it.locale.toLanguageTag(), "quality" to it.quality) })
      }
    }

    // 🗣️ szöveg → beszéd WAV-fájlba a telefonon (TextToSpeech.synthesizeToFile); `rate` 0–1 (0,5 = alap)
    AsyncFunction("synthesizeSpeech") { text: String, voiceId: String?, language: String?, rate: Double, outputPath: String, promise: Promise ->
      withTts(promise) { engine ->
        val out = java.io.File(toPath(outputPath))
        out.delete()
        val voice = voiceId?.let { id -> engine.voices?.firstOrNull { it.name == id } }
        if (voice != null) {
          engine.voice = voice
        } else if (language != null) {
          engine.language = java.util.Locale.forLanguageTag(language)
        }
        engine.setSpeechRate((rate.coerceIn(0.0, 1.0) * 2.0).toFloat().coerceAtLeast(0.1f))
        val id = java.util.UUID.randomUUID().toString()
        val done = java.util.concurrent.atomic.AtomicBoolean(false)
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        val timeout = Runnable {
          if (done.compareAndSet(false, true)) promise.reject("ERR_TTS", "beszéd: időtúllépés", null)
        }
        engine.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}
          override fun onDone(utteranceId: String?) {
            if (utteranceId != id || !done.compareAndSet(false, true)) return
            main.removeCallbacks(timeout)
            if (out.length() <= 44) promise.reject("ERR_TTS", "beszéd: üres kimenet", null)
            else promise.resolve(mapOf("bytes" to out.length()))
          }
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String?) {
            if (utteranceId != id || !done.compareAndSet(false, true)) return
            main.removeCallbacks(timeout)
            promise.reject("ERR_TTS", "beszéd: a szintézis nem sikerült", null)
          }
          override fun onError(utteranceId: String?, errorCode: Int) {
            if (utteranceId != id || !done.compareAndSet(false, true)) return
            main.removeCallbacks(timeout)
            promise.reject("ERR_TTS", "beszéd: a szintézis nem sikerült ($errorCode)", null)
          }
        })
        main.postDelayed(timeout, 60_000)
        val r = engine.synthesizeToFile(text, android.os.Bundle(), out, id)
        if (r != android.speech.tts.TextToSpeech.SUCCESS && done.compareAndSet(false, true)) {
          main.removeCallbacks(timeout)
          promise.reject("ERR_TTS", "beszéd: nem indult el", null)
        }
      }
    }

    // A futó render megszakítása — a natív decode/encode loop a következő
    // iterációnál kilép, a részfájlt törli. (Az `exportPlan` indításkor nullázza.)
    AsyncFunction("cancel") {
      cancelRequested = true
    }
  }

  // 🗣️ a beszédmotor lusta indítása: az első hívás várja az inicializálást, a többi azonnal kapja
  private var tts: android.speech.tts.TextToSpeech? = null
  private var ttsReady = false
  private val ttsWaiting = mutableListOf<Pair<Promise, (android.speech.tts.TextToSpeech) -> Unit>>()

  private fun withTts(promise: Promise, run: (android.speech.tts.TextToSpeech) -> Unit) {
    val ctx = appContext.reactContext ?: return promise.reject("ERR_TTS", "nincs alkalmazás-környezet", null)
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      val engine = tts
      if (engine != null && ttsReady) {
        try { run(engine) } catch (e: Exception) { promise.reject("ERR_TTS", e.message ?: "beszéd", e) }
        return@post
      }
      ttsWaiting.add(promise to run)
      if (engine != null) return@post
      tts = android.speech.tts.TextToSpeech(ctx) { status ->
        val waiting = ttsWaiting.toList()
        ttsWaiting.clear()
        if (status == android.speech.tts.TextToSpeech.SUCCESS) {
          ttsReady = true
          for ((p, r) in waiting) {
            try { r(tts!!) } catch (e: Exception) { p.reject("ERR_TTS", e.message ?: "beszéd", e) }
          }
        } else {
          tts?.shutdown()
          tts = null
          for ((p, _) in waiting) p.reject("ERR_TTS", "nincs beszédmotor a telefonon", null)
        }
      }
    }
  }

  private fun extractAudioTrack(src: String, out: String): Map<String, Any> {
    val ex = android.media.MediaExtractor()
    ex.setDataSource(src)
    try {
      var idx = -1
      for (i in 0 until ex.trackCount) {
        if (ex.getTrackFormat(i).getString(android.media.MediaFormat.KEY_MIME)?.startsWith("audio/") == true) { idx = i; break }
      }
      if (idx < 0) throw IllegalStateException("A forrás nem tartalmaz sávot: audio")
      val fmt = ex.getTrackFormat(idx)
      val mime = fmt.getString(android.media.MediaFormat.KEY_MIME) ?: ""
      if (mime != "audio/mp4a-latm") throw IllegalStateException("A videó hangja nem AAC ($mime)")
      val durUs = if (fmt.containsKey(android.media.MediaFormat.KEY_DURATION)) fmt.getLong(android.media.MediaFormat.KEY_DURATION) else 0L
      ex.selectTrack(idx)
      java.io.File(out).delete()
      val mux = android.media.MediaMuxer(out, android.media.MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val t = mux.addTrack(fmt)
      mux.start()
      val buf = java.nio.ByteBuffer.allocate(1 shl 20)
      val info = android.media.MediaCodec.BufferInfo()
      while (true) {
        val n = ex.readSampleData(buf, 0)
        if (n < 0) break
        info.set(0, n, ex.sampleTime, if (ex.sampleFlags and android.media.MediaExtractor.SAMPLE_FLAG_SYNC != 0) android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        mux.writeSampleData(t, buf, info)
        ex.advance()
      }
      mux.stop()
      mux.release()
      return mapOf("duration" to durUs / 1e6, "passthrough" to true)
    } finally {
      ex.release()
    }
  }

  // a `file://` uri százalékkódolt (ékezetes / szóközös név) — a fájlrendszer a dekódolt útvonalat várja
  private fun toPath(uri: String): String =
    if (uri.startsWith("file://")) android.net.Uri.parse(uri).path ?: uri.removePrefix("file://") else uri

  private fun render(planJson: String, outputPath: String): String {
    val plan = JSONObject(planJson)
    val video = plan.optJSONArray("video")
    val audio = plan.optJSONArray("audio")
    if (video == null || video.length() == 0) {
      throw IllegalArgumentException("Nincs helyi videóklip az eszközön-renderhez.")
    }

    val outFile = File(toPath(outputPath)).absolutePath
    val planW = plan.optInt("width", 0)
    val planH = plan.optInt("height", 0)
    val fps = plan.optInt("fps", 30)
    val progress = { p: Double -> sendEvent("onProgress", mapOf("progress" to p)) }
    val isCancelled = { cancelRequested }
    // Fázis E: a cél-kodek (h264/hevc) + bitráta a render-tervből (RenderSettings).
    val enc = EncoderSpec(plan.optString("codec", "h264"), plan.optInt("bitRate", 0))

    val seg = video.getJSONObject(0)
    val extraAudio = audio != null && audio.length() > 0
    val multi = video.length() > 1
    // 🖼️ overlay-k (szöveg/felirat PNG-k): jelenlétük KÖTELEZŐEN a kompozit-útra
    // visz — a remux/transzkód gyors-utak nem tudnak rárajzolni.
    var overlays = plan.optJSONArray("overlays")
    // 🏷️ vízjel (Free): teljes-vásznas PNG-overlay a kompozit-úton (B9 — eddig kivétel)
    var watermarkPng: File? = null
    if (plan.optBoolean("watermark", false)) {
      val w = if (planW % 2 == 0) planW else planW + 1
      val h = if (planH % 2 == 0) planH else planH + 1
      watermarkPng = Watermark.writePng(w, h, File(outFile).parentFile ?: File("."))
      overlays = (overlays ?: JSONArray()).put(Watermark.overlayItem(watermarkPng))
    }
    val hasOverlays = overlays != null && overlays.length() > 0

    // Multi-segment / külön hang-sáv / egyedi hangerő / overlay (vízjel is) → kompozit (Fázis C).
    if (multi || extraAudio || hasOverlays || seg.optDouble("volume", 1.0) != 1.0) {
      try {
        return "file://" + ComposeEngine.compose(video, audio, planW, planH, fps, enc, isCancelled, outFile, progress, overlays)
      } finally {
        watermarkPng?.delete()
      }
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
        "file://" + TranscodeEngine.transcode(src, inSec, durationSec, planW, planH, fps, 1.0, -1, 0f, enc, isCancelled, outFile, progress)
      }
    }

    // sebesség és/vagy szűrő → transzkód (B1/B2/B3); remux itt nem opció.
    return "file://" +
      TranscodeEngine.transcode(src, inSec, durationSec, planW, planH, fps, speed, filterRgb, filterOpacity, enc, isCancelled, outFile, progress)
  }
}
