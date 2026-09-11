# ReMix Pro — funkció-roadmap & todo

> **Termékpozíció:** ReMix = gyors, intelligens, nem-destruktív, vizuálisan
> érthető, AI-val együtt dolgozó professzionális editing system. A „Pro" nem
> több effektet jelent, hanem **mélyebb kontrollt, gyorsabb munkafolyamatot,
> jobb minőséget és nagyobb automatizációt** — a CapCut funkciókészlet az alap,
> a különbség a **Semantic Timeline + AI Editor + Remix Lineage +
> Collaboration + Story/Pacing** rendszer.
>
> A UX 6 állapot köré épül, felette végig ott az AI mint **copilot** (nem külön
> menü): **SEE → UNDERSTAND → SELECT → EDIT → REVIEW → PUBLISH**.

---

## 0. Döntések (rögzítve)

### 0.1 Kapuzási elv — **szigorú on-device = ingyen**
- **Amit a készülék maga elvégez → INGYEN** (worker/AI/felhő nélkül). Ide tartozik
  a haladó on-device is: keyframe-ek, maszkok, LUT, görbék, scope-ok, korlátlan
  sáv, graph editor, freeze/reverse, effekt-lánc, stb. **Ezek NEM Pro.**
- **Csak a fizetős infra kér Pro-t:** cloud-render, AI/worker-pipeline,
  cloud-tárhely, cloud-collab.
- Ez felülírja a vízió Free/Pro szintezését ott, ahol az on-device haladó
  funkciókat Pro alá tette. A binomiális `free | pro` modell marad (a „Pro+"
  csak címke — a gating szempontjából minden cloud/AI = Pro).
- **A meglévő [capabilities.ts](src/lib/capabilities.ts) már ezt kódolja**
  (`where: 'local'` = ingyen, `where: 'cloud'` = Pro). Új funkciónál a döntő
  kérdés: *kell-e hozzá fizetős infra?* — nem az, hogy „értékes-e".

### 0.2 Előfizetés-kezelés — **per-user, Supabase flag most, billing később**
- Az entitlement forrása **userenként a Supabase** (nem az eszköz).
- Első körben **manuális/admin-állítható flag** — a gating erre épül, gyorsan
  tesztelhető.
- A valódi fizetés (RevenueCat + store IAP) **külön, későbbi fázis** (§ Phase 6).

---

## 1. Jelenlegi állapot — mi van MÁR készen (ne építsük újra)

A négy kód-felderítés alapján a rendszer meglepően érett. Kivonat:

**Core editing (mind on-device → ingyen):** multi-track (10 típus, korlátlan),
split, ripple delete/resize, trim, multi-select, **linked clips**, undo/redo
(50), **command bus** (`dispatch`/`applyBatch`, `actor:'ai'`), snapping
(beat/marker/playhead), frame-pontos nudge, precíz idő/timecode panel, zoom,
**minimap**, markerek, **chapters (Story lane)**, **pacing lane** (heurisztikus),
track collapse/height/lock/mute/solo, focus mode, before/after compare,
style-clipboard.

**Kompozit / szín / effekt (on-device → ingyen):** text (3D, karaoke),
image, sticker, shape, adjustment layer, blend módok, opacity, transform
(pos/scale/rot), maszkok (rect/ellipse/polygon + feather + invert), speed +
**speed ramp + custom curve**, alap szín (bright/contrast/sat/temp/vignette),
filter- és grade-presetek, LUT-intenzitás (strength), **color match**,
transition-motor (15 típus + időtartam), depth parallax/focus, 3D tilt,
Ken Burns, particles.

**AI / worker (cloud → Pro):** AI **assistant** (NL → strukturált parancsok,
**preview + approve**, egy undo-lépés), **auto-edit** (3 variáns, preview),
**hook generator**, **caption studio** (Whisper STT, szó-szintű timing,
karaoke), **thumbnail headline**, **smart/semantic search** (vision index +
embedding), scene/silence/face/shot/beat detektálás, **bg-remove / chroma /
sky / depth / face-tools** (worker), color-stats, sound-design (heurisztikus).

**Monetizáció:** capability-rendszer + `ensureCloud` gate + PaywallSheet —
**működik**, de az entitlement eszköz-lokális és nincs valódi billing.

