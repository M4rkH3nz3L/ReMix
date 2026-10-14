# 🖼️ IMGEDD — a Kép Stúdió profi-érettsége (hiányosságok + terv)

> **Mi ez:** őszinte állapot-felmérés + hiány-lista, hogy a Kép Stúdió olyan **funkció-dús** legyen, mint egy
> profi raszter/vektor-szerkesztő (Photoshop/Figma szint). Az [AUDIOT.md](./AUDIOT.md) párja a képre.
> Párok: [IMAGE-STUDIO-PROD.md](./IMAGE-STUDIO-PROD.md) · [MISSS-IIING.md](./MISSS-IIING.md) · [00-README.md](./00-README.md).
>
> **Tag:** ✅ kész · 🟡 **mag KÉSZ+tesztelt, csak UI-/render-bekötés hiányzik** · 🔌 worker/infra · 📱 device · ⬜ nulláról.

---

## 🧭 HALADÁS — hol tartunk

| § | Terület | Állapot |
|---|---------|---------|
| §1 | **Rétegek & kompozíció** (fill/photo/shape/text, panel, opacity/hidden, **blend-mode**, **gradient-maszk**) | ✅ *(group/festett-maszk ⬜)* |
| §2 | **Kijelölés & maszkolás** (lasszó + varázspálca + ecset) | 🟡 *(szelekció→réteg-maszk ⬜)* |
| §3 | **Retusálás** (klón/gyógyító/dodge-burn/blur-ecset) | ⬜ |
| §4 | **Vektor & szöveg** (toll/node + boolean + SVG import/export + szöveg-stílus) | ✅ *(toll v5, text-on-path ⬜)* |
| §5 | **Korrekciók & szűrők** (adjustment-stack + forma-fx + **struktúra-szűrők**) | ✅ *(RAW-develop 🟡, artistic ⬜)* |
| §6 | **Transzformáció** (mozgat/skála/forgat/tükröz/crop + vonalzó/guide/snap) | ✅ *(szabad-transzform/perspektíva/warp ⬜)* |
| §7 | **Export & megosztás** (PNG/JPG/WebP/SVG/PDF + galéria/diavetítés/carousel) | ✅ *(PSD import/export ⬜)* |
| §8 | **UX-paritás** (vászon-zoom/pan, smart-guides, history-panel) | 🟡 |

---

## 0. 🔎 Rövid diagnózis

**Erős alap:** réteg-fás, NEM-destruktív szerkesztő (fill/photo/shape/text) réteg-panellal (sorrend/rejtés/opacity/
átnevezés/duplázás); **vektor-toll** (bezier node-szerkesztés) + **boolean** (union/subtract/intersect/exclude/
**divide**) + **SVG import/export** + **PDF-export**; **adjustment-stack** (expozíció/kontraszt/fehéregyensúly/
tónus/telítettség/élénkség/vignetta); **forma-fx** (glow/árnyék/kontúr); **minta-kitöltés**; **lasszó/varázspálca/
ecset/crop**; **vonalzók+segédvonalak+snap**; **többlapos galéria** → diavetítés/lapozható megosztás. A render a
worker-Chromium (`/imagedoc`), ami a formát/szöveget/mintát pontosan égeti.

**A fő hiányok (profi-paritás):**
- **Réteg-szintű keverési mód (blend-mode)** — csak a forma/szöveg-klipnek van; a **fill/photo rétegnek NINCS**, és a
  render (`/imagedoc`) nem komponál `mix-blend-mode`-dal → nincs multiply/screen/overlay a rétegek közt.
- **Réteg-maszkok** — általános raszter/vektor-maszk per réteg (festhető maszk) hiányzik (csak a PhotoLayernek van `mask`).
- **Csoport-rétegek (mappák)** — nincs `group` réteg-fajta.
- **Nem-destruktív korrekció-RÉTEG** — a korrekció ma per-foto, nem az alatta lévő rétegekre ható adjustment-layer.
- **Retus-eszközök** — klón-bélyegző, gyógyító-ecset, dodge/burn, blur/sharpen-ecset: egyik sincs.
- **Bekötetlen magok** (kész, tesztelt, de 0 UI-bekötés): `photoDevelop.ts` (RAW-develop: clarity/texture/dehaze),
  `layerEffects.ts` (réteg-effekt a formán túl is), `patternFill.ts`, `magicWand.ts` (a wand a client-magon megy).

---

