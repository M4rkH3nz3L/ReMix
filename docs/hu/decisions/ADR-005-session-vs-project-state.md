# ADR-005 — Session-állapot ≠ projekt-igazság

> ↑ [docs/hu index](../README.md) · [architecture/state.md](../architecture/state.md)

- **Státusz:** Elfogadva
- **Horgony:** [editorStore.ts](../../../src/store/editorStore.ts) (`SESSION_RESET`)

## Kontextus
A szerkesztőnek sok **átmeneti módja** van: sáv-némítás/solo/elrejtés/zárolás,
trim-mód, snap-erősség, fókusz-mód, borotva, tartomány-kijelölés, változat-
előnézet. Ha ezek a projektbe kerülnének, két baj lenne: (1) a renderbe is
„beszivárognának" (pl. a némított sáv hiányozna az exportból), (2) átragadnának a
következő projektre (beragadt mód).

## Döntés
Ezek az állapotok **session-szintűek**: a `SESSION_RESET` konstansban élnek, NEM
kerülnek a projektbe és NEM hatnak a renderre. Projekt-nyitáskor ÉS -záráskor
UGYANEZ a konstans nullázza őket. A tartós hatás (pl. végleges némítás) a
[command buson](./ADR-001-command-bus.md) megy (a klip `volume`-ja).

## Miért
- Kizárja a „miért hiányzik a zene az exportból?" csapdát — a monitorozás soha
  nem téveszthető össze a tartalommal.
- A reset egyetlen helyen van → nem ragad át mód a projektek közt (ez a hiba már
  kétszer előfordult, mielőtt közös konstans lett).

## Elvetett alternatívák
- **Minden a projektben** — a monitorozás beszivárog a renderbe.
- **Két külön reset (nyitás/zárás)** — a lista duplázása beragadt módot okozott.

## Következmények
- Új átmeneti mód → a `SESSION_RESET`-be kerül, nem a `Project`-be.
- A kollaborációnál a session-állapot (kijelölés/prezencia) **nem** utazik.

## Kapcsolódó
[ADR-001](./ADR-001-command-bus.md) · [architecture/collaboration.md](../architecture/collaboration.md).
