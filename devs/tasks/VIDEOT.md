# 🎬 VIDEOT — a videó-szerkesztő hiány-pótlása (mint AUDIOT / imgedd)

> **Testvér-fájlok:** [AUDIOT.md](./AUDIOT.md) (hang), [imgedd.md](./imgedd.md) (kép), [06-video-editor.md](./06-video-editor.md) (régi NLE-backlog).
> **Vezérelv (a kép/hang-sweep bevált módszere):** minden módosítás a **command-buson** (undo); minden
> feature **ÉLŐ worker-render-rel pixel-bizonyítva** (`/render`/`/imagedoc` + ffmpeg-mérés) VAGY pure/store-teszttel;
> külön feature-branch → audit-zöld → `--ff-only` main. Device/gesztus-funkció eszközön verifikálandó (jelölve).

A videó-szerkesztő **már erős** (multi-track, keyframe+bezier, curves/HSL/3-way/LUT, 17 átmenet, effekt-lánc,
animált maszk+rotoszkóp, chroma-key, mélység/3D, profi audio-lánc+master, kinetikus tipográfia, proxy-motor).
Ez a fájl a **profi-paritás + parity-hézagok + nyitott adósságok** pótlása — NEM „el van romolva", hanem
„a kép/hang-sweep színvonalára emeljük".

---

## 🧭 HALADÁS — hol tartunk

| § | Terület | Állapot |
|---|---------|---------|
| §1 | **Szín-paritás a képpel** (levels · csatorna-mixer · gradient-map/duotone · struktúra-szűrők a video-klipre) | ⬜ |
| §2 | **Új effektek** (irányított/motion blur · kromatikus aberráció · fényszivárgás · deflicker · tükrözés-warp) | ⬜ |
| §3 | **Idő & sebesség** (time-remap = sebesség-görbe · per-effekt amount-keyframe) | ⬜ |
| §4 | **Transzformáció** (anchor-pivot RENDER — §2.6 adósság · corner-pin/warp · tartalom-tudatos) | ⬜ |
| §5 | **Átmenetek** (egyedi bezier-easing · több átmenet · csoportos alkalmazás) | ⬜ |
| §6 | **Szín-eszközök UI** (3-way színkerék · split-toning · live scopes) | ⬜ |
| §7 | **Audio** (metering/scope · sidechain tetszőleges sávra · per-band solo) | ⬜ |
| §8 | **Render/perf** (render-output cache — §2.9 adósság · batch/szegmens-export) | ⬜ |
| §9 | **Nyitott adósságok** (GIF-dekód+render §2.8 · Creative Canvas a timeline-ba §2.11 · on-device natív render) | ⬜ |

---

## 0. 🔎 Rövid diagnózis

**Erős (bizonyíték a felderítésből):** 9 sáv-típusú timeline (trim/split/move/drag/ripple/roll/slide), keyframe
(scale/x/y/rotation/opacity/volume/pan + bezier), szín (curves+HSL+3-way balance+LUT+8 preset+10 szűrő),
effekt-lánc (7 effekt, sorrendfüggő), animált maszk+rotoszkóp+tracking, chroma-key+despill, mélység/3D/tilt,
profi audio (per-klip lánc + master loudnorm/multiband + auto-duck), kinetikus tipográfia + text-on-path +
karaoke, 17 átmenet, proxy-motor. A **render = igazság** (preview közelít) elv rögzítve.

**A fő hézagok (profi-paritás + a kép-sweep tanulságai):**
- A **kép-stúdióban** most épített szín-eszközök (levels, csatorna-mixer, gradient-map, struktúra-szűrők) a
  **video-klipre nincsenek** — a video `adjustChain` curves/HSL/balance-t tud, de a fentieket nem. Paritás-hézag.
- Nincs **motion/irányított blur**, **kromatikus aberráció**, **fényszivárgás**, **deflicker** — a trendi
  „filmes" effektek hiányoznak (a 7-elemű lánc csak alap).
- A **sebesség egyetlen szám** (`clip.speed`) — nincs **time-remap** (sebesség-görbe/rámpa).
- Az **effekt-amount nem keyframe-elhető** (csak scale/x/y/rot/opacity/volume/pan).
- **Anchor-pivot RENDER** (§2.6) — a preview tud pivotot, a render-rotate még a középre forog (adósság).
- **Render-output cache** (§2.9) — a `renders/` nem takarítódik (külön a proxy/thumbnail-cache-től).
- **GIF-dekód+render** (§2.8) — a timing-mag kész, a dekód/import/kimenet hátra.

---

## 1. 🎨 Szín-paritás a képpel — ⬜ (render-bizonyítható, nagy érték)

A kép-sweepben épült szín-eszközöket a **video/image-klipre** (`render.js` `adjustChain`/megjelenés-lánc) is:
- [ ] ⬜ **Szintek (levels)** a klipre — a kép `levelsFilter` (lutrgb black/white/gamma) a video-adjustba.
- [ ] ⬜ **Csatorna-mixer** a klipre — a kép `channelMixFilter` (colorchannelmixer 3×3) a video-adjustba.
- [ ] ⬜ **Gradient-map / egyedi duotone** a klipre — a kép `gradientMapFilter` (geq luma→szín) effektként.
- [ ] ⬜ **Struktúra-szűrők paritás** (clarity/dehaze/pixelate/poszter) — a kép `imageFilters` a video effekt-láncba.
*(Mind render-bizonyítható `/render`-rel vagy a klip-adjust-lánc ffmpeg-mérésével, a kép-sweep mintájára.)*

