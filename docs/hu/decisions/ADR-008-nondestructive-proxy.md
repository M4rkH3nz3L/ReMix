# ADR-008 — Proxy nem-destruktív; a render mindig az eredetivel

> ↑ [docs/hu index](../README.md) · [architecture/performance.md](../architecture/performance.md)

- **Státusz:** Elfogadva
- **Horgony:** [proxy.ts](../../../src/lib/proxy.ts)

## Kontextus
A nagy felbontású (4K) forrásokkal a valós idejű előnézet és a filmstrip akadna a
telefonon. A klasszikus „proxy workflow" megoldja ezt — de veszélyes, ha a proxy
a végső renderbe is beszivárog (minőségvesztés), vagy ha a projekt a proxyra
hivatkozik (a fájl elveszne/nem hordozható).

## Döntés
A worker 720p (≤1280 px hosszú él) **munka-példányt** készít; az **előnézet és a
filmstrip** ezt használja, a **render MINDIG az eredeti fájllal** fut — a klip
`uri`-ja **sosem** íródik át. A proxy eszköz-lokális, **determinisztikus kulcsú**
(fájlnév+méret) lemez-cache műtermék (`Documents/proxies`), ami **nem** kerül a
projekt-JSON-ba.

## Miért
- A szerkesztés gyors, a végeredmény teljes minőségű.
- A projekt hordozható marad (a proxy nem hivatkozott függőség).
- A cache-kulcs determinisztikus → egy forrás csak egyszer proxyzódik.

## Elvetett alternatívák
- **A klip uri-ja a proxyra** — minőségvesztés a renderben, törékeny hordozhatóság.
- **Proxy a projektbe mentve** — felhízlalja a projekt-JSON-t, eszköz-specifikus.

## Következmények
- Worker nélkül minden az eredetivel megy tovább (a proxy opcionális gyorsítás).
- Előmelegítés projekt-nyitáskor és videó-hozzáadáskor.

## Kapcsolódó
[architecture/performance.md](../architecture/performance.md) · [ADR-003](./ADR-003-preview-render-parity.md).
