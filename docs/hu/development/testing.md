# Tesztelés

> Forrás: [Arch.md](../../../Arch.md) 11. szakasz + [package.json](../../../package.json) +
> a kód. ↑ [docs/hu index](../README.md) · mérések: [quality-baseline.md](./quality-baseline.md),
> [quality-report.md](./quality-report.md)

## 1. A merge-kapu

```bash
npm run audit    # = typecheck (kliens + worker) + expo lint + jest
```

Külön is:

```bash
npm run typecheck      # tsc --noEmit  +  tsc -p server/tsconfig.json (a // @ts-check-es worker-fájlok)
npm run lint           # expo lint (a szándékos hook-kivételekkel)
npm test               # jest — kliens + worker + build, egy futtatóban (jest.config.js projects)
npm run test:watch     # jest --watch
npm run test:mutation  # Stryker a kritikus magokra (lassú; a CI éjszaka futtatja)
npm run test:rls       # a helyi Supabase-DB invariánsai (Docker: supabase_db_ReMix)
```

Konfiguráció: [jest.config.js](../../../jest.config.js) (három projekt: `client` a jest-expo
presettel, `server` és `build` sima Node-dal) + [jest.setup.js](../../../jest.setup.js).

## 2. Tesztpiramis

| Szint | Mit | Hol | Arány |
|---|---|---|---|
| **Egység (tiszta mag)** | Az expo-mentes `src/lib/` és a worker tiszta függvényei | `src/**/*.test.ts`, `server/**/*.test.js` | a zöme |
| **Property** | Invariánsok véletlen bemeneten (fast-check, rögzített seed) | `*.property.test.ts/js` | a kritikus magokon |
| **Kontraktus** | Kliens ↔ worker tükrök (tier-kvóták, effekt-filterek, betűk) | [contract.test.ts](../../../src/lib/contract.test.ts), `*.contract.test.ts` | minden tükörre |
| **Komponens / store** | React-fa (react-test-renderer) és a zustand-store műveletei | `src/**/*.test.tsx`, `src/store/*.test.ts` | ahol a logika UI-hoz kötött |
| **Renderer (képpont, hang)** | A valódi szerveres render (Chromium + ffmpeg) az előnézet ellen | `image*.test.ts`, `server/imagedoc*.test.js`, hang-paritás | a paritás-kapuk |
| **DB** | RLS, Coin-gazdaság, verseny-helyzetek (SQL) | `supabase/tests/` | a pénz és a jogosultság |
| **Eszköz** | Deep linkes füstteszt iPaden (`src/dev/smoke/`) | `remix://dev-image-smoke?phase=…` | kézi / mérési kör |

**Új teszt helye:** `src/**/*.test.ts(x)` (kliens) vagy `server/**/*.test.js` (worker). A **nehéz logikát a
`lib/` magba told** ([coding-standards.md](./coding-standards.md)) — akkor tesztelhető. Refaktor ELŐTT
legyen a mostani viselkedést rögzítő (karakterizációs) teszt.

## 3. Mikor írj property-tesztet

Ha a függvénynek **invariánsa** van, ami minden bemenetre igaz kell legyen — és nem csak néhány példára:

- a reducer (`applyCommand`): nem mutál, séma-érvényes marad, frame-rácson marad, undo∘do = azonosság
  ([commands.property.test.ts](../../../src/lib/commands.property.test.ts));
- pénz: kerekítés iránya és determinizmusa, egyenleg-korlátok, fail-closed szint
  ([money.property.test.js](../../../server/money.property.test.js)).

Szabály: **rögzített seed** (`{ seed, numRuns }`), hogy a futás determinisztikus legyen; bukáskor a
fast-check a minimális ellenpéldát adja — azt példa-tesztként is vedd fel.

## 4. Mikor futtass mutációs tesztet

A [stryker.config.mjs](../../../stryker.config.mjs) `mutate` listáján a pénz- és projektintegritás-kritikus
fájlok vannak (reducer, tier, billing, Coin, kifizetés, kvóta, felhasználás, `server/security/`). Ha ilyen
fájlt módosítasz, futtasd (vagy egy fájlra: `npm run test:mutation -- --mutate server/quota.js`). Cél:
**≥ 80 % mutation score** (a `break` küszöb). A túlélő mutánst **értelmes assert** ölje meg, ne kizárás.

