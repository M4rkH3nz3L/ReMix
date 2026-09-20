# DEVOPS — mi kell ahhoz, hogy a Free/Basic/Pro/Ultra ténylegesen működjön

Ez a dokumentum a [MONEY.md](MONEY.md) csomag-tervhez tartozó **infrastruktúra- és
DevOps-leltár**: milyen szerverek, szolgáltatások, eszközök, pipeline-ok kellenek,
hogy a négy szint a felhasználóknál valóságosan menjen. Ott, ahol lehet, a **kód valós
állapotára** hivatkozik ( ✅ = már megvan a repóban, 🔧 = provisionálni/beállítani kell,
🆕 = a metered 4-szinthez ÚJ, meg kell építeni). A **költségek** részletesen az
[OPS.md](OPS.md)-ben; ez a *tooling/üzemeltetés* nézet.

---

## 0. Vezérelv — mit kell egyáltalán üzemeltetni

A kapuzás elve ([STUDIO.md](STUDIO.md)) egyben az infra-térkép: **a Free teljes egészében
az eszközön fut → nulla szerver.** Szervert CSAK a `where: 'cloud'` funkciók kérnek.
Vagyis a felhasználók zöme **0 infra-terheléssel** használja az appot; a Basic/Pro/Ultra
tölti a felhőt, és épp az fedezi.

```
                                   ┌─────────────────────────────────────────┐
   📱 App (Expo/EAS)  ── HTTPS ──▶ │  Reverse proxy (Caddy/Cloudflare, TLS)   │
   RevenueCat IAP                  │            │                             │
        │                         ▼            ▼                             │
        │                   ┌───────────┐  ┌──────────────┐                  │
        │                   │ Worker API│  │ render-worker │  (n példány)     │
        │                   │ index.js  │  │ + AI + ONNX   │                  │
        │                   └─────┬─────┘  └──────┬────────┘                  │
        │                         │ BullMQ        │                          │
        │                         ▼               ▼                          │
        │                   ┌──────────┐   ┌──────────────┐  ┌────────────┐  │
        │                   │  Redis   │   │  GPU (Ultra,  │  │ S3 / R2    │  │
        │                   │ (queue)  │   │  on-demand)   │  │ (media+out)│  │
        │                   └──────────┘   └──────────────┘  └────────────┘  │
        │                                                                    │
        ▼                                                                    │
   ┌──────────────────────────────────────────────────────────────────────┐ │
   │ Supabase: Auth · Postgres (subscriptions, usage, RLS) · Realtime ·     │◀┘
   │ Storage (cloudSync) · pg_cron (kvóta-reset)                            │
   └──────────────────────────────────────────────────────────────────────┘
            ▲                                   ▲
   RevenueCat webhook ──▶ /billing/revenuecat   Expo Push (értesítés)
```

---

## 1. Teljes eszköz-/szolgáltatás-leltár

### A) Kliens-terjesztés és fizetés
| Eszköz | Mire | Állapot | Melyik szint hajtja |
|---|---|:--:|---|
| **Apple Developer Program** ($99/év) | iOS store-terjesztés | 🔧 | mind |
| **Google Play Developer** ($25 egyszeri) | Android store | 🔧 | mind |
| **EAS Build** (`eas.json` dev/preview/production) | natív build (RevenueCat SDK Expo Go-ban nem megy) | ✅ konfig, 🔧 fiók | mind |
| **EAS Submit** (`submit.production`) | store-feltöltés | ✅ konfig | mind |
| **EAS Environment Variables** | prod `EXPO_PUBLIC_*` (Supabase URL/kulcs, RC-kulcsok, CLOUD_URL) | 🔧 beállít | mind |
| **RevenueCat** | IAP → `subscriptions` írása; 3 termék × havi/éves; `basic`/`pro`/`ultra` entitlement | ✅ SDK+webhook kód, 🆕 3-szint termékek | Basic/Pro/Ultra |
| **RevenueCat consumable** | Shop-kredit-vásárlás + AI-kredit top-up | ✅ shop-kód, 🆕 AI-kredit termék | mind |

