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
| §1 | **Rétegek & kompozíció** (fill/photo/shape/text, panel, opacity/hidden, **blend-mode**, **gradient-maszk**, **csoportok**, **kontúr**) | ✅ *(festett-maszk ⬜)* |
| §2 | **Kijelölés & maszkolás** (lasszó + varázspálca + ecset + **réteg-maszk** + **kijelölés-alapú korrekció**: ellipszis/téglalap/lasszó-poligon + feather/invert/expand) | ✅ *(festett raszter-maszk ⬜)* |
| §3 | **Retusálás** (**folt-javítás/objektum-eltávolítás** + dodge/burn=lokális korrekció) | 🟡 *(klón-bélyegző/blur-ecset ⬜)* |
| §4 | **Vektor & szöveg** (toll/node + boolean + SVG import/export + szöveg-stílus + **text-on-path**) | ✅ *(toll v5, OpenType ⬜)* |
| §5 | **Korrekciók & szűrők** (adjustment-stack + **görbék** + **grade/LUT** + forma-fx + struktúra-szűrők + **gradient-map**) | ✅ *(levels/channel-mixer ⬜)* |
| §6 | **Transzformáció** (mozgat/skála/forgat/tükröz/crop + **nyújtás** + **perspektíva** + vonalzó/guide/snap) | ✅ *(warp-rács ⬜)* |
| §7 | **Export & megosztás** (PNG/JPG/WebP/SVG/PDF + galéria/diavetítés/carousel) | ✅ *(PSD import/export ⬜)* |
| §8 | **UX-paritás** (**history-panel** + **vászon-zoom/pan** + **smart-guides** kész) | ✅ *(billentyű/a11y ⬜)* |

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
- [x] ✅ **Csoport-rétegek (mappák)** — LAPOS `groupId`-modell (`ImageLayerBase.groupId` + `ImageDoc.groups`
  [`ImageGroup` id/name/hidden/collapsed/opacity]); a `layers` tömb lapos marad (nincs `kind`-ripple). Worker:
  rejtett csoport tagjai kimaradnak, a csoport-opacity a tagokra RÁszorzódik; a preview `visibleLayers`+
  `effectiveLayerOpacity` paritásban; lib `createGroup/assignLayerToGroup/ungroup/updateGroup` (4 teszt); UI:
  LayerInspector „Csoport" chipek (hozzárendelés/új) + LayerPanel csoport-bucketing (fejléc: összecsukás/név/
  közös-opacity/elrejt/feloldás, behúzott tagok). *ÉLŐ-BIZONYÍTVA (/imagedoc, kék fotó fehéren): kontroll=799fc7;
  csoport rejtve=ffffff; opacity 0.5=bbcee3 (≈kék 50%); HTTP 200.* (beágyazott csoport + per-tag transzform ⬜)
- [x] ✅ **Dokumentum-szintű GLOBÁLIS korrekció** (grade + adjust a TELJES kompozitra) — `ImageDoc.grade` +
  `ImageDoc.adjust`; a render a kompozit UTÁN égeti (`gradeFilterChain`+`adjustChain`, a vignetta/grain ELŐTT);
  CanvasSheet „Globális look" (grade-chipek + expozíció/kontraszt/telítettség csúszkák). *ÉLŐ-BIZONYÍTVA
  (/imagedoc, kék fotó 121/159/199): kontroll=799fc7; doc-grade warm-film=131/161/181 (R↑ B↓);
  saturation=-1→151/153/150 (R≈G≈B); exposure=0.8→210/255/255 (világosabb); mind HTTP 200.*
- [x] ✅ **Per-réteg korrekció-réteg (adjustment layer)** — új `AdjustmentImageLayer` (kind:'adjust',
  grade?/adjust?/mask?): nincs saját tartalma, a rajzolási pozíciójánál az ALATTA felépült kompozitra hat
  (`imagedoc.js` a `last`-ra alkalmazza a grade+adjust láncot; `mask` esetén csak a régióra). UI: LayerPanel
  „Korrekció" hozzáadás-gomb + LayerInspector grade-chipek + expozíció/kontraszt/telítettség (+ a közös maszk-
  szekció a confine-hoz); preview teljes-vászon tint-közelítés a rajzolási sorrendben. *ÉLŐ-BIZONYÍTVA
  (/imagedoc, kék fotó + fölötte noir korrekció-réteg): teljes → közép 949794 (R≈G≈B); ellipszis-maszkkal →
  közép 949794/sarok 799fc7 (kék); HTTP 200.*
