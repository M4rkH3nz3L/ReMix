# 🚀 PROD.md — Store-indulási checklist (App Store + Google Play)

> **Cél:** EGY helyen, mi kell ahhoz, hogy a **ReMix** éles boltba kerüljön (Apple App Store + Google Play).
> Ez a **launch-kapu** — a részletek a témafájlokban: [01-production-go-live](./01-production-go-live.md) (backend-infra),
> [02-monetization](./02-monetization.md) (IAP), [VIDEO-STUDIO-PROD](./VIDEO-STUDIO-PROD.md) / [IMAGE-STUDIO-PROD](./IMAGE-STUDIO-PROD.md) /
> [AUDIO-STUDIO-PROD](./AUDIO-STUDIO-PROD.md) (stúdió-prod-réteg). Ez a fájl a **store-admin + go-live** deltát összegzi.
>
> **Jelmagyarázat:** ✅ kész · 🟡 részben · 🔌 deploy/infra · 👤 **a te dolgod** (fiók/konzol/banki/jogi — kódból nem megy) · 📱 device-build kell.

---

## 0. Olvasat — hol állunk

**A termék-mag és a prod-kód-réteg kész** (feature-teljes szerkesztők; a kép/hang/videó stúdió prod-paritása
bizonyított; auth/előfizetés/tárhely/usage-metering szerver-kész; az app-config store-kész: EAS `production` profil,
ikonok/splash, iOS usage-stringek + `ITSAppUsesNonExemptEncryption=false`, Android engedélyek, `com.h3nz3l.remix`).

**A launch NEM kódon múlik, hanem 3 dolgon:**
1. **👤 Fejlesztői fiókok** (Apple Developer Program + Google Play Console) — nélkülük nincs build-signing és store-feltöltés.
2. **🔌 Backend-deploy** (a render-worker + Supabase-prod + RevenueCat-prod ÉLESÍTÉSE — ma dev/lokál).
3. **👤 Store-admin** (listázás, adatvédelmi űrlapok, IAP-termékek, review).

| Terület | Állapot | Blokkoló |
|--------|---------|----------|
| App-config (bundle/verzió/ikon/engedély) | ✅ | — |
| EAS build-pipeline | ✅ (profilok kész) | 👤 Apple/Play fiók a signinghez |
| Supabase prod | 🟡 provisioned | 🔌 jelszó-rotáció + dev/prod szétválasztás |
| Render-worker | 🔌 lokál | **deploy kell (különben export 25%-on ragad)** |
| RevenueCat (IAP) | 🟡 kód-kész | 👤 RC-fiók + store-termékek |
| Push (APNs/FCM) | 🟡 kód-kész | 👤 kulcsok |
| Store-listing + assets | ⬜ | 👤 |
| Adatvédelmi űrlapok | 🟡 (consent/törlés/export kész) | 👤 Apple/Google űrlap kitöltés |

---

## A. 👤 Fejlesztői fiókok (a #1 blokkoló)

- [ ] 👤 **Apple Developer Program** (99 USD/év) → App Store Connect hozzáférés. Kell: Apple ID + 2FA + jogi egyezmények
  (Paid Apps agreement a IAP-hoz) + **banki + adó-adatok** (a bevételhez).
- [ ] 👤 **Google Play Console** (25 USD egyszeri) → fejlesztői fiók + **merchant/banki** (IAP-hoz) + jogi egyezmények.
- [x] ✅ **EAS/Expo fiók** megvan (`owner: vided`, projectId beállítva az [app.json](../../app.json)-ban).
- [ ] 👤 **Márkanév-ellenőrzés**: a „Remix" app-név szabad-e mindkét boltban (gyakori név → lehet, hogy egyedibb display-name kell;
  a bundle `com.h3nz3l.remix` fix maradhat).

---

## B. 📱 Build & signing (EAS production)

- [x] ✅ `eas.json` **`production`** profil kész (`distribution: store`, `autoIncrement`, `appVersionSource: remote`, `submit.production`).
- [ ] 📱👤 **iOS production build**: `eas build --profile production --platform ios` — az EAS-felhő intézi az aláírást (Apple-fiók +
  distribution cert + provisioning profile az App Store Connectből). *(A lokál `expo run:ios` Xcode 26.4+-t igényel — lásd a
  [ios-build jegyzetet]; az EAS-felhő ezt MEGKERÜLI, mert saját Xcode-ot használ.)*
- [ ] 📱👤 **Android production build (AAB)**: `eas build --profile production --platform android` — EAS-kezelt keystore (vagy
  feltöltött), kimenet **.aab** a Play-hez.