### B) Backend — Supabase (a szint EGYETLEN hiteles forrása)
| Elem | Mire | Állapot |
|---|---|:--:|
| **Auth** | login (email/jelszó), JWT | ✅ |
| **Postgres + RLS** | `subscriptions`, `cloud_projects`, `project_collaboration`, `shop_marketplace`, `social_feed`, `notifications`, `user_ai_providers` (BYOK) — 14 migráció | ✅ |
| **`subscriptions.tier` enum bővítés** | `free\|basic\|pro\|ultra` (ma `free\|pro`) | 🆕 |
| **`usage_counters` tábla** 🆕 | AI-kredit / render-perc / tárhely-GB per user + időszak; kvóta-ellenőrzés forrása | 🆕 |
| **pg_cron** | havi kvóta-reset (`usage_counters`), lejárt Pro-k takarítása | 🔧 |
| **Storage buckets** | `renders`, `media`, `videos`, `posters` — `cloudSync` + feed | ✅ (migráció) |
| **Realtime** | értesítés, kollab, feed-számlálók | ✅ |

### C) Worker (`server/`) — a fizetős felhő-mag
| Komponens | Mire | Állapot |
|---|---|:--:|
| **Express API** (`index.js`, :8787) | render/AI/felirat/import végpontok + Pro-kapu (402) | ✅ |
| **render-worker.js** | BullMQ-fogyasztó, több példány = vízszintes skálázás | ✅ |
| **BullMQ + Redis** (`queue.js`, ioredis) | render-sor; `RENDER_CONCURRENCY`, `CLOUD_RENDER_MIN_SEC` | ✅ |
| **BullMQ priority-lane** 🆕 | queue-prioritás szint szerint (Ultra > Pro > Basic) | 🆕 |
| **S3/R2 kliens** (`s3store.js`, aws-sdk) | render-kimenet + média (`S3_*` env) | ✅ |
| **billing.js** | RevenueCat webhook + activate/deactivate → `subscriptions` | ✅ |
| **Metering-middleware** 🆕 | minden fizetős végpont előtt: szint-ellenőrzés + kvóta-fogyasztás (`usage_counters`) → 402/429 | 🆕 |
| **SSRF-védelem** (`ssrf.js`) | BYOK `baseUrl` allowlist, privát-IP tiltás | ✅ |
| **worker-auth** (`auth.js`) | Supabase-JWT verifikáció (`SUPABASE_ANON_KEY`) + service_role írás | ✅ |
| **notify.js** (expo-server-sdk) | Expo push + `notifications` írás | ✅ |

### D) A worker gép-szintű függőségei (bináris, nem npm — a VPS-re)
| Bináris/modell | Mire | Melyik capability |
|---|---|---|
| **FFmpeg + ffprobe** | render, szín, beat, TTS-konverzió, proxy, hullámforma | `cloudRender`, sok |
| **whisper.cpp** (`whisper-cli` + `ggml-base.bin`) | beszéd → felirat | `autoCaption` |
| **ONNX modellek** (u2net, depth-anything-v2, ultraface, upscale, vision) | kép-AI | `bgRemove`/`depth3d`/`faceTools`/`upscale`/`skyReplace`/`colorAi` |
| **onnxruntime-node** | az ONNX-futtató (alap **CPU**; GPU-hoz CUDA-EP kell) | ua. |
| **Chromium** (Playwright) | szöveg-render, thumbnail, kinetic/path bake | render |
| **yt-dlp** | URL-import worker-fallback | `urlImport` |
| **three.js** | 3D matricák | matrica/3D |

### E) AI „agy" (a legdrágább változó — háromféleképp)
| Út | Kinek | Költség nekünk | Kód |
|---|---|---|---|
| **Managed Claude** (`@anthropic-ai/sdk`, `AI_MODEL`) | Basic-kóstoló + Pro-keret | metered (Claude API) | `ai.js` ✅ |
| **BYOK** (user saját kulcsa) | Ultra korlátlan (+ Pro-opció) | **$0** | `aiProviders.ts` + `user_ai_providers` ✅ |
| **Ollama a VPS-en** (`OLLAMA_URL`) | ha van szabad CPU/RAM | $0 per-token | ✅ támogatott |

