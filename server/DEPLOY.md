# 🚀 ReMix backend — Hetzner deploy (lépésről lépésre)

A ReMix backend (API + render-worker + Redis) telepítése EGY Hetzner (vagy bármely
Docker-képes) szerverre, **automatikus HTTPS**-szel. A stack: [docker-compose.yml](./docker-compose.yml)
(redis + api + worker + caddy), [Caddyfile](./Caddyfile), [.env.production.example](./.env.production.example).

> **Ez a fájl a HOGYAN.** A teljes launch-kontextus: [../devs/tasks/PROD.md](../devs/tasks/PROD.md) (§4 backend-infra).

---

## 0. Előfeltételek (mielőtt kezdenéd)

- **Hetzner szerver** — ajánlott: **CX32+ / CPX31+** (4 vCPU, 8 GB RAM, Ubuntu 24.04). A render + Chromium
  memória-/CPU-éhes; kisebb gépen a párhuzamos render elfogyhat. SSD + jó hálózat.
- **Domain** (pl. `api.pelda.hu`) — amit a backendhez használsz. Hozzáférés a DNS-hez.
- **Cloudflare R2** bucket + S3-kulcsok (access/secret) + publikus media-domain. *(már élő a projektben)*
- **Supabase PROD** projekt URL + `service_role` + `anon` kulcs. *(már provisioned)*
- (Opcionális) Anthropic API-kulcs, RevenueCat webhook-secret, LiveKit, PayPal.

---

## 1. Szerver-provisioning (root SSH)

```bash
ssh root@<SZERVER_IP>

# rendszer-frissítés + alap
apt update && apt upgrade -y

# tűzfal: csak SSH + HTTP + HTTPS
apt install -y ufw
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Docker + compose-plugin (hivatalos script)
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

---

## 2. DNS

A domain **A-rekordja** (és AAAA, ha IPv6) mutasson a szerver IP-jére:

```
api.pelda.hu.   A   <SZERVER_IP>
```

> A Caddy ebből a domainből kér Let's Encrypt-tanúsítványt — a DNS-nek ÉLNIE kell, mielőtt a stacket indítod.

---

## 3. A kód a szerverre

```bash
# a repo klónozása (vagy privát repónál deploy-key / rsync a server/ mappáról)
git clone https://github.com/M4rkH3nz3L/ReMix.git /opt/remix
cd /opt/remix/server
```

> Csak a `server/` mappa kell a futtatáshoz (a compose context = `server/`). A kliens-app NEM fut itt.

---

## 4. Env kitöltése

```bash
cp .env.production.example .env.production
nano .env.production      # töltsd ki a [K] kötelező mezőket (lásd a sablon kommentjeit)
```

**Kötelező minimum:** `RENDER_DOMAIN`, `CORS_ORIGINS`, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY`
(+ `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY`), `STORAGE_BACKEND=s3` + az `S3_*` (R2) kulcsok + `S3_PUBLIC_BASE`.
**⚠️ Prod-ban SOHA:** `ALLOW_INSECURE_DEV`, `RL_DISABLED`, `ALLOW_DEV_BILLING`.

A `RENDER_DOMAIN`-t a compose a Caddynek adja → exportáld is a shell-be VAGY tedd a compose melletti `.env`-be:

```bash
echo "RENDER_DOMAIN=api.pelda.hu" > .env   # a docker compose változó-behelyettesítéshez
```

---

## 5. Indítás

```bash
docker compose up -d --build        # build + redis + api + worker + caddy
docker compose ps                   # minden 'running/healthy' legyen
docker compose logs -f api worker   # élő logok (Ctrl+C a kilépéshez)
```

Az első indításnál a Caddy pár másodperc alatt kér TLS-tanúsítványt.

---

## 6. Ellenőrzés

```bash
curl -s https://api.pelda.hu/health | jq
# { "ok": true, "service": "vided-render", "render": "cloud+local", "workers": N, ... }
```