A sandbox a projekten kívül (OS tmp) van: a futó Metro így nem látja a mutált fájlokat — `inPlace` módot ne
használj.

## 5. Renderer-függő tesztek

A Chromiumot / ffmpeg-et igénylő teszteket a közös helper kapuzza
([server/testing/renderer.js](../../../server/testing/renderer.js)):

```ts
import { describeIfRenderer, itIfRenderer } from '../../server/testing/renderer';

const RASTER = { chromium: true, ffmpeg: true };   // ffmpeg: '8.1' → minimum-verzió
describeIfRenderer('a kész kép …', RASTER, () => { … });
const itRaster = itIfRenderer(RASTER);              // vegyes blokkban tesztenként (.each is)
```

- **Lokálisan** a hiányzó eszköz miatt a blokk érthető címmel átugrik (`[átugorva: nincs Chromium …]`) —
  nem hamis bukás.
- **CI-ben** (`CI=true`) bukó tesztté válik, ami megnevezi a hiányt: egy csendben átugrott minőségkapu
  nem kapu. A CI-konténer Chromiumot és ffmpeg 8.1-et telepít (`CHROMIUM_PATH`).
- Csak a ténylegesen renderer-függő tesztet kapuzd; a tiszta-logikai tesztek fussanak nélküle is.
- Az **ffmpeg** a worker kemény előfeltétele: néhány képpont-suite a `beforeEach`-ben is hívja, ffmpeg
  nélkül ezek a gyűjtésnél elhasalnak. Lokális fejlesztéshez telepítsd (`brew install ffmpeg`).

## 6. Coverage és ratchet

- Mérő: **V8** (`coverageProvider: 'v8'`). Az istanbul a `page.evaluate`-nek átadott függvényekbe is
  számlálót injektált, ami a Chromiumban nem létezik → a renderer-tesztek hamisan buktak.
- A CI a teljes futás összesítőjét a [coverage-floor.json](../../../scripts/quality/coverage-floor.json)
  padlóhoz méri ([coverage-ratchet.js](../../../scripts/quality/coverage-ratchet.js)); a padló alá esés
  bukás (0,1 %-pont tűrés). Emelés: `npx jest --coverage --coverageReporters=json-summary` után
  `node scripts/quality/coverage-ratchet.js --update` — a padló **csak felfelé** mozdul.
- Fájlméret-kapu ([file-size.js](../../../scripts/quality/file-size.js)): új forrásfájl ≤ 1000 sor; a
  [large-files.json](../../../scripts/quality/large-files.json) óriásfájljai nem nőhetnek.

## 7. Determinizmus

- Nincs `Math.random` / valós idő a döntő ágban: rögzített seed (`seededRandom`), injektált `now`, vagy
  `jest.useFakeTimers().setSystemTime(…)`.
- A store-tesztek tesztenként tiszta állapotból indulnak; a projektváltást túlélő session-mezőket
  (vágólap, detent-memória) a `beforeEach` nullázza. A létrehozott React-fákat bontsd le (`unmount`) — a
  gesture-handler testID-regisztere globális.
- Ellenőrzés: `npx jest --randomize` (véletlen sorrend); 3 egymás utáni futásnak tesztenként azonos
  eredményt kell adnia.

## 8. A típus-rendszer mint folyamatos audit

Nem minden ellenőrzés jest-teszt. A [capabilities.ts](../../../src/lib/capabilities.ts)
`{ where, pro }` diszkriminált uniója **fordítási hibát** ad a tiltott
kombinációra ([ADR-004](../decisions/ADR-004-capability-gating.md)) — vagyis a
`tsc --noEmit` maga is üzleti-szabály-audit. A worker fokozatosan JSDoc-típusos: a `// @ts-check`-kel
jelölt fájlok a [server/tsconfig.json](../../../server/tsconfig.json) alatt `strict` módban futnak.

## 9. Bizonytalan viselkedés

Ha egy viselkedésről nem tudod, szándékos-e: **ne találgass** — írj rá tesztet, ami a MAI viselkedést
rögzíti, jelöld `// KÉRDÉS:` kommenttel, és vedd fel a [quality-report.md](./quality-report.md) nyitott
kérdései közé.
