# Nagy fájlok bontása — REFACTOR roadmap

> Ág: `refactor`. Cél: minden 500 sornál hosszabb éles forrásfájl felelősség szerinti bontása
> **viselkedésváltozás nélkül** — a publikus API, a szerkesztési képességek, a render-kimenet és a
> platform-kompatibilitás változatlan. Szabály: nem sorszám, hanem felelősség, kohézió, csatolás és
> tesztelhetőség szerint bontunk; a szerkezeti és a funkcionális változás sosem kerül egy commitba.

## ✅ Eredmény (2026-11-21, `refactor` ág)

| | Kiinduló (`e463d0a`) | Most |
|---|---:|---:|
| 500 sor feletti éles fájl | 63 | 2 (indokolt kivétel, lent) |
| 1000 sor feletti forrásfájl (`large-files.json`) | 12 | 0 |
| Jest suite / teszt | 561 / 5981 | 669 / 7387 (+1406) |
| Lint | 0 hiba / 70 figyelmeztetés | 0 hiba / 68 figyelmeztetés |
| Körfüggőség | 2 | 1 (`errors ↔ logCaught`) |
| Coverage (V8) sor / függvény / ág | 73,88 / 67,58 / 81,69 % | 77,01 / 68,83 / 83,91 % (az új padló) |
| Rögzített export (API-kapu) | 6001 / 1100 modul | 7828 / 1695 modul — a régiek neve és típusa változatlan |

**Bizonyítási módszer fájlonként:** szó szerinti áthelyezés (sor-tartomány-szkriptek), az eredeti útvonal
re-exportál (API-kapu: név + kanonikus TS-típus hash), **golden trace** — az eredeti (`git show HEAD:`) és az
új kód ugyanazokon a forgatókönyveken, felvevő mockokkal (store/dispatch actorral, hálózat, natív, fájl,
Alert, logCaught, teljes host-fa), bájtra azonos kimenet — **negatív kontrollokkal** (szándékos mutánsok,
mind kiszúrva), statikus multiset-egyezés (i18n-kulcsok, logCaught-ujjlenyomatok, parancs-típusok, a11y),
UI-n React Compiler-mérés (`tools/reactCompiler.test.js`: a memoizált részek rögzítve, ahol a gyökér a
bontás után memoizálhatóvá vált volna, szándékos `'use no memo'` — a memoizálás bekapcsolása külön döntés).
Ahol mérhető volt: valódi Chromium (PNG sha256), valódi ffmpeg (filtergraph + mp4 sha256), bitre pontos DSP,
Stryker-mutációs pontszám (command-bus), Reanimated worklet-törzsek.

**Indokolt kivételek (500 sor felett marad):** `src/components/studio/image/ImageStudioBody.tsx` (580 — a
képernyő-elrendezés gyökere), `src/components/studio/audio/AudioStudioBody.tsx` (511 — az idővonal-JSX
kiemelése ~30 propot igényelne kohézió nélkül), `src/dev/smoke/index.tsx` (989 — dev-only elosztó, bájtra
változatlan; a fázisai a 6. fázisban suite-okba bontva).

**A kapuk javítása menet közben (mind teszttel rögzítve):** az API-kapu sorrend- és helyfüggetlen lett
(union/objektum-tagok rendezése, `import("…")`-minősítés, `typeof import`, minősített nevek), és a CommonJS
`module.exports = …` modulokat is látja (29 szerverfájl eddig kimaradt).

**6. fázis:** a `contract.test.ts` / `commands.test.ts` 13 tartomány-suite-ra bontva, közös fixture-ök a
`src/test-utils/` alatt (izolációs őrteszttel); a jest ténylegesen futtatja a dinamikus `import()`-ot
(`tools/jest/babel-plugin-dynamic-import.js`, csak jest — az éles bundle bájtra azonos); a 15 dev-smoke
fázis-fájl funkció szerinti suite-okba bontva, a smoke-körfüggőség megszűnt. Eszközös (iPad) futtatás a
refaktor során NEM történt.

### Javítandó hibák súlyossági sorrendben (részletek lent, fájl:sor hivatkozással)

1. 🔒⚠️ AI-számlázás megkerülése a saját env-kulcsunkon (üres kulcsú „BYOK”) — `server/aiLib/` — ✅ JAVÍTVA (kulcs nélküli anthropic config nem BYOK → mért env-út; a `runAnthropic` BYOK-ként sosem esik env-kliensre)
2. 💰⚠️ Dupla pénzmozgás dupla koppintásra — Wallet (kifizetés/vásárlás/előfizetés/ajándék) és Bolt —
   ✅ JAVÍTVA (szinkron `createInFlightLock` zár a gyökérben; szerveres idempotencia-kulcs még nincs)
3. 🔒⚠️ Idegen felhő-render megszakítása (cancel a tulaj-ellenőrzés előtt) — `server/routes/renderLib/`
4. 🔒⚠️ SSRF átirányításon (`/imagedoc`, `/psd/export`) és beágyazott kompozíción (`/render`) át
5. 🔒⚠️ OAuth: beégetett `'insecure-dev-secret'` fallback (hamisítható fájl-token), XSS a `returnUrl`-en — ✅ JAVÍTVA (1)+(3) (prod: csak `OAUTH_STATE_SECRET`, hiányában 503 / indulás-tiltás; returnUrl-allowlist + escape)
6. ⚠️ Image Studio SVG/vektoros PDF export: `[object Promise]` a beágyazott fotók helyén
7. ⚠️ Projekt-tár: párhuzamos mentésnél projektek kiesnek a listából
8. 🔒 Live egress / session / Studio, felhasználói fájlok, social feed, chat, wallet-lib, image-szerver —
   további biztonsági és robusztussági pontok
9. Funkcionális furcsaságok szinte minden területen (lent)

## Bizonyítási kapuk (minden lépés után)

| Kapu | Parancs | Mit bizonyít |
|---|---|---|
| Típusok | `npm run typecheck` | a bekötés hibátlan (kliens + worker) |
| Lint | `npm run lint` | 0 hiba; a figyelmeztetések száma nem nő (kiinduló: 70) |
| **API-felület** | `node scripts/quality/api-surface.js` | minden korábbi export **neve és TS-típusa** változatlan (6001 export, 1100 modul — `api-surface.json`); a szétbontott fájl re-exportál |
| **Körfüggőség** | `node scripts/quality/cycles.js` | új futásidejű import-kör nem keletkezett (kiinduló: 2 kör — `cycles-baseline.json`) |
| Fájlméret | `node scripts/quality/file-size.js` | az óriásfájlok nem nőnek; bontás után a lista zsugorodik |
| Tesztek | `npm test` | a meglévő tesztek + a kiemelt modulok új regressziós tesztjei zöldek |

