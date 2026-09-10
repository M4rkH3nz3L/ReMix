# vided — interaktív videószerkesztő (React Native / Expo)

Mobil-first, érintőképernyőre tervezett videószerkesztő, amelyben a vágás mellett
**interaktív elemek** (kattintható hotspotok, elágazó ugrások, kvízek) is
szerkeszthetők. Az interaktivitás nem "sül bele" a videóba: JSON-metaadatként
tárolódik, és a lejátszó overlay-ként értelmezi.

Expo SDK 57 · React Native 0.86 · TypeScript · expo-router · zustand ·
react-native-reanimated 4 · react-native-gesture-handler · expo-video · expo-audio

## Indítás

```bash
npm install
npx expo start          # QR-kód → Expo Go, vagy:
npm run ios             # iOS szimulátor
npm run android         # Android emulátor
```

Minden használt natív modul Expo Go-kompatibilis, dev build nem kötelező.

## Ami már működik (MVP)

- **Projektek**: létrehozás (16:9 / 9:16 / 1:1), lista, törlés, automatikus mentés
  (AsyncStorage-draft, 0,8 mp-es debounce)
- **Többsávos idővonal** (videó/kép · szöveg · interaktív · hang):
  - középre rögzített lejátszófej, görgetéses léptetés (CapCut-minta)
  - kétujjas csippentés = zoom (0,2×–4×)
  - koppintás = kijelölés · hosszú nyomás + húzás = mozgatás (mágneses illesztés a
    0-ra és a lejátszófejre, haptikus visszajelzéssel)
  - kijelölt klipen két szélső fogantyú = trimmelés (videónál a forrásfájl
    határaira ütközve)
  - vágás a lejátszófejnél, duplikálás, törlés, undo/redo (50 lépés)
  - filmstrip-előnézet a videó/kép klipeken (trim/sebesség-helyes képkockák,
    expo-video-thumbnails, cache-elve) + hullámforma a hangklipeken
- **Előnézet**: expo-video lejátszó a rAF-mesterórához szinkronizálva
  (forráscsere, seek, drift-korrekció), kép-klipek, szűrő-overlay
- **Szöveg**: szín/háttér/méret/félkövér + animációk (beúszás, felcsúszás,
  pulzálás, gépelés); a vásznon húzással pozicionálható
- **Hang**: zene-import (dokumentumválasztó), voiceover-felvétel a lejátszófejtől
  (expo-audio), hangerő + fade in/out, lejátszáskor szinkron háttérhang
- **Sebesség**: 0,25×–4× presetek + finomhangolás (a klip idővonal-hossza együtt
  skálázódik)
- **Interaktív elemek**: hotspot-téglalap rajzolása/húzása/méretezése a vásznon;
  művelet: URL-megnyitás · ugrás időpontra (elágazó történet alapja) · kvíz
  (kérdés + válaszok + helyes válasz)
- **Interaktív lejátszó** (`/player/[id]`): a hotspotok élőben kattinthatók,
  kvíz-modallal, progress-sávval
- **Export**: hotspot-metaadat-JSON és teljes projekt-JSON megosztása
  (expo-sharing)

## Architektúra

```
src/
├── app/                    ← expo-router képernyők
│   ├── index.tsx           ← projektlista + új projekt
│   ├── editor/[id].tsx     ← szerkesztő (előnézet + transport + idővonal + panelek)
│   └── player/[id].tsx     ← interaktív lejátszó
├── components/
│   ├── editor/             ← Timeline, TimelineClip, Toolbar, TransportBar,
│   │   └── panels/         ← PanelHost + Text/Filter/Speed/Audio/Hotspot/Export
│   ├── preview/            ← PreviewSurface, TextOverlay, HotspotOverlay, AudioLayer
│   └── ui/controls.tsx     ← Chip, Stepper, ToolButton…
├── store/editorStore.ts    ← zustand: projekt + kijelölés + playhead + undo/redo
├── hooks/usePlaybackClock.ts ← rAF-mesteróra (a videó/hang ehhez szinkronizál)
├── lib/                    ← storage (AsyncStorage), media (picker+perzisztálás),
│   │                          export (interaktív JSON), projectUtils (vágás-matek)
├── types/project.ts        ← Project → Track → Clip modell (idő mp-ben,
│                              pozíciók 0–1 normalizálva)
└── constants/editor.ts     ← téma, sáv-színek, szűrők, zoom-limitek
```

