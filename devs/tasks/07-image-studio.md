# 🎨 07. Image Studio — P1 (pure core erős, UI-bekötés hiányos)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §7, §14. · **Testvér:** [06-video-editor](./06-video-editor.md) (render-parity), [09-native](./09-native-rendering.md) (worker).
> **Érintett kód:** [src/lib/vectorPath.ts](../../src/lib/vectorPath.ts) · [src/lib/adjustmentStack.ts](../../src/lib/adjustmentStack.ts) · [src/lib/layerEffects.ts](../../src/lib/layerEffects.ts) · [src/lib/patternFill.ts](../../src/lib/patternFill.ts) · [src/lib/rulers.ts](../../src/lib/rulers.ts) · [src/lib/layout.ts](../../src/lib/layout.ts) · [src/lib/svgImport.ts](../../src/lib/svgImport.ts) · [src/app/studio/image/[id].tsx](../../src/app/studio/image/).

---

> **📊 Haladás (2026-10-07):** 🟡 9 mag kész (pure-core KÉSZ + tesztelt, **UI hátra**) · ✅ 0 teljes · ⬜ 0 — Σ 9 tétel.
> **ÚJ (2026-10-07):** profi „Új dokumentum" + vászon-kezelés landolt — szabad **W×H (px)** + presetek +
> **Pixel/SVG** típus + **háttér** (a létrehozásnál ÉS a [CanvasSheet](../../src/components/studio/image/CanvasSheet.tsx)-ben), valamint a **projekt forrás-mappa** ([08](./08-storage.md) §2.8) a kép-editorban (kép→fotó-réteg). **Hátra marad** a 9 profi mag
> (pen / effects / adjustment-stack / rulers / pattern / boolean / align / PSD / PDF) dedikált UI-ja
> + a worker PSD/PDF-interop + az **SVG-export emitter** (a Vektor-típus ma raszterbe renderel).

## 📱 „Alap Photoshop, érintős felülettel" — roadmap-státusz (2026-10-10)
> User-cél: *„olyan legyen mint az alap photoshop csak érintős felülettel!"* — a meglévő tiszta magokat
> telefon-barát, valódi szerkesztő-élménnyé kötni, render-paritással. Haladás (sorban):

