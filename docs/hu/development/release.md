# Kiadás (release)

> Forrás: [eas.json](../../../eas.json) · [PROD.md](../../../PROD.md) ·
> [DEVOPS.md](../../../DEVOPS.md) · [OPS.md](../../../OPS.md) + a kód.
> ↑ [docs/hu index](../README.md)
>
> Ez a doksi az **architektúra** felől nézi a kiadást (mi kell, és miért); a
> részletes go-live checklistet a [PROD.md](../../../PROD.md) és a
> [TODO.md](../../../TODO.md) tartalmazza — **azt itt nem duplikáljuk**.

## 1. Kliens — EAS build

Profilok ([eas.json](../../../eas.json)):

| Profil | Cél | Megjegyzés |
|---|---|---|
| `development` | dev-client (belső) | `developmentClient: true`, Android APK |
| `preview` | belső teszt | Android APK |
| `preview-sim` | iOS szimulátor | `ios.simulator: true` |
| `production` | store | `distribution: store`, `autoIncrement` |

**Miért kell natív build (nem elég Expo Go):**
- **On-device render** — a [remix-render](../../../modules/remix-render/index.ts)
  natív modul Expo Go-ban `null` ([runtime.md](../architecture/runtime.md),
  [rendering.md](../architecture/rendering.md)).
- **IAP / előfizetés** — `react-native-purchases` (RevenueCat) natív modul.

App-konfiguráció: [app.json](../../../app.json) (name `Remix`, slug `remix`,
plugins); a New Architecture az SDK 57 alatt az alap.

## 2. Env-mátrix

Az `EXPO_PUBLIC_*` értékek a **bundle-be égnek** → módosítás után Metro-újraindítás
(release-nél új build). A főbbek ([backend.ts](../../../src/lib/backend.ts),
[networking.md](../architecture/networking.md)):

- `EXPO_PUBLIC_CLOUD_URL` — a hosztolt fizetős worker (prod).
- `EXPO_PUBLIC_SERVER_URL` / `_SERVER_HOST` — dev-worker cím.
- `EXPO_PUBLIC_SUPABASE_URL` + anon key — a social/fizetés backend.

Release buildben a sima HTTP tiltott (`assertSecureUrl`) → a worker/Supabase
**HTTPS** kell legyen.

## 3. Worker deploy (`server/`)

- **Két process:** API (`node index.js`) + `render-worker.js` (skálázáshoz több
  példány) ([ADR-007](../decisions/ADR-007-hybrid-render.md)).
- **Függőségek:** Redis (BullMQ-queue), S3/R2/MinIO (média + kész MP4),
  opcionálisan whisper-cpp (feliratozás), ffmpeg, headless Chromium
  (playwright-core).
- **Konfiguráció:** [server/.env.example](../../../server/.env.example) alapján
  (`CLOUD_RENDER_MIN_SEC`, S3-kulcsok, AI-kulcsok); a `/health` `render` mezője
  jelzi az aktív módot (in-process vs. queue).
- **Biztonság:** `requireAuth`, `corsAllowlist`, SSRF-guard
  ([networking.md](../architecture/networking.md)).

## 4. Supabase

- **Migrációk** ([supabase/migrations/](../../../supabase/migrations/)) alkalmazása.
- **Storage bucketek:** media / videos / posters.
- **RLS** minden táblán (moderáció/privacy a DB-ben).
- **Fizikai eszköz:** `0.0.0.0`-ra kötés + LAN-IP a klienshez ([README.md](../../../README.md)).

## 5. Fizetés élesítés

RevenueCat account/kulcsok + webhook ([server/billing.js](../../../server/billing.js)),
`subscriptions` szerver-autoritatív; a kliens csak szinkronizál (nincs self-grant).
Részletek: [PRO.md](../../../PRO.md) · [MONEY.md](../../../MONEY.md).

## 6. Go-live blokkolók

A production-kritikus tételek élő listája: [TODO.md](../../../TODO.md) +
[AUDITBUGS.md](../../../AUDITBUGS.md). Ezt itt szándékosan **nem** ismételjük.
