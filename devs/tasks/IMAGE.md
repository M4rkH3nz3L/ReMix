# 🖼️ ReMix Image Studio — fejlesztési terv

> Forrás-vízió: [devs/source/EDITORS.md](../source/EDITORS.md). (A vele BÁJTRA AZONOS
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
- **DoD (A+B) TELJESÍTVE; `npm run audit` zöld (tsc + expo lint + jest 337).**
- **Flag-elve (infra / nagy dedikált UI — lásd [AUDITBUGS.md](../../AUDITBUGS.md)):** Fázis D teljes AI (structural/select/generative — worker/model), és a nehéz C-darabok: RasterLayer rajz-réteg, SVG parser (`svgImport.ts`), toll/Bézier path-szerkesztő UI, boolean-művelet UI, maszk minden rétegen + clipping/gradient-maszk, GroupLayer, HSL/HSV picker + eyedropper, multi-select a vásznon; Fázis E többi formátum (JPEG/WebP/AVIF worker-param, SVG/PDF vektor-export).

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
4. **A videó-editorban VAN egy „Kép Stúdió” modal — de DESZTRUKTÍV, és NEM a scene-graphon dolgozik**: [src/components/editor/ImageStudio.tsx](../../src/components/editor/ImageStudio.tsx). Egy kép-KLIP (`ImageClip`) fájlját forgatja/tükrözi/vágja/rajzolja on-device (`expo-image-manipulator`, [src/lib/imageEditor.ts](../../src/lib/imageEditor.ts)) → új PNG-t éget. A kijelölt képklipen az `openImageStudio(clipId)` nyitja.

**Két képszerkesztő él tehát párhuzamosan** (scene-graph panel ↔ destruktív bake-modal), és egyik sem az a vizuális, egységes editor, amit az IMAGE-EDITOR.md leír.

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
Mint a hangnál: **egy** `ImageStudio` (scene-graph) komponens, `mode` propszal — a videóból és önállóan is UGYANAZ fut:

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

- [ ] **Vászon + réteg-render** ([src/app/studio/image/[id].tsx](../../src/app/studio/image/%5Bid%5D.tsx) átírása): a `visibleLayers(doc)` rétegeit natívan kirajzolni (fill / photo / shape / text) — a videó-editor megjelenítőit újrahasználva ([src/components/preview/ShapeOverlay.tsx](../../src/components/preview/ShapeOverlay.tsx), szöveg/kép rétegek). Arány-tartó „fit” (mint a mai placeholder).
- [ ] **Közvetlen manipuláció (IMAGE-EDITOR § 16 gesztusok)**: kijelölt réteg move / pinch-scale / rotate a vásznon (a videó-editor transform-gesztusai + [src/lib/snapping.ts](../../src/lib/snapping.ts) igazítás). Minden gesztus végén `updateLayer` → `UPSERT_IMAGE_DOC`. `double tap → reset`, `long press → kontextus-menü`.
- [ ] **Réteg-panel** (IMAGE-EDITOR § 3): a `layerLabel` / `layerIcon` listája (fentről lefelé fordítva), láthatóság / zár / opacity / blend / sorrend (`reorderLayer`), duplikálás, törlés — a mai `ImageDocPanel` gombjai, de bottom-sheetben.
- [ ] **Eszköz-sor + bottom-sheet** (IMAGE-EDITOR § 16): `Select · Draw · Shape · Text · Image · Adjust · Effects`. A `studio.imageTools.*` i18n kulcsok részben megvannak (layers/crop/adjust/text/shapes/draw).
- [ ] **Adjust / Effects** (IMAGE-EDITOR § 5): a `PhotoLayer.adjust` (`ClipAdjust`) — a videó-editor teljes tónuslánca (brightness…curves/hsl/balance/vignette/LUT) MÁR a modellben; itt csak felület kell + on-device tint-előnézet ([src/lib/adjustPreview.ts](../../src/lib/adjustPreview.ts)).
- [ ] **Mentés / raszter**: `renderImageDoc(doc)` → `doc.renderedUri`; a projekt-fajta `image` esetén ez a kimeneti PNG.

### 🟩 Fázis B — Videó ↔ Image Studio integráció (a desztruktív `ImageStudio` LECSERÉLÉSE)
Cél: a videóból kiválasztott kép KÖZVETLENÜL a közös scene-graph stúdióban szerkeszthető; a régi bake-modal megszűnik (IMAGE-EDITOR § 15).

- [ ] **Klip ↔ dokumentum back-link** (ma HIÁNYZIK): új `ImageClip.docId?` mező. Az `ImageDocPanel` raszter-beszúrás ma NEM köti vissza a klipet a forrás-dokumentumhoz — ezért az „újraszerkesztés” nem tudja, melyik doksit nyissa. A beszúráskor ([ImageDocPanel.tsx:136](../../src/components/editor/panels/ImageDocPanel.tsx#L136)) el kell tenni a `docId`-t a klipre.
- [ ] **„Edit image” a videóból**: a kijelölt képklipen (`openImageStudio(clipId)`, [editorStore.ts:395](../../src/store/editorStore.ts#L395)) →
  - ha a klipnek van `docId` → a közös `ImageStudio`-t nyitja **`scoped`** módban azzal a dokumentummal;
  - ha nincs (sima importált kép) → **becsomagoljuk egy új `ImageDoc`-ba** (egyetlen `PhotoLayer`), rátesszük a `docId`-t, és azt szerkesztjük. Így minden kép non-destruktívan, réteg-fásan szerkeszthetővé válik.
- [ ] **Visszaút (Save → videó)**: a szerkesztés után `renderImageDoc` → az új PNG-vel `updateClip(clipId, { uri, docId })`. Undo-zható, és a videó-timeline azonnal frissül.
- [ ] **A desztruktív `ImageStudio.tsx` nyugdíjazása**: a rotate/flip/crop/draw MŰVELETEK megmaradnak, de scene-graph-műveletként (a geometriai transzformáció a réteg `transform`-ját/`rotation`-ját állítja, a rajz raszter-rétegként — lásd C fázis), nem új fájlba égetve. Az [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) `<ImageStudio />` mountját a közös komponens Modaljára cseréljük. **A cél: egy képszerkesztő maradjon.**
- [ ] **Kompatibilitás**: a régi, `docId` nélküli képklipek továbbra is megnyithatók (becsomagolás úttal) — a `bakeImage` on-device út megmarad fallbacknek offline/Expo Go alatt.

### 🟨 Fázis C — A profi eszköztár kiépítése (IMAGE-EDITOR § 2, 4, 7, 8)
A modell nagy része megvan; itt a hiányzó UI + a néhány modell-gap.

- [ ] **Selection / Transform**: multi-select (`multiSelectIds` a store-ban), flip H/V, crop, szög-forgatás, arány-zár. (A perspektíva/skew/distort később — a `Tilt3D` már ad döntést.)
- [ ] **Vector (nagyrészt KÉSZ a modellben)**: a `ShapeLayer` már hordoz `path` + Bézier `PathPoint` (h1/h2), `subpaths` + `fillRule` (**boolean műveletek: union/subtract/intersect/exclude**), `gradient` (linear/radial/conic), `stroke` cap/join/dash. Kell: a **toll/Bézier szerkesztő UI** + a boolean-műveletek felülete + alakzat-hozzáadás (rect/ellipse/line/star/polygon).
- [ ] **Text (KÉSZ a modellben)**: a `TextLayer` a teljes `TextClip`-tipográfiát viszi (tracking/leading/stroke/shadow/gradient/curved `textPath`) — csak felület kell.
- [ ] **Masks (részben KÉSZ)**: a `PhotoLayer.mask` (`ClipMask`: shape/polygon/feather/expand/invert) megvan. Kell: maszk MINDEN rétegtípuson + **clipping mask** (réteg maszkolja az alattát) + gradient-maszk UI.
- [ ] **Pixel / raszter réteg (fő modell-gap — IMAGE-EDITOR § 1 „Pixel document”, § 2 Draw)**: új `RasterLayer` réteg-típus (ecset/radír/marker rajzolt PNG-je). A rajz on-device ([src/components/editor/ImageMarkupTool.tsx](../../src/components/editor/ImageMarkupTool.tsx) újrahasználása), az eredmény raszter-rétegként a scene-graphba → a Chromium-raszter komponálja. Így lesz **hybrid canvas** (pixel + vector, § 8).
- [ ] **SVG import → scene graph (§ 7)**: SVG parser → `ShapeLayer` path-ok (ne bitmap!). A `subpaths`/`gradient`/`stroke` mezők már fogadják.
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

- [ ] `ImageClip.docId?: string` — a klip ↔ forrás-`ImageDoc` back-link (a „Edit image from video” alapja).
- [ ] Új `RasterLayer` réteg-típus (`kind: 'raster'; uri; position; w; h; …`) — a pixel-dokumentum / rajz réteg.
- [ ] Réteg-szintű `mask?` és `adjust?` MINDEN `ImageLayer`-en (ma csak `PhotoLayer`-en) + `blendMode?` az `ImageLayerBase`-en (ma csak `ShapeLayer`-en).
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

**Új:**
- `src/app/studio/image/[id].tsx` (valódi vizuális editor) + `src/components/studio/image/*` (Canvas, LayerPanel, tool bottom-sheetek, gesture-réteg).
- `src/lib/svgImport.ts` (SVG → scene graph) + a `RasterLayer` rajz-integráció.
- Worker-endpointok: AI select / generative fill / háttér-csere (a bgremove/depth mintára).

**Módosítani:**
- [src/types/project.ts](../../src/types/project.ts) — `ImageClip.docId`, `RasterLayer`, réteg-szintű `mask`/`adjust`/`blendMode`.
- [src/store/editorStore.ts](../../src/store/editorStore.ts) — `openImageStudio` a közös scene-graph komponenshez köti (scoped mód + becsomagolás docId nélküli klipnél).
- [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) — `<ImageStudio />` → közös scene-graph `ImageStudio` Modal.
- [src/components/editor/panels/ImageDocPanel.tsx](../../src/components/editor/panels/ImageDocPanel.tsx) — raszter-beszúráskor a `docId` a klipre.
- [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) — a `kind: 'image'` scaffold már seedeli az `imageDocs[0]`-t ([:83](../../src/lib/projectUtils.ts#L83)); a migráció a `docId`/új mezők miatt lép.

---

## 5. Nyitott kérdések / kockázatok

- **Raszter worker-függő:** a `renderImageDoc` weben `null`-t ad, és renderszervert igényel (a dev-stack render-worker feltétel). Az on-device előnézet natív, de a PIXEL-pontos kimenet a workerből jön — ezért a végleges mentés online. (A `bakeImage` on-device fallback marad rövid/offline esetre.)
- **Pixel-rajz mobilon:** a raszter-réteg dekódolt bitmap-je memóriaigényes; nagy felbontásnál csempézés/limit kell.
- **Desztruktív ↔ scene-graph együttélés:** a B fázis alatt a két út egy ideig együtt él; a `docId` back-link a kapcsoló. A régi képklipek becsomagolással kerülnek a scene-graphba.
- **Modal vs. route a videóból:** a terv **Modal**-t ajánl (állapot-megőrzés, ugyanaz a store), mint a hangnál. → Döntés az A/B határán.
- **SVG parser** hatóköre (path/gradient/text lefedettség) — MVP: path + fill/stroke + lineáris gradient.

---

## 6. Definition of Done (A+B — a felhasználó fő kérése)

1. `/studio/image/[id]` valódi, vizuális, scene-graph editor: vászon + közvetlen-manipuláció (move/scale/rotate) + réteg-panel + adjust, minden művelet undo-zható.
2. A videó-editorból egy kijelölt kép **ugyanezt** a scene-graph stúdiót nyitja (nem a desztruktív bake-modalt), és a Save non-destruktívan visszakerül a videó-projektbe.
3. A `docId` back-link működik: egy videóba illesztett kép **újra** megnyitható a réteg-fájával; a sima importált kép becsomagolással szerkeszthető.
4. A régi desztruktív `ImageStudio.tsx` megszűnt / a közös komponensre irányít — **egy** képszerkesztő maradt.
5. `npm run audit` zöld (tsc + lint + jest).

---

## 7. IMAGE-EDITOR.md lefedettség — mi van már meg?

| IMAGE-EDITOR.md szakasz | Modellben MÁR megvan | Hiányzik (fázis) |
| --- | --- | --- |
| § 1 Vector document / scene graph | `ImageDoc` + `ShapeLayer` path/subpaths | Pixel/raszter réteg (C) |
| § 2 Selection | `multiSelectIds` | lasso / magic / feather UI (C/D) |
| § 2 Transform | `transform` / `rotation` / crop | perspektíva/skew (később) |
| § 2 Draw | rajz-eszköz (`ImageMarkupTool`) | raszter-réteg integráció (C) |
| § 2 Vector | `path` + Bézier `PathPoint`, `subpaths`+`fillRule` (**boolean!**) | toll/Bézier + boolean UI (C) |
| § 2 Text | teljes `TextLayer` tipográfia | csak felület (A/C) |
| § 3 Layers (opacity/blend/visibility/lock) | `ImageLayerBase` + `BlendMode` | blend/mask minden rétegen (3.) |
| § 4 Masks | `ClipMask` a `PhotoLayer`-en | clipping/gradient-maszk minden rétegen (C) |
| § 5 Adjustments | teljes `ClipAdjust` (curves/hsl/balance/LUT) | csak felület (A) |
| § 6 Color | RGB/HEX/alpha + `ShapeGradient` | HSL/HSV picker + eyedropper (C) |
| § 7 SVG editor | a path/gradient mezők fogadják | SVG parser (C) |
| § 8 Pixel+Vector hybrid | vektor kész | pixel réteg (C) |
| § 9 Közös dokumentummodell | `Project` egységes, stabil ID-k | — |
| § 10 Command bus (AI-ready) | `UPSERT_IMAGE_DOC` + undo | szemantikus AI-parancsok (D) |
| § 11–14 AI (structural/generative/select/fill) | — | worker/Pro (D) |
| § 15 Export + „Edit from video” | worker-raszter, timeline-beszúrás | docId link + formátumok (B/E) |
| § 16 Mobil UI + gesztusok | transform-gesztusok a videóban | vászon-editor UI (A) |
| § 17 Közös editor-nyelv | közös `Project` + command bus | — |