**Kulcsdöntések**

- *Egy mesteróra*: a lejátszást requestAnimationFrame hajtja, a playhead a
  store-ban él; a videó- és hangréteg ehhez igazodik (drift-korrekcióval). Így a
  szöveg-animációk és hotspot-időzítések görgetésre is determinisztikusak.
- *Interaktivitás = metaadat*: az `InteractiveClip`-ek normalizált téglalapjai és
  műveletei a `lib/export.ts` szerinti JSON-ba exportálódnak — a videó maga
  hagyományos MP4 marad.
- *Gesztusok élőben, állapot elengedéskor*: a húzás/trimmelés Reanimated shared
  value-kon fut (60 fps, UI-szál), és csak a gesztus végén íródik a store-ba —
  minden írás egy undo-lépés.

## MP4-render worker (server/)

A szerveroldali FFmpeg-render működik dev környezetben:

```bash
cd server && npm install && npm start   # http://localhost:8787
```

Az app Export paneljén az „MP4 renderelése és megosztása" gomb feltölti a
projekt-JSON-t + a médiafájlokat, a worker pedig FFmpeg-gel renderel:
videó/kép-konkatenáció (lyukak feketével), sebesség, szűrő-overlay-ek,
fade-áttűnések, többsávos hangkeverés (amix), és a feliratok **beégetése** —
a szövegklipek headless Chromiummal rasterizálódnak PNG-vé, így a
stíluspresetek (buborék/kontúr/neon) pixelre egyeznek az app előnézetével.
A hosztot az app az Expo `hostUri`-ból veszi, tehát fizikai eszközről is
eléri a gépen futó workert. **A szöveganimációk a videóba is beégnek** a kliens
ütemezésével: fade/slide alpha-rámpa loop-olt PNG-streamen, pop/pulse valódi
per-frame skálázással (`scale eval=frame`), shake/slide mozgás az overlay
kifejezéseiben, a gépelés és a karaoke pedig állapot-PNG-kkel, enable-ablakos
váltással. Korlát: a hotspotok szándékosan sidecar-JSON-ban maradnak.

### Felhő-render (queue + S3 + skálázó workerek)

A render **hibrid, skálázható**: a **≤15 mp**-es videók a lokális szerveren
renderelnek azonnal, a hosszabbak a **felhőben** (a küszöb env-vel állítható,
`CLOUD_RENDER_MIN_SEC`). Felhő-módban a `POST /render` a médiát **S3-ba** tölti
és **BullMQ-queue-ba** (Redis) teszi a jobot; külön `render-worker.js`
process(ek) dolgozzák fel — több példány **vízszintes skálázás**. A `/render/:id`
a queue-ból ad státuszt+progresszt, a `/render/:id/file` az S3 publikus URL-re
redirektel. Bekapcsolás env-vel (`server/.env.example` alapján; dev-ben a lokális
Supabase Storage S3-végpontja, élesben bármely S3/R2/MinIO):

```bash
cp server/.env.example server/.env      # töltsd ki (a S3-kulcsok: supabase status)
cd server && node index.js              # API (dispatch)
cd server && node render-worker.js      # worker — indíts többet a skálázáshoz
```

Env nélkül a szerver a régi in-process úton renderel (a dev-worker változatlanul
működik); a `/health` `render` mezője jelzi az aktív módot.

### Auto-caption (Whisper)

A worker `/captions` végpontja a feltöltött médiából hangot nyer ki (FFmpeg),
és a `whisper-cli`-vel időzített, caption-méretű SRT-t készít (max ~40 karakter,
szóhatáron törve, nyelv-autodetektálással). Előfeltételek a gépen:

