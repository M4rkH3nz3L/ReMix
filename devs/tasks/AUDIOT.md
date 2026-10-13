# 🎧 AUDIO — a Hang Stúdió DAW-érettsége (hiányosságok + terv)

> **Mi ez:** őszinte állapot-felmérés + hiány-lista, hogy az Audio Studio olyan **funkció-dús**
> legyen, mint a videó-szerkesztő (20 panel) — alkalmas **zenekészítésre**, **profi vágásra**,
> **mixelésre** és **masterelésre**. Párok: [AUDIO-STUDIO-PROD.md](./AUDIO-STUDIO-PROD.md) ·
> [MISSS-IIING.md](./MISSS-IIING.md) · [00-README.md](./00-README.md).
>
> **Tag:** ✅ kész · 🟡 **mag KÉSZ+tesztelt, csak UI-bekötés hiányzik** · 🔌 worker/infra · ⬜ nulláról.

---

## 🧭 HALADÁS — hol tartunk (2026-10, mind ÉLŐ worker-renderrel bizonyítva)

| § | Terület | Állapot |
|---|---------|---------|
| §1 | **Transport & idővonal** (undo/redo, loop, In/Out, beat-léptetés, zoom, snap, BPM, ütem-rács) | ✅ |
| §2 | **Mixer** (sávonkénti fader + némít/szóló + **sidechain-DUCK**) | ✅ |
| §3 | Klip-szerkesztés (klip-lap trim/fade/pan/EQ/FX) | ✅ *(idővonal-húzás/crossfade ⬜)* |
| §4 | **Effektek** (teljes klip-FX + **zajkapu** + volume/pan-**automáció**) | ✅ *(track/bus-insert, send ⬜)* |
| §5 | **Zenekészítés** (piano-roll **szintetizátor** + **dob-gép** + **sampler** + **pitch-shift** + **harmónia**) | ✅ *(auto-tune/skála 🟡, loop-böngésző ⬜)* |
| §6 | Mixelés & mastering (Master-lánc EQ/LUFS/limiter + Analyze + **platform-presetek**) | ✅ *(multiband/élő-meter ⬜)* |
| §7 | Elemzés/stemek/AI | 🟡 *(Analyze ✅, stem 🔌, spektrum/AI ⬜)* |
| §8 | UX-paritás a videó-editorral (panel-gazdagság, gyorsbillentyűk) | ⬜ |

**Bizonyított kör-sorozat** (feat/studio-gaps ág): transport → mixer+sidechain → pan-automáció →
szintetizátor → dob-gép → pitch-shift → harmónia → **zajkapu**. Minden tétel ÉLŐ worker-méréssel igazolva.

---

## 0. 🔎 Rövid diagnózis (miért tűnik „üresnek")

- A **transport-sor** (`AudioStudioBody` → `styles.transport`) **csak egy play/pause gomb + idő**. Se
  scrubber, se ugrás elejére/végére, se loop, se metronóm/BPM, se undo/redo, se zoom, se metering →
  **ez a „play gombnál üres sor"**.
- Az **eszköz-sor** mindössze **6 gomb**: hozzáad · felvétel · vágás · szerkeszt · törlés · master.
- A **sávfejek** csak **némítás/szóló**-t tudnak — nincs fader, pan, rec-arm, sáv hozzáadás/átnevezés.
- A **klipek nem húzhatók** az idővonalon (koppintás = kijelöl + playhead); nincs crossfade-fogó, nincs
  klip-gain-boríték, nincs reverse/normalize/time-stretch.
- **Fix 3 sáv** (music/voiceover/sfx) — nem bővíthető, nincs busz/send/group.
- **Nincs zenekészítő réteg**: se BPM/ütem-rács, se metronóm, se piano-roll/MIDI, se hangszer/szintetizátor/sampler.

**Ami viszont MÁR megvan (hogy fair legyen):** multi-track idővonal hullámformával; klip-szerkesztő
(trim/fade/hangerő/pan/3-sávos EQ/Pro FX/stem-split); **Master-lap** (master-hangerő + sávonkénti mixer-
fader + master-lánc EQ/loudnorm-LUFS/true-peak limiter + **Analyze** LUFS/TP/LRA); felvétel; TTS; könyvtár;
**album** (több szám + borító). A mag-réteg erős — a baj a **feltárás**.

---

