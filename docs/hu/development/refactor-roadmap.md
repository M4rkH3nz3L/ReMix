# Nagy fájlok bontása — REFACTOR roadmap

> Ág: `refactor`. Cél: minden 500 sornál hosszabb éles forrásfájl felelősség szerinti bontása
> **viselkedésváltozás nélkül** — a publikus API, a szerkesztési képességek, a render-kimenet és a
> platform-kompatibilitás változatlan. Szabály: nem sorszám, hanem felelősség, kohézió, csatolás és
> tesztelhetőség szerint bontunk; a szerkezeti és a funkcionális változás sosem kerül egy commitba.

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
  `src/dev/smoke/phases15.tsx ↔ src/dev/smoke/shared.tsx`.
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

- 🔒⚠️ **SÚLYOS — Külső tárhelyek / OAuth (szerver)** (`server/userStorageLib/`; a sorszám a HEAD-beli
  `server/userStorage.js`): (1) L63–64: az `OAUTH_STATE_SECRET` a `SUPABASE_SERVICE_ROLE_KEY`-re, majd a
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
| `src/app/auth.tsx` | 980 | ⬜ |
| `src/hooks/useFeed.ts` | 975 | ✅ → 251 |
| `src/app/live/[id].tsx` | 952 | ✅ → 376 |
| `src/components/editor/panels/TextPanel.tsx` | 926 | ⬜ |
| `src/components/studio/audio/ClipEditSheet.tsx` | 889 | ✅ → 310 |
| `src/lib/offlineMix.ts` | 887 | ✅ → 21 |
| `src/components/editor/panels/CaptionsPanel.tsx` | 850 | ⬜ |
| `src/lib/commands.ts` | 843 | ✅ → 13 |
| `src/lib/vectorPath.ts` | 813 | ✅ → 35 |
| `server/ai.js` | 805 | ⬜ |
| `src/components/editor/Toolbar.tsx` | 795 | ✅ → 237 |
| `server/imagedoc.js` | 775 | ⬜ |
| `server/routes/imageTools.js` | 741 | ⬜ |
| `src/components/studio/audio/AudioStudioBody.tsx` | 738 | ✅ → 512 |
| `src/components/editor/TimelineClip.tsx` | 732 | ✅ → 277 |
| `src/components/editor/panels/AudioPanel.tsx` | 718 | ✅ → 145 |
| `src/lib/projectUtils.ts` | 715 | ⬜ |
| `src/components/studio/image/ImageCanvas.tsx` | 715 | ✅ → 442 |
| `src/app/channel/[id].tsx` | 693 | ⬜ |
| `server/userStorage.js` | 693 | ✅ → 46 |
| `src/components/studio/CreateProjectModal.tsx` | 687 | ⬜ |
| `src/lib/audioDsp.ts` | 680 | ✅ → 23 |
| `src/components/preview/AudioLayer.tsx` | 676 | ✅ → 88 |
| `src/components/profile/WalletCard.tsx` | 674 | ⬜ |
| `server/routes/render.js` | 667 | ⬜ |
| `src/components/editor/panels/ShapePanel.tsx` | 637 | ✅ → 45 |
| `src/components/editor/panels/StickerPanel.tsx` | 608 | ⬜ |
| `src/hooks/useProfile.ts` | 601 | ⬜ |
| `src/components/studio/image/body/useImageExport.tsx` | 601 | ✅ → 73 |
| `src/lib/svgImport.ts` | 595 | ✅ → 65 |
| `src/lib/universalSearch.ts` | 593 | ⬜ |
| `src/lib/wallet.ts` | 592 | ⬜ |
| `src/components/editor/panels/PrecisionPanel.tsx` | 583 | ✅ → 101 |
| `src/lib/chat.ts` | 578 | ⬜ |
| `server/render/clipChains.js` | 570 | ⬜ |
| `src/hooks/useStudio.ts` | 558 | ⬜ |
| `src/components/preview/TextOverlay.tsx` | 558 | ⬜ |
| `src/app/shop.tsx` | 557 | ⬜ |
| `src/components/profile/StorageCard.tsx` | 549 | ⬜ |
| `src/lib/offlineMixClient.ts` | 543 | ✅ → 11 |
| `src/components/editor/CameraRecorder.tsx` | 543 | ⬜ |
| `src/app/schedules.tsx` | 541 | ⬜ |
| `src/lib/storage.ts` | 524 | ⬜ |
| `src/app/admin.tsx` | 524 | ⬜ |
| `server/liveEgress.js` | 524 | ✅ → 27 |
| `src/lib/audioIntent.ts` | 523 | ✅ → 13 |
| `src/components/editor/panels/LibraryPanel.tsx` | 523 | ⬜ |
| `src/store/editorState.ts` | 522 | ⬜ |
| `src/lib/assetLibrary.ts` | 514 | ⬜ |
| `server/render/videoFilters.js` | 502 | ⬜ |