- [x] ✅ **Vetett árnyék bármely pozícionált rétegre** (fotó/forma/szöveg) — `ImageLayerBase.dropShadow` + a render a
  réteg elmosott, eltolt sziluettjét teszi mögé (`shadowSilhouette`: lutrgb+gblur+alfa); LayerInspector-toggle.
  *ÉLŐ-BIZONYÍTVA: foto alatt-jobbra árnyékkal 7f7f7f (szürke) vs nélküle ffffff (worker-pixelmérés).*
- [x] ✅ **Külső ragyogás (outer glow)** bármely pozícionált rétegre — `ImageLayerBase.outerGlow` + a render
  paddelt (túlterjedő), színes, elmosott sziluettet tesz mögé (`glowSilhouette`). *ÉLŐ-BIZONYÍTVA: foto körül
  glow-val 05030b (lilás halo) vs nélküle 000000 (worker-pixelmérés).*
- [x] ✅ **Kontúr/stroke bármely pozícionált rétegre** (fotó/forma/szöveg) — `ImageLayerBase.stroke
  {color,width}` (width a vászonszélesség törtje); a render a réteg színezett, N px-rel megnövelt
  sziluettjét teszi MÖGÉ (`strokeSilhouette`, a glow/árnyék UTÁN = legközelebb); LayerInspector „Kontúr"
  chip + ColorField + vastagság-csúszka. *ÉLŐ-BIZONYÍTVA (/imagedoc, 50%-os fotó fehér háttéren, piros 0.08):
  közép=fotó 799fc7; keret=fe0000 (piros); háttér=ffffff; HTTP 200.*
- [x] ✅ **Egyedi árnyék/glow** (szín/eltolás/lágyság/átlátszóság) — a `dropShadow`/`outerGlow` lehet
  `true` (alap) VAGY config-objektum (`{color,dx,dy,blur,opacity}` ill. `{color,size,opacity}`); a render a
  `shadowSilhouette`/`glowSilhouette`-et a megadott színnel/paraméterrel égeti; LayerInspector ColorField +
  csúszkák. *ÉLŐ-BIZONYÍTVA (/imagedoc, 50%-os fotó fehéren): piros árnyék (dx/dy 0.08) → árnyék-régió fe0000
  (fotó-közép 799fc7); zöld glow (size 0.05) → halo 85ff86; HTTP 200.*

## 2. 🎯 Kijelölés & maszkolás — 🟡 kijelölés van, maszk-bekötés hiányzik
- [x] ✅ **Lasszó** + **varázspálca** (magicWandClient) + **ecset** — a kijelölés/festés él.
- [x] ✅ **Szelekció → réteg-maszk + maszk-finomítás** — `PhotoLayer/ShapeLayer/TextLayer.mask` (`ClipMask`
  ellipszis/téglalap/poligon + feather/invert/expand); RENDER-mag: `server/imageMask.js` geq (a videó-maszkkal
  azonos) → `imagedoc.js` alphamerge (átlátszó teljes vászon, külön `maskSeq`). UI: LayerInspector „Maszk"
  szekció (Nincs/Ellipszis/Téglalap + ✏️ Lasszó + lágy-él/terjesztés/invert); a **lasszó-szelekció → poligon
  maszk** a kijelölt rétegre (ImageStudioBody `maskTargetId`+`commitLasso` ág). *ÉLŐ-BIZONYÍTVA (/imagedoc):
  ellipszis közép=kék/sarok=fehér; poligon-háromszög belül=kék/kívül=fehér; invert fordítva; mind HTTP 200.*
  (preview: a render az autoritatív — a maszk a renderben pontos; per-réteg korrekció-maszk ⬜)