## 1. 🧱 Rétegek & kompozíció — ✅ alap kész, pro-kompozíció hiányzik
- [x] ✅ fill/photo/shape/text réteg + **réteg-panel** (sorrend/rejtés/opacity/átnevezés/duplázás/törlés).
- [x] ✅ **Réteg-blend-mode** (multiply/screen/overlay/darken/lighten/softlight/hardlight/difference/exclusion/
  colordodge/colorburn) **MINDEN rétegre** (fill/photo/shape/text) — `ImageLayerBase.blendMode` + a `/imagedoc`
  ffmpeg `blend`-del, a réteg alfájával `maskedmerge`-elve komponál; a LayerInspector-választó a közös szekcióba
  került (eddig csak formán volt, és a render FIGYELMEN KÍVÜL hagyta). *ÉLŐ-BIZONYÍTVA: 808080×808080 multiply →
  454545 (sötétít), 404040×404040 screen → 6c6c6c (világosít), színhelyes szürke (worker-pixelmérés).*
- [x] ✅ **Gradient-maszk** per réteg (lineáris elhalványulás: left/right/up/down) — `ImageLayerBase.maskGradient`
  + a render geq alfa-rámpával (minden réteg-fajtára); LayerInspector-választó. *ÉLŐ-BIZONYÍTVA: piros foto fehér
  fill fölött, 'right' maszk → bal piros (ff0e0e), jobb a fehér base (fcf6f6), közép rózsaszín (worker-pixelmérés).*
- [ ] ⬜ **Festhető raszter-maszk** + **vektor/szelekció-maszk** per réteg + invertálás/törlés.
- [ ] ⬜ **Csoport-rétegek (mappák)** — `group` réteg-fajta + beágyazott transzform/opacity.
- [ ] ⬜ **Nem-destruktív korrekció-réteg** (az alatta lévőkre hat) — ma csak per-foto adjustment-stack.
- [ ] 🟡 **Réteg-effektek a formán túl** (árnyék/glow/kontúr fotóra/szövegre is) — a `layerEffects.ts` mag kész, 0 UI.

## 2. 🎯 Kijelölés & maszkolás — 🟡 kijelölés van, maszk-bekötés hiányzik
- [x] ✅ **Lasszó** + **varázspálca** (magicWandClient) + **ecset** — a kijelölés/festés él.
- [ ] ⬜ **Szelekció → réteg-maszk** (a kijelölésből maszk a rétegre) · **maszk-finomítás** (lágyítás/terjesztés).
- [ ] ⬜ **Kijelölés-alapú korrekció** (csak a kijelölt területre hasson az adjust/filter).
- [ ] ⬜ **Él-felismerő/„objektum" kijelölés** (AI-select — a videóban a `selective` létezik, a képre hozni).

## 3. 🩹 Retusálás — ⬜ hiányzik (device/worker)
- [ ] ⬜ **Klón-bélyegző** + **gyógyító-ecset** (spot-heal) — folt/tárgy-eltávolítás.
- [ ] ⬜ **Dodge/Burn** (világosítás/sötétítés ecset) · **blur/sharpen-ecset** · **folt-elmosás**.
- [ ] 🔌 **AI-objektum-eltávolítás / inpaint** (a videó-oldali gen-média mintájára, külön worker-modell).

## 4. 🖊️ Vektor & szöveg — ✅ erős
- [x] ✅ **Vektor-toll** (bezier node: hozzáad/split/join/reverse/node-típus) + **boolean** (divide-dal) + **SVG import/export**.
- [x] ✅ **Szöveg-stílus** (gradient/kontúr/árnyék/glow — a renderben pontos) + **igazítás/elosztás**.
- [ ] ⬜ **Szöveg görbén (text-on-path)** · **OpenType-funkciók** (ligatúrák/alternatívák) · **toll v5** (finom node-húzás/handle-arány).
- [ ] ⬜ **Vektor-kitöltés gradiens/minta** a path-okon (ma szín/alap-gradient).

## 5. 🎨 Korrekciók & szűrők — ✅ adjustment-stack kész, mélység hiányzik
- [x] ✅ **Adjustment-stack** (expozíció/kontraszt/fehéregyensúly/tónus: highlights/shadows/whites/blacks/telítettség/
  élénkség/vignetta) — a `adjustmentStack.ts` + worker-render (bizonyított render-parity).
- [x] ✅ **RAW-develop (clarity + dehaze)** — a foto-szűrők közt (lokális ill. globális kontraszt): worker
  `imageFilters.js` (clarity=nagy-sugarú unsharp, dehaze=eq contrast+saturation). *ÉLŐ-BIZONYÍTVA: dehaze a
  kimosott tartományt tágítja (100..219→81..223); clarity a lokális kontrasztot (89..176→31..252; worker-mérés).*
