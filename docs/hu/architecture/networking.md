# Networking — backend-router, Pro-kapu, retry

> Forrás: [Arch.md](../../../Arch.md) 9.1 szakasz +
> [backend.ts](../../../src/lib/backend.ts) · [netRetry.ts](../../../src/lib/netRetry.ts) ·
> [server/auth.js](../../../server/auth.js). ↑ [docs/hu index](../README.md)

## 1. Egyetlen router — cím és jogosultság egy helyen

A [backend.ts](../../../src/lib/backend.ts) az egyetlen forrás mindkét kérdésre —
így a ~15 `*Client.ts` modul nem tartalmaz saját URL- vagy előfizetés-logikát
([ADR-009](../decisions/ADR-009-backend-router.md)).

```
  *Client.ts (pl. captionStudioClient)
        │
        ├─ const base = ensureCloud('autoCaption')   ← 1. KAPU  2. CÍM egyben
        │       │
        │       ├─ isProNow()?  nem → throw ProRequiredError → PAYWALL (a hívás el sem indul)
        │       └─ igen → cloudBaseUrl()  (biztonságos URL)
        ▼
   fetch(base + '/captions', …)  → netRetry + parseGuards
```

## 2. Cím-feloldás

- **Dev worker** (`renderServerUrl()`) — feloldási sorrend:
  1. `EXPO_PUBLIC_SERVER_URL` (teljes cím, mindent felülír)
  2. `EXPO_PUBLIC_SERVER_HOST` (csak hoszt, port marad `8787`)
  3. az Expo `hostUri` gépe (a Metró ugyanazon a gépen fut, mint a worker)
  4. `localhost`
- **Felhő worker** (`cloudBaseUrl()`) — `EXPO_PUBLIC_CLOUD_URL` (prod), dev-ben a
  lokálisra esik vissza.
- **Fontos:** az `EXPO_PUBLIC_*` a bundle-be **beég** → módosítás után
  Metro-újraindítás kell.

## 3. Biztonság — release-ben nincs sima HTTP

Az `assertSecureUrl()` release buildben **tiltja** a `http://`-t: a worker felé a
bejelentkezett felhasználó Supabase-tokenje, a BYOK AI-kulcsa és a teljes
projekt-média utazik — sima HTTP-n ez lehallgatható. Release-ben az iOS ATS és az
Android network-security-config amúgy is blokkolná; így viszont **beszédes hibát**
kapunk, dev-ben (`__DEV__`) pedig a helyi worker változatlanul megy.

## 4. A Pro-kapu

```ts
ensureCloud(cap: CapabilityId): string   // Pro? → base URL; nincs Pro → throw ProRequiredError
canUseCloud(cap): boolean                // dobás nélküli lekérdezés (UI-állapothoz)
```

- **`ProRequiredError`** → a UI paywallra fordítja
  ([paywallStore](../../../src/store/paywallStore.ts),
  [PaywallSheet](../../../src/components/PaywallSheet.tsx));
  `isProRequiredError()` név alapján is felismeri.
- **A `cap` a [capability-katalógusból](../../../src/lib/capabilities.ts)** — a
  Pro-jogosultságot az [entitlementStore](../../../src/store/entitlementStore.ts)
  `isProNow()`-ja adja (szerver-autoritatív, [ADR-004](../decisions/ADR-004-capability-gating.md)).
- **A hívás el sem indul** Pro nélkül → nem terheljük feleslegesen a fizetős infrát.

## 5. Robusztusság — retry, timeout, HTML-csapda

- **[netRetry.ts](../../../src/lib/netRetry.ts)** (`fetchRead`, `readJson`) —
  újrapróbálkozás + időkorlát; a lokális AI-modell beragadhat, ezért az AI-hívás
  mindig timeout-ol ([ai.ts](../../../src/lib/ai.ts)).
- **[parseGuards.ts](../../../src/lib/parseGuards.ts)** — ha a válasz HTML (pl. egy
  proxy/hibaoldal), ne „JSON Parse error"-ként robbanjon, hanem beszédes hibaként.
- **Feltöltés:** [upload.ts](../../../src/lib/upload.ts) (`mediaFormData`,
  `uploadFetch`) a média multipart-küldéséhez.

## 6. Auth a worker felé

- **Kliens:** [workerAuth.ts](../../../src/lib/workerAuth.ts) — a Supabase-tokent
  csatolja a Pro/írás-végpontokhoz.
- **Worker:** [server/auth.js](../../../server/auth.js) — `requireAuth`,
  `corsAllowlist`, `callerId`, `proOnly`; SSRF-guard
  ([server/ssrf.js](../../../server/ssrf.js)) a felhasználó-adta URL-ekre
  (URL-import, storage-gateway).

## 7. A másik hálózat: Supabase

A social/fizetés/felhő-projekt **nem** a workeren megy, hanem közvetlenül a
Supabase-en ([supabase.ts](../../../src/lib/supabase.ts)): Postgres + Auth +
Realtime + Storage + RLS. Részletek → [storage.md](./storage.md) ·
[collaboration.md](./collaboration.md).

## 8. Kapcsolódások

- A capability-katalógus (a `cap`-ok forrása) → [ADR-004](../decisions/ADR-004-capability-gating.md)
- A router-döntés → [ADR-009](../decisions/ADR-009-backend-router.md)
- A Pro-jogosultság útja → [state.md](./state.md)
