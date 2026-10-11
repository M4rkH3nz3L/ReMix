# 🎨 Image Studio — PRODUCTION-készültség TODO (a még hiányzók)

> **Cél:** mi hiányzik még ahhoz, hogy a **kép-stúdió PROD-ban megbízhatóan** menjen — a videós
> [VIDEO-STUDIO-PROD.md](./VIDEO-STUDIO-PROD.md) párja. Nem új feature, hanem a meglévő, on-device-verifikált
> magok **rasterize-parity + export + robusztusság + infra** véglegesítése.
> **Testvérek (ne duplikáld):** [07-image-studio](./07-image-studio.md) (feature-lista), [CORE.md](./CORE.md),
> [01-production-go-live](./01-production-go-live.md) (prod-infra), [VIDEO-STUDIO-PROD](./VIDEO-STUDIO-PROD.md)
> (közös worker-image + render-parity-minta).
> **Érintett kód:** [server/imagedoc.js](../../server/imagedoc.js) (rasterizáló) · [server/index.js](../../server/index.js) `/imagedoc` ·
> [src/lib/imageDocClient.ts](../../src/lib/imageDocClient.ts) · [src/lib/imageDoc.ts](../../src/lib/imageDoc.ts) ·
> [src/components/studio/image/ImageStudioBody.tsx](../../src/components/studio/image/ImageStudioBody.tsx) · [server/text-render.js](../../server/text-render.js).

---

> **📊 Olvasat (2026-10-11):** a kép-stúdió **feature-oldalról kiemelkedően kész** (07: a Photoshop-alap
> toolset — toll/lasszó/varázspálca/ecset/crop/forgatás/tükrözés/gradiens/effektek/adjustment-stack/pattern/
> boolean/align — ✅, sok **on-device + worker render-parity** verifikálva). A prod-réteg hiánya nem feature,
> hanem **rendszeres parity-verifikáció + export-teljesség + bemeneti robusztusság**.
>
> **Kulcs-architektúra:** HÁROM renderelő — (a) **on-device preview** (RN/Skia: ImageCanvas), (b) **worker
> `/imagedoc`** (réteg-fa → SVG/CSS → Chromium → PNG), (c) **captureRef fallback** (a vászon pillanatképe, ha a
> worker nem él). A `rasterize()` a (b)-t próbálja, (c) a tartalék. **A három közti egyezés a fő prod-kockázat.**
> A `/imagedoc` **in-process** az API-n (nincs queue) → a videós „nincs worker → 25% stall" ITT NEM gond.
>
> Státusz-tagek ([00-README](./00-README.md) §1): ✅ DONE · 🟡 PARTIAL · 🎞️ RENDER-VERIFY · 🔌 BACKEND/INFRA · 🖼️ UI · ⬜ NOT-IMPL.

---

## P0 — e nélkül nincs megbízható prod-export

### 1. 🎞️ Rasterize-parity ÉLŐ verifikáció (Preview == Export) — a #1 prod-gate
Sok funkció on-device + worker párban verifikált EGYENKÉNT (07), de **rendszeres, teljes smoke-mátrix** nincs.
A videós mintára (render-smoke) megépíthető — a `/imagedoc` fut, a worker-image kész.
- [ ] 🎞️ **Image-smoke mátrix**: 1-1 `/imagedoc` raszter MINDEN réteg-funkcióra, és vizuális összevetés az
  előnézettel: **fotó-réteg** (fit/forgatás/tükrözés) · **forma** (5 forma + fill/**gradiens**/**pattern**/blend/
  **stroke/árnyék/glow**) · **path/toll** (bezier + fillRule) · **boolean** (union/subtract/intersect/exclude) ·
  **szöveg** (stílus/igazítás/forgatás, **fontok**) · **adjustment-stack** (expozíció/kontraszt/tónus/vignetta) ·
  **crop** · **több-réteg kompozit** (opacity/blend-sorrend) · **átlátszó háttér** (alfa-PNG).
- [ ] 🎞️ **captureRef ↔ worker parity**: a fallback (c) és a worker (b) kimenete ne térjen el feltűnően (más
  renderelő) — ha eltér, a worker az elsődleges + a fallback csak vész-eset (dokumentáltan).
- [ ] 🎞️ **Parity-jegyzőkönyv**: a mátrix eredménye rögzítve; eltérés → javítás. (Emberi vizuális ítélet.)