A három struktúra-kapu: `npm run structure`, és része az `npm run audit`-nak és a CI-nek.

## 0. fázis — kiinduló állapot (2026-11-20, `e463d0a`)

- `npm run audit`: zöld — tsc 0 hiba, lint 0 hiba / 70 figyelmeztetés,
  **561 suite, 5981 sikeres + 1 kihagyott teszt** (49 s; teljes audit 1:52).
- Körfüggőség: 2 ismert kör — `src/lib/errors.ts ↔ src/lib/logCaught.ts`,
  `src/dev/smoke/phases15.tsx ↔ src/dev/smoke/shared.tsx` (a 6. fázisban megszűnt — ma 1 kör).
- 500 sor feletti fájl: **81** = 63 éles + 2 teszt (`contract.test.ts`, `commands.test.ts`)
  + 16 dev-only smoke (`src/dev/smoke/*`). Generált, asset- és vendored fájl nincs köztük
  (a `git ls-files` + `node_modules`/`ios`/`android` kizárással mérve).
- Hiányzó regressziós tesztek: a nagy UI-komponenseknek (Timeline, PreviewSurface, panelek) nincs
  komponens-tesztjük; a bontásnál a kiemelt **tiszta logika** kap unit-tesztet, a UI-bekötést a
  típusellenőrzés + az API-kapu + a meglévő integrációs tesztek fedik, az érintős munkafolyamatokat
  az iPad-es eszközkör.

## Bontás közben talált, NEM javított furcsaságok

A szerkezeti commitok szándékosan nem javítanak viselkedést; ezeket a tesztek a mai állapotukban
rögzítik, a javítás külön (funkcionális) commit, döntés után.

- ⚠️ **SÚLYOS — Image Studio SVG- és vektoros PDF-export** (`src/components/studio/image/body/fileExportActions.tsx`,
  `buildExportSvg`): a beágyazott helyi fotó `data:…;base64,${src.base64()}` — az expo-file-system v57-ben
  a `File.base64()` `Promise<string>`-et ad, így MINDEN beágyazott fotó helyén
  `data:image/…;base64,[object Promise]` kerül a fájlba (a golden trace-ben 11 előfordulás). Valószínű
  javítás: `base64Sync()` vagy `await`. Ugyanitt: jestben az `await import('…/exportVerify')` nem fut,
  így a minőségkapun átmenő tesztek a catch-ágba esnek.

- **TimelineClip mozgatás-snap** (`src/components/editor/timelineClip/timelineClipHandlers.ts`,
  `commitMove`): a kezdet- és a vég-illesztés közül az nyer, amelyik KEVESEBBET mozdítana — a nem
  illeszkedő él elmozdulása 0, így mindig ő nyer. A mágneses illesztés ezért csak akkor hat, ha
  mindkét él illeszkedik; a haptika viszont hatástalan illesztésnél is megszólal.
- **LayerInspector font-betöltés** (`src/components/studio/image/LayerInspector.tsx`): a
  `setFontsReady` állapot csak újrarenderelést kényszerítene a font betöltése után, de az értékét
  senki nem olvassa; memoizált gyökérnél a gyorsítótárazott JSX így nem rajzolódik újra — a
  font-chipek frissítése valószínűleg már az eredetiben is hatástalan.
- **Image Studio path-szerkesztés undo-címkéi** (`src/components/studio/image/body/pathEditActions.ts`):
  nyers technikai szövegek (`path-closed`, `path-reverse`, `node-<típus>`, `node-delete`), nem
  `t()`-kulcsok — ha az előzmény-lap mutatja őket, ott fordítatlanok.
- **PrecisionPanel** (`src/components/editor/panels/precision/`): (1) a doksi „tizedmásodperces
  igazítást” ír, a sec-mód viszont századra kerekít (a lépés 0,1 s); (2) a forgatás-stepper a nyers
  értéket mutatja (`${rotation}°`), a Graph Editor kerekít; (3) `setDuration`-ben ha egy videó
  `maxVideoDuration`-je kisebb a `MIN_CLIP_DURATION`-nál, a `clamp` min > max argumentumot kap.
- **SVG-import** (`src/lib/svg/`, `src/lib/vector/svgPathParse.ts`): (1) egyetlen hibás `<path>`
  (kevés szám egy parancsban, pl. `"M0 0 L1"`) `TypeError`-ral az EGÉSZ importot megbuktatja ahelyett,
  hogy az elemet kihagyná (a golden trace 978 `parseSvg`-hívásából 37); (2) a hexa karakter-entitás
  (`&#x41;`) dekódolatlan marad; (3) részben érvénytelen `viewBox` (nem numerikus x/y) NaN eltolást ad.

- **AudioPanel** (`src/components/editor/panels/audio/`, `src/lib/audioPanelOps.ts`): a „Fade in” /
  „Fade out” Stepper-címke beégetett angol szöveg, nem i18n-kulcs; a high-pass 1–40 közötti értékről
  (pl. AI-állította 40) `+20`-szal 60-ra ugrik, nem a 60-as padlóra; a low-pass 16 kHz feletti
  érték (pl. 18 kHz) csak kikapcsolható; az `AudioFxSection.setFx` felesleges `if (clip)` ellenőrzése.

- **TextPanel** (`src/components/editor/panels/text/`, `src/lib/textPanelOps.ts`): (1) a kinetikus
  lépésköz kijelzése bontásonként más alapértéket mutat (betű 30 / szó 80 / sor 140 ms), a léptető
  viszont mindig 0,08-ról lép → betű-módban 30 ms-ról „+”-ra 100 ms lesz; (2) a `convertToShape`
  nem véd try/finally-vel: ha a `bakeTextToImage` dobna, a „busy” állapot beragad és a rejection
  kezeletlen (ma a bake belül elkap, így elméleti); (3) a pont-kijelölős követés a régi (bezárt)
  panel closure-jéből indul → az újranyitott panelen nem látszik a „követés…” állapot, és a busy-őr sem hat.
