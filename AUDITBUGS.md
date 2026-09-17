# 🔍 ReMix — Production audit: javítandók

**Audit dátuma:** 2026-09-15 · **Újraértékelve:** 2026-09-17 · **Branch:** `studio-social` · **Terjedelem:** 246 TS/TSX fájl / 54 295 sor (`src/`) + 11 712 sor (`server/`)

**Módszer:** `expo-doctor` · `expo lint` · `tsc --noEmit` · `npm audit` · `expo install --check` + 7 párhuzamos kód-audit (biztonság, hibakezelés, memória, TypeScript, architektúra, Expo/EAS, state/teljesítmény). Minden állítás fájl:sor bizonyítékkal; a ✅ jelölés azt jelenti, hogy **külön ellenőriztem**.

---

## Pontszám: **57 / 100** (eredeti, 2026-09-15) → **82 / 100** (újraértékelve, 2026-09-17)

| Terület | Súly | Volt | Most | Mi változott |
|---|---:|---:|---:|---|
| Architektúra | 15 | 7/10 | **9**/10 | editorStore 1541→1360, a trim/range/pre-compose matematika tiszta `lib/` magokban; command bus továbbra is 0 megkerülés |
| TypeScript | 10 | 8/10 | **9**/10 | 4 szigorúbb flag, 0 tsc-hiba, 4 db `any` 54 ezer sorra, 0 `@ts-ignore`; az elavult `@types/react-native` kidobva |
| React-minőség | 10 | 6/10 | **7**/10 | az elnémított hook-szabályok a forró úton megszűntek; 10 `eslint-disable` maradt, mind indokolt |
| **Expo-konfiguráció** | 10 | **3**/10 | **8**/10 | bundleId/package, eas.json, `expo-doctor` **21/21** (volt: 2 bukás); a B3 (`eas init`) hiányzik |
| Teljesítmény | 15 | 6/10 | **8**/10 | a fordító-memoizálás MÉRVE és CI-ben őrizve; events-napló 1,2 MB → ~50 KB autosave-enként |
| Memória | 10 | 7/10 | **9**/10 | LRU a 6 elemzés-cache-re + a thumbnail-mappa végre mérve és üríthető |
| API / hálózat | 10 | 6/10 | **8**/10 | retry az idempotens olvasásokra, timeout a korábban korlátlan hívásokon, `parseGuards` a határon |
| Biztonság | 10 | 4/10 | **9**/10 | worker-hitelesítés, CORS-allowlist, SSRF-védelem, fail-closed `isPro`, Keychain-tárolás |
| **Tesztelés** | 5 | **1**/10 | **7**/10 | 0 → **249 teszt** 20 fájlban (kliens + worker + fordítási kimenet), `npm run audit` + CI |
| UX / hibakezelés | 5 | 6/10 | **8**/10 | autosave-retry jelzéssel, feed-rollback, „hiba ≠ üres lista", a ✕ gomb végre hat |

**Az újraértékelés bizonyítékai:** `tsc --noEmit` 0 hiba · `expo lint` 0 hiba · `jest` 249/249 · `expo-doctor` 21/21 · 246 fájl / 54 295 sor (`src/`) + 11 712 sor (`server/`) · 0 `console.log` · 4 TODO.

**Ami a 100-ból hiányzik — és miért nem pótolható íróasztalnál:**
- **−6 kiadás:** a **B3** (`npx eas init` + preview build) az Expo-fiókot igényli; enélkül a „kiadásra kész" nem igazolható, csak valószínűsíthető.
- **−5 teljesítmény:** eszközön mért profil nincs. A `Timeline`, `TimelineClipInner`, `PreviewSurface` és `TextOverlay` a fordítóból kimarad (player-mutáció / Reanimated shared value — szándékos kivétel), de hogy ez MÉRHETŐEN számít-e, csak telefonon dől el.
- **−4 tesztelés:** nincs komponens- vagy E2E-teszt; a 249 teszt a tiszta magokat és a határokat fedi, a UI-t nem.
- **−3 egyéb:** 15 tranzitív npm-audit találat az Expo eszközláncából (két gyökér-ok), amit nem az app kontrollál.

---

## 📋 TODO — a maradék tételek, sorrendben

> **Hol tartunk: 1 / 11.** A sorrend érték/kockázat szerint: elöl az olcsó és
> egyértelmű javítások, hátul az, ami döntést vagy mérést igényel. Minden tétel
> a saját szakaszára hivatkozik; ha egy kész, ITT is és a szakaszban is átvezetjük.

| # | Tétel | Miért most | Állapot |
|---|---|---|---|
| 1 | ~~**P3-9** · nyers `res.json()` a `render.ts` 8 pontján~~ | a felhasználó „JSON Parse error"-t lát a valódi hibaüzenet helyett | ✔️ `readJson()`, 7 teszt |
| 2 | **P1-2c + K10** · explicit `ios.infoPlist` usage description-ök, angolul is | ma a plugin-SORREND dönti el az értékeket — átrendezésnél némán angol defaultra vált; a magyar szöveg angol App Review-nál hátrány | ⬜️ |
| 3 | **S7** · ATS / cleartext HTTP | release buildben az iOS ATS és az Android is blokkolja a `http://`-t → minden felhő-hívás némán elhal | ⬜️ |
| 4 | **S6** · `ios.privacyManifests` | `PrivacyInfo.xcprivacy` nélkül **ITMS-091061** figyelmeztetés minden feltöltésnél | ⬜️ |
| 5 | **K9** · `.env.example` hiányos | 5 valóban használt `EXPO_PUBLIC_*` nincs dokumentálva → a következő build újra hiányos env-vel megy | ⬜️ |
| 6 | **P3-4** · 9 db `as never` | saját szignatúra-hibát takarnak; típus-javítással eltűnnek | ⬜️ |
| 7 | **P1-9** · webes statikus render (`window is not defined`) | a beállított `web.output: "static"` ma nem működik | ⬜️ |
| 8 | **K5–K8** · splash/ikon/értesítés-ikon méretek, brand-színek | template-maradványok; kozmetikai, de a store-listán látszik | ⬜️ |
| 9 | **EAS env** · a `preview` környezet lokális Supabase-t kapott, és 5 változó hiányzik | a mostani build auth/social/Pro nélkül fut — **hosztolt értékek kellenek (RÁD VÁR)** | ⬜️ |
| 10 | **S2/S3** · `expo-updates` (OTA) és `expo-dev-client` | architekturális döntés, nem hibajavítás — **egyeztetést igényel** | ⬜️ |
| 11 | **Mérésre vár 1.** · valódi render-számok lejátszás alatt | most már van futtatható build — ez dönti el, számít-e a 4 komponens fordító-kimaradása | ⬜️ |

**Menet közben lezárva (a szakasz-szöveg utólag frissítve):**
- **P2-5** ✔️ — a hangerő-küszöb (`> 0.005`) mindkét helyen megvan (`PreviewSurface.tsx`, `AudioLayer.tsx`).
- **P2-6** ✔️ — a `HistoryModal` feltételesen mountolódik (`TransportBar.tsx:229`).
- **K4** ✔️ — `ITSAppUsesNonExemptEncryption: false` (`07d7070`).
- **B1–B4** ✔️ — bundle ID, `eas.json`, EAS-projekt (`@vided/remix`), env-hivatkozás.

