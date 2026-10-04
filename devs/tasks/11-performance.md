# 🚀 11. Performance — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §11. · **Testvér:** [06-video-editor](./06-video-editor.md) (timeline/proxy), [12-code-quality](./12-code-quality.md) (event-log/cache).
> **Érintett kód:** [src/store/editorStore.ts](../../src/store/editorStore.ts) · [src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts) · [src/components/preview/](../../src/components/preview/) · timeline-komponensek · `projectDuration` ([src/lib/](../../src/lib/)).

---

## 0. Kontextus & cél
A timeline + preview + auto-version a legérzékenyebb teljesítmény-pontok (hosszú timeline, 4K
média, gyenge eszköz). Cél: 60 Hz-es, akadásmentes szerkesztés + minimális felesleges munka.

## 1. Jelenlegi állapot (bizonyíték)
- rAF-mesteróra hajtja a lejátszást; a store sok komponenst újrarajzolhat szerkesztéskor.
- Hiány: selector-finomhangolás, duration-cache, auto-version-optimalizáció, player-write-csökkentés, lusta HistoryModal.

## 2. Feladatlista

### 2.1 Timeline 60 Hz reconciliation — P1
- [ ] ⬜ Selector-subscription (szűk store-szeletek) + imperatív scroll + **memoized** ruler/beat-markers/gaps.

### 2.2 projectDuration cache — P1
- [x] ✅ MÁR KÉSZ: `WeakMap<Project, number>` memoizáció ([projectUtils.ts](../../src/lib/projectUtils.ts) `durationCache`) — a command-bus új objektumot ad → automatikus invalidáció. Tesztelt (`projectUtils.test.ts`). (Az audit `main`-je elavult volt.)

### 2.3 Auto-version optimalizáció — P1
- [ ] ⬜ A throttle **előtti** felesleges storage-read megszüntetése.

### 2.4 Preview player writes — P1
- [ ] ⬜ A per-frame player/audio-state írás csökkentése (iPhone/Android, hosszú timeline, 4K).

### 2.5 HistoryModal lusta mount — P1
- [ ] ⬜ A history-modal ne legyen mindig mountolva (csak nyitáskor).

## 3. Kész, ha
Hosszú timeline + 4K média mellett is **60 Hz-es** a szerkesztés; a duration cache-elt; az
auto-version nem olvas feleslegesen; a player-írások minimalizáltak; a nehéz modálok lustán mountolnak.
(Mérés: JS-FPS + re-render-count előtte/utána.)