## 1. 🧰 Transport & idővonal-navigáció — ✅ ALAP KÉSZ (2026-10, [audioTransport.ts])
- [x] ✅ **Gazdag transport-sor**: undo/redo · ugrás elejére/végére · **beat-léptetés** (előző/köv. beat) ·
  **loop** be/ki + **In/Out** + range-törlés · idő + **ütem.beat** kijelző · **BPM** léptető · **zoom ±** · **snap** (frame/beat/off).
- [x] ✅ **Beat-rács overlay** (ütem-vonalak, downbeat kiemelve) + **loop-régió árnyék** az idővonalon.
- [x] ✅ **Idő ütemben** (bars:beats) + **beat-snap** — a `musicTime.ts` + új `audioTransport.ts` (pure, 6 teszt) bekötve;
  `Project.bpm` + `SET_BPM` command (undo-zható). *Bizonyítva: unit-teszt + audit-zöld (190 suite/2039 teszt).*
- [ ] ⬜ **scrub** (húzható playhead) · **metronóm hang** (ma vizuális rács) · **count-in** felvételhez · **fit-zoom**.
- [ ] ⬜ **Markerek & régiók** az idővonalon (a `Project.markers`/`regions` típus már létezik, a videóban használt).

## 2. 🎚️ Sávok & keverő (mixer) — ✅ ALAP MIXER KÉSZ (2026-10, [MixerSheet], [mixerView.ts])
- [x] ✅ **Mixer-nézet**: dedikált csatorna-szalagok (sávonkénti **fader** dB-kijelzéssel + **némít/szóló** +
  **DUCK**), Master-lánc gomb. A fader a `SET_TRACK_GAIN`→`trackMix[type].gain`-t írja (a worker rendereli).
  *ÉLŐ-BIZONYÍTVA: gain 0.5 → −6.0 dB a kimeneten (worker-mérés, volumedetect).*
- [x] ✅ **Sidechain-duck** csatornánként — a DUCK a sáv klipjeire `autoDuck`-ot állít; a worker
  `sidechaincompress`-szel a zenét/sfx-et a voiceover alá halkítja. *ÉLŐ-BIZONYÍTVA: a beszéd-régióban a
  duckolt zene −2.6 dB-lel halkabb (worker-mérés).* A `mixerView.ts` pure mag (gain↔dB/fader/duck) 6 teszt.
- [ ] 🟡 **Busz/Send/Group** (a `mixer.ts` toRenderPlan magja kész) — **worker send-routing** hátra (a sidechain már megy).
- [ ] ⬜ **Dinamikus sávkezelés**: sáv hozzáadás/törlés/átnevezés/szín/sorrend (ma fix 3 sáv) + **rec-arm**.
- [ ] ⬜ **Insert-FX sávonként** (ma csak klipenként) + **valós idejű metering** (ma offline Analyze).

## 3. ✂️ Klip-szerkesztés az idővonalon — ⬜ nyitott (erős klip-lap VAN)
- [x] ✅ **Klip-lap** (ClipEditSheet): trim · fade be/ki · hangerő · pan · 3-sávos EQ · Pro FX · stem-split.
- [ ] ⬜ **Közvetlen manipuláció**: klip **húzás/mozgatás**, **szél-trim**, **crossfade-fogó** két klip között.
- [ ] ⬜ **Klip-gain boríték** (húzható) · **normalize** · **reverse** · **time-stretch/pitch-shift** (tempóhoz).
- [ ] ⏺️ **Comping / take-lanes** (felvétel-változatok összevágása) · **ismétlés/duplázás** · **ripple-törlés**.
- [ ] 🟡 **Beat-re vágás/marker** — a `beatToCuts`/`beatToMarkers` kulcsok megvannak, UI-finomítás hátra.

## 4. 🎛️ Effektek & feldolgozás — ✅ NAGYRÉSZT KÉSZ
- [x] ✅ **Teljes per-klip FX-lánc** (ClipEditSheet): highpass/lowpass · 3-sávos EQ · denoise · **zajkapu (gate)** ·
  de-esser · kompresszor · limiter · normalize · reverb · delay · **sztereó-szélesítés (haas)** — mind a worker
  `audioFxChain`-jével renderel. *ÉLŐ-BIZONYÍTVA: zajkapu → halk szakasz −24 dB; sztereó-szélesítés → a mono
  side-energia −84→−13 dB (worker-mérés).*
