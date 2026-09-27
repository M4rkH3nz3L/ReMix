# 🎧 ReMix Audio Studio — fejlesztési terv

> Forrás-vízió: [devs/source/AUDIO-MASTER.md](../source/AUDIO-MASTER.md) + [devs/source/EDITORS.md](../source/EDITORS.md).
> Cél-útvonal: `http://localhost:8081/studio/audio/<projectId>` → [src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx)

---

## 0. Kiindulás és cél

**Jelenlegi állapot — két külön dolog, amit egyesíteni kell:**

1. A `/studio/audio/[id]` képernyő ma **placeholder-váz** — statikus (sin-alapú) hullámforma, minden gomb `Alert('coming soon')`-t dob. Lásd [src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx).
2. A **valódi** hang-szerkesztés MA a **videó-editorban** él, két helyen:
   - [src/components/editor/HangStudio.tsx](../../src/components/editor/HangStudio.tsx) — teljes képernyős **egyklipes** modal (hangerő, fade, hossz-vágás, enhance/de-reverb/auto-duck), on-device `expo-audio` előnézettel + valódi hullámformával ([src/lib/waveform.ts](../../src/lib/waveform.ts)). A videóból a kijelölt audio-klipen az „Open Sound Studio” gomb nyitja (`openAudioStudio(clipId)`).
   - [src/components/editor/panels/AudioPanel.tsx](../../src/components/editor/panels/AudioPanel.tsx) — a timeline hang-panelje: könyvtár, saját import, felvétel, TTS/dub, beat-vágás, per-klip mix + Pro `AudioFx` lánc.

**Cél (a felhasználó kérése):**

> Építsük ki a `/studio/audio` képernyőt **valódi multi-track hang-stúdióvá** az [AUDIO-MASTER.md](../source/AUDIO-MASTER.md) vízió mentén — ÉS tegyük lehetővé, hogy a **videóból kiválasztott hang** (kijelölt audio-klip vagy egy videóklip leválasztott hangja) **közvetlenül EBBEN** a stúdióban legyen szerkeszthető. A videó-editor mai `HangStudio` modulját **le kell cserélni erre** (egyetlen, közös hang-szerkesztő).

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

### 🟦 Fázis A — A stúdió-héj valódi multi-track editorrá
Cél: `/studio/audio/[id]` többé nem placeholder. Működő idővonal + transport + valódi hullámforma, a `HangStudio` bevált logikájának **kiemelésével** (nem újraírásával).