### 2. 🟡 Export-teljesség + minőség
Ma az export **PNG** (a `rasterize` worker-PNG-je → `Sharing.shareAsync`); hiányzik a formátum/minőség-választás.
- [ ] ⬜ **Formátum + minőség**: PNG (alfa) / **JPG** (minőség-csúszka, kisebb) / **WebP**; **felbontás/DPI**
  (a `/imagedoc` `height`-et vesz — tegyük kliens-választhatóvá: 1×/2×/export-méret).
- [ ] 🔌 **Vektor-hű SVG-export** (07 §2.9): a „svg" export-gomb MA raszterbe renderel — valódi **SVG-emitter**
  kell (a `svgImport` párja: ImageDoc → `<svg>` réteg-fából), hogy a vektor-doc vektorként exportálódjon.
- [ ] ⬜ **Nagy vászon**: a `/imagedoc` + Chromium memória/idő-korlát nagy (pl. 4000×4000) dokumentumnál;
  méret-plafon + beszédes hiba (ne csendben csonkoljon).

### 3. 🔌 Worker-infra (a `/imagedoc`-hoz) — nagyrészt a közös képpel kész
- [x] ~ **A prod worker-image LEFEDI** ([server/Dockerfile](../../server/Dockerfile), [VIDEO-STUDIO-PROD](./VIDEO-STUDIO-PROD.md) #2):
  a `/imagedoc` ugyanabban a Node/Chromium/fonts image-ben fut (API-ként: `node index.js`). A **fontok** (text-réteg
  raszterizálás) a képbe kerültek.
- [ ] 🔌 **Deploy + health** (közös az [01 §2.2](./01-production-go-live.md)-vel) — a `/imagedoc` a prod API-n.

---

## P1 — valós-világ robusztusság / teljesség

### 4. ⬜ Bemeneti kép-robusztusság
A prod-userek tetszőleges képet dobnak be (fotó-réteg / varázspálca-forrás).
- [ ] ⬜ **HEIC/HEIF** (iOS-fotók), **nagy felbontás** (lekicsinyítés a szerkesztéshez), **EXIF-forgatás**
  (álló/fekvő telefon-fotó helyes tájolása), nem támogatott formátum → barátságos hiba.

### 5. 🔌 PSD import (07 §2.8)
- [ ] 🔌 Worker: **PSD → rétegek → raster/vektor-közelítés → ImageDoc** (a réteg-fa megtartásával).

### 6. 🔌 PDF / PSD export (07 §2.9)
- [ ] 🔌 Worker: **PDF-export** (nyomdakész) + **PSD-export** (réteg-megtartó) + AI-kompatibilis workflow.

### 7. 🎨 Font-parity (preview ↔ worker)
- [ ] 🎞️ A worker a **bundled TTF-eket** (`server/assets/fonts/`) használja a text-réteghez; az on-device preview
  a RENDSZER-fontokat — ellenőrizni, hogy a UI font-választék egyezik a worker-készlettel (különben a szöveg
  mást mutat szerkesztéskor, mint az exportban). A hiányzó fontok a worker-image-be (a Dockerfile emoji+latin
  alapot már ad).

### 8. ⬜ Nagy-doc performancia
- [ ] ⬜ Sok réteg / nagy vászon: on-device preview reszponzivitás (réteg-virtualizáció?), a `/imagedoc` render-idő,
  memória; mérés + plafon (07 „nagy-doc perf").

---

## P2 — feature-farok (07-ből, nem prod-blokkoló)

- [ ] ⬜ **Boolean `divide` + többszörös kijelölés** (ma a szomszédos formával kombinál) — [07 §2.6](./07-image-studio.md).
- [ ] ⬜ **Align/distribute a KIJELÖLT rétegek közt + grid** (→ több-kijelölés a kép-editorban) — [07 §2.7](./07-image-studio.md).
- [ ] ⬜ **Toll v5**: broken-fogó + több-subpath szerkesztés — [07 §2.1](./07-image-studio.md).
- [ ] ⬜ **Gazdagabb layerEffects** (inner-shadow / color-overlay / pattern-overlay) — [07 §2.2](./07-image-studio.md).

---

## 3. Kész, ha
A kép-stúdió **prod-ban** megbízható: az **export vizuálisan egyezik az előnézettel** (rasterize-parity-mátrix OK,
a worker az elsődleges renderelő), a felhasználó **PNG/JPG/WebP-t + vektor-SVG-t** exportál választható
felbontással, a **bemeneti képek** (HEIC/nagy/EXIF) robusztusan kezeltek, a **fontok egyeznek** preview↔export
közt, nagy dokumentumon is folyékony, és (stretch) **PSD-import + PDF/PSD-export** megy a workeren.
