# 🎬 Video Studio — PRODUCTION-készültség TODO (a még hiányzók)

> **Cél:** mi hiányzik még ahhoz, hogy a **videó-stúdió (NLE) PROD-ban megbízhatóan** menjen —
> nem új feature, hanem a meglévő, audit-zöld magok **production-verifikációja + infra + robusztusság**.
> **Testvérek (ne duplikáld):** [06-video-editor](./06-video-editor.md) (feature-lista), [CORE.md](./CORE.md)
> (editor-mag 10/10), [01-production-go-live](./01-production-go-live.md) (prod-infra), [NATIVE.md](./NATIVE.md)
> (eszközön-render), [12-code-quality](./12-code-quality.md) (cancellation/retry).
> **Érintett kód:** [server/render.js](../../server/render.js) · [server/index.js](../../server/index.js) ·
> [server/render-worker.js](../../server/render-worker.js) · [src/lib/render.ts](../../src/lib/render.ts) ·
> [src/lib/nativeRender.ts](../../src/lib/nativeRender.ts) · [src/components/editor/panels/ExportPanel.tsx](../../src/components/editor/panels/ExportPanel.tsx).

---

> **📊 Olvasat (2026-10-11):** a videó-stúdió **feature-oldalról ~kész** (06: ✅5 · 🟡4 · ⬜2; CORE 10/10,
> audit-zöld 166 suite / 1810 teszt), DE a **prod-réteg hiányos**. A legnagyobb kockázat, hogy sok render-funkció
> csak **filter-string-szinten tesztelt** (kliens==worker contract), a **vizuális kimenet élő ffmpeg-gel SOSEM
> volt igazolva** (a „Preview == Export" ígéret bizonyítatlan). A dev-stack most fut (worker + ffmpeg 8.1.2) →
> ez a verifikáció MOST elvégezhető.
>
> Státusz-tagek ([00-README](./00-README.md) §1): ✅ DONE · 🟡 PARTIAL · 🎞️ RENDER-VERIFY · 🔌 BACKEND/INFRA ·
> 🖼️ UI-MISSING · 🧪 MOCK · ⬜ NOT-IMPL.

---

## P0 — e nélkül nincs megbízható prod-export

### 1. 🎞️ Render-parity ÉLŐ verifikáció (Preview == Export) — a #1 prod-gate
A render-funkciók filter-stringjei kliens==worker contract-teszttel bizonyítottak, de a **tényleges
pixel-kimenet** élő worker+ffmpeg-gel SOHA nem volt összevetve az előnézettel.
- [x] ✅ **Render-smoke HARNESS KÉSZ + verifikált (2026-10-11)**: `npm run smoke` (server/) — a pure fixture-mag
  ([smokeFixtures.js](../../server/smokeFixtures.js), tesztelt) per-funkció RÖVID projekteket épít
  (baseline/keyframe-rotate+opacity/color-grade/effect-chain/skew/reverse/speed-2x/transition-xfade/
  text-overlay/audio-fx), a runner ([scripts/render-smoke.js](../../server/scripts/render-smoke.js)) ffmpeg-gel
  teszt-médiát gyárt, a futó API-val **in-process** rendereli mind, és a kész MP4-eket a `.render-smoke/`-ba
  menti + manifest. A futó dev-API-n **10/10 fixture rendben** legenerált (a méretek funkciónként eltérnek →
  a hatások beégtek). Hátra: bővítés LUT / animált-maszk / PiP / particles / 3-way-wheels fixture-ökkel.
- [ ] 🎞️ **Vizuális parity-ítélet (EMBERI lépés)**: a `.render-smoke/` MP4-jeit végignézni + a szerkesztő
  előnézetével összevetni; eltérés → javítás, amíg **érzékelhetően egyezik**. Ez zárja a 06 „⚠️ runtime-verify"
  jelzéseit. (A harness csak az összevetendő exportokat adja; a döntés emberi.)
- [ ] 🧪 **Golden-render regресszió (opcionális)**: pár referencia-export checksum/SSIM-gate CI-be (drift-védelem).

### 2. 🔌 Production render-worker infra (→ [01 §2.2](./01-production-go-live.md))
A stúdió exportja a felhő-workerre épül; prod-ban ma nincs. (Dev-ben is most derült ki: **worker nélkül a
megosztás 25%-on ragad** — lásd a dev-stack-jegyzetet.)
- [ ] 🔌 **Prod Docker image**: FFmpeg + Whisper + Chromium (egress) + ONNX-runtime, pinned verziók.
- [ ] 🔌 **Deploy + health-check endpoint + autoscaling + crash-recovery** (Fly/Render/VM).
- [ ] 🔌 **Perzisztens temp/storage stratégia** (nagy köztes fájlok; takarítás).
- [ ] 🔌 **Prod smoke-test**: render + TTS + audio-export + egress a prod workerben, CI-ből.

### 3. 🟡 Export-megbízhatóság end-to-end (→ [12 §2.3](./12-code-quality.md))
- [x] ✅ **Kliens-oldali cancellation ALAP**: a `renderCloud`/`submitAndPollRender` ([render.ts](../../src/lib/render.ts))
  `AbortSignal`-tudatos (`MAX_POLLS` ~10 perc timeout). (Natív oldalon is kész, lásd [12 §2.3](./12-code-quality.md).)
- [ ] 🔌 **Worker-oldali job-cancel + temp-cleanup**: a megszakított kliens-kérés tényleg állítsa le az FFmpeg-
  processt a workeren és takarítsa a köztes fájlokat (ma a kliens elenged, a worker tovább dolgozhat).
- [x] ✅ **Worker-hiány fail-fast KÉSZ (2026-10-11)**: a `/render` enqueue-ág a szerveren elutasít (503), ha
  `listWorkers()` üres (a média-feltöltés ELŐTT), a `/health` pedig jelenti a **worker-számot**; a kliens a
  tesztelt `cloudRenderBlocked` ([renderPreflight.ts](../../src/lib/renderPreflight.ts)) preflighttal MÁR a
  feltöltés előtt beszédes hibát dob (`lib.render.noWorker`, hu/en/de) — **nem ragad 25%-on**.
- [x] ✅ **Render-KÖZBENI worker-halál detektálás KÉSZ (2026-10-11)**: a poll-ciklus ~18 mp zéró-progress után
  újranézi a `/health` worker-számát; ha közben elfogyott a worker (`cloudRenderStalled` → 0 progress + 0 worker),
  azonnal beszédes hibát dob a ~10 perces timeout helyett. Teszt: renderPreflight.test.ts (10 eset összesen).
  **Hátra:** „Újra" gomb a progress-sheetben (UI) + worker-oldali job-cancel+cleanup (lásd lentebb).
- [ ] ⬜ **Hosszú/nehéz render**: a `MAX_POLLS` (10 perc) túllépés kezelt üzenettel; nagy (4K/hosszú) projekt
  várható-idő jelzés + háttér-folytatás (az app bezárása ne veszítse el a kész jobot).

### 4. 🔌 `upload → render → publish` prod-verifikáció (→ [01 §2.6](./01-production-go-live.md))
- [ ] 🔌 **Egy valódi videó** végigmegy a **prod** workeren + prod Supabase-szel + R2-re, a feedben megjelenik
  (poszter + lejátszás). Ez az integrált prod-füstteszt.
- [ ] ⬜ **Crash + error monitoring** (Sentry vagy ekviv.) a render-úton (kliens + worker).

---

## P1 — valós-világ robusztusság / teljesség

### 5. ⬜ Bemeneti formátum/kodek-robusztusság
A prod-userek tetszőleges fájlt dobnak be — ma nincs explicit input-validáció/normalizálás.
- [ ] ⬜ **Elfogadott formátumok + reject**: nem támogatott kodek/konténer esetén barátságos hiba (ne néma bukás).
- [ ] ⬜ **Rotation-metaadat** (telefon-felvétel álló/fekvő), **változó frame-rate (VFR)**, **HDR→SDR**, eltérő
  **audio sample-rate/csatorna** — normalizálás a render előtt (különben torz/hangtalan export).
- [ ] ⬜ **Méret/hossz-limitek**: max felbontás/hossz tier szerint, memória-védelem, túllépés-üzenet.

### 6. 🔌 Eszközön futó render-motor (→ [NATIVE.md](./NATIVE.md))
- [ ] 🔌 **Android MediaCodec valódi enkód** (ma triviális copy — a #1 natív tech-hiány); iOS AVFoundation v1 kész.
  Offline/azonnali export szerver-kör nélkül → prod-élmény + worker-tehermentesítés.

### 7. 🔌🖼️ GIF (→ [06 §2.8](./06-video-editor.md))
- [ ] 🔌🖼️ **Dekódolás (natív kocka-késleltetések) + import + preview (`frameIndexAt`) + timeline + render** — az
  időzítés-mag (`gifTiming.ts`) kész + tesztelt, a többi hátra.

### 8. ⬜ Render-output cache policy (→ [06 §2.9](./06-video-editor.md))
- [ ] ⬜ A `renders/` kimenetek elszámolása/nyírása (ma csak proxy+thumbnail+waveform cache korlátos; a renderek
  korlátlanul nőnek az eszközön).

### 9. 🎞️ Hátralévő render-út finomságok
- [ ] ⬜ **Transform anchor-pivot render** (translate-rotate-translate; preview már jó) — [06 §2.6](./06-video-editor.md).
- [ ] ⬜ **Átmenet/PiP render-path reverse-fallback** (a `reversed` klip ezeken az utakon is helyes legyen) — [06 §2.3](./06-video-editor.md).

---

## P2 — profi polish (nem prod-blokkoló)

- [ ] 🖼️ **3-way color wheels UI** (shadows/mids/highlights színkerék a meglévő grade-mezőkre) — [06 §2.2](./06-video-editor.md).
- [ ] ⬜ **Creative Canvas** (outpaint/retusálás/advanced-tracking/depth-aware-occlusion) — [06 §2.11](./06-video-editor.md).
- [ ] ⬜ **uri→assetId Fázis-3 flip** (opcionális, eszköz-gated; a szinkronizált cache ma helyes end-state) — [06 §2.10](./06-video-editor.md).

---

## 3. Kész, ha
A videó-stúdió **prod-ban** megbízható: egy valódi projekt **upload → render → publish** útja végigmegy a
**prod workeren**, az **export vizuálisan egyezik az előnézettel** (parity-mátrix OK), a render **megszakítható
+ takarít**, a worker-hiba **látható + újrapróbálható** (nem ragad 25%-on), a bemeneti formátumok
**robusztusan** kezeltek, és a render-út **monitorozva** van. Az eszközön-render (Android MediaCodec) legalább
v1 szinten működik az offline exporthoz.
