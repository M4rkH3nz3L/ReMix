# Minőségi jelentés — QUALITY-sorozat (2026-11-19/20)

> Viszonyítási alap: [quality-baseline.md](./quality-baseline.md) (`7418316`). Szabályok és kapuk:
> [testing.md](./testing.md). ↑ [docs/hu index](../README.md)
>
> Cél: a karbantarthatóság és a tesztek erejének mérhető javítása **funkcióbővítés nélkül**, a
> viselkedés megtartásával. Minden lépés külön commit, `npm run audit` zölden.

## 1. Előtte / utána

| Mutató | Előtte (0. fázis) | Utána | Megjegyzés |
|---|---|---|---|
| Teszt-suite / teszt | 535 / 5341 | **561 / 5986** | +26 suite, +645 teszt |
| `npm test` (sima, 10 mag) | 41,0 s | **39,8 s** | a teljes `npm run audit` 64 s |
| Coverage — sor (V8, összes) | 73,88 % | **74,69 %** | a baseline istanbul-mérése 65,09 % volt, a coverage-futás 4 suite-ot hamisan buktatott |
| Coverage — branch (V8, összes) | 81,69 % | **82,84 %** | istanbul-baseline: 57,92 % |
| Kritikus magok branch (babel) | 0–100 %, `quota.js` 0 %, `payouts.js` 3,8 % | **mind ≥ 92 %** | részletek: 3. szakasz |
| Mutation score (kritikus magok) | **59,67 %** | **85,85 %** | Stryker, ugyanaz a `mutate`-lista; utána minden fájl ≥ 81 % (3. szakasz) |
| `any` (valódi típus-használat) | 10 | **10** | nem nőtt; a worker-típusozás 0 új `any` |
| `@ts-ignore` / `@ts-nocheck` | 0 / 0 | 0 / 0 | |
| `eslint-disable` | 82 (0 soron belül indokolt) | **66 (mind indokolt)** | 16 felesleges törölve |
| Lint-figyelmeztetés | 111 | **70** | 0 hiba mindkettőnél |
| `// @ts-check` worker-fájl (strict tsc) | 0 | **21** | `server/tsconfig.json` |
| 500 sornál hosszabb fájl | 65 | 81* | *a bontásokból több 500–1000 soros modul lett |
| 1000 sornál hosszabb fájl | 16 | **12** | új nincs; a CI tiltja |
| Legnagyobb fájl | 13 975 (`imageSmoke.tsx`) | 1 531 (`Timeline.tsx`) | |
| iOS éles bundle (`.hbc`) | 18,10 MB | **18,00 MB**† | a smoke-kód nélkül |

† Ugyanazon a fán mérve (`expo export --clear`, iOS Hermes): a smoke-kóddal 19 741 689 bájt, nélküle
17 996 613 bájt — **−1,75 MB (−8,8 %)**. Az abszolút érték a közös munkafában közben bekerült (más
munkamenetből származó) Sentry-integrációt is tartalmazza, ezért a baseline 18,10 MB-tal csak a
különbség vethető össze pontosan.

## 2. Mi történt fázisonként

| Fázis | Eredmény | Commitok |
|---|---|---|
| 0. Kiinduló mérés | [quality-baseline.md](./quality-baseline.md) | `7418316` |
| 1. Determinisztikus tesztkörnyezet | közös renderer-kapu (`describeIfRenderer` / `itIfRenderer`): Chromium nélkül 0 hamis bukás (előtte 46), CI-ben kötelező; V8-coverage (a coverage-futás zöld); 3 egymás utáni futás tesztenként azonos; a véletlen sorrend 2 izolációs hibát hozott — javítva | `a199cd0` `ea4ab1e` `40999d3` |
| 2. Kritikus magok tesztjei | fast-check property-tesztek (reducer, pénz), a reducer minden parancsa, pénz-utak és security ≥ 90 % branch, Stryker 59,67 → 85,85 % | `f592983` `8e88710` `4ba17f7` `53358cf` `03916ed` `ca500d6` + a mutáns-ölő commit |
| 3. Típusbiztonság a szerveren | `server/tsconfig.json` (strict, JSDoc), 21 fájl `// @ts-check`-kel hibátlan, a `typecheck` a workert is ellenőrzi; a tier-tükör teljes értékkészlete zárolva | `378b7ce` `d78b9cc` |
| 4. Óriásfájlok bontása | `imageSmoke.tsx` → `src/dev/smoke/` (17 modul) és ki az éles bundle-ből; `types/project.ts` → 9 modul; `server/render.js` 3328 → 288 (+15 modul); `ImageStudioBody` 2992 → 1444; `AudioStudioBody` 2303 → 738 | `5b7e289` `be2892d` `75e1db0` `015dd28` `1842ada` |
| 5. Lint és kapuk | minden `eslint-disable` indokolt; CI: coverage-ratchet, fájlméret-kapu, éjszakai Stryker | `e4471d4` `e3b0047` |
| 6. Dokumentáció | `devs/`-hivatkozások, ReMix-név, ADR-index (13), testing.md | `fd437a3` |

