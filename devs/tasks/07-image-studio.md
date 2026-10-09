# 🎨 07. Image Studio — P1 (pure core erős, UI-bekötés hiányos)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §7, §14. · **Testvér:** [06-video-editor](./06-video-editor.md) (render-parity), [09-native](./09-native-rendering.md) (worker).
> **Érintett kód:** [src/lib/vectorPath.ts](../../src/lib/vectorPath.ts) · [src/lib/adjustmentStack.ts](../../src/lib/adjustmentStack.ts) · [src/lib/layerEffects.ts](../../src/lib/layerEffects.ts) · [src/lib/patternFill.ts](../../src/lib/patternFill.ts) · [src/lib/rulers.ts](../../src/lib/rulers.ts) · [src/lib/layout.ts](../../src/lib/layout.ts) · [src/lib/svgImport.ts](../../src/lib/svgImport.ts) · [src/app/studio/image/[id].tsx](../../src/app/studio/image/).

---

> **📊 Haladás (2026-10-07):** 🟡 9 mag kész (pure-core KÉSZ + tesztelt, **UI hátra**) · ✅ 0 teljes · ⬜ 0 — Σ 9 tétel.
> **ÚJ (2026-10-07):** profi „Új dokumentum" + vászon-kezelés landolt — szabad **W×H (px)** + presetek +
> **Pixel/SVG** típus + **háttér** (a létrehozásnál ÉS a [CanvasSheet](../../src/components/studio/image/CanvasSheet.tsx)-ben), valamint a **projekt forrás-mappa** ([08](./08-storage.md) §2.8) a kép-editorban (kép→fotó-réteg). **Hátra marad** a 9 profi mag
> (pen / effects / adjustment-stack / rulers / pattern / boolean / align / PSD / PDF) dedikált UI-ja
> + a worker PSD/PDF-interop + az **SVG-export emitter** (a Vektor-típus ma raszterbe renderel).

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

## 2. Feladatlista

### 2.1 Vector pen UI — P1 (🖼️ UI-MISSING)
- [ ] 🖼️ Pen-tool + node-selection + handle-drag + smooth/broken/mirror + node-conversion a `vectorPath` mag fölé.

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
