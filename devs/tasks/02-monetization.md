# 💰 02. Monetizáció — P0 (abuse/tier) / P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §2. · **Testvér:** [01-production](./01-production-go-live.md) (RevenueCat/secrets), [04-social](./04-social.md) (marketplace), security-backlog `03`/`11`.
> **Érintett kód:** [server/billing.js](../../server/billing.js) · [server/payouts.js](../../server/payouts.js) · [src/store/entitlementStore.ts](../../src/store/entitlementStore.ts) · [src/lib/capabilities*](../../src/lib/) · [supabase/migrations/](../../supabase/migrations/) (`subscriptions`, `wallet`, új `usage_counters`).

---

## 0. Kontextus & cél
Ma a rendszer lényegében **Pro-gatingre** épül (`if pro`). A fenntartható monetizációhoz
**tier-modell** (`capability.minTier`), **usage-metering + kvóta**, és valódi **marketplace +
payout** kell. Cél: a feature-ök a tier-hez kötöttek, a drága erőforrások méretve + limitálva.

## 1. Jelenlegi állapot (bizonyíték)
- Pro-subscription server-authoritative (RevenueCat IAP, `subscriptions` tábla, worker `billing.js`).
- Coin-wallet + payout **adatmodell** van ([server/payouts.js](../../server/payouts.js), `wallet` migr.).
- Shop-marketplace **adatmodell** + atomic-purchase RPC van — de a teljes creator-flow hiányos.
- **Nincs** tier-modell (Basic/Ultra), usage-metering, quota-reset, credit-top-up, queue-priority.

## 2. Feladatlista

### 2.1 Tier-modell `Free/Basic/Pro/Ultra` — P1
- [x] ✅ **Capability → minTier** réteg KÉSZ + **BEKÖTVE**: [src/lib/tiers.ts](../../src/lib/tiers.ts) (Tier-sorrend + `tierMeetsMin`/`isPaidTier`/`asTier`) + [capabilities.ts](../../src/lib/capabilities.ts) `minTier` (a `local ⇒ free` type-invariáns megmaradt) + `capabilityAllowed(cap, tier)` + `entitlementStore.allows(cap)`/`effectiveTier()`/`allowsNow(cap)`. A **backend-gate** ([backend.ts](../../src/lib/backend.ts) `ensureCloud`/`canUseCloud`) a tier-pontos `allowsNow`-t használja (a `requiresPro && !isPro` helyett) — **ekvivalencia-teszttel bizonyítva zéró regresszió** a free/pro-capekre, és jövő-biztos basic/ultra-ra. Teszt: `tiers.test.ts` + `capabilities.test.ts` (12).
- [ ] 🟡 Entitlement-mapping a 4 tierre: a **kliens kész** (`effectiveTier` 4-tier + lejárat), a **server-oldal** (DB-tier-enum basic/ultra + billing/IAP-termékek) hátra → §2.4.