- [x] ✅ **Kijelölés-alapú (lokális) korrekció** — `PhotoLayer.localAdjust { mask, grade?, adjust? }`: a grade/adjust
  CSAK a maszk-régión BELÜL hat (a maszkon kívül az eredeti). Render: a box-méretű prepared két példánya
  (eredeti + korrigált), a korrigált alfája = (saját alfa × box-lokális maszk-szürke) → az eredeti fölé overlay
  (`imageMask.maskToBox` transzformál vászon→doboz); LayerInspector szekció (Be/Nincs + Ellipszis/Téglalap/✏️
  Lasszó + grade-chipek + expozíció/kontraszt/telítettség + lágy-él/invert); a ✏️ Lasszó a `localAdjust.mask`-ot
  írja (`maskTarget.target='local'`). *ÉLŐ-BIZONYÍTVA (/imagedoc, kék fotó, ellipszis): lokális noir belül
  949794 (R≈G≈B)/kívül 799fc7 (kék); exposure=0.8 belül d4feff/kívül 799fc7; HTTP 200.*
- [ ] ⬜ **Él-felismerő/„objektum" kijelölés** (AI-select — a videóban a `selective` létezik, a képre hozni).

## 3. 🩹 Retusálás — 🟡 folt-javítás + dodge/burn kész, ecset-alapúak hátra
- [x] ✅ **Folt-javítás / objektum-eltávolítás (gyógyító-ecset v1)** — `PhotoLayer.heal[]` (doboz-lokális
  téglalapok); a felhasználó lasszóval körbejelöl egy foltot → a bbox doboz-lokálisra transzformálva
  (`maskTarget.target='heal'`), a render `delogo`-val a környezetéből interpolálja (`healChain`, a korrekció
  ELŐTT); LayerInspector „Folt-javítás" (✏️ Folt lasszó + Törlés + db). *ÉLŐ-BIZONYÍTVA (/imagedoc, kék fotó
  piros folttal): kontroll folt=fe0000 (piros) → heal után 799fc7 (kék, interpolált); HTTP 200.*
- [x] ✅ **Dodge/Burn (világosítás/sötétítés)** — a kész **kijelölés-alapú (lokális) korrekcióval** (§2):
  exposure/kontraszt a maszkolt régión → helyi világosítás/sötétítés (render-bizonyítva ott).
- [ ] ⬜ **Klón-bélyegző** (forrás→cél másolás) · **blur/sharpen-ecset** · festett (szabad-alakú) folt-maszk.
- [ ] 🔌 **AI-objektum-eltávolítás / inpaint** (a videó-oldali gen-média mintájára, külön worker-modell).

## 4. 🖊️ Vektor & szöveg — ✅ erős
- [x] ✅ **Vektor-toll** (bezier node: hozzáad/split/join/reverse/node-típus) + **boolean** (divide-dal) + **SVG import/export**.
- [x] ✅ **Szöveg-stílus** (gradient/kontúr/árnyék/glow — a renderben pontos) + **igazítás/elosztás**.
- [x] ✅ **Szöveg görbén (text-on-path)** a kép-stúdióban — a kész SVG-`textPath` render (`text-render.js`
  `textPathHtml`, `TextLayer.textPath {shape:arc|valley|wave|circle, curve}`) bekötve a LayerInspector szöveg-
  szekciójába (alakzat-chipek + görbület-csúszka); a render már támogatta. *ÉLŐ-BIZONYÍTVA (/imagedoc, 400² fehér
  szöveg fekete háttéren): flat↔circle különbség-átlag 6.97, flat↔arc 7.57 (0=azonos → a textPath átrendezi a
  glifeket); közép-sáv YAVG flat 35.3 → circle 25.2; mind HTTP 200.*
- [ ] ⬜ **OpenType-funkciók** (ligatúrák/alternatívák) · **toll v5** (finom node-húzás/handle-arány).
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
- [x] ✅ **Gradient-map / egyedi-színű duotone** — `PhotoLayer.gradientMap {shadow,highlight}`; a render a
  luminanciát (BT.601) a két szín közti átmenetre képezi (`gradientMapFilter` geq, alfa-megőrzéssel, a
  grade/lut UTÁN); LayerInspector toggle + két ColorField. *ÉLŐ-BIZONYÍTVA (/imagedoc, kék fotó 120/160/200,
  kék→sárga): kontroll=799fc7; duotone=989834 (≈153/153/51 — R/G fel, B le a luma szerint); HTTP 200.*