**Auth:** Supabase Auth + `profiles` / `user_devices` / `user_ai_providers` /
`user_ai_task_providers` (mind RLS own-only). **Nincs subscription tábla.**

**Export:** local (ingyen) + cloud (Pro), 480p–4K, 24/30/60, low/med/high,
platform-poszt (TikTok/Reels/YT), SRT, projekt-ZIP.

**Remix lineage:** `project.remixOf` (szülő-projekt, kattintható).

> Részletes DONE/PARTIAL/MISSING mátrix: lásd a §Függelék-et.

---

## PHASE 0 — Per-user előfizetés (FOUNDATION) ⭐

> Ez a kérés magja. Cél: az entitlement forrása **userenként a Supabase**, a
> lokális `entitlementStore` csak offline-gyorsítótár. Billing még nincs.

- [ ] **0.1 Migration — `subscriptions` tábla**
  `supabase/migrations/2026091x_subscriptions.sql`:
  `user_id uuid pk references auth.users`, `tier text not null default 'free'`
  (`free|pro`), `status text default 'active'`, `current_period_end timestamptz null`
  (= `proUntil`, null = örök), `source text default 'manual'`
  (`manual|revenuecat|stripe`), `updated_at timestamptz`.
  RLS: user **SELECT own**; INSERT/UPDATE csak service_role/RPC (a user ne
  írhassa magát Pro-vá). Trigger: új usernél `free` sor létrejön (mint
  `handle_new_user`), vagy bővítsük a meglévő triggert.
- [ ] **0.2 `src/lib/subscription.ts`** — `fetchMySubscription()` → `{tier, proUntil}`;
  `subscriptionToEntitlement()` map.
- [ ] **0.3 Szinkron az auth-életciklusba** — `authStore.hydrate()` /
  `onAuthStateChange`: session után `fetchMySubscription()` →
  `entitlement.setTier(tier, proUntil)`. `signOut()` → entitlement reset `free`
  + per-user cache ürítése.
- [ ] **0.4 `entitlementStore` per-user cache** — az AsyncStorage-kulcs a
  user id-vel namespace-elve (fiókváltásnál ne szivárogjon a Pro). Forrás =
  Supabase; lokál = offline fallback `proUntil`-lal (grace).
- [ ] **0.5 Dev-grant per-user** — `mockUpgrade()` maradjon `__DEV__`-lokális
  override-nak, DE adjunk egy dev/admin RPC-t (`dev_set_tier`), ami a Supabase
  sort írja → per-user tesztelhető a teljes út.
- [ ] **0.6 Gate-ellenőrzés** — `isProNow()` a szinkronizált tierből olvasson
  (nincs kód-változás a `ensureCloud` hívóknál; csak a forrás lesz per-user).
- [ ] **0.7 Capability-audit** — verifikáljuk, hogy semmi `where:'local'` nincs
  `pro:true`-ra állítva és fordítva (a szigorú elv betartása). Egy kis teszt/
  script a `capabilities.ts`-re.

**Kész-kritérium:** ugyanaz a user két eszközön ugyanazt a tiert látja; a Pro a
Supabase sorból jön; kijelentkezés után az eszköz visszaáll `free`-re.

---

## PHASE 1 — UNDERSTAND: AI videó-analízis kiteljesítése (Pro)

> „Az AI először MEGÉRTI, utána SZERKESZT." A meglévő analízisre (scene/silence/
> face/shot/beat/vision-index) építve.

- [ ] **1.1 AI Story Engine** — a hook-generátoron túl: **setup / problem /
  explanation / payoff / conclusion / CTA** felismerése transcript+vizuális
  jelekből → **automatikus `chapters`** a Story lane-en (a `Chapter.kind`-ot
  bővíteni). Worker task `storyStructure`.
- [ ] **1.2 AI Pacing (worker)** — a jelenlegi kliens-heurisztikát egészítse ki
  egy worker-elemzés: beszédtempó, csend-arány, vizuális változás-frekvencia,
  zene-energia → „00:17–00:22 lelassul" jellegű javaslatok a Pacing lane-en.
- [ ] **1.3 Filler-word detektálás** — „ööö/hát/tudod" szavak a transcriptből →
  jelölés + egy-kattintásos kivágás (a silence-cuthoz hasonló út).
