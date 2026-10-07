# ADR-011 — Fix kanonikus sávmodell (nem szabad több-lane)

> ↑ [docs/hu index](../README.md) · [architecture/state.md](../architecture/state.md)

- **Státusz:** Elfogadva (2026-10-08)
- **Horgony:** [projectUtils.ts](../../../src/lib/projectUtils.ts) (`CANONICAL_TRACKS`, `canHostClip`) · [CORE.md §2.5](../../../devs/tasks/CORE.md)

## Kontextus
A projekt **fix** sávkészlettel indul (`CANONICAL_TRACKS`): típusonként EGY sáv —
`video`, `pip`, `adjust`, `text`, `captions`, `overlay`, `interactive`, `music`,
`voiceover`, `sfx`. Egy „komoly" NLE-ben a felhasználó tetszőleges számú lane-t
hozhat létre (2., 3. videó-sáv…), átnevezhet, átrendezhet. A CORE-terv (§2.5)
eldöntendőként tette fel: **(A)** több-lane bevezetése (a sáv-azonosítás `type`-ról
`trackId`-ra, sáv add/remove/rename parancsokkal, lánc-széles változás) **vagy**
**(B)** a fix modell formális rögzítése.

## Döntés
**A fix kanonikus sávmodell marad (B)** — a launchig és azon túl is, amíg nincs
desktop-shell. A „több vizuális réteget" a meglévő rétegsávok adják: a `pip` (kép-
a-képben), az `overlay` (matrica/forma) és az `adjust` (grade) a `video` fölött
rétegződik; a klip sávok közti mozgatását a [`MOVE_CLIP`](./ADR-001-command-bus.md)
+ a `canHostClip` kompatibilitás-guard adja (CORE §2.3).

## Miért
- **Mobil-UX:** a fix, nevesített sávok áttekinthetőek egy telefon-képernyőn; a
  tetszőleges lane-kezelés (add/rename/reorder) desktop-méretű idővonalat kíván.
- **Lánc-stabilitás:** a `type`-alapú azonosításra épül a teljes lib-réteg
  (`trackOf`, migrációk, ripple/roll/slip/slide, pre-compose, az AI cut-listák,
  a render-sorrend). A `type → trackId` átállás lánc-széles, kockázatos refaktor —
  a mag 100%-ra vitelének ([CORE.md](../../../devs/tasks/CORE.md)) nem előfeltétele.
- **A rétegzés már megvan:** a `pip`/`overlay`/`adjust` a gyakorlatban fedi a
  több-réteg igény nagy részét, új modell nélkül.

## Elvetett alternatíva
- **(A) Szabad több-lane most** — nagy, lánc-széles változás (`trackId`-azonosítás +
  sáv-CRUD parancsok), amit a mobil-UX nem indokol a launchig. Ha később előjön a
  termék-igény (desktop-shell, [ADR-007](./ADR-007-hybrid-render.md) utáni expanzió),
  külön epik-ként, a `MOVE_CLIP`-re építve vezethető be.

## Következmények
- Új klip-fajta → a `TRACK_HOSTS` térképbe (projectUtils) kerül, nem új lane-be.
- A sáv-azonosítás a parancsokban `trackType` marad (nem `trackId`).
- Ha a (A) valaha megvalósul, ez az ADR-t egy követő ADR váltja le.

## Kapcsolódó
[ADR-001](./ADR-001-command-bus.md) · [ADR-005](./ADR-005-session-vs-project-state.md) · [CORE.md §2.3/§2.5](../../../devs/tasks/CORE.md).