### F) Peremszolgáltatások
| Eszköz | Mire | Állapot |
|---|---|:--:|
| **Reverse proxy + TLS** (Caddy vagy Cloudflare) | `https://render.remix.app`; ATS/HTTP-blokk miatt HTTPS kötelező ([`backend.ts`](src/lib/backend.ts) `assertSecureUrl`) | 🔧 |
| **DNS + domain** (~$10/év) | worker + webhook URL | 🔧 |
| **Cloudflare R2** (egress $0) | média/render tár — a videó-egress a legdrágább tétel | 🔧 |
| **On-demand GPU** (RunPod/Vast.ai) | Ultra prioritás: 4K/8K/upscale/depth gyors | 🆕 (opció, spot) |
| **Expo Push** | háttér-értesítés | ✅ kód |

---

## 2. Melyik szint melyik infrát „égeti" (dependency-mátrix)

| Infra-elem | Free | Basic | Pro | Ultra |
|---|:--:|:--:|:--:|:--:|
| App (EAS build/store) | ✅ | ✅ | ✅ | ✅ |
| Supabase Auth/DB/RLS | ✅ (login/feed) | ✅ | ✅ | ✅ |
| Supabase Storage (`cloudSync`) | — | 5 GB | 100 GB | 1 TB |
| Worker API + FFmpeg-render | — | ✅ (H.264/HEVC ≤4K) | ✅ (AV1/ProRes/HDR) | ✅ (8K/master/batch) |
| Redis/BullMQ queue | — | normál lane | prioritás-lane | top-lane |
| whisper.cpp / yt-dlp / TTS | — | ✅ (kvóta) | ✅ | ✅ |
| ONNX kép-AI (CPU) | — | — | ✅ | ✅ |
| **GPU (on-demand)** | — | — | (nincs) | ✅ prioritás |
| Managed Claude (LLM) | — | kóstoló-kredit | nagy keret | korlátlan/**BYOK** |
| Metering/kvóta (`usage_counters`) | — | ✅ | ✅ | ✅ (BYOK-bypass) |
| RevenueCat entitlement | — | `basic` | `pro` | `ultra` |

**Olvasat:** a **Basic** csak olcsó, helyi-modell-alapú felhőt terhel (whisper/yt-dlp/TTS +
CPU-render) → ~$0 API-költség. A **Pro** hozza az ONNX + LLM terhet. Az **Ultra** az egyetlen,
ami **GPU-t** és **top-prioritást** kap — és épp ott a legmagasabb ár + a BYOK, ami a
költséget nullázza.

---

## 3. A metered 4-szint MAG-alrendszere (a legfontosabb ÚJ rész) 🆕

Ma a kapu **bináris**: Pro-e a user → 402 ha nem ([`backend.ts`](src/lib/backend.ts),
worker Pro-gate). A négy szinthez ez kell (kód nélkül, csak a terv):

1. **Szint-forrás:** `subscriptions.tier` enum `free|basic|pro|ultra`; a kliens
   `entitlementStore`/`subscription.ts` és a worker `auth.js` ezt olvassa.
2. **Capability→minTier map:** a `capabilities.ts` boolean `pro`-ja helyett szint-küszöb
   (pl. `autoCaption: basic`, `bgRemove: pro`, `gpuRender: ultra`).
3. **Kvóta-tábla** (`usage_counters`): `(user_id, period_start, metric, used)` — metrikák:
   `ai_credits`, `render_minutes`, `caption_minutes`, `storage_bytes`, `url_imports`.
4. **Metering-middleware a workerben:** minden fizetős végpont előtt (a) szint-ellenőrzés
   (< minTier → 402 upgrade), (b) kvóta-ellenőrzés+fogyasztás (túllépés → 429 + „top-up/upgrade").
5. **BYOK-bypass:** ha van default `user_ai_providers` kulcs → az `ai_credits` mérő KIMARAD
   (Ultra „korlátlan"), mert az LLM-et a user fizeti.
6. **Reset:** `pg_cron` havonta nullázza az időszakos metrikákat (a `storage_bytes` élő összeg marad).
7. **Queue-prioritás:** a `enqueueRender` a szintből `priority`-t ad a BullMQ-jobnak (Ultra legkisebb szám = leggyorsabb).

> Ez az **egyetlen** valóban új backend-modul; minden más (auth, service_role-írás,
> Pro-gate, Supabase, queue) már megvan — csak szint-tudatossá kell tenni.

---

## 4. CI/CD és release-pipeline

### Ami megvan ✅
`.github/workflows/ci.yml`: **minőség-kapu** (typecheck · lint · teszt · worker
syntax-check) + nem-blokkoló `expo-doctor`, `main` és `studio-social` ágon.

### Amit hozzá kell tenni 🔧/🆕
| Szakasz | Eszköz | Mit csinál |
|---|---|---|
| **DB-migráció** | `supabase db push` (CI-lépés) | a `supabase/migrations/` alkalmazása a prod DB-re merge-kor |
| **Worker-deploy** | Docker image build + push → VPS `docker compose pull && up -d` (vagy `fly deploy`) | a `server/` kiadása |
| **Worker-image** 🆕 | **Dockerfile** (nincs még!) FFmpeg + whisper.cpp + Chromium + ONNX-modellekkel | reprodukálható worker-környezet |
| **Kliens-build** | `eas build --profile production` (iOS+Android) | store-build (auto vagy címkére) |
| **Store-submit** | `eas submit --profile production` | feltöltés App Store/Play |
| **Smoke-teszt** | `GET /health` a deploy után | ellenőrzi: `render`, `ai`, `captions`, `billing`, `revenuecat` flag-ek |
| **Secrets** | GitHub Actions Secrets + EAS env | `SUPABASE_SERVICE_ROLE_KEY`, `RC_WEBHOOK_AUTH`, `S3_*`, `ANTHROPIC_API_KEY` |

**Branch-modell:** a fizetés/social a `studio-social` ágon; a sima Studio az ágtól tiszta
marad (lásd [[studio-social-branch]] jegyzet). A release a `main`-ből megy.

---

## 5. Runtime-topológia — 3 fokozat (részletes ár: OPS.md)

| Fokozat | Mit futtatsz | Eszközök | Mikor |
|---|---|---|---|
| **🟢 0 — csak app+social** | app + Supabase Free | EAS, Supabase, Expo Push | MVP, worker nélkül (Free tier eladható) |
| **🟡 1 — bootstrap, minden Pro-funkció, 1 VPS** | Hetzner CPX41: worker API + render-worker + Redis (Docker) + whisper/ONNX/FFmpeg; R2 tár; BYOK-AI | Docker Compose, Caddy, R2, Supabase Free→Pro | indulás (~$30–90/hó) |
| **🔴 2 — skálázás + Ultra-GPU** | több `render-worker` példány; **on-demand GPU** (RunPod spot) az Ultra-jobokhoz; managed Redis; Supabase Pro | Compose/orchestrátor, autoscale, GPU-pool | több ezer user, sok render |

**Folyamat-menedzsment (1. fokozat):** a legegyszerűbb **Docker Compose** egy VPS-en:
`api`, `render-worker` (`--scale render-worker=N`), `redis` konténerek + **Caddy** a TLS-hez
(automatikus Let's Encrypt). Alternatíva systemd-egységek `pm2` nélkül. A `.env` a
`server/.env.example` alapján (kötelező élesben: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`RC_WEBHOOK_AUTH`, `S3_*`, `REDIS_URL`).

---

## 6. Megfigyelhetőség, biztonság, mentés

### Observability 🔧
- **Health/diagnosztika:** a `GET /health` már jelzi az aktív képességeket (`render: cloud+local|local`, `ai`, `captions`, `vision`, `bgremove`, `billing`, `revenuecat`) → ez az uptime-monitor célpontja (UptimeRobot/Cloudflare Health).
- **Metrikák:** BullMQ queue-mélység + fail-arány (torlódás = skálázás-jel), render-idő, S3-egress; egyszerűen **Prometheus node-exporter + Grafana**, vagy a VPS-provider grafikonjai kezdésre.
- **Logok:** worker stdout → Docker log-driver (Loki/Grafana vagy a provider log-viewere); a `ALLOW_INSECURE_DEV` naplózza a hitelesítetlen kéréseket (élesben KI).
- **Cost-observability:** R2/Supabase/Claude havi dashboard; a `CLOUD_RENDER_MIN_SEC` és `RENDER_CONCURRENCY` a fő hangolók.

### Biztonság ✅/🔧
- **HTTPS kötelező** (kliens `assertSecureUrl`; iOS ATS/Android network-security amúgy is blokkolná a http-t).
- **Worker-auth:** Supabase-JWT verifikáció + per-végpont Pro/szint-kapu; a service_role SOHA nem megy a kliensre.
- **SSRF-allowlist** a BYOK-végpontokra (`ssrf.js`) — csak https, ismert hoszt, privát-IP tiltva; self-hosted modellhez `AI_EXTRA_HOSTS`.
- **CORS-allowlist** (`CORS_ORIGINS`) böngészős hívókhoz; a natív app nem küld Origin-t.
- **Rate-limit / anti-abuse** 🆕: a metering-middleware egyben abúzus-fék (fair-use plafon a „korlátlan" szinteken is); IP/user-szintű rate-limit a proxyn (Caddy) vagy Cloudflare-en.
- **Titkok:** EAS env (kliens-publikus `EXPO_PUBLIC_*`), GitHub Secrets + VPS `.env` (szerver-titkok); a `.env` gitignore-olt → EAS-be külön kell felvenni (a repo erre figyelmeztet).

### Backup / DR 🔧
- **Supabase:** managed napi backup (Pro tervtől PITR); a `subscriptions`+`usage_counters` a bevétel-kritikus adat → külön exportot érdemes.
- **R2/S3:** a renderek regenerálhatók (render-cache), a feltöltött média nem → verziózás/lifecycle-szabály.
- **Worker:** állapotmentes (a queue Redisben, a fájlok S3-ban) → újrahúzható a Docker-image-ből; a Redis-perzisztencia (AOF) opcionális, a job-vesztés max egy re-render.

---

## 7. Konkrét „bevásárlólista" (mit kell nyitni/telepíteni)

**Fiókok/szolgáltatások:**
- [ ] Apple Developer ($99/év) · Google Play ($25) · Expo/EAS fiók
- [ ] RevenueCat projekt → **3 előfizetési termék** (Basic/Pro/Ultra × havi/éves) + consumable (kredit) → `basic`/`pro`/`ultra` entitlement
- [ ] Supabase projekt (prod) → migrációk push, buckets, pg_cron
- [ ] VPS (Hetzner CPX41 ajánlott) + domain + Cloudflare (DNS+TLS+R2)
- [ ] (Ultra) RunPod/Vast.ai fiók az on-demand GPU-hoz
- [ ] (opció) Anthropic API-kulcs a managed AI-hoz — vagy Ollama a VPS-en

**A VPS-re telepítendő:** Docker + Compose · FFmpeg/ffprobe · whisper.cpp + `ggml-base.bin` ·
ONNX-modellek a `server/models/`-be · Chromium (Playwright) · yt-dlp · Redis (konténer) · Caddy.

**Env, amit ki kell tölteni:** `server/.env` (SUPABASE_URL/ANON/SERVICE_ROLE, REDIS_URL,
S3_*, RC_WEBHOOK_AUTH, YTDLP_BIN, AI_MODEL/ANTHROPIC vagy OLLAMA_URL, CORS_ORIGINS) +
EAS env (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY, EXPO_PUBLIC_CLOUD_URL, EXPO_PUBLIC_RC_IOS/ANDROID_KEY).

**RevenueCat webhook:** `https://<CLOUD_URL>/billing/revenuecat`, `Authorization: <RC_WEBHOOK_AUTH>`.

---

## 8. Build-sorrend (mit előbb)

1. **0. fokozat élesítése** — EAS prod-build + store-submit + Supabase prod + RevenueCat
   (egyelőre a meglévő **free/pro** modellel). Ez már eladható.
2. **1. fokozat** — 1 VPS Docker Compose-szal (worker+redis+caddy) + R2 → a Pro felhő-funkciók élnek.
3. **🆕 4-szint mag** — `subscriptions.tier` bővítés + `usage_counters` + metering-middleware +
   capability→minTier + RevenueCat 3 termék → **Basic/Pro/Ultra** élesen.
4. **CD-kiegészítés** — Dockerfile + worker-deploy + `supabase db push` + `eas build/submit` a CI-be.
5. **2. fokozat** — több render-worker + on-demand GPU (Ultra-prioritás) amikor a queue torlódik.

---

*Hiteles források: [`server/.env.example`](server/.env.example) (worker-env),
[`.env.example`](.env.example) (kliens-env), [`eas.json`](eas.json) (build-profilok),
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) (CI), [`server/queue.js`](server/queue.js) /
[`server/s3store.js`](server/s3store.js) / [`server/billing.js`](server/billing.js) (infra-kód),
[`supabase/migrations/`](supabase/migrations/) (séma). Költség-részletek: [OPS.md](OPS.md);
csomag-terv: [MONEY.md](MONEY.md).*
