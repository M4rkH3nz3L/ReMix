# 🔴 01. Worker endpoint policy-réteg — P0

> **Forrás:** [remix.md](../../source/remix.md) §6 (unrestricted compute API), §15 (`/notify`), §16 (`/invite`), §31 (OWASP API5/API6/API9), §34.1.
> **Testvér:** [00-README](./00-README.md) · ráépül: [02](./02-upload-security.md), [03](./03-rate-limiting.md), [06](./06-ai-endpoint-security.md), [07](./07-render-authorization.md).
> **Érintett kód:** [server/index.js](../../../server/index.js) · [server/auth.js](../../../server/auth.js) · [server/notify.js](../../../server/notify.js) · új: `server/security/authorization.js`.

> **✅ Authz-audit verdikt (2026-10-03, `studio-social`, fájlról-fájlra verifikálva).**
> A ReMix objektum-szintű authorizationja **jelen van és kétrétegű** (egy külső
> review tévesen „hiányzónak" vélte, mert nem látta a kódot):
> 1. **Supabase RLS a teljes user-adaton** — 27 tábla, mind owner/membership-
>    scopeolt; írás `SECURITY DEFINER`/`service_role` függvényeken át. A **remix-
>    határ bizonyítottan védett**: `posts_update/delete_own` (creator-kötött) +
>    `project_role()` **owner-kötött** (`where owner_id = p_owner`) + `project_members`
>    **FK → `cloud_projects(user_id, project_id)`** ⇒ B megnézheti/remixelheti A
>    posztját, de A eredetijét **nem** módosíthatja/törölheti, és nem is tud magának
>    tagságot adni idegen projekthez.
> 2. **Worker = compute** (nem projekt-CRUD): `requireAuth` + `canAccessRenderJob`
>    (render-BOLA, [07]) + `/invite` owner-kötött & FK-biztos + storage **dupla-
>    scopeolt** (`.eq(user_id).eq(id)`) + billing dev-route `devBillingGuard`-dal 403.
>
> **Egyetlen valódi rés volt — a `/notify` címzett-authz — és JAVÍTVA** ([10] §3B,
> `canNotify`: self / közös projekt / follow-él; pure `notifyPolicy.decideNotify` + teszt).
> A megmaradt P0 tehát **nem** az objektum-szintű authz (az megvan), hanem a lenti
> 🔴 **NYITOTT compute-endpointok** deklaratív policy mögé zárása.

---

## 0. Kontextus & cél

A worker egy **publikus compute-API**. Ma a policy **ad-hoc**: van, ahol `...proOnly` (= `[requireAuth, requirePro]`), van, ahol `requireAuth`, és **sok endpoint teljesen nyitott**. Nincs egyetlen hely, ahol egy endpoint jogosultsági szintje deklaratívan látszana → ez OWASP **API5 (Broken Function Level Authorization)** + **API9 (Improper Inventory Management)**.

**Cél:** minden worker-endpoint **explicit, deklaratív policy-t** kapjon egy központi rétegből — nincs „alapból nyitott”. A policy-szintek (audit §34.1):

```text
PUBLIC · AUTHENTICATED · PRO · OWNER · EDITOR · MODERATOR · ADMIN · SYSTEM
```

---

## 1. Jelenlegi állapot (bizonyíték)

A [server/index.js](../../../server/index.js) route-térképe (2026-09-30, `studio-social`):

| Réteg | Endpointok | Állapot |
| --- | --- | --- |
| `...proOnly` (auth+pro) | `/youtube`, `/tts`, `/faces`, `/sky`, `/upscale`, `/ai/translate`, `/ai/highlights`, `/ai/story`, `/bgremove`, `/ai/autoedit`, `/captions`, `/audio/stems`, `/render`, `/track`, `/reframe` | 🟢 védve |
| `requireAuth` | `/notify`, `/invite`, `/billing/*`, `/shop/credits/grant`, `/media/upload`, `/audio/analyze`, `/storage/*`, `/wallet/payout`, `/render/queue` | 🟡 authelt, de **objektum-szintű authz hiányos** |
| **NYITOTT (semmi)** | `/shotscore`, `/ai/hooks`, `/ai/probe`, `/ai/thumbheadlines`, `/thumbnails/compose`, `/ai/captionstudio`, `/voice/preview`, `/imagedoc`, `/color/stats`, `/color/pixel`, `/color/lut-export`, `/color/scope`, `/text/bake`, `/depth/parallax`, `/depth/focus`, `/ai/assist`, `/waveform`, `/scenes`, `/beats`, `/vision/index`, `/vision/query`, `/thumbnails`, `/silence`, `/proxy`, `/collect`, `/library`, `/music`, `/stickers3d` | 🔴 **auth nélkül CPU/GPU/FFmpeg/AI-t indít** |

Már megvan (alap): [server/auth.js](../../../server/auth.js) exportál `requireAuth`, `verifyRequest`, `callerId`, `corsAllowlist`, `INSECURE_DEV`; a `requirePro` az [index.js:76](../../../server/index.js#L76)-ban van, `proOnly` az [index.js:98](../../../server/index.js#L98)-ban.

### Konkrét business-flow rések (OWASP API6)
- **`/notify` ([index.js:384](../../../server/index.js#L384)):** `requireAuth` van, de a `userId` a **body-ból** jön → egy user tetszőleges másiknak küldhet notificationt. A kód saját kommentje is jelzi: „Következő lépés: címzettenkénti jogosultság”.
- **`/invite` ([index.js:410](../../../server/index.js#L410)):** owner a tokenből jön (jó), de az üzleti authz szűk: nincs teljes `owner-role + project-active + target-allowed` lánc.

---

## 2. Megoldás — `server/security/authorization.js`

### 2.1 Deklaratív policy-factory-k
Egy modul, amely middleware-eket ad vissza, és **mellékhatásként regisztrálja az endpointot egy inventory-ba** (§API9):

```js
// server/security/authorization.js  (VÁZ)
const { requireAuth, verifyRequest, callerId } = require('../auth');

function policy(level, opts = {}) {          // level: PUBLIC|AUTHENTICATED|PRO|OWNER|EDITOR|MODERATOR|ADMIN|SYSTEM
  registerRoute(level, opts);                // → inventory (audit §API9)
  return async (req, res, next) => { /* level szerinti ellenőrzés */ };
}

module.exports = {
  publicRoute: (o) => policy('PUBLIC', o),
  authenticated: (o) => policy('AUTHENTICATED', o),
  pro:          (o) => policy('PRO', o),
  projectOwner: (o) => policy('OWNER', o),     // req.params/body projectId → ownership-check (DB)
  projectEditor:(o) => policy('EDITOR', o),
  moderator:    (o) => policy('MODERATOR', o),
  admin:        (o) => policy('ADMIN', o),
  system:       (o) => policy('SYSTEM', o),    // csak service-secret / belső hívás
  routeInventory,                               // GET /health/routes-hoz
};
```

- `PRO` = `authenticated` + entitlement-check (a meglévő `requirePro`-t ide olvasztjuk).
- `OWNER`/`EDITOR` = `authenticated` + **objektum-szintű** ellenőrzés (project/asset/job membership) → ez zárja az **API1 BOLA** rést is (kiegészíti [07](./07-render-authorization.md)-et).
- `PUBLIC` **explicit döntés** — a nyitott read-only endpoint (`/library`, `/music`, `/tts/voices`, `/health`) tudatosan kap `publicRoute()`-ot, hogy az inventory-ban is „PUBLIC”-ként lássuk.

### 2.2 Explicit jelölés minden endpointon
Minden route pontosan egy policy-t kap. Példa a nyitott endpointok bezárására:

```js
// előtte:  app.post('/depth/parallax', upload.any(), (req, res) => {...})
// utána:   app.post('/depth/parallax', authenticated(), mediaUpload('parallax'), (req, res) => {...})
```

> A `mediaUpload()` és a `rateLimit()` a következő fájlok ([02](./02-upload-security.md), [03](./03-rate-limiting.md)) — a sorrend mindig `policy → rateLimit → mediaUpload → handler`.

### 2.3 Route-inventory (API9)
`GET /health/routes` (SYSTEM/ADMIN mögött) listázza az összes endpointot + policy-szintjét + rate-limit-osztályát. Egy jest-teszt **failel, ha bármely regisztrált route policy nélkül van** → gépi garancia arra, hogy nincs „elfelejtett nyitott” endpoint.

### 2.4 `/notify` és `/invite` business-flow authz
- **`/notify`:** a címzettet **relációból** kell validálni — `caller ↔ recipient` kapcsolat (follow / project-membership / comment-kontextus). Body-ból jövő `userId` önmagában nem elég.

  ```text
  caller → (relationship | project membership | comment context) → recipient authorized → notify
  ```
- **`/invite`:** teljes lánc — `owner_id = caller AND project exists AND caller has owner role AND project active AND target allowed`.

---

## 3. Feladatok

### 🟦 Fázis A — Policy-réteg
- [ ] `server/security/authorization.js` létrehozása a 2.1 factory-kkal; `requirePro` átemelése ([index.js:76](../../../server/index.js#L76)) `pro()`-ba.
- [ ] `OWNER`/`EDITOR` objektum-authz: `projectId` feloldása → `project_members` / `cloud_projects` ownership-check (service-role read, `auth.uid()` összevetés).
- [ ] Route-inventory + `GET /health/routes` (ADMIN).
- [ ] Jest: **minden regisztrált route-nak van policy-je** (inventory-teszt), és a policy-szintek helyesen utasítanak el (401/403).

### 🟦 Fázis B — Minden endpoint bejelölése
- [ ] A 27 **nyitott** endpoint (§1 táblázat) besorolása és bejelölése (`publicRoute()` vagy `authenticated()`/`pro()`). Alapértelmezés: **compute-t indító endpoint minimum `authenticated()`**.
- [ ] A `requireAuth`-os endpointok átállítása a megfelelő szintre (`pro`/`owner`/`authenticated`).
- [ ] Read-only public endpointok (`/library`, `/music`, `/tts/voices`, `/health`) **explicit** `publicRoute()`.

### 🟦 Fázis C — Business-flow authz
- [ ] `/notify` címzett-authz relációból ([notify.js](../../../server/notify.js) + [index.js:384](../../../server/index.js#L384)).
- [ ] `/invite` teljes owner-role + project-active + target-allowed lánc ([index.js:410](../../../server/index.js#L410)).

---

## 4. Kész, ha
- [ ] `GET /health/routes` minden endpointot policy-szinttel listáz, és **nincs `UNSET`** szintű route.
- [ ] A korábban nyitott compute-endpointok `401`-et adnak token nélkül (jest-teszt bizonyítja).
- [ ] `/notify` idegen `userId`-re `403` (nincs reláció); `/invite` nem-owner/inaktív projektre `403`.
- [ ] `npm run audit` zöld; nincs free/on-device regresszió (a kézi, on-device kliens-műveletek nem érintik a workert).

## 5. Teszt & ellenőrzés
- `server/security/authorization.test.js` — policy-mátrix (minden szint × {nincs token / user-token / pro-token / owner / idegen}).
- `server/index.routes.test.js` — inventory-teljesség (elhasal, ha új route policy nélkül kerül be).
- Kézi: `curl -X POST .../depth/parallax` → `401`.

## 6. Kockázat / függőség
- **Regresszió-kockázat:** a kliens ma auth nélkül hívhat nyitott endpointot → a bejelölés előtt fel kell mérni, mely kliens-hívások mennek token nélkül, és pótolni a `Authorization` fejlécet. `INSECURE_DEV=1` marad dev-escape hatch (soha production).
- **Függőség:** ez a fájl az alap — [03](./03-rate-limiting.md)/[04](./04-ssrf-protection.md)/[06](./06-ai-endpoint-security.md)/[07](./07-render-authorization.md) erre a policy-rétegre ül rá.