- **CaptionsPanel** (`src/components/editor/panels/captions/`, `src/lib/captionPanelOps.ts`): (1) a
  beszélő-szín/-címke, okos pozíció és a Caption Studio akciói `void`-dal indulnak catch nélkül → egy
  arc-/AI-hiba kezeletlen rejection, és a chip-felirat „elemzés…” állapotban ragad; a szó-időzítésnél a
  `getProjectWordCues`/`withProgress` hibája szintén kezeletlen (a státusz ott visszaáll); (2) a fordítás a
  nyelv NEVÉT küldi (`English`), nem a kódját — a `TARGET_LANGS.code` csak React-kulcs; (3) a „Caption
  Studio” szekció- és alert-cím beégetett szöveg; (4) a káromkodás-maszk és a safe-zone aktor nélkül
  (alapértelmezett), a többi AI-művelet `'ai'` aktorral dispatch-el; (5) az arc-mintavétel 60 feliratnál
  megáll, a többi „nincs forrás” csoportba kerül.

- **ClipEditSheet** (`src/lib/clipEditOps.ts`): (1) a „mentetlen változás” az effekteket
  `JSON.stringify`-jal hasonlítja → ugyanazok az értékek más kulcssorrendben (pl. felhasználói preset
  után) hamis „dirty”-t adnak; (2) a `pendingSettingsPatch` (take-választás, tempó-illesztés) a fade-eket
  a MENTETT hosszhoz vágja, nem a szerkesztetthez; (3) trim + minimális hossznál a fade-ek a nyers
  (0,01 s) hosszhoz vágódnak, a hossz viszont 0,1 s-ra emelkedik → fadeIn/fadeOut 0; (4) a `proFx`
  azonosság-burkoló maradvány.

- **AudioLayer** (`src/components/preview/audio/`): a `VideoVoice` minden képkockán írja a
  `player.volume`-ot 0,005-ös küszöb nélkül (a `ClipAudioPlayer` küszöböl); a `ClipAudioPlayer`
  play/pause-effektje a `latencyLearnedRef`-et a `useRef` deklarációja ELŐTT használja (csak azért
  működik, mert az effekt a render után fut); a modul-globális `startLatencySec` minden lejátszó és
  képernyő között közös.

- **Offline mix** (`src/lib/mix/`): a `stretchJobs` `trimIn` nélküli klipen TypeError-t dob (csak kézzel
  épített tervvel érhető el); a `sliceSource` negatív `n`-re RangeError; az `offlineMixPlan` klipenként
  kétszer hívja a `sendsOf`-ot; az `OfflineUnsupported` többi mezőjét (videoSpeed, voiceEnhance, …) soha
  semmi nem tölti, csak az `effects`-et.

- **Hang-DSP és -intent** (`src/lib/dsp/`, `src/lib/intent/audio/`): az `Echo`/`Haas` nem véges
  késleltetésre (ms) `RangeError`-t dob; a split-szabály `kette`/`ketté` alternatívája a `norm` után
  soha nem illeszkedhet (halott ág); a `tracksIn` klip nélküli sávot is létezőnek vesz („az effektre”
  egy üres sfx-sávra mutat).

- **Live Studio** (`src/components/live/studio/`, `src/lib/liveStudioOps.ts`): a képernyő az élő ELŐTTI
  szerkesztő — LiveKit-kapcsolat, chat és egress NINCS benne (az a `/live/[id]`-ben él). Biztonsági
  észrevételek (nem javítva): (1) a „+ RTMP” multistream-cél felvétele és be/ki kapcsolása kliens-oldalon
  NINCS Pro-kapuhoz kötve (csak a felirat mondja „Pro”); a dokumentum külső célplatform-chipjei is
  Free-ben kapcsolhatók — a kapu a szerveren kell legyen; (2) a kulcs nélküli cél (`hasKey: false`) a
  listán bekapcsolható (`setDestinationEnabled` közvetlenül a táblára ír); (3) a stream-kulcs sikertelen
  mentés / Mégse után a képernyő állapotában marad (`rtmpKey`), a modal újranyitásakor visszatöltődik;
  (4) a nem `live.dest.*` hibaüzenet (szerver/DB-szöveg) nyersen jelenik meg az Alertben. Egyéb: a
  „Tap to enable camera”, „Camera”, „Auto-duck”, „Master”, „Studio”, „Pro” beégetett angol szöveg; a
  „Rögzítés” defaultValue magyar a többi angol mellett; az `onCancel` törlése nem várja meg a
  `deleteProject`-et, mielőtt visszalép.

- 🔒 **Live egress (szerver)** (`server/egress/`; zárójelben az eredeti `server/liveEgress.js` sor):
  (1) a párhuzamos-egress limit versenyhelyzetben átléphető — a számlálás és az indítás nem atomi
  (`control.js:101-103`, `:153` [415-417/467]); hiányzó tábla / számlálási hiba = engedés; (2) ha a
  követő sor beszúrása elbukik, a LiveKit-egress fut tovább sor nélkül → a `routes/live.js`
  `egressOwner` 404-et ad, a tulaj nem tudja leállítani, a sweep/reconcile sem látja, a költségkontroll
  kimarad (`tracking.js:34-47` [158-172]); (3) DNS-rebinding ablak: a `resolveSafe` egyszer ellenőrzi az
  RTMP-cél DNS-ét, a LiveKit később újra feloldja (`control.js:81` [395]); (4) nyers DB-hibaüzenet a
  kliensnek, redaktálás nélkül (`control.js:73` [387] → `routes/live.js:140`); (5) a `stopEgress`
  maga nem ellenőriz tulajdont — csak a route (`INSECURE_DEV` bypass-szal) (`control.js:174` [488]);
  (6) egyetlen visszafejthetetlen stream-kulcs az egész indítást 500-zal bukja, a komment szerint
  kihagyná (`control.js:116-120` [424-435]). Nem biztonsági: a reconcile `listEgress` → `[]` esetén
  a sort nem zárja le (csak `[null]`-ra), így a user a stale-sweepig (240 perc) a 429-es limitben
  ragadhat (`reconcile.js:44-50` [300-306]); a 429-üzenet record-only indításnál is „multistream”-et mond.

- **3D Stúdió** (`src/components/studio/model3d/`): a `reconstruct` teljesen elbukik, ha az
  `inspectModel` hibázik (a `finishRoomScan` ezt tolerálja); a `posterTried` a poszter-pótlás SIKERE
  előtt állítódik, így egy sikertelen snapshot ugyanabban a munkamenetben nem próbálkozik újra; a
  `finishRoomScan` némán semmit nem tesz, ha a `Remix3D` null; az `applyProcess` doksi „új OBJ assetet”
  ígér, a formátum valójában a tárolási beállítást követi.

- **Szöveg-render (szerver)** (`server/textRender/`): üres vagy csak szóközös szöveg-klip (karaoke /
  írógép nélkül) nulla méretű `#t` elemet ad → a valódi Chromium-screenshot kivárja a 30 s-os
  időkorlátot és dob.

