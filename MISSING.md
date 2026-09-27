# MISSING.md — Lemaradt / nyitott fejlesztések

> Az `.md` dokumentációkból (AUDITBUGS · TODO · DEV-PLAN · DESIGN-TODO · PRO · STUDIO · PROD · DEVOPS · OPS · MONEY · Arch · README · `devs/*`) összegyűjtött **nyitott / nem-kész** tételek, prioritás szerint. Forrás-hivatkozás `fájl:sor`.
> **Fontos:** több forrás-md régebbi állapotot tükröz — az ebben a munkamenetben már megvalósított dolgokat lásd a **[Már kész](#-már-kész-ne-listázd-hiányként)** szakaszban; azok NEM hiányok.

---

## 🧭 Fő vonal (vezérelv)

**A DEV és a PROD UGYANAZ a kódbázis. A prod NEM külön fejlesztés/újraírás — hanem ÁTKONFIGURÁLÁS:** env-váltás (lokális → hosztolt Supabase/worker), `__DEV__`/env-kapuk (a dev-only dolgok kimaradnak a prod buildből), és a hosztolt célok bekötése. Ebből következik:

- **Minden ÚJ fejlesztés config-vezérelt legyen** — dev ÉS prod UGYANAZZAL a kóddal fusson, env-ből paraméterezve. Semmi hardcode-olt dev-cím/kulcs, semmi külön „prod-ág" a kódban.
- **Minden dev-only segéd `__DEV__`/env mögé** kerüljön (dev-Pro kapcsoló, dev-billing, dev-kredit, tunnel-szkriptek), hogy prodban egyszerűen ne is létezzen.
- **A prod = az env-mátrix „prod" oszlopa + a hosztolt szolgáltatások.** A go-live tehát egy **kapcsoló átbillentése + a cél előállítása**, nem kód-átírás.

Ezt a szemléletet a lenti 0. szekció bontja feladatokra; a többi (1–11) fejlesztésnél is ez a szabály (config-vezérelt, dev↔prod ugyanaz a kód).

---

## 📊 Státusz — jelmagyarázat & összegzés

**Jelölés:** `- [x]` = **KÉSZ** (implementált/ellenőrzött) · `- [ ]` = **NINCS KÉSZ** (nyitott). A lenti **✅ Már kész** szakasz sorolja a kész funkciókat (több forrás-md ezeket még TODO-ként listázza — azok NEM hiányok). A szekció-fejlécek: 🔴 kritikus-nyitott · 🟠/🟡 részben · 🟢/🔵 backlog.

**Nagy kép:**
- ✅ **KÉSZ:** közösségi mag (chat/DM/**csoport**, collab presence + parancs-szinkron + **kurzorok** + resync, collab-chat + gépel-jelző), feed realtime **komment** + **dupla-tap like**, social **értesítések**, **login** e-mail/username/telefon, **teljes 0.A flip-ready réteg** (config-guardok + env-mátrix + capability-`/health` + worker Pro-kapu). → lásd *✅ Már kész*.
- 🟡 **RÉSZBEN:** **2. collab** (mag kész, bővítés nyitva) · **3. social** (chat/feed mag kész, bővítés nyitva).
- 🔴 **NINCS:** **0.B** go-live cél-oldal (hosztolás/EAS/RevenueCat) · **1.** szint-rendszer/monetizáció · **4–11.** feature / perf / kódminőség / dizájn / doku.

> **0.A = KÉSZ (6/6).** A kód flip-ready: a go-live már tisztán **0.B** (hosztolt Supabase/worker + EAS build + RevenueCat) + az env-mátrix „prod" oszlopának kitöltése — nulla kód-átírás.

---

## 🔴 0. DEV → PROD: átkonfigurálhatóság (nem újraírás)

### 0.A — A kód legyen „flip-ready" (egy env-váltás elég legyen)
- [x] **Minden backend-cím kizárólag env-ből** — `renderServerUrl`/`cloudBaseUrl` a teljes-URL override-ot preferálja, `supabase.ts` env-ből, `reachableMediaUrl` az env-origin szerint. **Kész + tesztelt** (`lib/envConfig.ts` + `envConfig.test.ts`, `00244c2`).
- [x] **Loopback/LAN tiltása prodban** — nem-`__DEV__` buildben a loopback cím → „nincs konfigurálva" (Supabase) / titkosítatlan-worker-tiltás (`assertSecureUrl`). **Kész + tesztelt + hardened** (https+loopback is tiltott), közös `lib/envConfig.ts` (`00244c2`).
- [x] **Dev-only funkciók `__DEV__`/env-kapu mögé** — dev-Pro kapcsoló `{__DEV__ ? …}` (`profile.tsx:711`), `ALLOW_DEV_BILLING` mögött a `/billing/activate` · `/shop/credits/grant` · `/billing/deactivate` (`server/index.js` `devBillingGuard`). **Ellenőrizve (megvolt).** A `dev-tunnel*.sh` + `.env.development.local` dev-tooling (nincs a bundle-ben).
- [x] **Egyetlen env-mátrix dev↔prod** — a kliens mind a **7** olvasott `EXPO_PUBLIC_*` kulcsa dokumentált a `.env.example` / `.env.development.example` / `.env.production.example`-ben; a worker **minden** olvasott env-kulcsa a `server/.env.example`-ben (a hiányzó AI-szolgáltató + modell/bináris knob-ok — `ANTHROPIC_API_KEY`, `AI_MODEL`, `OLLAMA_URL`, `LOCAL_*_MODEL`, `FFMPEG_PATH`, `WHISPER_MODEL`, `CHROMIUM_PATH` — most pótolva). **Kész + verifikálva** (grep-diff: 0 hiányzó kulcs).
- [x] **Capability-/feature-kapuk env/tier-vezéreltek** (ne kód-ág) — a worker capability-jei modell-/kulcs-/queue-jelenlétből (nem hardcode-ág), és a `GET /health` MIND tükrözi: `captions`(whisper) `ai`+`aiProvider` `vision` `depth` `bgremove` `faces` `upscale` `tts` `youtube` `notify` `billing` `revenuecat`(`RC_WEBHOOK_AUTH`) `render`(queue+s3→`cloud+local`|`local`). **Kész.** A nevesített *tier*-finomítás → 1. szakasz.
- [x] **Worker Pro-kapu a FIZETŐS capability-végpontokon** — a `requirePro` middleware (`server/index.js`) a `subscriptions` táblából ellenőriz (`isPro(uid)`): nem-Pro → **402**; `INSECURE_DEV` bypassal dev-en. A `proOnly = [requireAuth, requirePro]` a fizetős végpontokra kötve (/youtube, /tts, /faces, /sky, /upscale, /ai/translate, /ai/highlights, /ai/story, /bgremove …). **Kész + tesztelt** (`server/billing.test.js` `isPro` 12/12). *(Az AUDITBUGS:264-267 jegyzet elavult — ez már megvolt.)*

### 0.B — A PROD cél előállítása (amire a kapcsoló mutat)
- [ ] **Hosztolt Supabase** + migrációk (`supabase db push`) — a `EXPO_PUBLIC_SUPABASE_URL` erre vált át. `TODO.md:46-49`, `DEVOPS.md:168`
- [ ] **Hosztolt worker** — `Dockerfile` (FFmpeg + whisper.cpp + Chromium + ONNX) + deploy (VPS/Fly) + post-deploy smoke-teszt; a `EXPO_PUBLIC_SERVER_URL`/`CLOUD_URL` erre vált át. `TODO.md:50-52`, `DEVOPS.md:169-173`
- [ ] **EAS `projectId` + prod env** (Supabase/RevenueCat/CLOUD_URL az EAS Environment Variables-ben) + **EAS natív build** (IAP/push/eszköz-render — Expo Go-ban nem tesztelhető). `AUDITBUGS.md:194-195`, `TODO.md:83-85`, `PROD.md:176-178`
- [ ] **RevenueCat prod** — App Store/Play előfizetési termékek + webhook URL (a `billing.js`-hez). `TODO.md:78-82`
- [ ] **Prod titok-kezelés** — `expo-secure-store` (refresh-token, BYOK-kulcsok) + kényszerített HTTPS; dev-en AsyncStorage elég, prodban secure-store (env/`__DEV__` szerint választva). `AUDITBUGS.md:257-262`
- [ ] **Remote push** — EAS projectId + fizikai build + `user_devices.push_token` regisztráció. `TODO.md:56-67`
- [ ] **Worker prod titkok** — `ANTHROPIC_API_KEY`, Supabase service-role, RevenueCat webhook-secret (env). `TODO.md:68-70`, `server/.env.example`

> 🎯 **Cél:** `bash scripts/dev-up.sh` (lokál) és a prod-deploy **UGYANAZT a kódot** futtatja, csak más env-vel. A „go-live checklist" = (1) a 0.A kapuk megléte, (2) a 0.B célok felállítása, (3) az env-mátrix „prod" oszlopának kitöltése. Semmi kód-újraírás.

---

## 🟠 1. Monetizáció & szint-rendszer

> **Config-vezérelt** (fő vonal): a tier + capability env/tier-alapú, nem kód-ág; a dev-grant (`dev_set_tier`/`mockUpgrade`) `__DEV__` mögött — prodban a Pro/tier KIZÁRÓLAG a `subscriptions` táblából (server-authoritative).

- [ ] **Tier-rendszer** `free | basic | pro | ultra` — `subscriptions.tier` enum-bővítés, capability→`minTier` (nem csak boolean `pro`). `MONEY.md:8.1-8.5`, `DEVOPS.md:246-250`
- [ ] **`usage_counters` tábla** — AI-kredit / render-perc / tárhely-GB per user/hó + **metering-middleware** (szint + kvóta → 402/429) minden fizetős végpont előtt. `DEVOPS.md:65,79`, `MONEY.md:8.3`
- [ ] **`pg_cron`** — havi kvóta-reset + lejárt Pro-k takarítása. `DEVOPS.md:66`
- [ ] **Csomagok**: Basic ($4.99) és Ultra ($29.99) kvóták/entitlementek; RevenueCat 3 termék × havi/éves. `MONEY.md:4`, `DEVOPS.md:56`
- [ ] **AI-kredit top-up (overage)** + **kredit-csomag IAP** (`credits_100/500/1200` consumable). `MONEY.md:6.2`, `TODO.md:99-102`
- [ ] **BullMQ priority-lane** — queue-prioritás szint szerint (Ultra > Pro > Basic). `DEVOPS.md:76`
- [ ] **Shop-bővítés**: nem-sablon típusokhoz **asset-feltöltés** (Storage) + előnézet; **moderáció** (report/eltávolítás/spam/szerzői jog). `TODO.md:106-110`
- [ ] **Alkotói payout** — kredit → valós pénz (Stripe Connect / manuális), KYC/adó. `TODO.md:103-105`
- [ ] **Promó-/ajándékkódok** (influencer) a meglévő `billing/activate` promó-úton. `MONEY.md:6.3`
- [ ] **Rate-limit / anti-abuse** (IP/user szint) — a metering egyben abúzus-fék. `DEVOPS.md:210`

> ℹ️ A per-user előfizetés magja (subscriptions tábla + sync + worker `billing.js` + webhook) a korábbi munka szerint **részben kész** — a `PRO.md` Phase 0 még nyitottként listázza, **ellenőrizni kell** a valós állapotot. `PRO.md:113-138`

---

## 🟡 2. Realtime collab — bővítés (a mag már kész)

- [ ] **Clip-lock** (más által épp szerkesztett klip zárolása). `TODO.md:163-169`, `PRO.md:208-209`
- [ ] **Timeline inline-komment** (idővonalra tűzött megjegyzés). `TODO.md:163-169`
- [ ] **Review-mode** (jóváhagyó / megjegyzés-mód). `PRO.md:208-209`
- [ ] **Megosztott projekt MÉDIA-szinkronja** (ma csak a projekt-JSON megy felhőbe, a médiafájlok nem). `TODO.md:155-157, 163-169`
- [ ] **Konfliktus-kezelés** — jelenleg last-write-wins; CRDT/OT a valódi egyidejű szerkesztéshez. `full-plan.md:157`
- [ ] **Jogosultság-szintek finomítása** (OWNER/EDITOR/COMMENTER/VIEWER). `SOCIAL.md:13`

---

## 🟡 3. Social / közösség — bővítés (feed + chat mag már kész)

- [ ] **Block / mute / restrict** + **@említések** + **közösségek/csoportok** (a SOCIAL.md teljes víziója). `TODO.md:148-149`, `SOCIAL.md`
- [ ] **Admin / Moderation UI** — report-flow + admin-eszközök (mute/block/restrict/eltávolítás). `SOCIAL.md:20-21`, `TODO.md:146-147`
- [ ] **For-You ranking v2** — engagement / watch-history / interest / trending (ma „legújabb" + following). `full-plan.md:146`, `TODO.md:144-145`
- [ ] **Collections / Library** — liked/saved + mappák; creator-követési szintek (All/Personalized/None). `full-plan.md:148`
- [ ] **Search v1 (teljes)** — user / videó / sablon / hashtag + hashtag-oldalak (alap-kereső van). `full-plan.md:126`
- [ ] **Template marketplace + remix-lánc követés** (kereszt-user Remix Graph). `SOCIAL.md:13`, `TODO.md:172-173`
- [ ] **Feed média-feltöltés** — render + borító Supabase Storage-ba (ma metaadat + snapshot). `TODO.md:127-131`
- [ ] **Multi-platform publishing** — TikTok/IG/YT/FB arány/cím/hashtag/**ütemezés**. `ReMix.md:135`
- [ ] **Promóció-finomítás** — lemondás/visszatérítés, szüneteltetés, célzás. `TODO.md:139-141`
- [ ] **Creator Studio** — tartalom-kezelés + analytics. `SOCIAL.md:6`

---

## 🟡 4. AI-réteg — mélyítés (alap sok helyen már van)

- [ ] **AI Context Builder** — rétegzett (Global/Relevant/Current) AI-olvasható projekt-reprezentáció a teljes JSON helyett. `AI-INTEGRATIONS.md:2`, `full-plan.md (F3)`
- [ ] **Szemantikus index / knowledge graph** — transcript + jelenet-váltás + klip-címkék; esemény→asset→időpont. `AI-INTEGRATIONS.md:4`
- [ ] **AI-memória 4 szinten** — project-state / semantic / intent / beszélgetés-döntések. `AI-INTEGRATIONS.md:3`
- [ ] **PRO AI Phase 1 — Understand**: Story Engine · Pacing · filler-word · **speaker diarization** (valódi, pl. pyannote) · minőség-detektorok · (emotion opcionális). `PRO.md:151-163`, `TODO.md:174-175`
- [ ] **PRO AI Phase 2 — Select**: semantic-select parancs · match-highlight · objektum-keresés (vision-index). `PRO.md:169-173`
- [ ] **PRO AI Phase 3 — Edit**: „make this more engaging" · parancs-whitelist bővítés · rough-cut → shorts. `PRO.md:177-185`
- [ ] **PRO AI Phase 4 — Publish**: social-variants · caption-fordítás/lokalizáció · **dubbing (TTS)** · zene/B-roll AI · A/B variánsok. `PRO.md:189-197`, `TODO.md:176-181`
- [ ] **Cloud-TTS** (prod) — a macOS `say` csak dev; kell felhő-TTS. `WORKER.md:5`, `OPS.md:25`
- [ ] **On-device AI runtime** — ORT Mobile + whisper.cpp; szöveges AI mobilon (kis modell vs szerver vs hibrid — döntés). `VidEd.md:201,245`
- [ ] **Modell-terjesztés** — 405 MB modell nem az app-ba égetve; igény szerinti letöltés + cache. `VidEd.md:270`, `OPS.md:59`
- [ ] **További AI-profilok** — Director / Music / Color / Social AI. `full-plan.md:99`

> ℹ️ A Kép-AI (háttér/ég/upscale/arc), AI Auto-Edit, objektum-követés, auto-felirat a `STUDIO.md` szerint PRO-funkcióként **léteznek** — a fentiek ezek finomítás-/mélyítés-tervei, nem nulláról.

---

## 🟡 5. Szerkesztő — hiányzó FREE on-device funkciók (dupla impl.: preview + `server/render.js`)

- [ ] **Keyframe**: rotáció + opacity csatorna + **Graph Editor (Bézier)** (ma render-kizárt). `DEV-PLAN.md:195-196`, `PRO.md:242-243`
- [ ] **Szín**: görbék / RGB / HSL / color wheels (3-way) / **szkópok** + **LUT-import** (ma csak preset). `DEV-PLAN.md:193-194`, `PRO.md:244-245`
- [ ] **Speed**: freeze-frame + reverse. `DEV-PLAN.md:192`, `PRO.md:246`
- [ ] **Maszk**: animált maszk-geometria + expand/shrink. `PRO.md:247`
- [ ] **Effekt**: effekt-lánc (több effekt/klip) + transition-easing. `DEV-PLAN.md:197-198`, `PRO.md:248`
- [ ] **Transform**: anchor-point · crop · 2D skew. `DEV-PLAN.md:199`, `PRO.md:249`
- [ ] **Audio UI**: EQ · kompresszor · limiter · pan · normalizálás · hum-removal (render-oldali flag van, UI nincs). `DEV-PLAN.md:200-201`, `PRO.md:250-251`
- [ ] **Réteg**: GIF-klip típus (animált preview + render). `DEV-PLAN.md:202`, `PRO.md:252`
- [ ] **Proxy / performance engine**: proxy-generálás · háttér-feldolgozás · render-cache. `DEV-PLAN.md:203-204`, `PRO.md:253-254`
- [ ] **Editor-réteg refaktor (F0)**: klip `uri`→`assetId`; command-pattern a `mutateProject` helyett; sáv-bővítés (Zene/Voiceover/SFX külön); klip-property (rotation/opacity/blend) + event log. `full-plan.md (F0)`, `PROJECT-LAYERS.md`
- [ ] **Creative Canvas (F6)**: crop/resize/perspektíva-crop · AI outpaint (16:9→9:16) · retouch · advanced tracking (mélység/okklúzió). `ReMix.md:114-121`

---

## 🟢 6. Tárolás & file-providerek (custom storage)

- [ ] **`StorageProvider` interfész** (connect/list/get/download/upload). `CUSTOM-STORAGE.md:18`, `full-plan.md (F2)`
- [ ] **Asset-állapotok**: External → Cached → Imported + Smart Cache az aktív klipekhez. `CUSTOM-STORAGE.md:4-5`
- [ ] **Connectorok**: Google Drive / Dropbox / OneDrive / S3 (OAuth + böngészés). `CUSTOM-STORAGE.md:14`, `DEVOPS.md:220-228`
- [ ] **WebDAV/NAS provider** befejezése (alap `storage.config.json` van). `README.md:182`
- [ ] **`.vided` projekt export/import + Collect Project** (zip asset-referenciákkal) befejezése. `README.md:197-208`
- [ ] **Külső-tár file-verziózás** (Drive-módosítás észlelése → Use New/Keep Current). `CUSTOM-STORAGE.md:16`
- [ ] **Collaborative storage** — Project vs Personal Storage + fájlonkénti jogosultság. `CUSTOM-STORAGE.md:14-15`

---

## 🟢 7. Natív / render / platform (roadmap: M1–M3)

- [ ] **Skia render-backend (M1)** — Chromium helyett Skia a szöveg/forma/3D raszterhez. `VidEd.md:74,192`
- [ ] **FFmpeg mobilon** — az `ffmpeg-kit` archivált; karbantartott fork/saját build (döntés). `VidEd.md:257-259`
- [ ] **On-device ONNX Runtime (M2)** natív build. `VidEd.md:202`
- [ ] **Desktop shell (M3)** — Tauri/Electron a worker körül. `VidEd.md:212,261`
- [ ] **AI Presenter/Avatar · Voice clone (consent) · AI videógenerálás (P2)**. `ReMix.md:135-137`
- [ ] **watchOS társ-app** (opcionális). `VidEd.md:285`

---

## 🟢 8. Dizájn / UI-újratervezés (DESIGN-TODO.md — nagyrészt nyitott)

- [ ] **Design tokens** — `theme.ts` (szín/tipó/spacing/radius/motion/glass) + palette-migráció (`accent→brand.cyan`, `accent2→brand.magenta`). `DESIGN-TODO.md:182-187`
- [ ] **Komponens-könyvtár** — primitívek (`Text/Button/Surface/Chip/Sheet/Toast/Skeleton`), kártyák (`VideoCard/CreatorCard/Avatar/Badge`), állapotok (`EmptyState/ErrorState/LoadingState`). `DESIGN-TODO.md:276,359`
- [ ] **RemixTransition komponens** (Reanimated + blur + chromatic-split) + Remix-belépési pont. `DESIGN-TODO.md:246-248`
- [ ] **Logó-asset + `RemixIcon`** (valódi asset, koherens ikon-rendszer). `DESIGN-TODO.md:277-278,372-377`
- [ ] **Képernyő-redizájn** (brand): Feed/For-You · Player · Editor · Timeline · Export · Profil (Originals/Remixek/Projektek/Mentett) · Discover · Kommentek. `DESIGN-TODO.md:295-343`
- [ ] **Üres/hiba/loading állapotok** — hasznos, márkás (skeleton/chromatic). `DESIGN-TODO.md:346`
- [ ] **Motion-rendszer** (időzítés-skála) + **`prefers-reduced-motion`**. `DESIGN-TODO.md:389,423`
- [ ] **Akadálymentesség** — kontraszt · 44pt touch-target · screen-reader címkék. `DESIGN-TODO.md:422-424`

---

## 🔵 9. Teljesítmény (AUDITBUGS P2 — mérendő eszközön)

- [ ] **Timeline 60 Hz reconcile** egy scrollTo-ért — `subscribeWithSelector` + imperatív scroll; `rulerMarks/beatTimes/régiók/markerek/gaps` memoizálása. `AUDITBUGS.md:347-354`
- [ ] **`projectDuration` ~7200×/perc** — WeakMap-cache. `AUDITBUGS.md:356-359`
- [ ] **`recordAutoVersion`** a throttle előtt olvassa a 20 verziót. `AUDITBUGS.md:361-364`
- [ ] **`PreviewSurface`/`AudioLayer`** player-írás minden frame-en — küszöbölés. `AUDITBUGS.md:366-369`
- [ ] **`HistoryModal`** mindig mountolva (`.reverse()` minden frame) — feltételes mount. `AUDITBUGS.md:371-374`

---

## 🔵 10. Kódminőség / robusztusság (AUDITBUGS P3)

- [ ] **Tipizálatlan HTTP-határok** — 37 db `(await res.json()) as T` type-guard nélkül. `AUDITBUGS.md:390-393`
- [ ] **Retry/backoff hiánya** az egész kódbázisban (tranziens hiba = végleges bukás). `AUDITBUGS.md:421-422`
- [ ] **Megszakíthatóság** — `renderLocal` nem kap `AbortSignal`-t (ingyenes export ✕ halott). `AUDITBUGS.md:424-427`
- [ ] **UI hiba-állapotok** — shop/feed error-state + like/save rollback. `AUDITBUGS.md:434-436`
- [ ] **Async versenyhelyzetek** — realtime-csatorna szivárgás, gyors A→B→A felülírás, out-of-order `replaceAsync` (generációs token/`alive` guard). `AUDITBUGS.md:438-441`
- [ ] **Időzítő-cleanup** — `CameraRecorder` setInterval, `editor/[id]` setTimeout. `AUDITBUGS.md:443-445`
- [ ] **Korlátlan cache-ek** (6 hely, LRU nélkül) + thumbnail-fájlok lemezen. `AUDITBUGS.md:447-448`
- [ ] **Event-napló méret** — REPLACE_TRACKS teljes `clips[]`-et tárol (Android 2 MB/kulcs limit). `AUDITBUGS.md:450-452`
- [ ] **Refaktor** — `AssistantPanel.tsx` (2093 sor), editorStore szerkesztés-matek → `lib/`; `aiPostJson` 11× duplikáció. `AUDITBUGS.md:409-419`
- [ ] **Dokumentáció-eltérés** — `AGENTS.md` `mutateProject` már nincs; `CURRENT_SCHEMA_VERSION` konstans hiányzik. `AUDITBUGS.md:454-457`

---

## 📄 11. Dokumentáció / folyamat (Arch.md)

- [ ] **ADR-fegyelem** — Architecture Decision Records (001–010). `Arch.md:12,511`
- [ ] **Réteg-doksik** — `runtime/state/commands/rendering/ai/networking/storage/collaboration/performance.md`. `Arch.md:467`
- [ ] **Diagram-fegyelem** (ASCII→Mermaid) + performance-költségvetés dokumentáció. `Arch.md:472-476`
- [ ] **Kontraktus-tesztek** — worker↔kliens séma-egyezés (felhő-verzióváltás ne törjön). `Arch.md:479`
- [ ] **CI/CD megfigyelhetőség** — cost-observability dashboard (R2/Supabase/Claude költség), health-monitoring proxy rate-limiter. `DEVOPS.md:200-203`

---

## ✅ Már kész (NE listázd hiányként — több forrás-md még nyitottként jelöli)

Ezeket ebben a munkamenetben megvalósítottuk (`- [x]`), de a régebbi md-k még TODO-ként tartalmazzák:

- [x] **Realtime chat**: DM · **csoportos DM** · projekt-collab-chat · gépel-jelző.  *(vö. `TODO.md:148-149`, `SOCIAL.md` F5)*
- [x] **Realtime collab (mag)**: presence · **élő parancs-szinkron** · kollaborátor-**kurzorok** · join-kori cloud-resync.  *(vö. `TODO.md:163-169`, `PRO.md:208-209`)*
- [x] **Feed**: realtime **kommentek** (+ avatar) · **dupla-tap like** + szív-anim · foryou/latest/following · remix.  *(vö. `TODO.md:142-143`)*
- [x] **Social értesítések** realtime + deep-linkek (új követő → `/channel`, komment → `/feed`, üzenet → `/chat`).
- [x] **Belépés e-maillel / felhasználónévvel / telefonnal** + username a regisztrációban.
- [x] **Zene-import teljes hosszban** (nem fix 10 mp).
- [x] **Videó-lejátszás fix** (nincs „árva" natív lejátszás) + idővonal-scrubber (minimap) vissza.
- [x] **Interaktív tutorial** (18 lecke, 3 szint + lecke-választó).
- [x] **DEV↔PROD config-guardok** — `lib/envConfig` (isLoopbackHost / resolvePublicUrl / isSecureForRelease) + **18 unit-teszt**; supabase.ts & backend.ts erre állítva. *(`00244c2`)*
- [x] **UIA.md** összes anomáliája **javítva** (2026-09-11) — abból a fájlból nincs teendő. `UIA.md`

---

*Generálva: 2026-09-26, az `.md` fájlokból (AUDITBUGS · TODO · DEV-PLAN · DESIGN-TODO · PRO · STUDIO · PROD · DEVOPS · OPS · MONEY · Arch · README · `devs/*`).*
***Fő vonal:** DEV és PROD ugyanaz a kódbázis — a prod = átkonfigurálás (env + hosztolt célok + `__DEV__`-kapuk), nem újraírás. Minden fejlesztés config-vezérelt (0. szekció). A go-live (0.) a legsürgősebb; a részletek a hivatkozott fájlokban.*
