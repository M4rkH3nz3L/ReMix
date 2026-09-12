# ReMix — TODO (kimaradt tételek + élesítés-checklist)

> Ez a **gyűjtő**: ide kerül minden hátralévő / kimaradt tétel, kiemelten az
> **élesítéshez (production) kötelező** dolgok. A `PRO.md` a *funkció-roadmap*
> (mi épült, mi jön); ez a `TODO.md` a *hátralévő munka + go-live checklist*.
>
> Jelölés: `[ ]` nyitott · `[~]` részben megvan · `[x]` kész. Frissítsd, ahogy
> haladunk!

---

## 🚨 ÉLESÍTÉS-KRITIKUS (production blockers)

Ezek nélkül **nem szabad élesíteni** — biztonság, fizetés, infra.

### Biztonság
- [ ] **Worker JWT-verifikáció** — a render/AI-worker (`server/index.js`) MA
  nem ellenőriz tokent, a `Access-Control-Allow-Origin: *` (index.js:55) miatt a
  fizetős végpontok **bárkinek** mennek. Prod-ban: a kliens küldje a Supabase
  JWT-t, a worker verifikálja (+ Pro-ellenőrzés a `subscriptions`-ből), és CORS-
  allowlist a saját domain(ek)re.
- [ ] **BYOK SSRF-védelem** — a worker a felhasználó `baseUrl`-jére POST-ol
  (`server/ai.js` `runOpenAICompatible`, lásd a kód SSRF-megjegyzését). Prod-ban
  **provider-allowlist** (csak ismert AI-hosztok), vagy belső-IP tiltás.
- [ ] **Dev-override kizárása prodból** — az `entitlementStore.mockUpgrade()`
  (dev Pro-kapcsoló) NE legyen elérhető prod buildben; a Pro KIZÁRÓLAG a
  Supabase `subscriptions`-ből jöjjön (Phase 0 kész — a mock-gombokat `__DEV__`
  mögé/ki kell zárni a release-ből).

