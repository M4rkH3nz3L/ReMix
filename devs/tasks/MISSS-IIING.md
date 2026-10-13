# 🧩 MISSS-IIING — a VALÓS hátralék (kóddal egyeztetve)

> **Mi ez:** a külső (markdown-only) hátralék-jelentés **kódhoz igazított** változata. A reviewer csak a
> dokumentumokat látta, a legutóbbi kód-munkát nem → több „nyitott" tétel **valójában kész**. Ez a fájl a
> **tényleges maradékot** sorolja (javítási TODO), státusz-tagekkel és forrás-fájlokkal.
> Párok: [TECH-TOP.md](./TECH-TOP.md) · [PROD.md](./PROD.md) · [SCOPES.md](./SCOPES.md) · [00-README.md](./00-README.md).
> **Tag:** ✅ kész · 🟡 mag kész / UI-render hátra · 🔌 deploy/infra · 👤 fiók/konzol · 📱 device/natív · ⬜ nyitott.

---

## 0. ⚠️ Korrekciók a külső audithoz (ezek NEM nyitottak)

A kóddal ellenőrizve az alábbiak **készek** (a markdown-only review tévesen vagy elavultan jelölte):

- ✅ **Editor-core 100%** — [CORE.md](./CORE.md) 10/10, audit-zöld (a „2 nyitott" egy régi index-pillanatkép).
- ✅ **Android eszközön-render-motor A–E TELJES + BEKÖTVE** — [NATIVE.md](./NATIVE.md) (10 emulátor-teszt) +
  [src/lib/nativeRender.ts](../../src/lib/nativeRender.ts) (`isNativeRenderAvailable`/`renderLocal`, használva a `render.ts`-ben).
  A régi „triviális copy / #1 hiány" **elavult**. Hátra csak: D-foreground-service valós eszközön + a free-vízjel ráégetése.
- ✅ **Entitlement-/csomag-réteg** (5 tier: Free/Amatőr/Haladó/Profi/Céges) — `ENTITLEMENTS` + routing + **szerver-enforce**
  ([entitlements.ts](../../src/lib/entitlements.ts), [server/entitlements.js], [server/tiers.js], usage-metering, contract-tesztelt).
  🐞 Közben javítva: `isPro` kizárta a Profi/Céges usert a worker-ből.
- ✅ **Kép-free-vízjel** élő-verifikált ([server/imagedoc.js] szerver-hiteles tier).
- ✅ **Content-típus publish-célok** (`targetsForKind`: videó→TikTok/IG/YT/FB · kép→FB/Pinterest · hang→SoundCloud/Spotify).
- ✅ **Tartalom-tulajdon ToS** (anti-CapCut + vízjel-kivétel) — [legal.ts](../../src/constants/legal.ts) + teszt.
- ✅ **Collab-gate** (Amatőr+) + owner=Admin + Céges-gate + `/invite` enforce ([collabAccess.ts](../../src/lib/collabAccess.ts)).
- ✅ **Tárhely-védelem + coin-recurring számítás** ([storageProtection.ts](../../src/lib/storageProtection.ts)).
- ✅ **Kép-galéria/diavetítés mag** ([slideshow.ts]) · **hang-album mag** ([album.ts]) · **import-range** ([importRange.ts]) ·
  **videó 10 perc-cap** (hard-gate + contract).
- ✅ **Export-parity harness-ek**: videó (render-smoke), kép (imagedoc-smoke), hang (audio-smoke, LUFS/TP mérés).
- ✅ **UGC-moderáció**: jelentés + **blokk** bekötve a feedbe/kommentbe.
- ✅ **Deploy-IaC** kész (nem futtatva): [server/Dockerfile], [docker-compose.yml], [Caddyfile], [DEPLOY.md].
- ℹ️ A `devs/tasks/remix/` security-backlog **nincs a main-ben** (git-history) — ne hivatkozz rá nyitott forrásként.

---

## 1. 🔌 Production / Go-Live — a #1 kiadás-blokkoló (IaC kész, futtatni kell)
- [ ] 🔌 **Render-worker + API deploy** (a stack kész: compose+Caddy) → Hetzner/Docker-host. [PROD.md](./PROD.md), [DEPLOY.md](../../server/DEPLOY.md)
- [ ] 🔌 **Supabase prod**: jelszó-rotáció + **dev/prod szétválasztás** (ma a dev a prod DB-re ír) + SMTP.
- [ ] 🔌 **Secretek prod-vault** (Anthropic/RC/Supabase-service-role/R2/PayPal/LiveKit) + **R2 prod bucket**.
- [ ] 🔌 **Megfigyelhetőség** (health/log/alert) + **teljes feltöltés→render→publish próba** éles ellen.
- [ ] 🔌 **GDPR hard-erase auto-finalizáló cron** (a `/account/erase` + R2-purge kész; a cooldown utáni futtatás hiányzik).

## 2. 👤📱 iOS / Android kiadás
- [ ] 👤 **Apple Developer + Google Play** fiók + egyezmények + banki/adó. [PROD.md §A]
- [ ] 📱👤 **EAS production build** (iOS univerzális `.ipa` + Android `.aab`, signed) + submit.
- [ ] 👤🔌 **Push (APNs/FCM)** kulcsok · **store-listing** (eszköz-osztályonkénti screenshot) · **App Privacy / Data Safety**.
- [ ] 📱 **4 form-faktor valós-eszköz teszt** (iPhone/iPad/Android telefon+tablet).

## 3. 💳 Monetizáció — maradék (a gate-réteg kész)
- [ ] 👤 **RevenueCat prod** + IAP-termékek mindkét boltban + sandbox-teszt.
- [ ] 🟡 **Coin→recurring extra** (tárhely/AI) **billing-bekötés** (a számítás-mag kész [storageProtection]).
- [ ] 🟡 **Tárhely-adatvesztés-banner UI** (a logika kész).
- [ ] ⚠️👤 **Coin/cash-out/marketplace store-politika** (jogi gate — a cash-out v1-ben kimaradhat).

## 4. 🏷️ Free mód & vízjel — maradék (kép kész, motor kész)
- [ ] 📱 **Free videó/hang-vízjel**: a „Made with ReMix" ráégetése a **natív render-motor** kimenetére ([nativeRender.ts]/modul)
  + hang-tag; a mechanizmus a képnél bizonyított, a motor létezik → csak bekötés + emulátor-verifikáció.
- [ ] 🟡 **Free render/tár kliens-routing**: a free kötelezően eszközön renderel/tárol (a szerver-enforce kész; a kliens-routing + paywall-UX hátra).

## 5. 🎬 Video Studio — maradék ([VIDEO-STUDIO-PROD](./VIDEO-STUDIO-PROD.md))
- [ ] 🟡 preview↔export finom-egyezés (élő worker+ffmpeg verifikáció) · GIF-export · cache-korlát · fejlett szerkesztő-funkciók farka.

## 6. 🖼️ Image Studio — maradék ([IMAGE-STUDIO-PROD](./IMAGE-STUDIO-PROD.md))
- [ ] 🟡 **Galéria-UI + diavetítés-render + lapozható feed-poszt** (a [slideshow] mag kész).
- [ ] 🔌 **PSD-import** + **PDF/PSD-export** (PDF-export már kész) · P2 vektor-finomságok (boolean-divide, align-selected, toll v5).

## 7. 🎧 Audio Studio — maradék ([AUDIO-STUDIO-PROD](./AUDIO-STUDIO-PROD.md))
- [ ] 🟡 **Album-UI + borító (kép-szerkesztővel) + lapozható album-share** (az [album] mag kész).
- [ ] 📱 **preview↔export DSP-parity** (per-klip fx + master élőben vagy proxy) — device-verify.
- [ ] 🔌 **Stem-szeparáció (Demucs)** külön worker-image · export-minőség-UI (a szerver-formátum kész, +opus).

## 8. 📡 Social & publikálás — maradék
- [x] ✅ jelentés + blokk (moderáció-alap) · content-típus publish-célok.
- [ ] ⬜ **moderáció-mélység** (owner/globál már van; objectionable-content szűrés) · **keresés** · **ajánlórendszer** ·
  **transzkódolás** (feed-feltöltés) · **per-platform OAuth + feltöltés-wiring** (Pinterest/SoundCloud/Spotify/… — a specek készek).

## 9. 🤝 Collaboration — maradék (gate kész)
- [ ] ⬜ **klip-zárolás** · **review-folyamat** · **finom jogosultságok UI** · **konfliktus-feloldás** · **Céges szervezet-modell** (org + dolgozók, a gate kész).

## 10. 💾 Storage & assetek — maradék (kvóta+R2+védelem kész)
- [ ] ⬜ **offline működés** · **provider-újracsatlakozás** (Drive/Dropbox/WebDAV OAuth go-live) · **hash-alapú szinkron**.

## 11. 🎨 UI/UX & hozzáférhetőség — nagyrészt nyitott (device/UI)
- [ ] 🟡📱 **Behúzható drawer** (érintő: bal=beállítás, jobb=eszközök; telefon=swipe, tablet/iPad=dokkolt) + **editor-declutter**.
- [ ] 🟡📱 **Profil tab-okra** (adatok / tárca / AI-agentek / tartalmak / beállítások).
- [ ] ⬜ design-rendszer egységesítés · akadálymentesség (a11y) · tablet-elrendezés finomhangolás.

## 12. ⚡ Performance & kódminőség — folyamatos
- [ ] ⬜ aszinkron hibakezelés/retry audit · cache-korlátok · render-teljesítmény mérés/optimalizáció.

## 13. 🧠 AI Creator OS — maradék (magok készek)
- [ ] ⬜ kontextus/memória-bekötés · **szemantikus keresés** · specialista-AI-k (writer/producer/…) UI · **model-registry**.

## 14. 📚 Dokumentáció & natív bővítés — maradék
- [x] ✅ **kontraktus-tesztek bővítve** (tiers/entitlements/fonts/max-duration/effektek/usage — contract-lockolt).
- [ ] ⬜ architektúra-ábrák · **költség-dashboard** · ONNX/Skia finomítás · desktop/platform-bővítés.

---

## Javasolt sorrend (a reviewerével egyezik, a valós állapottal frissítve)
1. **🔌 Production go-live kapu** (deploy — az IaC kész) + **👤 store-fiókok/build**.
2. **📱 Free videó/hang-vízjel a natív motoron** + a free render/tár kliens-routing (a motor + a kép-vízjel kész).
3. **🟡 A 3 stúdió maradék UI/export-bekötése** (galéria-UI, album-UI, audio-fx-UI, GIF).
4. **📡🤝💾 Social/collab/storage** hátralék (moderáció-mélység, keresés, klip-zárolás, offline/szinkron).
5. **🧠 AI Creator OS** + **🎨 UI-drawer/a11y** + **📚 docs/native** — a végére.

> **Olvasat:** a **pure policy-/gate-/feature-mag réteg + az editor-core + a natív render-motor KÉSZ és tesztelt** —
> a valós hátralék túlnyomórészt **deploy/infra (go-live), store-fiók/build, és UI/render-bekötés**, nem alap-logika.