## 2. ✨ Új effektek — ⬜ (render-bizonyítható)

- [ ] ⬜ **Irányított / motion blur** (ffmpeg — N eltolt másolat átlagolása vagy `tblend`/`minterpolate` mozgás-becslés).
- [ ] ⬜ **Kromatikus aberráció** (RGB-csatorna-eltolás `rgbashift`) — trendi „üveg/retró" look; render-bizonyítható (R/B szél-eltolás).
- [ ] ⬜ **Fényszivárgás (light leak)** — screen/add blend-overlay animált gradienssel; render-bizonyítható.
- [ ] ⬜ **Deflicker** (`deflicker` filter) — villódzás-simítás; render-bizonyítható (idősor-luma szórás csökken).
- [ ] ⬜ **Halftone / szkennvonal / CRT** artisztikus szűrők · **per-effekt blend-mód**.

## 3. ⏱️ Idő & sebesség — ⬜

- [ ] ⬜ **Time-remap (sebesség-görbe)** — `clip.speedRamp?: Keyframe[]` (per-frame sebesség) → a render `setpts`
  idő-integrállal; sebesség-rámpa (lassítás→gyorsítás). A legnagyobb „profi" idő-hézag.
- [ ] ⬜ **Per-effekt amount-keyframe** — a `VideoEffect.amount` keyframe-elhető (az effekt erőssége idővel változik).
- [ ] ⬜ **Freeze-rámpa** (speed-ramp-pal kombinált fagyasztás).

## 4. 📐 Transzformáció — ⬜ (§2.6 adósság)

- [ ] ⬜ **Anchor-pivot RENDER** — a render-`rotate` a `clip.anchor` pont körül forogjon (ma a középre); a preview már tudja. *(06-video §2.6 adósság — render-bizonyítható: ismert pivot → ismert elmozdulás.)*
- [ ] ⬜ **Corner-pin / perspektíva-warp** (4-sarok) — a kép `perspective`-mintájára a video-klipre.
- [ ] ⬜ **Tartalom-tudatos skálázás** / szabad-warp rács.

## 5. 🔀 Átmenetek — ⬜

- [ ] ⬜ **Egyedi bezier-easing** az átmeneten (ma 4 preset) — a keyframe bezier-magot újrahasználva.
- [ ] ⬜ **Csoportos átmenet** (egy típus több vágásra egyszerre) · **átmenet-könyvtár / mentett**.
- [ ] ⬜ **További átmenetek** (glitch, luma-wipe tetszőleges maszkkal, morph).

## 6. 🎚️ Szín-eszközök UI — ⬜ (a grading már megvan, csak a felület)

- [ ] ⬜ **3-way color wheels** (árnyék/középtónus/csúcsfény színkerék → a meglévő balance-mezőkre).
- [ ] ⬜ **Split-toning** (árnyék-szín + csúcsfény-szín külön; ma RGB-offset).
- [ ] ⬜ **Élő scopes** (histogram/waveform/vectorscope valós-idejű a preview-ból, ma csak közelítés).

## 7. 🔊 Audio — ⬜ (a lánc+master már profi)

- [ ] ⬜ **Metering/scope** (peak/RMS/LUFS-mérő a mixerben).
- [ ] ⬜ **Sidechain tetszőleges sávra** (ma `autoDuck` hardcode-olt) — a duck-forrás választható.
- [ ] ⬜ **Per-band solo/mute** a multiband-kompresszorban · **sáv-almix/csoport**.

## 8. ⚙️ Render / perf — ⬜

- [ ] ⬜ **Render-output cache-politika** (§2.9 maradék) — a `renders/` LRU-takarítása (a `planCacheEviction` újrahasznosítva).
- [ ] ⬜ **Batch / szegmens-export** (több felbontás/formátum egy jobban · jelenet-enkénti kliplista).

## 9. 🔌 Nyitott adósságok — ⬜

- [ ] ⬜ **GIF-dekód + render** (§2.8) — a `gifTiming` mag kész; a dekód/import + Chromium→GIF kimenet hátra.
- [ ] ⬜ **Creative Canvas a timeline-ba** (§2.11) — a kész kép-szerkesztő (réteg/maszk/retus) mint vágható klip-asset.
- [ ] ⬜ **On-device natív render** (iOS AVFoundation kész v1; Android MediaCodec a #1 hiány — [09-native](./09-native-rendering.md)). *(Eszközön verifikálandó.)*

---

## 🎯 Javasolt sorrend (max érték / render-bizonyítható ELŐSZÖR)

1. **§1 Szín-paritás** (levels/csatorna-mixer/gradient-map a video-klipre) — a kész kép-magokat újrahasználja, azonnal render-bizonyítható.
2. **§2 Új effektek** (kromatikus aberráció · fényszivárgás · deflicker · motion blur) — ffmpeg, render-bizonyítható.
3. **§4 Anchor-pivot render** (§2.6 adósság zárása) — pontosan mérhető.
4. **§3 Per-effekt amount-keyframe**, majd **time-remap**.
5. **§5/§6/§7** UI-nehezebb finomítások · **§8/§9** adósságok (a GIF + output-cache tesztelhető; az on-device + Canvas nagyobb, eszközös menet).
