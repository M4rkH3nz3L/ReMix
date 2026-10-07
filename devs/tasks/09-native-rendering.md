# ⚙️ 09. Native / Rendering — P3 (platform-expanzió)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §9. · **Testvér:** [06-video-editor](./06-video-editor.md) (render-parity), [05-ai](./05-ai.md) (on-device-AI), [01-production](./01-production-go-live.md) (worker).
> **Érintett kód:** [NATIVE.md](./NATIVE.md) (**élő** natív render-motor terv + fázisok A–E) · `modules/remix-render/` (natív modul) · [src/components/preview/](../../src/components/preview/) · [server/](../../server/) (ONNX/vision).

---

> **📊 Haladás (2026-10-06):** ✅ 0 · 🟡 0 · ⬜ 6 nyitva — Σ 6 tétel. **P3 platform-expanzió —
> nincs launch-blokkoló.** Az iOS AVFoundation-render v1 kész (a natív-motor körben); itt minden
> tétel nyitva (Skia / natív-FFmpeg / on-device-ONNX / desktop-shell / generatív / watchOS).

## 0. Kontextus & cél
Platform-expanzió: a mobil-preview/render hosszú távú motorja + a desktop + a generatív AI.
Többségük **P3** (nem launch-blokkoló), de a natív render-motor + Skia a profi NLE-élmény alapja.

## 1. Jelenlegi állapot (bizonyíték)
- Szerveres ONNX/vision létezik; a natív render-motor terv (`NATIVE.md`) 3-szintű (Preview/Local/
  Cloud); iOS AVFoundation-motor v1 kész, az Android MediaCodec-eszköz-render a fő tech-hiány.
- Chromium-alapú text/shape-render megy, de mobil-preview-re nem ideális.

## 2. Feladatlista

### 2.1 Skia render backend — P3
- [ ] ⬜ Skia-alapú text/shape/preview-pipeline a Chromium helyett (mobil-perf + parity).

### 2.2 Native FFmpeg / on-device render-motor — P2/P3
- [x] ~ **iOS AVFoundation v1 KÉSZ** + **Android trivial-copy** (1 változatlan klip) — a részletes
  fázisterv (A–E) + a kész/hátra az **[NATIVE.md](./NATIVE.md)**-ben (a render-motor külön, élő todo-ja).
- [ ] 🔴 **Android MediaCodec-motor** (a #1 tech-hiány): Fázis A (remux vágással) → B (transzkód: vászon/speed/filter)
  → C (multi-segment + hang-mix, iOS-paritás) → D (cancel/robusztus) → E (codec). Emulátoron verifikálható.
- [ ] ⬜ iOS: valódi cancel + fejlett effektek beégetése (paritás).

### 2.3 On-device ONNX — P2/P3
- [ ] ⬜ Mobil ONNX-runtime (szegmentálás/mélység/upscale on-device) — lásd [05](./05-ai.md) §2.9.

### 2.4 Desktop shell — P3
- [ ] ⬜ Tauri/Electron (vagy natív) — „telefonon és gépen ugyanaz az editor".

### 2.5 AI avatar / voice-clone / video-gen — P2/P3
- [ ] ⬜ Generatív feature-ök; **voice-clone kötelező:** consent + identity-verification + abuse-prevention + watermark/provenance.

### 2.6 watchOS — opcionális
- [ ] ⬜ Nem launch-blokkoló; csak ha van rá termék-igény.

## 3. Kész, ha
A mobil-preview Skia-motoron fut (parity-vel), a local-render natív pipeline-on megy, az on-device
AI elérhető, és (opcionálisan) a desktop-shell ugyanazt az editort adja. A generatív feature-ök
csak **provenance + consent + abuse-védelem** mellett élesek.