- [ ] **Közös hookok kiemelése** a `HangStudio`-ból (hogy mindkét helyen ugyanaz fusson):
  - `useAudioClipPreview(clip)` — `expo-audio` player + `fadeFactor` + volume-kf követés (ma [HangStudio.tsx:109-152](../../src/components/editor/HangStudio.tsx#L109) inline).
  - `useWaveform(uri)` — a `getWaveform` köré (ma inline effect [HangStudio.tsx:95](../../src/components/editor/HangStudio.tsx#L95)).
  - A `RegionBar`/`Slider`/`ToggleRow` → közös `src/components/studio/audio/` primitívek.
- [ ] **`AudioStudio` képernyő-váz** ([src/app/studio/audio/[id].tsx](../../src/app/studio/audio/%5Bid%5D.tsx) átírása):
  - Top bar: vissza / cím / **Export** (valódi).
  - **Multi-track idővonal**: music / voiceover / sfx sávok egymás alatt, klipenként valódi `ClipWaveform` ([src/components/editor/ClipWaveform.tsx](../../src/components/editor/ClipWaveform.tsx), a clipping-detektálással), közös playhead-del.
  - **Transport**: `usePlaybackClock` ([src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts)) hajtsa a playheadet (ugyanaz az rAF-mesteróra, mint a videóban — AGENTS.md előírás).
  - **Lejátszás**: az [AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx) `TrackAudio` mintájára sávonként egy player, a playheadhez szinkronizálva (focus-gate a dupla-lejátszás ellen).
- [ ] **Eszköz-sor valódivá** (a mai `TOOLS` placeholder-ek helyett), mind `dispatch`-en át → undo:
  - `trim` → hossz-vágás (`RegionBar`) + `SPLIT_CLIP`.
  - `fade` → `fadeIn`/`fadeOut`.
  - `volume` → statikus `volume` + **volume-automáció** a `KeyframeGraphEditor`-ral (`keyframes.volume`, [AudioPanel.tsx:547](../../src/components/editor/panels/AudioPanel.tsx#L547)).
  - `enhance` → `voiceEnhance` / `deReverb`.
  - `effects` → a Pro `AudioFx` panel (highpass/lowpass/EQ/denoise/de-esser/compressor/limiter/normalize/reverb/delay) — kiemelve az [AudioPanel.tsx:568](../../src/components/editor/panels/AudioPanel.tsx#L568) blokkból.
  - `record` → `expo-audio` recorder (mint [AudioPanel.tsx:252](../../src/components/editor/panels/AudioPanel.tsx#L252)).
  - `pan` → sztereó pásztázás (`clip.pan`).
- [ ] **Klip-hozzáadás** a stúdióban: könyvtár / import / TTS — az `AudioPanel` blokkjainak újrahasználásával (közös komponensbe).
- [ ] **Frame-snap**: minden vágás/keyframe `snapToFrame`-re ül ([src/lib/frames.ts](../../src/lib/frames.ts)).
- [ ] **i18n**: `studio.audioTools.*` már megvan; a `hangStudio.*` kulcsok újrahasznosíthatók (en/de/hu).

### 🟩 Fázis B — Videó ↔ Audio Stúdió integráció (a `HangStudio` LECSERÉLÉSE)
Cél: a videóból kiválasztott hang KÖZVETLENÜL a közös stúdióban szerkeszthető; a régi egyklipes `HangStudio` megszűnik.

- [ ] **„Open in Audio Studio”** a videó-editorból:
  - Az `AudioPanel` „Open Sound Studio” gombja ([AudioPanel.tsx:495](../../src/components/editor/panels/AudioPanel.tsx#L495)) és a kijelölt audio-klip (`selectedClipId`) → a közös `AudioStudio`-t nyitja **`scoped` módban**, a klipre fókuszálva.
  - Megvalósítás: a mai `openAudioStudio(clipId)` / `audioStudioClipId` store-mezők ([editorStore.ts:398](../../src/store/editorStore.ts#L398)) **maradnak** (a fókusz-klip jelzésére), de a `HangStudioSession` helyett a teljes `AudioStudio` komponens nyílik Modalban (megőrzi a videó-editor állapotát; nincs navigációs csere).
- [ ] **Videóklip HANGJÁNAK szerkesztése** („videóból kiválasztott dolgok”) — két út, mindkettő non-destruktív:
  - **(a) In-place**: a `VideoClip.volume` / `fadeInSec` / `fadeOutSec` / `voiceEnhance` / `deReverb` már a klipen van ([project.ts:497](../../src/types/project.ts#L497)) — a stúdió `video-clip-audio` almódban ezeket a mezőket szerkeszti (a hullámformát a videó hangsávjából dekódolva).
  - **(b) Detach audio** (leválasztás): új segéd `extractAudioFromClip(videoClip)` → a videóklip hangját külön `AudioClip`-ként a `voiceover`/`sfx` sávra teszi (a videóklip elnémul), majd a stúdió AZT szerkeszti teljes fegyverzettel. A demux on-device FFmpeg-gel (rövid), workerben (hosszú) — a render-úttal közös.
- [ ] **A régi `HangStudio.tsx` nyugdíjazása**: vagy törlés, vagy vékony átirányító a közös `AudioStudio`-ra. Az [editor/[id].tsx:630](../../src/app/editor/%5Bid%5D.tsx#L630) `<HangStudio />` mountot lecseréljük a közös komponens Modaljára. **A cél: egy hang-szerkesztő maradjon.**
- [ ] **Visszaút**: „Done” után a videó-timeline azonnal frissül (ugyanaz a store), a preview `AudioLayer` a friss paramétereket játssza.

### 🟨 Fázis C — Mixer + Master (AUDIO-MASTER)
Cél: az AUDIO-MASTER „AUDIO / AI / MASTER” felépítés.

- [ ] **Mixer nézet**: sávonként fader (volume), pan, **mute/solo** (a `mutedTracks`/`soloTracks` már a store-ban — [editorStore.ts:152](../../src/store/editorStore.ts#L152)), auto-duck a beszéd alatt (`autoDuck`, már render-oldalon sidechain).
- [ ] **Master panel** (AUDIO-MASTER „MASTER” blokk):
  - Target preset: `Video` / `Podcast` / `Music` / `Social` / `Custom`.
  - Loudness (LUFS), True Peak (dBTP), Dynamics (Balanced/…).
  - **Analyze** gomb → worker: Integrated LUFS, True Peak, Noise, Dynamic Range, speech-clarity (az AUDIO-MASTER analízis-blokkja).
  - **APPLY MASTER** → projekt-szintű master-lánc a renderben (`loudnorm` + `alimiter`), új mező: `project.audioMaster`.

### 🟧 Fázis D — AI Audio réteg (worker) — Pro
Cél: az EDITORS.md „AI: Clean / Separate / Enhance / Tune / Mix / Master”.

- [ ] **On-device / render-FFmpeg (ingyen, kész alap)**: denoise, de-esser, compressor, limiter, normalize — már az `AudioFx` láncban.
- [ ] **Worker (Pro, BullMQ mint a render)**: stem separation, vocal isolation, hang-restauráció, AI-mastering analízis. Az eredmény **ÚJ `AudioClip` / stem-sáv** (non-destruktív), nem felülírás.
- [ ] **AI mint command-generátor**: prompt → `analyze` → command-lánc (`audioFx` + master), a közös command buszra (undo-zható). Ez alapozza meg a három-editor „univerzális ReMix Editing API”-ját (EDITORS.md).

### 🟥 Fázis E — Export / ReMix-integráció
- [ ] **Export formátumok**: WAV / FLAC / MP3 / AAC (worker; a videó-render AAC-útjának bővítése).
- [ ] **Vissza a videóba**: a `kind: 'audio'` projekt kimenete **asset-ként** a videó-editorba illeszthető (mint a kép-doksi kirasterizált PNG-je → média). Így a „kép/hang stúdió kimenete a videóban is használható” elv ([project.ts:16](../../src/types/project.ts#L16)) teljesül a hangra is.

---

## 3. Adatmodell-bővítések (minimál, additív — `schemaVersion` 7)

Mind opcionális, defaulttal — a régi projektek változatlanul betöltenek ([migrateProject](../../src/lib/projectUtils.ts#L137) mintájára).

- [ ] `AudioClip.trimIn?` + `AudioClip.sourceDuration?` — hogy a hossz-vágás ne csak **rövidíthessen** (ma „forrás-hossz nélkül csak rövidíteni tudunk”, [HangStudio.tsx:90](../../src/components/editor/HangStudio.tsx#L90)), hanem a forráson belül szabadon mozoghasson (mint a `VideoClip.trimIn`).
- [ ] `Project.audioMaster?: { target: 'video'|'podcast'|'music'|'social'|'custom'; lufs: number; truePeak: number; dynamics: 'natural'|'balanced'|'punchy' }` — a master-lánc.
- [ ] (Opcionális) stem-jelölés: `AudioClip.source: … | 'stem'` vagy külön sfx/music sáv elég a stem-eknek.

---

## 4. Érintett fájlok

**Újrahasznosítani (ne írjuk újra):**
- [src/lib/waveform.ts](../../src/lib/waveform.ts) — on-device dekódolás + cache (peaks).
- [src/components/editor/ClipWaveform.tsx](../../src/components/editor/ClipWaveform.tsx) — hullámforma-vizuál + clipping-jelzés.
- [src/components/editor/HangStudio.tsx](../../src/components/editor/HangStudio.tsx) — a preview/fade/trim logika kiemelendő innen.
- [src/components/editor/panels/AudioPanel.tsx](../../src/components/editor/panels/AudioPanel.tsx) — a `AudioFx`/mix/könyvtár/TTS blokkok kiemelendők.
- [src/components/preview/AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx) — sávonkénti lejátszás mintája.
- [src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts) — az rAF-mesteróra.
- [src/lib/keyframes.ts](../../src/lib/keyframes.ts) — `sampleChannel` (előnézet-paritás).
- [src/lib/frames.ts](../../src/lib/frames.ts) — `snapToFrame` / timecode.
- [src/lib/commands.ts](../../src/lib/commands.ts) + [src/store/editorStore.ts](../../src/store/editorStore.ts) — command bus + undo + selection (`selectedClipId`, `rangeIn/Out`, mute/solo).
- [server/voicechain.js](../../server/voicechain.js) + [server/render.js](../../server/render.js) — a render-oldali FFmpeg audio-lánc (paritás-forrás).

**Új:**
- `src/app/studio/audio/[id].tsx` (valódi editor) + `src/components/studio/audio/*` (Timeline, Mixer, MasterPanel, FxPanel, Transport, közös primitívek + hookok).
- `src/lib/audioMaster.ts` (master-preset → FFmpeg paraméterek) + `src/lib/audioExtract.ts` (detach/demux).
- Worker-endpointok: stem separation / analyze (LUFS/true-peak) / AI-master.

**Módosítani:**
- [src/store/editorStore.ts](../../src/store/editorStore.ts) — `openAudioStudio` a közös komponenshez köti (scoped mód + fókusz-klip).
- [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) — `<HangStudio />` → közös `AudioStudio` Modal.
- [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) — `kind: 'audio'` scaffold: egy üres music (vagy voiceover) sáv előre, mint a képnél az `imageDocs`.
- [server/render.js](../../server/render.js) — projekt-szintű master-lánc (`project.audioMaster`).

---

## 5. Nyitott kérdések / kockázatok

- **On-device DSP korlátai:** Expo Go-ban nincs `react-native-audio-api` natív modul → `getWaveform` `null`-t ad (a UI címkével/sávval él tovább). A nehéz DSP mindenképp render/worker. A production build (EAS) kell a teljes on-device élményhez.
- **Modal vs. route a videóból:** a terv **Modal**-t ajánl (megőrzi a videó-editor állapotát, nincs navigáció, ugyanaz a store). Ha a stúdió túl nehéz Modalban, alternatíva a `/studio/audio/[projectId]?focus=clipId` route. → **Döntés az A/B fázis határán.**
- **Stem separation modell:** worker ONNX (mint a bgremove/depth), Pro-kapuval — méret/futásidő tisztázandó.
- **`detach audio` demux:** rövid klipnél on-device, hosszúnál worker (a render-worker dev-stack már futó feltétel — 3 proc kell).

---

## 6. Definition of Done (A+B — a felhasználó fő kérése)

1. `/studio/audio/[id]` valódi, működő multi-track hang-editor (idővonal + waveform + transport + trim/fade/volume/pan/enhance/FX), minden művelet undo-zható.
2. A videó-editorból egy kijelölt audio-klip **ugyanezt** a stúdiót nyitja (nem a régi `HangStudio`-t), és a szerkesztés azonnal visszahat a videó-projektre.
3. Egy videóklip hangja szerkeszthető (in-place vagy detach) ugyanebben a stúdióban.
4. A régi `HangStudio.tsx` megszűnt / a közös komponensre irányít — **egy** hang-szerkesztő maradt.
5. `npm run audit` zöld (tsc + lint + jest).