- [ ] 🟡 **RAW-develop teljes** — a `photoDevelop.ts` maradék detail-paraméterei (texture/sharpness/CA/zaj + görbe/csoportok).
- [x] ✅ **Struktúra-szűrők** a foto-rétegen (blur/sharpen/zaj/szürke/szépia) — `PhotoLayer.filters` + worker
  `imageFilters.js` (ffmpeg gblur/unsharp/noise/hue/sepia-mixer, a korrekció UTÁN); LayerInspector chip+csúszka.
  Pure magok: `imageFilters.ts` (kliens, 4 teszt) + `server/imageFilters.js` (4 teszt). *ÉLŐ-BIZONYÍTVA: grayscale
  piros→szürke (R=G=B 4c4c4c); blur a fekete tartományt az él közelében világosítja (000000→343434; worker-pixelmérés).*
- [x] ✅ **Artistic szűrők** (pixelate + poszterizálás) — `pixelize` ill. `lutrgb` lépcsőzés a szűrő-láncon.
  *ÉLŐ-BIZONYÍTVA: pixelate blokk-egyenlőség (867b7a=867b7a); poszterizálás 220→32 distinct szint (worker-mérés).*
- [x] ✅ **Duotone** (kétszínű leképezés: árnyék→indigo, csúcsfény→pink; amount-blenddel) — `hue=s=0`+`lutrgb`.
  *ÉLŐ-BIZONYÍTVA: csúcsfény → pink (fe8eab), árnyék → indigo-irány (worker-pixelmérés).*
- [ ] ⬜ **motion blur** · egyedi-színű duotone/gradient-map · további szűrők.
- [ ] ⬜ **Görbe/szintek (curves/levels)** + **csatorna-mixer** + **szelektív szín**.
- [ ] ⬜ **LUT/filmszimuláció** a fotóra (a videó-oldalon `lutImport` van — a képre hozni).

## 6. 📐 Transzformáció — ✅ alap kész
- [x] ✅ mozgatás/skálázás/forgatás/tükrözés + **crop** + **vonalzók/segédvonalak/snap** (rulers).
- [ ] ⬜ **Szabad transzform** (nem-arányos nyújtás/skewer) · **perspektíva/warp/torzítás** · **tartalom-tudatos skálázás**.
- [ ] ⬜ **Igazítás okos-segédvonalakkal** (dinamikus, a többi réteghez viszonyítva).

## 7. 📤 Export & megosztás — ✅ gazdag
- [x] ✅ **Raszter** (PNG/JPG/WebP + 1×/2× + minőség) · **SVG** · **PDF** · **beszúrás videóba**.
- [x] ✅ **Többlapos galéria** → **diavetítés-videó** / **lapozható carousel** megosztás a feedbe.
- [ ] 🔌 **PSD import/export** (réteg-megőrzéssel) · **batch-export** · **export-presetek** (platform-méretek).

## 8. 🧭 UX-paritás a profi szerkesztőkkel — 🟡
- [ ] 🟡 **Vászon-zoom/pan** (pinch + két-ujj pan) + **fit/100%** — ma korlátos (az audio-transport kapott zoomot, a kép nem).
- [ ] ⬜ **History-panel** (vizuális undo-lépések; a command-bus már undo-zható) · **snapshot/verziók**.
- [ ] ⬜ **Billentyű/gesztus-paritás** · **akadálymentesség** · tablet/iPad dokkolt panelek.

---

## 🎯 Javasolt sorrend (max hatás / min munka — a kész magokat feltárni ELŐSZÖR)

1. **🟡 Bekötetlen magok feltárása** — **RAW-develop UI** (`photoDevelop.ts`) + **réteg-effekt fotóra/szövegre**
   (`layerEffects.ts`): kész+tesztelt magok, csak UI/render-bekötés. Render-bizonyítható (pixel/hisztogram-mérés).
2. **⬜ Réteg-blend-mode** (fill/photo) a modellbe + `/imagedoc` `mix-blend-mode` kompozíció — a legnagyobb pro-kompozíciós
   nyereség, **render-bizonyítható** (multiply/screen → a kimeneti pixel determinisztikus).
3. **⬜ Szűrők** (blur/sharpen/zaj/artistic) a fotóra — render-bizonyítható (frekvencia-/kontraszt-mérés).
4. **⬜ Réteg-maszk** (szelekció→maszk, festhető) + **kijelölés-alapú korrekció**.
5. **⬜ Csoport-rétegek** + **nem-destruktív korrekció-réteg** + **retus** (klón/heal) + **szabad-transzform/warp**.
6. **🔌 PSD-interop** + **AI inpaint** + **🧭 UX** (vászon-zoom/pan, history-panel, okos-guide).

> **Olvasat:** a réteg-/vektor-/adjustment-alap + az export ERŐS és bizonyított — a valódi hátralék a **pro-kompozíció**
> (blend-mode, maszk, group, korrekció-réteg), a **retus**, a **szűrők**, és néhány **bekötetlen mag** feltárása.
> A render-oldalt érintő tételeket (blend/szűrő/RAW) a workeren MÉRÉSSEL lehet bizonyítani — ahogy az audiónál tettük.
