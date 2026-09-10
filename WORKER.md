# WORKER.md — a vided szerveroldali feldolgozó-rétege

Ez a dokumentum a `server/` mappában élő „workerek" működését írja le: mit
csinálnak, milyen külső eszközökre támaszkodnak, hogyan kapcsolódik hozzájuk a
kliens, és — a leggyakoribb kérdésre válaszolva — **futhatnak-e ezek a
felhasználó saját készülékén.**

---

## 1. Rövid válasz: futhatnak-e a user készülékén?

**Nem, a jelenlegi formájukban nem.** A „workerek" nem az appban (React
Native / Expo) futó kód, hanem egy **különálló Node.js/Express HTTP-szerver**
(`server/index.js`, alapból a `8787`-es porton). Minden feldolgozás ott zajlik,
és **nehéz, natív, asztali eszközláncot igényel**, ami mobilon nem elérhető:

- **FFmpeg / ffprobe** (rendszerszintű CLI) — a legtöbb funkció alapja,
- **whisper.cpp** (`whisper-cli`) a beszédfelismeréshez,
- **Ollama** (lokális LLM- és vision-runtime) az AI-funkciókhoz,
- **Headless Chromium** (Playwright) a szöveg-/forma-/3D-/thumbnail-rasterhez,
- **ONNX Runtime natív bináris** (`onnxruntime-node`) + modellfájlok a
  mélységbecsléshez, háttér-eltávolításhoz, arc-detektáláshoz, felskálázáshoz.

Ezek egy **fejlesztői gépen** (jelenleg macOS / Apple Silicon célra hangolva)
futnak. A telefon vagy a böngésző **HTTP-n keresztül, hálózaton át** éri el
őket. Fizikai eszközről is működik, de csak azért, mert **ugyanazon a
gépen/LAN-on futó szervert** hívja — a számítás sosem a készüléken történik.

