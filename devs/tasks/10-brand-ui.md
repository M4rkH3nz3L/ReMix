# 🎨 10. Brand / UI — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §10. · **Testvér:** [11-performance](./11-performance.md) (motion), [04-social](./04-social.md) (feed/player screens).
> **Érintett kód:** [src/constants/editor.ts](../../src/constants/editor.ts) (`palette`) · [src/lib/designSystem.ts](../../src/lib/designSystem.ts) · [src/components/](../../src/components/) · [src/app/](../../src/app/) (screens).

---

> **📊 Haladás (2026-10-06):** ✅ 0 teljes · 🟡 2 mag kész (token/logo részleges) · ⬜ 6 nyitva — Σ 8 tétel.
> Design-tokenek + logo-assetek megvannak (részleges fedés); az **egységes komponens-készlet** (§2.2),
> a **loading/error/empty-rendszer** (§2.6), a motion-skála és az **a11y** nyitva.

## 0. Kontextus & cél
A brand + UI részben kész (design-tokenek + logo-assetek), de nincs **egységes component-library**,
nincs **állapot-rendszer** (loading/error/empty), nincs **motion-rendszer**, és az accessibility
hiányos. Cél: egy koherens, akadálymentes, „ReMix" arculatú felület a teljes appon át.

## 1. Jelenlegi állapot (bizonyíték)
- Design-tokenek (`palette`, designSystem) + logo-assetek vannak; sok képernyő egyedi stílussal épül.
- Hiány: egységes komponens-készlet, remix signature transition, teljes screen-redesign,
  loading/error/empty/offline rendszer, motion-skála, a11y.

## 2. Feladatlista

### 2.1 Unified design token system — P1
- [ ] 🟡 Minden UI a tokenekből épüljön (spacing/radius/typography/color scale) — a token-fedés kiterjesztése.

### 2.2 Component library — P1
- [ ] 🟡 Egységes: Text/Button/Surface/Chip/Sheet/Toast/Skeleton/VideoCard/CreatorCard/Badge.

### 2.3 Remix signature transition — P1
- [ ] ⬜ Saját átmenet: chromatic-split + blur + scale + **haptic** + **sound** (a remix-élmény védjegye).

### 2.4 Unified logo / icon system — P1
- [ ] 🟡 Logo-assetek megvannak → ⬜ teljes `RemixIcon`/icon-rendszer végigvezetése.

### 2.5 Teljes screen redesign — P1
- [ ] ⬜ Feed/ForYou/Player/Editor/Timeline/Export/Profile/Discover/Comments egységes redesign.

### 2.6 Loading / error / empty state system — P1 (prod-UX)
- [ ] ⬜ Minden async képernyőnek: `loading / success / empty / error / retry / offline`.

### 2.7 Motion system — P1
- [ ] ⬜ Duration + easing skála + **reduced-motion** + gesture- és screen-transition-rendszer.

### 2.8 Accessibility — P1
- [ ] ⬜ 44pt touch-target + a11y-label + screen-reader + kontraszt + focus-state + dynamic-text + reduced-motion.

## 3. Kész, ha
A teljes app egy **egységes komponens-készletből + tokenekből** épül, minden async felületnek van
loading/empty/error/offline állapota, a mozgások egy motion-skálából jönnek (reduced-motion
támogatással), és az app **akadálymentes** (targets/labels/kontraszt/screen-reader).
