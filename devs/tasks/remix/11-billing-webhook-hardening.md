# 🟠 11. Billing & webhook hardening — P1

> **Forrás:** [remix.md](../../source/remix.md) §17 (billing / RevenueCat webhook).
> **Kapcsolódó:** [pro-subscription-architecture] — Pro = server-authoritative Supabase subscription RevenueCat IAP-pal; webhook + billing.js **kész**, go-live RC-account/kulcsok/EAS-build kell.
> **Érintett kód:** [server/billing.js](../../../server/billing.js) · [server/billing.test.js](../../../server/billing.test.js) · [server/index.js](../../../server/index.js) (`/billing/revenuecat` @ [508](../../../server/index.js#L508)).

---

## 0. Kontextus & cél

A billing-architektúra **helyes**: server-authoritative entitlement (nem a kliens dönt Pro-ról), subscription-tábla, credits, transactions, webhook, `isPro`, dev-billing-guard. **A webhook-hardening hiányzik.**

**Cél:** a RevenueCat-webhook legyen **replay- és duplikátum-biztos, auditált és atomikus.**

---

## 1. Jelenlegi állapot (bizonyíték)

```js
// server/index.js:508  — a webhook auth ma egyszerű:
app.post('/billing/revenuecat', express.json({ limit: '256kb' }), (req, res) => { ... });
//  → Authorization == secret  (a billing.js-ben)
```

- 🟢 Server-side entitlement, `isPro`, credits/transactions, dev-billing-guard, meglévő `billing.test.js`.
- ❌ Hiányzik: replay-protection, idempotency, event-ID unique-constraint, timestamp-validáció, webhook-audit-log, atomikus entitlement-update, tranzakció-konzisztencia — kifejezetten a `INITIAL_PURCHASE` / `RENEWAL` / `REFUND` / `EXPIRATION` / `PRODUCT_CHANGE` eseményeknél.

---

## 2. Megoldás

### 2.1 Webhook-integritás
- **Signature-verifikáció** a puszta `Authorization == secret` helyett/mellett (RevenueCat authorization header + a raw-body hash ellenőrzése; a `express.json` mellé raw-body megőrzése).
- **Timestamp-validáció:** régi (skew-en túli) esemény elutasítva → replay-védelem.

### 2.2 Idempotency
- `billing_webhook_events(event_id PRIMARY KEY, type, received_at, payload_hash, processed)` tábla; minden esemény **egyszer** dolgozódik fel (unique-constraint az `event_id`-re → duplikátum no-op).
- Feldolgozás **atomikusan** (DB-tranzakció): entitlement-update + credit-mozgás + audit egy commitben.

### 2.3 Event-lefedettség
- `INITIAL_PURCHASE` / `RENEWAL` → aktiválás/megújítás (30-napos periódus, [pro-subscription-architecture]).
- `REFUND` / `EXPIRATION` → entitlement-visszavonás.
- `PRODUCT_CHANGE` → tier-váltás.
- Minden ághoz teszt.

### 2.4 Audit
- Webhook-audit-log (event-ID / type / eredmény / entitlement-delta) → [14](./14-security-baseline-docs.md); a `wallet/payout` ([index.js:1358](../../../server/index.js#L1358)) és a dev-billing-guard műveletek is auditáltak.

---

## 3. Feladatok
### 🟦 Fázis A — Integritás
- [ ] Raw-body megőrzés + signature/timestamp-verifikáció a `/billing/revenuecat`-on.
- [ ] Skew-en túli esemény elutasítása.

### 🟦 Fázis B — Idempotency & atomicitás
- [ ] `billing_webhook_events` tábla (event-ID unique) + migráció.
- [ ] Feldolgozás egyetlen DB-tranzakcióban (entitlement + credits + audit).
- [ ] Duplikátum-esemény → no-op (teszt).

### 🟦 Fázis C — Lefedettség & audit
- [ ] Mind az 5 esemény-típus kezelése + `billing.test.js` bővítés.
- [ ] Webhook + payout + dev-billing audit-log.

---

## 4. Kész, ha
- [ ] Ugyanaz az esemény kétszer beküldve **csak egyszer** módosít entitlementet (idempotency-teszt).
- [ ] Hamis/lejárt-timestamp/rossz-signature webhook `401`/`400`.
- [ ] REFUND/EXPIRATION ténylegesen visszavonja a Pro-t; PRODUCT_CHANGE tiert vált.
- [ ] `npm run audit` zöld (`billing.test.js` bővítve).

## 5. Teszt & ellenőrzés
- `server/billing.test.js` — mind az 5 event + duplikátum + rossz-signature + régi-timestamp.
- Kézi: RevenueCat sandbox-esemény replay → nincs dupla aktiválás.

## 6. Kockázat / függőség
- **Go-live függőség:** RevenueCat-account/kulcsok + EAS-build ([pro-subscription-architecture]) — a hardening kód-oldala addig is elkészíthető és tesztelhető sandboxszal.
- **Függőség:** [14](./14-security-baseline-docs.md) (audit-log).