### Infra
- [ ] **Supabase PROD instance** — ma LOKÁLIS dev fut (+100 port, API 54421). Kell:
  hosztolt Supabase projekt, a migrációk alkalmazva (`supabase/migrations/`:
  profiles/devices/ai_providers/ai_task_providers/**subscriptions**/**cloud_projects**/**notifications**),
  és a prod `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`.
- [ ] **Cloud worker hosztolás** — `EXPO_PUBLIC_CLOUD_URL` a hosztolt render/AI-
  workerre (ma dev-fallback a Metró gépére). ffmpeg + Whisper + (opcionális)
  Ollama/Anthropic a szerveren; sorkezelés/skálázás, tárhely (S3).
- [ ] **Natív render build (EAS)** — a helyi export natív modult igényel
  (`isNativeRenderAvailable`; Expo Go-ban `LocalRenderUnavailableError`). Kell
  EAS dev/prod build a device-render-hez.
- [ ] **Push-értesítések (expo-notifications)** — a realtime+deeplink alap KÉSZ
  (`notifications` tábla + realtime + `NotificationBell` + `route`-nav). A push-hoz
  kell: `npx expo install expo-notifications`, EAS **projectId** (`app.json`
  `extra.eas.projectId`), natív build (Expo Go nem küld push-t iOS-en), a device
  Expo-push-token mentése (`user_devices.push_token` **oszlop kész**), és a worker
  küldje az Expo Push API-ra. A deep-link már működik: a `route` mezőre navigál a
  `NotificationBell` (kliens) — a push-payloadba is ugyanez a `route` kerül.
- [ ] **Kereszt-user `/notify` (worker, service_role)** — a self-insert (saját
  értesítés) KÉSZ (RLS `insert_own`, kliens `createNotification`). MÁS usernek
  küldeni (collab: komment/meghívó/mention) **service_role**-t igényel, ami
  megkerüli az RLS-t → worker `POST /notify` (JWT-verifikáció mögött, lásd
  Biztonság) írja a `notifications` sorba + trigger push-t. Ez a **team-working**
  alap-csatornája.
- [ ] **Titkok / env** — prod env-ek: worker `ANTHROPIC_API_KEY` (vagy lokál AI),
  Supabase kulcsok, `EXPO_PUBLIC_*`. A `.env` gitignore-olt (OK) — prod titkok a
  CI/EAS secret-store-ból.

### Fizetés
- [ ] **Billing (RevenueCat)** — valós Pro-bevételhez (Phase 6). Store-termékek
  (App Store / Play), `react-native-purchases` SDK, sikeres vásárlás →
  `entitlement.setTier('pro', proUntil)`, webhook → `subscriptions` tábla
  (`source:'revenuecat'`). **A Phase 0 backend erre kész**; store-setup + eszköz-
  teszt kell hozzá.

---

## 📋 FUNKCIÓ-BACKLOG (roadmap-maradék — a PRO.md-ből)

Nagyobb, döntést/infrát igénylő funkciók (nem élesítés-blokkolók):

- [ ] **Média-fájl felhő-sync** — a cloud-sync (Phase 5.1) ma a projekt-TERVET
  (JSON) menti; a médiafájlokat is fel kell tölteni (Supabase Storage) + URI-
  átírás, hogy más eszközön is működjön a visszaállítás. Invazív (média-modell).
- [ ] **Collaboration** (Phase 5.3) — presence (kurzor/kijelölés), timeline-
  komment, clip-lock, review-mode. Realtime-infra (Supabase Realtime) + cloud-sync.
- [ ] **Cloud media-library** (Phase 5.4) — mappák/tagek/kereshető könyvtár;
  metaadat on-device ingyen, cloud-tárolt média Pro.
- [ ] **Kereszt-user Remix Graph** (Phase 5.5, felhő) — a helyi származási lánc
  (kész) kiterjesztése más felhasználók remixeire (cloud-lekérdezés).
- [ ] **Valódi hang-ML diarization** — a heurisztikus beszélő-címkék (kész) helyett
  igazi diarizáció (pyannote a workeren). Nehéz Python-setup.
- [ ] **AI B-roll valódi elhelyezés** — a helykereső (kész) csak megmutatja, HOVÁ;
  a következő lépés a kiválasztott saját felvétel automatikus overlay-elhelyezése
  a szünetekbe (batch, undo-zható).
- [ ] **4.5 A/B variánsok** (Pro+) — a projekt duplikálása eltérő hookkal/
  nyitással teszteléshez (a Remix Graph a lineage-t már mutatná). Marginális a
  meglévő hook-generátor + auto-edit mellett.
- [ ] **1.6 Emotion / reakció-becslés** (opcionális) — reakció-kiemelés az analízisben.

---

## 🎨 RENDER-COUPLED FINOMSÁGOK (dupla impl. + futásidejű teszt)

Ezek a **preview↔render paritás** miatt kliens ELŐnézetben ÉS `server/render.js`
kifejezés-építőben is kellenek; a vizuális helyesség itt nem, csak **futásidőben**
(EAS build + valós render) ellenőrizhető. On-device → INGYEN.

- [ ] Speed: **freeze frame + reverse**.
- [ ] Szín: **görbék / RGB / HSL / color wheels / scope-ok** (histogram, waveform,
  vectorscope, RGB parade) · **LUT-import** (ma csak preset).
- [ ] Keyframe: **rotáció + opacity** csatorna (ma szándékosan kizárva, lásd
  `keyframes.ts`) + **graph editor** (bezier-UI).
- [ ] Effekt: **effekt-lánc** (több effekt/klip) · **transition-easing**
  (ffmpeg `xfade`-nél `custom:expr` kell — típusonként bonyolult).
- [ ] Transform: **anchor-point · crop · 2D skew**.
- [ ] Audio UI: **EQ · kompresszor · limiter · pan** (ma render-oldali flag mögött)
  · **normalizálás · hum-removal**.
- [ ] Réteg: **GIF-klip típus** (animált GIF preview + render).
- [ ] **Proxy / performance engine** (proxy-generálás, háttér-feldolgozás,
  render-cache) — nagy device-oldali nyereség.

---

## ✅ KÉSZ (referencia — részletek a PRO.md-ben)

Phase 0 (per-user Pro előfizetés) · Phase 1 (Story · Pacing · filler/ismétlés ·
minőség · diarization-címkék) · Phase 2 (semantic select · találat-kiemelés ·
objektum-index) · Phase 3 (engaging · parancs-whitelist · rough-cut→shorts) ·
Phase 4 (social variants · feliratfordítás · dub · export-codecek · zene-illesztés ·
B-roll helykereső) · Phase 5 (helyi verziózás · cloud-sync alap · Remix Graph) ·
Free/on-device (színes markerek · timeline-régiók · állítható snapping) ·
Értesítés-rendszer alap (realtime + deep-link + self-insert; csengő+badge+lista).
