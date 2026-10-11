# 🎧 Audio Studio (Hang Stúdió) — PRODUCTION-készültség TODO (a még hiányzók)

> **Cél:** mi hiányzik még ahhoz, hogy a **Hang Stúdió PROD-ban megbízhatóan** menjen — a
> [IMAGE-STUDIO-PROD.md](./IMAGE-STUDIO-PROD.md) és [VIDEO-STUDIO-PROD.md](./VIDEO-STUDIO-PROD.md) párja. Nem új
> feature, hanem a meglévő, funkcionálisan kész magok **render-parity + export + robusztusság + infra** véglegesítése.
> **Testvérek (ne duplikáld):** [06-video-editor](./06-video-editor.md) (hang-UI/mix a videóban),
> [01-production-go-live](./01-production-go-live.md) (prod-infra, worker-pool), [IMAGE-STUDIO-PROD](./IMAGE-STUDIO-PROD.md)
> (közös render-parity-minta + smoke-harness), [09-native-rendering](./09-native-rendering.md).
> **Érintett kód:** [src/components/studio/audio/](../../src/components/studio/audio/) (UI) ·
> [src/components/preview/AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx) (előnézet-lejátszás) ·
> [server/voicechain.js](../../server/voicechain.js) (per-klip fx + master-lánc) · [server/render.js](../../server/render.js)
> (`AUDIO_FORMATS` + 2-passzos loudnorm) · [server/index.js](../../server/index.js) `/render` `/audio/analyze` `/audio/stems` ·
> [src/lib/render.ts](../../src/lib/render.ts) `exportAudioFile` · magok: `audioMaster`/`mixer`/`automation`/`pitch`/`waveform`/`stems`.

---

