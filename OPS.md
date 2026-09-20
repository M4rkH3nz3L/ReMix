# OPS — üzemeltetés a leggazdaságosabban

Hogyan lehet a ReMixet a lehető legolcsóbban üzemben tartani: **mi kell hozzá,
és mi mennyibe kerül.** A kapuzás elve (lásd [STUDIO.md](STUDIO.md)) egyben a
költség-modell is:

> **Amit a készülék maga elvégez, az ingyen van — nálad NULLA infra-költséggel.
> Pénzbe csak a `where: 'cloud'` funkciók kerülnek: worker + AI + cloud-tárhely.**

Vagyis a felhasználók zöme (kézi vágás + eszközön futó MP4-export) **nulla
szerver-költséggel** használja az appot. A fizetős felhő-réteg költsége pontosan
egybeesik azzal, amit a Pro-előfizetés (RevenueCat → Supabase) finanszíroz — a
cél, hogy a Pro-bevétel fedezze a workert/AI-t/tárhelyet.

Az árak **irányárak (2025–2026)**, USD/EUR-ban; a szolgáltatók változtatnak
rajtuk, indulás előtt ellenőrizd.

---

## 1. Mit kell egyáltalán üzemeltetni?

| # | Komponens | Mire kell | Nélküle mi megy |
|---|---|---|---|
| A | **App-terjesztés** (Apple/Google/EAS) | hogy telepíthető legyen | — (ez kötelező) |
| B | **Supabase** (Auth + Postgres + Realtime + Storage) | login, social feed, értesítés, kollab, shop, cloud-mentés | a teljes **on-device szerkesztő + export** így is megy |
| C | **Worker** (`server/`, Node+FFmpeg) | felhő-HD/4K render, auto-felirat, AI-vágás, kép-AI, URL-import fallback | minden SIMA funkció megy; a Pro-funkciók `ProRequiredError`-t adnak |
| D | **Redis** (queue) | a worker render-sorát hajtja | worker in-process renderel (kis terhelésre elég) |
| E | **S3-tárhely** (renderek/média) | cross-device lejátszás, felhő-render kimenet | csak lokális render + eszköz-tárhely |
| F | **Claude API** *vagy* Ollama/BYOK | AI-vágás/elemzés/kép-AI szöveges „agya" | AI-funkciók kiesnek (a többi Pro megy) |
| G | **RevenueCat** | a Pro-előfizetés valós pénz-útja (IAP) | nincs bevétel; manuális `/billing/activate` dev-út létezik |
| H | **Expo Push** | értesítések a háttérben | in-app realtime értesítés akkor is megy |

**Fontos:** a nehéz AI **nem** drága per-hívásos felhő-API. A worker
**nyílt forrású, helyben futó modelleket** használ (mind ingyenes):

- **whisper.cpp** (`ggml-base.bin`) → auto-felirat (`index.js`)
- **ONNX** modellek: `u2net` (háttér), `depth-anything-v2-small` (mélység),
  `ultraface` (arc), upscale/vision (`bgremove.js`, `depth.js`, `face.js`,
  `upscale.js`, `vision.js`)
- **FFmpeg** → render, szín, beat-elemzés
- **Playwright** (fej nélküli Chromium) → szöveg-render, thumbnail
- **three.js** → 3D matricák
- **yt-dlp** → URL-import worker-fallback

Az egyetlen metered külső AI a **Claude** (`ai.js`, alap `AI_MODEL=claude-opus-4-8`)
— és az is kiváltható **helyi Ollamával** vagy **BYOK-kal** (a `user_ai_providers`
/ `user_ai_task_providers` táblák szerint a Pro-user a **saját** kulcsával fizet →
neked $0 AI-költség).

---

## 2. Egyszeri és fix (forgalomtól független) költségek

| Tétel | Költség | Megjegyzés |
|---|---|---|
| Apple Developer Program | **$99 / év** | iOS-terjesztéshez kötelező |
| Google Play Developer | **$25 egyszeri** | Androidhoz kötelező |
| Domain (worker URL, pl. `render.remix.app`) | **~$10–12 / év** | TLS a Cloudflare/Caddy-val ingyen |
| Modellek letöltése (whisper + ONNX) | **$0**, ~2–3 GB egyszeri | HuggingFace-ről; a `server/models/` most üres |
| **EAS Build** | **$0** ha lokálisan buildelsz | lásd lentebb |

**EAS Build a leggazdaságosabban:** ne fizess $99/hó EAS Productiont indulásnál.
- **Legolcsóbb:** lokális build — `npx expo run:ios` / `run:android`, vagy
  `eas build --local`. iOS-hez kell egy **Mac** (van), Androidhoz Android Studio.
  Költség **$0**.
