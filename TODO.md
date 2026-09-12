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
- [ ] **`/notify` + `/invite` + `/billing/activate` jogosultság** — a worker ezen
  végpontjai service_role-lal írnak (megkerülik az RLS-t), ma hitelesítés NÉLKÜL
  (dev). Prod-ban a hívó Supabase JWT-jét verifikálni kell + jogosultság: notify
  (**ki kinek küldhet**), invite (**csak a tulaj hívhat meg**), billing/activate
  (**admin/promó-only** — a valós Pro a RevenueCat webhookon jöjjön, ne ezen az
  úton). Enélkül bárki tagot vehet fel / spam-elhet / **ingyen Pro-t adhat magának**.
  A worker általános JWT-tételéhez kötve (lásd fentebb). Az `user_id_by_email` RPC
  már service_role-only. A `/billing/revenuecat` webhook már `RC_WEBHOOK_AUTH`
  fejléc-ellenőrzés mögött van. Ugyanez a `/shop/credits/grant`-ra (kredit-
  önkiosztás veszélye) — a valós top-up csak a RevenueCat consumable webhookon.
  A vásárlás (`purchase_shop_item`) már atomikus SECURITY DEFINER RPC (self-grant
  kizárva), a `user_credits`/`grant_credits` írás service_role-only.
- [ ] **Dev-override kizárása prodból** — az `entitlementStore.mockUpgrade()`
  (dev Pro-kapcsoló) NE legyen elérhető prod buildben; a Pro KIZÁRÓLAG a
  Supabase `subscriptions`-ből jöjjön (Phase 0 kész — a mock-gombokat `__DEV__`
  mögé/ki kell zárni a release-ből). A `devPro` override a `syncFromUser`-ben már
  `__DEV__`-guarded (prod buildben inert még akkor is, ha a cache-ben ott lenne),
  és `mockUpgrade` egy „fizetés" = +30 nap lejárattal (a valós IAP `setTier`-t
  hív, ami törli a dev-override-ot). Éles Pro-hoz: RevenueCat webhook →
  `subscriptions.current_period_end` (a kliens onnan szinkronizál).

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
- [ ] **Remote push (háttérben is szól)** — a HELYI push + a teljes bekötés KÉSZ
  (`expo-notifications` telepítve + plugin; engedélykérés + handler; realtime-
  érkezés → rendszer-notification; koppintás → `route` deep-link; worker Expo
  Push API-küldés `notify.js`-ben). A HÁTTÉR-push-hoz már csak: EAS **projectId**
  (`app.json` `extra.eas.projectId`) + fizikai eszközön futó **dev/prod build** —
  ekkor a `registerForPush` menti a `user_devices.push_token`-t, és a worker push-a
  kézbesül.
  ⚠️ **Expo Go korlátok (SDK 53+):** Androidon az `expo-notifications` már
  IMPORTÁLÁSKOR hibát dob (a push-token auto-regisztráció mellékhatása), ezért ott
  a modult egyáltalán nem töltjük be → **Expo Go/Androidon nincs rendszer-értesítés**
  (sem helyi, sem remote), dev build kell hozzá. iOS Expo Go-ban a HELYI értesítés
  megy (remote token nincs). Az **in-app csengő (Realtime) mindenhol működik**.
- [ ] **Titkok / env** — prod env-ek: worker `ANTHROPIC_API_KEY` (vagy lokál AI),
  Supabase kulcsok, `EXPO_PUBLIC_*`. A `.env` gitignore-olt (OK) — prod titkok a
  CI/EAS secret-store-ból.