> **📊 Olvasat (2026-10-11):** a Hang Stúdió **feature-oldalról kész** (multi-track music/voiceover/sfx timeline,
> per-klip trim/fade/volume/pan/autoDuck, voice-enhance + de-reverb, per-klip Pro audio-fx [EQ/szűrők/denoise/deesser/
> kompresszor/reverb/delay/limiter], Master preset [LUFS/true-peak/dinamika] + EQ + multiband, Analyze [LUFS/TP/LRA/
> spektrum], TTS, stem-szeparáció [Demucs], export WAV/MP3/AAC/FLAC, audio→videó, videó-hang leválasztás). 7+ pure-mag
> teszttel + `server/voicechain.test.js`. A prod-réteg hiánya nem feature, hanem **render-parity + export-teljesség +
> bemeneti robusztusság + infra**.
>
> **Kulcs-architektúra (a #1 prod-kockázat):** KÉT hangzás-út — (a) **on-device ELŐNÉZET**
> ([AudioLayer](../../src/components/preview/AudioLayer.tsx)): expo-audio per-track lejátszás, az rAF-mesteróra
> ([usePlaybackClock](../../src/hooks/usePlaybackClock.ts)) alá szinkronizálva, LIVE per-frame volume-automation + fade +
> track-gain (solo/mute) + master-volume. (b) **worker EXPORT**: ffmpeg per-klip [voicechain](../../server/voicechain.js)
> (fx-lánc + pan/stereo) + **2-passzos loudnorm** master (mér → `linear=true` pontos LUFS/TP + `alimiter`).
> **A kettő között ma ÉRDEMI eltérés van:** az előnézet NEM alkalmazza a per-klip `audioFx`-et (EQ/reverb/delay/…), a
> master-loudnorm-ot/dinamikát, és a pan/stereo-generálást → **„amit hallasz ≠ amit exportálsz".** Ez a kép-stúdió
> „3-renderelő parity" gondjának hang-megfelelője.
>
> Státusz-tagek ([00-README](./00-README.md) §1): ✅ DONE · 🟡 PARTIAL · 🎧 RENDER-VERIFY · 🔌 BACKEND/INFRA · 🖼️ UI · ⬜ NOT-IMPL.

---

## 🧭 HALADÁS — hol tartunk / mi van hátra

| Szint | Tétel | Állapot |
|------|-------|---------|
| **P0 #1** | Export-parity ÉLŐ verifikáció (audio-smoke: render → LUFS/TP/hossz/pan mérés) | ✅ |
| **P0 #2** | Preview↔export parity a per-klip fx-re + masterre (vagy jelzett eltérés) | ⬜ *(device)* |
| **P0 #3** | Export-teljesség (formátum ✅ wav/mp3/aac/flac · minőség/sample-rate/channel UI) | 🟡 |
| **P0 #4** | Worker-infra: az audio-export a /render queue-n megy (>15s) → worker kell | 🔌 |
| **P1 §5** | Bemeneti audio-robusztusság (formátumok/sample-rate/hossz/néma/korrupt → barátságos hiba) | ⬜ |
| **P1 §6** | Stem-szeparáció (Demucs) — env-gated Python/torch worker-image + runtime-verify | 🔌 |
| **P1 §7** | i18n konszolidáció (studio.audio / studio.audioTools / panels.audio / hangStudio-legacy) | ⬜ |
| **P1 §8** | Automation/mixer-UI (a magok készek, idővonal-szerkesztő hiányzik) | 🟡 |
| **P2** | fejlett mixer (bus/send/sidechain) · pitch-correction-UI a Hang Stúdióban · multiband per-band | ⬜ |

---

## P0 — e nélkül nincs megbízható prod-export

### 1. ✅ Export-parity ÉLŐ verifikáció („amit hallasz == amit exportálsz") — KÉSZ
A `voicechain.test.js` csak a filter-STRINGET ellenőrizte; most van **tényleges render + mérés** (a render-smoke/
imagedoc-smoke hang-megfelelője). Az audio-export a `/render`-en in-process megy (≤15s), ffmpeg-gel.
- [x] ✅ **Audio-smoke mátrix** — KÉSZ ([server/smokeAudioFixtures.js](../../server/smokeAudioFixtures.js) pure-mag +
  [server/scripts/audio-smoke.js](../../server/scripts/audio-smoke.js) runner, `npm run smoke:audio`; validáció:
  [smokeAudioFixtures.test.js](../../server/smokeAudioFixtures.test.js), +6 teszt): **18 per-funkció** audio-fixture →
  `/render` WAV → **mérés** (`ffprobe` hossz/csatorna + `loudnorm` Integrated-LUFS/True-Peak + `astats` per-csatorna RMS):
  volume · **fade** · **pan L/R** · **automation** · **per-klip audioFx** (highpass/lowpass/EQ/denoise/deesser/compressor/
  limiter/reverb/delay) · **voice-enhance** + **de-reverb** · **autoDuck** · **Master** (podcast/music/multiband) ·
  **3-track mix**. **ÉLŐ FUT 18/18** (2026-10-11), automata-ellenőrzésekkel.
- [x] ✅ **Master-LUFS verifikáció (mérve)**: a 2-passzos loudnorm **célba talál** — podcast **−16.1 ≈ −16**,
  music **−14.1 ≈ −14** (±1.5 LU-n belül); volume=0.5 **pontosan −6 LU**; voice-enhance a lánc végi loudnorm-mal **−16.0**.
- [x] ✅ **Pan mérve helyes**: pan=−1 → bal −24.1 / jobb **−∞** (néma); pan=+1 → jobb −24.1 / bal **−∞**. *(Menet közben
  a harness mérő-regexét kellett javítani — az astats `-inf` némát eldobta; a renderelt pan maga HELYES.)*
- [x] ~ **Parity-jegyzőkönyv**: `.audio-smoke/manifest.json` (mért LUFS/TP/RMS/hossz + verdikt). A végső fül-parity
  emberi, de a mérőszámok rögzítve.

### 2. 🟡 Preview ↔ export parity (a legnagyobb UX-csapda)
Ma az előnézet **nem** alkalmazza a per-klip `audioFx`-et, a master-loudnorm-ot/dinamikát és a pan/stereo-generálást →
a felhasználó mást hall szerkesztéskor, mint az exportban.
- [ ] 🟡 **Per-klip audioFx az előnézetben**: legalább a fő fx-ek (EQ/szűrők/reverb/delay) hallhatók élőben
  (react-native-audio-api / expo-audio graph), VAGY — ha a live-DSP túl drága — **proxy-render** a fx-elt klipre (mint
  a voice-enhance ma), hogy ne csak az exportban derüljön ki.
- [ ] 🟡 **Master-loudness „monitor"**: a loudnorm live túl drága → legalább **jelzett** eltérés (a MasterSheet mondja:
  „a végső hangerő az exportban simul a cél-LUFS-ra"), és/vagy egy **egyszeri „Master-előnézet"** (worker-render a
  teljes mixre, visszajátszva).
- [ ] 🟡 **Pan/fade/automation egyezés**: az előnézet lineáris rámpái és a worker `fade`/automation-görbéi egyezzenek
  (FPS-független) — a smoke-ban (#1) mérve.

### 3. 🟡 Export-teljesség + minőség
Ma az export **WAV/MP3/AAC/FLAC** ([render.ts](../../src/lib/render.ts) `exportAudioFile` + [render.js](../../server/render.js)
`AUDIO_FORMATS`), de a minőség/paraméter-választás hiányzik a UI-ból.
- [ ] 🟡 **Minőség/paraméter-UI**: a `RenderSettings` már vesz `sampleRate` (44.1/48k) · `channels` (mono/stereo) ·
  `audioBitrateKbps`-t — tegyük **kliens-választhatóvá** az export-dialógusban (ma fix: 192k/stereo/worker-default).
- [ ] ⬜ **Opus/OGG** (kisebb, streamelhető) a formátum-listához (a prod ffmpeg-image-ben a `libopus` legyen meg).
- [ ] ⬜ **Hossz/méret-plafon**: nagyon hosszú projekt (pl. >2 óra) render-idő/memória — beszédes határ (a kép
  nagy-doc-guard hang-megfelelője).

### 4. 🔌 Worker-infra (az audio-exporthoz) — közös a videóval
- [ ] 🔌 **A >15s audio-export a BullMQ queue-ra megy** (`CLOUD_RENDER_MIN_SEC`), worker nélkül **25%-on ragad**
  (ugyanaz a csapda, mint a videónál) — a prod worker-pool + health kell. A ffmpeg-image a közös
  [server/Dockerfile](../../server/Dockerfile) (audio-codecek: aac/mp3/flac ✅; **opus** hozzáadandó, ha kell).
- [ ] 🔌 **Deploy + health** (közös az [01 §2.2](./01-production-go-live.md)-vel) — a `/render`+`/audio/*` a prod API-n.

---

## P1 — valós-világ robusztusság / teljesség

### 5. ⬜ Bemeneti audio-robusztusság
A prod-userek tetszőleges hangot dobnak be (import / videó-hang / felvétel).
- [ ] ⬜ **Formátum-lefedettség**: mp3/m4a/aac/wav/flac/**opus/ogg** + videóból leválasztott hang; változó
  **sample-rate** (a mix egységes SR-re konvertál) és **mono/stereo** keverék; **VBR/korrupt** fájl → barátságos hiba
  (ne csendben némuljon el a track). A felvett voiceover (expo-audio) formátum-egyezése a workerrel.
- [ ] ⬜ **Hossz/duration-kiolvasás**: az import valós hosszának megbízható kiolvasása (a timeline-pozícióhoz).

### 6. 🔌 Stem-szeparáció (Demucs) — env-gated infra
- [ ] 🔌 A `/audio/stems` ([stems.ts](../../src/lib/stems.ts) → worker) **Demucs**-ot igényel (Python/torch) → NEM fér
  bele a sima Node/ffmpeg-image-be: **külön worker-image / sidecar** (nagy: torch+modell) + env-gate + 503-fallback
  (ma scaffold). Runtime-verify, ha a Demucs telepítve van. Pro-only.

### 7. ⬜ i18n konszolidáció
- [ ] ⬜ A hang-UI kulcsai **négy névtérben** szórtan: `studio.audio.*`, `studio.audioTools.*`, `panels.audio.*`,
  `hangStudio.*` (legacy). Egységesítés `studio.audio*`-ra (a `hangStudio.*` kivezetése), a 3 nyelv (hu/en/de) szinkronban.

### 8. 🟡 Automation / mixer UI (a magok készek)
- [ ] 🟡 **Automation idővonal-szerkesztő**: az [automation.ts](../../src/lib/automation.ts) (volume/pan/send/filter
  lane-ek + breakpoint + interpoláció) kész és renderel, de **nincs idővonal-UI** a töréspontok szerkesztéséhez.
- [ ] 🟡 **Mixer-UI**: a [mixer.ts](../../src/lib/mixer.ts) (bus/send/sidechain/EQ/kompresszor adat-modell) kész, de a
  MasterSheet csak master-volume + preset + 3-sávos EQ + multiband-toggle — a **custom bus/send/sidechain** UI hiányzik.

---

## P2 — feature-farok (nem prod-blokkoló)

- [ ] ⬜ **Fejlett mixer** (custom bus/send/sidechain-láncok UI-ja a `mixer.ts` fölött).
- [ ] ⬜ **Pitch-correction UI a Hang Stúdióban** (a [pitch.ts](../../src/lib/pitch.ts) mag kész; ma csak a Vocal
  Studio-ban [videó] van bekötve).
- [ ] ⬜ **Multiband master per-sáv** finomhangolás (ma on/off; a worker `masterGraph` 3-sávot tud).
- [ ] ⬜ **Beat-detektálás → vágás/marker** finomítás (a UI-kulcsok [`beatToCuts`/`beatToMarkers`] megvannak).

---

## 3. Kész, ha
A Hang Stúdió **prod-ban** megbízható: az **export hangzása egyezik az előnézettel** (export-parity-mátrix + mért
LUFS/TP OK; a per-klip fx és a master vagy élőben hallható, vagy jelzetten az exportban simul), a felhasználó
**WAV/MP3/AAC/FLAC (+opus)-t** exportál választható minőséggel (sample-rate/channel/bitráta), a **bemeneti hangok**
(formátum/SR/hossz/korrupt) robusztusan kezeltek, a **worker-pool él** (a >15s export nem ragad 25%-on), a **stem-
szeparáció** env-gated infrával fut, és (stretch) az **automation/mixer UI** kiteljesedik.
