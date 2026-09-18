# State — zustand, session ≠ projekt, autosave

> Forrás: [Arch.md](../../../Arch.md) 4.1 szakasz +
> [store/](../../../src/store/) + a kód. ↑ [docs/hu index](../README.md)

Az állapot a **Shared Core** része: több zustand-store, amelyek közül a
[editorStore](../../../src/store/editorStore.ts) a szerkesztő szíve. A
kulcs-tanulság nem az, hogy „zustandot használunk" — hanem **hol húzódik a határ
az igazság (projekt) és a munkamenet (session) között**, és hogyan marad minden
mutáció egyetlen, undo-zható csővezetéken.

## 1. A store-ok és a felelősségük

| Store | Felelősség | Kulcs |
|---|---|---|
| [editorStore.ts](../../../src/store/editorStore.ts) | projekt + kijelölés + playhead + undo/redo + session-módok | `dispatch`, `applyBatch` |
| [authStore.ts](../../../src/store/authStore.ts) | Supabase-munkamenet (be/kijelentkezés, user) | — |
| [entitlementStore.ts](../../../src/store/entitlementStore.ts) | Pro-jogosultság (szerver-autoritatív) | `isProNow()` |
| [paywallStore.ts](../../../src/store/paywallStore.ts) | paywall láthatóság/ok | — |
| [progressStore.ts](../../../src/store/progressStore.ts) | render/feltöltés progressz-overlay | — |
| [notificationStore.ts](../../../src/store/notificationStore.ts) | értesítések, jelvény | — |
| [collabStore.ts](../../../src/store/collabStore.ts) | kollaboráció (tagok, szerep) | — |

A `isProNow()`-t a [backend-router](./networking.md) olvassa a Pro-kapuhoz — a
state-réteg így **egyetlen forrás** a jogosultságnak is.

## 2. A határvonal: projekt-igazság vs. session-állapot

Ez a legfontosabb architekturális döntés a store-ban
([ADR-005](../decisions/ADR-005-session-vs-project-state.md)).

- **Projekt = igazság.** A `project` (`Project`) minden tartós adata *kizárólag*
  a [command buson](./commands.md) át változhat → undo-zható, naplózott, renderbe
  kerül.
- **Session ≠ igazság.** A monitorozó/szerkesztő-módok — `mutedTracks`,
  `soloTracks`, `hiddenTracks`, `lockedTracks`, `trimMode`, `snapStrength`,
  `focusMode`, `razorMode`, `variantPreview`, `rangeIn/Out` … — a
  `SESSION_RESET`-ben élnek: **nem kerülnek a projektbe, nem hatnak a renderre**,
  és projekt-nyitáskor/záráskor egy közös konstansból nullázódnak.

> **A csapda, amit ez kizár:** a sáv-némítás session-szintű, ezért sosem lesz
> „miért hiányzik a zene az exportból?" meglepetés. A végleges elnémításra a klip
> `volume`-ja való — ami *projekt-adat, command buson*. (Lásd a
> [editorStore.ts](../../../src/store/editorStore.ts) `SESSION_RESET` kommentjét.)

Ugyanez az elv miért fontos: a `mutedTracks` átragadása a következő projektre már
kétszer okozott beragadt módot — ezért a reset **egy** helyen van, és nyitáskor
ÉS záráskor ugyanaz fut.

## 3. Az undo/redo-modell

A [editorStore](../../../src/store/editorStore.ts) **teljes projekt-
pillanatképeket** tart (`past` / `future`), immutábilis cserével:

```
dispatch(cmd) ─▶ applyCommand(project, cmd) ─▶ next Project
                      │
                      ├─ past  = [...past.slice(-49), project]   (HISTORY_LIMIT = 50)
                      ├─ future = []                              (új ág → a redo elévül)
                      ├─ dirty  = true
                      └─ events = [...events, event].slice(-300)  (EVENT_LIMIT = 300)
```

- **Kötegek:** `applyBatch(commands, actor)` egyetlen pre-batch pillanatképet tesz
  a `past`-ba → egy undo az egész AI-köteget/presetet visszavonja.
- **Undo után a kijelölés elévül:** a klip-készlet változhatott (törölt/összevont
  klipek), ezért `undo`/`redo` nullázza a `selectedClipId`-t és a több-kijelölést —
  különben árva id-k maradnának.
- **Az esemény-napló NEM undo-adat:** az `events[]` külön él (az undo nem törli),
  ő az [AI-memória](./ai.md) és a provenancia nyersanyaga; a „nehéz" mezők
  csonkolva ([eventLog.ts](../../../src/lib/eventLog.ts)).

## 4. Autosave

- **Draft AsyncStorage-ba**, ~0,8 mp debounce-szal ([README.md](../../../README.md));
  a perzisztálás magja a [storage.ts](../../../src/lib/storage.ts), a szerkesztő-
  képernyő a `dirty` flaget figyeli és ment.
- **`markSaved()`** törli a `dirty`-t mentés után.
- **Miért slim a napló:** a teljes klip-tömbök újraírása autosave-nként MB-okat
  jelentett; a `dispatch` a naplóba a *könnyített* commandot teszi
  ([eventLog.ts](../../../src/lib/eventLog.ts) `slimForLog`/`isHeavyCommand`), a
  `project`/`past` természetesen teljes marad.
- **A renderelt változat artefaktum:** `setRendered()` a projekthez köti a kész
  MP4-et, de **nem** undo/dirty-esemény (a `RenderedVersion` műtermék, nem
  szerkesztés).

## 5. Kijelölés, több-kijelölés, stílus-fanout

- `selectedClipId` = az elsődleges („főszereplő") klip; a panelek ezt szerkesztik.
- `multiSelectIds` = a köteg (csak **azonos fajtájú** klip vehető hozzá).
- **A panelek nem tudnak a több-kijelölésről:** az `updateClip` a stílus-jellegű
  mezőket fanoutolja a kötegre is, sávonként újraépítve, EGY undo-lépésben
  ([batchEdit.ts](../../../src/lib/batchEdit.ts)) — a `REPLACE_TRACKS` commanddal.
- Kényelmi selectorok: `selectSelectedClip`, `selectPanelVisible`
  ([editorStore.ts](../../../src/store/editorStore.ts) alja).

## 6. Kapcsolódások

- Hogyan validálódik és naplózódik egy mutáció → [commands.md](./commands.md)
- Miért session a monitorozás → [ADR-005](../decisions/ADR-005-session-vs-project-state.md)
- A Pro-jogosultság útja a kapuig → [networking.md](./networking.md)