- [ ] **1.4 Speaker diarization** — ki beszél mikor → caption speaker-label +
  smart-select alap („ahol ÉN beszélek").
- [ ] **1.5 Minőség-detektorok** — homályos / alul-/túlexponált / duplikált
  felvételek + low-energy szakaszok jelölése (shot-score bővítése).
- [ ] **1.6 Emotion/hangulat becslés** (opcionális, később) — reakció-kiemelés.

## PHASE 2 — SELECT: Semantic timeline & AI smart-select (Pro)

- [ ] **2.1 Semantic select → parancs** — a smart-search ma csak keres és
  ugrik; adjunk „**válaszd ki az összes ilyen snittet**" utat: a találatok
  multi-select-be / új parancsba (SELECT_CLIPS) kerüljenek.
- [ ] **2.2 Match-highlight a timeline-on** — a semantic query eredményei
  vizuálisan kiemelve a sávokon (a „MATCHES: 7" minta).
- [ ] **2.3 Objektum-keresés** — vision-index bővítése objektum-címkékkel
  („piros autó", „kutya") a jelenlegi jelenet-leírás mellé.

## PHASE 3 — EDIT: AI copilot mélyítése (Pro)

- [ ] **3.1 „Make this more engaging"** — összetett, több-lépéses AI-javaslat
  (csend-vágás + intró-rövidítés + reakció + felirat + zene) **egy review-
  listában**, tételes apply/undo (az AI change-preview már megvan → bővíteni).
- [ ] **3.2 Parancs-whitelist bővítés** — az AI ma 6 parancsot ad
  (UPDATE/REMOVE/SPLIT/ADD_TEXT/SET_ASPECT/RENAME). Bővítés: speed, transition,
  szín-adjust, maszk, keyframe (a végrehajtás on-device/ingyen; az AI-tervezés a
  Pro). Server Zod + kliens `toEditorCommands` szinkronban.
- [ ] **3.3 AI Rough Cut → shorts** — az auto-edit long-form → több short
  variánsra bontása; a „nem fekete doboz" elv: minden döntés megnyitható.

## PHASE 4 — PUBLISH: AI social & lokalizáció (Pro / Pro+)

- [ ] **4.1 AI social variants** — platform-specifikus auto-reframe + safe-area
  (TikTok 9:16 / Reels / Shorts) egy gombból, a meglévő `smartReframe`-re.
- [ ] **4.2 AI feliratfordítás / lokalizáció** — Whisper transcript → fordítás →
  többnyelvű caption-track.
- [ ] **4.3 AI dubbing** (Pro+) — fordított szöveg → TTS hang (a `/tts` már van).
- [ ] **4.4 AI zene- és B-roll-választás** — cut-pontokhoz / hangulathoz.
- [ ] **4.5 Auto A/B variánsok** (Pro+) — több hook/vég-változat egyszerre.
- [ ] **4.6 Export-bővítés** — HEVC/AV1/ProRes + 8K a **cloud-render** úton
  (Pro); on-device export marad ingyen. Platform-preset finomítás.

## PHASE 5 — Cloud: Collaboration, versioning, media (Pro, cloud-tárhely)

> Előfeltétel: **projekt cloud-sync** (ma minden device-lokális AsyncStorage).

- [ ] **5.1 Projekt cloud-sync** — `projects` tábla + média-tárhely (Supabase
  Storage). RLS own + megosztás. Ez nyitja meg a collab/versioning felhő-részét.
- [ ] **5.2 Verziók + restore** — **on-device named snapshot + visszaállítás =
  INGYEN** (a HistoryModal ma csak olvasható). **Cloud-verziótörténet = Pro.**
- [ ] **5.3 Collaboration** — presence (kurzor/kijelölés), timeline-komment,
  clip-lock („🔵 Mark szerkeszti"), review-mode (edit→review→comment→approve).
  Mind cloud → Pro.
- [ ] **5.4 Media library** — mappák/tagek/keresés: **metaadat on-device =
  ingyen**; **cloud-tárolt média = Pro**. Smart-organize (AI típus/scene/person
  tageli) = Pro (worker).
- [ ] **5.5 Remix Graph** — a jelenlegi `remixOf`-ból teljes fa-nézet („honnan
  jött / mit vett át / ki készítette"). Kereszt-user remix = cloud = Pro.

## PHASE 6 — Billing (elhalasztva; a Phase 0 után) 💳

- [ ] **6.1 RevenueCat SDK** (expo `react-native-purchases`) — store IAP
  absztrakció (App Store / Play).
- [ ] **6.2 Webhook → `subscriptions`** — a RevenueCat entitlement írja a
  Supabase sort (`source:'revenuecat'`), a kliens onnan szinkronizál.
- [ ] **6.3 PaywallSheet → valódi vásárlás** — a `TODO(IAP)` kiváltása; restore
  purchases; próbaidő/árazás.

---

## Függelék A — FREE on-device hiányok (külön backlog, NEM Pro)

> A „pótoljuk a hiányzó funkciókat" része, de a szigorú elv miatt **ingyen**.
> Külön priorizálható, nem az előfizetéshez kötött.

- Keyframe: **rotáció + opacity** csatorna (ma csak scale/x/y/volume) + **graph
  editor** (bezier-görbe UI).
- Szín: **görbék / RGB-görbék / HSL / color wheels / scope-ok** (histogram,
  waveform, vectorscope, RGB parade), **LUT-import** (ma csak preset).
- Speed: **freeze frame + reverse**.
- Maszk: **animált maszk-geometria + expand/shrink** (a tracking = worker = Pro).
- Effekt: **effekt-lánc** (több effekt/klip), **transition-easing**.
- Transform: **anchor-point + crop + 2D skew**.
- Audio on-device UI: **EQ / kompresszor / limiter / pan** (ma render-oldali
  flag mögött), **normalizálás**, **hum-removal**.
- Réteg: **GIF-klip típus**.
- **Proxy / performance engine** (proxy-generálás, háttér-feldolgozás,
  render-cache) — nagy device-oldali nyereség, ingyen.

## Függelék B — DONE/PARTIAL/MISSING mátrix (kivonat)

| Terület | DONE | PARTIAL | MISSING |
|---|---|---|---|
| Timeline/edit | multi-track, split, ripple, trim, multiselect, linked, undo/redo, snapping, nudge, zoom, minimap, markerek, chapters, track lock/mute/solo/height | timeline-regions | overwrite/insert, slip/slide/roll, compound/nested, **colored markers** |
| Keyframe | scale/x/y/volume + easing | — | rotáció/opacity, **graph editor** |
| Kompozit | text/image/sticker/shape, blend, opacity, transform, transitions(15) | effect-layer, skew | GIF, anchor, crop, effekt-lánc, animált maszk |
| Szín | alap adj, presetek, grade, LUT-strength, color-match | AI-selective | görbék, HSL, wheels, **scope-ok**, LUT-import |
| Audio | volume, fade, duck, deReverb, voiceEnhance, waveform, vol-keyframe | comp/NR (flag) | EQ/limiter/pan UI, normalizálás, hum, silence-trim UI |
| Speed | speed, ramp, custom-curve, motion-blur | frame-interp | freeze, reverse |
| Effekt AI (Pro) | bg-remove, chroma, sky, depth, face-tools, ken-burns, tracking | — | mask-tracking |
| AI (Pro) | assistant+preview, auto-edit, hooks, captions(STT/karaoke), thumb-headlines, smart-search, scene/silence/face/shot/beat | story(csak hook), captions(no speaker/transl.) | pacing(AI), filler-word, diarization, emotion, blur/expo-detect, AI b-roll/music/color/master, dubbing, social-variants, A/B |
| Export | local+cloud, 480p–4K, 24/30/60, SRT, ZIP, platform-poszt | safe-zone export | 8K, HEVC/AV1/ProRes |
| Monetizáció | capability-rendszer, `ensureCloud`, PaywallSheet | tier (eszköz-lokális) | **per-user Supabase**, valódi IAP |
| Collab | — | — | sync, presence, komment, lock, review |
| Versioning | event-log (olvasható) | — | snapshot+restore, cloud-verzió |
| Media | import, YouTube(free+pro), semantic-search | — | mappák/tagek, cloud-tárhely |
| Remix | `remixOf` | — | remix-graph fa, asset-lineage részletes |
