# Collaboration — megosztott projekt és az operation-szinkron terve

> Forrás: [Arch.md](../../../Arch.md) 4. + 9.5 szakasz +
> [collab.ts](../../../src/lib/collab.ts) · [collabStore.ts](../../../src/store/collabStore.ts) ·
> [supabase/migrations/](../../../supabase/migrations/). ↑ [docs/hu index](../README.md)

## 1. Miért „készen áll rá" a mag

A [command bus](./commands.md) minden művelete **szerializálható** (`EditorCommand`),
és minden művelet bekerül az `actor`-jelölt [esemény-naplóba](./state.md). Ez a
két tulajdonság az **operation-alapú szinkron** természetes alapja — a
kollaboráció nem utólagos ráültetés, hanem a bus-architektúra következménye
([ADR-001](../decisions/ADR-001-command-bus.md)).

## 2. Jelenlegi állapot — megosztott projekt + szerepkörök

[collab.ts](../../../src/lib/collab.ts) (Supabase-háttérrel):

- **Szerepkörök:** `CollabRole = 'owner' | 'editor' | 'viewer'`.
- **Megosztás:** `ensureShared(project)` → a projekt megosztott rekordja
  (`SharedProject`); `listMembers()`, `myRole()`, `myMembership()`.
- **Tag-kezelés:** `inviteMember()` (added/pending/self), `changeRole()`,
  `removeMember()`, `leaveProject()`.
- **Nekem megosztott:** `listSharedWithMe()` → `pullSharedProject()`.
- **Realtime:** `subscribeMembers(projectId, onChange)` — a tag-lista élőben
  frissül (Supabase Realtime).
- **UI + store:** [app/collab/[id].tsx](../../../src/app/collab/[id].tsx),
  [collabStore.ts](../../../src/store/collabStore.ts).

**Backend:** a `project_collaboration` + `cloud_projects` migrációk
([supabase/migrations/](../../../supabase/migrations/)), **RLS**-szerepkörökkel (a
jogosultság a DB-ben dől el, nem a kliensben).

## 3. Remix mint aszinkron kollaboráció

A social réteg egy másik együttműködés-forma: a **poszt = a projekt JSONB-
snapshotja** → egy koppintásos **Remix** ([feed.ts](../../../src/lib/feed.ts),
`RemixGraphModal`). A `remixOf` lineage-lánc bejárható
([types/project.ts](../../../src/types/project.ts) `remixOf`). Így a „másoktól
tanulás" a platform szerkezetébe van kódolva — nem kell közös session hozzá.

## 4. Nyitott kérdések — a valós együttszerkesztéshez

A jelenlegi modell **projekt-szintű** megosztás (birtokos + szerepkörök), **nem**
élő, egyidejű együttszerkesztés. A következő szint terve (a bus miatt reális):

- **Operation-stream:** a `dispatch`-elt commandok küldése/fogadása egy realtime
  csatornán, `actor`-ral (ki melyik szerkesztő).
- **Konfliktus-feloldás:** két egyidejű command ütközése (pl. ugyanaz a klip) —
  utolsó-nyer vs. szándék-megőrző merge; a session-állapot (kijelölés) NEM utazik
  ([ADR-005](../decisions/ADR-005-session-vs-project-state.md)).
- **Prezencia:** ki hol van (playhead/kijelölés) — tisztán session, a projekten
  kívül.

> Ezek **terv-szintűek**; a jelen doksi rögzíti, miért nem kell hozzá
> architektúra-váltás, csak a meglévő bus kiterjesztése.

## 5. Kapcsolódások

- A szerializálható műveletek → [commands.md](./commands.md)
- Miért nem utazik a session-állapot → [ADR-005](../decisions/ADR-005-session-vs-project-state.md)
- A felhő-projekt tárolása → [storage.md](./storage.md)
