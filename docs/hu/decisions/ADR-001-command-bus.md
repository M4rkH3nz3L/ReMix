# ADR-001 — Minden szerkesztés command buson megy

> ↑ [docs/hu index](../README.md) · [architecture/commands.md](../architecture/commands.md) ·
> [Arch.md 13. szakasz](../../../Arch.md)

- **Státusz:** Elfogadva (a kód ezt valósítja meg)
- **Horgony:** [commands.ts](../../../src/lib/commands.ts) ·
  [editorStore.ts](../../../src/store/editorStore.ts)

## Kontextus
Egy videószerkesztőben ugyanazt a projektet sokféle forrás módosítja: érintés,
gesztus, billentyű, AI, automation. Ha mindegyik közvetlenül írná a state-et,
lehetetlen volna determinisztikus undo-t, AI-integrációt és (később)
kollaborációt építeni — a mutációk szétszóródnának és követhetetlenné válnának.

## Döntés
Minden szerkesztés egy nevesített `EditorCommand`, amit egyetlen **pure**
`applyCommand(project, cmd) → Project | null` reducer hajt végre. A projektet
közvetlenül **soha** nem írjuk (nincs `.tracks.push`, `.clips.splice`, store-on
kívüli `setState`). A belépő a `dispatch(cmd, actor)` és a `applyBatch(cmds, actor)`.

## Miért
- A timeline és a preview egyetlen igazságból, szinkronban frissül.
- Az undo/redo egy csővezeték (teljes projekt-pillanatkép be/ki).
- Az AI determinisztikus, **validált**, undo-zható mutációt kap — nincs külön út.
- A műveletek szerializálhatók → operation-alapú kollaboráció alapja.
- A nehéz vágó-matek pure lib-modulokba kerül → tesztelhető, store-mentes.

## Elvetett alternatívák
- **Komponens-lokális state** — a timeline és a preview elcsúszna.
- **Közvetlen mutáció** (`.push`/`.splice`) — nincs undo, nincs napló, nincs AI.
- **Független timeline-state** — két igazság, szinkron-pokol.

## Következmények
- Új mutáció = új command + reducer-ág + (ha nehéz) `slimForLog`-jelölés + teszt.
- Az `actor`-provenancia (user/ai/system) ingyen jár, az esemény-naplóval együtt.
- A UI magas szintű store-metódusai „tervet" számolnak (pure lib), majd EGY
  commandot dispatchelnek → egy undo-lépés.

## Kapcsolódó
[ADR-005](./ADR-005-session-vs-project-state.md) (mi NEM megy a buson),
[ADR-006](./ADR-006-ai-as-command-source.md) (az AI is ezen megy).
