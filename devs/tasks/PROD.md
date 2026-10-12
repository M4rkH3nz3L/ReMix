# 🚀 PROD.md — Production-kiadás a 4 eszköz-célra (Android telefon + tablet · iPhone + iPad)

> **Cél:** mi kell ahhoz, hogy a **ReMix** **production** szinten kiadható legyen **Android telefonra ÉS tabletre**,
> valamint **iPhone-ra ÉS iPadre**. Ez a **launch-kapu** — a részletek a témafájlokban:
> [01-production-go-live](./01-production-go-live.md) (backend), [02-monetization](./02-monetization.md) (IAP),
> [VIDEO/IMAGE/AUDIO-STUDIO-PROD](./IMAGE-STUDIO-PROD.md) (stúdió-prod-réteg).
>
> **Jelmagyarázat:** ✅ kész · 🟡 részben · 🔌 deploy/infra · 👤 **a te dolgod** (fiók/konzol/banki/jogi) · 📱 device-build/teszt kell.

---

## 0. Olvasat — a 4 cél = 2 build

**Fontos:** a 4 form-faktorhoz NEM kell 4 külön build, hanem **2**:
- **iOS: EGY univerzális build** (`supportsTablet: true` az [app.json](../../app.json)-ban) → **iPhone ÉS iPad** ugyanabból a `.ipa`-ból.
- **Android: EGY AAB** → a Play **telefonra ÉS tabletre** is ebből telepít.

**Jó hír:** az app **first-class reszponzív** — van size-class rendszer ([useLayout](../../src/hooks/useLayout.ts) + [constants/layout](../../src/constants/layout.ts) +
[deviceInfo](../../src/lib/deviceInfo.ts)): `isExpanded` (iPad-fekvő/desktop → **dokkolt inspector + teljes idővonal**), `isTabletPortrait`,
méret-skálázott térköz/betű, széleskörű safe-area (38 hely). Az `orientation: "default"` → **minden tájolás** megengedett.
→ A tablet/iPad-támogatás **kódból kész**; a hátralévő eszköz-munka **valós-eszköz-verifikáció + store-asset** (nem újraírás).

**A launch 3 dolgon múlik:** 👤 **fejlesztői fiókok** · 🔌 **backend-deploy** · 👤 **store-admin** (lásd C–H).

---

## 1. 📱 ESZKÖZ-MÁTRIX — a 4 cél külön-külön

