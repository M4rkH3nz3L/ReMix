# 🖼️ ReMix Image Studio — fejlesztési terv

> Forrás-vízió: **EDITORS** (közös editor-nyelv; a nyers forrás a doksi-konszolidációkor törölve — git-history). (A vele BÁJTRA AZONOS
> `IMAGE-EDITOR.md` duplikátum törölve; a lenti „IMAGE-EDITOR.md §…" hivatkozások
> ugyanennek a dokumentumnak a szakaszaira mutatnak.)
> Cél-útvonal: `http://localhost:8081/studio/image/<projectId>` → [src/app/studio/image/[id].tsx](../../src/app/studio/image/%5Bid%5D.tsx)
> Testvér-terv: [devs/tasks/AUDIO.md](./AUDIO.md) (ugyanez a minta a hangra).

---

## ✅ STÁTUSZ (2026-09-27)

- **Fázis A — KÉSZ.** Valódi vizuális scene-graph editor a `/studio/image/[id]`-en: `ImageStudioBody` (Shared-Body, `mode: 'project'|'scoped'`), `ImageCanvas` a látható rétegeket a timeline-előnézet `ShapeOverlay`/`TextOverlay` komponensével rajzolja (render-PARITÁS; adapter: `src/lib/imageLayerClip.ts`), fotó = `PhotoLayerView`, fill = `FillLayerView`. Move (húzás, reanimated), scale (minden réteg) + rotate (csak fotó — a render statikus forgatást csak `PhotoLayer`-re éget) a `SelectionFrame`-en, `LivePatch` élő-előnézettel, EGY undo-lépéssel. `LayerPanel` (lista + reorder/visibility/duplázás/törlés + per-kind inspector) + `AdjustSheet` (szűrő + fényerő/kontraszt/szaturáció/hőmérséklet). Minden a command-buson (`UPSERT_IMAGE_DOC`).
- **Fázis B — KÉSZ.** `ImageClip.docId` back-link; a videóból az `ImageStudioModal` nyílik (a sima képet `ImageDoc(PhotoLayer)`-be csomagolja, 1 undo: UPSERT_IMAGE_DOC+UPDATE_CLIP), Save = `renderImageDoc`→`updateClip(uri,docId)`. A desztruktív `ImageStudio.tsx` **törölve** (egy editor). Böngészőben verifikálva (project + scoped mód, 0 konzol-hiba).
- **Fázis C — RÉSZBEN kész (on-device UI):** gazdag per-kind inspector — `ColorField` (minták + HEX bevitel), szöveg-tipográfia (félkövér/betűköz/sorköz/kontúr/árnyék + stílus-presetek), forma (kitöltés/forma-választó/blend/lekerekítés/keret + árnyék/ragyogás). Alakzat-hozzáadás (rect/ellipse/line/arrow/star). Opacitás minden rétegen.
- **Fázis E — RÉSZBEN kész:** PNG-raszter export + megosztás; „kép → új videó" ReMix-cél (`insertIntoVideo`).
- **Fázis C — MAG-RÉTEG KÉSZ (expo-mentes lib-ek, UI-bekötés részben hátra):** a profi eszköztár PURE MAGJAI a `src/lib/`-ben, teszttel: `vectorPath.ts` (Bézier node-editing + SVG `d` parse↔emit, 31 teszt), `svgImport.ts` (`parseSvg` SVG → `ImageLayer`-ek, 21 teszt) — **UI-ban ÉLŐ** (`ImageStudioBody` „SVG" eszköz → `importSvg`), `layerEffects.ts` (14), `adjustmentStack.ts` (16), `patternFill.ts` (13), `rulers.ts` (9). A magok megvannak; a hozzájuk tartozó dedikált vászon-/panel-UI (toll-szerkesztő, boolean, ruler-overlay, effekt-panel, adjustment-stack UI) még hiányzik.
- **DoD (A+B) TELJESÍTVE; `npm run audit` zöld (tsc + expo lint + jest).**
- **Flag-elve (infra / nagy dedikált UI — lásd [devs/tasks/remix/](./remix/)):** Fázis D teljes AI (structural/select/generative — worker/model), és a MODELL-GAP + nagy-UI C-darabok: RasterLayer rajz-réteg (modell-gap), `vectorPath.ts` magra épülő toll/Bézier path-szerkesztő **UI** (a mag KÉSZ), boolean-művelet UI, maszk minden rétegen + clipping/gradient-maszk, GroupLayer, HSL/HSV picker + eyedropper, multi-select a vásznon; Fázis E többi formátum (JPEG/WebP/AVIF worker-param, SVG/PDF vektor-export). *(Az `svgImport.ts` SVG-parser MÁR nem flag-elt: kész és UI-ban él.)*

---

## 0. Kiindulás és cél

**Jelenlegi állapot — a vízió MAGJA már megvan, de három helyre szórva:**

1. **Nem-destruktív scene-graph modell — KÉSZ.** Az IMAGE-EDITOR.md legfontosabb döntése („legyen az Image Engine az első verziótól non-destructive + layer-based + scene-graph”) már megvalósult:
   - Adatmodell: `ImageDoc` + `ImageLayer` (`FillLayer` / `PhotoLayer` / `ShapeLayer` / `TextLayer`) — [src/types/project.ts:1096](../../src/types/project.ts#L1096).
   - Pure réteg-műveletek: `addLayer` / `updateLayer` / `reorderLayer` / `duplicateLayer` / `toggleLayerHidden` / `removeLayer` / `visibleLayers` — [src/lib/imageDoc.ts](../../src/lib/imageDoc.ts). Minden művelet ÚJ dokumentumot ad → command buson át undo-zható.
   - Command bus: `UPSERT_IMAGE_DOC` / `REMOVE_IMAGE_DOC` — [src/lib/commands.ts:60](../../src/lib/commands.ts#L60).
   - Rasterizálás: worker-Chromium raszter, tartalom-kulcsos cache — [src/lib/imageDocClient.ts](../../src/lib/imageDocClient.ts) `renderImageDoc`.
2. **A jelenlegi „szerkesztő” egy STEPPER-panel**, nem vizuális editor: [src/components/editor/panels/ImageDocPanel.tsx](../../src/components/editor/panels/ImageDocPanel.tsx) — rétegek listája + gombok, közvetlen-manipuláció (húzás/méretezés a vásznon) nélkül.
3. **A `/studio/image/[id]` képernyő placeholder-váz** — a vásznat kirajzolja a háttérszínnel, de minden eszköz `Alert('coming soon')`. Lásd [src/app/studio/image/[id].tsx](../../src/app/studio/image/%5Bid%5D.tsx).
4. **A videó-editorban VAN egy „Kép Stúdió” modal — MÁRA a közös scene-graph stúdió**: [src/components/studio/image/ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx) (a régi, destruktív `src/components/editor/ImageStudio.tsx` **törölve**). A `scoped` módú `ImageStudioBody`-t nyitja a kiválasztott kép-klip RÉTEG-FÁJÁN; ha a klipnek még nincs dokumentuma, becsomagolja egy `ImageDoc`-ba (teljes-vásznas `PhotoLayer`), és a `docId`-t visszaírja a klipre. A kijelölt képklipen az `openImageStudio(clipId)` ([editorStore.ts:1361](../../src/store/editorStore.ts#L1361)) nyitja; a Modal az [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx#L630)-ből mountolva. Az on-device bake ([src/lib/imageEditor.ts](../../src/lib/imageEditor.ts), `expo-image-manipulator`) fallbacknek megmarad.

> **⚠️ TÖRTÉNETI (Fázis A/B ELŐTTI állapot) — a 24–35. sorok a KIINDULÁST írják le; a mai állapot a fenti ✅ STÁTUSZ-blokkban.** A régi stepper-panel `ImageDocPanel.tsx` KÓDBAN még létezik és a `PanelHost`-ból mountolt, de a `/studio/image/[id]` és a videó-scoped út MÁR a vizuális `ImageStudioBody`-t használja.

**Cél (a felhasználó kérése):**

> Építsük ki a `/studio/image` képernyőt **valódi, vizuális, scene-graph alapú képszerkesztővé** (IMAGE-EDITOR.md) — ÉS tegyük lehetővé, hogy a **videóból kiválasztott kép** KÖZVETLENÜL EBBEN legyen szerkeszthető. A videó-editor mai desztruktív `ImageStudio` modulját **le kell cserélni erre** (egy, közös, nem-destruktív képszerkesztő). Ez pontosan az IMAGE-EDITOR.md 15. pontja: *„Edit image” a videóeditorból → megnyílik → módosít → Save → visszakerül a videóba.*

**Vezérelvek** (IMAGE-EDITOR.md + [AGENTS.md](../../AGENTS.md)):

- **Non-destructive scene graph** — a réteg-fa az igazság, a PNG csak az eredménye (már így van). Bitmap-manipuláció helyett szerkeszthető objektumok → az AI később ugyanezt tudja vezérelni.
- **Command bus mindenhez** — minden módosítás `dispatch({ type: 'UPSERT_IMAGE_DOC', ... })` → undo/redo. A projektet SOHA nem írjuk közvetlenül.
- **Réteg-felosztás:** könnyű megjelenítés/előnézet **on-device** (natív réteg-rajz), a végleges raszter a **workerben** (Chromium — a videó-render formáival/feliratokkal KÖZÖS motor → amit a videóban látsz, azt látod a képben is). A nehéz AI (generative fill, AI select, háttér-csere, upscsale) szintén worker/Pro.
- **AI = command-generátor** (nem külön „AI kép-app”): „Tedd pirosra a logót” → `{ command: 'UPDATE_LAYER', target: 'logo_42', patch: { fill: '#FF0000' } }` — ugyanarra a command buszra, mint a user.

---

## 1. Architektúra-döntések

### 1.1 Egyetlen komponens, két üzemmód
Mint a hangnál: **egy** megosztott törzs — [ImageStudioBody.tsx](../../src/components/studio/image/ImageStudioBody.tsx) (scene-graph), `mode` propszal — a videóból ([ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx)) és önállóan (a `/studio/image/[id]` route-ból) is UGYANAZ fut:

| mode | Mit szerkeszt | Belépés |
| --- | --- | --- |
| `project` | `kind: 'image'` projekt fő dokumentuma (`imageDocs[0]`) | `/studio/image/[id]` route |
| `scoped` | egy videó-projekt kiválasztott képéhez tartozó `ImageDoc` | a videó-editorból, Modalként |

Mivel az `ImageDoc` a `project.imageDocs[]`-ben él (nem a track/clip fában), és minden projekt tárolhat dokumentumokat, a stúdió a videóból **nem másol adatot** — ugyanazon a `useEditorStore` projekten dolgozik → azonnali, undo-zható, és a re-raszterizált PNG visszakerül a képklipre.

### 1.2 A scene-graph a modell — nincs új alap-adatmodell
Az `ImageDoc`/`ImageLayer` + a pure ops + a command + a rasterizáló **mind megvannak**. A meglévő videó-modell ráadásul a profi eszköztár nagy részét MÁR hordozza (lásd az [IMAGE-EDITOR.md § lefedettség](#7-image-editormd-lefedettség--mi-van-már-meg) táblát a végén). A hiányzó darabok (pixel/raszter réteg, csoport, réteg-szintű maszk/adjust minden rétegen) additív bővítések (3. szakasz).

### 1.3 Command bus — `UPSERT_IMAGE_DOC` az egyetlen belépő
Minden réteg-művelet a pure `imageDoc.ts` függvényeken megy → az eredményt `dispatch({ type: 'UPSERT_IMAGE_DOC', doc, label })` teszi be (mint ma az `ImageDocPanel` `commit()`-je). Dedikált finomabb parancsok (`ADD_LAYER` / `MOVE_LAYER` / `SET_FILL` / `APPLY_EFFECT` — IMAGE-EDITOR § 10, 17) csak akkor, ha az **AI-nak** kell célzott, szemantikus felület → D fázis.

### 1.4 Előnézet ↔ raszter paritás
Az élő vászon on-device natívan rajzol (a videó-editor `ShapeOverlay` / szöveg / kép-réteg megjelenítőit újrahasználva); a `renderImageDoc` worker-Chromium raszter a **mérvadó** (mint a videónál). A UI közelít, a mentett PNG pontos.

### 1.5 Pro-kapu
On-device szerkesztés + előnézet = **ingyen**. Worker-raszter HD-ben, generative AI (fill, háttér-csere, AI select, upscale) = **Pro**, a meglévő `guardPro(...)` mintával.

---

## 2. Fázisok

### 🟦 Fázis A — A placeholder → valódi vizuális scene-graph editor
Cél: `/studio/image/[id]` egy közvetlen-manipulációs vászon-editor, a meglévő `imageDoc.ts` ops + command bus + rasterizáló újrahasználásával (a stepper-`ImageDocPanel` logikáját vizuálissá emelve, nem újraírva).

- [x] **Vászon + réteg-render — KÉSZ**: az [ImageCanvas.tsx](../../src/components/studio/image/ImageCanvas.tsx) a látható rétegeket a timeline-előnézet komponenseivel rajzolja (render-paritás; adapter: [imageLayerClip.ts](../../src/lib/imageLayerClip.ts)), fotó = `PhotoLayerView`, fill = `FillLayerView`. Arány-tartó „fit".
- [x] **Közvetlen manipuláció — KÉSZ**: kijelölt réteg move (húzás, reanimated) / scale (minden réteg) + rotate (csak fotó) a [SelectionFrame.tsx](../../src/components/studio/image/SelectionFrame.tsx)-en, `LivePatch` élő-előnézettel; gesztus végén `updateLayer` → `UPSERT_IMAGE_DOC` (EGY undo). *(double-tap reset / long-press kontextus-menü: még hátra.)*
- [x] **Réteg-panel — KÉSZ**: [LayerPanel.tsx](../../src/components/studio/image/LayerPanel.tsx) bottom-sheet — lista + reorder/visibility/opacity/duplázás/törlés + per-kind inspector.
- [x] **Eszköz-sor + bottom-sheet — KÉSZ (aktuális készlet)**: `Layers · Photo · Text · Shape · SVG · Adjust · Delete` az [ImageStudioBody.tsx](../../src/components/studio/image/ImageStudioBody.tsx)-ban (`studio.imageTools.*` kulcsok). *(A tervezett `Select · Draw · Effects` eszközök még hátra — C.)*
- [x] **Adjust — KÉSZ**: [AdjustSheet.tsx](../../src/components/studio/image/AdjustSheet.tsx) — szűrő + fényerő/kontraszt/szaturáció/hőmérséklet a `PhotoLayer.adjust`-on (tint-előnézet: [adjustPreview.ts](../../src/lib/adjustPreview.ts)). *(A teljes tónuslánc — curves/hsl/balance/vignette/LUT — UI-ja + effekt-panel: C.)*
- [x] **Mentés / raszter — KÉSZ**: `rasterize` = worker `renderImageDoc` → `captureRef` fallback; `image` projekt-fajtánál ez a kimeneti PNG (`doc.renderedUri`).

### 🟩 Fázis B — Videó ↔ Image Studio integráció (a desztruktív `ImageStudio` LECSERÉLÉSE)
Cél: a videóból kiválasztott kép KÖZVETLENÜL a közös scene-graph stúdióban szerkeszthető; a régi bake-modal megszűnik (IMAGE-EDITOR § 15).

- [x] **Klip ↔ dokumentum back-link — KÉSZ**: az `ImageClip.docId?` mező él ([project.ts:583](../../src/types/project.ts#L583)). A `scoped` nyitáskor a becsomagolás EGY köteg-műveletben (`UPSERT_IMAGE_DOC` + `UPDATE_CLIP{docId}`) beköti a klipet a dokumentumhoz ([ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx)).
- [x] **„Edit image” a videóból — KÉSZ**: a kijelölt képklipen (`openImageStudio(clipId)`, [editorStore.ts:1361](../../src/store/editorStore.ts#L1361)) az `ImageStudioModal` nyílik →
  - ha a klipnek van `docId` → a közös `ImageStudioBody`-t nyitja **`scoped`** módban azzal a dokumentummal;
  - ha nincs (sima importált kép) → **becsomagolja egy új `ImageDoc`-ba** (teljes-vásznas `PhotoLayer`, a klip szűrő/korrekció-örökségével), ráteszi a `docId`-t, és azt szerkeszti.
- [x] **Visszaút (Save → videó) — KÉSZ**: a `rasterize` (worker `renderImageDoc` → `captureRef` fallback) után `updateClip(clipId, { uri, docId })` ([ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx) `saveScoped`). Undo-zható, a timeline azonnal frissül.
- [x] **A desztruktív `ImageStudio.tsx` nyugdíjazása — KÉSZ**: a `src/components/editor/ImageStudio.tsx` **törölve**; az [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx#L630) most `<ImageStudioModal />`-t mountol. **Egy képszerkesztő maradt.** *(A geometriai műveletek most a réteg `transform`/`rotation`-ján; a raster-rétegű rajz még hátra — C.)*
- [x] **Kompatibilitás — KÉSZ**: a `docId` nélküli régi képklipek becsomagolással nyílnak; a `bakeImage` on-device út (`imageEditor.ts`) fallbackként megmarad + a `rasterize` `captureRef` fallbackje offline/Expo Go alatt is ment.

### 🟨 Fázis C — A profi eszköztár kiépítése (IMAGE-EDITOR § 2, 4, 7, 8)
A modell nagy része megvan; itt a hiányzó UI + a néhány modell-gap.

- [ ] **Selection / Transform**: multi-select (`multiSelectIds` a store-ban), flip H/V, crop, szög-forgatás, arány-zár. (A perspektíva/skew/distort később — a `Tilt3D` már ad döntést.)
- [ ] **Vector (modell + MAG KÉSZ; UI hátra)**: a `ShapeLayer` már hordoz `path` + Bézier `PathPoint` (h1/h2), `subpaths` + `fillRule` (**boolean műveletek: union/subtract/intersect/exclude**), `gradient` (linear/radial/conic), `stroke` cap/join/dash. A toll/Bézier **mag KÉSZ**: [src/lib/vectorPath.ts](../../src/lib/vectorPath.ts) (node-editing: drag/split/join/reverse/node-típus + SVG `d` parse↔emit, ív→bezier). Kell még: a **toll/Bézier szerkesztő UI** (a magra kötve) + a boolean-műveletek felülete. Alakzat-hozzáadás (rect/ellipse/line/arrow/star) az `ImageStudioBody`-ban ÉLŐ.
- [ ] **Text (KÉSZ a modellben)**: a `TextLayer` a teljes `TextClip`-tipográfiát viszi (tracking/leading/stroke/shadow/gradient/curved `textPath`) — csak felület kell.
- [ ] **Masks (részben KÉSZ)**: a `PhotoLayer.mask` (`ClipMask`: shape/polygon/feather/expand/invert) megvan. Kell: maszk MINDEN rétegtípuson + **clipping mask** (réteg maszkolja az alattát) + gradient-maszk UI.
- [ ] **Pixel / raszter réteg (fő modell-gap — IMAGE-EDITOR § 1 „Pixel document”, § 2 Draw)**: új `RasterLayer` réteg-típus (ecset/radír/marker rajzolt PNG-je). A rajz on-device ([src/components/editor/ImageMarkupTool.tsx](../../src/components/editor/ImageMarkupTool.tsx) újrahasználása), az eredmény raszter-rétegként a scene-graphba → a Chromium-raszter komponálja. Így lesz **hybrid canvas** (pixel + vector, § 8).
- [x] **SVG import → scene graph (§ 7) — KÉSZ**: SVG parser → `ImageLayer` path-ok (ne bitmap!) — [src/lib/svgImport.ts](../../src/lib/svgImport.ts) `parseSvg` (21 teszt), UI-ban ÉLŐ (`ImageStudioBody` „SVG" eszköz → `importSvg`, egy köteg-undo). A `subpaths`/`gradient`/`stroke` mezők fogadják. *(A rokon `patternFill.ts`/`layerEffects.ts`/`adjustmentStack.ts`/`rulers.ts` magok is megvannak — UI-bekötés hátra.)*
- [ ] **Color rendszer (§ 6)**: RGB/HEX/alpha + `ShapeGradient` (linear/radial/conic) megvan; HSL/HSV picker + eyedropper hozzáadása.

### 🟧 Fázis D — AI réteg (worker) — Pro (IMAGE-EDITOR § 10–14)
- [ ] **Structural AI** (§ 11): a dokumentumot szerkeszti commandokkal („nagyítsd/középre/kékre/töröld”) → `UPSERT_IMAGE_DOC` láncok. Réteg-tudatos (§ 12): a rétegek nevesítve (person/car/logo…), így cél-réteg műveletek újragenerálás nélkül.
- [ ] **AI Select** (§ 13): tap → szegmentáció (worker u2net-mintára, mint a videó `SelectiveEdit` / bgremove) → objektum-kijelölés → remove/cutout/blur/recolor/replace/relight/resize.
- [ ] **Generative fill** (§ 14): terület-kijelölés + prompt → 3–4 variáció, mindegyik **ÚJ rétegként** (visszavonható), nem az eredeti fölülírásával.
- [ ] **Generative AI** (§ 11): háttér/objektum generálás — worker, Pro. Külön a Structural AI-tól (a kettő ne keveredjen).

### 🟥 Fázis E — Export / ReMix-integráció (IMAGE-EDITOR § 15)
- [ ] **Raster export**: PNG / JPEG / WebP / AVIF (worker-raszter minőség-paraméterrel).
- [ ] **Vector export**: SVG / PDF (a scene-graphból közvetlenül — a vektor-rétegek path-jaiból).
- [ ] **ReMix célok**: PNG → video-réteg, SVG → overlay, kép → thumbnail / cover ([src/components/CoverPhotoEditor.tsx](../../src/components/CoverPhotoEditor.tsx) egyesíthető ide), kép → social poszt.

---

## 3. Adatmodell-bővítések (minimál, additív — `schemaVersion` bump)

Mind opcionális/defaultos — a régi projektek változatlanul töltenek ([migrateProject](../../src/lib/projectUtils.ts#L137)).

- [x] `ImageClip.docId?: string` — a klip ↔ forrás-`ImageDoc` back-link (a „Edit image from video” alapja) — **KÉSZ** ([src/types/project.ts:583](../../src/types/project.ts#L583)).
- [ ] Új `RasterLayer` réteg-típus (`kind: 'raster'; uri; position; w; h; …`) — a pixel-dokumentum / rajz réteg. (Ma az `ImageLayer` union: `FillLayer | PhotoLayer | ShapeLayer | TextLayer` — [project.ts:1182](../../src/types/project.ts#L1182).)
- [ ] Réteg-szintű `mask?` és `adjust?` MINDEN `ImageLayer`-en (ma csak `PhotoLayer`-en) + `blendMode?` az `ImageLayerBase`-en (ma csak `ShapeLayer`-en). (Ellenőrizve: `ImageLayerBase` = id/name/hidden/opacity — nincs rajta `blendMode`/`mask`/`adjust`.)
- [ ] (Opcionális) `GroupLayer` (§ 3 „Logo ├ Glow ├ Wordmark”) — réteg-csoport későbbre.

---

## 4. Érintett fájlok

**Újrahasznosítani (ne írjuk újra):**
- [src/lib/imageDoc.ts](../../src/lib/imageDoc.ts) — a teljes pure réteg-ops készlet.
- [src/lib/imageDocClient.ts](../../src/lib/imageDocClient.ts) — worker-raszter + tartalom-kulcsos cache.
- [src/lib/commands.ts](../../src/lib/commands.ts) — `UPSERT_IMAGE_DOC` / undo.
- [src/components/editor/panels/ImageDocPanel.tsx](../../src/components/editor/panels/ImageDocPanel.tsx) — a `commit()` minta + réteg-műveletek (a UI vizuálissá emelendő).
- [src/components/preview/ShapeOverlay.tsx](../../src/components/preview/ShapeOverlay.tsx) — vektor/alakzat natív rajz (előnézet).
- [src/components/editor/ImageMarkupTool.tsx](../../src/components/editor/ImageMarkupTool.tsx) + [src/components/editor/ImageCropTool.tsx](../../src/components/editor/ImageCropTool.tsx) — rajz/crop eszközök (raszter-rétegbe kötve).
- [src/lib/imageEditor.ts](../../src/lib/imageEditor.ts) — on-device bake (fallback, offline).
- [src/lib/adjustPreview.ts](../../src/lib/adjustPreview.ts) — tint-előnézet a korrekcióhoz.
- [src/lib/snapping.ts](../../src/lib/snapping.ts) — igazítás a vásznon.

**Új (KÉSZ, hacsak jelölve nincs):**
- ✅ [src/app/studio/image/[id].tsx](../../src/app/studio/image/%5Bid%5D.tsx) (valódi vizuális editor, vékony burkoló) + `src/components/studio/image/*`: [ImageStudioBody.tsx](../../src/components/studio/image/ImageStudioBody.tsx) (megosztott törzs), [ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx) (scoped Modal), `ImageCanvas.tsx`, `LayerPanel.tsx`, `AdjustSheet.tsx`, `StudioSheet.tsx`, `PhotoLayerView.tsx`, `FillLayerView.tsx`, `SelectionFrame.tsx`, `ColorField.tsx`.
- ✅ [src/lib/svgImport.ts](../../src/lib/svgImport.ts) (SVG → scene graph) + a rokon magok ([vectorPath.ts](../../src/lib/vectorPath.ts), [layerEffects.ts](../../src/lib/layerEffects.ts), [adjustmentStack.ts](../../src/lib/adjustmentStack.ts), [patternFill.ts](../../src/lib/patternFill.ts), [rulers.ts](../../src/lib/rulers.ts)) + [imageLayerClip.ts](../../src/lib/imageLayerClip.ts) (réteg↔clip render-adapter). ⏳ `RasterLayer` rajz-integráció még hátra.
- ⏳ Worker-endpointok: AI select / generative fill / háttér-csere (a bgremove/depth mintára).

**Módosítani:**
- [src/types/project.ts](../../src/types/project.ts) — ✅ `ImageClip.docId` KÉSZ; ⏳ `RasterLayer` + réteg-szintű `mask`/`adjust`/`blendMode` még hátra.
- ✅ [src/store/editorStore.ts](../../src/store/editorStore.ts) — `openImageStudio`/`closeImageStudio` + `imageStudioClipId` állapot KÉSZ; a becsomagolás (scoped mód, docId nélküli klip) az `ImageStudioModal`-ban történik.
- ✅ [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx#L630) — `<ImageStudioModal />` mountolva (a régi `<ImageStudio />` törölve).
- [src/components/editor/panels/ImageDocPanel.tsx](../../src/components/editor/panels/ImageDocPanel.tsx) — a régi stepper-panel; a scoped út MÁR nem ezt használja (a docId-t az `ImageStudioModal` kezeli). *(A panel raszter-beszúrás docId-kötése önmagában még nyitott, de a fő út lecserélve.)*
- [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) — a `kind: 'image'` scaffold már seedeli az `imageDocs[0]`-t ([:83](../../src/lib/projectUtils.ts#L83)); a migráció a `docId`/új mezők miatt lép.

---

## 5. Nyitott kérdések / kockázatok

- **Raszter worker-függő:** a `renderImageDoc` weben `null`-t ad, és renderszervert igényel (a dev-stack render-worker feltétel). Az on-device előnézet natív, de a PIXEL-pontos kimenet a workerből jön — ezért a végleges mentés online. (A `bakeImage` on-device fallback marad rövid/offline esetre.)
- **Pixel-rajz mobilon:** a raszter-réteg dekódolt bitmap-je memóriaigényes; nagy felbontásnál csempézés/limit kell.
- **Desztruktív ↔ scene-graph együttélés:** a B fázis alatt a két út egy ideig együtt él; a `docId` back-link a kapcsoló. A régi képklipek becsomagolással kerülnek a scene-graphba.
- **Modal vs. route a videóból:** a terv **Modal**-t ajánl (állapot-megőrzés, ugyanaz a store), mint a hangnál. → Döntés az A/B határán.
- **SVG parser** hatóköre (path/gradient/text lefedettség) — MVP: path + fill/stroke + lineáris gradient.

---

## 6. Definition of Done (A+B — a felhasználó fő kérése) — ✅ TELJESÍTVE

1. ✅ `/studio/image/[id]` valódi, vizuális, scene-graph editor: vászon + közvetlen-manipuláció (move/scale/rotate) + réteg-panel + adjust, minden művelet undo-zható.
2. ✅ A videó-editorból egy kijelölt kép **ugyanezt** a scene-graph stúdiót nyitja (`ImageStudioModal`, nem a desztruktív bake-modalt), és a Save non-destruktívan visszakerül a videó-projektbe.
3. ✅ A `docId` back-link működik: egy videóba illesztett kép **újra** megnyitható a réteg-fájával; a sima importált kép becsomagolással szerkeszthető.
4. ✅ A régi desztruktív `ImageStudio.tsx` megszűnt (törölve); az editor-route a közös `ImageStudioModal`-t mountolja — **egy** képszerkesztő maradt.
5. ✅ `npm run audit` zöld (tsc + lint + jest).

---

## 7. IMAGE-EDITOR.md lefedettség — mi van már meg?

| IMAGE-EDITOR.md szakasz | Modellben MÁR megvan | Hiányzik (fázis) |
| --- | --- | --- |
| § 1 Vector document / scene graph | `ImageDoc` + `ShapeLayer` path/subpaths | Pixel/raszter réteg (C) |
| § 2 Selection | `multiSelectIds` | lasso / magic / feather UI (C/D) |
| § 2 Transform | `transform` / `rotation` / crop | perspektíva/skew (később) |
| § 2 Draw | rajz-eszköz (`ImageMarkupTool`) | raszter-réteg integráció (C) |
| § 2 Vector | `path` + Bézier `PathPoint`, `subpaths`+`fillRule` (**boolean!**) + `vectorPath.ts` mag KÉSZ | toll/Bézier + boolean **UI** (C) |
| § 2 Text | teljes `TextLayer` tipográfia | csak felület (A/C) |
| § 3 Layers (opacity/blend/visibility/lock) | `ImageLayerBase` + `BlendMode` | blend/mask minden rétegen (3.) |
| § 4 Masks | `ClipMask` a `PhotoLayer`-en | clipping/gradient-maszk minden rétegen (C) |
| § 5 Adjustments | teljes `ClipAdjust` (curves/hsl/balance/LUT) | csak felület (A) |
| § 6 Color | RGB/HEX/alpha + `ShapeGradient` | HSL/HSV picker + eyedropper (C) |
| § 7 SVG editor | a path/gradient mezők fogadják + `svgImport.ts` parser **KÉSZ** (UI-ban él) | dedikált SVG-szerkesztő UI (C) |
| § 8 Pixel+Vector hybrid | vektor kész | pixel réteg (C) |
| § 9 Közös dokumentummodell | `Project` egységes, stabil ID-k | — |
| § 10 Command bus (AI-ready) | `UPSERT_IMAGE_DOC` + undo | szemantikus AI-parancsok (D) |
| § 11–14 AI (structural/generative/select/fill) | — | worker/Pro (D) |
| § 15 Export + „Edit from video” | worker-raszter, timeline-beszúrás, **`ImageClip.docId` back-link KÉSZ** | további formátumok (E) |
| § 16 Mobil UI + gesztusok | transform-gesztusok a videóban | vászon-editor UI (A) |
| § 17 Közös editor-nyelv | közös `Project` + command bus | — |
