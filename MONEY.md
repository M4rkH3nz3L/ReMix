# MONEY — előfizetési üzleti terv (Free · Basic · Pro · Ultra)

Ez a dokumentum a ReMix **monetizációs csomag-struktúráját** tervezi meg a
**kód valós képességei** ([`src/lib/capabilities.ts`](src/lib/capabilities.ts),
[`src/lib/render.ts`](src/lib/render.ts), [`src/lib/aiProviders.ts`](src/lib/aiProviders.ts))
és a **konkurens-piac** (CapCut, InShot, KineMaster, Descript, Veed, Runway, LumaFusion)
alapján. Nem érint kódot — **terv**, ami megmondja, *melyik funkció melyik csomagba* kerül.

A hiteles funkció-forrás a [STUDIO.md](STUDIO.md) (SIMA vs PRO leltár) és a
[capabilities.ts](src/lib/capabilities.ts); a költség-modell az [OPS.md](OPS.md).

---

## 0. A kód mai valósága (őszinte kiindulópont)

Amit ki kell mondani, mielőtt csomagokról beszélünk:

- A kliens ma **kétállapotú**: `Tier = 'free' | 'pro'` ([`entitlementStore.ts:21`](src/store/entitlementStore.ts#L21)),
  és a `subscriptions` tábla is ezt tükrözi ([`subscription.ts`](src/lib/subscription.ts)).
- A kapu **bináris és boolean-alapú**: minden képesség vagy `pro: true`, vagy nem
  ([`capabilities.ts`](src/lib/capabilities.ts)); a `ensureCloud(cap)` csak azt nézi,
  Pro-e a user ([`backend.ts:104`](src/lib/backend.ts#L104)). **Nincs kvóta, nincs
  felhasználás-mérés, nincs felbontás-plafon szint szerint, és nincs kényszer-vízjel** sehol.
- Az AI **BYOK-képes**: a user saját OpenAI/Anthropic/Ollama/custom kulcsot köthet be
  feladatonként ([`aiProviders.ts`](src/lib/aiProviders.ts)) → ilyenkor **nekünk $0 az AI-költség**.
- A **Shop** külön, kredit-alapú piactér (Facebook-Stars-modell, 30% jutalék,
  [`shop.ts`](src/lib/shop.ts)) — ez **nem** előfizetés, hanem párhuzamos bevétel.

**Következmény:** a Basic/Ultra ma nem létezik a kódban. Ez a terv üzletileg definiálja
őket; a §8 felsorolja, mit kell hozzá bővíteni (röviden, kód nélkül).

---

## 1. A kapuzás alapelve — a monetizáció gerince

> **Amit a készülék maga elvégez (worker/AI/cloud-tárhely nélkül), az MINDIG ingyen.
> Pénzt csak a `where: 'cloud'` funkciók érnek — worker + AI + cloud-tárhely.**
> ([free-vs-pro szabály](STUDIO.md), típus-szinten kikényszerítve.)

> ⚠️ **FINOMÍTÁS (2026-09-18) — HIBRID az adatvesztés ellen:** a `cloudSync`
> (projekt-TERV JSON DB-mentése, média NÉLKÜL) és a `collab` (kollaboráció/meghívás)
> capability mostantól **INGYENES** (`pro:false` a `capabilities.ts`-ben) — hogy a
> projektek SOHA ne vesszenek el (userhez kötve), és bárki megoszthasson. A Pro-érték
> a NEHÉZ felhő marad: **média-felhősync (GB) + HD/felhő-render + AI**. A lenti
> Basic/Pro táblák „Projekt felhő-mentés / Cloud-tárhely / Kollaboráció" sorai
> ENNEK MEGFELELŐEN frissítendők (a média-tárhely-GB marad a fizetős tétel).

Ez egyben a **költség-térkép** ([OPS.md](OPS.md)):

| Amit a felhő csinál | Nekünk mibe kerül | Emel-e árat? |
|---|---|---|
| whisper.cpp (felirat), yt-dlp (import), TTS | ~$0 futásidő (helyi modell, CPU) | olcsó → **Basic** belefér |
| FFmpeg render (H.264/HEVC) | CPU-idő a VPS-en | közepes → **Basic/Pro** |
| ONNX kép-AI (bgRemove/depth/upscale/face) | GPU/CPU-idő, nehéz | drága → **Pro+** |
| LLM szöveges AI (autoEdit/story/pacing/quality/assistant) | **Claude API = a legdrágább** | **Pro+**, vagy **BYOK → $0 (Ultra)** |
| Cloud-tárhely + egress | GB + letöltés (R2-vel egress $0) | tárhely-plafon szintenként |

A csomag-logika ezt a költség-görbét követi: **olcsó felhő → Basic**, **AI + pro-render →
Pro**, **korlátlan/BYOK + prioritás + max tárhely → Ultra**.

---

## 2. Konkurens-térkép (2025–2026 irányárak)

| Termék | Ingyenes | Belépő | Közép | Csúcs | Modell |
|---|---|---|---|---|---|
| **CapCut** | igen (részleges vízjel) | Pro ~$9.99/hó · ~$74.99/év | — | Commerce Pro (üzleti) | asset+AI+felhő |
| **InShot** | reklám + vízjel | Pro $3.99/hó · $14.99/év · $34.99 örök | — | — | vízjel-le + asset |
| **KineMaster** | vízjel | Premium $4.99/hó · $39.99/év | — | — | vízjel-le + asset |
| **Descript** | 1 óra átirat | Hobbyist $16/hó | Creator $24/hó | Business $50/hó | AI-óra + 4K + seat |
| **Veed** | vízjel, 10 perc | Lite ~$12 | Pro ~$24 | Business ~$59 | export-perc + AI-kredit + seat |
| **Runway** | ingyen-kredit | Standard $15 | Pro $35 | Unlimited $95 | **AI-kredit / korlátlan** |
| **Adobe Premiere Rush** | — | $9.99/hó | CC-teljes $20.99/hó | — | asset + felhő |
| **LumaFusion** | — | ~$30 egyszeri + add-onok | — | — | egyszeri + modul |

**Tanulságok a piacról:**
1. A belépő tier ára a **$4–5/hó** sáv (InShot/KineMaster) — vízjel-le + kényelem.
2. A "prosumer" flagship a **$10–24/hó** sáv (CapCut/Descript/Veed Pro) — AI + 4K.
3. A csúcs a **$30–95/hó** sáv (Runway Unlimited, Descript Business) — **korlátlan AI + seat + prioritás**.
4. Aki AI-t ad, az **kreditben vagy órában méri**, és a csúcson **"unlimited"**-et ígér.
5. **Senki nem kínál BYOK-korlátlan AI-t mobilon** — ez a mi egyedi fegyverünk (a kód már tudja).

---

## 3. A megkülönböztető tengelyek (mind a kódból)

A csomagokat ezekkel a — kód által ténylegesen kínált — emelőkkel bontjuk:

| Tengely | Kód-forrás | Hogyan szintez |
|---|---|---|
| **Render-minőség** | [`render.ts:111-158`](src/lib/render.ts#L111-L158): eszköz = H.264/8-bit/Rec.709/≤4K; felhő = HEVC/AV1/ProRes, 10-bit, HDR/Rec.2020, 8K | Free ≤4K H.264 → Basic felhő-offload HEVC → Pro pro-kodek+HDR → Ultra 8K/ProRes/batch |
| **AI-réteg (LLM)** | `autoEdit`, `storyAnalyze`, `pacingAnalyze`, `qualityScan`, `reframe` (capabilities.ts) | Pro-tól; Ultra = korlátlan/BYOK |
| **Kép-AI (ONNX)** | `bgRemove`, `skyReplace`, `depth3d`, `faceTools`, `colorAi`, `upscale`, `objectTrack` | Pro-tól; Ultra = prioritás-GPU + magasabb plafon |
| **Felirat/beszéd/import** | `autoCaption`, `tts`, `urlImport` | olcsó → már **Basic** (kvótával) |
| **Cloud-tárhely** | `cloudSync` (Supabase Storage) | GB-plafon szintenként |
| **Kollaboráció** | `collab` (seat-ek + szerepkör) | Pro (kis csapat) → Ultra (nagyobb csapat) |
| **BYOK-AI** | [`aiProviders.ts`](src/lib/aiProviders.ts) `user_ai_providers` | Ultra: korlátlan AI a saját kulcson (nekünk $0) |
| **Queue-prioritás** | BullMQ render-queue ([OPS.md](OPS.md)) | Basic normál → Pro prioritás → Ultra top + on-demand GPU |

**Fontos render-nüansz:** az eszköz **már ingyen renderel 4K H.264-et**. A fizetős render
értéke tehát **nem a pixelszám**, hanem: (a) **offload** (nem terheli a telefont, gyorsabb,
háttérben), (b) **pro-kodek** (HEVC/AV1/ProRes), (c) **10-bit/HDR/Rec.2020**, (d) **8K/master**.

---

## 4. A csomagok

### 🟢 FREE — „Creator" · **$0**
**Kinek:** mindenki; ez a felhasználó-szerző motor és a fő megkülönböztető.
**Pitch:** *„A teljes profi kézi vágó ingyen, örökre — vízjel nélkül."*

Tartalom (minden **eszközön**, korlátlan):
- A **teljes SIMA szerkesztő** (STUDIO.md): többsávos idővonal, profi trim-módok
  (ripple/roll/slip/slide), J/K/L, kulcskocka + Graph Editor + Bézier, maszk/rotoszkóp,
  teljes blend-készlet + green screen + luma/alpha matte + compound/pre-compose,
  pro-audio effektek, beat-vágás, profi színfényelés (curves/HSL/3-way/szkópok/LUT),
  vektor-toll/boolean/path-animáció, kinetic typography, multicam, verziók.
- **Lokális MP4 export** ≤ 4K, H.264, 8-bit (`localRender`).
- **Hang-könyvtár** (`soundLibrary`) + ingyenes worker-mérőeszközök (szkópok, LUT-export,
  beat/hullámforma, Szöveg→Forma bake).
- **URL-import** local-first (`urlImport` eszközön futó ága).
- **Social feed**, közzététel (eszközön renderelt videóból), Shop **böngészés**, login.

Nincs: felhő-render offload, AI-réteg, kép-AI, cloud-tárhely, kollab.
**Vízjel: NINCS** (döntési pont — lásd §9; ajánlás: maradjon a differenciátor tiszta).

---

### 🔵 BASIC — „Plus" · **$4.99/hó · $34.99/év** (~$2.9/hó)
**Kinek:** hobbi-alkotó, aki felhő-kényelmet és könnyű AI-t akar, olcsón (InShot/KineMaster sáv).
**Pitch:** *„Felirat egy koppintásra, felhő-mentés, gyors felhő-export — filléres áron."*

Free minden + a **következő OLCSÓ felhő-funkciók, kvótával**:

| Funkció | Capability | Basic-kvóta |
|---|---|---|
| Automatikus felirat (Whisper) | `autoCaption` | **120 perc/hó** felismerés |
| Szöveg → beszéd | `tts` | alap hangkészlet, **30 perc/hó** |
| Import linkből (worker-fallback) | `urlImport` | **20 import/hó** |
| Felhő-render **offload** ≤4K, H.264/HEVC | `cloudRender` | **60 perc kimenet/hó**, normál queue |
| Projekt felhő-mentés | `cloudSync` | **5 GB** tárhely |
| AI-kóstoló kredit | (managed) | **kis havi AI-kredit** (upsell Pro-ra) |

Nincs: nehéz kép-AI (bgRemove/upscale/depth/face/sky), teljes AI-vágás-réteg,
pro-kodek/HDR/8K, kollab.
**Miért profitábilis:** minden Basic-funkció **helyi modellen** fut (whisper/yt-dlp/tts)
vagy CPU-render — **~$0 API-költség**, csak kevés VPS-idő.

---

### 🟣 PRO — „Pro" · **$12.99/hó · $99.99/év** (~$8.3/hó) — a flagship
**Kinek:** komoly alkotó, faceless-csatorna, szabadúszó (CapCut/Descript-Creator sáv).
**Pitch:** *„A teljes AI-stúdió + profi felhő-render — a telefonodon."*

Basic minden (feloldott/megemelt kvótákkal) + **a teljes felhő-arzenál**:

**Render & tárhely**
- **Felhő HD/4K pro-render:** HEVC/AV1/**ProRes**, **10-bit**, **HDR/Rec.2020**, egyedi
  bitráta/GOP (`cloudRender`, a `render.ts` „pro encode" határa) — **prioritásos queue**.
- `cloudSync` **100 GB** + felhő-verziótörténet; `collab` **3 seat** + szerepkörök.

**AI-vágás-réteg (LLM)** — nagy havi AI-kredit-kerettel (managed):
- `autoEdit` (+Shorts/B-roll), `storyAnalyze`, `pacingAnalyze`, `qualityScan`, `reframe`
  (Smart Reframe), természetes-nyelvű **AssistantPanel**, AI-thumbnail/headline, Caption Studio AI.

**Kép-AI (ONNX)**
- `bgRemove`, `skyReplace`, `depth3d`/parallax, `faceTools`, `colorAi` (auto-grade),
  `upscale`, `objectTrack` (NCC — szöveg/kép/forma/maszk/blur követés).

**Felirat/beszéd** korlátlan (fair-use): `autoCaption` + fordítás + kétnyelvű + karaoke;
`tts` teljes hangkészlet. **Kereskedelmi felhasználási licenc.**

---

### 🔴 ULTRA — „Ultra / Studio" · **$29.99/hó · $249.99/év** (~$20.8/hó)
**Kinek:** power-user, ügynökség, stúdió, nagy volumenű faceless-operátor (Runway-Unlimited /
Descript-Business sáv).
**Pitch:** *„Korlátlan AI a saját kulcsoddal, prioritás-GPU, 8K master, csapat."*

Pro minden + a **korlát-feloldás és a prioritás**:

| Előny | Kód-alap | Miért Ultra |
|---|---|---|
| **BYOK korlátlan AI** — köss be saját OpenAI/Anthropic/Ollama kulcsot → **nincs AI-kredit-plafon** | [`aiProviders.ts`](src/lib/aiProviders.ts) (`user_ai_providers`, feladatonként) | a user fizeti az LLM-et → **nekünk $0**, mégis „unlimited" |
| **Managed AI: legmagasabb kredit-keret** (aki nem hoz kulcsot) | LLM-kapu | a kredit-modell csúcs-sávja |
| **Prioritás-GPU render:** leggyorsabb 4K/8K, `upscale`, `depth3d` | on-demand GPU ([OPS.md](OPS.md)) | a legdrágább futásidő → csak itt |
| **8K / ProRes master / batch-export** | `render.ts` 8K + `cloudRender` | archív/mesterminőség |
| `cloudSync` **1 TB** · `collab` **10 seat** | Supabase Storage | csapat/stúdió |
| Kép-AI **legmagasabb plafon** (bgRemove/upscale/face…) fair-use korlátlanig | ONNX-worker | nehéz GPU-terhelés fedezve |
| **Korai hozzáférés** új AI-funkciókhoz + **prioritás support** | — | ügynökségi elvárás |

**Ultra-horog:** a **BYOK-korlátlan AI** olyan, amit a versenytársak (CapCut/Descript/Runway)
**nem adnak** — mobilon egyedülálló, és a mi költségünket nullázza.

---

## 5. Funkció → csomag mátrix (a `capabilities.ts` alapján)

| Capability (kód) | Hol fut | Free | Basic | Pro | Ultra |
|---|---|:---:|:---:|:---:|:---:|
| teljes SIMA kézi szerkesztő | local | ✅ | ✅ | ✅ | ✅ |
| `localRender` (≤4K H.264) | local | ✅ | ✅ | ✅ | ✅ |
| `soundLibrary` + ingyen worker-tools | cloud (ingyen) | ✅ | ✅ | ✅ | ✅ |
| `urlImport` (eszközön) | local | ✅ | ✅ | ✅ | ✅ |
| `urlImport` (worker-fallback) | cloud | — | 20/hó | ✅ | ✅ |
| `autoCaption` (Whisper) | cloud | — | 120 p/hó | korlátlan* | korlátlan* |
| `tts` | cloud | — | 30 p/hó | ✅ | ✅ |
| `cloudRender` offload ≤4K H.264/HEVC | cloud | — | 60 p/hó | ✅ prioritás | ✅ top |
| `cloudRender` pro-kodek (AV1/ProRes/10-bit/HDR) | cloud | — | — | ✅ ≤4K | ✅ **8K/master/batch** |
| `cloudSync` (tárhely) | cloud | — | 5 GB | 100 GB | 1 TB |
| `collab` (seat) | cloud | — | — | 3 | 10 |
| `autoEdit` / `storyAnalyze` / `pacingAnalyze` / `qualityScan` / `reframe` | cloud (LLM) | — | kóstoló-kredit | ✅ nagy keret | ✅ korlátlan/**BYOK** |
| `bgRemove` / `skyReplace` / `depth3d` / `faceTools` / `colorAi` / `upscale` | cloud (ONNX) | — | — | ✅ | ✅ prioritás-GPU |
| `objectTrack` | cloud | — | — | ✅ | ✅ |
| **BYOK saját AI-kulcs** | cloud | — | — | (opció) | ✅ korlátlan |

\* *fair-use / anti-abuse plafonnal.*

---

## 6. Kiegészítő bevétel (előfizetéstől független)

1. **Shop-kreditek** ([`shop.ts`](src/lib/shop.ts)) — sablon/LUT/SFX/font/preset piactér,
   Facebook-Stars-modell: kredit-vásárlás (RevenueCat consumable), **30% platform-jutalék**,
   atomikus `purchase_shop_item` RPC. Bármely szinten működik; a Pro/Ultra eladóknak
   **csökkentett jutalék** adható konverzió-ösztönzőnek.
2. **AI-kredit top-up (overage)** — aki a Basic/Pro kvótát túllépi, **kredit-csomagot** vehet
   full upgrade nélkül (Runway/Descript-minta). Megfogja az alkalmi nagy-igényt, és
   fájdalommentes upsell-lépcső a következő szintre.
3. **Promó/ajándék-kódok** — a `billing/activate` promó-út már létezik ([OPS.md](OPS.md));
   influencer/beta-kód akvizícióhoz.

---

## 7. Árazási logika, próbaidő, éves kedvezmény

- **Éves ≈ 2–4 hónap ingyen** (30–45% kedvezmény) — a piac normája; likviditás + retenció.
- **7 napos ingyenes Pro-próba** (RevenueCat trial) — a flagship-re; Basic-re opcionális 3 nap.
- **Downgrade-védelem:** lejáratkor vissza Free-re, de a **helyi szerkesztő és a lokális
  export végig működik** (a kapuzás elve) → nincs „túszul ejtett projekt", ami a bizalmat építi.
- **EUR-irányár:** Basic ~€4,99 · Pro ~€12,99 · Ultra ~€29,99 (store-régió szerint).
- **Fedezet:** Basic ~$0 API-költségen fut (helyi modellek) → magas marzs; a Pro/Ultra AI-terhét
  a **kredit-keret + BYOK** tartja kordában (OPS.md: BYOK nullázza a legnagyobb változó költséget).

**Pozicionálás egy mondatban:** *a teljes profi vágó ingyen (vízjel nélkül), az AI és a felhő
fizetős — és a csúcson a saját AI-kulcsoddal korlátlan.*

---

## 8. Mit kell a kódban bővíteni (NEM most — csak a lista)

A jelenlegi bináris free/pro → 4 szint. A terv megvalósításához (későbbre):

1. **`Tier` bővítése** `'free' | 'basic' | 'pro' | 'ultra'`-ra
   ([`entitlementStore.ts`](src/store/entitlementStore.ts), [`subscription.ts`](src/lib/subscription.ts),
   a `subscriptions.tier` enum).
2. **Capability-kapu szint-alapúvá tétele:** a boolean `pro` helyett `minTier`
   (vagy tier→capability halmaz) a [`capabilities.ts`](src/lib/capabilities.ts)-ben;
   `ensureCloud` a user szintjét nézze ([`backend.ts`](src/lib/backend.ts)).
3. **Felhasználás-mérés (az egyetlen valóban új backend-rész):** AI-kredit, render-perc,
   tárhely-GB per user + hónap — a worker már user-hiteles (`workerAuth`) és van Supabase.
4. **RevenueCat-leképezés:** 3 termék × (havi/éves), entitlementek `basic`/`pro`/`ultra`;
   a webhook a meglévő `billing.js` úton írja a `subscriptions.tier`-t.
5. **BYOK-kapu Ultrához:** ha van default `user_ai_providers` kulcs → az LLM-kredit-mérő
   megkerülve (korlátlan) ([`aiProviders.ts`](src/lib/aiProviders.ts)).

---

## 9. Nyitott döntési pontok

1. **Vízjel a Free-n?** A konkurensek (CapCut/InShot/KineMaster/Veed) vízjeleznek. A mi
   szabályunk szerint az on-device export ingyen — de a vízjel nem *kapu*, csak *branding*.
   **Ajánlás:** maradjon vízjel nélkül (ez a fő differenciátor „a teljes vágó ingyen"),
   a konverziót az AI/felhő/tárhely hajtsa, ne a kényszer. (Alternatíva: apró, kikapcsolható
   vízjel csak a *social feedbe* posztolt Free-videón.)
2. **AI Basic-ben?** Kap-e Basic „kóstoló" AI-kreditet? **Ajánlás: igen, kicsit** — ez a
   legjobb upsell-lépcső Pro felé.
3. **BYOK már Pro-ban is?** **Ajánlás:** engedd Pro-ban is (opció), de a **korlátlan** csak
   Ultra — így a BYOK is Ultra-húzó marad.
4. **Ultra ára:** $29.99 vs $24.99. A prioritás-GPU + 8K + seat + korlátlan AI indokolja a
   $29.99-et; ha lassú a felvétel, indíts $24.99-cel és emelj.
5. **Lifetime/örökös?** Az InShot-minta ($34.99 lifetime) csábító akvizícióra, de a felhő-költség
   miatt **csak a Free-szintű** extrákra (pl. Shop-kredit-bónusz), sose a felhő-AI-ra.

---

*Hiteles források: [`capabilities.ts`](src/lib/capabilities.ts) (mi local/cloud+pro),
[`render.ts`](src/lib/render.ts) (render-határok), [`aiProviders.ts`](src/lib/aiProviders.ts)
(BYOK), [`shop.ts`](src/lib/shop.ts) (kredit-piac), [STUDIO.md](STUDIO.md) (funkció-leltár),
[OPS.md](OPS.md) (költség-modell).*