- 🔒 **Live session** (zárójelben a HEAD-beli `src/app/live/[id].tsx` sor; ma `src/components/live/session/`):
  (1) a `void stopLiveEgress(...)` hívásoknak nincs `.catch`-e (:365, :441, :494) — a sikertelen
  egress-leállítás kezeletlen rejection, megkerüli a logCaught-ot, így egy árván futó egress nyom
  nélkül marad (a `bumpViewerPeak` :329 ugyanígy); (2) az egress-leállítás csak az `egressId`-t küldi —
  a tulajdont a szervernek kell érvényesítenie; (3) a kliens indít egresst, ha van cél / rögzítés — a
  Pro-kapu teljesen a szerver 402-es válaszán múlik; (4) a heartbeat hiba-állapotban (permission /
  token / reconnect-timeout) is fut tovább → a session média nélkül „élő” marad a feedben; (5) az
  unmount-cleanup a `myUserId()`-ból számolt `isHost`-on múlik — identitás-váltáskor (kijelentkezés)
  lezárja az élőt és törli a konfig-projektet; (6) unmount utáni `startLiveEgress`-rejection még
  `setEgress`-t hív (ártalmatlan). Nincs AppState-kezelés és nincs telefonos RTMPS-út a képernyőn.

- **Felhős render (kliens)** (`src/lib/renderPipelineClient/cloudJob.ts`, `cache.ts`, `collect.ts`): (1) a
  státusz-poll nem nézi a HTTP-státuszt — egy `state` nélküli JSON-os 404/401 a `MAX_POLLS`-ig (~10 perc)
  pollol, aztán `renderTimeout`; (2) átmeneti poll-hiba (TimeoutError vagy kétszeri hálózati hiba)
  `cancelRender` NÉLKÜL öli a renderet → a szerveres job tovább fut; a `netRetry` TimeoutError-üzenete
  beégetett magyar; (3) 2 kísérlet után a 429/503 végleges válaszként jön vissza → „renderError (HTTP
  429)”; (4) a `collectAndShareProject` nem megszakítható (nincs signal, retry nélküli poll); (5) a
  `storeRenderCache` a régi bejegyzéseket a másolás ELŐTT törli — sikertelen másoláskor a cache üres
  marad. Jestben a dinamikus `import()` nem fut, így a `phoneMixFile` és a médiatár-utak a repó
  tesztjeiből elérhetetlenek.

- 🔒 **Felhasználói fájlok (szerver)** (`server/userFilesLib/`; a sorszám a HEAD-beli `server/userFiles.js`):
  (1) L97–103 `userRoot` elutasítás helyett KIVÁG: `'../alice'` → `files/alice/`, `'a.b'` és `'ab'`
  ütközik — csak addig biztonságos, amíg a uid mindig szerver-hitelesített UUID; (2) L828–829
  `sweepSessions`: védetlen `JSON.parse` — egyetlen sérült session-JSON után az adott user MINDEN
  `uploadInit`-je tartósan 500 (ugyanígy L764 `restoreTrash`, L818 `readSession` → 500 a 4xx helyett);
  (3) L861–870, L886–897: a multipart staging-bájtok nincsenek a kvóta-főkönyvben → sok befejezetlen
  sessionnel kvótán felül tárolható az R2-n a 7 napos sweepig (ami csak ugyanazon user következő
  `uploadInit`-jénél fut); (4) L294–296, L462–464: `S3_FILES_BUCKET` nélkül a user-fájlok a közös
  média-bucketbe esnek, amelynek publikus r2.dev domainje lehet, a kulcsok kitalálhatók — konfig-
  kockázat; (5) L671–676 `move` (és L558–562, L931–935): check-then-copy verseny, a copy csendben
  felülír; (6) L363, L407: a kliens `contentType`-ja validálatlanul tárolódik, a `routes/files.js:133`
  visszhangozza (attachment enyhíti, de nincs `X-Content-Type-Options: nosniff`); (7) L251–286 a
  helyi backend multipart-útjai kihagyják az `abs()`-ellenőrzést (csak dev); (8) L196–199 a helyi
  `listAll`-nak nincs MAX_TREE plafonja; (9) L777–785 `purgeTrash` nem létező id-t is „removed”-nak
  számol, nem tömb `ids` → TypeError (500); (10) L952–959 `uploadAbort` mindig `{aborted:true}`.

- 🔒⚠️ **Kép-render és kép-eszközök (szerver)** (`server/imagedocLib/`, `server/routes/imageToolsLib/`; a
  sorszám a HEAD-beli `server/imagedoc.js` (ID) és `server/routes/imageTools.js` (IT)): (1) SÚLYOS — IT L41: a
  távoli réteg-média `safeFetch(u, { redirect: 'follow' })`, a `ssrf.js` L202–209 viszont CSAK a kiinduló URL-t
  ellenőrzi, a `fetch` az átirányítást validálás nélkül követi → egy nyilvános, 302-vel belső címre
  (169.254.169.254, localhost, LAN) mutató URL-lel a `/imagedoc` és a `/psd/export` SSRF-et indít (DNS-rebinding
  ellen sincs védelem); (2) ID L373–380: a távoli választ időkorlát nélkül, TELJESEN a memóriába olvassa, és csak
  utána nézi a 40 MB-os plafont (rétegenként 4 hivatkozás × 400 réteg, sorosan) → memória/idő-DoS; (3) ID L367 +
  IT L43–47: a `localPath` (`new URL` / `decodeURIComponent`) a `try`-on KÍVÜL fut → egy rossz %-kódolású saját
  `/m/` URL az egész `/imagedoc`-ot 500-zal (a `/psd/export`-ot 400-zal) dönti a réteg kihagyása helyett;
  (4) IT L642–661: a `/stickers3d/:id.png` hitelesítés és rate-limit NÉLKÜL indít Chromium-WebGL rendert, a
  yaw/pitch/size/material/env kombinációk (~10⁸) mind új render + új cache-fájl → nem hitelesített CPU/disk-DoS;
  (5) IT L471, 495, 543, 588, 667, 698: a 40 MB-os `image` profilú route-ok a 2 GB-os `upload` multert használják
  (az `uploadImage` helyett) → a mediaGuard csak a lemezre írt 2 GB UTÁN utasít el; (6) IT L443: a `/svg/pdf`-en
  nincs mediaGuard, fájlonként 200 MB, fájlszám-korlát nélkül; (7) IT L588, 125, 208, 361: a `/bgremove` és a
  PSD/PDF-útvonalak rate-limit nélküliek (csak Pro/kvóta), a `/depth/*` ONNX-futás pedig nem Pro-kapus (a
  `/bgremove` az); a `/imagedoc` render nincs mérve (`usage`); (8) a multer méret-hibája a `lib/httpError`
  kezelőben 500 „Szerverhiba." (`LIMIT_FILE_SIZE`) a 413 helyett, és a már létrehozott `vided-render-*`
  munkakönyvtár ott marad (csak a 6 órás söprés viszi); (9) IT L110, 466, 489, 513, 537, 560, 581, 608, 657, 690,
  720: a `.catch` `err.message.slice` / `err.message` nem-Error elutasításnál TypeError-t dob a catch-ben →
  kezeletlen rejection, válasz nélkül; (10) ID L251–257: a `renderImageDoc` JSDoc-ja árván a korlátok előtt áll
  (a bontás szándékosan így hagyta, különben a `doc` típusa megváltozna).

