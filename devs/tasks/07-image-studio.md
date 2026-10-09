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

### 2.6 Boolean operations UI — P1
- [ ] 🖼️ Union/subtract/intersect/exclude/divide UI (a path/shape mag fölé).

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
