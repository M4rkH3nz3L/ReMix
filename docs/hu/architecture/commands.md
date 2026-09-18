# Commands — a command-szerződés és a reducer-invariánsok

> Forrás: [Arch.md](../../../Arch.md) 3–4. szakasz +
> [commands.ts](../../../src/lib/commands.ts) +
> [editorStore.ts](../../../src/store/editorStore.ts). ↑ [docs/hu index](../README.md)

Ez a rendszer **gerince** ([ADR-001](../decisions/ADR-001-command-bus.md)). Ha
egyetlen fájlt kell megérteni a ReMixben, ez az.

## 1. Az invariáns

> **A projektet SOHA nem írjuk közvetlenül.** Nincs `.tracks.push`, `.clips.splice`,
> sem store-on kívüli `setState` ([AGENTS.md](../../../AGENTS.md)).

Minden változás egy **nevesített `EditorCommand`**, amit egyetlen **pure reducer**
alkalmaz. Ez az egy szabály adja az undo-t, az [AI-integrációt](./ai.md), a
provenanciát és a [kollaboráció-készséget](./collaboration.md).

## 2. A parancs-készlet (a szerződés)

A `EditorCommand` unió a [commands.ts](../../../src/lib/commands.ts)-ben — ez a
kliens, a UI és az AI közös szerződése. Csoportosítva:

| Csoport | Parancsok |
|---|---|
| **Klip** | `ADD_CLIP` · `ADD_CLIPS` · `UPDATE_CLIP` · `REMOVE_CLIP` · `SPLIT_CLIP` |
| **Sáv-újraépítés (köteg)** | `REPLACE_TRACK_CLIPS` · `REPLACE_TRACKS` |
| **Projekt** | `SET_ASPECT` · `SET_FPS` · `RENAME_PROJECT` |
| **Asset** | `ADD_ASSET` · `UPDATE_ASSET` · `RELINK_URI` |
| **Szerkezet / annotáció** | `SET_MARKERS` · `SET_CHAPTERS` · `SET_REGIONS` · `SET_LINKS` · `SET_PARTICLES` |
| **Kép-dokumentum** | `UPSERT_IMAGE_DOC` · `REMOVE_IMAGE_DOC` |

**A `REPLACE_TRACKS` a „nagy kalapács":** több sáv újraépítése EGY undo-lépésben —
olyan műveletekhez, amik az egész idővonalat mozgatják (ripple, csoport-mozgatás,
pre-compose, stílus-beillesztés). Assetet is vihet (`assets?`), és emberi címkét
(`label?`) a napló/undo-felirathoz.

## 3. A pure reducer

```ts
applyCommand(project: Project, command: EditorCommand): Project | null
```

- **Tiszta függvény:** nincs mellékhatás, nincs store-hozzáférés → önmagában
  tesztelhető (`lib/` mag, expo-mentes — lásd [testing.md](../development/testing.md)).
- **`null` = no-op / érvénytelen.** A hívó ezt `false`-ra fordítja (a `dispatch`),
  így egy érvénytelen művelet **nem** ír history-t és **nem** piszkítja a projektet.
- **Immutábilis:** új `Project`-et ad vissza, a bemenetet nem módosítja.

## 4. A bus belépői

A [editorStore](../../../src/store/editorStore.ts) két belépőt ad:

```
dispatch(command, actor = 'user')     → boolean   (egy művelet, egy undo-lépés, egy esemény)
applyBatch(commands, actor = 'ai')    → number    (több command → EGY undo-lépés, több esemény)
```

Amit a `dispatch` csinál (a [state.md](./state.md) undo-modelljével egyben):

```
dispatch(cmd, actor)
   │
   ├─ next = applyCommand(project, cmd)
   ├─ ha next === null → return false          (érvénytelen: nincs mellékhatás)
   │
   ├─ event = { id, at, actor, command: slimForLog(cmd), slim? }
   └─ set:
        project = next
        past    = [...past.slice(-49), project]   (HISTORY_LIMIT = 50)
        future  = []
        dirty   = true
        events  = [...events, event].slice(-300)  (EVENT_LIMIT = 300)
```

## 5. Provenancia — az `actor` és az esemény-napló

Minden művelet `actor`-t kap: **`'user' | 'ai' | 'system'`**. Ez az
[esemény-naplóba](./ai.md) kerül (`ProjectEvent`), és:

- ez különbözteti meg a felhasználói és az AI-műveletet (a lánc egyébként
  *azonos* — lásd lent);
- a napló a „nehéz" parancsokat csonkolja (`slim: true`,
  [eventLog.ts](../../../src/lib/eventLog.ts)) → ilyet **tilos** újra
  `applyCommand`-dal futtatni, csak `describeCommand()`-hoz való (ember-olvasható
  leírás, AI-memória).

## 6. A minta: „terv a pure lib-ben → egy command → egy undo"

A UI **soha nem gyárt kézzel** `REPLACE_TRACKS`-et. A store magas szintű metódusai
egy expo-mentes lib-modulban *kiszámolják a tervet*, majd **egyetlen** commandot
dispatchelnek — így a bonyolult vágás is egy undo-lépés és tesztelhető:

| Store-metódus | Terv (pure lib) | Command |
|---|---|---|
| `splitClipAt` | frame-rácsra ültetés ([frames.ts](../../../src/lib/frames.ts)) | `SPLIT_CLIP` |
| `rippleDelete` / `rippleResize` | [ripple.ts](../../../src/lib/ripple.ts) | `REPLACE_TRACKS` |
| `rollEdit` / `slipEdit` / `slideEdit` | [trimEdit.ts](../../../src/lib/trimEdit.ts) | `REPLACE_TRACKS` / `UPDATE_CLIP` |
| `deleteRange` | [rangeEdit.ts](../../../src/lib/rangeEdit.ts) | `REPLACE_TRACKS` |
| `preCompose` | [preCompose.ts](../../../src/lib/preCompose.ts) | `REPLACE_TRACKS` |
| `nudgeClipsBy` | csoport-clamp a store-ban | `REPLACE_TRACKS` |
| `updateClip` (több-kijelölés) | [batchEdit.ts](../../../src/lib/batchEdit.ts) | `REPLACE_TRACKS` |
| `addChapterAt` / `applyAiChapters` | rendezés + dedup | `SET_CHAPTERS` |
| `markersFromBeats` | beat-rács | `SET_MARKERS` |

> **Következmény:** a nehéz vágó-matek a `lib/`-ben él (tesztelt, store-mentes), a
> store-ban már csak projekt-keresés + `dispatch` marad. A frame-rácsra ültetés
> (`snapToFrame`) garantálja, hogy fél kocka csúszás se maradjon.

## 7. Ugyanaz a lánc — csak az `actor` más

A rendszer legfontosabb szimmetriája: a felhasználó és az AI **ugyanazon a buson**
dolgozik. Az [AI](./ai.md) kimenete whitelist-validált command lesz
([aiCommands.ts](../../../src/lib/aiCommands.ts) `toEditorCommands`), és
`applyBatch(commands, 'ai')`-ként fut → **validált, undo-zható**, a napló pedig
`ai:`-ként jelöli. Semmilyen külön „AI-út" nincs a state-be
([ADR-006](../decisions/ADR-006-ai-as-command-source.md)).

```
  felhasználó (borotva/panel/gesztus)          AI (chat)
            │                                      │
            ▼                                      ▼
      EditorCommand                          toEditorCommands() → EditorCommand[]
            │                                      │
      dispatch(cmd,'user')                   applyBatch(cmds,'ai')
            └──────────────────┬───────────────────┘
                               ▼
                    applyCommand (ugyanaz a reducer)
```

## 8. Bővítés — hogyan adjunk új parancsot

1. Vedd fel a `EditorCommand` unióba ([commands.ts](../../../src/lib/commands.ts)).
2. Kezeld le a `applyCommand` reducerben (pure, immutábilis, `null` no-op-ra).
3. Ha „nehéz" (klip-tömb/réteg), jelöld a [eventLog.ts](../../../src/lib/eventLog.ts)
   `isHeavyCommand`/`slimForLog`-jában.
4. Adj hozzá tesztet (`commands`/az érintett lib-mag `*.test.ts`).
5. Ha az AI is kiadhatja, bővítsd a whitelistet ([ai.md](./ai.md)) — **ez
   szerződés-változás, ADR-t érdemel**.

## 9. Kapcsolódások

- Undo/redo és session ≠ projekt → [state.md](./state.md)
- Az AI-út részletei → [ai.md](./ai.md)
- A döntés indoklása → [ADR-001](../decisions/ADR-001-command-bus.md)
