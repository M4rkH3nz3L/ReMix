# 🔴 03. Rate limiting (Redis) — P0

> **Forrás:** [remix.md](../../source/remix.md) §8 (rate limiting), §34.3. OWASP API4.
> **Testvér:** ráépül [01](./01-worker-auth-policy.md)-re · együtt [02](./02-upload-security.md), [06](./06-ai-endpoint-security.md).
> **Érintett kód:** [server/index.js](../../../server/index.js) · [server/queue.js](../../../server/queue.js) (Redis már van) · új: `server/security/rateLimit.js`.

---

## 0. Kontextus & cél

Ma **nincs semmilyen rate-limit** a workerben (grep: `express-rate-limit` / `rateLimit` → 0 találat, `server/queue.js`-en kívüli Redis-használat nincs a limithez). Egy publikus compute-API rate-limit nélkül közvetlen **DoS + költség-attack** felület (API4).

**Cél:** Redis-alapú, endpoint-osztályonként hangolt rate-limit, amely az azonosítás **legszűkebb elérhető kulcsán** limitál: `subscription > user > device > IP`.

> A Redis már adott (BullMQ a render-queue-hoz — [server/queue.js](../../../server/queue.js)), tehát nem új infra, csak új namespace.

---

## 1. Jelenlegi állapot (bizonyíték)
- `grep -rniE "rate.?limit" server/*.js` → **üres** (a `node_modules`-on kívül).
- Minden compute-endpoint (FFmpeg/Chromium/ONNX/AI) korlátlan hívásszámmal elérhető.

---

## 2. Megoldás — `server/security/rateLimit.js`

### 2.1 Kulcs-hierarchia
A limiter a legerősebb ismert azonosítót választja (a policy-rétegből, [01](./01-worker-auth-policy.md)):

```text
Pro-user      → subscription-tier limit (magasabb)
Auth-user     → user-id limit
Ismert eszköz → device-id limit
Névtelen      → IP limit (legszigorúbb)
```

### 2.2 Endpoint-osztályok (az audit §8 táblázata → kódra)

| Osztály | Endpointok | Kulcs | Alap-limit (hangolható) |
| --- | --- | --- | --- |
| `auth` | login/OTP-flow (kliens→Supabase, worker-proxy ahol van) | IP + account | szigorú (pl. 5/perc) |
| `ai` | `/ai/*` | user + subscription | tier-függő + [06](./06-ai-endpoint-security.md) quota |
| `upload` | minden `mediaUpload()` endpoint | user + IP | közepes |
| `render` | `/render`, `/render/queue` | user + credits | credit-kötött |
| `tts` | `/tts` | user + credits | credit-kötött |
| `upscale` | `/upscale` | user + credits | credit-kötött |
| `analysis` | `/audio/analyze`, `/shotscore`, `/vision/*`, `/depth/*`, `/color/*` | user + credits | közepes |
| `messaging` | notify/DM-proxy | user + conversation | közepes |
| `public` | `/library`, `/music`, `/feed`-proxy, `/search` | IP + device | laza, de van |

### 2.3 Implementáció
- `express-rate-limit` + `rate-limit-redis` store (vagy saját Redis `INCR`+`EXPIRE` sliding-window), a `queue.js` Redis-connectionjét újrahasználva külön `rl:` prefixszel.
- Válasz `429` + `Retry-After` fejléc; a limit **eseményt logol** ([14](./14-security-baseline-docs.md) securityEventLog).
- Factory: `rateLimit(className)` → middleware; a route-sorrend `policy → rateLimit → mediaUpload → handler`.

---

## 3. Feladatok

### 🟦 Fázis A — Mag
- [ ] `server/security/rateLimit.js`: Redis-store + `rateLimit(className)` factory + kulcs-hierarchia (a policy-réteg `req.auth` kontextusából).
- [ ] Osztály-katalógus (`RL_CLASSES`) hangolható env-limitekkel (`RL_<CLASS>_MAX`, `RL_<CLASS>_WINDOW`).
- [ ] `429` + `Retry-After` + security-event log.

### 🟦 Fázis B — Bekötés
- [ ] Minden endpoint megkapja a rate-limit osztályát (a §2.2 táblázat szerint), a policy-réteg után.
- [ ] Credit-kötött osztályoknál (`render`/`tts`/`upscale`) a limit **atomikusan** összhangolva a credit-levonással (ne legyen olyan, hogy limit átment, de credit nincs).

### 🟦 Fázis C — Megfigyelhetőség
- [ ] Rate-limit metrikák (találatok/osztály) a `/health`-be vagy egy `GET /health/ratelimit`-be (ADMIN).

---

## 4. Kész, ha
- [ ] Terhelés-teszt: egy IP `N+1.` hívása `429`-et kap `Retry-After`-ral.
- [ ] Pro-user magasabb küszöböt kap, mint névtelen IP (jest a kulcs-választásra).
- [ ] A limit-értékek env-ből hangolhatók újradeploy nélkül (config-reload vagy env).
- [ ] `npm run audit` zöld.

## 5. Teszt & ellenőrzés
- `server/security/rateLimit.test.js` — kulcs-hierarchia + küszöb-átlépés + `Retry-After` (fake Redis / ioredis-mock).
- Kézi: `for i in {1..30}; do curl .../shotscore; done` → `429` a küszöb után.

## 6. Kockázat / függőség
- **Elosztott worker:** ha több worker-instance fut, a Redis-store kötelező (nem in-memory), különben megkerülhető — a `queue.js` Redis-e ezt megoldja.
- **Függőség:** [01](./01-worker-auth-policy.md) (a kulcs a `req.auth`-ból jön) + a credit-osztályok [07](./07-render-authorization.md)/[06](./06-ai-endpoint-security.md) credit-logikájával közösek.