- [ ] 👤 **Submit**: `eas submit --profile production -p ios|android` (App Store Connect API-kulcs / Play service-account JSON kell).
- [ ] 🔌 **Runtime-env a prod buildhez**: a kliens a **prod** API/Supabase/R2-re mutasson (EAS `environment: production` →
  env-ek), NE a devre. *(Ma a dev a PROD DB-re mutat — a prod buildnek külön, tiszta env kell.)*

---

## C. 🔌 Backend prod-infra (részletek: [01-production-go-live](./01-production-go-live.md))

- [x] ✅ **Supabase prod** provisioned (eu-west-1, 26 migráció pushed + verifikálva).
  - [ ] 🔌 **DB-jelszó rotálása** (a provisioning óta) + a secret-ek prod-vaultba.
  - [ ] 🔌 **dev/prod szétválasztás** — a fejlesztés ma a prod DB-be ír; külön dev-projekt kell a launch előtt.
  - [ ] 👤 **email-confirmation** döntés (ma OFF a launchre — OK, de tudatos legyen) + SMTP a prod e-mailekhez.
- [ ] 🔌 **Render-worker DEPLOY** — **KRITIKUS**: a >15s exportok a BullMQ queue-ra mennek; worker nélkül a megosztás/export
  **25%-on ragad** (a reviewer törött appot lát). Kell: a [server/Dockerfile](../../server/Dockerfile) (Node+ffmpeg+Chromium+fontok)
  futó példánya(i) + Redis + R2 + health. *(Ez fedi a /imagedoc és /svg/pdf és /audio/* utakat is — egy image.)*
- [ ] 🔌 **R2 (Cloudflare) tárhely** — ÉLŐ (platform-tár kész); a prod bucket + kulcsok a worker-env-ben.
- [ ] 🔌 **Secret management (prod)**: Anthropic (AI), RevenueCat webhook-secret, Supabase service-role, R2, PayPal, LiveKit —
  prod-vault, NEM a repóban.
- [ ] 👤🔌 **Push (APNs + FCM)**: Apple APNs-kulcs + Google FCM service-account az expo-server-sdk-hoz.
- [ ] 🔌 **Megfigyelhetőség**: alap health/log/alert a worker + API köré (01 §2.7).

---

## D. 👤 IAP / monetizáció (store-politika!)

- [x] ✅ **Szerver-autoritatív Pro-előfizetés** (Supabase + RevenueCat IAP sync) kód-kész; a kliens csak szinkronizál.
- [ ] 👤 **RevenueCat prod**: fiók + API-kulcsok + a **termékek létrehozása mindkét boltban** (App Store Connect subscriptions +
  Play Console subscriptions), RC-hez kötve; webhook a workerre.
- [ ] 👤 **IAP-tesztelés sandboxban** (Apple sandbox-tester + Play internal testing) a review ELŐTT.
- [ ] ⚠️👤 **Virtuális valuta / kifizetés store-politika**: a **coin-pénztárca + marketplace (Facebook Stars-szerű) + PayPal-kifizetés**
  érzékeny terület. A boltok megkövetelik, hogy a **digitális javak IAP-n menjenek** (nem külső fizetés), és a **user→user
  kifizetés/„cash-out"** ütközhet a politikával. **Jogi/politikai átvizsgálás kell launch előtt** — lehet, hogy a cash-out/payout
  funkciót a v1-ben ki kell kapcsolni (env-gate már van). [02-monetization](./02-monetization.md).

---

## E. 👤 Store-listing & assets

- [ ] 👤 **App-ikon** ✅ (megvan) · **feature graphic** (Play) · **screenshotok** minden kötelező eszköz-méretre (iPhone 6.7"/6.5"/5.5",
  iPad; Android telefon/tablet) · opcionális **preview-videó**.
- [ ] 👤 **Leírás + kulcsszavak + kategória** (mindkét bolt), **rövid leírás** (Play), **promóciós szöveg** (Apple).
- [ ] 👤 **Support-URL + marketing-URL + Privacy-Policy-URL** (kötelező, nyilvános link kell — a [legal.ts](../../src/constants/legal.ts)
  tartalom publikálva egy URL-re).
- [ ] 👤 **Korhatár-besorolás**: Apple age-rating kérdőív + Google **IARC** kérdőív (a social/UGC + chat miatt figyelni kell).

---

## F. 🔒 Adatvédelem & megfelelés

- [x] ✅ **GDPR-alap**: signup-consent (auditált `user_consents`) + privacy/terms dokumentumok ([legal.ts](../../src/constants/legal.ts)).
- [x] ✅ **In-app fiók-törlés** (`softDeleteAccount`, [profile.tsx](../../src/app/profile.tsx)) — **Apple kötelező követelmény TELJESÍTVE**
  (a törlés in-app indítható; soft-delete/grace után végleges). + **adat-export** (`exportMyData`).
  - [ ] 🟡 **Teljes erasure a média-tárra (R2)**: az `auth.users` delete-cascade a DB ~95%-át viszi; az **R2-médiafájlok** végleges
    törlését is garantálni kell a GDPR-erasure-höz (ma rés).
- [ ] 👤 **Apple App Privacy** („nutrition labels"): milyen adatot gyűjt az app (fiók, tartalom, média, analitika) + célok.
- [ ] 👤 **Google Data Safety** űrlap (ugyanez Play-oldalon).
- [ ] ⚠️👤 **UGC-moderáció**: a social-feed + chat miatt a boltok **tartalom-moderációt + jelentés/blokk** funkciót várnak.
  (Owner-moderáció + remix soft-removal már van; ellenőrizni: **jelentés** + **blokkolás** + **objectionable-content kezelés** megléte.)

---

## G. 🧪 App-review gotchák (gyakori elutasítás-okok)

- [ ] 👤 **Reviewer demo-fiók**: az app **login mögött** van → az App Store/Play reviewnek **működő teszt-hitelesítő** kell
  (a review-notesban), Pro-funkciókkal (vagy sandbox-IAP).
- [ ] 🔌 **Működő backend a review alatt**: a render-worker + API **ÉLJEN**, különben a reviewer 25%-on ragadó exportot lát → elutasítás.
- [ ] ✅ **Nincs placeholder/összeomlás a fő utakon** (a Skia-reziliencia-fix után a kép-stúdió natív-modul hiányában sem omlik).
- [ ] 👤 **HIG / Material** alap-megfelelés + nincs „beta/coming soon" felirat a v1-ben.
- [ ] 👤 **Export-megosztás** jogtisztasága (a felhasználó saját médiája) — a UGC/feed-tartalomnál a jogi feltételek lefedik.

---

## H. ✅ Launch go/no-go — a minimális éles szett

A v1 akkor adható be, ha MIND teljesül:

1. 👤 Apple + Play fiók élő, egyezmények + banki/adó aláírva.
2. 📱 EAS **production** build mindkét platformra (signed .ipa/.aab), telepítve belső tesztre.
3. 🔌 **Render-worker + API + Supabase-prod + R2 ÉLŐ**, prod-env a buildben (nem dev).
4. 👤 RevenueCat prod + IAP-termékek + sandbox-teszt zöld.
5. 👤 Store-listing kész (screenshot/leírás/privacy-URL/age-rating).
6. 👤 App Privacy + Data Safety űrlapok kitöltve.
7. 👤 Reviewer demo-fiók + review-notes.
8. ⚠️👤 Monetizáció-politika tisztázva (coin/cash-out v1-ben be/ki).

---

## Függelék — a termék-oldali prod-státusz (kész, bizonyítva)

| Stúdió | Account-független prod-réteg | Hátra (device/infra) |
|--------|------------------------------|----------------------|
| **Kép** ([IMAGE-STUDIO-PROD](./IMAGE-STUDIO-PROD.md)) | ✅ parity-harness · export PNG/JPG/WebP/SVG/PDF · HEIC/EXIF · font-parity · nagy-doc gát/perf · Skia-reziliencia | PSD import/export (lib) · P2 |
| **Hang** ([AUDIO-STUDIO-PROD](./AUDIO-STUDIO-PROD.md)) | ✅ export-parity-harness (LUFS/TP/pan mérve) · +opus/minőség · i18n-parity | 📱 preview-parity + UI-k · Demucs-infra |
| **Videó** ([VIDEO-STUDIO-PROD](./VIDEO-STUDIO-PROD.md)) | ✅ render-smoke-parity · cancel · worker-health | 🔌 worker-deploy · 📱 natív-render (Android MediaCodec) |

> **A kódból elvégezhető prod-munka nagyrészt kész és bizonyított.** Ami hátra van, az **fiók + deploy + store-admin**
> (ez a fájl A–H pontjai), plusz néhány **device-build-függő** finomítás (preview-DSP, UI-k) — ezekre az Apple ID /
> Android dev fiók meglétekor térünk vissza.