- 🔒⚠️ **SÚLYOS — Külső tárhelyek / OAuth (szerver)** (`server/userStorageLib/`; a sorszám a HEAD-beli
  `server/userStorage.js`): ✅ JAVÍTVA az (1) és a (3) pont (`signing.js`: a titok CSAK az `OAUTH_STATE_SECRET`, a
  service-role kulcs többé nem HMAC-titok; production-ben hiányában az aláírás 503-as hibát dob, az ellenőrzés
  mindig elutasít, a `prodGates` bekötött OAuth-kliens mellett megtagadja az indulást; a dev-konstans csak
  dev/teszt-ben; `oauthFlow.safeReturnUrl`: csak `remix://`, a `CORS_ORIGINS` web-originjei és dev-ben `exp(s)://`,
  a callback a régi state-ek célját is újra-ellenőrzi; `routes/storage.js`: a cél-literálban `<` → `\u003c`, az
  `oauthErr` és a hibaszöveg HTML-escape-elve); a (2), (4)–(13) pont nyitott. (1) L63–64: az `OAUTH_STATE_SECRET` a `SUPABASE_SERVICE_ROLE_KEY`-re, majd a
  beégetett `'insecure-dev-secret'`-re esik vissza, fail-fast nélkül — a konstanssal BÁRKI hamisíthat
  OAuth-state-et és LEJÁRAT NÉLKÜLI fájl-capability tokent BÁRMELY uid-ra (`verifyFileToken` L656–674 →
  `routes/storage.js:211`; a trace üres env-vel elfogadta a hamisítottat); (2) L154–173, L202–214: az
  OAuth-state-nek nincs session-kötése, nonce-a, lejárata → örökké újrajátszható, account-linking CSRF;
  (3) L163/L213 + `routes/storage.js:104–110`: a validálatlan `returnUrl` egy `<script>location.replace(…)</script>`
  blokkba kerül a worker originjén (`javascript:` fut, a `</script>` nincs escape-elve) → XSS;
  `routes/storage.js:97` az `oauthErr`-t HTML-be tükrözi; (4) L80, L673: nem konstans idejű HMAC-
  összehasonlítás; (5) L651, L670: kétértelmű `:` elválasztó a HMAC-inputban; (6) L128, L249: az OAuth
  access/refresh tokenek és a WebDAV/S3 hitelesítők titkosítatlanul a `config` jsonb-ben; (7) L118: a
  `saveSourceConfig` elnyeli a hibát → elveszhet a rotált refresh_token; (8) L570–580: a
  `setDefaultTarget` nem atomi, idegen `sourceId`-re hibátlanul törli az összes alapértelmezést; (9)
  L308–311, L430–433: az upstream Content-Type (pl. `text/html`) visszhangzik nosniff/attachment
  nélkül egy bearer nélküli capability URL-en → tárolt XSS a worker originjén; (10) timeout nélküli
  nyers `fetch` (L300, L375, L422, L450, L469, L489), teljes fájl memóriába (L441/467/487); (11)
  CRLF-injekció a multipart contentType-ban (L446, L468, L526, L530), szanitizálatlan fájlnév
  (`ReMix/../../x.mp4` → `davUpload`); (12) a `routes/storage.js:133` WebDAV/S3 config-ja
  validálatlanul tárolódik — nincs igazolva, hogy az `assertSafeUrl` minden dav*/s3* utat fed; (13)
  L58–61, L155: az `OAUTH[provider]` lookup Object.prototype-kulcsokat is elér.

- 🔒 **Social feed** (`src/lib/feedClient/`, `src/hooks/feed/`): (1) a `toggleLike`/`toggleSave`/`toggleFollow`/
  `deletePost`/`deletePostsForProject` figyelmen kívül hagyja a Supabase `{error}`-t — RLS-elutasítás
  sikerként oldódik, az optimista visszagörgetés csak hálózati rejectionnél fut, a UI a szerver által
  elutasított állapotot mutathatja; (2) a `deletePost` csak `id`-re szűr, `creator_id` nélkül — a tulajt
  kizárólag az RLS védi; (3) a `getChannel` és a `listRemixesOf` láthatóság/moderáció-szűrő nélkül kér
  posztokat, a `listFeed('following')` `visibility in (public, followers)` — a helyesség teljesen az
  RLS-en múlik (auditálandó); (4) a `viewerEngagement` rejection-je az egész feed-hívást bukja, az
  `{error}` viszont csendben „nem lájkolt”; (5) az `onToggleMute` weben mindig `play()`-t hív, natívon
  csak az aktív posztnál; a feedben nincs unfollow-út.

- **Command-bus** (`src/lib/commandBus/`): a `REMOVE_CLIP` minden sáv-objektumot újraépít (a
  `SPLIT_CLIP`/`MOVE_CLIP` megtartja a nem érintettek `===`-azonosságát) — React- és undo-referencia
  megosztás vész el; ismeretlen/régi parancs-típusra az `applyCommand` és a `describeCommand`
  `undefined`-ot ad, nem `null`-t; a lista-csere parancsok (markerek, fejezetek, régiók, linkek,
  zárolt sávok) `key: undefined`-ot hagynak a kulcs törlése helyett (a fontok/thumbnail/workflow/tempo-map
  törli); hibás payload nyers TypeError-t dob, validáció nincs.