**Eszközön ellenőrizve (iPad Pro, dev-build, USB-s Metro):** a bontott füstteszt-modulok betöltődnek;
`thumbdoc` 7/7, `nativespeed` 4/4, `fontimport` 6/6, `videoaudio` 7/7 (ez a bontott szerveres
renderen át renderelt), `studiomodes` 7/7 (a bontott Hang Stúdió transport- és módsávja), a Kép Stúdió
megnyílik a bontott komponensekkel (JS-szál legnagyobb akadása 20 mp alatt 9 ms), a Hang Stúdió
`audioruler` 2/2. A `fontimport` és a `videoaudio` első futása a nem futó helyi worker miatt bukott —
a worker indítása után zöld.

## 3. A kritikus magok lefedése (babel/istanbul branch)

| Fájl | Előtte | Utána |
|---|---|---|
| `src/lib/commands.ts` | 82,2 % | **96,8 %** |
| `src/lib/tiers.ts` | 94,4 % | **100 %** |
| `server/tiers.js` | 100 % | 100 % |
| `server/billing.js` | 51,1 % | **100 %** |
| `server/coinSettle.js` | 67,6 % | **100 %** |
| `server/payouts.js` | 3,8 % | **100 %** |
| `server/payoutRunner.js` | 60,0 % | **100 %** |
| `server/quota.js` | 0 % | **98,0 %** |
| `server/usage.js` | 56,4 % | **99,3 %** |
| `server/security/*` (13 fájl) | 47–100 % | **92,4–100 %** |

A Coin-egyenleg nem-negativitása, az atomikus vásárlás és a párhuzamos terhelés a DB-ben él —
`npm run test:rls`: 283 ellenőrzés zöld (köztük `coin_race`).

### Mutation score fájlonként (Stryker, `npm run test:mutation`)

| Fájl | Előtte | Utána |
|---|---|---|
| `src/lib/commands.ts` | 69,5 % | **81,2 %** |
| `src/lib/tiers.ts` | 91,3 % | **93,5 %** |
| `server/tiers.js` | 93,9 % | **95,7 %** |
| `server/billing.js` | 41,8 % | **95,6 %** |
| `server/coinSettle.js` | 59,0 % | **93,8 %** |
| `server/payouts.js` | 0 % | **92,1 %** |
| `server/payoutRunner.js` | 57,0 % | **97,0 %** |
| `server/quota.js` | 0 % | **94,3 %** |
| `server/usage.js` | 54,9 % | **89,6 %** |
| `server/security/mediaPolicy.js` | 66,9 % | **99,3 %** |
| `server/security/auditLog.js` | 79,1 % | **100 %** |
| `server/security/renderAuth.js` | 78,1 % | **87,5 %** |
| `server/security/rtmpUrl.js` | 50,2 % | **90,2 %** |
| `server/security/authorization.js` | 58,9 % | **92,2 %** |
| `server/security/rateLimit.js` | 58,3 % | **84,0 %** |
| `server/security/uploadPolicy.js` | 45,2 % | **85,5 %** |
| `server/security/redact.js` | 57,3 % | **96,6 %** |
| `server/security/prodGates.js` | 66,0 % | **98,0 %** |
| `server/security/ownedKey.js` | 79,2 % | **95,8 %** |
| `server/security/accountErase.js` | 81,7 % | **86,7 %** |
| `server/security/notifyPolicy.js` / `securityHeaders.js` | 98,3 / 100 % | 98,3 / 100 % |
| **Összesen** | **59,67 %** | **85,85 %** (a 3 gyenge fájl utánjavítása előtt mérve) |

A túlélőket assertek ölték meg, kizárás nélkül. A megmaradt ekvivalens mutánsok (pl. a `renderAuth` 28.
sorának redundáns őr-feltétele) a commit-üzenetekben indokolva.

