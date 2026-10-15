# 📱 DEVICES.md — eszközön fejlesztendő kimaradások (3 stúdió)

> **Mi ez?** A három stúdió (videó · kép · audio) azon hiányzó funkciói, amelyek
> **NEM bizonyíthatók** a projekt eddigi módszerével (worker-render pixel/dB-mérés
> vagy tiszta unit-teszt). Ezekhez **valódi eszköz / dev-build** kell:
> Skia offscreen GPU-festés, natív enkóder (Android MediaCodec), **érintő-gesztusok**,
> **élő metering/scope-UI**, **mikrofon-felvétel**, külön infra (Demucs, env-gated AI).
>
> **Miért külön fájl?** A render/pure-magon bizonyítható munka kimerült (lásd a
> stúdiónkénti terveket). Ami marad, az eszköz-oldali — ezt itt gyűjtjük egy helyre,
> hogy a dev-build-tesztelés fókuszált legyen.
>
> **Források (szekciónkénti részletekkel):**
> [VIDEOT.md](./VIDEOT.md) · [imgedd.md](./imgedd.md) · [AUDIOT.md](./AUDIOT.md) ·
> natív motor: [09-native-rendering.md](./09-native-rendering.md).
>
> **Jelölés:** 📱 érintő/gesztus · 🎨 Skia offscreen GPU · 🎚️ élő metering/scope UI ·
> 🎙️ mikrofon/felvétel · 🔌 külön infra (enkóder/Demucs/AI) · 🧪 eszközön verifikálandó
> (a mag kész, de a „érzet"/futás csak eszközön mérhető).

---

## 🎬 Videó — eszköz-oldali kimaradások

> Forrás: [VIDEOT.md](./VIDEOT.md) §3, §5, §6, §7, §8, §9. A szín-paritás, az új
> effektek, a transzformáció (pivot/perspektíva) és a render-cache **render-bizonyított** —
> azok NEM ide tartoznak. Ami marad eszközre:

- [ ] 🔌 **On-device natív render** — a **#1 hiány**. iOS AVFoundation-motor v1 kész, az
  **Android MediaCodec** eszközön-render-motor hiányzik (ma csak triviális copy). Ez csak
  valódi eszközön/dev-buildben verifikálható (emulátor sw-GPU). → [09-native-rendering.md](./09-native-rendering.md).
- [ ] 📱 **Átmenet-UI gesztusok** — egyedi bezier-easing görbe-húzás az átmeneten, **csoportos
  átmenet** (egy típus több vágásra), **átmenet-könyvtár/mentett**. A mag (keyframe-bezier)
  kész, az érintős szerkesztő-felület és a drag eszközön verifikálandó.
- [ ] 🎚️ **3-way color wheels** (árnyék/középtónus/csúcsfény színkerék-UI a meglévő
  balance-mezőkre) — a grading render-bizonyított, a **színkerék-gesztus** eszköz-oldali.
- [ ] 🎚️ **Élő scopes** — histogram/waveform/vectorscope **valós-idejű** a preview-ból
  (ma csak közelítés). GPU-olvasás a preview-frame-ből → eszközön mérhető.
- [ ] 🎚️ **Audio metering/scope a mixerben** (peak/RMS/LUFS-mérő élőben) · **per-band solo/mute**
  a multibandban · sáv-almix. Az offline Analyze kész; az **élő meter** lejátszás-oldali.
- [ ] 📱 **Time-remap (sebesség-görbe)** UI + **per-effekt amount-keyframe** + **freeze-rámpa**.
  *(Megjegyzés: a per-frame sebesség ffmpeg-oldalon is korlátos — a görbe-szerkesztő gesztus
  mindenképp eszköz-oldali.)*
- [ ] 📱 **Tartalom-tudatos skálázás / szabad-warp rács** — rács-csomópont húzás (gesztus).
- [ ] 🎨 **Creative Canvas a timeline-ba** (§2.11) — a kész kép-szerkesztő (réteg/maszk/retus)
  mint vágható klip-asset; a kép-oldal Skia-festése miatt eszköz-oldali (lásd a Kép-szekciót).
- [ ] 🔌 **GIF-dekód + import** (§2.8) — a `gifTiming` mag kész; a dekód/import + Chromium→GIF
  kimenet hátra (futás-/eszköz-oldali verifikáció).

---

## 🖼️ Kép — eszköz-oldali kimaradások

> Forrás: [imgedd.md](./imgedd.md) §1–§8. A kompozíció, a kijelölés-alapú korrekció, a
> görbék/levels/grade/LUT/csatorna-mixer/gradient-map, a perspektíva és a vonalzó/guide/snap
> **render-bizonyított**. Ami marad, az a **Skia offscreen festés** és a **gesztus-érzet**:

- [ ] 🎨 **Festhető raszter-maszk** per réteg (+ invertálás/törlés) és **festett (szabad-alakú)
  folt-maszk**. Valós idejű ecset-stroke → Skia offscreen GPU-festés, nem render-mérhető.
- [ ] 🎨 **Klón-bélyegző** (forrás→cél másolás) · **blur/sharpen-ecset** — Skia brush-engine,
  eszköz-oldali festés.
- [ ] 🔌 **Él-felismerő / „objektum" kijelölés (AI-select)** — a videóban a `selective` létezik,
  a képre hozni; env-gated worker/AI-infra kell.
- [ ] 📱 **Toll v5** (finom node-húzás / handle-arány) · **OpenType-funkciók** (ligatúrák/
  alternatívák). A node-modell kész; a finom-húzás gesztus eszközön verifikálandó.
- [ ] 📱 **Skewer / szabad-warp rács** · **tartalom-tudatos skálázás** — rács-húzás (gesztus).
- [ ] 📱 **Billentyű/gesztus-paritás** · **akadálymentesség** (a11y) · **tablet/iPad dokkolt panelek**.
- [ ] 🧪 **Vászon-zoom/pan + smart-guides ÉRZET** — a mag kész és audit-zöld (canvasZoom pure teszt),
  de a **gesztus-érzet eszközön verifikálandó** (zoom>1 overlay/hit-test, pan-határ — nem render-mérhető).
- [ ] 🔌 **PSD import/export · PSD/AI-worker-interop · nagy-doc perf** — külön worker/infra +
  eszközön mérendő teljesítmény.

---

## 🎧 Audio — eszköz-oldali kimaradások

> Forrás: [AUDIOT.md](./AUDIOT.md) §1–§8. A mixer (fader/duck), a teljes per-klip FX-lánc, a
> volume/pan-automáció, a szintetizátor/dob-gép/sampler, a pitch/harmónia, a master-lánc és az
> Analyze **worker-bizonyított** (volumedetect/bandpass dB-mérés). Ami marad, az **élő audio-motor,
> felvétel és infra**:

- [ ] 🎙️ **Felvétel-út** — **mikrofon-rögzítés**, **count-in**, **rec-arm** sávonként.
  Hardver-bemenet → csak eszközön/dev-buildben.
- [ ] 🎚️ **Valós idejű metering** (sávonkénti + master, lejátszás alatt) + **referencia-A/B**
  + **dither**. Ma offline Analyze; az **élő meter** lejátszás-oldali.
- [ ] 🎚️ **Preview↔export DSP-parity** — a per-klip FX + master ÉLŐBEN hallható legyen, ne csak
  renderben. Élő audio-gráf (Web Audio / natív) eszközön.
- [ ] 📱 **Közvetlen klip-manipuláció** — húzás/mozgatás, szél-trim, **crossfade-fogó** két klip
  között, húzható **klip-gain boríték**. Gesztus-oldali.
- [ ] 📱 **scrub** (húzható playhead) · **metronóm-hang** (ma vizuális rács) · **fit-zoom** ·
  **billentyű/gesztus** (space=play, I/O=in/out, S=split, húzás-kijelölés, pinch-zoom).
- [ ] 🔌 **Stem-szeparáció** teljes UI — a `stems.ts` mag + klip-lap „split" kész; a worker
  **Demucs**-ot igényel (külön image/infra). → [AUDIOT.md](./AUDIOT.md) §7.
- [ ] 🔌 **AI-segéd a hangra** — dúdolás→dallam, „készíts dobsávot ehhez", zajszűrés/leválasztás.
  Env-gated AI-infra.
- [ ] 📱 **Panel-gazdagság** a videóéhoz hasonlóan (dokkolt/behúzható eszköz-panelek) +
  **projekt-sablonok** (podcast/zene/hangoskönyv). UX-paritás, eszköz-oldali elrendezés.

---

## 📋 Kivonat — mi kell a dev-build-teszthez

| Képesség | Videó | Kép | Audio |
|---|:--:|:--:|:--:|
| Natív enkóder (Android MediaCodec / iOS AVFoundation) | 🔌 #1 | — | — |
| Skia offscreen GPU-festés (ecset/maszk/klón) | (Canvas) | 🎨 | — |
| Érintő-gesztusok (húzás/trim/warp/színkerék/pinch) | 📱 | 📱 | 📱 |
| Élő metering/scope UI (valós-idejű) | 🎚️ | — | 🎚️ |
| Mikrofon-felvétel (count-in/rec-arm) | — | — | 🎙️ |
| Élő DSP-parity (preview = export) | — | — | 🎚️ |
| Külön infra (Demucs / env-gated AI / PSD) | 🔌 GIF | 🔌 AI-select, PSD | 🔌 Demucs, AI |
| „Érzet" eszközön verifikálandó (mag kész) | 🧪 | 🧪 zoom/pan | 🧪 |

> **Következő lépés eszközön:** egy **Android dev-build** (lásd a memóriát: EAS cloud dev
> build működik) + a fenti listák sorrendben. Minden tételnél a *mag/worker* már kész —
> a hiány a **felület + eszköz-futás**, ezért dev-buildben kézi QA-val igazolható, nem
> headless render-méréssel.
