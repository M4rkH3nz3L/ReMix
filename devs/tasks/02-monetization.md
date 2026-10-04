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
- [ ] ⬜ **Capability → minTier** réteg (`capability.minTier`, nem `if pro`); a gate-ek átírása.
- [ ] 🟡 Entitlement-mapping a 4 tierre (az `entitlementStore` + a server-subscription kiegészítése).

### 2.2 Usage metering — P1
- [ ] ⬜ `usage_counters` tábla: AI-token/credit, render-minutes, storage-GB, export-count, cloud-processing.
- [ ] ⬜ Worker-oldali mérés + beírás minden drága endpointon; havi aggregáció.

### 2.3 Havi quota reset — P1
- [ ] ⬜ **pg_cron** havi reset + expired-entitlement cleanup + failed-payment kezelés.

### 2.4 Basic / Ultra csomagok — P1
- [ ] ⬜ Tényleges entitlement-táblázat (local/cloud-render, AI-limit, storage, priority-queue, AI-advanced).

### 2.5 AI credit top-up — P1
- [ ] ⬜ Credit-wallet + **consumable IAP** + transaction-ledger + overage + refund + **idempotency**.

### 2.6 Queue priority — P1
- [ ] ⬜ BullMQ **tier-prioritás** (`Ultra > Pro > Basic > Free`) a render-queue-ban ([server/queue.js](../../server/queue.js)).

### 2.7 Marketplace asset upload — P1
- [ ] 🟡 Asset **upload + preview + metadata**; 🔌 **moderation + copyright-report + takedown + versioning**.

### 2.8 Creator payout — P1
- [ ] 🟡 Payout-adatmodell kész; ⬜ valódi **Stripe Connect** (vagy alternatíva) + **KYC + tax + payout-status + failed + fraud**.

### 2.9 Promotion / influencer codes — P1
- [ ] ⬜ Coupon + creator-code + campaign + expiry + usage-limit + attribution + fraud-prevention.

### 2.10 Anti-abuse / rate limiting — 🔴 P0
- [ ] ⬜ IP/user/endpoint rate-limit (security-backlog `03`) + AI/render/upload/storage abuse-védelem + **bot-detection**.

## 3. Kész, ha
A feature-ök a **tier** szerint nyílnak (nem `if pro`); a drága erőforrás **mért + kvótázott +
havonta resetelt**; a credit-top-up IAP idempotensen tölt; a marketplace-asset feltölthető +
moderálható; a payout valódi (teszt-)kifizetést végez; a compute-endpointok rate-limitáltak.
