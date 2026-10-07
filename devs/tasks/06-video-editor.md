# 🎬 06. Video Editor (NLE) — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §6. · **Testvér:** [11-performance](./11-performance.md) (timeline), [12-code-quality](./12-code-quality.md) (command/asset-refactor), [09-native](./09-native-rendering.md) (render-backend).
> **Érintett kód:** [src/lib/commands.ts](../../src/lib/commands.ts) · [src/store/editorStore.ts](../../src/store/editorStore.ts) · [src/lib/keyframes.ts](../../src/lib/keyframes.ts) · [src/lib/frames.ts](../../src/lib/frames.ts) · [src/components/preview/](../../src/components/preview/) · [server/index.js](../../server/index.js) (render).

---

> **📊 Haladás (2026-10-07):** ✅ 4 teljes · 🟡 4 mag kész · ⬜ 3 nyitva — Σ 11 tétel.
> Keyframe / color / animated-mask / **effect-chain** / freeze+reverse kész (preview↔render parity;
> a vizuális kimenet élő-ffmpeg-gel verifikálandó) + a **projekt forrás-mappa** a Toolbaron (§2.10).
> Hátra: profi **audio-UI** (§2.7), GIF-dekód+render (§2.8), proxy-engine (§2.9) és a teljes **uri→assetId** refaktor (§2.10).

## 0. Kontextus & cél
Ez a legfontosabb terület, ha a cél **Premiere/CapCut-szintű mobil NLE**. Sok mag kész, de a
**preview↔render parity** + a professzionális effekt/szín/mask/transform réteg hiányos. Vezérelv:
**minden módosítás command-buson**, és **Preview == Export**.

## 1. Jelenlegi állapot (bizonyíték)
- Multi-track timeline, trim/split/duplicate/undo-redo, speed, captions, filters, transitions-modell,
  masks, keyframe-core + graph-editor, curves, scopes, LUT-import core, audio-mixer core.
- Hiány: render-parity több helyen, effect-chain, freeze/reverse, animated-mask-render, profi
  color/transform/audio-UI, GIF, proxy-engine, `uri→assetId` refaktor.

## 2. Feladatlista

