# 🎧 ReMix Audio Studio — fejlesztési terv

> Forrás-vízió: a hang-stúdió + közös editor-nyelv vízió (`AUDIO-MASTER.md` + `EDITORS.md` — a nyers források a doksi-konszolidációkor törölve, git-historyban elérhetők). A terv önmagában teljes.
> Cél-útvonal: `http://localhost:8081/studio/audio/<projectId>` → [src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx)

> **📌 Állapot (2026-09-30, `studio-social` branch) — az A–E fázisok magja MEGVALÓSULT a kódban.**
> A `HangStudio.tsx` **megszűnt**; helyette a közös `src/components/studio/audio/*` stúdió fut (`AudioStudioModal` scoped módban a videóból, `AudioStudioBody` a `/studio/audio/[id]` route-on). A `HangStudio` egyklipes modálja → `ClipEditSheet` (trim/fade/volume/pan/enhance/Pro-FX/keyframe-automáció + stem-gomb), a placeholder-váz → valódi multi-track idővonal + transport + `usePlaybackClock` + `AudioLayer`. A tiszta magok (`mixer.ts`, `musicTime.ts`, `pitch.ts`, `waveform.ts`, `audioMaster.ts`, `audioExtract.ts`, `stems.ts`, `audioAnalyze.ts`, `audioToVideo.ts`) + a schema-bővítés (`AudioClip.trimIn/sourceDuration`, `Project.audioMaster`, `SET_AUDIO_MASTER` command) **kész**, `npm run audit` zöld.
> **Runtime-verifikáció HÁTRA (élő render-worker + ffmpeg/Demucs kell):** Export (WAV/MP3/AAC/FLAC), Master **Analyze** (LUFS/true-peak a renderelt mixen) és **stem-szeparáció** (Demucs env-kapuzva, worker nélkül 503). Az alábbi `[ ]` jelölések a MÉG nyitott finomításokat mutatják; a fő fázis-magok teljesültek.

---

## 0. Kiindulás és cél

**Kiindulási állapot (a terv írásakor) — két külön dolog volt, amit egyesíteni kellett:**

1. A `/studio/audio/[id]` képernyő **placeholder-váz** volt — statikus (sin-alapú) hullámforma, minden gomb `Alert('coming soon')`-t dobott. → **✅ megvalósult:** ma valódi multi-track editor, lásd [src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx) + [src/components/studio/audio/AudioStudioBody.tsx](../../src/components/studio/audio/AudioStudioBody.tsx).
2. A **valódi** hang-szerkesztés a **videó-editorban** élt, két helyen:
   - `HangStudio.tsx` — teljes képernyős **egyklipes** modal (hangerő, fade, hossz-vágás, enhance/de-reverb/auto-duck), on-device `expo-audio` előnézettel + valódi hullámformával ([src/lib/waveform.ts](../../src/lib/waveform.ts)). A videóból a kijelölt audio-klipen az „Open Sound Studio” gomb nyitotta (`openAudioStudio(clipId)`). → **✅ lecserélve:** a `HangStudio.tsx` **megszűnt**, helyére a közös [AudioStudioModal.tsx](../../src/components/studio/audio/AudioStudioModal.tsx) (scoped Modal) + [ClipEditSheet.tsx](../../src/components/studio/audio/ClipEditSheet.tsx) (klip-szerkesztő lap) lépett.
   - [src/components/editor/panels/AudioPanel.tsx](../../src/components/editor/panels/AudioPanel.tsx) — a timeline hang-panelje: könyvtár, saját import, felvétel, TTS/dub, beat-vágás, per-klip mix + Pro `AudioFx` lánc. (Az „Open Sound Studio” gombja most a közös `AudioStudioModal`-t nyitja `openAudioStudio(clip.id)`-vel.)

**Cél (a felhasználó kérése):**

> Építsük ki a `/studio/audio` képernyőt **valódi multi-track hang-stúdióvá** az **AUDIO-MASTER** vízió mentén — ÉS tegyük lehetővé, hogy a **videóból kiválasztott hang** (kijelölt audio-klip vagy egy videóklip leválasztott hangja) **közvetlenül EBBEN** a stúdióban legyen szerkeszthető. A videó-editor mai `HangStudio` modulját **le kell cserélni erre** (egyetlen, közös hang-szerkesztő).

**Vezérelvek** (AUDIO-MASTER + [AGENTS.md](../../AGENTS.md)):