- [ ] ⬜ **Motion blur** (irányított) · további artisztikus szűrők.
- [x] ✅ **Dokumentum-szintű filmszemcse (grain)** — a TELJES kész képre (cinematic/retró finish); `ImageDoc.grain`
  + a render `noise`-t tesz a kompozit UTÁN; CanvasSheet-csúszka. *ÉLŐ-BIZONYÍTVA: grain nélkül 118..211 →
  grain 0.8-del 110..221 (tágabb tartomány = szemcse; worker-mérés).*
- [x] ✅ **Dokumentum-szintű vignetta** — a sarkokat sötétíti a TELJES kész képen (cinematic); `ImageDoc.vignette`
  + a render `vignette=angle=vign·π/3`-t tesz a kompozit UTÁN; CanvasSheet-csúszka. *ÉLŐ-BIZONYÍTVA (/imagedoc,
  fehér doc): vignetta nélkül közép+sarok `ffffff`; 0.9-del közép `ffffff` (változatlan) → sarok `121310` (majdnem
  fekete); HTTP 200.*
- [x] ✅ **Tónusgörbék (curves — RGB + csatornánként)** a fotóra — a kész `ToneCurveEditor` (videó-editor)
  bekötve az AdjustStackSheet verembe új „Görbék" (`curves`) korrekció-rétegként; a verem `adjust.curves`-be
  laposít → a render `adjustChain` ffmpeg `curves`-zel égeti (a render-út már KÉSZ volt). *ÉLŐ-BIZONYÍTVA
  (/imagedoc, fotó 121/159/199): kontroll=121/159/199; invert-görbe (0→1,1→0)=134/95/56 (≈255−bemenet);
  sötétítő (1→0.5)=60/79/100 (≈fél fényerő); mind HTTP 200.*
- [ ] ⬜ **Szintek (levels)** + **csatorna-mixer** + **szelektív szín**.
- [x] ✅ **Filmszimuláció / LUT-szerű grade a fotóra** — a videó grade-rétegével AZONOS preset-térkép
  (kiemelve `server/grades.js`-be, a `render.js` innen kéri → nincs drift; a kliens `constants/grades.ts`
  ugyanazok az id-k). `PhotoLayer.grade` (teal-orange/moody/vintage/noir/warm-film/cold/vibrant/dreamy) →
  a render split-tone eq+colorbalance láncot éget a korrekció UTÁN; LayerInspector „Filmes look" chipek.
  *ÉLŐ-BIZONYÍTVA (/imagedoc, fotó 120/160/200): none=121/159/199; noir=148/151/148 (R≈G≈B deszaturált);
  warm-film R↑ B↓ (131/…/181); cold R↓ B↑ (113/…/209); mind HTTP 200.*
- [x] ✅ **Saját `.cube` LUT-import a fotóra** — `PhotoLayer.lut` (szerkesztő-local uri) + `lutName`; a
  `media.pickCubeLut` fájl-pick + `parseCubeLut` tartalmi validálás; a `docMediaUris`+worker-remap feltölti,
  az `imagedoc.js` workDir-be másolja `.cube`-ként és `lut3d`-del égeti (a grade UTÁN); LayerInspector
  „Saját LUT (.cube)" import/csere/törlés chipek + fájlnév. *ÉLŐ-BIZONYÍTVA (/imagedoc, fotó 121/159/199):
  nincs-LUT=121/159/199; identity=121/159/199 (változatlan=beolvas+alkalmaz); invert=133/94/55 ≈ 255−bemenet;
  mind HTTP 200.*

## 6. 📐 Transzformáció — ✅ alap kész
- [x] ✅ mozgatás/skálázás/forgatás/tükrözés + **crop** + **vonalzók/segédvonalak/snap** (rulers).
- [x] ✅ **Nem-arányos nyújtás (`fit:'stretch'`)** — a fotó szabadon a keretre nyúlik (torzíthat); worker
  `scale=W:H` (aspect-megőrzés nélkül), preview `contentFit='fill'`, LayerInspector „Nyújtás" chip a
  cover/contain mellé. *ÉLŐ-BIZONYÍTVA (/imagedoc, 64×64 fehér marker 128², vászon 256×128, marker-aláírás
  P1(180,64)/P2(128,10)): cover=ff/ff; contain=00/00; stretch=ff/00 (egyedi → 2:1 vízszintes nyújtás); HTTP 200.*