| # | Képesség | Állapot | Hol |
|---|----------|---------|-----|
| — | Csoportosított görgethető eszköztár + ShapePicker (5 forma) | ✅ KÉSZ · on-device | §2.0 · main `4041822` |
| 1 | **Valódi forgatás** minden rétegre (forma/szöveg is) — preview + worker | ✅ KÉSZ · on-device | §2.0b · `32da9c7` |
| 2 | **CROP / kivágás** (interaktív overlay + arány-presetek + render-biztos reframe) | ✅ KÉSZ · on-device | §2.0c · `c87ff6b` |
| 3 | **Tükrözés H/V** (flip — preview + worker) | ✅ KÉSZ · on-device | §2.0d · `775b24e` |
| 4 | Réteg-inspector felszínre hozva (kijelölésre nyíló „Stílus" lap) | ✅ KÉSZ · on-device | §2.0e |
| 5 | **Toll / vektor pen** (v1 tap-rajz → path-forma · v2 node-húzás) | ✅ KÉSZ · on-device | §2.1 (v3: bezier-handle hátra) |
| 6 | **Gradient-kitöltés** UI (multi-stop, preview-rendelt) | ✅ KÉSZ · on-device | §2.0f |
| 7 | Dedikált **Effektek (fx)** panel (árnyék/ragyogás/stroke) | 🚧 KÖVETKEZŐ | §2.2 |
| 8 | (stretch) ecset/raszter-festés + PSD/PDF interop | ⬜ HÁTRA | §2.5/2.8/2.9 |
>
> Megj.: a réteg-tulajdonságok (opacity/blend/stroke/árnyék/glow/text-stílusok) MA is élnek a
> [LayerPanel](../../src/components/studio/image/LayerPanel.tsx) inspectorában — csak felfedezhetőbbé kell tenni (#4).

## 0. Kontextus & cél
Itt a repo a legjellemzőbb: a **pure core már jelentős**, de a **felhasználói felület** sok
helyen nincs bekötve (`CORE KÉSZ / UI HIÁNYZIK`). Cél: a meglévő magokat profi szerkesztő-UI-vá
bekötni + a worker-interop (PSD/PDF) + render-parity.

## 1. Jelenlegi állapot (bizonyíték)
- Magok kész + teszteltek: vectorPath (bezier node-edit), adjustmentStack, layerEffects,
  patternFill, rulers/guides, layout (autoLayout/align/distribute), svgImport/export.
- A legtöbb **UI nincs rákötve**; PSD-import + PDF/PSD/AI-export hiányzik.

### 2.0 Telefon-optimalizált eszköztár + több tool — P1 ✅ KÉSZ (2026-10-10, user-feedback, on-device verifikálva)
A lapos 9-elemű sor helyett **csoportosított, vízszintesen görgethető** eszköztár ([ImageStudioBody](../../src/components/studio/image/ImageStudioBody.tsx)):
**ADD** (Photo/Text/Shape/SVG) · **ARRANGE** (Align/Boolean/Rotate/Forward/Back) · **STYLE** (Adjust) · **LAYER** (Layers/Duplicate/Delete) —
kategória-címkékkel + elválasztókkal, 60pt touch-célokkal. Felszínre hozva a kész magok: **réteg-sorrend** (`reorderLayer` előre/hátra),
**duplikálás** (`duplicateLayer`), **forgatás 90°** (rotation). ÚJ **[ShapePickerSheet](../../src/components/studio/image/ShapePickerSheet.tsx)**:
a Shape már **5 formát** ad (téglalap/ellipszis/vonal/nyíl/csillag), nem csak téglalapot. Mind élőben verifikálva az emulátoron.

### 2.0b Valódi FORGATÁS minden rétegre (preview + worker render-parity) — P1 ✅ KÉSZ (2026-10-10, on-device verifikálva)
A „Forgatás" eddig csak a `rotation`-t ÍRTA, de a forma/szöveg se az előnézetben, se a renderben nem forgott (néma no-op). Mostantól **valódi, végponttól-végpontig**
forgatás a fotó/forma/szöveg rétegeken (a háttér-fill nem forog): `ShapeClip`/`TextClip` kap közvetlen `rotation?` mezőt
([types](../../src/types/project.ts)); az előnézet a [ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx) wrap-transformjával + a
[TextOverlay](../../src/components/preview/TextOverlay.tsx) szöveg-blokk-transformjával forgat a KÖZÉPPONT körül; a
[SelectionFrame](../../src/components/studio/image/SelectionFrame.tsx) forgató-fogója (eddig csak fotó) minden nem-fill rétegre kinyílt (gesztus-forgatás);
a worker kép-doc kompozitora ([server/imagedoc.js](../../server/imagedoc.js)) a forma/szöveg PNG-t a bizonyított fotó-rotate mintával forgatja (render-parity).
On-device: a cián csillag + a pink téglalap a forgató-fogóval láthatóan elfordult.

### 2.0c CROP / kivágás (interaktív, render-biztos) — P1 ✅ KÉSZ (2026-10-10, on-device verifikálva)
A legtöbbet hiányolt „szerkeszd a képet" alapművelet. Tiszta mag [imageCrop.ts](../../src/lib/imageCrop.ts)
(`cropImageDoc`/`clampCropRect`/`aspectCropRect`/`moveCropRect`/`resizeCropCorner`, **14 teszt**): a kivágás egy
NORMALIZÁLT téglalap → új vászon-pixelméret + minden réteg újraleképezve (pozíció a kivágás-origóhoz, méret/betűméret/
vonalvastagság a kivágás arányával — az abszolút px-megjelenés marad; a kivágott régión kívüli tartalom a rétegen megmarad,
csak a vászon vágja). Render-biztos: a kép-doc render normalizált koordinátákban dolgozik. Interaktív
[CropOverlay](../../src/components/studio/image/CropOverlay.tsx) (PanResponder: test-mozgatás + 4 sarok, dim-maszk, harmadoló
rács) a vásznon ([ImageCanvas](../../src/components/studio/image/ImageCanvas.tsx)), + a toolbar HELYETT crop-sáv arány-presetekkel
(Szabad/1:1/4:5/16:9/9:16) + Mégse/Alkalmaz ([ImageStudioBody](../../src/components/studio/image/ImageStudioBody.tsx)).
On-device bizonyítva: 1080×1080 → (16:9) 1080×608 → (1:1) 608×608, a tartalom helyesen újraformálva; egy Alkalmaz = egy undo-lépés.

### 2.0d Tükrözés H/V (flip — preview + worker render-parity) — P1 ✅ KÉSZ (2026-10-10, on-device verifikálva)
Photoshop-alap: a réteg vízszintes/függőleges tükrözése. `flipH?/flipV?` mező a PhotoLayer / ShapeClip / TextClip típusokon
([types](../../src/types/project.ts)); az előnézet `scaleX(-1)`/`scaleY(-1)` transformmal a FORGATÁS ELŐTT (helyi tér) —
[ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx) / [TextOverlay](../../src/components/preview/TextOverlay.tsx) /
[PhotoLayerView](../../src/components/studio/image/PhotoLayerView.tsx) (utóbbinál a forgatás+tükrözés+drag EGY transformba vonva,
mert a külön `transform` felülírta volna a rotate-et); a worker a `hflip`/`vflip` filtert a rotate ELŐTT alkalmazza
([server/imagedoc.js](../../server/imagedoc.js)) → render-parity. Két tool az ARRANGE csoportban (Tükör ↔ / Tükör ↕), nem-fill rétegre.

### 2.0e Réteg-inspector felszínre hozva (kijelölésre nyíló „Stílus" lap) — P1 ✅ KÉSZ (2026-10-10, on-device verifikálva)
A gazdag réteg-tulajdonságok eddig CSAK a „Layers" lap alján, a réteg-fa után voltak elérhetők (felfedezhetetlen). Most a vezérlők
kiemelve a megosztott **[LayerInspector](../../src/components/studio/image/LayerInspector.tsx)** komponensbe (szöveg-stílus / fotó-illesztés+
forgatás / forma kitöltés+blend+kontúr+árnyék+glow / háttér-szín / minden rétegnél átlátszóság), amit a
[LayerPanel](../../src/components/studio/image/LayerPanel.tsx) ÉS az új **[LayerStyleSheet](../../src/components/studio/image/LayerStyleSheet.tsx)**
is használ. Új „Stílus" eszköz a STYLE csoportban → a kijelölt rétegről EGY koppintásra megnyílik a teljes inspector (fejléc = réteg neve).
On-device bizonyítva: a „Stílus" lap megnyílt a kijelölt formán (Fill/forma/blend/border/shadow/glow/opacity).

### 2.0f Gradiens-kitöltés UI (forma + háttér) — P1 ✅ KÉSZ (2026-10-10, on-device verifikálva)
A modell (`gradient: ShapeGradient` multi-stop lineáris/radiális/konikus) + a render MÁR kész volt
([ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx)/[FillLayerView](../../src/components/studio/image/FillLayerView.tsx)) —
csak a picker-UI hiányzott. ÚJ **[GradientEditor](../../src/components/studio/image/GradientEditor.tsx)** a [LayerInspector](../../src/components/studio/image/LayerInspector.tsx)-ben
(forma + háttér réteg): be/ki toggle (ki = vissza a tömör `fill`-hez), **6 gyors-preset** (valódi gradient-előnézettel),
típus (lineáris/radiális/konikus), **szög-csúszka**, és a **kezdő/záró stop színe**. A `gradient` felülírja a tömör `fill`-t.
On-device bizonyítva: a trapéz pink→fehér 135°-os átmenetre váltott; a preset (lila→pink) is renderelt.

## 2. Feladatlista

### 2.1 Vector pen UI — P1 🟡 (v1 KÉSZ + on-device verifikálva; bezier-handle/node-edit hátra)
- [x] ✅ **Toll v1 (2026-10-10):** új „Toll" eszköz az ADD csoportban → toll-mód: a vásznon koppintásra horgonypontok
  ([PenOverlay](../../src/components/studio/image/PenOverlay.tsx): élő polyline + node-pöttyök, az első node kiemelve),
  az ELSŐ pontra koppintva (vagy „Bezár") kitöltött path-forma, „Kész" nyitott vonal. A pontokból path-FORMA réteg a tiszta
  [penPath.ts](../../src/lib/penPath.ts) `pathShapeFromCanvasPoints` maggal (a `vectorPath.normalizeSubpaths` fölött: bbox→position/w/h
  + lokális 0–1 pontok), **3 teszt**; a `ShapeOverlay` path-renderje (render-paritás). Toll-sáv (Mégse/Visszavon/Bezár/Kész) a toolbar
  helyett. On-device bizonyítva: 3 pont → zárás az első node-on → kitöltött háromszög forma-rétegként (kijelölve).
- [x] ✅ **Toll v2 — node-húzás (2026-10-10):** a kijelölt path-formán a „Toll" eszköz NODE-szerkesztő módba vált
  ([PathEditOverlay](../../src/components/studio/image/PathEditOverlay.tsx)): a horgonypontok húzható pöttyök, húzás közben a path
  ÉLŐBEN átformálódik (a `moveAnchor` mag + a `live`-patch minta, mint a SelectionFrame-ben; `LivePatch.points` bővítés), a végén
  egy undo-lépés; node-sáv (Mégse/Kész). On-device bizonyítva: a háromszög alsó csúcsát elhúzva trapézzá formálódott.
- [x] ✅ **Toll v3 — bezier-görbék (2026-10-10):** node-módban a node KOPPINTÁSRA kijelölhető; a node-sáv „Görbe"/„Sarok"
  gombja `setNodeType`-pal bezier-fogókat hoz létre/töröl (az élek meggörbülnek); a kijelölt node-nál a h1/h2 **fogók húzhatók**
  (négyzet-pöttyök + összekötő vonal), `dragHandle` *mirrored* módban (a szemközti fogó tükrözve követ). Élő újraformálás + egy
  undo-lépés. On-device bizonyítva: a trapéz sarka Smooth-szal íves lett, a fogó húzásával a görbe átformálódott.
- [ ] ⬜ Hátra (v4): node-törlés/beszúrás (`deleteAnchor`/`insertAnchor`) + broken-fogó mód.

### 2.2 Effects panel UI — P1
- [ ] 🖼️ A `layerEffects` mag vezérlő-panelje (hozzáadás/sorrend/paraméterek).

### 2.3 Adjustment stack UI — P1
- [ ] 🖼️ Az `adjustmentStack` mag vezérlő-UI-ja (stack szerkesztés + élő előnézet).

### 2.4 Rulers / guides UI — P1
- [ ] 🖼️ `rulers` mag → vonalzó + húzható guide-ok + snap.

### 2.5 Pattern picker — P1
- [ ] 🖼️ `patternFill` mag → minta-választó + paraméterek.

### 2.6 Boolean operations UI — P1 ✅ KÉSZ (2026-10-10)
- [x] ✅ **Union/subtract/intersect/exclude UI** — [BooleanSheet](../../src/components/studio/image/BooleanSheet.tsx) +
  [imageBoolean.ts](../../src/lib/imageBoolean.ts) (`booleanCombineInDoc`/`canBoolean`) a kész `boolean` mag (`booleanShapes`)
  fölött. A kijelölt formát a **legközelebbi másik formával** kombinálja (nincs szükség többszörös kijelölésre), az eredmény EGY
  **path-forma** (`subpaths`+`fillRule`), amit a subpaths-tudatos `ShapeOverlay` rendereli (preview == video-preview). 6 teszt.
- [ ] ⬜ Hátra: `divide` op + a többszörös kijelölés (tetszőleges 2 forma kombinálása, nem csak a szomszéd).

### 2.7 Align / distribute UI — P1 🟡 (align-to-canvas KÉSZ + élőben verifikálva, distribute hátra)
- [x] ✅ **Align-to-canvas KÉSZ (2026-10-09, emulátoron verifikálva):** új „Igazítás" tool → [AlignSheet](../../src/components/studio/image/AlignSheet.tsx)
  (bal/közép/jobb · fent/közép/lent), a tiszta `layout.alignRects` + a réteg↔Rect adapter [imageLayerLayout.ts](../../src/lib/imageLayerLayout.ts)
  (`layerRect`/`alignLayerToCanvas`/`alignLayerInDoc`/`canAlignLayer`) fölött, a `commit`→`UPSERT_IMAGE_DOC` buson (undo). **11 teszt.**
  Csak pozícionálható rétegre (fotó/forma/szöveg); a tool letiltva kijelölés nélkül. On-device: a forma a vászon bal szélére ugrott.
- [x] ✅ **Distribute KÉSZ (2026-10-10):** az AlignSheet „Elosztás" szekciója (vízszintes/függőleges) az ÖSSZES pozícionált
  réteg között egyenlő réseket oszt (`distributeLayersInDoc` a `layout.distributeSpacing` fölött, kijelölés nélkül, ≥3 réteg;
  a szélsők maradnak). +3 teszt. A gomb letiltva <3 rétegnél.
- [ ] ⬜ Hátra: distribute/align a KIJELÖLT rétegek közt (→ **többszörös kijelölés** a kép-editorban) + a `grid`-elrendezés UI.

### 2.8 PSD import — P1 (🔌 BACKEND-MISSING)
- [ ] 🔌 Worker: `PSD → layers → raster/vector-approx → ImageDoc`.

### 2.9 Illustrator/PDF + PSD export — P1
- [ ] ⬜ PDF-export + PSD-export + AI-kompatibilis export-workflow (worker).

## 3. Kész, ha
Az Image Studio-ban a felhasználó **tollal rajzol + node-okat szerkeszt**, adjustment/effects/
pattern/guide-okat alkalmaz UI-ból, boolean + align/distribute műveleteket végez, PSD-t importál
és PDF/PSD-t exportál — és az előnézet egyezik a renderrel.
