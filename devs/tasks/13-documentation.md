# 📚 13. Documentation / Engineering — P2

> **Forrás:** [audit](../source/audit-2026-10-main.md) §13, §20. · **Testvér:** minden epik (ez a réteg köti össze), [01-production](./01-production-go-live.md) (cost-observability).
> **Érintett kód:** `devs/` (ez a mappa) · a git-history `docs/hu/` architektúra-doksik + ADR-ek · [server/](../../server/)+[src/lib/](../../src/lib/) (contract-sémák).

---

> **📊 Haladás (2026-10-06):** ✅ 0 teljes · 🟡 1 mag kész · ⬜ 5 nyitva — Σ 6 tétel.
> A kliens/worker **contract-teszt ALAP megvan** (§2.4 — a mirror-drift-zár, lásd
> [01](./01-production-go-live.md) §2.7); az ADR-sync, az architektúra-diagramok (Mermaid),
> a teljes séma-validáció és a **cost-dashboard** nyitva.

## 0. Kontextus & cél
A mérnöki fegyelem (ADR + architektúra-sync + diagramok + **contract-tesztek** + **cost-
observability**) az, ami a nagy kódbázist karbantarthatóvá + üzletileg skálázhatóvá teszi.

## 1. Jelenlegi állapot (bizonyíték)
- ADR 001–010 + rétegdokumentáció létezik (git-history `docs/hu/`); sok doksi nincs a kóddal syncelve.
- **Nincs:** architektúra-diagramok (Mermaid), cost-dashboard. A kliens/worker **contract-teszt
  ALAP megvan** (mirror-drift-zár, 2026-10-06 — lásd [01](./01-production-go-live.md) §2.7); a
  teljes séma-validáció hátra.
- ⚠️ A `MISSING.md` nem végleges truth-source — több pontja elavult (StorageProvider, Drive/
  Dropbox/WebDAV/S3, `.remix`, retry-infra, SVG-import, LUT-core).

## 2. Feladatlista

### 2.1 ADR discipline — P2
- [ ] 🟡 ADR 001–010 van → minden új architektúra-döntéshez **új ADR** (a Live/egress/VOD-döntések visszamenőleg is).

### 2.2 Architecture docs sync — P2
- [ ] 🟡 A rétegdoksit a **kódhoz igazítani** (StorageProvider-valóság, retry-infra, stb.). A `.vided`→`.remix` konvenció-egységesítés KÉSZ (2026-10-07, lásd [08](./08-storage.md) §2.5).

### 2.3 Architecture diagrams — P2
- [ ] ⬜ **Mermaid**: `Mobile → API → Supabase → Queue → Workers → Storage/CDN`, külön editor/AI/collab/render/storage.

### 2.4 Client/worker contract tests — P1 (fontos)
- [x] ✅ **ALAP KÉSZ (2026-10-06)**: mirror-drift-zár [src/lib/contract.test.ts](../../src/lib/contract.test.ts) — a kliens-jest MINDKÉT oldalt importálja (TS + worker-JS) és egyenlőséget állít a drift-veszélyes tükrökre (`TIER_QUOTAS`/usage + effekt-filterek, minden típus×amount); fut a `npm run audit`-ban (CI). Kiszúrt+javított egy null-amount paritás-hibát. Részletek: [01](./01-production-go-live.md) §2.7.
- [ ] 🟡 **Hátra**: `/request //response //error //status` teljes **séma-validáció** (OpenAPI / JSON Schema) a CI-ben + a maradék mirror-ök bekötése (render-form, `canvasTransform` skew, keyframe-easing).

### 2.5 Cost observability — P1
- [ ] ⬜ Dashboard: `revenue − (render + storage + AI + bandwidth) = margin`; forrás: R2/S3 + Supabase + Redis + AI + render + CDN + RevenueCat.

### 2.6 Truth-source audit (következő lépés) — P1
- [ ] ⬜ A ~105 tételt **egyenként** összevetni a forráskóddal (kód→UI→backend→worker→DB→teszt), és végleges státuszt adni (`DONE/PARTIAL/MOCK/UI-MISSING/BACKEND-MISSING/RENDER-MISSING/NOT-IMPL`) + fájl+függvény-szintű feladattal.

## 3. Kész, ha
Minden architektúra-döntésnek van ADR-je; a doksi a kóddal szinkronban van; a rendszer-diagramok
naprakészek; a kliens↔worker szerződés **automatikusan validált** a CI-ben; a költség-dashboard
láthatóvá teszi a margint; és a 105 tétel kód-szintű, végleges státuszt kap.
