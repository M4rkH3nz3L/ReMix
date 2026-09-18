# ADR-007 — Hibrid render (lokális ≤N mp · felhő queue+S3)

> ↑ [docs/hu index](../README.md) · [architecture/rendering.md](../architecture/rendering.md)

- **Státusz:** Elfogadva
- **Horgony:** [server/render.js](../../../server/render.js) ·
  [server/queue.js](../../../server/queue.js) ·
  [server/render-worker.js](../../../server/render-worker.js)

## Kontextus
A felhő-render kétféle terhelést jelent: a rövid videók gyorsak és gyakoriak (a
sorba állítás overhead-je itt rossz üzlet), a hosszúak lassúak és ritkábbak (ezek
viszont blokkolnák a szervert és skálázást igényelnek).

## Döntés
**Küszöb szerint** dől el (`CLOUD_RENDER_MIN_SEC`): a rövid videók a lokális
szerveren renderelnek **azonnal, in-process**; a hosszabbak **BullMQ-queue (Redis)
+ S3** úton, külön `render-worker.js` process(ek)en. Több worker-példány =
**vízszintes skálázás**. A `/render/:id` a queue-ból ad státuszt+progresszt, a
`/render/:id/file` az S3 publikus URL-re redirektel. Env nélkül a régi in-process
út megy (a `/health` `render` mezője jelzi az aktív módot).

## Miért
- A rövid render azonnali (nincs queue-overhead), a hosszú skálázható és nem
  blokkolja az API-t.
- A média S3-ban van → a worker-példányok megosztott tárolón dolgoznak.

## Elvetett alternatívák
- **Minden queue-n** — a rövid renderek feleslegesen lassulnának.
- **Minden in-process** — a hosszúak blokkolnák a szervert, nincs skálázás.

## Következmények
- Két üzemmód (env-vezérelt) → a deploy/ops doksinak (release.md) le kell írnia a
  Redis/S3/worker-skálázást.
- A [preview↔render paritás](./ADR-003-preview-render-parity.md) mindkét úton azonos
  (ugyanaz a render-mag).

## Kapcsolódó
[ADR-003](./ADR-003-preview-render-parity.md) · [development/release.md](../development/release.md).
