# ADR-006 — AI = validált command-forrás, sosem közvetlen state

> ↑ [docs/hu index](../README.md) · [architecture/ai.md](../architecture/ai.md)

- **Státusz:** Elfogadva
- **Horgony:** [aiCommands.ts](../../../src/lib/aiCommands.ts) ·
  [ai.ts](../../../src/lib/ai.ts)

## Kontextus
Az AI-asszisztensnek módosítania kell a projektet („vágd ketté", „adj feliratot").
Ha az AI közvetlenül írná a state-et vagy vezérelné a komponenseket, a kimenete
nem lenne undo-zható, nem lenne előre látható, és egy hibás/rosszindulatú válasz
tetszőleges mezőt elronthatna.

## Döntés
Az AI kimenete **whitelist-validált** `EditorCommand`, amit a
[bus](./ADR-001-command-bus.md) `actor: 'ai'`-ként, `applyBatch`-csel (egy köteg =
egy undo) futtat. A `toEditorCommands()` a `PATCHABLE_FIELDS` halmazon kívüli
mezőket **eldobja**; a kontextus rétegzett és tömör (nem a teljes projekt-JSON).

## Miért
- Az AI-művelet **ugyanolyan** undo-zható és naplózott, mint a felhasználóé —
  nincs külön, ellenőrizetlen út a state-be.
- A whitelist bizton­ság: ismeretlen/veszélyes mező sosem íródik.
- Az `actor` + `aiReason` provenanciát ad („ki és miért csinálta ezt?").

## Elvetett alternatívák
- **Az AI közvetlenül hívja a store-t / a komponenst** — nem undo-zható, sérülékeny.
- **Teljes projekt-JSON az AI-nak** — token-drága, zajos, és nagyobb támadási felület.

## Következmények
- **Action preview:** a `describeAiCommand()` az alkalmazás ELŐTT megmutatja, mi
  változik.
- A whitelist bővítése = **szerződés-változás** → külön ADR-t érdemel.

## Kapcsolódó
[ADR-001](./ADR-001-command-bus.md) · [ADR-010](./ADR-010-byok-ai-routing.md).