## 4. Talált valódi hibák (mind külön commitban, a hibát bizonyító teszttel)

1. **Dupla kifizetés** (`c1c00ac`) — ha a PayPal/Stripe utalás sikerült, de a `paid` állapotírás
   elbukott, a runner `failed`-re állította a kérést, és a DB visszaírta a Coint: a felhasználó a
   pénzt és a Coint is megkapta. Most a kérés `processing`-ben marad (kézi egyeztetés).
2. **SSRF-rés az RTMP-célban** (`b0d6380`) — a `[::ffff:127.0.0.1]` / `[::ffff:169.254.169.254]`
   literált a URL-parser hex alakra normalizálja, amit a tiltólista nem ismert → loopback és
   felhő-metadata engedett volt. Most a hex alak is a v4-szabály alá esik, minden más `::ffff:` tiltott.
3. **A várakozó render-job nem volt megszakítható és nem látszott** (`3462ef1`) — minden render-job
   prioritással kerül a BullMQ-ba (`prioritized` állapot), a megszakítás és a Sor-lista viszont csak a
   `waiting`-et nézte. (Mellé: a kifizetés-runner nem-Error elutasításra se dobjon.)
4. **A coverage-futás hamis bukásai** (`ea4ab1e`) — az istanbul a `page.evaluate`-be is számlálót
   injektált. **A smoke-kód az éles bundle-ben** (`5b7e289`) — 1,75 MB dev-only kód került ki.
5. **Sorrendfüggő tesztek** (`40999d3`) — két izolációs hiba (store-memória, le nem bontott React-fák).

## 5. Döntésre váró kérdések (`// KÉRDÉS:`)

Mindegyiknél a MAI viselkedést teszt rögzíti; a javítás döntés kérdése.

**Pénz és jogosultság**

