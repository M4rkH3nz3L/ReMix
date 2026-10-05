# 🎬 06. Video Editor (NLE) — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §6. · **Testvér:** [11-performance](./11-performance.md) (timeline), [12-code-quality](./12-code-quality.md) (command/asset-refactor), [09-native](./09-native-rendering.md) (render-backend).
> **Érintett kód:** [src/lib/commands.ts](../../src/lib/commands.ts) · [src/store/editorStore.ts](../../src/store/editorStore.ts) · [src/lib/keyframes.ts](../../src/lib/keyframes.ts) · [src/lib/frames.ts](../../src/lib/frames.ts) · [src/components/preview/](../../src/components/preview/) · [server/index.js](../../server/index.js) (render).

---

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
- [ ] 🎞️ Rotation + opacity channel + **Bézier-interpoláció a teljes render-pipeline-ban** + preview/render parity.

### 2.2 Profi color grading — P1
- [ ] 🎞️ RGB curves + HSL + **3-way color wheels** + scopes-workflow + **LUT teljes alkalmazási pipeline** + render-parity.

### 2.3 Freeze frame + reverse — P1
- [x] ✅ **Freeze-frame** — MÁR KÉSZ (`@/lib/freeze.ts` `buildFreezePlan` + a SpeedPanel „Freeze" gombja: a lejátszófejnél állókockát szúr be kép-klipként, a hang tovább szól).
- [x] ✅ **Reverse** — a klip visszafelé játssza a forrást: `VideoClip.reversed` mező + `sourceTimeAt` tükrözés (preview) + SpeedPanel „⏪ Visszafelé" kapcsoló + worker-render `reverse`/`areverse` filter (`render.js` `segSourceWindow`, `clip.reversed`-re guardolva → normál klip bitre változatlan filter-lánc = zéró regresszió). Teszt: `projectUtils.test.ts` (sourceTimeAt reverse) + `render.test.js` (segSourceWindow tükör-ablak). ⚠️ Export-FFmpeg runtime-verify (live worker) + a transition/pip render-path-ok reverse-fallbackje a követő lépés.

### 2.4 Animated masks — P1
- [ ] 🎞️ Animált geometria (expansion/contraction) + **tracking-integráció** + render-parity.

### 2.5 Effect chain — P1
- [ ] ⬜ Klipenként **sorrendfüggő** effekt-lánc (`Effect 1→2→3→Transition`) — nem egyetlen filter.

### 2.6 Transform — P1
- [x] ✅ **crop + perspektíva** MÁR KÉSZ (`VideoClip.crop`, a render perspektíva-filtere / 3D-tilt). (Az audit `main`-je elavult.)
- [~] 🟡 **anchor-point + skew** — folyamatban (több-commit):
  - [x] Modell: `CanvasTransform.anchorX/Y` (pivot 0–1) + `skewX/Y` (fok) — additív, backward-compat.
  - [x] Pure mag + teszt: [src/lib/canvasTransform.ts](../../src/lib/canvasTransform.ts) (`transformOrigin`, `skewTransformEntries`, `shearPoint`/`skewUnitCorners` a render sarok-warpjához), `canvasTransform.test.ts` (12).
  - [x] Preview: [PreviewSurface](../../src/components/preview/PreviewSurface.tsx) `transformOrigin` + RN-skew (guardolva → mai klip változatlan).
  - [ ] ⬜ Render: FFmpeg skew a perspektíva-sarok-warppal (`skewUnitCorners`) + anchor-pivot (guardolt, runtime-verify).
  - [ ] ⬜ UI: transform-panel anchor/skew vezérlők.

### 2.7 Profi audio UI — P1
- [ ] 🖼️ Audio-mixer core kész → UI: **EQ/compressor/limiter/pan/normalize/noise-hum/sidechain/automation**.

### 2.8 GIF — P1
- [ ] ⬜ GIF import + animált preview + timeline + render.

### 2.9 Proxy / performance engine — P1
- [ ] 🟡 Proxy-alap van → ⬜ **background proxy-generálás + lifecycle + render-cache + invalidation + size-mgmt + storage-policy**.

### 2.10 Editor architecture refactor — P1 (alap)
- [ ] ⬜ **`uri → assetId`** + minden mutáció a **Command Bus**-on (collab/undo/AI/cloud-sync alapja — lásd [12](./12-code-quality.md)).

### 2.11 Creative Canvas — P1/P2
- [ ] ⬜ crop/resize/perspective-crop/outpaint/retouch/advanced-tracking/depth-aware-occlusion.

## 3. Kész, ha
Egy klipre **keyframe + color + mask + effect-lánc + transform** alkalmazható, és a **preview
pixel-pontosan egyezik az exporttal**; freeze/reverse + GIF megy; a profi audio-UI vezérli a
mixer-magot; a proxy-engine nagy médián is folyékony; minden módosítás command-buson undo-zható.
