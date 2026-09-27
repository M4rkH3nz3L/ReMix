# DEV.md — Élesítési (go-live) fejlesztői TODO

> **Cél:** a `devs/PROD.md` master-listából **csak a valódi piacra lépéshez szükséges** teendők — senior szinten, tömören. Nem új feature-ök: **prod-szintre emelés = átkonfigurálás** (hosztolt célok + env-mátrix „prod" oszlop + `__DEV__`-kapuk), nem kód-újraírás.
>
> **⛔ Nincs benne fizetési környezet.** RevenueCat / IAP / előfizetés-vásárlás / kredit-top-up / payout **kimarad** — ezt később élesítjük (lásd [§8](#8--fizetés-elhalasztva-nem-most)). Az app fizetés nélkül is kiadható.
>
> **Kiindulás:** a **0.A flip-ready réteg KÉSZ** (`lib/envConfig.ts` + tesztek, config-guardok, worker Pro-kapu, `GET /health` capability-tükör). Itt már csak a **prod cél** felállítása + bekötése van hátra. Részletek: `MISSING.md §0`.

---

## 🔴 P0 — Go-live blokk (ezek nélkül nincs kiadás)

### 1. Hosztolt Supabase
- [ ] Prod projekt létrehozása (régió közel a célközönséghez).
- [ ] Migrációk kitolása: `supabase db push` (**26 db** a `supabase/migrations/`-ban).
- [ ] **RLS-audit** minden táblán éles adatokkal (nem csak lokál seed) — különösen `subscriptions`, `cloud_projects`, `shop_*`, `notifications`, `project_collaboration`.
- [ ] Napi DB-backup + PITR bekapcsolva.
- [ ] Auth: prod redirect URL-ek, e-mail/SMS provider (ha telefon-login kell éles).

### 2. Hosztolt worker (render + AI)
- [ ] **`server/Dockerfile`** (JELENLEG NINCS) — base image + FFmpeg + whisper.cpp + Chromium + ONNX runtime + `yt-dlp`.
- [ ] Deploy (Fly.io / VPS) + **HTTPS** (nincs loopback/`http` — a kliens élesben elutasítja).
- [ ] **Redis** (managed) + BullMQ; `RENDER_CONCURRENCY`, `CLOUD_RENDER_MIN_SEC` prod-értékre.
- [ ] **Objektum-tár**: S3/R2/MinIO bucket (`renders`) + `S3_PUBLIC_BASE` publikus URL / CDN.
- [ ] Post-deploy **smoke-teszt**: `GET /health` minden capability-flag helyes (`captions/ai/vision/render=cloud+local/notify` …).
- [ ] Külön API- és worker-példány (min. 1+1), autoscaling/concurrency-terv.

### 3. EAS prod build
- [ ] `projectId` **megvan** (`42318da2-…`, owner `vided`, bundle `com.h3nz3l.remix`) — `eas.json` `production` profil kész.
- [ ] iOS signing (App Store Connect) + Android signing (Play Console).
- [ ] `eas build --profile production` → **fizikai eszközön** tesztelve (Expo Go NEM végtermék: push/eszköz-render csak natív buildben).
- [ ] Store-asszetek: ikon, splash, screenshotok, adatvédelmi + support URL, adatbiztonsági nyilatkozat.
- [ ] **Fiók-törlés flow** (store-követelmény) + GDPR export/erasure gap: S3-média törlés (auth-cascade a többit fedi).

### 4. Env-mátrix — „prod" oszlop kitöltése
- [ ] **Kliens** (EAS env vagy `.env.production`): `EXPO_PUBLIC_SUPABASE_URL`, `…_ANON_KEY`, `EXPO_PUBLIC_CLOUD_URL` (mind **https**, semmi 127.0.0.1). *(RC-kulcsok → §8, most üresen.)*
- [ ] **Worker** (`server/.env`): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (+ `AI_MODEL`), `REDIS_URL`, `S3_*`, `CORS_ORIGINS`, `AI_EXTRA_HOSTS` (ha BYOK).
- [ ] **Dev-kapuk kikapcsolva** éles workeren: `ALLOW_INSECURE_DEV` és `ALLOW_DEV_BILLING` **nincs beállítva**.

### 5. Prod titkok & security-hardening
- [ ] `expo-secure-store` a refresh-token / BYOK-kulcsok tárolására (dev: AsyncStorage — `__DEV__`/env szerint).
- [ ] Titkok kizárólag EAS env / worker env-ben (nincs repóban); service-role SOHA a kliensen.
- [ ] Rate-limit / anti-abuse a fizetős + AI-végpontokon (IP/user szint), upload MIME + méret + hossz limit.
- [ ] SSRF-allowlist (`AI_EXTRA_HOSTS`) + webhook-signature ellenőrzés bekapcsolva.

### 6. Push notification
- [ ] EAS credentials: **APNs** (iOS) + **FCM** (Android).
- [ ] `user_devices.push_token` regisztráció natív buildben + `POST /notify` éles kulccsal (különben 503).

### 7. Observability & megbízhatóság
- [ ] Error/crash tracking (Sentry) — kliens + worker.
- [ ] Log-aggregáció + queue/render-monitoring + worker health-alert.
- [ ] Backup: DB (§1) + storage lifecycle/retenció; költség-monitoring (R2/Supabase/Claude).
- [ ] **Render-reliability minimum**: retry + exponenciális backoff, timeout, cancel (`renderLocal` AbortSignal!), orphan-job + temp-file cleanup, progress/ETA + kész/hiba értesítés.

---

## 8. 💳 Fizetés — ELHALASZTVA (nem most)

**Kimarad az első kiadásból**, később kötjük be: RevenueCat prod-termékek, App Store/Play előfizetés, webhook (`billing.js` kész), tier-rendszer (`free|basic|pro|ultra`), `usage_counters`/kvóta-metering (402/429), kredit-top-up IAP, payout.

**Fizetés nélküli kiadás — teendő (kicsi):**
- [ ] Kliens már **gracefully degradál**: RC-kulcs nélkül a `billing.ts` „nem elérhető"-t ad, nem crashel → hagyd a `EXPO_PUBLIC_RC_*`-t üresen.
- [ ] **Döntés + config**: a Pro-only capability-k a launchre vagy (a) **„Hamarosan"** felirattal tiltva a Paywallon, vagy (b) **launch-ablakra nyitva** egy szerver-oldali flaggel (nem `__DEV__`-grant). Ne maradjon vásárolhatatlan, mégis kattintható Pro-gomb.
- [ ] `subscriptions` tábla marad az egyetlen igazságforrás (server-authoritative) — élesben **nincs** kliens self-grant / `dev_set_tier`.

---

## ✅ Go-live „Definition of Done"

```
INSTALL → SIGN UP → IMPORT → EDIT → (AI EDIT) → RENDER → PUBLISH → FEED → LIKE/COMMENT → REMIX
```
…mindegyik lépés **hosztolt Supabase + hosztolt worker** ellen, **natív iOS/Android buildben**, HTTPS-en, stabilan fut — **fizetés nélkül**. Ha ez zöld: kiadható, a fizetés utólag bekötve (§8).

**Sorrend:** §1 → §2 → §4 → §3 → §5/§6/§7 párhuzam → §8-döntés.

---
*Forrás: `devs/PROD.md` + `MISSING.md §0`. Fő vonal: DEV és PROD ugyanaz a kód, a prod = env-váltás + hosztolt célok.*