- **Nem-destruktív processing graph** — soha nem égetjük bele az effektet a forrásba; a projektben csak a `volume`/`fade`/`audioFx`/`keyframes`/master-lánc paraméterek élnek. Az eredmény bármikor visszanyitható.
- **Command bus mindenhez** — minden szerkesztés `dispatch(command, actor)` / `applyBatch(...)` útján megy → undo/redo ingyen. A projektet SOHA nem írjuk közvetlenül.
- **Réteg-felosztás:** könnyű DSP **on-device** (élő `expo-audio` előnézet + FFmpeg render-paritás), nehéz AI (stem separation, vocal isolation, restoration, AI-mastering analízis) a **workerben** (BullMQ, mint a videó-render).
- **Előnézet = export.** Az élő előnézet a `fadeFactor` + `sampleChannel(volume-kf)` szorzót játssza; a végleges keverés a [server/voicechain.js](../../server/voicechain.js) / [server/render.js](../../server/render.js) FFmpeg-láncában készül (a render a mérvadó, lásd README). A nehéz FX-nél proxy-fájl a paritásra (mint [src/lib/voiceProxy.ts](../../src/lib/voiceProxy.ts)).
- **AI = command-generátor** (nem külön app): a „Tisztítsd meg és mastereld podcastra” ugyanazokat a commandokat küldi, amiket a user is — ugyanarra a command buszra.

---

## 1. Architektúra-döntések

### 1.1 Egyetlen komponens, két üzemmód
A hang-stúdió **egyetlen** `AudioStudio` komponens legyen, `mode` propszal — így a videóból és önállóan is UGYANAZ a UI és UGYANAZ a logika fut (ez a „lecserélés” lényege):

| mode | Mit szerkeszt | Belépés |
| --- | --- | --- |
| `project` | `kind: 'audio'` projekt teljes hang-műve (music/voiceover/sfx sávok) | `/studio/audio/[id]` route |
| `scoped` | egy videó-projekt hang-sávjai (music/voiceover/sfx), egy klipre/tartományra fókuszálva | a videó-editorból, Modalként |

**Miért ugyanaz a store:** a videó-projekt IS tartalmaz `music`/`voiceover`/`sfx` sávot (minden projekt megkapja a kanonikus sávokat — [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) `CANONICAL_TRACKS`). Így a stúdió a videóból **nem másol adatot** — ugyanazon a `useEditorStore` projekt-példányon dolgozik → a szerkesztés azonnal látszik a videó-timeline-on, és **undo-zható** ugyanabban a history-ban.

### 1.2 Nincs új adatmodell (additív bővítés a végén)
Az `AudioClip`, `AudioFx`, `keyframes.volume` és a music/voiceover/sfx sávok **már léteznek** ([src/types/project.ts](../../src/types/project.ts:929)). Ezekre építünk. Ami hiányzik, azt a 3. szakasz sorolja fel (kis, additív, `schemaVersion`-migrációval).

### 1.3 Command bus — új parancs-típus NEM kell (egyelőre)
A meglévő `EditorCommand` union elég: `ADD_CLIP`, `ADD_CLIPS`, `UPDATE_CLIP`, `REMOVE_CLIP`, `SPLIT_CLIP`, `REPLACE_TRACK_CLIPS`, `REPLACE_TRACKS` ([src/lib/commands.ts](../../src/lib/commands.ts:24)). A hang-műveletek mind ezekre képződnek le (trim = `SPLIT_CLIP`+duration; volume/fade/fx = `UPDATE_CLIP`). Dedikált deklaratív parancsok (`CUT_AUDIO`, `EQ`, `MASTER` — lásd EDITORS.md common-language ábra) csak akkor, ha az **AI-nak** kell tiszta felület → D fázis, opcionális.

### 1.4 Pro-kapu
On-device DSP (trim/fade/volume/EQ-előnézet) = **ingyen**. Nehéz AI (stem, vocal isolation, AI-master, HD-export) = **Pro**, a meglévő `guardPro(...)` mintával (már használt az AudioPanelben).

---

## 2. Fázisok

### 🟦 Fázis A — A stúdió-héj valódi multi-track editorrá — ✅ megvalósult
Cél: `/studio/audio/[id]` többé nem placeholder. Működő idővonal + transport + valódi hullámforma, a `HangStudio` bevált logikájának **átvitelével**.