### 2.2 Usage metering — P1
- [x] ✅ **Mérés-mag + kvóták + teszt**: [src/lib/usageMeter.ts](../../src/lib/usageMeter.ts) — metrikák (aiTokens/renderMinutes/exports/cloudJobs; a **storage KÜLÖN** rendszer: [storageQuota.ts](../../src/lib/storageQuota.ts)) + `TIER_QUOTAS` (free/basic/pro/ultra, -1=korlátlan, a [tiers.ts](../../src/lib/tiers.ts)-hez kötve) + `addUsage`/`remaining`/`canUse`/`isOverQuota`/`usageRatio`. Teszt: `usageMeter.test.ts` (10) — kvóta-monotonitás + gate + arány. A hiteles logika, amit a kliens (soft-warn) és a worker (hard-enforce) is használ.
- [x] ✅ **VERTIKUM e2e (kód-komplett)**: `usage_counters` tábla + `increment_usage` RPC ([migráció](../../supabase/migrations/20261006120000_usage_counters.sql), owner-only RLS read) + worker [server/usage.js](../../server/usage.js) (`enforceQuota` gate + `trackUsage` könyvelés + `userTier` a subscriptionből, DB nélkül best-effort) + **bekötve a `/tts` (`cloudJobs`) + `/render` felhő-ág (`renderMinutes`) endpointokba** (429 túllépéskor) + kliens-olvasás [usageClient.ts](../../src/lib/usageClient.ts) (`fetchMyUsage`/`usageStatus`/`nearQuota` soft-warn). Teszt: `usage.test.js` (9) + `usageClient.test.ts` (6).
- [x] ✅ **Migráció LIVE + BIZONYÍTOTT prodon (2026-10-06)**: `usage_counters` tábla + `increment_usage` RPC pushed (rctzpbzkpaqdldtueeub) + verifikálva (atomikus növelés 100+50=150, teszt-sorok törölve).
- [x] ✅ **`/render` felhő-ág gate (2026-10-06)**: a `renderMinutes` kvóta-gate a felhő-render enqueue ELŐTT (a hiteles tier `userTier`-rel; `minutes = ceil(totalDuration/60)`; 429 + hátralévő perc túllépéskor), a könyvelés (`trackUsage`) a sikeres sorba tétel UTÁN. A `/render` a `proOnly` mögött van → prodban mindig verifikált Pro-hívó (300 perc/hó), dev-ben best-effort — a `/tts`-mintát tükrözi.
- [x] ✅ **AI-token gate — mind a 8 `/ai/*` generálós endpoint (2026-10-06)**: `aiMeter` middleware ([index.js](../../server/index.js), a `/ai/hooks|translate|highlights|story|thumbheadlines|captionstudio|assist|autoedit`-en) gate-el az `aiTokens` metrikára. **Helyes költség-szemantika:** csak az **env Anthropic** (a mi felhő-költségünk) mérődik — a **BYOK** (user saját kulcsa) és a **lokális Ollama** (ingyenes on-device-elvű inferencia) KIMARAD. A könyvelés a **valós token-számmal** (`response.usage`), a provider-független [runStructured](../../server/ai.js)-ben, `AsyncLocalStorage` (uid) átadással — így a 9 AI-funkció aláírása változatlan, koncurrencia-biztosan. Teszt: `aiTokenCount` (6) + ALS-scope (1) a `usage.test.js`-ben + izolált ALS-átterjedés+konkurrencia-proof (scratchpad). Audit zöld (107 suite / 1182 teszt).
- [x] ✅ **Egress → `renderMinutes` mérés (2026-10-06)**: a Live-multistream (LiveKit egress) felhő-perceit a `renderMinutes` kvótába könyveli — [liveEgress.js](../../server/liveEgress.js) `markEgressStopped` (a user-stop ÉS a stale-sweep közös chokepointja) kiszámolja a `started_at → stopped_at` percet (`egressMinutes`) és `trackUsage`-el. **Idempotens**: csak az `active→stopped` átmenet mér (a `.eq('status','active')` guard → nincs dupla-számolás a stop+sweep versenynél). Teszt: `liveEgress.test.js` (+2 `egressMinutes`). Ezzel MINDEN drága felhő-erőforrás mért: `/tts`(cloudJobs) · `/render`+egress(renderMinutes) · 8×`/ai/*`(aiTokens).
- [ ] ⬜ **Hátra**: `exports` metrika bekötése (helyi render/letöltés számlálása) + UI-warn-banner a `nearQuota`-ból.

### 2.3 Havi quota reset — P1
- [x] ✅ **Reset-logika + teszt**: `usageMeter.resetIfNewPeriod`/`periodKey`/`isNewPeriod` (UTC `YYYY-MM`, determinisztikus) — a havi nullázás hiteles magja.
- [ ] ⬜ **Hátra**: **pg_cron** (server-oldali havi reset a `usage_counters`-re, ugyanezzel a logikával) + expired-entitlement cleanup + failed-payment kezelés.

### 2.4 Basic / Ultra csomagok — P1
- [ ] ⬜ Tényleges entitlement-táblázat (local/cloud-render, AI-limit, storage, priority-queue, AI-advanced).

