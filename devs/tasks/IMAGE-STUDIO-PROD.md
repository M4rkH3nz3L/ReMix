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
- [x] 🎞️ **Image-smoke mátrix** — KÉSZ ([server/smokeImageFixtures.js](../../server/smokeImageFixtures.js) pure-mag +
  [server/scripts/imagedoc-smoke.js](../../server/scripts/imagedoc-smoke.js) runner, `npm run smoke:image`; validáció:
  [smokeImageFixtures.test.js](../../server/smokeImageFixtures.test.js), +6 teszt): 13 per-funkció `/imagedoc`-raszter
  **fotó-réteg** (fit/forgatás/tükrözés/adjust) · **forma** (fill/**gradiens**/**pattern**/blend/**stroke/árnyék/glow**) ·
  **path/toll** (bezier) · **boolean** (subpaths + evenodd-lyuk) · **szöveg** (stílus) · **több-réteg kompozit**
  (opacity/blend) · **átlátszó háttér** (alfa-PNG). **ÉLŐ FUT 13/13** (2026-10-11), mind vizuálisan verifikálva
  (gradient/pattern/glow/boolean-lyuk/háromszög/bold-szöveg/forgatott-tükrözött fotó → helyes).
  - **🐞 Közben kiszúrt + javított prod-bug:** fotó NÉLKÜLI doc (tisztán vektor/forma/szöveg — logó, gradient-poszter,
    felirat) → **HTTP 500** `path … undefined`, mert a `req.workDir`-t CSAK a multer `destination`-je hozta létre, az
    pedig csak feltöltött fájlnál fut. Fix: [server/index.js](../../server/index.js) `/imagedoc` workDir-pótlás +
    a válasz utáni temp-takarítás (eddig szivárgott). A smoke 5/13→**13/13**.
- [ ] 🎞️ **captureRef ↔ worker parity**: a fallback (c) és a worker (b) kimenete ne térjen el feltűnően (más
  renderelő) — ha eltér, a worker az elsődleges + a fallback csak vész-eset (dokumentáltan). *(worker-ág ✅; a
  captureRef-összevetés on-device futást igényel.)*
- [ ] 🎞️ **Parity-jegyzőkönyv**: a mátrix eredménye rögzítve; eltérés → javítás. (Emberi vizuális ítélet.)
  *(a `/imagedoc` worker-mátrix jegyzőkönyve: `.imagedoc-smoke/manifest.json` + 13/13 vizuális OK.)*

### 2. 🟡 Export-teljesség + minőség
Ma az export **PNG** (a `rasterize` worker-PNG-je → `Sharing.shareAsync`); hiányzik a formátum/minőség-választás.
- [x] 🟡 **Formátum + minőség** — SZERVER KÉSZ: a `/imagedoc` vesz `format` (png/jpg/webp) + `quality` (0–1)
  paramétert; [server/imagedoc.js](../../server/imagedoc.js) `imageOutputArgs()` (pure, tesztelt:
  [imagedoc.test.js](../../server/imagedoc.test.js) +4) + a renderelő-láncba kötve; a smoke `SMOKE_FORMAT`/
  `SMOKE_QUALITY`-vel verifikál. **ÉLŐ: PNG 13/13 + JPG 13/13** (valódi JPEG, 720×720). ⚠️ **WebP** a prod
  `libwebp`-es ffmpeg-et igényli (a lokális minimal-build-ből hiányzik; a Debian-alapú [Dockerfile](../../server/Dockerfile)
  tartalmazza). JPG átlátszó→fekete (nincs alfa). **KLIENS-UI KÉSZ:** új
  [ExportSheet](../../src/components/studio/image/ExportSheet.tsx) (formátum PNG/JPG/WebP + felbontás 1×/2× [2160-sapka] +
  minőség-csúszka), a `renderImageDoc`/`rasterize`/`exportImage` opts-láncon át a `/imagedoc`-ba; a variáns a cache-kulcs
  része (1×/2×/png/jpg/webp nem ütközik). i18n hu/en/de.
- [x] 🔌 **Vektor-hű SVG-export** (07 §2.9) — KÉSZ: valódi **SVG-emitter** [src/lib/svgExport.ts](../../src/lib/svgExport.ts)
  `imageDocToSvg(doc)` (az `svgImport` párja, pure, 21 teszt + round-trip az svgImport-tal): fill/fotó(`<image>`
  data-URI beágyazással)/forma (rect/ellipse/line/star/arrow/**path+subpaths+fillRule**)/**gradient** (lin/rad;
  konikus→első stop)/**pattern** (`<pattern>`)/**stroke**/**glow+árnyék** (`<filter feDropShadow>`)/szöveg/opacity/
  blend/forgatás/tükrözés. **Bekötve** az export-menübe ([ImageStudioBody](../../src/components/studio/image/ImageStudioBody.tsx)
  „SVG-export", i18n hu/en/de). **Raszter-parity vizuálisan verifikálva** (Chromium-render): gradient-irány
  (CSS-szög-konvenció javítva), boolean-lyuk, screen-blend+forgatás+opacity+szöveg kompozit → egyezik a `/imagedoc`
  raszterrel.
- [x] 🛡️ **Nagy vászon / pathológikus doc** — KÉSZ: a `/imagedoc` rétegenként egy Chromium-screenshotot készít →
  `imageDocGuard()` ([server/imagedoc.js](../../server/imagedoc.js), pure, +3 teszt) korlátozza a réteg-számot
  (≤400) és az össz-path-pontot (≤200000); túllépés → **HTTP 413 + beszédes magyar hiba** (nem néma elakadás).
  **Élő-verifikált** (401 réteg→413, 3 réteg→200). A kimeneti felbontás már 240–2160-ra sapkázott; az
  [ExportSheet](../../src/components/studio/image/ExportSheet.tsx) a felbontás-címkéken a VALÓS (sapkázott) px-t
  mutatja → nincs néma lekicsinyítés. *(Stretch: 2160 fölötti export csempézéssel — külön feladat.)*

### 3. 🔌 Worker-infra (a `/imagedoc`-hoz) — nagyrészt a közös képpel kész
- [x] ~ **A prod worker-image LEFEDI** ([server/Dockerfile](../../server/Dockerfile), [VIDEO-STUDIO-PROD](./VIDEO-STUDIO-PROD.md) #2):
  a `/imagedoc` ugyanabban a Node/Chromium/fonts image-ben fut (API-ként: `node index.js`). A **fontok** (text-réteg
  raszterizálás) a képbe kerültek.
- [ ] 🔌 **Deploy + health** (közös az [01 §2.2](./01-production-go-live.md)-vel) — a `/imagedoc` a prod API-n.

---

## P1 — valós-világ robusztusság / teljesség

### 3b. ✅ Skia natív-modul reziliencia (dev-kliens) — KÉSZ
A `@shopify/react-native-skia` (2.6.2) natív modul hiánya egy RÉGI dev-kliensből EDDIG az EGÉSZ kép-stúdiót
crash-eltette betöltéskor (`RNSkiaModule could not be found`), mert a `magicWandClient` + `BrushOverlay` a Skia-t
a modul-tetején importálta (eager). **Fix:** mindkettő **lustán** töltődik — `magicWandClient` dinamikus `import()`
a varázspálca-kezelőben, `BrushOverlay` `React.lazy`+`Suspense` az [ImageCanvas](../../src/components/studio/image/ImageCanvas.tsx)-ban,
csak az eszköz aktiválásakor. Így a vászon/forma/szöveg/gradient/**export** Skia natív modul NÉLKÜL is megy; a
brush/varázspálca Skia-t igényel → ha hiányzik, **barátságos üzenet** (`skiaMissing`) a crash helyett. *(Teljes
funkcióhoz — brush/wand — új dev-build kell: iOS lokál Xcode-blokk → EAS cloud dev-build, vagy Android.)*

### 4. ✅ Bemeneti kép-robusztusság — KÉSZ
A prod-userek tetszőleges képet dobnak be (fotó-réteg / varázspálca-forrás).
- [x] ✅ **HEIC/HEIF + nagy felbontás + EXIF-forgatás** — a bevitelt EGYSZER normalizáljuk a bevételi ponton
  ([media.ts](../../src/lib/media.ts) `pickImage`→`normalizePickedImage`): a re-encode (`imageEditor.bakeImage`,
  v57 ImageManipulator) **beégeti az EXIF-tájolást** (álló/fekvő telefon-fotó helyesen áll) és **HEIC/HEIF→JPEG**-et
  konvertál (a worker-ffmpeg nem feltétlen dekódol HEIC-et), a nagy kép a leghosszabb oldalon `INTAKE_MAX_DIM=3072`-re
  **kicsinyedik**. A döntés-mag pure + tesztelt: [imageIntake.ts](../../src/lib/imageIntake.ts) (`planImageResize`/
  `intakeOps`/`isSupportedImage`, +10 teszt). Hiba → eredeti (tartós) uri (a felvétel nem vész el). **Bónusz:** MINDEN
  `pickImage`-hívó (fotó-réteg, sticker, avatar, filter, projekt-forrás) is normalizáltat kap. *(Hátra: a `pickImage`
  csak a könyvtárból vesz — kamera/DocumentPicker kép-út, ha lesz, ugyanezt hívja; nem támogatott formátum →
  jelenleg graceful fallback, nem kemény hiba.)*

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
