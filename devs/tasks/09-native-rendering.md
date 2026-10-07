# ⚙️ 09. Native / Rendering — P3 (platform-expanzió)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §9. · **Testvér:** [06-video-editor](./06-video-editor.md) (render-parity), [05-ai](./05-ai.md) (on-device-AI), [01-production](./01-production-go-live.md) (worker).
> **Érintett kód:** [NATIVE.md](./NATIVE.md) (**élő** natív render-motor terv + fázisok A–E) · `modules/remix-render/` (natív modul) · [src/components/preview/](../../src/components/preview/) · [server/](../../server/) (ONNX/vision).

---

> **📊 Haladás (2026-10-07):** ✅ 0 · 🟡 1 · ⬜ 3 nyitva — Σ 4 tétel. **P3 platform-expanzió —
> nincs launch-blokkoló.** A natív render-motor (§2.2) 🟡: iOS AVFoundation v1 kész + **Android
> Fázis A + B + C teljes (iOS-paritás)** (remux + GL-transzkód + multi-segment kompozit + hang-mix, 6 emulátor-teszt) — részletek: [NATIVE.md](./NATIVE.md). A többi nyitva
> (Skia / on-device-ONNX / generatív). **Céleszközök: Android telefon+tablet, iPhone+iPad** —
> desktop és watchOS **kivéve** (nincs termék-igény).

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
- [x] ~ **iOS AVFoundation v1 KÉSZ** + **Android Fázis A + B + C KÉSZ (iOS-paritás)** — részletek + a hátralévő fázisok: **[NATIVE.md](./NATIVE.md)**.
- [x] ~ **Android MediaCodec-motor — A (remux) + B (GL-transzkód: skálázás/sebesség/szűrő) + C (multi-segment kompozit + N-sávos hang-mix) KÉSZ**,
  6 instrumentált emulátor-teszttel verifikálva. **Hátra:** D (valódi cancel/robusztus/foreground) → E (codec/HEVC).
- [ ] ⬜ iOS: valódi cancel + fejlett effektek beégetése (paritás).

### 2.3 On-device ONNX — P2/P3
- [ ] ⬜ Mobil ONNX-runtime (szegmentálás/mélység/upscale on-device) — lásd [05](./05-ai.md) §2.9.

### 2.5 AI avatar / voice-clone / video-gen — P2/P3
- [ ] ⬜ Generatív feature-ök; **voice-clone kötelező:** consent + identity-verification + abuse-prevention + watermark/provenance.

## 3. Kész, ha
A mobil-preview Skia-motoron fut (parity-vel), a local-render natív pipeline-on megy, az on-device
AI elérhető, és (opcionálisan) a desktop-shell ugyanazt az editort adja. A generatív feature-ök
csak **provenance + consent + abuse-védelem** mellett élesek.
