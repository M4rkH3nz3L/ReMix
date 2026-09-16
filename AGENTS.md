# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# vided — projekt-jegyzetek

Interaktív videószerkesztő; architektúra és állapot a README.md-ben.

- Forrás a `src/` alatt (`@/` alias) — képernyők: `src/app/` (expo-router).
- Egy rAF-mesteróra (`src/hooks/usePlaybackClock.ts`) hajtja a lejátszást; a
  videó/hang rétegek (`src/components/preview/`) ehhez szinkronizálnak — új
  időzített funkció a playheadből számoljon, ne saját órából.
- Minden szerkesztő-művelet a **command buson** megy át (undo!):
  `useEditorStore.dispatch(command, actor)` — köteghez `applyBatch(commands, actor)`
  —, amit a `src/lib/commands.ts` `applyCommand()` pure reducere hajt végre.
  A projektet SOHA ne írd közvetlenül (nincs `.tracks.push`, `.clips.splice`,
  `setState` a store-on kívül).
- Idő mindenhol másodpercben, vászon-pozíciók 0–1 normalizálva. A vágások és
  kulcskockák a projekt **frame-rácsára** ülnek (`src/lib/frames.ts`,
  `project.fps`; a timecode `HH:MM:SS:FF`).
- A `src/lib/` magok szándékosan expo-mentesek → önmagukban tesztelhetők; a
  hálózati réteg a hozzájuk tartozó `*Client.ts`-ben van.
- Ellenőrzés: **`npm run audit`** (= `tsc --noEmit` + `expo lint` + `jest`).
  A `react-hooks/immutability` és `react-hooks/refs` szabályok szándékosan
  kikapcsolva — Reanimated shared value-k és expo-video/audio player-mutációk
  miatt. Új teszt: `src/**/*.test.ts` (kliens) vagy `server/**/*.test.js` (worker).
- A nyitott technikai adósság és a go-live blokkolók: `AUDITBUGS.md`.