- [x] **Közös primitívek + hook** a régi `HangStudio` mintájából ([src/components/studio/audio/primitives.tsx](../../src/components/studio/audio/primitives.tsx)):
  - `useWaveform(uri)` — a `getWaveform` köré (a `ClipEditSheet` `RegionBar`-ját hajtja).
  - A `RegionBar`/`Slider`/`ToggleRow` → közös `src/components/studio/audio/` primitívek.
  - (A klip-előnézetet scoped módban a videó-editor `AudioLayer`-e adja, route-módban a saját `<AudioLayer />` — nincs külön `useAudioClipPreview` hook, a stúdió-body nem duplázza a lejátszást.)
- [x] **`AudioStudioBody` képernyő-törzs** ([src/components/studio/audio/AudioStudioBody.tsx](../../src/components/studio/audio/AudioStudioBody.tsx)), a route-burkoló [src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx):
  - Top bar: vissza / cím / **Export** (route-módban valódi export, scoped módban „Kész").
  - **Multi-track idővonal**: music / voiceover / sfx sávok egymás alatt, klipenként valódi `ClipWaveform` ([src/components/editor/ClipWaveform.tsx](../../src/components/editor/ClipWaveform.tsx), a clipping-detektálással), közös playhead-del + másodperc-ráccsal + timecode-vonalzóval.
  - **Transport**: `usePlaybackClock` ([src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts)) hajtja a playheadet a route-burkolóban (ugyanaz az rAF-mesteróra, mint a videóban — AGENTS.md előírás).
  - **Lejátszás**: a route-burkoló mountolja az [AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx)-t; scoped módban a videó-editor előnézete adja (a body NEM duplázza).
- [x] **Eszköz-sor valódi** (a `Tool` gombok), mind store-akción / `dispatch`-en át → undo:
  - `add` → klip-hozzáadás lap ([AddMediaSheet.tsx](../../src/components/studio/audio/AddMediaSheet.tsx)).
  - `record` → `expo-audio` recorder a voiceover sávra (a body `toggleRecord`-ja).
  - `split` → `splitClipAt(selClip.id, playhead)`.
  - `edit` → a `ClipEditSheet` (trim/fade/volume/pan/enhance/Pro-FX + volume-automáció).
  - `delete` → `removeClip`.
  - `master` → a `MasterSheet`.
  - **A klip-szintű trim/fade/volume/pan/enhance/FX + volume-automáció** a `KeyframeGraphEditor`-ral a `ClipEditSheet`-ben ([ClipEditSheet.tsx](../../src/components/studio/audio/ClipEditSheet.tsx)); a Pro `AudioFx` lánc (denoise/de-esser/compressor/limiter/normalize/reverb) is ott, `guardPro` mögött a stemeknél.
- [x] **Klip-hozzáadás** a stúdióban: könyvtár / import / TTS ([AddMediaSheet.tsx](../../src/components/studio/audio/AddMediaSheet.tsx) + [TtsSheet.tsx](../../src/components/studio/audio/TtsSheet.tsx)).
- [x] **Frame-snap**: a vágás/keyframe `snapToFrame`-re ül ([src/lib/frames.ts](../../src/lib/frames.ts)) — a body `seekAt`/`toggleRecord`-ja és a `ClipEditSheet` `onDone`-ja is snappel.
- [x] **i18n**: `studio.audioTools.*` + `studio.audio.*` + a `hangStudio.*` kulcsok újrahasznosítva (en/de/hu).

### 🟩 Fázis B — Videó ↔ Audio Stúdió integráció (a `HangStudio` LECSERÉLÉSE) — ✅ megvalósult
Cél: a videóból kiválasztott hang KÖZVETLENÜL a közös stúdióban szerkeszthető; a régi egyklipes `HangStudio` megszűnt.

- [x] **„Open in Audio Studio”** a videó-editorból:
  - Az `AudioPanel` „Open Sound Studio” gombja ([AudioPanel.tsx](../../src/components/editor/panels/AudioPanel.tsx)) a kijelölt audio-klipre → a közös stúdiót nyitja **`scoped` módban** (`openAudioStudio(clip.id)`), a klipre fókuszálva.
  - Megvalósítás: az `openAudioStudio(clipId)` / `audioStudioClipId` store-mezők ([editorStore.ts](../../src/store/editorStore.ts)) **megmaradtak** (a fókusz-klip jelzésére), és a `HangStudio` helyett a közös [AudioStudioModal.tsx](../../src/components/studio/audio/AudioStudioModal.tsx) nyílik Modalban (megőrzi a videó-editor állapotát; nincs navigációs csere; ugyanaz a store).
- [~] **Videóklip HANGJÁNAK szerkesztése** („videóból kiválasztott dolgok”) — két út, mindkettő non-destruktív:
  - **(a) In-place**: a `VideoClip.volume` / `fadeInSec` / `fadeOutSec` / `voiceEnhance` / `deReverb` már a klipen van ([project.ts](../../src/types/project.ts)) — a videó-editor panelein szerkeszthető. (A közös stúdió scoped Modalja MA csak HANGKLIPRE nyílik — az `AudioStudioModal` a `clip.kind === 'audio'`-ra kapuz —, videóklip hangját előbb le kell választani. A dedikált `video-clip-audio` almód még nyitott.)
  - **(b) Detach audio** (leválasztás): a segéd **✅ kész** — [src/lib/audioExtract.ts](../../src/lib/audioExtract.ts) `canDetachAudio(clip)` + `detachAudioCommands(clip)` a videóklip hangját külön `AudioClip`-ként a `voiceover`/`sfx` sávra teszi (a videóklip elnémul), non-destruktívan, EGY undo-lépésben. A UI a [SpeedPanel.tsx](../../src/components/editor/panels/SpeedPanel.tsx)-ben él; a leválasztott klip aztán a közös stúdióban szerkeszthető.
- [x] **A régi `HangStudio.tsx` nyugdíjazása**: **törölve.** Az [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) mountja `<AudioStudioModal />` (a régi `<HangStudio />` helyett). **A cél teljesült: egy hang-szerkesztő maradt.**
- [x] **Visszaút**: „Kész" után a videó-timeline azonnal frissül (ugyanaz a store), a preview `AudioLayer` a friss paramétereket játssza.

### 🟨 Fázis C — Mixer + Master (AUDIO-MASTER) — ✅ megvalósult ([MasterSheet.tsx](../../src/components/studio/audio/MasterSheet.tsx))
Cél: az AUDIO-MASTER „AUDIO / AI / MASTER” felépítés. A Mixer + Master EGY lapon él a `MasterSheet`-ben (a body `master` gombja nyitja).

- [x] **Mixer nézet**: sávonként **gain-fader** (`SET_TRACK_GAIN` → `project.trackMix[type].gain`) + **mute/solo** (a `mutedTracks`/`soloTracks` a store-ban — [editorStore.ts](../../src/store/editorStore.ts), `toggleTrackFlag`; a mute/solo a body sáv-fejléceiben IS ott van). Az auto-duck a beszéd alatt (`autoDuck`, per-klip a `ClipEditSheet`-ben) render-oldalon sidechain. (A per-sáv **pan** a mixerben nyitott finomítás; pan per-klip a `ClipEditSheet`-ben él.)
- [x] **Master panel** (AUDIO-MASTER „MASTER” blokk) — a `masterPreset(...)` presetekkel ([src/lib/audioMaster.ts](../../src/lib/audioMaster.ts)):
  - Target preset: `Video` / `Podcast` / `Music` / `Social` / `Custom`.
  - Loudness (LUFS), True Peak (dBTP), Dynamics (Natural/Balanced/Punchy).
  - **Analyze** gomb → `analyzeAudio(...)` ([src/lib/audioAnalyze.ts](../../src/lib/audioAnalyze.ts)): Integrated LUFS + True Peak a renderelt mixen (ha van), meter-összevetéssel a célértékhez. ⚠️ **Runtime:** élő render-worker + ffmpeg kell (a renderelt mix / proxy elemzéséhez).
  - **APPLY MASTER** → projekt-szintű master-lánc a renderben (`loudnorm` + `alimiter`), az új `project.audioMaster` mezőn át, `SET_AUDIO_MASTER` commanddal (undo-zható).

### 🟧 Fázis D — AI Audio réteg (worker) — Pro — részben megvalósult
Cél: az EDITORS.md „AI: Clean / Separate / Enhance / Tune / Mix / Master”.

- [x] **On-device / render-FFmpeg (ingyen, kész alap)**: denoise, de-esser, compressor, limiter, normalize — az `AudioFx` láncban (`ClipEditSheet` + `server/voicechain.js`).
- [~] **Worker (Pro, BullMQ mint a render)**: a **stem separation** kész — [src/lib/stems.ts](../../src/lib/stems.ts) `separateStems(uri)` → `POST /audio/stems` (`server/index.js`), Demucs-alapú, Pro-kapuval; az eredmény **ÚJ `AudioClip`** a voiceover/sfx sávra (non-destruktív, EGY undo, a `ClipEditSheet` `onSeparate`-je). ⚠️ **Runtime:** a worker Demucs nélkül **503**-at ad (env-kapuzva) → live worker + Demucs telepítés kell. A vocal isolation / hang-restauráció / AI-master további worker-módok NYITOTTAK.
- [ ] **AI mint command-generátor**: prompt → `analyze` → command-lánc (`audioFx` + master), a közös command buszra (undo-zható). Ez alapozza meg a három-editor „univerzális ReMix Editing API”-ját (EDITORS.md). — NYITOTT.

### 🟥 Fázis E — Export / ReMix-integráció — ✅ megvalósult
- [x] **Export formátumok**: WAV / FLAC / MP3 / AAC — [src/lib/render.ts](../../src/lib/render.ts) `exportAudioFile(project, format)` (cloud-render `audioFormat`-tal, a `-vn` audio-kivonat úttal), a route `downloadAudio` menüje (Pro-kapuval). ⚠️ **Runtime:** élő render-worker + ffmpeg kell a tényleges fájl-kimenethez.
- [x] **Vissza a videóba**: a `kind: 'audio'` projekt kimenete videó-projektbe illeszthető — [src/lib/audioToVideo.ts](../../src/lib/audioToVideo.ts) `audioProjectToVideo(...)` (a route `useInVideo`-ja új videó-projektet készít belőle). Így a „kép/hang stúdió kimenete a videóban is használható” elv teljesül a hangra is.

---

## 3. Adatmodell-bővítések (minimál, additív) — ✅ megvalósult

Mind opcionális, defaulttal — a régi projektek változatlanul betöltenek ([migrateProject](../../src/lib/projectUtils.ts) mintájára; a jelenlegi `schemaVersion` 6, az új mezők opcionálisak → nem kellett migrációs bump).

- [x] `AudioClip.trimIn?` + `AudioClip.sourceDuration?` ([project.ts](../../src/types/project.ts)) — hogy a hossz-vágás ne csak **rövidíthessen**, hanem a forráson belül szabadon mozoghasson (mint a `VideoClip.trimIn`). A `ClipEditSheet` `RegionBar`-ja ezt használja.
- [x] `Project.audioMaster?: AudioMaster` ([project.ts](../../src/types/project.ts) — `target: 'video'|'podcast'|'music'|'social'|'custom'`, `lufs`, `truePeak`, `dynamics: 'natural'|'balanced'|'punchy'`, + `eq`/`multiband`) — a master-lánc; `SET_AUDIO_MASTER` command írja.
- [x] stem-jelölés: külön voiceover/sfx sáv fogadja a stemeket (a `separateStems` a vocals-t voiceover-re, a többit sfx-re teszi) — külön `'stem'` `source`-típusra nem volt szükség.

---

## 4. Érintett fájlok

**Újrahasznosítva (nem írtuk újra):**
- [src/lib/waveform.ts](../../src/lib/waveform.ts) — on-device dekódolás + cache (peaks).
- [src/components/editor/ClipWaveform.tsx](../../src/components/editor/ClipWaveform.tsx) — hullámforma-vizuál + clipping-jelzés (a stúdió idővonala használja).
- [src/components/editor/panels/AudioPanel.tsx](../../src/components/editor/panels/AudioPanel.tsx) — a timeline hang-panelje (megmaradt; „Open Sound Studio"-ja a közös stúdiót nyitja).
- [src/components/preview/AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx) — sávonkénti lejátszás (a route-burkoló mountolja).
- [src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts) — az rAF-mesteróra.
- [src/lib/keyframes.ts](../../src/lib/keyframes.ts) — `sampleChannel` (előnézet-paritás).
- [src/lib/frames.ts](../../src/lib/frames.ts) — `snapToFrame` / timecode.
- [src/lib/commands.ts](../../src/lib/commands.ts) + [src/store/editorStore.ts](../../src/store/editorStore.ts) — command bus + undo + selection (`selectedClipId`, `rangeIn/Out`, mute/solo).
- [server/voicechain.js](../../server/voicechain.js) + [server/render.js](../../server/render.js) — a render-oldali FFmpeg audio-lánc (paritás-forrás).
- _(A `HangStudio.tsx` preview/fade/trim logikája átment a [ClipEditSheet.tsx](../../src/components/studio/audio/ClipEditSheet.tsx)-be + [primitives.tsx](../../src/components/studio/audio/primitives.tsx)-be; az eredeti fájl **törölve**.)_

**Létrejött (✅):**
- [src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx) (route-burkoló) + `src/components/studio/audio/*`: [AudioStudioBody.tsx](../../src/components/studio/audio/AudioStudioBody.tsx) (idővonal + transport + eszköz-sor), [AudioStudioModal.tsx](../../src/components/studio/audio/AudioStudioModal.tsx) (scoped Modal), [ClipEditSheet.tsx](../../src/components/studio/audio/ClipEditSheet.tsx), [MasterSheet.tsx](../../src/components/studio/audio/MasterSheet.tsx) (Mixer + Master), [AddMediaSheet.tsx](../../src/components/studio/audio/AddMediaSheet.tsx), [TtsSheet.tsx](../../src/components/studio/audio/TtsSheet.tsx), [primitives.tsx](../../src/components/studio/audio/primitives.tsx).
- [src/lib/audioMaster.ts](../../src/lib/audioMaster.ts) (master-preset → FFmpeg-paraméterek), [src/lib/audioExtract.ts](../../src/lib/audioExtract.ts) (detach), [src/lib/audioAnalyze.ts](../../src/lib/audioAnalyze.ts) (LUFS/true-peak), [src/lib/stems.ts](../../src/lib/stems.ts) (stem-szeparáció), [src/lib/audioToVideo.ts](../../src/lib/audioToVideo.ts) (audio→videó). Tiszta magok: [src/lib/mixer.ts](../../src/lib/mixer.ts), [src/lib/musicTime.ts](../../src/lib/musicTime.ts), [src/lib/pitch.ts](../../src/lib/pitch.ts).
- Worker-endpointok: `POST /audio/stems` (Demucs) + `POST /audio/analyze` (loudnorm) a `server/index.js`-ben. _(AI-master worker-mód: nyitott.)_

**Módosítva (✅):**
- [src/store/editorStore.ts](../../src/store/editorStore.ts) — `openAudioStudio`/`closeAudioStudio`/`audioStudioClipId` a közös `AudioStudioModal`-hoz (scoped mód + fókusz-klip).
- [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) — `<AudioStudioModal />` mount (a régi `<HangStudio />` helyett).
- [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) — `kind: 'audio'` scaffold + a kanonikus music/voiceover/sfx sávok.
- [server/render.js](../../server/render.js) — projekt-szintű master-lánc (`project.audioMaster` → `loudnorm` + `alimiter`).

---

## 5. Nyitott kérdések / kockázatok

- **On-device DSP korlátai:** Expo Go-ban nincs `react-native-audio-api` natív modul → `getWaveform` `null`-t ad (a UI címkével/sávval él tovább). A nehéz DSP mindenképp render/worker. A production build (EAS) kell a teljes on-device élményhez.
- **Modal vs. route a videóból:** a terv **Modal**-t ajánl (megőrzi a videó-editor állapotát, nincs navigáció, ugyanaz a store). Ha a stúdió túl nehéz Modalban, alternatíva a `/studio/audio/[projectId]?focus=clipId` route. → **Döntés az A/B fázis határán.**
- **Stem separation modell:** worker ONNX (mint a bgremove/depth), Pro-kapuval — méret/futásidő tisztázandó.
- **`detach audio` demux:** rövid klipnél on-device, hosszúnál worker (a render-worker dev-stack már futó feltétel — 3 proc kell).

---

## 6. Definition of Done (A+B — a felhasználó fő kérése) — ✅ teljesült

1. ✅ `/studio/audio/[id]` valódi, működő multi-track hang-editor (idővonal + waveform + transport + trim/fade/volume/pan/enhance/FX), minden művelet undo-zható.
2. ✅ A videó-editorból egy kijelölt audio-klip **ugyanezt** a stúdiót nyitja (a közös `AudioStudioModal`-t, nem a régi `HangStudio`-t), és a szerkesztés azonnal visszahat a videó-projektre (ugyanaz a store).
3. [~] Egy videóklip hangja szerkeszthető **detach**-csel ([audioExtract.ts](../../src/lib/audioExtract.ts) + SpeedPanel UI); a stúdión belüli dedikált **in-place** videóklip-hang almód még nyitott.
4. ✅ A régi `HangStudio.tsx` **megszűnt** — **egy** hang-szerkesztő maradt.
5. ✅ `npm run audit` zöld (tsc + lint + jest).