### Fizetés
A Pro szerver-hiteles (`subscriptions` tábla, dátumos 30 napos időszakok); a
kliens onnan szinkronizál, self-grant NINCS. A teljes kód KÉSZ és tesztelt
(worker `billing.js` + `/billing/activate` + RevenueCat webhook `/billing/revenuecat`;
kliens `lib/billing.ts` + paywall valós aktiválás + „vásárlások visszaállítása").
A go-live-hoz külső fiók/build kell:
- [ ] **RevenueCat élesítés** — RevenueCat-fiók + App Store Connect / Play Console
  **előfizetési termék** (30 napos), a terméket egy „pro" **entitlementhez** kötni.
  Kulcsok env-be: `EXPO_PUBLIC_RC_IOS_KEY` / `EXPO_PUBLIC_RC_ANDROID_KEY` (kliens),
  `RC_WEBHOOK_AUTH` (worker — a webhook Authorization-fejléce). A RevenueCat
  dashboardon a webhook URL = `<CLOUD_URL>/billing/revenuecat`.
- [ ] **EAS natív build** — `react-native-purchases` natív modul; Expo Go-ban a
  vásárlás nem elérhető (a kliens dev-ben a szerver-hiteles `/billing/activate`
  útra esik vissza — 30 nap). Éles pénz csak dev/prod buildben + store-termékkel.
- [ ] **`/billing/activate` prod-védelme** — ma dev/manuális/promó út auth NÉLKÜL
  (bárki aktiválhat). Prod-ban: admin/promó-only VAGY teljesen kikapcsolva; a valós
  aktiválás KIZÁRÓLAG a RevenueCat webhookon jöjjön (lásd Biztonság: worker JWT).
- Backend + kliens flow: **KÉSZ** (deven end-to-end tesztelve — activate/renewal/
  webhook auth/EXPIRATION).

### Shop / marketplace (kredit / Facebook-Stars-modell)
A userek eladhatják a saját tartalmaikat (ma: projekt-sablon), mások kredittel
megvehetik és HASZNÁLHATJÁK. Kredit-egyenleg **szerver-hiteles** (`user_credits`,
RLS csak olvasás); vásárlás **atomikus RPC**-n (`purchase_shop_item`: levon/jóváír
+30% platform-jutalék/rögzít); payload **RLS-gate-elt** (csak eladó/vevő). Backend
+ kliens + UI **KÉSZ**, deven end-to-end tesztelt (publikálás/vétel/jutalék/gating/
kredit-top-up dev+RevenueCat consumable). Go-live:
- [ ] **Kredit-csomag IAP** — RevenueCat **consumable** termékek (`credits_100`,
  `credits_500`, `credits_1200`) a store-okban; a kliens kredit-vásárlás kösse
  ezekre (ma dev `/shop/credits/grant`). A webhook már kezeli a `credits_<n>`
  productot → jóváírás.
- [ ] **Alkotói kifizetés (payout)** — a gyűjtött kredit valós pénzre váltása
  (Stripe Connect / manuális), KYC/adó/kifizetés-megfelelőség. Ez a „creators cash
  out" rész; a `credit_transactions` napló + `payout` kind már megvan.
- [ ] **Asset-tárolás** — a nem-sablon típusokhoz (overlay/LUT/SFX/font) fájl-
  feltöltés (Supabase Storage) + előnézet (`preview_url`); ma a payload JSON
  (projekt-sablon). A `kind` mezők + UI már készek.
- [ ] **Moderáció** — jelentés/eltávolítás, tartalom-szabályzat, spam/szerzői jog
  szűrés (a piactér skálázásához).
- [ ] **`/shop/credits/grant` prod-védelme** — ma dev/manuális, auth NÉLKÜL
  (bárki adhat magának kreditet). Prod-ban admin-only / kikapcsolva; a valós
  top-up KIZÁRÓLAG a RevenueCat consumable webhookon (lásd Biztonság).

---

## 📱 SOCIAL / CSATORNA + FEED (TikTok-szerű)

Az alap **KÉSZ** és szerver-backendes (Supabase): a poszt a Project egy nézete
(`project_snapshot` → REMIX a Studióban). Táblák: `posts` + `post_likes` +
`post_saves` + `follows` (+ számláló-triggerek, `record_post_view` RPC,
`channel_stats` RPC, remix/follow → értesítés, RLS, realtime). Kliens `lib/feed.ts`
+ `/feed` (függőleges lapozó, like/save/remix/follow) + `/channel/[id]` (posztok +
követők) + alsó nav (Feed/Studio/Csatorna) + „megosztás a feedbe" a projekt-menüből.
Deven end-to-end tesztelt (publikálás/engagement-számlálók/RLS/remix/follow/stats).

- [ ] **Média-feltöltés (a valódi lejátszáshoz)** — ma a poszt metaadat +
  `project_snapshot` (a SAJÁT projekt lokálisan lejátszható/remixelhető, a
  `video_url`/`poster_url` üres → a más eszközről jött poszt borító/placeholder).
  Kell: a render + borító feltöltése Supabase Storage-ba (a „Média-fájl felhő-sync"
  tétellel közös), majd inline autoplay (`expo-video`) a feedben.
- [x] **Feed autoplay + hotspotok + promóció + statisztika** (KÉSZ) — a feed
  lapozásra autoplayel (expo-video, egy lejátszó az aktív posztra vált); az
  interaktív **hotspotok** a feedben is működnek (url/seek/quiz, idő-ablakos);
  **poszt-promóció** (reklám/kiemelés): kredit-büdzsé + nézőnkénti összeg →
  escrow (`promote_post` RPC) + nézőnkénti költés a `record_post_view`-ban +
  `promoted` flag → feed-előre + „Kiemelt" jelvény; **statisztika**: posztonkénti
  számlálók + `creator_totals` aggregátum a csatornán. Deven end-to-end tesztelt.
- [ ] **Promóció-finomítás** — lemondás/visszatérítés (a maradék büdzsé vissza),
  szüneteltetés, célzás (közönség/hashtag), a promóció-bevétel ma platform-
  sink (nincs alkotói részesedés); promotált tartalom moderációja.
- [ ] **Kommentek** — `post_comments` tábla + UI (a `src/types/social.ts` már
  modellezi: nested reply, mention, pin). Ma a komment-szám placeholder.
- [ ] **For-You ranking** — ma „legújabb"; később engagement/hasonlóság-alapú
  rangsor (SOCIAL.md M11).
- [ ] **Moderáció / report** — a `moderation_status` mező kész; kell jelentés-flow
  + admin-eszköz + tartalom-szabályzat (a skálázáshoz).
- [ ] **Chat / DM, letiltás, említések, közösségek** — a `devs/SOCIAL.md` teljes
  víziója (Identity/Social/Chat/Notifications/AI-layer).

## 📋 FUNKCIÓ-BACKLOG (roadmap-maradék — a PRO.md-ből)

Nagyobb, döntést/infrát igénylő funkciók (nem élesítés-blokkolók):

- [ ] **Média-fájl felhő-sync** — a cloud-sync (Phase 5.1) ma a projekt-TERVET
  (JSON) menti; a médiafájlokat is fel kell tölteni (Supabase Storage) + URI-
  átírás, hogy más eszközön is működjön a visszaállítás. Invazív (média-modell).
- [x] **Collaboration — tagok + szerepkörök** (KÉSZ) — projekt megosztása,
  tagok meghívása e-mailen (tulaj/szerkesztő/néző), Studio-felület (taglista +
  szerepváltás + eltávolítás + kilépés), „Megosztva velem" a főképernyőn, editor
  szerep-banner. RLS kényszeríti a szerep-alapú írást (néző nem push-olhat),
  realtime taglista, meghívó-értesítés + pending-invite konverzió signupkor.
- [ ] **Collaboration — élő együtt-szerkesztés** (Phase 5.3, következő) — presence
  (kurzor/kijelölés), timeline-komment, clip-lock, review-mode, valamint a
  megosztott projekt MÉDIA-fájljainak szinkronja (ma csak a projekt-JSON megy a
  felhőbe → a más eszközön megnyitott megosztott projekt médiája hiányozhat, lásd
  „Média-fájl felhő-sync"). A jelenlegi modell: last-write-wins megosztott
  dokumentum (nem valós idejű CRDT). Az editor mély read-only lezárása nézőknek
  (ma: RLS blokk + banner; a lokális szerkesztést nem tiltjuk).
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
Értesítés-rendszer (realtime + deep-link + self-insert; csengő+badge+lista;
expo-notifications helyi push + koppintás-navigáció; worker `POST /notify`
service_role-lal cross-user + Expo Push — deven end-to-end tesztelve) ·
Kollaboráció (tagok + szerepkörök: tulaj/szerkesztő/néző; meghívás e-mailen a
worker `/invite`-ján; Studio-felület; RLS szerep-alapú írással; realtime taglista;
pending-invite konverzió signupkor — RLS/invite deven end-to-end tesztelve).