- `workers` ≥ 1 → a render-worker regisztrált (a Redis-heartbeat él) → a >15s export NEM ragad 25%-on.
- HTTPS zöld lakat → a Caddy-tanúsítvány rendben.

**Füst-teszt a szerveren** (opcionális, a repo eszközeivel):

```bash
# a futó API ellen (a domainre):
SMOKE_BASE=https://api.pelda.hu npm run smoke:image   # /imagedoc raszter-parity
SMOKE_BASE=https://api.pelda.hu npm run smoke:audio   # audio export + LUFS/TP mérés
```

---

## 7. Az app a prod backendre mutasson

Az EAS **production** buildben állítsd be (EAS env / `eas.json` `production.env` vagy a konzol):

```
EXPO_PUBLIC_CLOUD_URL=https://api.pelda.hu
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

> A kliens a `EXPO_PUBLIC_CLOUD_URL`-t használja ([src/lib/backend.ts](../src/lib/backend.ts) `cloudBaseUrl`), és prod-ban
> **HTTPS-t KÖVETEL** (`assertSecureUrl`) — a Caddy-domain emiatt is kell. Az `EXPO_PUBLIC_*` a bundle-be ég → új build.

---

## 8. Üzemeltetés

```bash
# skálázás (több render-worker ugyanazon a hoston)
docker compose up -d --scale worker=3

# frissítés (új kód)
cd /opt/remix && git pull && cd server && docker compose up -d --build

# logok / újraindítás
docker compose logs -f worker
docker compose restart api
docker compose down          # leállítás (a volume-ok megmaradnak)
```

### Render-worker méretezés-doktrina (02-render §02.5)

Két tengely: **példányszám** (`--scale worker=N`) × **szál/példány** (`RENDER_CONCURRENCY=K`).
A 4K-render + headless Chromium memória-éhes → a worker-konténer `mem_limit: 3g`
(compose) védi a hostot az OOM-tól; egy OOM-killelt workert a stalled-job
(`queue.js` `workerOptions`) visszaad a sorba (crash-recovery).

| Host (vCPU / RAM) | Ajánlott | Megjegyzés |
|---|---|---|
| 4 vCPU / 8 GB (CX32) | `worker=2`, `RENDER_CONCURRENCY=1` | 4K-nál 1 szál/worker (mem-éhes) |
| 8 vCPU / 16 GB | `worker=3–4`, `RENDER_CONCURRENCY=1–2` | 1080p-nél mehet 2 szál |
| több-render terhelés | `worker=N` lineáris áteresztés | a „Sor"-ETA (`index.js`) a concurrency-vel skáláz |

```bash
docker stats                 # élő CPU/MEM worker-példányonként (OOM-figyelés)
docker compose up -d --scale worker=3
```

> ⚠️ A `RENDER_CONCURRENCY × worker-példány × ~3g` ne lépje túl a host RAM-ját,
> hogy maradjon fejhely a redis + api + caddy + OS számára.

---

## 9. Megjegyzések / kockázatok

- **Chromium-sandbox:** az `api` és a `worker` `cap_add: SYS_ADMIN`-t kap (a compose-ban beállítva) — e nélkül a
  particles / animált-szöveg / forma-rétegek csendben kimaradnának a renderből, és az `/imagedoc`/`/svg/pdf` hibázna.
- **GDPR hard-erase cron (hátralévő):** a `/account/erase` kész (R2-purge is), de a cooldown utáni AUTOMATIKUS futtatáshoz
  egy ütemezett job kell (pl. napi `cron` a szerveren, ami a lejárt soft-delete-eket hard-erase-eli) — ez deploy-feladat.
- **Backup:** a Supabase (DB) saját backup; az R2 (média) a Cloudflare-nél; a Redis-queue efemer (nem kritikus).
- **Egress/Live (LiveKit):** külön szolgáltatás (LiveKit Cloud vagy saját Docker-egress) — nem ez a stack.
- **Memória:** 2+ render-worker párhuzamos 4K-render memória-igényes; figyeld a `docker stats`-ot, méretezd a gépet/RENDER_CONCURRENCY-t.
