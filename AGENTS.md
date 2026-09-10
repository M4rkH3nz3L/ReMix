# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# vided — projekt-jegyzetek

Interaktív videószerkesztő; architektúra és állapot a README.md-ben.

- Forrás a `src/` alatt (`@/` alias) — képernyők: `src/app/` (expo-router).
- Egy rAF-mesteróra (`src/hooks/usePlaybackClock.ts`) hajtja a lejátszást; a
  videó/hang rétegek (`src/components/preview/`) ehhez szinkronizálnak — új
  időzített funkció a playheadből számoljon, ne saját órából.
- Minden szerkesztő-művelet a zustand store `mutateProject`-jén megy át (undo!).
- Idő mindenhol másodpercben, vászon-pozíciók 0–1 normalizálva.
- Ellenőrzés: `npx tsc --noEmit` + `npm run lint` (a `react-hooks/immutability`
  és `react-hooks/refs` szabályok szándékosan kikapcsolva — Reanimated shared
  value-k és expo-video/audio player-mutációk miatt).
