# 🎧 AUDIO — a Hang Stúdió DAW-érettsége (hiányosságok + terv)

> **Mi ez:** őszinte állapot-felmérés + hiány-lista, hogy az Audio Studio olyan **funkció-dús**
> legyen, mint a videó-szerkesztő (20 panel) — alkalmas **zenekészítésre**, **profi vágásra**,
> **mixelésre** és **masterelésre**. Párok: [AUDIO-STUDIO-PROD.md](./AUDIO-STUDIO-PROD.md) ·
> [MISSS-IIING.md](./MISSS-IIING.md) · [00-README.md](./00-README.md).
>
> **Tag:** ✅ kész · 🟡 **mag KÉSZ+tesztelt, csak UI-bekötés hiányzik** · 🔌 worker/infra · ⬜ nulláról.

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
- [x] ✅ **Teljes per-klip FX-lánc** (ClipEditSheet): highpass/lowpass · 3-sávos EQ · denoise · de-esser ·
  kompresszor · limiter · normalize · reverb · delay — mind a worker `audioFxChain`-jével renderel.
- [x] ✅ **Hangerő-automáció** (KeyframeGraphEditor → `clip.keyframes.volume`) — a worker `eval=frame`-mel égeti be.
- [x] ✅ **Pásztázás-automáció** (ÚJ): `clip.keyframes.pan` → a worker per-frame `aeval` sztereó-balanszként.
  *ÉLŐ-BIZONYÍTVA: L→R söprés → bal csatorna −8.4 dB, jobb +8.4 dB az idő haladtával (worker-mérés).*
- [x] ✅ **Sidechain-duck** (zene a beszéd alá) — a Mixerben (§2), worker-verifikált.
- [ ] ⬜ **Tempó-szinkron effektek** (delay/LFO a BPM-hez) · **track/bus-insert FX** (ma per-klip) ·
  **send-buszok** (a `mixer.ts` toRenderPlan magja kész, worker send-routing hátra).

## 5. 🎹 Zenekészítés (DAW-mag) — ⬜ hiányzik (a legnagyobb rés)
- [ ] ⬜ **Piano-roll + MIDI**: hangjegy-szerkesztő, MIDI import/export, kvantálás/swing (a `musicTime.quantize`
  **kész**), velocity, hossz.
- [ ] ⬜ **Virtuális hangszerek**: legalább 1 szintetizátor + **sampler/drum-rack** (one-shotok) + hangszer-preset.
- [ ] ⬜ **Loop/minta-böngésző**: tempóhoz igazodó loopok, one-shotok, előre felvett sávok (a „zenekészítés" belépője).
- [ ] 🟡 **BPM/tempó + ütem-rács + metronóm** — a [`musicTime.ts`](../../src/lib/musicTime.ts) (bars/beats,
  tempo-map, quantize+swing, loop) **KÉSZ+tesztelt**; kell: UI (BPM-mező, rács, metronóm-hang).
- [ ] 🟡 **Hangmagasság-javítás / auto-tune** — a [`pitch.ts`](../../src/lib/pitch.ts)
  (pitchCorrectionPlan/harmonyLine/skála-snap) **KÉSZ+tesztelt, 0 UI**; kell: detektálás + render-bekötés + UI.
- [ ] ⬜ **Hangszer-rögzítés** élő monitorozással (a mikrofon-felvétel megvan, a monitor/latency-komp nem).

## 6. 🎚️ Mixelés & masterelés — 🟡 jó alap, mélység hiányzik
- [x] ✅ **Master-lap**: master-hangerő + sávonkénti fader + master-lánc (EQ/loudnorm-**LUFS-cél**/true-peak limiter) +
  **Analyze** (LUFS/TP/LRA meter) — a [`audioMaster.ts`](../../src/lib/audioMaster.ts) + worker-render (loudnorm/alimiter).
- [ ] ⬜ **Multiband master per-sáv** finomhangolás (ma on/off; a worker `masterGraph` 3 sávot tud).
- [ ] ⬜ **Referencia-A/B** (saját mix vs. referencia-track) · **dither** · platform-presetek (Spotify/YouTube/Apple célok).
- [ ] ⬜ **Valós idejű master-meter** (a lejátszás alatt), nem csak offline Analyze.

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