- **Kényelmi:** EAS Free tier (havi pár build, alacsony prioritás) — kezdésre elég.

---

## 3. Három üzemeltetési szint (a legolcsóbbtól felfelé)

### 🟢 0. szint — csak app + social/auth (nincs worker)
A teljes ingyenes szerkesztő + login + feed + értesítés. Ez már **eladható termék**.

| Tétel | Havi |
|---|---|
| Supabase **Free** (500 MB DB, 1 GB tárhely, 5 GB egress, 50k MAU) | **$0** |
| Expo Push | **$0** |
| Worker / Redis / S3 / AI | — (nincs) |
| **Összesen** | **~$0/hó** + a fix éves díjak |

**Töréspont:** ~50k havi aktív user vagy 1 GB fölötti média/DB → Supabase Pro.

---

### 🟡 1. szint — bootstrap: MINDEN Pro-funkció, EGY VPS (ajánlott indulás)

Egy olcsó VPS futtatja a workert + Redist + a helyi modelleket; a tárhely
Cloudflare R2 (zero egress!); az AI BYOK vagy olcsó modell.

| Tétel | Havi (irányár) | Miért ez |
|---|---|---|
| **VPS** — Hetzner CPX41 (8 vCPU / 16 GB) | **~€28 (~$30)** | Hetzner a legjobb ár/érték; FFmpeg+ONNX+whisper CPU-n elmegy |
| **Redis** — ugyanazon a VPS-en (Docker) | **$0** | vagy Upstash free tier |
| **S3** — Cloudflare **R2** (10 GB ingyen, **egress $0**) | **$0–5** | a videó-egress másutt a gyilkos; R2-nél nincs |
| **Supabase** Free → Pro amikor kell | **$0–25** | Pro: 8 GB DB, 100 GB tárhely, 250 GB egress |
| **AI** — BYOK (user fizet) *vagy* Claude Haiku | **$0–30** | BYOK = $0; saját kulccsal Haiku a legolcsóbb |
| **RevenueCat** (< $2.500 követett bevétel) | **$0** | utána 1% |
| **Expo Push** | **$0** | |
| **Összesen** | **~$30–90/hó** | a teljes funkció-készlet él |

**Ez a „leggazdaságosabb, mindent tud" pont: kb. $30–90/hó + a fix éves díjak.**

---

### 🔴 2. szint — skálázás (több ezer aktív user, sok felhő-render)

Amikor egy VPS kevés: külön render-workerek, igény szerinti GPU, managed szolgáltatások.

| Tétel | Havi (irányár) |
|---|---|
| **Render** — nagyobb VPS vagy 2–3 worker (`render-worker.js` több példány) | **€60–200** |
| **GPU** — csak ha kell (4K/upscale/depth gyorsítás): **on-demand** (RunPod/Vast.ai ~$0,2–0,5/óra), nem 24/7 | **$20–150** |
| **Supabase Pro** + kiegészítők | **$25–100** |
| **R2 tárhely** 100 GB–1 TB (egress $0) | **$2–15** |
| **Managed Redis** (Upstash / DO) | **$0–15** |
| **Claude API** (ha nem BYOK) | **$50–500** (forgalom-függő) |
| **RevenueCat** | **1% MTR** |
| **Összesen** | **~$150–800/hó** |

---

## 4. Konkrét költség-optimalizáló fogások (ezek adják a „gazdaságos"-t)

1. **BYOK az AI-ra** — a Pro-user a saját Claude/OpenAI/Ollama kulcsával fut
   (`user_ai_providers`). Ez **nullázza** a te AI-számládat, ami messze a
   legnagyobb változó költség lehet.
2. **Cloudflare R2 tárhely** — a videó-**egress** (letöltés) a legdrágább tétel
   AWS S3-on ($0,09/GB). R2-nél az egress **$0** → videós appnál sok tízezer forint
   különbség havonta.
3. **Hibrid render** — a rövid videók (`CLOUD_RENDER_MIN_SEC` alatt, alap 15 mp)
   **az eszközön** renderelnek ingyen; csak a hosszúak mennek a felhőbe. A
   küszöböt felnyomva kevesebb felhő-render → kevesebb CPU/GPU-idő.
4. **Olcsóbb alap-modell** — az `AI_MODEL` alapja `claude-opus-4-8` (a legdrágább).
   A strukturált vágás-döntésekhez **Haiku 4.5** vagy Sonnet bőven elég, töredék áron.
