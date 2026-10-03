# 🟡 15. Cél-architektúra: API-gateway, queue-szeparáció, MCP boundary — P2

> **Forrás:** [remix.md](../../source/remix.md) §37 (architektúra-evolúció), §20 (MCP security boundary).
> **Előfeltétel:** a P0-réteg ([01](./01-worker-auth-policy.md)–[07](./07-render-authorization.md)) — ez a fájl a **skálázódási** fázis, nem go-live blokkoló.
> **Érintett kód:** [server/index.js](../../../server/index.js) (monolit worker) · [server/queue.js](../../../server/queue.js) · [server/render-worker.js](../../../server/render-worker.js) · [workers-registry.js](../../../server/workers-registry.js).

---

## 0. Kontextus & cél

A mai worker gyakorlatilag monolit: `Mobile → Express → {FFmpeg, AI, Storage}` egy processzben (a render-worker már külön processz — jó kezdet). Ahogy a terhelés nő, a **compute-típusok szétválasztása** és egy **explicit gateway-réteg** kell.

**Cél (§37):** a P0-ban megépült Auth/Rate-Limit/Authorization rétegre húzni egy **API-gateway + command-réteg + queue-szeparált worker-flottát**.

---

## 1. Jelenlegi → cél

```text
MA:
  Mobile ─► Express (index.js) ─► FFmpeg / AI/ML / Storage   (+ külön render-worker)

CÉL (§37):
  Mobile ─► API Gateway ─► Auth ─► Rate-Limit ─► Authorization ─► Quota/Billing
                                   │
                           ┌───────▼────────┐
                           │ Command / API  │
                           └───────┬────────┘
                 ┌─────────────────┼─────────────────┐
                 ▼                 ▼                 ▼
           Render Queue        AI Queue         Media Queue
                 ▼                 ▼                 ▼
             Workers          AI Workers       Media Workers
                 └─────────────────┼─────────────────┘
                                   ▼
                           Object Store ─► CDN
```

A P0 már megépíti az Auth/Rate-Limit/Authorization/Quota rétegeket `server/security/` alatt — ez a fázis ezeket **egy gateway-belépőpont mögé** rendezi, és a compute-ot **külön queue-kra + worker-típusokra** bontja.

---

## 2. Megoldás (fokozatos)

### 2.1 Command/API-réteg kiemelése
- Az endpoint-handlerek üzleti logikája → command-objektum + validátor ([06](./06-ai-endpoint-security.md) command-policy-engine kiterjesztése az egész workerre), így a gateway csak {auth, rate, authz, quota} + enqueue.

### 2.2 Queue-szeparáció
- A ma közös feldolgozás bontása: **Render Queue** (van, BullMQ), **AI Queue**, **Media Queue** — külön concurrency/priority/limit ([workers-registry.js](../../../server/workers-registry.js) bővítése).
- Worker-típusonként külön skálázás és erőforrás-izoláció (a heavy-AI ne éheztesse a render-t).

### 2.3 MCP boundary (§20)
Ha a ReMix később MCP-n vezérelhető:
```text
MCP → Identity → Session → Tool-authorization → Capability-policy →
Project-ACL → Command Bus → Validation → Execution
```
- Az MCP **sosem** kap `service_role`-t és **sosem** kap közvetlen DB-hozzáférést — csak a command-buson + policy-engine-en át hat (ugyanaz a determinisztikus validátor, mint az AI-nál, [06](./06-ai-endpoint-security.md)).

---

## 3. Feladatok
### 🟦 Fázis A — Command-réteg
- [ ] Endpoint-handlerek → command + validátor szeparáció (a gateway csak belépő + enqueue).

### 🟦 Fázis B — Queue-flotta
- [ ] AI Queue + Media Queue külön (BullMQ), típusonkénti concurrency/limit; worker-registry bővítés.
- [ ] Object-store → CDN a publikált tartalomra ([05](./05-storage-security.md) public-bucketekre építve).

### 🟦 Fázis C — MCP (ha releváns)
- [ ] MCP-boundary a fenti lánccal; service-role-tiltás; közös command-policy-engine.

---

## 4. Kész, ha
- [ ] Az AI-terhelés nem blokkolja a render-t (külön queue, izolált concurrency).
- [ ] A gateway-belépőpont egységesen alkalmazza az {auth, rate, authz, quota} láncot.
- [ ] (Ha van MCP) az MCP nem fér a DB-hez/service-role-hoz, csak a command-buson át.

## 5. Teszt & ellenőrzés
- Terhelés-teszt: AI-burst alatt a render-latency stabil marad.
- Command-réteg unit-tesztek; MCP-boundary policy-teszt.

## 6. Kockázat / függőség
- **Nagy refaktor** — csak a P0/P1 stabilizálása után, fokozatosan (strangler-minta: endpoint-onként a gateway/command-rétegbe).
- **Előfeltétel:** [01](./01-worker-auth-policy.md)–[07](./07-render-authorization.md) + [14](./14-security-baseline-docs.md).