### 2.1 Keyframe rendszer — P1
- [x] ✅ MÁR KÉSZ (az audit `main`-je elavult): `KEYFRAME_CHANNELS = scale/x/y/**rotation**/**opacity**/volume` ([keyframes.ts](../../src/lib/keyframes.ts)) + **Bézier-easing** (`bezierEase` + `PRESET_BEZIER`; a render finom lineáris al-kulcskockákra „süti" → parity). A render a rotation/opacity-csatornát per-frame alkalmazza (`appearanceChain` rotate-kf + geq-alfa). Hátra: csak további csatornák (pl. per-effekt amount-kf) ha kell.

### 2.2 Profi color grading — P1
- [x] ~ **Nagyrészt KÉSZ**: RGB **curves** (ToneCurveEditor) + **HSL** (`hue`/`hslSaturation`/`hslLuminance`) + **tone** (highlights/shadows/whites/blacks) + temperature/tint/vibrance/saturation + **scopes** (ScopesView) + **LUT** import/export + apply (grade-pipeline a renderben). (Az audit `main`-je elavult.)
- [ ] ⬜ Hátra: dedikált **3-way color wheels** UI (shadows/mids/highlights színkerék → a meglévő adjust-mezőkre képezve) — kozmetikai, az alatta lévő grading már megvan.

### 2.3 Freeze frame + reverse — P1
- [x] ✅ **Freeze-frame** — MÁR KÉSZ (`@/lib/freeze.ts` `buildFreezePlan` + a SpeedPanel „Freeze" gombja: a lejátszófejnél állókockát szúr be kép-klipként, a hang tovább szól).
- [x] ✅ **Reverse** — a klip visszafelé játssza a forrást: `VideoClip.reversed` mező + `sourceTimeAt` tükrözés (preview) + SpeedPanel „⏪ Visszafelé" kapcsoló + worker-render `reverse`/`areverse` filter (`render.js` `segSourceWindow`, `clip.reversed`-re guardolva → normál klip bitre változatlan filter-lánc = zéró regresszió). Teszt: `projectUtils.test.ts` (sourceTimeAt reverse) + `render.test.js` (segSourceWindow tükör-ablak). ⚠️ Export-FFmpeg runtime-verify (live worker) + a transition/pip render-path-ok reverse-fallbackje a követő lépés.

### 2.4 Animated masks — P1
- [x] ✅ MÁR KÉSZ (az audit `main`-je elavult): animált maszk-geometria kulcskockákkal (rotoszkóp — `maskAnim` `addMaskKeyframe`/`sampleMaskAt`/`maskKeyframeTimes`) + **tracking** (`trackMaskToSubject`/`trackMaskToFace` a FilterPanel-ben) + expand/feather/opacity + render-parity. Hátra: finomítás ha kell.

### 2.5 Effect chain — P1 (folyamatban, több-commit)
Klipenként **sorrendfüggő** effekt-lánc (`clip.effects[]`) — nem egyetlen filter. Additív: a
meglévő megjelenés-lánc (filter/adjust/lut) UTÁN fut → a mai klipek változatlanok.
- [x] ✅ **Mag + modell + teszt**: `VideoClip/ImageClip.effects?: VideoEffect[]` ([project.ts](../../src/types/project.ts)) + [src/lib/videoEffects.ts](../../src/lib/videoEffects.ts) (katalógus: blur/sharpen/vignette/grain/grayscale/sepia/invert + immutábilis add/remove/**move(reorder)**/toggle/setAmount/resolve + `effectFilterString`/`effectChainFilters` FFmpeg-leképezés). Teszt: `videoEffects.test.ts` (11) — oper-ek + filter-string. A szerkesztés `UPDATE_CLIP` patch-csel (undo-zható).
- [x] ✅ **Render-bekötés**: [render.js](../../server/render.js) `effectChainFx` (a kliens `effectFilterString`-gel AZONOS filter-stringek — külön tesztelt: `render.test.js`) az `appearanceChain` UTÁN, mind a 4 render-helyen, **guardolva** (üres lánc = a megjelenés-lánc bitre változatlan → zéró regresszió). ⚠️ Runtime-verify: a vizuális kimenet élő ffmpeg-gel (itt nincs render-worker).
- [x] ✅ **UI**: [FilterPanel](../../src/components/editor/panels/FilterPanel.tsx) „🎛️ Effekt-lánc" szekció — hozzáadás a katalógusból (`+ Blur`…) + lánc-lista ↑/↓ átrendezéssel, név-koppintásra ki/be (`⦸`), ✕ törlés, parametrikus effektekhez amount-Stepper. A tesztelt `videoEffects` oper-eit (`addEffect`/`moveEffect`/`toggleEffect`/`setEffectAmount`/`removeEffect`) hívja `UPDATE_CLIP`-en.

**Kész:** az effect-chain mag + render + UI kész. A filter-stringek kliens==worker **contract-teszttel bizonyítva** ([src/lib/contract.test.ts](../../src/lib/contract.test.ts) — minden típus×amount + a null-amount védelmi ág; a worker null-default fix 0.5-ről per-típus `EFFECT_DEFAULT_AMOUNT`-ra igazítva, a kliens `VIDEO_EFFECTS`-hez kötve). A vizuális render-kimenet továbbra is élő ffmpeg-gel verifikálandó.

### 2.6 Transform — P1
- [x] ✅ **crop + perspektíva** MÁR KÉSZ (`VideoClip.crop`, a render perspektíva-filtere / 3D-tilt). (Az audit `main`-je elavult.)
- [~] 🟡 **anchor-point + skew** — folyamatban (több-commit):
  - [x] Modell: `CanvasTransform.anchorX/Y` (pivot 0–1) + `skewX/Y` (fok) — additív, backward-compat.
  - [x] Pure mag + teszt: [src/lib/canvasTransform.ts](../../src/lib/canvasTransform.ts) (`transformOrigin`, `skewTransformEntries`, `shearPoint`/`skewUnitCorners` a render sarok-warpjához), `canvasTransform.test.ts` (12).
  - [x] Preview: [PreviewSurface](../../src/components/preview/PreviewSurface.tsx) `transformOrigin` + RN-skew (guardolva → mai klip változatlan).
  - [x] UI: [PrecisionPanel](../../src/components/editor/panels/PrecisionPanel.tsx) „appearance" szekció — skewX/Y + pivot (anchor) X/Y Stepperek. **Preview-ben teljesen használható.**
  - [x] ✅ **Skew render**: [render.js](../../server/render.js) KÜLÖN `skewChain` pass (a `tiltChain`-t NEM érinti → bizonyított tilt-render változatlan, zéró regresszió), a kliens `shearPoint`-jával AZONOS matekkal + a `tiltChain` perspektíva-filter-mintájával; `padW/padH` `skewGrow`-val (ne vágódjon le). Guardolt (skew nélkül nincs pass). Szintaxis OK + audit zöld. ⚠️ **Runtime-verify**: a vizuális helyesség élő ffmpeg-gel igazolandó (itt nincs render-worker+ffmpeg).
  - [ ] ⬜ **Anchor-pivot render** (follow-up): a rotate-filter középpont-pivot; az anchor-pivot translate-rotate-translate — preview-ben már jó, a renderhez külön óvatos lépés.

### 2.7 Profi audio UI — P1
- [ ] 🖼️ Audio-mixer core kész → UI: **EQ/compressor/limiter/pan/normalize/noise-hum/sidechain/automation**.

### 2.8 GIF — P1
- [x] ✅ **GIF-időzítés mag KÉSZ (2026-10-06)**: [src/lib/gifTiming.ts](../../src/lib/gifTiming.ts) — a master-óra playheadjéből (AGENTS.md: minden réteg a playheadből számol) `frameIndexAt` (a megjelenítendő kocka a változó kocka-késleltetésekből, loop-aware: loop=true ciklus, loop=false az utolsó kockán áll) + `gifDuration` + `loopCountAt`; a 0/negatív/NaN késleltetés a GIF-konvenció szerint 100 ms. Teszt: `gifTiming.test.ts` (7).
- [ ] 🔌🖼️ Hátra: a GIF **dekódolás** (natív, kocka-késleltetések kinyerése) + import + a preview-réteg a `frameIndexAt`-tel + timeline + render (ffmpeg).

### 2.9 Proxy / performance engine — P1
- [ ] 🟡 Proxy-alap van → ⬜ **background proxy-generálás + lifecycle + render-cache + invalidation + size-mgmt + storage-policy**.

### 2.10 Editor architecture refactor — P1 (alap)
- [x] ~ **Projekt forrás-mappa (asset-bin) KÉSZ (2026-10-07)** — részlépés az asset-architektúra felé: a `project.assets` köré egységes forrás-bin ([projectSource.ts](../../src/lib/projectSource.ts) + [SourceSheet](../../src/components/SourceSheet.tsx)), a videó-editor Toolbarján is (forrás→idővonal), minden mutáció a **command-buson** (`ADD_ASSET`/`REMOVE_ASSET`). Lásd [08](./08-storage.md) §2.8.
- [ ] ⬜ Hátra: a teljes **`uri → assetId`** átállás (a klipek asset-id-t hivatkozzanak, ne nyers uri-t) — a collab/undo/AI/cloud-sync alapja (lásd [12](./12-code-quality.md)).

### 2.11 Creative Canvas — P1/P2
- [ ] ⬜ crop/resize/perspective-crop/outpaint/retouch/advanced-tracking/depth-aware-occlusion.

## 3. Kész, ha
Egy klipre **keyframe + color + mask + effect-lánc + transform** alkalmazható, és a **preview
pixel-pontosan egyezik az exporttal**; freeze/reverse + GIF megy; a profi audio-UI vezérli a
mixer-magot; a proxy-engine nagy médián is folyékony; minden módosítás command-buson undo-zható.