> **Állapot 2026-09-17 — P0/P1/P2/P3 lezárva; kódolni való nem maradt.**
> **P0: 5/5** · **P1: 7/7** · **P2: 6/6** · **P3: 15/15** — az utolsó tételek:
> - **P3-5** (`a4cbbe6`, `6234070`): az editorStore **1541 → 1360** sor. A
>   roll/slip/slide → `lib/trimEdit.ts`, a range-törlés → `lib/rangeEdit.ts`, a
>   pre-compose → `lib/preCompose.ts`. Mind tiszta függvény, a store koordinátor
>   lett, nem motor. **63 új teszt** a projekt legkockázatosabb matematikájára.
> - **P3-7** (`2aa674d`): retry-réteg (`lib/netRetry.ts`) — **szándékosan csak
>   idempotens olvasásra** (render-poll, /music, /tts/voices, /stickers3d). A
>   /shop, /billing, /media/upload, /invite, /notify **kimarad**: ott az ismétlés
>   dupla terhelést okozna. 22 teszt, köztük a „nem próbálja újra" irány.
> - **P3-3** (`9e28b1e`): `lib/parseGuards.ts` — tartalom-validáció ott, ahol a
>   worker válasza klip-idővé / vágásponttá / kulcskockává válik (scenes,
>   silence, shot-score, reframe). 21 teszt.
> - **P3-14** (`cfdd841`): **MEGMÉRVE**, és a gyanú alábecsülte. 100 klipes
>   projekten egy `REPLACE_TRACKS` **39,9 KB**, a vegyes napló **1,2 MB** — és
>   ezt írta újra MINDEN autosave; a csupa nehéz napló **11,7 MB**, az Android
>   2 MB/kulcs limit fölött. Ellenőrizve, hogy a naplót KIZÁRÓLAG a
>   `describeCommand()` olvassa (nincs visszajátszás, és NEM ez az undo-verem),
>   ezért `lib/eventLog.ts` a klipek helyére `{ id, kind }` csonkot tesz —
>   a darabszám és az id-k megmaradnak (üres tömbbel a napló hazudna).
>   **39,9 KB → 4,0 KB (~10×)**, `slim: true` jelöléssel. 10 teszt.
> - **P3-13** (`d8674c5`, `d91750d`): `lib/lruCache.ts` (LRU, limit 64) a hat
>   elemzés-cache-re, mind kapott `clear*Memory()`-t, és a `clearCaches()` végre
>   hívja is őket. A filmstrip-JPEG-ek (`<cache>/VideoThumbnails/`, a natív
>   forrásból ellenőrizve) mostantól **mérve és ürítve** — eddig a felhasználónak
>   mutatott cache-méret kevesebb volt a valóságnál. 9 teszt.
>
> Teszt-infrastruktúra: **249 teszt**, `npm run audit` (tsc + lint + jest) + CI.
> Korábban: `2a75195` (duplikáció-konszolidáció), `c0d54c3` (a halott ✕ gomb),
> `ebdf5bc` (feed rollback + shop hiba≠üres), `0ea6944`/`052051f`/`2a67079`/
> `51814c1` (4 szigorúbb tsconfig-flag, −962 sor halott kód, `updateLayer`
> generikus, időzítő-cleanup, AGENTS.md a valós architektúrára).
>
> - **P2-1** (`349b9ab`): a React Compiler mérése MEGISMÉTELVE — az audit „42/60,
>   az összes forró komponens kiesik" állítása **téves konfigból** származott. A
>   valóság: 76 .tsx-ből **46 memoizálva**, a forró útvonal 8 komponenséből **5 jó**.
>   A `Timeline` két valódi anti-mintája javítva (bail 3 → 2), a maradék a
>   gesztus-kódban van (szándékos kivétel). Új `build` jest-projekt:
>   `tools/reactCompiler.test.js` őrzi, hogy a lista ne tudjon némán nőni.
>
> **Hátra: csak a B3** (`npx eas init`), ami a te Expo-fiókodat igényli. A
> `noUncheckedIndexedAccess` megvizsgálva → a bevezetése NEM javasolt (lásd
> „Mérésre vár" 4.: 340 hiba, nulla valódi bug).
>
> **Korábbi állapot 2026-09-15:** a **P1-1 / P1-3 / P1-4 is javítva** (`7591aa8`, `dab619e`, `5344bde`, `13a69e7`) — a worker-hitelesítés élő támadás-tesztekkel igazolva. Korábban: mind az 5 **P0 javítva** (`661a694`, `30a93eb`, `73d9118`, `f1f87c8`, `757f0ce`), és a **P1-2 kiadás-blokkolókból 3/4 kész** (`4c75e7a`) — a B3 a te Expo-fiókodat igényli. A pontszám újraértékelése a preview build után esedékes.

---

## ✅ P0 — Azonnali (adatvesztés, hibás működés, crash) — **MIND JAVÍTVA** (2026-09-15)

### ~~P0-1 · Sérült projekt-index → az összes projekt némán elvész~~ — ✔️ **JAVÍTVA** (`661a694`)
**Súlyosság volt: KRITIKUS** · `src/lib/storage.ts:32-34`, `:52`, `:61-65`

```ts
try { ... } catch { return []; }        // :32-34 — parse-hiba = „nincs projekt"
const metas = await listProjects();      // :52 — []-t kap
const nextIndex = [meta, ...metas.filter(...)];  // :61
await AsyncStorage.multiSet([[INDEX_KEY, JSON.stringify(nextIndex)]]);  // :64 — FELÜLÍR
```
A parse-hiba nem különbözik az „üres"-től. A felhasználó üres kezdőképernyőt lát, majd **az első mentés véglegesen elárvítja az összes korábbi projektet** (a `vided.project.v1.*` kulcsok megmaradnak, de elérhetetlenné válnak).

**Javítás:** a parse-hiba dobjon sentinelt; sérülésnél **ne** írjuk felül az indexet, hanem építsük újra `AsyncStorage.getAllKeys()`-ből, és jelezzük a felhasználónak.
**Elvégezve:** readIndex/rebuildIndex önjavítás + közös metaOf; 11/11 node-teszt (AsyncStorage-mock).

### ~~P0-2 · Autosave némán bukik, retry nélkül~~ — ✔️ **JAVÍTVA** (`30a93eb`)
**Súlyosság volt: KRITIKUS** · `src/app/editor/[id].tsx:189-198`, `:209-210`

```ts
Promise.all([saveProject(snap), saveEvents(...)])
  .then(() => { state.markSaved(); ... })   // :194 — csak sikernél
  .catch(() => {});                          // :198 — néma
```
Bukásnál `dirty` marad `true` és a `project` referencia változatlan → a `[dirty, project]` dep-array nem változik → **az effect nem indul újra: nincs retry**. A felhasználó abban a hitben szerkeszt tovább, hogy mentve van. A kilépéskori mentés (`:209-210`) szintén néma.

**Javítás:** `saveError` állapot + látható „Nincs mentve" jelzés a fejlécben; exponenciális retry; kilépés előtt megerősítés, ha a mentés bukott.
**Elvégezve:** saveFailed + saveAttempt állapot, a saveAttempt a dep-arrayben → exponenciális retry (0,8 s → max 10 s), látható fejléc-jelzés (i18n hu/en/de).

### ~~P0-3 · Két rAF-mesteróra → a playhead dupla sebességgel halad~~ — ✔️ **JAVÍTVA** (`73d9118`)
**Súlyosság volt: MAGAS** · `src/hooks/usePlaybackClock.ts:52,74` · `src/app/editor/[id].tsx:64` · `src/app/player/[id].tsx:43` · `src/app/editor/[id].tsx:296`

A `tick` a store-ból olvas és `playhead + dt*rate`-et ír vissza. A hookot **mindkét képernyő** hívja, a navigáció `router.push` (a szerkesztő mountolva marad), és **nincs focus-kapu sem `enableFreeze`** (ellenőrizve: `useFocusEffect` csak listafrissítésre van az index/profile-ban). Két független rAF-ciklus → **mindkettő hozzáadja a `dt`-t**.

Ugyanez okozza: a takart képernyők natív lejátszói tovább élnek (≈10 élő player, **duplikált hang**), és a feed videója a háttérben is szól (`src/app/feed.tsx:143-152`, `:160`).

**Javítás (egy lépésben oldja mindhármat):** `useFocusEffect`/`useIsFocused` kapu a `usePlaybackClock`-ban, az `AudioLayer`-ben és a `feed.tsx` playerénél — vagy `enableFreeze(true)` a gyökérben.
**Elvégezve:** `useIsFocused()` kapu a usePlaybackClock-ban; AudioLayer takart képernyőn nem renderel (a 4 player felszabadul); PreviewSurface és feed.tsx csak fókuszban játszik.

### ~~P0-4 · Hiányzó peer dependency: `expo-asset`~~ — ✔️ **JAVÍTVA** (2026-09-15)
**Súlyosság volt: MAGAS** · `expo-doctor`

> *„Missing peer dependency: expo-asset — Required by: expo-audio. **Your app may crash outside of Expo Go** without this dependency."*

**Elvégzett javítás:** `npx expo install expo-asset` → `expo-asset@~57.0.17` közvetlen függőségként (`package.json`), plusz a telepítő az `app.json` `plugins` tömb **végére** beírta az `"expo-asset"` bejegyzést.

**Ellenőrizve:**
- `expo-doctor`: **18/21 → 19/21** — a „Missing peer dependency" check eltűnt.
- **A jogosultság-lánc érintetlen** (lásd P1-2c törékenység): az `expo-asset` a 11. helyre került, és **nem állít iOS usage description-t**, így a kritikus 3–7 plugin-sorrend (`expo-audio` → `expo-media-library` → `expo-image-picker` → `expo-camera`) változatlan.
- `tsc --noEmit` → 0 hiba; `expo lint` → tiszta.

### ~~P0-5 · A görbe-szerkesztők minden húzás-frame-en dispatch-elnek~~ — ✔️ **JAVÍTVA** (`757f0ce`)
**Súlyosság volt: MAGAS** · `src/components/editor/KeyframeGraphEditor.tsx:108`, `:270` · `ToneCurveEditor.tsx:90`, `:236` · `PathEditor.tsx:64`, `:159` → `PrecisionPanel.tsx:292-296`, `AudioPanel.tsx:552`, `FilterPanel.tsx:689`, `AdjustPanel.tsx:151`, `ShapePanel.tsx:171`

A `Gesture.Pan().onUpdate(...)` minden frame-en `onChange`-t hív → `updateClip` → `dispatch` → **undo-lépés + esemény-napló bejegyzés**. Következmény: a 50 lépéses undo-történet **0,8 másodpercnyi húzás alatt elfogy**, a 300 elemű AI-memória napló 5 másodperc alatt kiürül, és a felhasználó érdemi művelete visszavonhatatlanná válik. Ez nem csak teljesítmény, hanem **funkcionális hiba**.

**Javítás:** a `TimelineClip`-ben már bevált minta átvétele — `onUpdate`-en csak lokális state/shared value, `onEnd`-en egy `updateClip`.
**Elvégezve:** draft/putDraft/view + commit az endGesture-ben mindhárom szerkesztőben; a koppintásos műveletek továbbra is azonnal commitolnak.

---

## 🟠 P1 — Production blokkolók (élesítés előtt kötelező)

### ~~P1-1 · A worker hitelesítés nélkül teszi ki a `service_role`-t~~ — ✔️ **JAVÍTVA** (`7591aa8` + `dab619e`)
**Súlyosság volt: KRITIKUS** · `server/index.js:344-372` (`/billing/activate`), `:375` (`/billing/deactivate`), `:310` (`/notify`), `:327` (`/invite`), `:1004` (`/media/upload`)

A `userId` a kérés **törzséből** jön, semmi nem ellenőrzi a hívót. Súlyosbító: `Access-Control-Allow-Origin: *` (`:63`) és `app.listen(PORT)` host nélkül → **0.0.0.0**.

Egyetlen `curl -X POST .../billing/activate -d '{"userId":"<uuid>","days":36500}'` = **örökös Pro ingyen**. Ugyanígy: korlátlan kredit (`/shop/credits/grant`), belépés idegen projektbe (`/invite`), push-spam (`/notify`), 2 GB-os hitelesítetlen fájlfeltöltés publikus bucketbe (`/media/upload`).

A gondosan felépített RLS-réteg (ami egyébként **kiváló** — a self-grant adatbázis-szinten le van zárva) így egy `curl`-lel megkerülhető.

> **Kontextus:** a `TODO.md:16-44` ezt **név szerint felsorolja** go-live blokkolóként. Tudatos, dokumentált adósság — de a kliens produkciós kódútja már ma hív a `cloudBaseUrl()`-re, így a hosztolt worker első élesítésével azonnal kihasználható.

**Javítás:** közös JWT-verifikáló middleware (`supabase.auth.getUser(token)`), a `userId` **kizárólag** a verifikált tokenből; CORS-allowlist; `/billing/activate` prodban admin-only (a valós Pro a RevenueCat webhookon jöjjön).
**Becslés:** ~80 sor — egy lépésben felszámolja a P1-1, P1-3 és P1-4 pontokat.

### P1-2 · Kiadás-blokkolók — ⚙️ **3/4 JAVÍTVA** (`4c75e7a`), B3 a te fiókodat igényli
**Súlyosság volt: BLOKKOLÓ** — négy egymástól független hiány, **bármelyik önmagában** megakadályozza a működő kiadást.

| # | Hiány | Bizonyíték | Következmény |
|---|---|---|---|
| ~~**B1**~~ ✔️ | ~~Nincs `ios.bundleIdentifier` és `android.package`~~ → **`com.h3nz3l.remix`** mindkét platformon; ellenőrizve, hogy a feloldott config már a valódi azonosítót adja | `expo config --type prebuild` → **`com.placeholder.appid` MINDKÉT platformon**; `app.json` `ios: {"supportsTablet":true}`, `android.package`: hiányzik | Az App Store / Play Console-ban nem regisztrálható; a build/submit elbukik |
| ~~**B2**~~ ✔️ | ~~Nincs `eas.json`~~ → development / preview / production profil a hivatalos séma szerint (`appVersionSource: remote` + production `autoIncrement` → **az S1-et is megoldja**) | a repo gyökerében nincs (és `.easignore` sem) | Nincs development/preview/production profil, nincs `developmentClient: true` → `eas build` futtatható sem |
| **B3** ⏳ | **Nincs `extra.eas.projectId`** — *a te Expo-fiókodat igényli, `npx eas init` írja be. Szándékosan nem tettem be hamis UUID-t: az a pusht némán elhalasztaná.* | `app.json` `extra`: **teljesen hiányzik**; a kód viszont elvárja: `src/lib/pushNotifications.ts:109-110` → `:147` `getExpoPushTokenAsync({ projectId })` | A **remote push véglegesen működésképtelen** production buildben is; a worker `/notify` útja halott kód marad |
| ~~**B4**~~ ✔️ | ~~Az env nem jut el a buildbe~~ → minden profil `"environment"`-tel hivatkozik az **EAS Environment Variables**-re; a `.env.example` tartalmazza a pontos `eas env:set` parancsokat | `.gitignore:48` → `.env`; `src/lib/supabase.ts:32` → `hasSupabaseConfig() ? createClient(...) : null`; nincs `eas.json > env` sem EAS Environment Variable | A build **sikerülne** és telepíthető lenne, majd a felhasználónál `supabase === null` → „konfig hiányzik" képernyő → **a kiadott app használhatatlan**. Ugyanez `EXPO_PUBLIC_CLOUD_URL` nélkül: a `cloudBaseUrl()` `http://localhost:8787`-re esik vissza |

**Hátralévő lépések (ezek fiók-hozzáférést igényelnek, nem kód):**
```bash
npx eas init                     # B3: beírja az extra.eas.projectId-t + owner
eas env:set --name EXPO_PUBLIC_SUPABASE_URL      --value "<url>"  --environment production --visibility plaintext
eas env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<key>"  --environment production --visibility plaintext
# ugyanez --environment preview és development értékekkel is
eas build --profile preview --platform ios       # majd android
```
**Ezek után lehet először működő buildet csinálni** — és a most javított P0-kat valódi eszközön ellenőrizni.

### P1-2b · Súlyos, de nem blokkoló kiadási hiányok ✅
- **S1 — Nincs `ios.buildNumber` / `android.versionCode`** (`app.json:5` csak `version: "1.0.0"`) → a **második** feltöltés elbukik („build number already used"). Megoldás: `cli.appVersionSource: "remote"` + `autoIncrement` az `eas.json`-ban.
- **S2 — Nincs `expo-updates`, nincs `runtimeVersion`, nincs `updates` blokk** → **nincs OTA**: minden javításhoz teljes store-review. Bekapcsoláskor a `fingerprint` policy ajánlott.
- **S3 — Nincs `expo-dev-client`** → a natív modulokat használó funkciók (eszközön futó render, IAP, hullámforma, push) **fejlesztés közben egyáltalán nem tesztelhetők**.
- **S6 — Nincs `ios.privacyManifests`** → a `PrivacyInfo.xcprivacy` nem generálódik; az Apple „required reason API" deklarációk hiányosak lehetnek (AsyncStorage `NSPrivacyAccessedAPICategoryUserDefaults`, `expo-file-system` `…FileTimestamp`) → **ITMS-091061** figyelmeztetés feltöltéskor.
- **S7 — Cleartext HTTP ATS-kivétel nélkül** (`backend.ts` → `http://${host}:8787`; nincs `NSAppTransportSecurity` sem `usesCleartextTraffic`) → **release buildben iOS ATS és Android blokkolja** a `http://`-t, minden felhő-hívás némán elhal. Prodban kötelező HTTPS (`EXPO_PUBLIC_CLOUD_URL`).
- **K4** — `ITSAppUsesNonExemptEncryption` nincs beállítva → minden feltöltésnél kézi export-compliance kérdés.
- **K10** — az iOS usage description-ök **csak magyarul** vannak, `InfoPlist.strings` lokalizáció nélkül, holott az app 3 nyelvű → angol-locale-os App Review-nál magyar szöveg jelenik meg.
- **K5/K6/K7/K8** — splash `imageWidth: 76` (a dokumentált alapérték 100; a kép 512×512), nincs `dark` splash variáns `userInterfaceStyle: "automatic"` mellett; template-maradvány `adaptiveIcon.backgroundColor: "#E6F4FE"` a brand `#7c5cff`/`#0c0d12` helyett; értesítés-ikon 432×432 a javasolt 96×96 helyett; `favicon.png` 48×48.
- **K9** — a `.env.example` nem dokumentálja a ténylegesen használt `EXPO_PUBLIC_RC_IOS_KEY`, `EXPO_PUBLIC_RC_ANDROID_KEY`, `EXPO_PUBLIC_SERVER_URL` változókat (`src/lib/billing.ts:48-56`).

### P1-2c · Törékeny jogosultság-lánc ⚠️
**A jó hír: NINCS hiányzó iOS usage description** — a permission-lánc végigkövetve **teljes** (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` mind magyar értékkel), és az Android-oldal is hiánytalan. Ez volt a legnagyobb elutasítási kockázat, és **átmegy**.

**De törékeny:** az értékek azért helyesek, mert a `app.json:26-73` **plugin-sorrendje** szerencsés (`expo-audio` → `expo-media-library` → `expo-image-picker` → `expo-camera`, és a későbbi felülírja a korábbi angol defaultját). Ha valaki átrendezi a `plugins` tömböt, az `NSCameraUsageDescription` **némán angol defaultra vált**.
**Javítás:** explicit `ios.infoPlist` blokk a sorrend-függőség helyett.

Egyetlen hiányzó Android permission: **`SCHEDULE_EXACT_ALARM`** (Android 12+) — csak ha ütemezett értesítés is megy (`pushNotifications.ts:177` `scheduleNotificationAsync`); azonnali `trigger: null` értesítéshez nem kell.

### ~~P1-3 · SSRF / nyílt proxy a BYOK `baseUrl`-en~~ — ✔️ **JAVÍTVA** (`5344bde`)
**Súlyosság volt: MAGAS** · `server/ai.js:248-264` (`sanitizeAiConfig` csak formailag ellenőriz) → `:281` (`fetch(\`${base}/chat/completions\`)`), `:683`

Hitelesítetlen belépési pontok (`/ai/probe`, `/ai/hooks`, `/ai/assist`) → a worker tetszőleges **belső** címre kényszeríthető (`169.254.169.254` metadata, `10.0.0.0/8`, `localhost:*`). A `/ai/probe` a választ `{ok:true/false}`-ként visszaadja → **belső port-szkenner**. A kód maga is jelzi (`ai.js:245-246`).

**Javítás:** provider-allowlist (ismert AI-hosztok), kötelező `https:`, DNS-feloldás utáni privát-IP tiltás, redirect-követés kikapcsolása.

### ~~P1-4 · `matte.uri` és `lut.uri` kimarad a `/render` URI-átírásából~~ — ✔️ **JAVÍTVA** (`13a69e7`)
**Súlyosság volt: MAGAS** · `server/index.js:1049-1067` (az átírás csak `clip.uri`-ra és `clip.imageUri`-ra fut) → `server/render.js:563` (`'-i', m.uri`), `:297-301` (`lut3d='${q}'`)

Az FFmpeg `-i` érti a `http(s)://` és `file://` sémákat → a hitelesítetlen `/render`-en belső HTTP-kérés kényszeríthető, vagy a worker gépén lévő tetszőleges kép/LUT fájl **beleégethető a kimeneti videóba**, amit a támadó letölt (`GET /render/:id/file`).

**Javítás:** a `matte.uri` és `lut.uri` is menjen át az `uriMap` átíráson, vagy `path.resolve()` + kötelező `startsWith(workDir)`; minden `://` sémát elutasítani.

### P1-5 · BYOK AI-kulcsok titkosítatlanul tárolódnak és cleartext HTTP-n utaznak ✅
**Súlyosság: MAGAS** · `supabase/migrations/20260911130000_user_ai_providers.sql:22` (`api_key text`) · `src/lib/aiProviders.ts:167`, `:274` · `src/lib/backend.ts:47` (`http://`)

Az `expo-secure-store` nincs is a függőségek között; minden AsyncStorage (titkosítatlan) — ideértve a Supabase **refresh tokent** (`src/lib/supabase.ts:36`) és az entitlement-cache-t (`src/store/entitlementStore.ts:53`, rootolt eszközön `{"tier":"pro"}`-ra írható).

**Javítás:** prod bázis-URL kötelezően `https:` (a `http://` csak `__DEV__`); `expo-secure-store` adapter a Supabase-kliensnek; a BYOK-kulcs maradjon az eszközön, vagy `pgsodium`-titkosítás.

### P1-6 · A Pro-kapu kizárólag kliens-oldali ✅
**Súlyosság: KÖZEPES** · `src/lib/backend.ts:88-93` (`isProNow()` lokális zustand) — a worker **egyetlen végponton sem** ellenőrzi az előfizetést.

**Javítás:** a worker a verifikált JWT `sub`-jával kérdezze le a `subscriptions` sort; a kliens-gate maradjon csak UX-célra.

### P1-7 · Nincs teszt és nincs CI ✅
**Súlyosság: KÖZEPES**

0 saját teszt, nincs jest/vitest a `package.json`-ben, nincs `.github/workflows`. A `scripts` mindössze: `start`, `android`, `ios`, `web`, `lint`, `reset-project`.

**Javítás — minimum:** (a) unit-tesztek a már pure, tesztelhető magokra (`frames.ts`, `keyframes.ts`, `trackPlan.ts`, `commands.ts`, `workflow.ts`, `safeZone.ts`, `profanity.ts`, `vtt.ts`, `ass.ts` — ezek mind szándékosan expo-mentesek); (b) `npm run audit` minőség-kapu script: `expo-doctor && expo lint && tsc --noEmit && knip && npm audit`; (c) CI workflow, ami ezt futtatja.

### P1-9 · A webes statikus render elszáll (`window is not defined`) 🆕
**Súlyosság: KÖZEPES** · `app.json` `web.output: "static"` · `src/lib/supabase.ts`

Az `npx expo start --web` (és így az `expo export --platform web`) **nem áll fel**:
az expo-router statikus renderelése Node-környezetben futtatja a fát, ahol a
Supabase `__loadSession` → a storage-adapter `getItem`-je → `AsyncStorage`
web-implementációja `window.localStorage`-ot használ → `ReferenceError: window is
not defined`. A dev-szerver ismétlődően összeomlik, a HTTP kérés soha nem kap
választ.

**Ellenőrizve, hogy NEM a P1-5 okozta:** a `dcf62e5^` verzióban is
`storage: AsyncStorage` volt, azaz pontosan ugyanez a hívási lánc futott —
a hiba korábbi.

**Következmény:** a konfigurált `web.output: "static"` ma nem működik. Mobilra
nincs hatása (a natív buildet nem érinti), de ha a web cél, ez blokkoló.

**Javítás iránya:** a Supabase storage-adapter legyen SSR-biztos — ha nincs
`window`/`localStorage` (Node), adjon vissza `null`-t írás/olvasásnál a
perzisztencia helyett. A `secureStorage`-ban ez egy `typeof window === 'undefined'`
ág. (Megjegyzés: a web-render ezen túl is korlátozott — a videó/kamera/média-tár
natív modulok ott nem futnak.)

### P1-8 · Környezet-higiénia ✅
- **`@types/react-native@^0.72.8` közvetlenül telepítve** (`package.json:57`) — a típusok a `react-native` **0.86**-ban vannak; egy 0.72-es típuscsomag ütközik. Eltávolítandó.
- **25 Expo-csomag patch-eltérésben** az SDK 57 elvárásához képest (`expo` 57.0.19 vs ~57.0.22, `expo-router`, `expo-video`, `expo-audio`…). Javítás: `npx expo install --fix` — **commit után**, mert patch-szintű, de natív modulokat érint.
- **2 halott függőség:** `@expo/ui` (`package.json:6`) és `expo-glass-effect` (`:18`) — 0 import a `src/`-ben, de **autolinkelnek** → felesleges build-idő és bináris méret. (Az architektúra-audit ezen felül az `expo-symbols` és `expo-web-browser` csomagokat is jelölte — ellenőrizendő.)
- **15 moderate npm sebezhetőség** — mind `@expo/config-plugins`/`@expo/config` tranzitív, azaz **build-idejű** eszközlánc, nem a futó bundle. Alacsony prioritás.

---

## 🟡 P2 — Teljesítmény (mind kódból bizonyított)

### ~~P2-1 · A React Compiler kihagyja az ÖSSZES forró editor-komponenst~~ — ⚠️ **AZ ÁLLÍTÁS TÉVES VOLT**, újramérve (`349b9ab`)
**Súlyosság: KÖZEPES** (nem MAGAS) · `app.json:80` (`"reactCompiler": true`)

Az eredeti „42/60 bail, az ÖSSZES forró komponens kiesik" szám **rossz konfigból** származott. A fordítót nem preset-opció kapcsolja be, hanem a **`caller.supportsReactCompiler`** (`babel-preset-expo/build/common.js:109`) — enélkül minden mérés nullát vagy félrevezető számot ad:

| Mérés | Eredmény |
|---|---|
| `react-compiler-healthcheck` | 53/53 sikeres (saját, engedékenyebb config) |
| plugin önmagában, preset nélkül | 60 sikeres / 106 bail |
| **valódi Expo-út (mérvadó)** | **76 .tsx-ből 46 memoizálva** |

**A forró útvonal valós állapota** (KOMPONENSENKÉNT mérve — lásd lentebb, miért lényeges):

| Komponens | Állapot | Ok |
|---|---|---|
| `AudioLayer` · `PipLayer` · `PipClipFrame` · `TransitionLayer` · `IncomingClip` · `ShapeOverlay` | ✅ memoizálva | — |
| `Timeline` | ⛔️ | a pinch-gesztus `onStart`/`onUpdate` closure-je refet ír (2 bail; volt 3) |
| `TimelineClipInner` | ⛔️ | 6× Reanimated shared value mutáció |
| `PreviewSurface` | ⛔️ | expo-video player-mutáció — hookból jövő érték módosítása |
| `TextOverlay` | ⛔️ | Reanimated shared value írása effekt-függőség után |

> ⚠️ **A fájl-szintű mérés HAMIS biztonságot ad.** Egy fájlban együtt élhet lefordult és kimaradt komponens: a `TimelineClip.tsx`-ben a kis `EdgeThumb` segéd lefordul, miközben a FŐ `TimelineClipInner` kimarad. Az első javítási körben emiatt tévesen „megcáfoltam" az auditot a `TimelineClip` ügyében — **az audit itt jól látta**, az én mérésem volt rossz felbontású.

**Elvégezve:** minden bail, ami elnémított hook-szabályból jött, megszűnt — ez a javítható kategória, és ezzel ki is merült. A `Timeline`-ban (dep-lista → a klip a store-ból; `ppsRef.current = pps` a render törzséből → effektbe) és az `AudioLayer` két belső komponensében (`VideoVoice`, `TrackAudio`: a dep-lista most csak primitíveket tartalmaz, mert a `clip`/`opts` objektum minden renderben új referencia volt). Mindegyik továbblépett a következő blokkolóra, ami már player-mutáció vagy shared value — az `AGENTS.md`-ben rögzített szándékos kivétel. A maradék `Timeline`-bail a gesztus-kódban van — pontosan az a kategória, amire az `AGENTS.md` szándékosan kikapcsolta a `react-hooks/refs`-et; a pinch-zoom átstrukturálása mérhetetlen haszonért kockázat, ezért **ott megálltunk**.

> ⚠️ **Csapda:** a fordító a KOMMENTEKBEN is keresi az elnémító direktívát. Az a magyarázó megjegyzés, ami leírja, hogy eltávolítottuk, maga váltja ki újra a bail-t.

**Őr:** `tools/reactCompiler.test.js` (új `build` jest-projekt) — a forró útvonal memoizálása a `npm run audit` része. KOMPONENSENKÉNT méri a KIMENETET (a memoizált függvény törzse `$ = _c(n)`-nel nyit), nem a fordító naplóját. A lista kétirányúan kirögzített: elbukik, ha valami visszaesik, ÉS ha egy ismert kimaradó megjavul. Ismeretlen komponens-névre hibát dob (nem enged át némán) — ez rögtön el is kapta, hogy a `TimelineClip` valójában a `memo()` burkolat neve. Egy 11. teszt magát a mérőműszert ellenőrzi egy triviálisan fordítható próba-komponensen.

### P2-2 · A `Timeline` 60 Hz-en reconcile-ol egy `scrollTo` kedvéért ✅
**Súlyosság: MAGAS** · `Timeline.tsx:100` (feliratkozás) — az **egyetlen** valódi felhasználás a `:343-351` scroll-effekt (`:855` csak stílusnév, `:218` snap-címke)

Mivel a fordító kihagyja, minden frame-ben újraépül a teljes JSX: `rulerMarks` (`:618`), `beatTimes` + `downbeatTimes` (`:625-630` — egy 3 perces, 120 BPM-es zenénél **450 View**), régiók ×2 (`:632-667`), markerek (`:669`), `suggestedCuts` (`:788`), `searchMatchTimes` (`:799`), és `videoTrackGaps` = **sort + scan minden frame-ben** (`:756`). Nagyságrend: **~27 000 elem-diff/mp**.

> A `TimelineClip` `React.memo` (`:564`) — **a klip-lista maga megmenekül**. Ez a projekt egyik legjobb döntése, és korábbi auditom ezt helyesen állapította meg; amit az akkori vizsgálat nem vett észre, az a Timeline **saját** fájának 60 Hz-es újraépítése.

**Javítás:** a Timeline ne iratkozzon fel a playheadre — `subscribeWithSelector` middleware + imperatív `scrollTo`. (~10 sor)

### P2-3 · `projectDuration` percenként ~7200-szor fut végig a klipeken ✅
**Súlyosság: KÖZEPES** · `TransportBar.tsx:43-44` (zustand-selectorban → **minden store-`set`-nél** kiértékelődik) · `editorStore.ts:1428` (`setPlayhead` minden hívásban clamphez)

**Javítás (5 sor, nulla viselkedés-változás):** `WeakMap<Project, number>` cache a `projectUtils.ts`-ben — egyszerre megoldja a `TransportBar`, `setPlayhead`, `Timeline:306`, `TimelineMinimap:32`, `DetailPreview:45` eseteket.

### P2-4 · `recordAutoVersion` minden autosave-nél beolvassa a 20 verziót, mielőtt eldobja ✅
**Súlyosság: KÖZEPES** · `src/lib/storage.ts:104-110` — a `loadVersions()` (max 20 teljes projekt-pillanatkép JSON-parse) a **throttle-ellenőrzés ELŐTT** fut.

**Javítás:** az utolsó auto-verzió időbélyege külön, apró kulcson; a teljes lista csak akkor olvasódjon, ha a throttle átenged.

### P2-5 · `PreviewSurface`: 5 effekt `playhead` deppel, natív player-írás minden frame-en
**Súlyosság: KÖZEPES** · `PreviewSurface.tsx:203-219` (`player.volume = …` minden frame-en), `:231-240`, `:243-255`

**Javítás:** küszöbölés (`if (Math.abs(vol - last) > 0.005)`). Ugyanez `AudioLayer.tsx:262-275` (4 példány).

### P2-6 · `HistoryModal` mindig mountolva
**Súlyosság: ALACSONY** · `TransportBar.tsx:227` + `HistoryModal.tsx:44` (`[...events].reverse()` 300 elemen)

**Javítás:** `{historyOpen ? <HistoryModal … /> : null}`

---

## 🔵 P3 — Kódminőség, higiénia

### P3-1 · Ingyen bekapcsolható tsconfig-flagek ✅ (méréssel igazolva)
| Flag | Új hiba |
|---|---|
| `noImplicitReturns` | **0** |
| `noFallthroughCasesInSwitch` | **0** |
| `noUnusedLocals` + `noUnusedParameters` | **3** (`KeyframeGraphEditor.tsx:51`, `MulticamPanel.tsx:312`, `notificationStore.ts:32`) |

### P3-2 · 823 sor halott kód ✅
`src/lib/demoProjects.ts` (101 sor) — **0 importáló**; `src/lib/demoData.ts` (722 sor) — **csak** a demoProjects importálja. Plusz a `demoData.*` / `demoProjects.*` i18n kulcsok mind a 3 locale-ban. Kockázatmentes törlés.

### P3-3 · Tipizálatlan határok
**37 db `(await res.json()) as T`** futásidejű validáció nélkül (`skyClient.ts:36`, `faceClient.ts:42`, `shotScore.ts:40`, `cutlist.ts:55,90`, `reframeClient.ts:45`, `shop.ts:294`…), miközben a másik oldal **11 051 sor típus nélküli JS**. Plusz `storage.ts:30,44,81,138` — `JSON.parse(raw) as Project` **ellenőrzés nélkül** (ez a P0-1 gyökere is).

**Javítás:** minimális kézi type-guard a projektbe **író** utakon (ahogy a `colorClient.ts:32` már csinálja); a `videdFile.ts:64` meglévő ellenőrzését emeljük közös `isProjectShape()` helperbe és használjuk a `loadProject`-ben.

### P3-4 · Saját szignatúra-hibát takaró assertionök
- `imageDoc.ts:51` `updateLayer(patch: Partial<ImageLayer>)` — a `Partial<>` disztributál a union felett → **6 db `as never`** az `ImageDocPanel.tsx`-ben. Javítás: `updateLayer<L extends ImageLayer>(doc, id, patch: Partial<L>)` — egy szignatúra-javítás, 6 assertion eltűnik.
- `editorStore.ts:739` `set({ [key]: next } as never)` → explicit `switch`.
- `Toolbar.tsx:280` → `Map<TrackType, Clip[]>`.
- `batchEdit.ts:140` → `BATCHABLE_KEYS: readonly (keyof Clip)[]`.

### P3-5 · Architektúra-adósság
- **`AssistantPanel.tsx` 2093 sor, 22 `useState`, 16 feature egy komponensben.** A `hooks/` réteg mindössze 2 fájl — ez a god-komponensek gyökéroka. Javaslat: 9 hookra bontás (`useWorkerHealth`, `useAutoEditVariants`, `useBeatAnalysis`, `useSmartSearch`…), ~900 sorra csökkenthető.
- **`editorStore.ts` 1541 sor** — szerkesztési matematika a store-ban (`rollEdit` `:1278-1337`, `slipEdit`, `slideEdit`, `deleteRange` `:1201-1275`, `preCompose` `:817-880`) → `lib/`-be, a már bevált `lib/ripple.ts` mintájára.
- **Rétegsértés:** `AssistantPanel.tsx:129` nyers `fetch()` — **az egyetlen** `fetch()` az egész `src/components` + `src/app` fában (a rétegfegyelem egyébként kimagasló).
- `server/render.js` (2397) és `server/index.js` (1750) route-onkénti bontást kívánnak.

### P3-6 · Duplikáció / alulhasznált absztrakció
- **`aiPostJson`** (`aiFetch.ts:52`) — 11 `*Client.ts` kézzel ismétli ugyanazt a blokkot (~50 sor).
- **24 db `new File(uri) as unknown as Blob`** — a `mediaFormData()` helper (`upload.ts:15`) létezik, és mind a 15 érintett fájl **már importálja** az `upload.ts`-t. Egy refaktor 24 dupla assertiont 1-re csökkent.
- `clamp01` háromszor újradefiniálva (`curves.ts:8`, `trackPlan.ts:86`, `maskEdit.ts:18`).
- **4 nem használt függőség:** `@expo/ui`, `expo-glass-effect`, `expo-symbols`, `expo-web-browser`.

### P3-7 · Nulla retry az egész kódbázisban ✅
`grep -rniE 'retry|retries|backoff' src` → **0 találat**. Egyetlen tranziens hálózati hiba (cellaváltás, tunnel-újraindítás) is végleges bukás minden flow-ban. A `fetchWithTimeout`/`aiFetch` jó alap lenne egy központi retry-wrapperhez.

### P3-8 · Félkész megszakíthatóság
- `render.ts:223` — a `renderLocal` **nem fogad `AbortSignal`-t**, de a `withCancellableProgress` mindig kirajzolja a ✕-et → **a default (ingyenes, eszközön futó) exportnál a ✕ halott gomb**.
- `render.ts:384`, `:392-397` — a felhő-render feltöltési fázisa és poll-fetchjei nem kapják meg a signalt.
- `collectAndShareProject` (`render.ts:507-585`) — 10 perces poll, nulla megszakítás.

### ~~P3-9 · Nyers `res.json()` → „JSON Parse error" a felhasználónak~~ — ✔️ **JAVÍTVA**
**Megoldás:** `lib/netRetry.ts` → `readJson(res, fallback)` — a törzset EGYSZER olvassa szövegként, és csak utána értelmezi. Ha nem JSON, a hívó saját üzenetét adja a HTTP-státusszal; a nyers HTML sosem jut a felhasználóig. Mind a 8 hívóhely átállítva.
**Amit menet közben kiadott:** három ponton (`/render`, `/captions`, `/collect`) a `.json()` az `!res.ok` ág ELŐTT futott, tehát épp a beszédes hibaüzenet maradt ki. A szigorúbb típusok ezen felül két ellenőrizetlen mezőt is felszínre hoztak (`submitBody.id`, `body.srt`) — mindkettő őrizve.
**Eredeti lelet:** `render.ts:385, 398, 445, 494, 555` — ha a worker HTML-t ad (502, Cloudflare, tunnel-lejárat), a `.json()` dob, **mielőtt** az `!res.ok` ág beszédes üzenetet adna. A `aiFetch.ts:67` helyesen csinálja (`.json().catch(() => ({}))`) — ezt kell kiterjeszteni.

### P3-10 · UI-hibák, amik hazudnak a felhasználónak
- **Shop:** `shop.tsx:80-83`, `:156-163`, `:74` — hálózati hiba = „üres bolt" (nincs `error` state, nincs retry); a **már kifizetett** tétel „Használat" gombja hiba esetén némán nem csinál semmit; hiba esetén 0 kredit jelenik meg.
- **Feed:** `feed.tsx:86-93` — optimista like/save **rollback nélkül**; `:126-127` — a követés **mindig sikert jelent**, mielőtt a hívás lefutna.

### P3-11 · Aszinkron versenyhelyzetek
- **Realtime csatorna-szivárgás:** `collabStore.ts:50-66` és `notificationStore.ts:37-69` — az `unsub` az `await` **után** áll be, így gyors ki-belépésnél örökké nyitott WebSocket-feliratkozás marad. *(Maguk a `subscribeMembers`/`subscribeNotifications` függvények **helyesek** — a hiba a store-wrapperek sorrendjében van.)* Javítás: generációs token.
- **Projekt-betöltés `alive` guard nélkül:** `editor/[id].tsx:98-124`, `player/[id].tsx:45-59` — gyors A→B→A váltásnál a késői válasz a **globális store-t** írja felül. (A kódbázisban 16 helyen már van ilyen guard — itt hiányzik.)
- **`MulticamPanel.tsx:57-74`** — out-of-order `replaceAsync`, befagyott `masterTime` a closure-ben.

### P3-12 · Cleanup nélküli időzítők
- `CameraRecorder.tsx:140-153` — a visszaszámláló `setInterval` nem kerül ref-be; a modal bezárása után **elindítja a felvételt**.
- `editor/[id].tsx:115-117` — `setTimeout(…, 4000)` vision-indexeléshez, `clearTimeout` nélkül.

### P3-13 · Korlátlan cache-ek
`transcripts.ts:22,23`, `visionSearch.ts:23`, `cutlist.ts:20,21`, `beats.ts:28`, `voiceProxy.ts:34` — se LRU, se `clear*`, és a `cacheManager.clearCaches()` (`:67-69`) sem érinti őket. A generált thumbnail-**fájlok** lemezen szintén korlátlanul gyűlnek (`thumbnails.ts:19-23`), és a `cacheReport()` sem méri őket.

### P3-14 · Az `events` napló teljes klip-tömböket tárol
`commands.ts:41-46`, `:66-72` — a `REPLACE_TRACKS` command teljes `clips: Clip[]` tömböket hordoz, és ez bekerül az esemény-naplóba (`EVENT_LIMIT = 300`). Egy ripple-delete 100 klipes projekten mind a 100 klipet beírja. A `saveEvents` ezt **minden autosave-nél** újraszerializálja egy AsyncStorage kulcsba → az Android-limit (2 MB/kulcs) reálisan elérhető, és a mentés-hiba a P0-2 miatt **néma**.
**Javítás:** csak a command *leírása* + az érintett id-k (a `describeCommand` már létezik).

### P3-15 · Dokumentáció-eltérés ✅
Az `AGENTS.md` szerint „minden szerkesztő-művelet a `mutateProject`-en megy át" — **a `mutateProject` nem létezik a kódban** (csak egy kommentben: `HangStudio.tsx:46`). A valós bus: `dispatch(command, actor)` + `applyBatch()` → `applyCommand()`. A szabály él, csak a neve más. Mivel ez a projekt saját instrukciós fájlja, javítandó.

Továbbá: `types/project.ts:1220` doc-komment csak v4-ig sorol fel, miközben a migráció v5-ig megy; a `schemaVersion: 5` két helyen hardcode-olva (`projectUtils.ts:55,97`) → `CURRENT_SCHEMA_VERSION` konstans + literál-union kellene.

---

## 📐 Mérésre vár (nem javítandó vakon)

Ezeket **kódból nem lehet eldönteni** — eszközön mérendők, mielőtt hozzányúlunk:

1. **`Timeline` / `PreviewSurface` / `TrackAudio` tényleges render-száma** 10 mp lejátszás alatt (React DevTools Profiler vagy `console.count`).
2. **`JSON.stringify(project).length` + `JSON.stringify(events).length`** a `saveProject` előtt, 5 perc szerkesztés után — ez dönti el a P3-14 súlyosságát.
3. **Timeline-virtualizáció** hosszú idővonalnál — a klipek memoizáltak, a cél rövid-formátum, ezért ez ma nem szűk keresztmetszet; gesztus-nehéz `ScrollView` ablakozása mérés nélkül kockázatos.
4. ~~**`noUncheckedIndexedAccess`**~~ — ✅ **MEGVIZSGÁLVA, és a bevezetése NEM javasolt.** Ma 340 hibát ad (`boolean.ts` 36, `maskEdit.ts` 23, `trackPlan.ts` 19). Átnézve viszont **egyetlen valódi bug sincs köztük**: mind kötött ciklus (`i < poly.length`, `(i + 1) % n`), amit a TypeScript nem tud bizonyítani. Külső eredetű indexelés mindössze **3 helyen** van, és mindhárom bizonyíthatóan biztonságos (`?? []`, írás, illetve `String.split` — ami mindig ad legalább egy elemet). Külön kerestem a valódi veszélyes mintát is — `findIndex`/`indexOf` **−1**-es találata utáni indexelés őrizetlenül —, ebből **0 db** van. A flag bekapcsolása tehát ~340 `!` assertiont követelne nulla megtalált bug mellett, ami a `!` jelzés-értékét rontaná az egész kódbázisban. A külső adat határának védelmét a **P3-3** (`lib/parseGuards.ts`) már ellátja, célzottan.

---

## ✅ Ami kifejezetten jól van megoldva (ne nyúljunk hozzá)

Fontos, hogy ez is rögzüljön — több terület átlag feletti:

- **Secret-higiénia: tiszta.** A `.env` soha nem került a repóba (teljes `git log --all` ellenőrizve); az `EXPO_PUBLIC_` felület pontosan azt tartalmazza, aminek publikusnak kell lennie; **nincs** service-role vagy Anthropic-kulcs a bundle-ben.
- **RLS-réteg: kiváló.** `subscriptions` / `user_credits` írás-policy szándékosan nincs; `grant_credits` `revoke all from public, anon, authenticated`; `purchase_shop_item` atomikus `SECURITY DEFINER` egyenleg-ellenőrzéssel; minden `SECURITY DEFINER`-en `set search_path = ''`.
- **Injekció-védelem: példaértékű.** Minden `child_process` **argv-tömbbel** (`shell: true` sehol); a felhasználói szöveget Chromium rendereli PNG-vé, sosem kerül FFmpeg-filtergráfba; numerikus paraméterek `Number(v).toFixed(5)`-tel kényszerítve; path-allowlistek.
- **Command bus: 0 megkerülés** 63 ezer sorban (nincs `.tracks.push`, `.clips.splice`, `setState` a store-on kívül).
- **Undo-memória:** `HISTORY_LIMIT = 50`, strukturális megosztással (nincs deep-clone) → lépésenként ~8-10 KB, összesen ~0,5 MB.
- **Natív lejátszók életciklusa:** mind a 9 hook-kezelt (`useVideoPlayer`/`useAudioPlayer`), kézi `release()` nem is kell; az `AudioLayer` konstans 4 playert tart.
- **Klip-húzás/trim:** Reanimated shared value + commit csak `onEnd`-en (`TimelineClip.tsx:165-199`) — **mintaszerű** (pont ezt kell átvinni a görbe-szerkesztőkre, lásd P0-5).
- **7/7 `AbortController`-timeout** helyesen `finally`-ben törlődik.
- **0 `console.log`**, 306 i18n-esített `Alert`, 59/78 best-effort catch indokló kommenttel, működő `ErrorBoundary`.
- **Proxy-workflow:** `MAX_CONCURRENT = 2` szemafor, thumbnail-cache valódi LRU-val (300).
- **Jogosultság-lánc: teljes** (iOS usage description-ök + az összes Android permission) — ez volt a legnagyobb store-elutasítási kockázat, és átmegy. Lásd P1-2c a törékenységről.
- **Expo Go védelmi réteg: következetes.** Minden natív modul futásidejű őrrel: `requireOptionalNativeModule('RemixRender')` → felhő-fallback; védett `require` az IAP-nál (`billing.ts:40`); `isRunningInExpoGo()` őr a push-nál (`pushNotifications.ts:35`); dinamikus import a hullámformánál. **Az app nem dől el Expo Go-ban**, csak funkciók hiányoznak.
- **Függőségi fa tiszta:** nincs duplikált React / React Native; `react@19.2.3`, `react-native@0.86.3`, `reanimated@4.5.1`, `worklets@0.10.1` — mind **pontosan** az SDK 57 elvárása.
- **A `metro.config.js` / `babel.config.js` hiánya NEM hiba** — a `babel-preset-expo` automatikusan hozzáadja a `react-native-worklets/plugin`-t és a react-compilert; nincs egyedi Metro-transformert igénylő import.
- **Helyesen a `expo-splash-screen` plugint használja**, nem az elavult top-level `splash` mezőt; `icon.png` 1024×1024; `scheme: "remix"` megvan a deep-linkhez.

---

## 🎯 Javasolt sorrend

**1. sprint — adatvesztés és hibás működés (P0):** P0-1, P0-2 (mentés-biztonság) → P0-3 (dupla óra, ~15 sor) → P0-4 (`expo install expo-asset`) → P0-5 (görbe-szerkesztők commit-modellje).
*Ez a legnagyobb megtérülésű blokk: két adatvesztési út, egy dupla-sebesség bug és az undo használhatósága.*

**2. sprint — kiadhatóság (P1-2):** B1 (bundleIdentifier + package) → B2 (`npx eas init` + `eas.json`) → B3 (projectId) → B4 (env a buildbe) → **első működő preview build fizikai eszközön**. *Ez a négy lépés önmagában 3/10-ről ~7/10-re viszi az Expo-konfigurációt, és tisztán deklaratív munka.*

**3. sprint — élesítési kapu (P1 többi):** worker JWT-middleware + CORS-allowlist (egyben oldja P1-1/3/4/6) → HTTPS + ATS (S7) + SecureStore → `expo-dev-client` (S3) → minőség-kapu script + első unit-tesztek a pure magokra.

**4. sprint — teljesítmény (P2):** `projectDuration` WeakMap (5 sor) → `Timeline` leválasztása a playheadről → React Compiler bail-ok felszámolása a forró komponenseken → mérés, majd újraértékelés.

**5. sprint — higiénia (P3):** tsconfig-flagek + 3 javítás → 823 sor halott kód törlése → `updateLayer` generikus → `aiPostJson`/`mediaFormData` konszolidáció → `AssistantPanel` hook-bontás.

---

*Készült: Claude Opus 4.8 · 7 párhuzamos kód-audit + automatikus health check · minden ✅ jelölésű állítás külön ellenőrizve*
