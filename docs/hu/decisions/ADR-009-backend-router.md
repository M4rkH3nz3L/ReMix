# ADR-009 — Egyetlen backend-router a címért és a Pro-kapuért

> ↑ [docs/hu index](../README.md) · [architecture/networking.md](../architecture/networking.md)

- **Státusz:** Elfogadva
- **Horgony:** [backend.ts](../../../src/lib/backend.ts)

## Kontextus
~15 hálózati kliens (`*Client.ts`) fordul a workerhez. Két dolog mindegyiknek
kell: a helyes worker-cím (dev-gép vs. hosztolt felhő, szimulátor vs. fizikai
telefon), és a Pro-jogosultság ellenőrzése hívás előtt. Ha ez minden kliensbe
külön kerülne, elkerülhetetlen a drift és a felesleges terhelés a fizetős infrán.

## Döntés
Egyetlen modul dönt **címről** (`renderServerUrl()` / `cloudBaseUrl()`
feloldási sorrenddel) és **jogosultságról** (`ensureCloud(cap)` → Pro? base URL :
`ProRequiredError`). A `~15 *Client` egyetlen egysoros `ensureCloud(cap)`-pal
gate-elhető. Release buildben az `assertSecureUrl` tiltja a sima HTTP-t.

## Miért
- Nincs kézi URL-átírás szimulátor ↔ telefon ↔ prod közt.
- A Pro nélküli hívás **el sem indul** → nem terheljük a fizetős workert.
- A `ProRequiredError` egységesen paywallra fordul.

## Elvetett alternatívák
- **Kliensenkénti URL/gate-logika** — drift, ismétlés, kihagyott ellenőrzések.
- **Csak futásidejű URL** — nincs release-biztonság (HTTP-szivárgás).

## Következmények
- Új `*Client` = `const base = ensureCloud('<cap>')` + `fetch(base + …)`.
- A capability-katalógus ([ADR-004](./ADR-004-capability-gating.md)) a `cap`-ok forrása.

## Kapcsolódó
[ADR-004](./ADR-004-capability-gating.md) · [architecture/networking.md](../architecture/networking.md).