| Cél | Build | Store-követelmény | UI/UX production-kritérium |
|-----|-------|-------------------|-----------------------------|
| **Android telefon** | AAB (Play) | telefon-screenshotok | compact size-class, álló+fekvő, safe-area/gesture-nav |
| **Android tablet** | ugyanaz az AAB | **tablet-screenshotok** + „large screen" minőség | expanded layout, fekvő-first, nagy-képernyő guideline |
| **iPhone** | univerzális `.ipa` | 6.7"/6.5" (+5.5") screenshotok | compact, notch/Dynamic Island safe-area |
| **iPad** | ugyanaz az `.ipa` | **iPad-screenshotok (12.9"/13" + 11")** | expanded (dokkolt inspector), minden tájolás, Stage Manager/Split View |

### 1.1 📱 Közös eszköz-UX production-ellenőrzés (MINDEN form-faktoron)
- [ ] 📱 **Reszponzív verifikáció valós/szimulált eszközön**: compact (telefon) **és** expanded (tablet/iPad) layout — a szerkesztő
  (idővonal + vászon + inspector/panel) **ne legyen szétnyúló telefon-UI** nagy képernyőn (a size-class ezt kezeli → **tesztelni kell**).
- [ ] 📱 **Tájolás**: álló **és** fekvő minden célon (az `orientation: default` miatt) — nincs levágott vezérlő, a vászon-arány stabil,
  forgatáskor nem vész el állapot. *(Ha egy képernyő nem bírja a fekvőt, ott zárolni kell — tudatos döntés.)*
- [ ] 📱 **Safe-area / cutout**: notch · Dynamic Island · iPad-sarkok · Android lyukkamera · gesztus-navigáció · tablet-navbar —
  a top-bar és az alsó eszköztár ne lógjon a rendszer-UI alá.
- [ ] 📱 **Érintés-ergonómia**: a vektor-toll / vágás / csúszkák ujjal is pontosak; tableten a nagyobb vászon kihasználva.
- [ ] 📱 **Natív modulok minden form-faktoron**: **Skia** (kép-vászon/ecset), **kamera** (telefon+tablet, elülső/hátsó),
  **mikrofon/felvétel**, **expo-video/audio**, **LiveKit/WebRTC** (élő) — tableten/iPaden is működjenek.
- [ ] 📱 **Teljesítmény a gyengébb eszközön**: nagy projekt + preview belépő-szintű telefonon se akadjon be (a React Compiler
  auto-memoizál; a nagy-doc guard véd) — mérni a legkisebb cél-eszközön.
- [x] ✅ **Téma**: `userInterfaceStyle: "dark"` (explicit — az app sötét-tónusú, nincs light-mode; a rendszer-téma nem borítja fel).

### 1.2 🤖 Platform-technika (build-szint)
- [x] ✅ **iOS**: `supportsTablet: true` · `ITSAppUsesNonExemptEncryption: false` · usage-stringek (kamera/mikrofon/fotó) ·
  **privacyManifests kitöltve** (email/userID/purchase/photos) · ATS: a prod API **HTTPS** legyen (a `NSAllowsLocalNetworking` csak dev).
- [x] ✅ **Android**: engedélyek (kamera/mikrofon/média/foreground-service) · adaptive-icon (fg/bg/monochrome) ·
  `predictiveBackGestureEnabled` beállítva.
- [ ] 🔌 **Android Play-követelmények (2026)**: **targetSdk 35+** (Android 15) · **64-bit** · **16 KB page-size** natív libek ·
  **AAB** kimenet — az Expo ~57 ezeket adja; **verifikálni** az éles buildben.
- [ ] 📱 **iPad-specifikus**: multitasking (Split View / Stage Manager) — ha nem támogatjuk teljesen, **requires-fullscreen**-t
  tudatosan állítani (különben a review elvárhatja a multitasking-helyes működést).

---

## 2. 📱 Build & signing (EAS) — a 2 build legyártása

- [x] ✅ `eas.json` **`production`** profil kész (`distribution: store`, `autoIncrement`, `appVersionSource: remote`, `submit.production`).
- [ ] 📱👤 **iOS**: `eas build --profile production --platform ios` → signed `.ipa` (EAS-felhő intézi a distribution cert +
  provisioning profilt az Apple-fiókból). *(A lokál `expo run:ios` Xcode 26.4+-t igényel; az EAS-felhő MEGKERÜLI.)*
- [ ] 📱👤 **Android**: `eas build --profile production --platform android` → signed **`.aab`** (EAS-kezelt keystore).
- [ ] 👤 **Submit**: `eas submit --profile production -p ios|android` (App Store Connect API-kulcs / Play service-account).
- [ ] 🔌 **Prod runtime-env a buildben**: a kliens a **prod** API/Supabase/R2-re mutasson (EAS `environment: production`), NE a devre.
- [ ] 📱 **Belső teszt-terjesztés telepítve**: **mind a 4 form-faktoron** (TestFlight: iPhone+iPad; Play internal testing: telefon+tablet).

---

## 3. 👤 Fejlesztői fiókok (a #1 blokkoló)

- [ ] 👤 **Apple Developer Program** (99 USD/év) → App Store Connect + Paid-Apps-egyezmény + **banki/adó** (bevétel).
- [ ] 👤 **Google Play Console** (25 USD) → fejlesztői fiók + **merchant/banki** + jogi egyezmények.
- [x] ✅ **EAS/Expo fiók** megvan (`owner: vided`, projectId beállítva).
- [ ] 👤 **Név-ellenőrzés**: a „Remix" display-name szabad-e mindkét boltban (a bundle `com.h3nz3l.remix` fix).

---

## 4. 🔌 Backend prod-infra (részletek: [01](./01-production-go-live.md))

- [x] ✅ **Supabase prod** provisioned (eu-west-1, 26 migráció). → 🔌 **DB-jelszó-rotáció** + **dev/prod szétválasztás** (ma a dev a prod DB-be ír!).
- [ ] 🔌 **Render-worker DEPLOY — KRITIKUS**: a >15s exportok queue-ra mennek; worker nélkül az export **25%-on ragad** →
  a reviewer törött appot lát. A közös [server/Dockerfile](../../server/Dockerfile) (Node+ffmpeg+Chromium+fontok) + Redis + R2 + health.
  *(Fedi a /render + /imagedoc + /svg/pdf + /audio/* utakat is.)*
- [x] ✅ **R2 (Cloudflare)** platform-tár élő → 🔌 prod bucket + kulcsok a worker-env-ben.
- [ ] 🔌 **Secretek (prod-vault)**: Anthropic · RevenueCat webhook · Supabase service-role · R2 · PayPal · LiveKit — NEM a repóban.
- [ ] 👤🔌 **Push**: Apple **APNs**-kulcs + Google **FCM** service-account (expo-server-sdk).

---

## 5. 👤 IAP / monetizáció (store-politika!)

- [x] ✅ Szerver-autoritatív Pro-előfizetés (Supabase + RevenueCat) kód-kész.
- [ ] 👤 **RevenueCat prod** + a **termékek létrehozása mindkét boltban** (ASC subscriptions + Play subscriptions) + sandbox-teszt.
- [ ] ⚠️👤 **Virtuális valuta / kifizetés**: a **coin-pénztárca + marketplace + PayPal-cash-out** ütközhet a bolt-politikával
  (digitális javak = IAP-kötelező; user→user cash-out érzékeny). **Jogi átvizsgálás** — lehet, hogy a cash-out v1-ben kimarad (env-gate megvan).

---

## 6. 👤 Store-listing & assets (eszköz-osztályonként!)

- [ ] 👤 **Screenshotok MINDEN kötelező méretre**: **iPhone** 6.7"/6.5" (+5.5") · **iPad** 12.9"/13" + 11" · **Android telefon** · **Android tablet**.
  (A tablet/iPad screenshot a „tablet-optimalizált" besoroláshoz + a review-hez kell.)
- [ ] 👤 **Ikon** ✅ · Play **feature graphic** · leírás/kulcsszavak/kategória (mindkét bolt) · opcionális preview-videó.
- [ ] 👤 **Privacy-Policy-URL + Support-URL** (nyilvános link — a [legal.ts](../../src/constants/legal.ts) tartalom publikálva).
- [ ] 👤 **Korhatár**: Apple age-rating + Google **IARC** (a social/UGC/chat miatt figyelni).

---

## 7. 🔒 Adatvédelem & megfelelés

- [x] ✅ **GDPR-alap** (consent + privacy/terms) + **in-app fiók-törlés** (`softDeleteAccount`) — **Apple kötelező követelmény TELJESÍTVE** — + **adat-export** (`exportMyData`).
- [x] ✅ **iOS privacyManifests** előre kitöltve (App Privacy-hez).
- [ ] 👤 **Apple App Privacy** + **Google Data Safety** űrlapok kitöltése a konzolokon (a privacyManifest ad alapot).
- [x] ✅ **R2-média hard-erasure KÉSZ** (nem rés!): a `POST /account/erase` ([server/index.js](../../server/index.js)) a soft-delete cooldown
  után a `storagePrefixes` + `listAllObjects` ([server/security/accountErase.js](../../server/security/accountErase.js)) alapján
  **PURGE-olja a média-objektumokat** az R2-ből (`account.erased` audit-log + `purgedObjects` szám). → 🔌 **csak az auto-finalizáló**
  (a cooldown lejárta után a végleges erase automatikus futtatása) kell — ez **deploy** (cron/ütemezett job), nem kód.
- [x] ✅ **UGC-moderáció KÉSZ**: **jelentés** (`reportPost`/`reportComment`/`reportMessage` + resolveReport — a feedből+kommentből
  elérhető) + **felhasználó-blokkolás** (`blockUser`, a feed report-menüjében; a blokkolt szerző posztjai+kommentjei **kiszűrve**
  `filterBlocked`-kal) + owner-moderáció + globális `post.moderate`/`comment.moderate` jog. → ⬜ follow-up: **blokkolt-lista
  management** (unblock-UI a profilban).

---

## 8. 🧪 App-review gotchák

- [ ] 👤 **Reviewer demo-fiók** (az app login mögött van) + Pro-hozzáférés/sandbox a review-notesban.
- [ ] 🔌 **Működő backend a review alatt** (worker+API él) — különben 25%-stall → elutasítás.
- [ ] 📱 **iPad/tablet nem „stretched phone"**: a review elutasíthatja, ha nagy képernyőn rossz a layout → a size-class miatt kész, de **tesztelni**.
- [x] ✅ Nincs összeomlás a fő utakon (Skia-reziliencia-fix után a kép-stúdió natív-modul hiányában sem crashel).
- [x] ✅ **UGC-követelmények kész** (gyakori elutasítás-ok): a feedből **jelentés** + **felhasználó-blokkolás** elérhető, a blokkolt
  tartalom kiszűrve → az App Store/Play UGC-elvárása teljesül.

---

## 9. ✅ Go/No-go — a minimális production-szett a 4 célra

1. 👤 Apple + Play fiók élő (egyezmények + banki/adó).
2. 📱 EAS **production** build: **iOS univerzális `.ipa`** (iPhone+iPad) + **Android `.aab`** (telefon+tablet), signed.
3. 📱 **Mind a 4 form-faktoron tesztelve** (TestFlight iPhone+iPad · Play internal telefon+tablet): layout/tájolás/safe-area/natív-modulok OK.
4. 🔌 **Render-worker + API + Supabase-prod + R2 ÉLŐ**, prod-env a buildben.
5. 👤 RevenueCat prod + IAP sandbox-teszt zöld.
6. 👤 Store-listing kész **eszköz-osztályonkénti screenshotokkal** (telefon+tablet+iPhone+iPad) + privacy-URL + age-rating.
7. 👤 App Privacy + Data Safety űrlapok.
8. ⚠️👤 Monetizáció-politika tisztázva (coin/cash-out v1-ben be/ki).

---

## Függelék — termék-oldali prod-státusz (kész, bizonyítva)

| Stúdió | Account-független prod-réteg | Hátra |
|--------|------------------------------|-------|
| **Kép** | ✅ parity-harness · PNG/JPG/WebP/SVG/PDF · HEIC/EXIF · font-parity · nagy-doc gát/perf · Skia-reziliencia | PSD (lib) · P2 |
| **Hang** | ✅ export-parity-harness (LUFS/TP/pan mérve) · +opus/minőség · i18n-parity | 📱 preview-DSP + UI-k · Demucs |
| **Videó** | ✅ render-smoke-parity · cancel · worker-health | 🔌 worker-deploy · 📱 natív Android-render |

> **A kódból elvégezhető production-munka nagyrészt kész és bizonyított — a tablet/iPad-támogatás is kódszinten adott.**
> Ami hátra: **fiók + deploy + store-admin** (3–9) + a **valós-eszköz-verifikáció** a 4 form-faktoron (1) — ez utóbbi a
> device-buildekkel (Apple ID / Android dev fiók) indul.