- ⚠️ **Projekt-tár (adatvesztés-közeli)** (`src/lib/projectStoreClient/projects.ts`): a `saveProject` /
  `saveProjectAndEvents` beolvassa, majd felülírja a projekt-indexet — párhuzamos mentésnél az utolsó
  író nyer, a többi projekt KIESIK a listából (a trace-ben p1 és p2 dokumentuma a tárban van, a lista csak
  x-et és p3-at mutatja); mivel az index nem sérült, újraépítés sem indul. Apróságok: az `isNewerSchema`
  a `'12'` stringet is újabbnak veszi; a `loadVersions` nem validálja az elemeket; a `recordAutoVersion`
  NaN lastauto-értéknél nem throttle-öl.
- 🧪 **Teszt-infra: a jest nem futtatja a dinamikus `import()`-ot** (`--experimental-vm-modules` nélkül
  „A dynamic import callback was invoked without…”) — a repó tesztjeiben így a `storage` mappa/szinkron/
  GC/rebase-ágai, a render `phoneMixFile`- és médiatár-útjai és az Image Studio minőségkapuja
  CSENDBEN a catch-ágba esnek, valójában teszteletlenek (négy bontás golden trace-e egymástól függetlenül
  mutatta ki; a trace-ekhez scratch babel-plugin fordította `require`-re). → 6. fázis: ✅ JAVÍTVA
  (`tools/jest/babel-plugin-dynamic-import.js`, csak a jest client-projektben; az éles bundle bájtra azonos).

- 🔒⚠️ **SÚLYOS — AI-számlázás megkerülése a SAJÁT env-kulcsunkon** (`server/aiLib/`; HEAD `server/ai.js`):
  ✅ JAVÍTVA az (1) pont (`byok.js`: anthropic BYOK csak nem-üres kulccsal, különben null → az `aiMeter` kvótát
  ellenőriz és a `runStructured` env-úton mér; `providers.js`: kulcs nélküli BYOK-cfg-re hiba, env-kliens nem
  épül; az OpenAI-kompatibilis/custom BYOK a user végpontjára megy a mi kulcsunk nélkül, a lokális nem BYOK);
  a (2)–(5) pont nyitott. A `sanitizeAiConfig` (ai.js:313-319) elfogad `{provider:'anthropic', model:'<bármi>'}` configot ÜRES
  `apiKey`-jel; az `aiMeter` (`server/lib/guards.js:76`) ezt BYOK-nak veszi és kihagyja a kvótát; a
  `runStructured` (ai.js:388-393) a BYOK-ot nem méri; a `runAnthropic` (ai.js:239) viszont `new Anthropic()`-ra
  esik vissza, ami a MI `ANTHROPIC_API_KEY`-ünket használja → bármely hitelesített (Free) user mérés és
  kvóta nélkül, tetszőleges modellel (max_tokens 16000 + adaptive thinking) használja a kulcsunkat (a
  trace igazolja: BYOK-hívás env-klienssel, `trackUsage` nélkül). További: (2) nincs timeout/abort az
  LLM-hívásokon (ai.js:240, 274, 347) — egy lassú BYOK-végpont a végtelenségig fogja a kérést, a ReMix-
  úton a sor-helyet is (ai.js:399); (3) DNS-rebinding ablak (ai.js:330→347, 763→779); (4) 300 karakter
  upstream hibaszöveg jut a hívóhoz (ai.js:280, 363); (5) gyenge prompt-injection határ (ai.js:433, 741;
  a séma-validáció enyhíti).

- 🔒⚠️ **SÚLYOS — Szerveres videó-render** (`server/routes/renderLib/`, `server/render/`; HEAD-sorszám):
  (1) IDEGEN render-job megszakítása: a cancel (`routes/render.js:654`) a `cancelRenderJob(id)`-t a
  tulaj-ellenőrzés (655–658) ELŐTT hívja — egy idegen várakozó job ténylegesen kikerül a sorból
  (`queue.js:130`), futónál abort-flag (`queue.js:140`); az ID ismeretében bárki leállíthatja más
  felhő-renderjét, és csak utána kap 404-et (a trace bizonyítja); (2) SSRF beágyazott kompozíción át:
  a /render csak a felső szintű klipek URI-jait írja át (`routes/render.js:52–95`), a
  `clip.comp.tracks` belső klipjeinek `uri`-ja ellenőrzés nélkül az ffmpeg `-i`-jére kerül
  (`server/render/segmentGraph.js:94`) — `http://`, `file://`, abszolút worker-útvonal is; a
  `localPathOnly` (`videoFilters.js:20–26`) csak a matte-et és a LUT-ot védi, és csak a séma-előtagot
  szűri; (3) a /render-en nincs rateLimit (`routes/render.js:36`; az `authorization.test` `rateClass:
  'render'`-t vár), nincs mediaGuard, a feltöltési plafon a 2 GB-os fallback; (4) temp-mappa szivárgás a
  400-as és a felhő-ág hibaágain (43–46, 99–102; 503/429/500) a 6 órás sweepig; (5) `project = null` →
  500 a 400 helyett; (6) a body-ból jövő uid-fallback (148) és a `?userId` (418) nincs `INSECURE_DEV`-hez
  kötve (ma elérhetetlen, de törékeny); (7) a helyi (≤ 15 s) szerver-render nincs kvótázva és mérve, a
  sor-prioritást a kliens által küldött `tier` adja (190); (8) nyers `err.message` (ffmpeg, belső
  útvonalak) a kliensnek.

- **Auth és csatorna képernyő** (`src/components/auth/`, `src/components/channel/`; HEAD-sorszám): az
  `auth.tsx:522-525` GDPR-hozzájárulás Pressable-jének nincs `accessibilityRole`/`accessibilityState`-je
  (checkboxként működik), és `busy` alatt sincs letiltva; a regisztráció előtti felhasználónév-ellenőrzés
  és a store nyers hibaszövege („User already registered”) felfedi, létezik-e a név/e-mail (tervezetten);
  `channel/[id].tsx:211-225`: a nem-tulaj remix-ága elérhetetlen, és a `remixFromPost(...).then` catch
  nélküli; `:228-235` a `doPromote` nem ellenőrzi a `targetViews < 1`-et (csak a letiltott gomb);
  `:74-77, 303` `id` nélkül a betöltés-jelző örökké pörög.

- **Matrica / könyvtár panel** (`src/components/editor/panels/sticker/`, `library/`): a `fetchFaces`
  rejection-je nincs elkapva (`void addFaceSticker`) — kezeletlen rejection (a `finally` a busy-t
  visszaállítja); ha a `downloadSticker3d` dob, a `busy3d` beragad, és a panel újramountolásáig minden
  3D-objektum zárolva marad; a `listStickers3d` rejection-je sincs elkapva.

