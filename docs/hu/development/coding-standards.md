# Kódolási szabályok

> Forrás: [AGENTS.md](../../../AGENTS.md) + [Arch.md](../../../Arch.md) + a kód.
> ↑ [docs/hu index](../README.md)
>
> Ez a doksi a **kötelező** szabályokat gyűjti; a *miért*-et az architektúra-
> doksik és az ADR-ek adják. Ha ütközés van, az [AGENTS.md](../../../AGENTS.md) a
> mérvadó (azt olvassa az ügynök is).

## 1. A megkerülhetetlen szabály — command bus

A projektet **SOHA** nem írjuk közvetlenül: nincs `.tracks.push`, `.clips.splice`,
sem store-on kívüli `setState`. Minden mutáció `dispatch(command, actor)` /
`applyBatch(commands, actor)` ([commands.md](../architecture/commands.md),
[ADR-001](../decisions/ADR-001-command-bus.md)).

## 2. Idő, pozíció, frame-rács

- **Idő mindenhol másodpercben.** Vászon-pozíciók/méretek **0–1 normalizálva**.
- A vágások és kulcskockák a projekt **frame-rácsára** ülnek
  ([frames.ts](../../../src/lib/frames.ts), `project.fps`); a timecode
  `HH:MM:SS:FF`. Új vágás → `snapToFrame`.

## 3. Réteg-fegyelem

- **`src/lib/` = expo-mentes mag** → önmagában tesztelhető. A hálózat a párja
  `*Client.ts`-ében van; a cím/kapu a [backend.ts](../../../src/lib/backend.ts)-ben
  (soha ne írj kézzel worker-URL-t).
- **`@/` alias** a `src/`-re; a képernyők `src/app/` alatt (expo-router).
- **Irányított függőség:** fentről lefelé szabad hivatkozni, visszafelé nem
  ([Arch.md 2. szakasz](../../../Arch.md)).

## 4. Idő és render

- **Új időzített funkció a `playhead`-ből számoljon**, ne saját órából
  ([ADR-002](../decisions/ADR-002-master-clock.md)).
- **Új effekt sorrendje:** modell-mező + render-paritás **először**, előnézeti
  közelítés **utána** ([ADR-003](../decisions/ADR-003-preview-render-parity.md)).

## 5. Session ≠ projekt

Átmeneti szerkesztő-mód a `SESSION_RESET`-be kerül, NEM a `Project`-be
([ADR-005](../decisions/ADR-005-session-vs-project-state.md)).

## 6. i18n

Minden felhasználói szöveg i18next-kulcson át
([src/i18n/](../../../src/i18n/); locales: `de` / `en` / `hu`). Nincs beégetett
string a UI-ban.

## 7. Lint-kivételek (szándékosak)

A `react-hooks/immutability` és `react-hooks/refs` **ki van kapcsolva** —
Reanimated shared value-k és expo-video/audio player-mutációk miatt. Ne
„javítsd vissza".

## 8. Platform-doksi kötelező

Kód írása **előtt** a verziózott Expo-doksi a mérvadó:
<https://docs.expo.dev/versions/v57.0.0/> ([AGENTS.md](../../../AGENTS.md)).
LLM/Claude-érintésnél a `claude-api` referencia.

## 9. Szerződés-változás = ADR

A `EditorCommand` unió vagy az AI `PATCHABLE_FIELDS` whitelist bővítése a
kliens–AI/kliens–worker **szerződését** érinti → külön ADR
([decisions/](../decisions/)), ne csendben.

## 10. Merge-kapu

Commit előtt **`npm run audit`** (lásd [testing.md](./testing.md)).