```bash
brew install whisper-cpp
curl -L -o server/models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

Az appban: Felirat panel → „Felirat a beszédből (Whisper)". A kliens a
forrásidőt trim/sebesség-helyesen képezi az idővonalra, kettévágott klipek
forrása csak egyszer megy át a felismerőn. Pontosabb átirathoz nagyobb modell
adható a `WHISPER_MODEL` env változóval (pl. ggml-small.bin).

### Vágási proxy

A worker `/proxy` végpontja a nagy felbontású videókból 720p-s (hosszabb él
≤1280 px) munka-példányt készít; a ≤1280 px-es forrásokat kihagyja
(`{skip:true}`). Az app előnézete és a filmstrip a proxyt használja, **a render
mindig az eredeti fájllal fut** — a klip uri-ja sosem íródik át. A proxy
eszköz-lokális műtermék: determinisztikus kulcsú (fájlnév+méret) lemez-cache-ben
él (`Documents/proxies`), nem kerül a projekt-JSON-ba. Előmelegítés
projekt-megnyitáskor és videó-hozzáadáskor; worker nélkül az eredeti fájllal
megy tovább minden.

### Médiatár (StorageProvider)

A szerkesztő **Tár** panelje a StorageProvider-Gateway forrásait böngészi
(`src/lib/storageProviders.ts`). Az első adapter a **szerver-tár**: a
`server/library` mappába másolt videó/kép/hang fájlok a worker `/library`
végpontján listázódnak (hossz ffprobe-bal), koppintásra az eszközre töltődnek
és a megfelelő sávra kerülnek (weben letöltés helyett streamelnek). Új forrás
(Drive/S3/WebDAV…) bekötése = egy új adapter a `storageProviders` listában —
a panel és a klip-hozzáadás forrás-független.

### Storage-gateway (távoli források: WebDAV/NAS + S3)

A worker a `server/storage.config.json`-ban konfigurált távoli forrásokat a
`/storage/*` végpontokon listázza és **auth-proxyval streameli**: a hitelesítés
a workeren marad, a kliens sosem látja. Támogatott típusok: **`webdav`**
(Nextcloud/ownCloud/NAS) és **`s3`** (AWS S3 és minden S3-kompatibilis tár:
MinIO, Cloudflare R2, Backblaze B2, Wasabi — `endpoint` mezővel). A hossz-adat
hozzáadáskor on-demand ffprobe-bal pótlódik (`/storage/:id/probe`). Beállítás:

```bash
cp server/storage.config.example.json server/storage.config.json
# szerkeszd: baseUrl, path, username, password
```

A forrás az app „Tár" paneljén jelenik meg; koppintásra a fájl az eszközre
töltődik és a megfelelő sávra kerül. Új forrás-típus (Drive/S3…) egy connector
a `server/storage.js`-ben — a kliens változatlan marad.

### Hang-könyvtár

A worker `/music` végpontja hang-könyvtárat szolgál ki az app Zene paneljének:

- **SFX-alapcsomag**: első indításkor FFmpeg-szintézissel generálódik
  (whoosh, pop, ding, riser, bass drop, kick, kamera-katt, tada) a
  `server/assets/sfx` mappába.
- **Saját zenék**: bármilyen mp3/m4a/wav/aac/ogg a `server/music` mappába
  másolva ~30 mp-en belül megjelenik az appban.

Koppintásra a hang letöltődik az eszközre és a lejátszófejnél kerül a
hang-sávra (weben letöltés helyett streamel).

### .vided projektfájl és Collect Project

- **`.vided` export** (Export panel): a projekt + asset-referenciák, nyers média
  nélkül — verziózott, átadható fájl. Exportkor minden asset **md5+méret
  ujjlenyomatot** kap (file identity). **Import** a főképernyő Import-gombjával:
  validálás + séma-migráció, majd **automatikus relink** — a hiányzó médiát az
  app médiatárában tartalom-egyezés alapján keresi (méret-előszűrés, md5-igazolás);
  ami így nem talál párt, arra tételenként kézi választót ajánl (a kihagyottak
  üres klipként maradnak).
- **Collect Project** (Export panel): a worker `/collect` végpontja a projektet
  + minden médiafájlt egyetlen zip-be csomagol (`project.vided` + `media/`,
  a projekt uri-jai relatív útra átírva) — átadáshoz, archiváláshoz.

### AI-hang (TTS)

A worker `/tts` végpontja **szöveg → beszéd** hangot gyárt (macOS `say` →
AAC/m4a ffmpeg-gel, tartalom-hash lemez-cache); a `/tts/voices` a telepített
hangokat listázza, a `/tts/:id/:name` a kész m4a-t szolgálja ki. Az appban:
Hang panel → **🗣️ AI-hang** → szöveg + hang-választó → a generált hang a
lejátszófejnél a voiceover-sávra kerül (felvétel nélkül — faceless videókhoz).
Provider-független (mint az AI-réteg): dev-ben `say`, élesben cloud-TTS a csere.

### Hullámforma

A worker `/waveform` végpontja a feltöltött hangból mono 8 kHz PCM-et nyer ki
(FFmpeg) és 20 csúcs/mp felbontású, normalizált csúcslistát ad vissza. A kliens
fájlnév+méret kulccsal lemezre cache-eli, így egy hangfájl csak egyszer megy
fel; ha a worker nem fut, az idővonal csendben címkés marad.

## Social backend (Supabase)

A közösségi réteg (TikTok-szerű feed, fiók/login, kedvelés/komment/követés,
realtime, remix) **Supabase**-en fut (Postgres + Auth + Realtime + Storage + RLS).
Dev alatt lokálisan, Dockerrel:

```bash
supabase start                       # elindítja a lokális stacket + alkalmazza a migrációt
cp .env.example .env                 # majd töltsd ki a supabase status ANON_KEY-ével
# EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321   (szimulátor: a host localhostja)
npx expo start --ios --clear         # a kliens az .env-ből olvassa az URL-t + kulcsot
```

A séma egyetlen migrációban él (`supabase/migrations/`): profiles (a `auth.users`
tükre, signup-triggerrel), posts (a szerkeszthető projekt **JSONB**-ként utazik a
poszttal → egy koppintásos Remix), follows/likes/saves/comments/notifications/
reports; **denormalizált számlálók triggerrel** (→ a `posts` UPDATE-je Realtime-on
viszi a friss számot), **RLS mindenhol** (moderáció/privacy a DB-ben), és **feed-RPC-k**
(`get_feed` keyset-lapozással + `get_for_you` hot-rank, a poszt+szerző+liked/saved
egy körben). A videó/borító a `videos`/`posters` Storage-bucketbe tölt.
A kliens-belépési pontok: **Feed** a kezdőképernyőn, **Közzététel** az editor
fejlécében, `/auth` és `/profile` képernyők. Részletek: [SOCIAL-TODO.md](SOCIAL-TODO.md).

Fizikai eszközön: a Supabase-t 0.0.0.0-ra kell kötni (`supabase/config.toml`), és az
`EXPO_PUBLIC_SUPABASE_URL`-t a gép LAN-IP-jére állítani.

## Ismert MVP-korlátok és a következő fázisok

- **MP4-export éles üzemben**: a dev-worker (server/) éles változata sorba
  állítással + tárhellyel (S3) a Fázis 1 backend része.
- **Szűrők**: az előnézet overlay-közelítés; a valódi LUT/színkorrekció a
  szerveroldali renderben érvényesül. GPU-előnézethez a `@shopify/react-native-skia`
  a kijelölt irány.
- **Hangkeverés**: egyszerre egy hangklip szól (a legutóbb kezdődő); több sávos
  együttszólás + ducking a Fázis 2 része.
- **Átmenetek** (crossfade/wipe): a klipmodell kész rá (átfedés megengedett), a
  vizuális átmenet-render a Skia-réteggel együtt érkezik.
- **Közösségi réteg** (fiókok, feltöltés, remix, felfedezés): Fázis 1-backend
  (Node/NestJS + PostgreSQL + S3/CDN) — a kliens draft-modellje már ehhez igazodik.

## Parancsok

```bash
npx tsc --noEmit   # typecheck
npm run lint       # eslint (a Reanimated/expo-video mutációs szabály-kivételekkel)
```