- 💰⚠️ **SÚLYOS — Wallet dupla pénzmozgás** (`src/components/profile/wallet/walletActions.ts`; HEAD
  `WalletCard.tsx:134–144`): a `guard` a render-kori `busy`-t olvassa — két gyors koppintás ugyanabban a
  renderben KÉT pénzmozgató hívást indít (a trace az eredetiben is 2× `requestPayout`-ot mutat egy dupla
  koppintásra); ugyanez a vásárlás, az előfizetés, az ajándék és a dev-jóváírás. Ref-alapú zár vagy
  szerveres idempotencia-kulcs kell. → ✅ JAVÍTVA (kliens): a `guard` a render-kori `busy` mellett a
  gyökérben egyszer létrehozott szinkron zárat (`src/lib/asyncGuard.ts` `createInFlightLock`) foglalja az
  első `await` előtt, `finally`-ben enged; render-teszt: `wallet/walletActions.test.tsx`. Szerveres
  idempotencia-kulcs NINCS (a `/wallet/payout`-ot a heti limit + `for update`, a vásárlást a
  `unique (item_id, buyer_id)` védi; az ajándék, az előfizetés és a Coin-csomag nem idempotens) — a valódi
  javítás szerveroldali. Továbbá: (2) :296–299 0/érvénytelen kifizetési összegre néma
  visszatérés, kliens-minimum nincs; (3) :207 az előfizetés hibájának logCaught-címkéje `:onPayPro`
  (`onSubscribe` helyett — megőrizve az ujjlenyomat miatt); (4) :395 a „webes, olcsóbb” link fixen
  `'coins_10'`; (5) :269 a mentett fiók fixen `provider: 'paypal'`; (6) beégetett „+1 🪙 (dev)” és
  `'#39d98a'`.
- **Tárhely-kártya** (`src/components/profile/storage/`; HEAD `StorageCard.tsx`): (7) :142, 162, 180,
  200 `await refresh()` hatástalan (void) — a busy a frissítés vége előtt visszaáll; (8) :171–188 a
  leválasztásnak nincs busy-őre; (9) :209–223 versenyhelyzet a fájl-listánál (késve érkező válasz
  felülírja a nyitott forrás listáját); (10) nyers `(e as Error).message` a felhasználónak i18n nélkül;
  (11) :98 hiányzó add-on definíciónál 0 ár, vásárolható; (12) :41–56 beégetett helyőrzők.

- **Profil / stúdió hookok** (`src/hooks/profile/`, `src/hooks/studio/`): (1) a `useStudio` `create`-jének
  nincs catch-e — `saveProject`-hiba kezeletlen rejection, nincs logCaught és Alert, a `creating` igaz
  marad; (2) a Design-projekt elveszti a formátumát (a `config.image.format: 'vector'`-t a
  `docFromTemplate` felülírja); (3) az avatar- és borító-feltöltés a render-kori profilt spreadeli — a
  feltöltés közbeni mezőszerkesztések mentéskor elvesznek; (4) a `refresh` egyetlen `Promise.all`-lal
  tölti a profilt, a szolgáltatókat és a taskokat — egy hiba az egész profil-képernyőt üresen hagyja;
  (5) a dev-akció effekt első-render closure-öket használ (csak a stabil setterek miatt működik).

- 🔒 **Chat** (`src/lib/chatCore/`, `chatClient/`; HEAD `src/lib/chat.ts`): (1) :551 `openTypingChannel`
  `void senderFields().then(...)` catch nélkül — offline kezeletlen rejection; (2) :268-271 az inbox
  `conversations` select-jén nincs tagság-szűrő, a :521 `subscribeInbox` minden változásra figyel — a
  privátság teljesen az RLS-en (és az RLS realtime-szűrésén) múlik; (3) :115 profilnév nélkül az e-mail
  helyi része kerül `sender_username`/`sender_name`-ként a mások által olvasható üzenetekbe (privacy);
  (4) :221, :445 és a listConversations/resolvePeers olvasásai figyelmen kívül hagyják a `{error}`-t —
  RLS-elutasítás „nincs beszélgetés”; (5) :~376 a `getConversation` a teljes inboxot tölti, a
  `resolvePeers` peerenként egy RPC (N+1).
- 💰 **Wallet lib** (`src/lib/walletCore/`, `walletClient/`; HEAD `src/lib/wallet.ts`): (6) :182, 239, 259,
  333, 355, 554 a listák figyelmen kívül hagyják a `{error}`-t — RLS/hálózati hiba üres lista vagy 0
  (a `fetchWallet`/`fetchSubscription` viszont dob — következetlen); (7) :291 a `requestPayout`
  validálatlan `cents`-et küld (2000.5 is) — a szervernek kell validálnia; (8) :316 `minor_no_payout`
  sima Error; (9) :394 a `parseSubscription` tört/negatív seats-et és negatív `renewal_cost`-ot is
  elfogad; (10) :540 a `claimReferral` csak egy vezető `@`-ot vág.
- **Kereső / asset-könyvtár** (`src/lib/universalSearchCore/`, `assetLibraryCore/`): a `summerYear`
  ternary két ága azonos; „this-week/month” gördülő 7/30 nap; érvénytelen `now` → RangeError;
  `rateAsset(NaN)` NaN-t tárol; az `addVersion` üres hash-t a felső szintre írja; a no-op `removeTag`/
  `removeFromCollection`/azonos nevű `renameAsset` is új referenciát és `updatedAt`-et ad.

- 💰⚠️ **Bolt dupla vásárlás** (`src/components/shop/shopActions.ts`; HEAD `src/app/shop.tsx`): (1) :157–162 a
  busy-őr a render-kori értéket olvassa — egy renderen belüli két koppintás 2× `purchaseItem`-et indít (a
  trace az eredetiben is ezt mutatja; ugyanaz a minta, mint a Walletnél); a `doPublish` (:212) ugyanígy, a
  `confirmUnpublish`-nak (:250) nincs őre; → ✅ JAVÍTVA (szinkron `inFlight` zár a vásárlás, a használat, a
  publikálás és a visszavonás körül; render-teszt: `shop/shopActions.test.tsx`); (2) :531–545 halott stílusok; (3) :153, :245 nyers `e.message`
  i18n nélkül. A bolt képernyőn nincs Free/Pro logika és 30 %-os díj-kijelzés.
- **Render-sor képernyő** (`src/app/schedules.tsx` — valójában a felhő-render sor nézegetője): :248
  ismeretlen `phaseKey`-re ikon nélküli chip (`?.` hiányzik a JobRow-ban); :86 nyers hibaüzenet.
