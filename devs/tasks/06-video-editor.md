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
- [ ] ⬜ Freeze-frame (hold) + **reverse** klip (worker-render + preview).

### 2.4 Animated masks — P1
- [ ] 🎞️ Animált geometria (expansion/contraction) + **tracking-integráció** + render-parity.

### 2.5 Effect chain — P1
- [ ] ⬜ Klipenként **sorrendfüggő** effekt-lánc (`Effect 1→2→3→Transition`) — nem egyetlen filter.

### 2.6 Transform — P1
- [ ] 🟡 Hiány: **anchor-point + crop + skew + perspective** transform.

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