- [x] ✅ **Hangerő-automáció** (KeyframeGraphEditor → `clip.keyframes.volume`) — a worker `eval=frame`-mel égeti be.
- [x] ✅ **Pásztázás-automáció** (ÚJ): `clip.keyframes.pan` → a worker per-frame `aeval` sztereó-balanszként.
  *ÉLŐ-BIZONYÍTVA: L→R söprés → bal csatorna −8.4 dB, jobb +8.4 dB az idő haladtával (worker-mérés).*
- [x] ✅ **Sidechain-duck** (zene a beszéd alá) — a Mixerben (§2), worker-verifikált.
- [ ] ⬜ **Tempó-szinkron effektek** (delay/LFO a BPM-hez) · **track/bus-insert FX** (ma per-klip) ·
  **send-buszok** (a `mixer.ts` toRenderPlan magja kész, worker send-routing hátra).

## 5. 🎹 Zenekészítés (DAW-mag) — ✅ ALAP SZINTETIZÁTOR + PIANO-ROLL KÉSZ (2026-10)
- [x] ✅ **Piano-roll** ([PianoRollSheet]) — hangjegy-rács (hangmagasság-sorok × ütem-oszlopok), koppintás
  add/törlés, hullámforma-választó (sine/square/triangle/saw), ütem-szám; a `synth.ts` pure mag (7 teszt).
- [x] ✅ **Szintetizátor-render** — worker [`server/synth.js`] (MIDI→frekvencia, sine/sq/tri/saw + ADSR + amix +
  limiter) a `/synth` endpointon; a piano-roll a kész hangot sima klipként teszi a music-sávra (`synthClient.ts`).
  *ÉLŐ-BIZONYÍTVA: A4-hang → 440 Hz sáv 30 dB-lel dominál a 880 fölött; A4→A5 szekvencia → a 2. szakaszban a 880
  dominál; a `/synth` endpoint HTTP 200 + 440 Hz. (worker-mérés, bandpass+volumedetect.)* `synth.test.js` 6 teszt.
- [ ] ⬜ **MIDI import/export** · **kvantálás/swing UI** (a `musicTime.quantize` mag kész) · velocity-szerkesztés ·
  **hangjegy-perzisztencia** (ma a piano-roll hanggá ég → a kotta nem szerkeszthető újra).
- [x] ✅ **Dob-gép / step-sequencer** ([DrumMachineSheet]) — kick/snare/hihat/clap **szintetizálva** (nincs
  minta-fájl-függés), 16-od rács × ütem, „Sávra" → worker `/drums` → klip (`drumsClient.ts`). A `drums.ts`
  pure mag (7 teszt) + `server/drums.js` (5 teszt). *ÉLŐ-BIZONYÍTVA: kick a beateken −7 dB vs közöttük −43 dB
  (36 dB), hihat a magas-sávban a lépésén (worker-mérés, bandpass+volumedetect); /drums HTTP 200.*
- [x] ✅ **Sampler** ([SamplerSheet]) — a user SAJÁT mintáját (one-shot) step-rácsra helyezi: minta-választás +
  egysoros 16-od rács → worker `/sampler` (multipart: minta-fájl + lépések → `asplit`+`adelay`+`amix`) → klip
  (`samplerClient.ts`). A `sampler.ts` pure (6 teszt) + `server/sampler.js` (4 teszt). *ÉLŐ-BIZONYÍTVA: a feltöltött
  minta a 0/0.5/1/1.5s lépéseken −20.7 dB, közöttük −91 dB (csend); /sampler HTTP 200 (worker-mérés).*
- [ ] ⬜ **loop/minta-böngésző** (beépített loop-könyvtár) + több hangszer-preset.
- [x] ✅ **BPM/tempó + ütem-rács** — a transportban (§1) kész; metronóm-hang hátra.
- [x] ✅ **Hangmagasság-eltolás (transzponálás)** — per-klip `audioFx.pitchSemitones` (−12…+12), a worker
  asetrate+aresample+atempo-val, **HOSSZ-tartó** (nem chipmunk); ClipEditSheet csúszka. *ÉLŐ-BIZONYÍTVA:
  440Hz klip +12 félhang → 880Hz a kimeneten, 3.0s változatlan (worker-mérés).*
- [x] ✅ **Harmónia-hang** — per-klip `audioFx.harmony` (−12…+12): a klip mellé kevert, eltolt halkabb
  másodhang (külön dekód → kombinált pitch → száraz busz); ClipEditSheet csúszka. *ÉLŐ-BIZONYÍTVA:
  440Hz klip +7 harmónia → a mixben 440 ÉS 659 Hz (kvint) is szól (worker-mérés).*