1. **Webhook részleges hiba → dupla Coin** — [billing.rc.test.js:99](../../../server/billing.rc.test.js#L99):
   a Coin-csomag két RPC (vásárolt + bónusz), a dedup csak a végén íródik; ha a bónusz bukik, a retry a
   vásárolt részt újra jóváírja (párhuzamos kézbesítésnél is). *Javaslat:* egy RPC a kettőre, vagy
   egyedi esemény-ref a coin-naplóban (DB-migráció).
2. **Véletlen PayPal `sender_batch_id`** — [payouts.test.js:64](../../../server/payouts.test.js#L64):
   kézi újraindításnál kétszer utalhat; a kérés-id-ből képzett kulcs kizárná.
3. **A kvóta-számláló DB-hibája átenged (fail-open)** — [usage.db.test.js:76](../../../server/usage.db.test.js#L76),
   míg a szint-ellenőrzés fail-closed.
4. **Megújításnál a sor-olvasási hiba elveszi a hátralévő időt** — [billing.branches.test.js:161](../../../server/billing.branches.test.js#L161).
5. **Negatív / 0 `days`** aktív, de lejárt előfizetést ír — [billing.branches.test.js:170](../../../server/billing.branches.test.js#L170).
6. **`clawbackCoins` nem ellenőriz** user-id-t és összeget — [billing.branches.test.js:277](../../../server/billing.branches.test.js#L277).
7. **Stripe `kyc`-ág null-klienssel TypeError** — [billing.branches.test.js:404](../../../server/billing.branches.test.js#L404).
8. **Az `activeTier` lekérdezési hibája csendben `free`** (nincs napló) — [billing.branches.test.js:444](../../../server/billing.branches.test.js#L444).
9. **Elakadt kifizetés a `waiting` számlálóban** — [payoutRunner.branches.test.js:174](../../../server/payoutRunner.branches.test.js#L174); kellene `stuck`.
10. **Egy hibás kérés leállítja a kifizetési köteget** — [payoutRunner.branches.test.js:189](../../../server/payoutRunner.branches.test.js#L189).

**Biztonság**

11. **Rate-limit kulcsa a kliens X-Forwarded-For-ja** (megkerülhető) — [rateLimit.branches.test.js:84](../../../server/security/rateLimit.branches.test.js#L84).
12. **A limiter-tár kiesésekor fail-open** — [rateLimit.branches.test.js:169](../../../server/security/rateLimit.branches.test.js#L169).
13. **Rövidített IPv4 (`127.1`)** csak a `resolveSafe` DNS-lépésén akad fenn — [rtmpUrl.test.js:122](../../../server/security/rtmpUrl.test.js#L122).

**Szerkesztő-mag**

14. **`ADD_CLIP` nem ellenőrzi a sáv-kompatibilitást** (a `MOVE_CLIP` igen) — [commands.property.test.ts:255](../../../src/lib/commands.property.test.ts#L255).
15. **`ADD_CLIP` elfogadja a duplikált klip-id-t** — [commands.property.test.ts:263](../../../src/lib/commands.property.test.ts#L263).
16. **`SET_FPS` nem illeszti újra a klipeket** az új frame-rácsra — [commands.property.test.ts:271](../../../src/lib/commands.property.test.ts#L271).
17. **A render `motionChain` fix 30 fps-sel** számol 24/60 fps-es exportnál is (`server/render/videoFilters.js`)
    — valószínű hiba; a bontás változatlanul hagyta.

**Karbantartás**

18. A bontott modulokban a `logCaught`-címkék a régi fájlneveket viselik (`render.js:…`,
    `ImageStudioBody.tsx:…`, `AudioStudioBody.tsx:…`), hogy a `server/bugs/` ujjlenyomatai ne
    változzanak. Átnevezzük (új hibacsoportok keletkeznek)?
19. A Kép Stúdió új hookjai `.tsx`-ek JSX nélkül, mert az `imageLocaleParity` csak `.tsx`-ből gyűjt
    kulcsot. Bővítsük a paritás-tesztet `.ts`-re?
20. Az `ImageStudioBody` 1000 sor alá vitele (a ~240 soros szerszám-elosztó kiemelése) — folytassuk?
21. Két `import/first` lint-kivétel (`collabLive.channel.test.ts`, `cloudSync.tombstone.test.ts`)
    megszüntethető lenne az importok előre hozásával — érdemes?

22. A `mediaPolicy.detectKind` az ftyp-márkát csak szóköztől trimmeli: egy NUL-lal kitöltött 3 betűs márka
    (`m4a\0`) videónak minősül, nem hangnak. A valódi fájlok szóközzel töltenek; javítsuk a NUL-ra is?

## 6. Javasolt következő lépések (prioritás szerint)

1. **A pénzügyi KÉRDÉS-ek eldöntése és javítása** (1–2, 9–10): a webhook-idempotencia DB-szintű
   lezárása és a determinisztikus PayPal-kulcs a legfontosabb — mindkettő valós pénzveszteség-út.
2. **A rate-limit IP-forrása** (11): `trust proxy` / `req.ip` a nyers fejléc helyett.
3. **A render `motionChain` fps-hibája** (17): külön, teszttel bizonyított javítás.
4. **A coverage-ratchet emelése** a mai szintre (74,69 / 82,84 %) a következő zöld CI után.
5. **A típusozás folytatása** a route-okra (`server/routes/*`) és a `notify.js`/`rcEvents.js`/`stripe.js`-re
   (ma ezek típusa „untyped” a már ellenőrzött fájlokban).
6. **A maradék óriásfájlok** (`Timeline.tsx`, `AssistantPanel.tsx`, `editor/[id].tsx`,
   `PreviewSurface.tsx`, `Model3DStudio.tsx`) bontása ugyanezzel a módszerrel.
7. **Release-smoke build**: env-váltás után `expo export --clear` (a Metro-cache nem invalidálódik).

## 7. Eltérések a feladatleírástól

- **A „≤ 400 sor / commit” szabály** a négy gépi bontásnál (smoke, típusok, render, két stúdió) nem
  tartható: egy fájl szétbontása atomi lépés (a köztes állapot nem fordulna). Ezeknél a kód karakterre
  változatlan átmozgatása igazolt (konkatenálva azonos / bájtra azonos renderkimenet).
- **Az ffmpeg hiánya** nem „átugorható” minden képpont-suite-ban: néhány a `beforeEach`-ben is hívja.
  Az ffmpeg a worker kemény előfeltétele (dokumentálva a testing.md-ben); a feladat átvételi feltétele
  (Chromium nélkül 0 hamis bukás) teljesül.
- **Közös forrás a kliens–szerver tükrökhöz** build-változást igényelne (TS/Metro ↔ CJS/Node, külön
  csomag) — maradt a contract-teszt, a tier-tükörnél a teljes értékkészlettel.
- **Új függőségek:** `fast-check`, `@stryker-mutator/core` (a listáról), plusz a kötelező
  `@stryker-mutator/jest-runner` plugin és a worker `@types/node@22` dev-függősége (indoklás a commitokban).
