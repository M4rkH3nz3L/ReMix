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
| §1 | **Szín-paritás a képpel** (levels · csatorna-mixer · gradient-map · struktúra-szűrők a klipre) | ✅ |
| §2 | **Új effektek** (**kromatikus aberráció** · **fényszivárgás** kész + **default-út effekt-bug javítva**; motion blur/deflicker ⬜) | ✅ |
| §3 | **Idő & sebesség** (time-remap = sebesség-görbe · per-effekt amount-keyframe) | ⬜ |
| §4 | **Transzformáció** (**anchor-pivot RENDER** + **corner-pin/perspektíva** kész; tartalom-tudatos ⬜) | ✅ |
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

A kép-sweepben épült szín-eszközöket a **video/image-klipre** (`render.js` `adjustChain`) is bekötve:
- [x] ✅ **Szintek (levels)** a klipre — `ClipAdjust.levels {black,white,gamma}` → `adjustChain` a kép
  `levelsFilter`-ét fűzi (lutrgb); grade-rétegen `enable`-ablakkal. *ÉLŐ VIDEO-RENDER (renderProject, 480² kék
  klip): kontroll 779fc6 → b0/w0.5 = f2ffff (fehér-pont nyújtás).*
- [x] ✅ **Csatorna-mixer** a klipre — `ClipAdjust.channelMix` (3×3) → `channelMixFilter` (colorchannelmixer);
  grade-rétegen enable-lel. *ÉLŐ VIDEO-RENDER: R↔B csere → 779fc6 → c79f79 (R és B felcserélve).*
- [x] ✅ **Gradient-map / egyedi duotone** a klipre — `ClipAdjust.gradientMap {shadow,highlight}` →
  `gradientMapFilter` (geq luma→szín, enable-tudatos a geq-en). *ÉLŐ VIDEO-RENDER: kék→arany → 979733
  (≈153/153/51).* UI: AdjustPanel — Szintek + Csatorna-mixer (9 stepper) + Gradient-map (duotone presetek).
  Contract-teszt: `render.test.js` (adjustChain kibocsátja + grade-rétegen enable + identitás-üres).
- [x] ✅ **Struktúra-szűrők paritás** (clarity/dehaze/pixelate/posterize) — a kép `imageFilters.oneFilter` AZONOS
  stringjei új `VideoEffect` típusként a video effekt-láncba (kliens↔worker contract-tesztelt + i18n hu/en/de).
  *ÉLŐ VIDEO-RENDER (renderProject, kék klip): posterize (step 128) → 018080 (diszkrét szintek); dehaze → 74afe2
  (kontraszt+telítettség↑ a 779fc6-ról).*

## 2. ✨ Új effektek — ⬜ (render-bizonyítható)

- [x] ✅ **Kromatikus aberráció** (`rgbashift` R jobbra / B balra) — új `VideoEffect` típus (kliens↔worker
  AZONOS string, contract-tesztelt). *ÉLŐ VIDEO-RENDER (renderProject, él-klip): fringe x=244 ff0304 (piros),
  x=236 fbff06 (sárga) — R/B szétvált az élnél.*
- [x] ✅ **Fényszivárgás (light leak)** — új `VideoEffect` (meleg gauss-glow a jobb-felső sarokból, `geq`;
  kliens↔worker azonos). *ÉLŐ VIDEO-RENDER (kék klip): jobb-felső ffffc7 (meleg), bal-alsó 799fc6 (változatlan).*
- [x] 🐛 **Default-út effekt-bug JAVÍTVA** — a sima video+kép render-út (se kf/transform/maszk) KIHAGYTA az
  `effectChainFx`-et → eddig a 7 meglévő effekt (blur/grain/…) SEM hatott az egyszerű klipeken. Pótolva mindkét
  default-ágon (render.js). + i18n (lib.effects, 9 címke, hu/en/de).
- [x] ✅ **Motion blur (`tmix`) + deflicker** — két új `VideoEffect` típus (kliens↔worker azonos, contract-tesztelt):
  motionBlur = temporális kocka-átlag (2–8 kocka), deflicker = luma-villódzás-simítás (2–10 kocka). *ÉLŐ
  VIDEO-RENDER (renderProject): deflicker villódzás-szórás 83→27 (~3× csökkenés); motion blur a fekete→fehér
  vágásnál közbenső rámpa 96→112→146 (elmosás). +i18n (hu/en/de).*
- [x] ✅ **Szkennvonal (CRT) + halftone** artisztikus szűrők — két új `VideoEffect` (geq; kliens↔worker azonos,
  contract-tesztelt + i18n). *ÉLŐ VIDEO-RENDER (renderProject): szkennvonal páros sor 144 / páratlan 51
  (váltakozó); halftone egy 9px csempén min 9 / max 255 (pont-raszter).*
- [ ] ⬜ **Per-effekt blend-mód** · további artisztikus szűrők.

## 3. ⏱️ Idő & sebesség — ⬜

- [ ] ⬜ **Time-remap (sebesség-görbe)** — `clip.speedRamp?: Keyframe[]` (per-frame sebesség) → a render `setpts`
  idő-integrállal; sebesség-rámpa (lassítás→gyorsítás). A legnagyobb „profi" idő-hézag.
- [ ] ⬜ **Per-effekt amount-keyframe** — a `VideoEffect.amount` keyframe-elhető (az effekt erőssége idővel változik).
- [ ] ⬜ **Freeze-rámpa** (speed-ramp-pal kombinált fagyasztás).

## 4. 📐 Transzformáció — ⬜ (§2.6 adósság)

- [x] ✅ **Anchor-pivot RENDER** (§2.6 adósság zárva) — a `withTransform` overlay-eltolással
  (`delta = (I − Rθ)·d`, `d = (anchor − 0.5)·box`) pivot-forgatássá alakítja az ffmpeg közép-forgatását;
  csak STATIKUS forgatás + EGYEDI anchorra (kf-forgatás/közép = bitre változatlan). *ÉLŐ VIDEO-RENDER
  (renderProject, fehér pont a box 0.25,0.25-nél, rot90): kontroll (120,120)=fe; KÖZÉP-anchor=00 (pont
  elmozdul); PIVOT-anchor (0.25,0.25)=ff (pont HELYBEN marad).*
- [x] ✅ **Corner-pin / perspektíva-warp** — `CanvasTransform.perspectiveX/Y` (−1…1); a render a Kép Stúdió
  `perspectiveFilter`-ét alkalmazza a klip-frame-re (átlátszó OOB → a mögötti réteg látszik), a `withTransform`
  overlay-úton (hasPersp → hasTransform); a preview 3D rotateX/Y-nal közelít; PrecisionPanel „Perspektíva ↔/↕"
  Stepperek. *ÉLŐ VIDEO-RENDER (renderProject, kék klip, X=1): közép 799fc6 (kék marad); jobb-felső 000000
  (a jobb él hátradőlt → átlátszó → fekete base).*
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