### 2.5 AI credit top-up — P1
- [x] ~ **Credit-wallet KÉSZ** ([src/lib/wallet.ts](../../src/lib/wallet.ts): coin-vásárlás/cashout/transfer + `subscribeProWithCredits` + `creditHistory` ledger + PayPal payout; [[coin-wallet-payouts]]). (Az audit `main`-je elavult.)
- [ ] ⬜ Hátra: dedikált **AI-credit consumable IAP** termék + overage/refund + idempotency-hardening a top-upra.

### 2.6 Queue priority — P1
- [x] ✅ **Tier-prioritás a render-sorban**: [server/queue.js](../../server/queue.js) `tierJobPriority` (`Ultra=1 > Pro=2 > Basic=3 > Free=4`; BullMQ-ban kisebb = előbb fut) az `enqueueRender` `priority`-jében; a kliens a user szintjét ([render.ts](../../src/lib/render.ts) `effectiveTier`) küldi a `/render` formban (csak sorrend, nem biztonsági — a render Pro-kapu mögött). Teszt: `queue.test.js` (2) — rangsor + fallback. A tényleges Pro↔Ultra differenciálás a 4-tier billing-bekötéssel (§2.4) teljesedik ki; addig egységes FIFO.

### 2.7 Marketplace asset upload — P1
- [x] ~ **Alap KÉSZ**: [src/lib/marketplace.ts](../../src/lib/marketplace.ts) + [src/lib/shop.ts](../../src/lib/shop.ts) (listázás/vásárlás, atomikus purchase-RPC, RLS-gated payload, 30% fee; [[shop-marketplace-architecture]]). (Az audit `main`-je elavult.)
- [ ] 🔌 Hátra: asset-**moderation + copyright-report + takedown + versioning**.

### 2.8 Creator payout — P1
- [x] ~ **Payout-modell + kérés KÉSZ**: [wallet.ts](../../src/lib/wallet.ts) (`requestPayout`/`fetchPayoutAccount`/`setPayoutAccount`) + [server/payouts.js](../../server/payouts.js) (PayPal Payouts; [[coin-wallet-payouts]]).
- [ ] ⬜ Hátra: KYC + tax + payout-status-UI + failed-payout + fraud (vagy Stripe Connect, ha kell).

### 2.9 Promotion / influencer codes — P1
- [x] ✅ **Kupon-mag + teszt**: [src/lib/coupons.ts](../../src/lib/coupons.ts) — `normalizeCode` + `couponStatus` (disabled/notStarted/expired/exhausted/tierLocked/valid: időablak + `maxRedemptions` + `minTier`) + `applyDiscount`/`discountAmount` (percent/amount, nem-negatív) + `couponReward` (credits/proDays). Teszt: `coupons.test.ts` (10). A hiteles validáció+számítás, amit a kliens (azonnali visszajelzés) és a worker (atomikus beváltás) is használ.
- [ ] ⬜ Hátra: `coupons` tábla + atomikus **redeem-RPC** (usage-count növelés + grant) + creator-code-attribution + anti-fraud.

### 2.10 Anti-abuse / rate limiting — 🔴 P0
- [x] ✅ **Rate-limit mag KÉSZ**: [server/security/rateLimit.js](../../server/security/rateLimit.js) (kulcs-hierarchia + endpoint-osztályok) + **36 `rateLimit()` hívás** az [index.js](../../server/index.js)-ben + teszt (`rateLimit.test.js`). (Az audit `main`-je elavult volt.)
- [ ] 🟡 Hátra: dedikált AI/render/upload/storage **költség-abuse** finomhangolás (kvóta-kötés → §2.2) + **bot-detection**.

## 3. Kész, ha
A feature-ök a **tier** szerint nyílnak (nem `if pro`); a drága erőforrás **mért + kvótázott +
havonta resetelt**; a credit-top-up IAP idempotensen tölt; a marketplace-asset feltölthető +
moderálható; a payout valódi (teszt-)kifizetést végez; a compute-endpointok rate-limitáltak.