A részletes „mi mozdítható on-device / mi nem" elemzés a
[9. szakaszban](#9-on-device-megvalósíthatóság-mit-lehetne-áttenni-a-készülékre)
van.

---

## 2. Architektúra dióhéjban

```
   ┌─────────────────────────┐         HTTP (multipart / JSON)        ┌──────────────────────────────┐
   │  vided app (kliens)      │  ───────────────────────────────────▶ │  server/ — Node/Express :8787  │
   │  iOS · Android · Web     │                                        │  (a „workerek" gyűjtőhelye)    │
   │                          │  ◀───────────────────────────────────  │                              │
   │  src/lib/*Client.ts      │     JSON / bináris (PNG, MP4, SRT…)     │  ffmpeg · whisper · ollama    │
   └─────────────────────────┘                                        │  chromium · onnxruntime       │
                                                                       └──────────────────────────────┘
```

- **Egy folyamat, sok modul.** A `server/index.js` egyetlen Express-appot
  indít, és a végpontokat témánként külön modulokra bízza (`ai.js`, `depth.js`,
  `render.js`, `beats.js`, `track.js`, `vision.js`, `sky.js`, …). A köznyelvi
  „worker" itt ezt jelenti: **egy-egy feldolgozó-végpont + a mögötte lévő
  modul.** Nem OS-szintű worker-processzek, nem Web Workerek.
- **Állapotmentes végpontok + in-memory job-tábla.** A gyors műveletek
  szinkronban válaszolnak; a hosszúak (render, proxy, collect) egy `jobs`
  Map-be kerülnek, és a kliens pollozza az állapotukat (lásd
  [7. szakasz](#7-job-modell-a-hosszú-műveletekhez)).
- **A kliens-oldali „adapterek"** a `src/lib/` alatt élnek
  (`render.ts`, `proxy.ts`, `depthClient.ts`, `faceClient.ts`,
  `visionSearch.ts`, `colorClient.ts`, `reframeClient.ts`, `hooksClient.ts`,
  `autoeditClient.ts`, `skyClient.ts`, `upscaleClient.ts`,
  `captionStudioClient.ts`, `imageDocClient.ts`, `stickers3d.ts`, …). Ezek
  csomagolják a médiát multipart-ba, meghívják a workert, és a választ a
  szerkesztő adatmodelljére fordítják.

---

## 3. A kliens hogyan találja meg és éri el a workert

A host-felderítés a [src/lib/render.ts](src/lib/render.ts#L21-L27)-ben van:

```ts
export function renderServerUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (!host) return `http://localhost:${RENDER_PORT}`; // 8787
  return `http://${host}:${RENDER_PORT}`;
}
```

- Dev alatt a worker **ugyanazon a gépen fut, mint a Metro bundler**, ezért a
  kliens az Expo `hostUri`-jából veszi a gép IP-jét — így **fizikai eszközről
  is** eléri a LAN-on a gépet.
- **`/health` mint kapu.** Szinte minden kliens-adapter először a `/health`-et
  hívja rövid timeouttal. A válasz **képesség-zászlókat** ad vissza, amelyekből
  a UI eldönti, mit ajánljon fel:

  ```json
  { "ok": true, "service": "vided-render",
    "captions": true, "ai": true, "aiProvider": "local",
    "vision": false, "depth": true, "stickers3d": true,
    "bgremove": true, "faces": true, "upscale": true }
  ```

- **Kecses fokozatos leépülés.** Ha a worker nem fut, a szerkesztés **nem áll
  meg**: a proxy csendben az eredeti fájllal megy tovább
  ([proxy.ts](src/lib/proxy.ts#L83-L88)), a hullámforma címkés marad, a render/
  felirat/collect pedig érthető hibaüzenetet ad („indítsd el: `cd server &&
  npm start`").
- **CORS.** A szerver minden originre engedélyez (`Access-Control-Allow-Origin:
  *`, [index.js](server/index.js#L50-L53)), mert a webes dev-előnézet (8081)
  másik originről hívja.

---

## 4. Runtime-függőségek (mit kell telepíteni a gépre)

| Függőség | Mi hajtja | Kliens-oldali funkció | Telepítés |
|---|---|---|---|
| **FFmpeg + ffprobe** | rendszer-CLI (`execFile`) | render, proxy, hullámforma, jelenet-/csend-/beat-elemzés, hangkinyerés, depth-kompozit, minden média-transzkód | `brew install ffmpeg` |
| **whisper.cpp** (`whisper-cli`) | rendszer-CLI + `ggml-base.bin` modell | auto-felirat (`/captions`) | `brew install whisper-cpp` + modell-letöltés |
| **Ollama** | lokális LLM/vision HTTP-runtime (`:11434`) | AI-asszisztens, Auto Edit, Caption Studio, Hook/Thumbnail-headline, Smart Search (vision + embedding) | `ollama serve` + `ollama pull qwen3:14b qwen2.5vl:7b nomic-embed-text` |
| **Headless Chromium** | `playwright-core` (Playwright-cache) | felirat/forma beégetése, 3D-matricák (three.js/WebGL), thumbnail-kompozit, részecskék | `npx playwright install chromium` |
| **ONNX Runtime** | `onnxruntime-node` (natív) + `.onnx` modellek | mélység/parallax (`depth-anything-v2-small`), háttér-eltávolítás (`u2net`), arc-detektálás (`ultraface`), felskálázás (`superres`) | `npm install` a `server/`-ben + modellek a `server/models/`-ben |
| **AWS S3 SDK / WebDAV** | `@aws-sdk/client-s3` + saját WebDAV-kliens | Storage-gateway (távoli tár auth-proxy) | `npm install` + `server/storage.config.json` |
| **`zip`** | rendszer-CLI | Collect Project (`.vided.zip`) | előre telepített macOS/Linux alatt |
| **Anthropic API** *(opcionális)* | `@anthropic-ai/sdk` (felhő) | ugyanazok az AI-funkciók, ha van `ANTHROPIC_API_KEY` | env-változó |

> **Platform-megkötés.** A Chromium-kereső ([text-render.js](server/text-render.js#L21-L42))
> jelenleg a `~/Library/Caches/ms-playwright/.../chrome-headless-shell-mac-arm64`
> útra van drótozva, az ONNX-munkamenetek pedig `executionProviders: ['cpu']`-vel
> futnak. Ez a worker **macOS / Apple Silicon dev-gépre** van hangolva
> (a `CHROMIUM_PATH` env felülírja az elérési utat).

---

## 5. AI-provider kettősség (felhő vs. lokális)

Az AI-funkciók egyetlen absztrakción mennek át
([ai.js `runStructured`](server/ai.js#L194-L207)), amely a következő sorrendben
választ szolgáltatót:

1. **Anthropic (felhő)** — ha van `ANTHROPIC_API_KEY`. Modell:
   `claude-opus-4-8` (env: `AI_MODEL`), strukturált kimenettel (Zod-séma).
2. **Lokális Ollama** — kulcs nélkül ez fut, ha elérhető
   (`http://127.0.0.1:11434`). Modell: `qwen3:14b` (env: `LOCAL_AI_MODEL`),
   Ollama structured outputs-szal.
3. **Egyik sem** → a `/health` `ai:false`-t ad, a UI elrejti az AI-t.

**Biztonsági kulcselv:** az AI **sosem írja közvetlenül a projektet.** Egy
szigorú, whitelistelt parancs-sémát (`UPDATE_CLIP`, `SPLIT_CLIP`,
`ADD_TEXT_CLIPS`, `SET_ASPECT`, …) ad vissza, amelyet a kliens validál, és a
Command Buson, visszavonhatóan (undo) hajt végre.

**Adatvédelmi következmény:** lokális Ollamával a projekt-kontextus és a
képkockák **nem hagyják el a gépet**. Anthropic-kulccsal a szöveges kontextus
(és a vision-index esetén képkockák) a felhőbe kerülnek — ezt a szolgáltató-
választás dönti el, nem a kliens.

---

## 6. Végpont-katalógus

A `service`-oszlop mutatja, mi hajtja; a „on-device?" oszlop azt jelzi,
**reálisan** áttehető-e a számítás a készülékre (részletek a
[9. szakaszban](#9-on-device-megvalósíthatóság-mit-lehetne-áttenni-a-készülékre)).

### Média-feldolgozás (FFmpeg)

| Végpont | Feladat | Hajtó | On-device? |
|---|---|---|---|
| `POST /render` → `GET /render/:id[/file]` | teljes projekt → MP4 (konkatenáció, sebesség, szűrők, fade, hangkeverés, beégetett feliratok) | FFmpeg + Chromium | nehéz |
| `POST /proxy` | 720p munka-példány nagy videóból (≤1280 px → `{skip}`) | FFmpeg | nehéz |
| `POST /waveform` | mono 8 kHz PCM → csúcslista az idővonalhoz | FFmpeg | közepes |
| `POST /scenes` | jelenetváltás-időpontok (scene-score) | FFmpeg | közepes |
| `POST /silence` | csend-intervallumok (silencedetect) | FFmpeg | közepes |
| `POST /beats` | BPM + beat/downbeat-rács + energia (függőség nélküli DSP) | FFmpeg + JS | reális |
| `POST /voice/preview` | beszéd-javító lánc előnézete (m4a) | FFmpeg | közepes |
| `POST /collect` | projekt + minden média egy zip-be | FFmpeg-nincs; `zip` | nehéz |

### Számítógépes látás / ML (ONNX Runtime, CPU)

| Végpont | Feladat | Modell | On-device? |
|---|---|---|---|
| `POST /depth/parallax` | 2.5D fotó→3D parallax-rétegek (fg/mid/bg) | `depth-anything-v2-small.onnx` | reális (ONNX-RN) |
| `POST /depth/focus` | portré-blur / rack-focus változatok | ugyanaz + FFmpeg | reális (ONNX-RN) |
| `POST /bgremove` | háttér-eltávolítás (téma-kivágás alfával) | `u2net.onnx` | reális (ONNX-RN) |
| `POST /faces` | arc-detektálás egy képkockán | `ultraface-rfb-320.onnx` | reális (ONNX-RN) |
| `POST /shotscore` | best-shot vizuális pontozás (Auto Edit) | FFmpeg + heurisztika | reális |
| `POST /upscale` | szuper-felbontás (2×/4×) | `superres.onnx` | reális (ONNX-RN) |
| `POST /track` | pont-követés (NCC template-tracker) | FFmpeg + JS | reális |
| `POST /reframe` | téma-középpont útja (mozgás-centroid) | FFmpeg + JS | reális |

### Beszéd (whisper.cpp)

| Végpont | Feladat | Hajtó | On-device? |
|---|---|---|---|
| `POST /captions` | média → hang → időzített SRT (nyelv-autodetekt) | `whisper-cli` + `ggml-base.bin` | reális (whisper.rn) |

### Nagy nyelvi / multimodális modellek (Ollama vagy Anthropic)

| Végpont | Feladat | On-device? |
|---|---|---|
| `POST /ai/assist` | utasítás → validált parancslista | korlátozottan |
| `POST /ai/autoedit` | jelek → 3 vágás-változat | korlátozottan |
| `POST /ai/captionstudio` | kiemelt szavak + emoji a feliratokhoz | korlátozottan |
| `POST /ai/hooks` | téma → 6 nyitómondat | korlátozottan |
| `POST /ai/thumbheadlines` | téma → 3 borító-cím | korlátozottan |
| `POST /vision/index` | keyframe-ek vision-címkézése (Smart Search) | nehéz |
| `POST /vision/query` | lekérdezés + dokumentumok → hasonlóság (embedding) | korlátozottan |

### Rasterizálás (headless Chromium)

| Végpont | Feladat | On-device? |
|---|---|---|
| `POST /imagedoc` | réteg-fa (JSON) → PNG (a videóval pixelre egyező formák/feliratok) | Skia-val reális |
| `POST /thumbnails` + `/thumbnails/compose` | borító-kockák kiválasztása + headline ráégetése | Skia-val reális |
| `GET /stickers3d` + `/stickers3d/:id.png` | CC0 glTF modellek → PNG (three.js WebGL) | nehéz |
| `POST /sky` + `GET /sky/presets` | égbolt-csere (mélység-alapú maszk) | reális (ONNX+FFmpeg) |

### Tartalom-kiszolgálás és tár (nincs nehéz számítás)

| Végpont | Feladat |
|---|---|
| `GET /library`, `/library/:id/file` | szerver-médiatár (`server/library`) |
| `GET /music`, `/music/:id/file` | hang-könyvtár (generált SFX + `server/music`) |
| `GET /storage/sources`, `/storage/:id/list`, `/probe`, `/file` | Storage-gateway: WebDAV/NAS + S3 auth-proxyval (a hitelesítés a workeren marad) |
| `GET /depth/:id/:name`, `/bgremove/:id/:name` | cache-elt ML-műtermékek kiszolgálása |

---

## 7. Job-modell a hosszú műveletekhez

A render, a proxy és a collect **aszinkron**:

1. `POST /render` (stb.) → azonnal `{ id }`, a munka a háttérben indul.
2. A szerver egy in-memory `Map`-ben tartja az állapotot:
   `{ state: 'processing' | 'done' | 'error', progress, file, dir }`.
3. A kliens `GET /render/:id`-vel pollozik (2 mp, max ~10 perc), és a render a
   valós FFmpeg-előrehaladást adja (`progress` 0–1).
4. Kész állapotban `GET /render/:id/file` adja a bináris eredményt.

**Következmény:** a job-tábla memóriában él → **szerver-újraindítás elveszti a
folyamatban lévő jobokat.** A tartós műtermékek (depth-, bgremove-cache, SFX)
viszont lemezen maradnak (`server/assets/…`, md5-kulccsal), és
worker-újraindítás után is érvényesek.

---

## 8. Adatáramlás, cache és tisztítás

- **Feltöltés.** A média multipart-ként megy fel (`multer`, `diskStorage`,
  kérésenként külön `os.tmpdir()/vided-render-*` munkakönyvtár, max 2 GB/fájl).
- **URI-átírás.** A projekt-JSON klip-`uri`-jait a szerver a feltöltött
  fájlokra mappeli az `uriMap` alapján — a kliens sosem küld helyi
  eszköz-útvonalat, amit a szerver ne kapott volna meg fájlként.
- **Tisztítás.** A gyors végpontok a válasz után törlik a munkakönyvtárat
  (`fs.rm(workDir, …)`). A cache-elhető ML-kimenetek (depth, bgremove, sky,
  upscale, 3D-matrica) tartalom-hash (md5) szerint **megmaradnak**
  `server/assets/…` alatt, így ugyanarra a bemenetre nem számol újra.
- **Kliens-oldali cache.** A proxy (`Documents/proxies`), a hullámforma és a
  thumbnail fájlnév+méret kulccsal az eszközön cache-elődik — egy forrás csak
  egyszer megy fel.

---

## 9. On-device megvalósíthatóság — mit lehetne áttenni a készülékre

A worker jelenleg **dev-idejű backend**. Éles üzemre a README a Fázis 1
backendet jelöli ki (Node/NestJS + PostgreSQL + S3/CDN). Ettől függetlenül
érdemes végignézni, **melyik réteg mozdítható elvben a készülékre**, és melyik
nem — a kliens draft-modellje már felhő/eszköz-agnosztikus.

**Reálisan on-device (van érett natív út):**

- **ONNX-modellek** (depth, bgremove, arc, upscale): az `onnxruntime-react-native`
  ugyanazokat a `.onnx` fájlokat futtatja mobil GPU/NNAPI/CoreML gyorsítással.
  A jelenlegi kód CPU-provideren fut, tehát az algoritmus hordozható; a
  szűk keresztmetszet a FFmpeg-alapú kép-dekódolás/kompozit kiváltása.
- **Whisper**: a `whisper.rn` (whisper.cpp mobil-kötés) CoreML/Metal-gyorsítással
  on-device ad SRT-t — ez a `/captions` közvetlen megfelelője.
- **Tisztán DSP/heurisztikus végpontok** (beats, track, reframe, shotscore): ezek
  már ma is függőség-mentes JS/DSP + FFmpeg-frame-kinyerés; JS-motorban vagy
  natív képkocka-hozzáféréssel áttehetők.

**Nehéz vagy nem reális ma a készüléken:**

- **FFmpeg-alapú render és transzkód**: mobilon nincs karbantartott, teljes
  értékű FFmpeg-út (a korábbi `ffmpeg-kit` visszavonva). A teljes MP4-render,
  proxy és keverés a legnehezebb tétel — ezt a README is a szerveroldalra és a
  jövőbeli Skia-előnézetre bízza.
- **Headless Chromium-raster** (felirat/forma/3D/thumbnail): mobilon nincs
  headless Chromium. Ezt a `@shopify/react-native-skia` váltaná ki natív
  rajzolással — **ez a README-ben kijelölt irány** a GPU-előnézethez és a
  vászon-kompozithoz. A 3D-matricák (three.js WebGL) ehhez külön natív 3D-út
  kellene (expo-gl / three).
- **Nagy LLM/vision modellek** (`qwen3:14b`, `qwen2.5vl:7b`): egy telefonon
  legfeljebb kisebb kvantált modellek férnek el, korlátozott minőséggel; a
  strukturált-kimenet megbízhatósága kisebb modellnél romlik. Ezek gyakorlatban
  felhő- vagy LAN-worker-oldalon maradnak.

**Összefoglalás.** A CV/ONNX- és a Whisper-réteg reálisan on-device-ra vihető; a
DSP-végpontok is. A **render/transzkód (FFmpeg)** és a **raszterizálás
(Chromium)** az a két pillér, amit ma **nem** lehet a készülékre tenni —
ezekre a szerveroldali worker (dev), majd az éles backend + a tervezett
Skia-réteg a válasz.

---

## 10. Biztonsági megjegyzések (dev vs. éles)

A jelenlegi worker **fejlesztői segéd**, nem éles szolgáltatás — ez több
egyszerűsítéssel jár, amit éles környezetben kezelni kell:

- **Nincs hitelesítés.** Bárki, aki eléri a `8787`-es portot a LAN-on,
  hívhatja a végpontokat és feltölthet fájlt (max 2 GB). A `CORS: *` ezt
  tetézi. Éles: auth + origin-korlát + rate limit.
- **Parancs-injektálás ellen védett.** Minden CLI-hívás `execFile`-lal, tömb-
  argumentumokkal megy (nincs shell-interpoláció), a `:id`/fájlnév-paraméterek
  regex-validáltak (`/^[a-f0-9]{32}$/`, kiterjesztés-whitelist). A numerikus
  body-mezők clamp-eltek.
- **A Storage-gateway hitelesítés-adatai a szerveren maradnak.** A WebDAV/S3
  kulcsok a `server/storage.config.json`-ban vannak, a kliens csak az
  auth-proxyn keresztül streamel — sosem látja a credentialt. (Ez a fájl
  git-ből kihagyandó.)
- **Erőforrás-korlátok.** Timeout minden hosszú műveleten (render 10 perc,
  whisper 15 perc), de nincs párhuzamos-job-limit — több egyidejű render
  túlterhelheti a gépet (különösen az Ollama, amiért a `/health` a próbákat
  szándékosan párhuzamosan futtatja).

---

## 11. Indítás (emlékeztető)

```bash
cd server
npm install
npm start          # http://localhost:8787  → "vided render worker"

# opcionális képességek:
brew install ffmpeg whisper-cpp
curl -L -o models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
npx playwright install chromium
ollama serve && ollama pull qwen3:14b qwen2.5vl:7b nomic-embed-text
# felhős AI helyette:  export ANTHROPIC_API_KEY=...
```

A `GET /health` bármikor megmutatja, mely képességek élnek. Ha a worker nem
fut, az app minden alapfunkciója működik tovább — csak a fenti fejlett
funkciók tűnnek el a felületről.