- [x] ✅ **Perspektíva / 3D-dőlés** (`PhotoLayer.perspectiveX/Y` −1…1) — a render ffmpeg `perspective`-vel
  égeti (átlátszó kerettel paddol → az OOB terület ÁTLÁTSZÓ, a háttér átlátszik), a preview 3D rotateX/Y-nal
  közelít; LayerInspector két csúszka (↔/↕). *ÉLŐ-BIZONYÍTVA (/imagedoc, kék fotó zöld háttéren): X=0 minden
  sarok 799fc7 (kék); X=1 jobb sarkok 00ff01 (zöld háttér átlátszik), bal-felső+közép 799fc7; HTTP 200.*
- [ ] ⬜ **Skewer/szabad-warp (rács)** · **tartalom-tudatos skálázás**.
- [x] ✅ **Igazítás okos-segédvonalakkal** (smart-guides) — lásd §8 (`snapToLayers`): a mozgatott réteg a többi
  réteg közép/éleihez + a vászonhoz pattan, magenta jelző-vonallal. *BIZONYÍTVA: smartGuides pure teszt (4).*

## 7. 📤 Export & megosztás — ✅ gazdag
- [x] ✅ **Raszter** (PNG/JPG/WebP + 1×/2× + minőség) · **SVG** · **PDF** · **beszúrás videóba**.
- [x] ✅ **Többlapos galéria** → **diavetítés-videó** / **lapozható carousel** megosztás a feedbe.
- [ ] 🔌 **PSD import/export** (réteg-megőrzéssel) · **batch-export** · **export-presetek** (platform-méretek).

## 8. 🧭 UX-paritás a profi szerkesztőkkel — 🟡
- [ ] 🟡 **Vászon-zoom/pan** (pinch + két-ujj pan) + **fit/100%** — ma korlátos (az audio-transport kapott zoomot, a kép nem).
- [x] ✅ **History-panel** (vizuális undo-lépések) — a store-ba `pastLabels`/`futureLabels` címke-vermek (a
  parancs `label`-je vagy `describeCommand`, a past/future-rel lépésenként igazítva) + `jumpHistory(delta)`;
  `HistorySheet` kronológikus lépés-lista (Kiindulás → lépések → újra-elérhetők), a jelenlegi kiemelve, bármely
  lépésre koppintva odaugrik; felső-sor „idő" gomb nyitja. *BIZONYÍTVA: store-teszt (2) — dispatch→pastLabels,
  undo/redo lépésenkénti címke-mozgatás, jumpHistory(±n) = n undo/redo a vermekkel együtt; 32 suite-teszt zöld.*
  (snapshot/nevezett verziók ⬜)
- [x] ✅ **Vászon-zoom/pan** (nézegetős) — `src/lib/canvasZoom.ts` pure mag (clampZoom/zoomStep/clampPan/
  canvasTransform, 1–6×) + ImageCanvas: a tartalom scale+translate transzformmal nagyítódik, zoom-gombok
  (+/−/1:1) jobb-fönt, zoom>1-nél pan-overlay (PanResponder) viszi a nézetet. BIZTONSÁGOS: a szerkesztés
  1:1-nél marad (zoom>1 → az overlay elnyeli a gesztust, a SelectionFrame rejtve → a húzás/hit-test
  koordináta-tere sértetlen), a capture/raszterizálás érintetlen (a transzform `!capturing`-gel gated).
  *BIZONYÍTVA: canvasZoom pure teszt (4) — clamp/lépés/pan-határ/transzform; audit 205/2135 zöld. A gesztus-érzet
  eszközön verifikálandó (nem render-mérhető).*
- [x] ✅ **Smart-guides** (dinamikus igazodás a többi réteghez) — `src/lib/smartGuides.ts` pure mag
  (`snapToLayers`): a mozgatott réteg közép/élei a többi réteg közép/éleihez + a vászon közepéhez/széleihez
  pattannak (0–1 térben, küszöb); ImageCanvas `move` a kézi guide-ok UTÁN ezt alkalmazza, + rövid magenta
  jelző-vonal-felvillanás a pattintott tengelyen. *BIZONYÍTVA: smartGuides pure teszt (4) — vászon-közép-snap,
  küszöb-kívül nincs, center-to-center + él-igazítás; audit 206/2139 zöld.*
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