- [ ] 🟡 **Auto-tune (skálára-illesztés)** — a `pitch.ts` (pitchCorrectionPlan/snapMidiToScale) + a pitch-shift
  mag kész; hátra a hangmagasság-**detektálás** (worker-DSP) + a per-szegmens korrekció render-bekötése + UI.

## 6. 🎚️ Mixelés & masterelés — ✅ MÉLYÜLT (platform-presetek)
- [x] ✅ **Master-lap**: master-hangerő + sávonkénti fader + master-lánc (EQ/loudnorm-**LUFS-cél**/true-peak limiter) +
  **Analyze** (LUFS/TP/LRA meter) — a [`audioMaster.ts`](../../src/lib/audioMaster.ts) + worker-render (loudnorm/alimiter).
- [x] ✅ **Platform-célú mastering-presetek** — YouTube/Spotify/TikTok (−14) · Apple Music (−16) · Club (−9),
  a publikálási hangosság-szabványokhoz; MasterSheet-chipek + i18n (hu/en/de). *ÉLŐ-BIZONYÍTVA: a renderelt
  kimenet pontosan a cél-LUFS-re áll (Apple −16 → mért −16.02, Club −9 → −8.99; worker loudnorm-mérés).*
- [ ] ⬜ **Multiband master per-sáv** finomhangolás (ma on/off; a worker `masterGraph` 3 sávot tud).
- [ ] ⬜ **Referencia-A/B** (saját mix vs. referencia-track) · **dither** · **valós idejű master-meter** (lejátszás alatt).

## 7. 🧪 Elemzés, stemek, AI — 🟡/🔌
- [x] ✅ **Analyze** (LUFS/TP/LRA) a masterhez.
- [ ] 🔌 **Stem-szeparáció** teljes UI — a [`stems.ts`](../../src/lib/stems.ts) + a klip-lap „split" kezd; a worker
  **Demucs**-ot igényel (külön image).
- [ ] ⬜ **Spektrum/spektrogram** nézet · **hangmagasság-detektálás** vizualizáció · **ütem-detektálás** jelölőkkel.
- [ ] ⬜ **AI-segéd** a hangra (dúdolás→dallam, „készíts dobsávot ehhez", zajszűrés/leválasztás).

## 8. 🧭 Munkafolyamat & UX-paritás a videó-editorral — ⬜
- [ ] ⬜ **Panel-gazdagság** a videóéhoz hasonlóan (ma 6 eszköz vs. 20 panel): dokkolt/behúzható eszköz-panelek.
- [ ] ⬜ **Billentyű/gesztus**: space=play, I/O=in/out, S=split, húzás-kijelölés, pinch-zoom.
- [ ] ⬜ **Preview↔export DSP-parity** (a per-klip fx + master élőben hallható legyen, ne csak renderben).
- [ ] ⬜ **Projekt-sablonok** (podcast/zene/hangoskönyv) + **csatorna-presetek**.

---

## 🎯 Javasolt sorrend (max hatás / min munka — a kész magokat feltárni ELŐSZÖR)

1. **🟡 Transport + sávfej felturbózás** (undo/redo, loop, scrub, snap, zoom, metronóm, BPM-kijelző) —
   kis UI, nagy „élő" érzés; a `musicTime` már kész.
2. **🟡 Mixer-nézet** (fader/pan/meter/rec-arm) + **busz/send/sidechain** a kész `mixer.ts` fölé — ez teszi „profivá".
3. **🟡 Automatizálás-görbék** a kész `automation.ts` fölé + **FX-lánc UI** (klip & sáv).
4. **🟡 Zenei időzítés UI** (BPM/rács/metronóm) → **⬜ Piano-roll/MIDI + 1 szintetizátor + sampler** (a tényleges zenekészítés).
5. **🟡 Auto-tune UI** (`pitch.ts`) + **⬜ time-stretch/pitch-shift** + klip közvetlen-manipuláció (húzás/crossfade).
6. **⬜ Mastering-mélység** (multiband, platform-presetek, élő meter) + **🔌 stemek** (Demucs).

> **Egy mondatban:** a profi mixer/automation/pitch/zenei-időzítés **magja KÉSZ és tesztelt** — a Hang Stúdió
> „üressége" nagyrészt **UI-feltárás** kérdése; a valódi nulláról-rész a **zenekészítő DAW-mag** (piano-roll/MIDI +
> hangszerek/sampler) és a **klip-közvetlen-manipuláció**.