5. **Ollama a VPS-en** — ha van szabad RAM/CPU, a szöveges AI futhat helyben
   (`OLLAMA_URL`), külső API nélkül → $0 per-token.
6. **GPU csak igény szerint** — ne tarts 24/7 GPU-t. A queue (BullMQ) miatt a
   render-worker felskálázható munka esetén (spot GPU), üresjáratban leállítható.
7. **Redis a workeren** — kis forgalomnál nem kell managed Redis; Docker-konténer
   ugyanazon a gépen elég.
8. **Hetzner > DigitalOcean/AWS** — azonos CPU/RAM 2–3× olcsóbb; a worker
   CPU-kötött (FFmpeg), nem kell drága felhő.
9. **Supabase Free ameddig lehet** — a free tier valós usereket kiszolgál; csak
   a limit (DB/tárhely/egress/MAU) átlépésekor válts Prora.

---

## 5. „Mennyibe kerül?" — rövid válasz

| Fázis | Havi | Egyszeri/éves |
|---|---|---|
| **MVP** (on-device app + social, worker nélkül) | **~$0** | $99/év Apple + $25 Google |
| **Bootstrap** (minden Pro-funkció, 1 VPS, BYOK-AI) | **~$30–90** | ugyanaz |
| **Skálázás** (több ezer user, sok render) | **~$150–800** | ugyanaz |

**Ajánlott legolcsóbb „mindent tud" stack:**
Hetzner CPX41 VPS (worker + Redis Dockerben + helyi whisper/ONNX/FFmpeg) **+**
Cloudflare R2 (zero egress) **+** Supabase Free/Pro **+** BYOK-AI **+** RevenueCat
**+** lokális EAS build. → **~$30–90/hó**, plusz $99/év Apple + $25 Google.

---

## 6. Worker-gép rendszerfüggőségei (a VPS-re telepítendő)

A `server/` futtatásához a gépen kell (nem npm-csomag):

- **FFmpeg** + **ffprobe** (`FFMPEG_PATH`) — render, szín, beat, TTS-konverzió
- **whisper.cpp** `whisper-cli` + `ggml-base.bin` modell (`WHISPER_MODEL`) — felirat
- **ONNX modellek** a `server/models/`-be (u2net, depth-anything-v2-small,
  ultraface, upscale, vision) — a `LOCAL_*_MODEL` env-ek mutatnak rájuk
- **Chromium** a Playwrighthoz (`CHROMIUM_PATH`) — szöveg-render, thumbnail
- **yt-dlp** (`YTDLP_BIN`) — URL-import fallback
- **Redis** — a queue-hoz (`REDIS_URL`)
- **TTS**: dev-ben macOS `say`; Linux-prod workeren cloud-TTS-re cserélendő
  (`tts.js`) — jelenleg csak macOS-en érhető el

Indítás (az API és a worker külön processz, több worker = skálázás):

```bash
export $(grep -v '^#' server/.env | xargs)
cd server && node index.js           # API (port 8787)
cd server && node render-worker.js   # render-worker (több példány = több párhuzam)
```

A `GET /health` visszaadja, mely képességek élnek (`captions`, `ai`, `vision`,
`bgremove`, `render: cloud+local | local` stb.) — ez a diagnosztika első lépése.

Kliens-oldalról a `EXPO_PUBLIC_CLOUD_URL` mutat a hosztolt workerre (prod);
üresen dev-ben a `EXPO_PUBLIC_SERVER_HOST`-ra esik vissza.

---

## 7. Skálázási töréspontok (mikor drágul)

- **Supabase Free → Pro:** ~50k MAU, vagy 1 GB tárhely / 500 MB DB / 5 GB egress felett.
- **1 VPS → több worker/GPU:** ha a render-queue tartósan torlódik, vagy a 4K/
  upscale/depth CPU-n túl lassú. Előbb a `RENDER_CONCURRENCY`-t és a
  `CLOUD_RENDER_MIN_SEC`-et hangold, csak utána vegyél GPU-t (on-demand!).
- **BYOK → saját AI-számla:** ha marketing-okból „kulcs nélküli" AI-t kínálsz,
  a Claude-költség a legmeredekebb tétel — előbb olcsó modell, majd Ollama.
- **RevenueCat 1%:** $2.500 havi követett bevétel felett — de ez már „jó gond".

---

*A hiteles forrás mindig a kód: [`src/lib/capabilities.ts`](src/lib/capabilities.ts)
(mi local/cloud + Pro), [`server/.env.example`](server/.env.example) és
[`.env.example`](.env.example) (a szükséges kulcsok/címek), valamint a
[`server/`](server/) modul-fájljai (mely funkció mit hív).*