- 🔒 **Admin** (`src/components/admin/`; HEAD `src/app/admin.tsx`): :97–107 a `toggle` a render-kori `pairs`-t
  olvassa — dupla koppintás kétszer küldi ugyanazt; → ✅ JAVÍTVA (kulcsonkénti szinkron zár: jog-kapcsoló,
  bejelentés/fellebbezés lezárása, DAC7, valamint a PayoutReviewList/FinanceReviewList azonos `busy`-mintája;
  render-teszt: `admin/adminActions.test.tsx`); :139 a `removeRole` hibája `String(e)`; :201
  beszédtelen logCaught-címke (`app/admin.tsx:run`); :73–90 `Promise.all` — egy lista hibája az egészet
  üresen hagyja; :171, :213, :421 a jelentés-/fellebbezés-/DAC7-műveleteknek nincs busy-őre (✅ JAVÍTVA: zár).
- **Kamera-felvevő** (`src/components/editor/cameraRecorder/`; HEAD `CameraRecorder.tsx`): :140–188 elavult
  closure — felvétel/visszaszámlálás alatt váltott sebesség és szűrő nem érvényesül (3× után is
  `speed:1`); :78–84, :88–96 unmount/elrejtés felvétel közben nem hívja a `stopRecording`-ot — a
  `recordAsync` függőben marad; :107/114/121 ugyanaz a logCaught-címke három különböző hibára.

## Éles fájlok (63)

| Fájl | Sor | Állapot |
|---|---:|---|
| `src/components/editor/Timeline.tsx` | 1531 | ✅ → 233 |
| `src/components/editor/panels/AssistantPanel.tsx` | 1507 | ✅ → 195 |
| `src/app/editor/[id].tsx` | 1459 | ✅ → 288 |
| `src/components/studio/image/ImageStudioBody.tsx` | 1444 | ✅ → 581 |
| `src/components/preview/PreviewSurface.tsx` | 1423 | ✅ → 443 |
| `src/components/studio/model3d/Model3DStudio.tsx` | 1365 | ✅ → 322 |
| `src/lib/render.ts` | 1195 | ✅ → 35 |
| `server/text-render.js` | 1174 | ✅ → 42 |
| `src/lib/feed.ts` | 1137 | ✅ → 32 |
| `src/app/live/studio/[id].tsx` | 1137 | ✅ → 293 |
| `src/components/studio/image/LayerInspector.tsx` | 1105 | ✅ → 110 |
| `src/components/editor/panels/ExportPanel.tsx` | 1059 | ✅ → 144 |
| `server/userFiles.js` | 997 | ✅ → 47 |
| `src/app/auth.tsx` | 980 | ✅ → 403 |
| `src/hooks/useFeed.ts` | 975 | ✅ → 251 |
| `src/app/live/[id].tsx` | 952 | ✅ → 376 |
| `src/components/editor/panels/TextPanel.tsx` | 926 | ✅ → 67 |
| `src/components/studio/audio/ClipEditSheet.tsx` | 889 | ✅ → 310 |
| `src/lib/offlineMix.ts` | 887 | ✅ → 21 |
| `src/components/editor/panels/CaptionsPanel.tsx` | 850 | ✅ → 88 |
| `src/lib/commands.ts` | 843 | ✅ → 13 |
| `src/lib/vectorPath.ts` | 813 | ✅ → 35 |
| `server/ai.js` | 805 | ✅ → 35 |
| `src/components/editor/Toolbar.tsx` | 795 | ✅ → 237 |
| `server/imagedoc.js` | 775 | ✅ → 33 |
| `server/routes/imageTools.js` | 741 | ✅ → 56 |
| `src/components/studio/audio/AudioStudioBody.tsx` | 738 | ✅ → 512 |
| `src/components/editor/TimelineClip.tsx` | 732 | ✅ → 277 |
| `src/components/editor/panels/AudioPanel.tsx` | 718 | ✅ → 145 |
| `src/lib/projectUtils.ts` | 715 | ✅ → 45 |
| `src/components/studio/image/ImageCanvas.tsx` | 715 | ✅ → 442 |
| `src/app/channel/[id].tsx` | 693 | ✅ → 168 |
| `server/userStorage.js` | 693 | ✅ → 46 |
| `src/components/studio/CreateProjectModal.tsx` | 687 | ✅ → 253 |
| `src/lib/audioDsp.ts` | 680 | ✅ → 23 |
| `src/components/preview/AudioLayer.tsx` | 676 | ✅ → 88 |
| `src/components/profile/WalletCard.tsx` | 674 | ✅ → 192 |
| `server/routes/render.js` | 667 | ✅ → 34 |
| `src/components/editor/panels/ShapePanel.tsx` | 637 | ✅ → 45 |
| `src/components/editor/panels/StickerPanel.tsx` | 608 | ✅ → 88 |
| `src/hooks/useProfile.ts` | 601 | ✅ → 202 |
| `src/components/studio/image/body/useImageExport.tsx` | 601 | ✅ → 73 |
| `src/lib/svgImport.ts` | 595 | ✅ → 65 |
| `src/lib/universalSearch.ts` | 593 | ✅ → 26 |
| `src/lib/wallet.ts` | 592 | ✅ → 55 |
| `src/components/editor/panels/PrecisionPanel.tsx` | 583 | ✅ → 101 |
| `src/lib/chat.ts` | 578 | ✅ → 42 |
| `server/render/clipChains.js` | 570 | ✅ → 45 |
| `src/hooks/useStudio.ts` | 558 | ✅ → 223 |
| `src/components/preview/TextOverlay.tsx` | 558 | ✅ → 236 |
| `src/app/shop.tsx` | 557 | ✅ → 238 |
| `src/components/profile/StorageCard.tsx` | 549 | ✅ → 133 |
| `src/lib/offlineMixClient.ts` | 543 | ✅ → 11 |
| `src/components/editor/CameraRecorder.tsx` | 543 | ✅ → 208 |
| `src/app/schedules.tsx` | 541 | ✅ → 199 |
| `src/lib/storage.ts` | 524 | ✅ → 27 |
| `src/app/admin.tsx` | 524 | ✅ → 193 |
| `server/liveEgress.js` | 524 | ✅ → 27 |
| `src/lib/audioIntent.ts` | 523 | ✅ → 13 |
| `src/components/editor/panels/LibraryPanel.tsx` | 523 | ✅ → 107 |
| `src/store/editorState.ts` | 522 | ✅ → 399 |
| `src/lib/assetLibrary.ts` | 514 | ✅ → 55 |
| `server/render/videoFilters.js` | 502 | ✅ → 27 |
