# 🔴 01. Production / Go-Live — P0

> **Forrás:** [audit](../source/audit-2026-10-main.md) §1, §15. · **Testvér:** [02-monetization](./02-monetization.md) (rate-limit/abuse), security-backlog (`devs/tasks/remix/`).
> **Érintett kód:** [server/](../../server/) (worker) · [supabase/migrations/](../../supabase/migrations/) · [app.json](../../app.json) · [eas.json](../../eas.json) · [src/lib/backend.ts](../../src/lib/backend.ts) · `.env*`.

---

## 0. Kontextus & cél
A ReMix publikus **mobil app + nyilvános worker-API** lesz. A go-live nem feature-kérdés,
hanem **infrastruktúra + biztonság + üzemeltethetőség**. Cél: egy felhasználó végig tud
menni az `upload → render → publish` úton **production** környezetben, monitorozva, biztonságosan.

## 1. Jelenlegi állapot (bizonyíték)
- Van render-engine + BullMQ worker ([server/queue.js](../../server/queue.js)), Supabase-migrációk
  ([supabase/migrations/](../../supabase/migrations/)), auth ([server/auth.js](../../server/auth.js)).
- Hosztolt prod Supabase **létezik** (ref `rctzpbzkpaqdldtueeub`, migrációk pushed) — de a teljes
  prod-hardening (backup/restore/domain/secrets-rotáció) nyitott.
- Nincs prod Docker-worker-image, nincs EAS production (store) build, nincs crash/cost-monitoring.

## 2. Feladatlista

### 2.1 Hosztolt Supabase (prod) — P0
- [ ] 🟡 Prod projekt + migration-push véglegesítés + **prod RLS-validáció** (minden táblára).
- [ ] ⬜ **Backup + restore-teszt** (PITR / napi dump + bizonyított visszaállítás).
- [ ] ⬜ Prod **domain** + prod **secrets** (rotált DB-jelszó, service-role csak a workeren).
- [ ] 🟡 Prod **Storage** bucket-policy path-alapú (nem bucket-szintű) — lásd security-backlog `05`.

### 2.2 Production render worker — P0
- [ ] 🟡 **Prod Docker image**: FFmpeg + Whisper + Chromium (egress) + ONNX-runtime, pinned verziók.
- [ ] ⬜ Persistent **temp/storage stratégia** (ephemeral FS → S3/R2 kiírás + takarítás).
- [ ] ⬜ **Deployment** (Fly/Render/VM) + **health-check** endpoint + **autoscaling** + **crash-recovery**.
- [ ] ⬜ **Prod smoke-test**: render + TTS + egress + upload a prod workerben (CI-ből futtatva).

### 2.3 EAS production build — P0
- [ ] 🟡 EAS projekt-ID véglegesítve (`42318da2-…`), **production** profil + environment az [eas.json](../../eas.json)-ban.
- [ ] ⬜ **iOS store-build** (Apple Developer-fiók + provisioning) + **Android store-build** (AAB).
- [ ] ⬜ App Store Connect + Google Play Console konfiguráció (metaadat, privacy, age-rating).
- [ ] ⬜ Push + **IAP entitlementek** + native render-capability tesztek fizikai eszközön.

### 2.4 RevenueCat production — P0
- [ ] 🟡 App Store + Google Play **products** (havi/éves subscription) + `entitlement mapping`.
- [ ] ⬜ **Prod webhook** (RC → worker, `RC_WEBHOOK_AUTH`) + restore/cancellation/refund tesztek.

### 2.5 Secret management (prod) — P0
- [ ] 🟡 Refresh-token **SecureStore** (kész) + **BYOK** secret kezelés + worker-secrets (service-role/Anthropic/RC/S3/Redis).
- [ ] ⬜ **HTTPS-enforcement** minden prod komponensen (worker, storage, CDN).

### 2.6 Push notification production — P0
- [ ] 🔌 **APNs + FCM** kulcsok + device-token prod-regisztráció + permission-flow + background + deep-link teszt.

### 2.7 Go-live pipeline + megfigyelhetőség — P0
- [ ] ⬜ **upload → render → publish** teljes pipeline prod-verifikáció (1 valódi videó végig).
- [ ] ⬜ **Crash + error monitoring** (Sentry vagy ekviv.) kliens + worker.
- [ ] ⬜ **Rate-limiting** minden compute-endpointon (security-backlog `03`) + **cost-observability** ([13](./13-documentation.md) §13.5).
- [ ] ⬜ **Client/worker contract-tesztek** ([13](./13-documentation.md) §13.4) a CI-ben.

## 3. Kész, ha
Egy friss eszközön a store-build (vagy internal-distribution) appból **bejelentkezés → projekt
→ render → feed-publish** végigmegy a **prod** workeren + prod Supabase-szel; a Pro-vásárlás a
RC-prod-webhookon landol; a hibák monitoringba futnak; a rate-limit + contract-tesztek zöldek.
