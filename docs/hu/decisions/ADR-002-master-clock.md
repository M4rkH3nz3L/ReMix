# ADR-002 — Egy rAF-mesteróra, a playhead a mester

> ↑ [docs/hu index](../README.md) · [architecture/performance.md](../architecture/performance.md)

- **Státusz:** Elfogadva
- **Horgony:** [usePlaybackClock.ts](../../../src/hooks/usePlaybackClock.ts)

## Kontextus
A lejátszáskor sok réteget kell időben tartani: videó, hang, szöveg-animáció,
hotspot-időzítés, beat-rács. Ha mindegyik saját órát vinne (a videó-player
ideje, egy külön animáció-óra…), a rétegek elcsúsznának, és görgetéskor (nem
lejátszáskor) az időzített hatások kiszámíthatatlanok lennének.

## Döntés
Egyetlen `requestAnimationFrame`-óra hajtja a lejátszást. A `playhead` a
store-ban él, ő a **mester**; a videó/hang réteg ehhez **szinkronizál**
(drift-korrekcióval). Minden időzített funkció a `playhead`-ből számol.

## Miért
- Determinisztikus időzítés **görgetésre is** (nem csak lejátszáskor).
- Egy hely kezeli a shuttle-sebességet, a hurok-tartományt és az Auto-Edit
  változat-előnézetet.
- A videó-player nem lehet az igazság forrása (forráscsere/seek/buffer alatt
  megbízhatatlan).

## Elvetett alternatívák
- **A videó-player ideje mint mester** — seek/forráscsere alatt megcsúszik.
- **Réteg-lokális órák** — halmozódó drift, nem szinkronizálható.

## Következmények
- **Fókusz-kapu kell:** a hookot a szerkesztő és a lejátszó is hívja; kapu nélkül
  két rAF-ciklus futna és a playhead dupla sebességgel haladna → `useIsFocused()`.
- Új időzített funkció a playheadből számoljon, **ne** indítson saját órát.

## Kapcsolódó
[architecture/rendering.md](../architecture/rendering.md) (az előnézetet ez hajtja).
