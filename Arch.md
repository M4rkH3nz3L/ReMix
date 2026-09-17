# Arch.md — ReMix architektúra

> **Cél.** Ez a dokumentum azt írja le, *hogyan gondolkodunk* a ReMixről mint
> rendszerről — Meta / React Native-szemlélettel (rétegek, adat-áramlás,
> döntések és a *„miért?"*), nem pedig fájlonként, hogy „melyik komponens mit
> csinál". A fájl-szintű valóságot a [README.md](README.md) és maga a kód
> tükrözi; **ez itt a térkép, nem a terep.**
>
> A dokumentum **kettős**: (1) leírja a *jelenlegi, valós* architektúrát, hogy
> ma is használható legyen, és (2) kimondja, **mi kell még ahhoz, hogy profik
> legyünk** — lásd a [12. szakaszt](#12-mire-van-szükség-hogy-profik-legyünk).
>
> A New Architecture (Fabric/JSI/Hermes) alapelveihez a hivatalos, verziózott
> forrás a mérvadó: <https://docs.expo.dev/versions/v57.0.0/> és
> <https://reactnative.dev/architecture/overview>. **Kód írása előtt ezeket kell
> olvasni** ([AGENTS.md](AGENTS.md)).

---

## 0. Hol van ennek a helye a dokumentációban

A ReMix már *sok* dokumentumot hordoz. Ez a fájl a **capstone**: fölé rendeli
és összeköti őket, nem duplikálja.

| Dokumentum | Kérdés, amire válaszol | Réteg |
|---|---|---|
| **Arch.md** *(ez)* | Hogyan épül fel a rendszer, és miért? | architektúra |
| [README.md](README.md) | Mit tud az app, hogyan indítom? | belépő |
| [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) | Milyen szabályok kötnek kód írásakor? | konvenció |
| [STUDIO.md](STUDIO.md) | Milyen szerkesztő-funkciók vannak + a Free/Pro kapu | feature (editor) |
| [PRO.md](PRO.md) · [MONEY.md](MONEY.md) | Pro-roadmap · üzleti modell | termék |
| [OPS.md](OPS.md) · [DEVOPS.md](DEVOPS.md) | Mit és hogyan üzemeltetünk | üzemeltetés |
| [PROD.md](PROD.md) | Hogyan készül kiadható build, és mi kell hozzá | kiadás |
| [AUDITBUGS.md](AUDITBUGS.md) · [TODO.md](TODO.md) | Nyitott adósság · go-live blokkolók | minőség |
| [DESIGN-TODO.md](DESIGN-TODO.md) · [UIA.md](UIA.md) | Design-DNS · UI-anomáliák | UI |

**Olvasási sorrend új fejlesztőnek:** README → **Arch.md (1–7. szakasz)** →
AGENTS.md → a feature-hez tartozó doksi (pl. STUDIO.md).

---

## 1. A rendszer madártávlatból

A ReMix **nem** egy „React Native CRUD app". Két, önmagában is nagy rendszer ül
egy közös magon — és épp a **közös mag** teszi eggyé őket.

```
                          ReMix
                            │
             ┌──────────────┴──────────────┐
             │                             │
      CREATIVE SYSTEM                SOCIAL SYSTEM
      (interaktív editor)         (TikTok-szerű platform)
             │                             │
   ┌─────────┼─────────┐         ┌─────────┼──────────┐
   Timeline  Canvas   Audio      Feed    Channel    Shop
   Effects   Keyframe Captions   Auth    Comments   Collab
   Interakt. AI-asszisztens      Remix   Notif.     Promotion
             │                             │
             └──────────────┬──────────────┘
                            │
                       SHARED CORE
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
     STATE (zustand)   COMMAND BUS         AI LAYER
     Project = igazság  applyCommand()     command-forrás
     session ≠ projekt  actor + undo       validált, undo-zható
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                      SERVICES / NÉV-RÉTEG
              backend-router · *Client.ts · capabilities
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
   NATIVE RUNTIME     FELHŐ-WORKER          SUPABASE
   remix-render       FFmpeg + Chromium     Postgres + Auth
   (on-device MP4)    Whisper · TTS · S3    Realtime · Storage · RLS
       │
   iOS / Android (New Architecture: Fabric · JSI · Hermes)
```

**A vezérelv, amit érdemes megjegyezni:** minden szerkesztő-szándék — jöjjön
*érintésből, gesztusból, billentyűből vagy az AI-tól* — **ugyanazon a command
buson** megy át, és **ugyanaz a pure reducer** hajtja végre. Ez az egyetlen
döntés adja a rendszer determinizmusát (undo, AI, később kollaboráció).

---

## 2. Rétegek (a Meta-féle „Architecture" nézet)

A Meta a React Native-et nem képernyők, hanem **rétegek** mentén dokumentálja.
A ReMix rétegtérképe, valós fájl-horgonyokkal:

```
┌─ PLATFORM / RUNTIME ─────────────────────────────────────────────┐
│  React 19.2 · React Native 0.86 · Expo SDK 57                     │
│  New Architecture: Fabric (renderer) · JSI · Hermes · Worklets    │
│  → Reanimated 4 + gesture-handler a UI-szálon (60 fps gesztus)    │
└──────────────────────────────────────────────────────────────────┘
┌─ UI SYSTEM ──────────────────────────────────────────────────────┐
│  src/components/ui/  · constants/ (téma, layout, fonts, grades)   │
│  i18n (i18next; en/de/hu) · ErrorBoundary · BottomNav · Paywall   │
└──────────────────────────────────────────────────────────────────┘
┌─ FEATURE LAYER ──────────────────────────────────────────────────┐
│  src/app/ (expo-router képernyők) + a hozzájuk tartozó            │
│  components/editor, components/preview, panels/                   │
│  editor · feed · channel · shop · profile · auth · collab · player│
└──────────────────────────────────────────────────────────────────┘
┌─ SHARED CORE ────────────────────────────────────────────────────┐
│  store/ (zustand)  ·  lib/commands.ts (command bus reducer)       │
│  lib/ai*.ts (AI mint command-forrás)  ·  lib/frames.ts (timebase) │
│  types/project.ts (a domain-modell)                               │
└──────────────────────────────────────────────────────────────────┘
┌─ SERVICES / NÉV-RÉTEG ───────────────────────────────────────────┐
│  lib/backend.ts (router + Pro-kapu)  ·  lib/capabilities.ts        │
│  lib/*Client.ts (~15 hálózati kliens)  ·  lib/supabase.ts          │
│  storage · secureStorage · upload · netRetry                       │
└──────────────────────────────────────────────────────────────────┘
┌─ NATÍV + BACKEND ────────────────────────────────────────────────┐
│  modules/remix-render (on-device MP4)                             │
│  server/ (Express worker: render, AI, media, queue)               │
│  supabase/ (Postgres + Auth + Realtime + Storage + RLS)           │
└──────────────────────────────────────────────────────────────────┘
```

A rétegek közti **irányított függőség** a kulcs: fentről lefelé szabad hivatkozni,
visszafelé soha. A `lib/` magok (`commands`, `frames`, `projectUtils`, `keyframes`,
`trimEdit`, …) **szándékosan expo-mentesek**, ezért önmagukban tesztelhetők — a
hálózat a párjuk `*Client.ts`-ében van ([AGENTS.md](AGENTS.md)).

---

## 3. Adat-áramlás (data flow)

A Meta-doksi legfontosabb üzenete: **az adat-áramlást dokumentáld, ne a gombokat.**
A ReMix egyetlen áramlási elv köré szerveződik:

```
  SZÁNDÉK-FORRÁSOK                (mind ugyanoda fut be)
  ┌───────────┬───────────┬───────────┬───────────┐
  touch     gesztus     billentyű     AI          automation
  (panel)   (drag/trim)  (J/K/L…)    (chat)       (batch/preset)
      └──────────┴─────┬─────┴───────────┴───────────┘
                       ▼
                 EditorCommand           ← nevesített, szerializálható
                       │                    (lib/commands.ts)
                       ▼
              useEditorStore.dispatch(command, actor)
                       │  ┌──────────────────────────────┐
                       ├─▶│ applyCommand(project, cmd)     │ pure reducer
                       │  │  → next Project | null (no-op) │ (validál)
                       │  └──────────────────────────────┘
                       ▼
              ┌──── új Project (immutábilis csere) ────┐
              │        │            │           │      │
              ▼        ▼            ▼           ▼      ▼
           past[]   events[]     dirty=true   future=[]  (undo/redo + napló)
              │
              ▼
         RENDER PIPELINE (kliens)
              │
   ┌──────────┼───────────────────────────┐
   ▼          ▼                            ▼
 Timeline   Preview (mesteróra-vezérelt)  Insight-sávok
 (vágás)    video/audio/text/overlay      (story/map/pacing)
```

**Konkrét példa — „vágd ketté itt":**

```
  AI-chat: „vágd ketté a lejátszófejnél"
        │
        ▼
  worker /ai/assist  →  whitelist-parancs { SPLIT_CLIP, clipId, time }
        │
        ▼
  toEditorCommands()      ← ismeretlen mezők kiesnek, validálás (aiCommands.ts)
        │
        ▼
  dispatch({ SPLIT_CLIP }, 'ai')
        │
        ▼
  applyCommand → splitClip()   (frame-rácsra ültetve, projectUtils/frames)
        │
        ├── Timeline: két klip
        ├── Preview: azonnal helyes (a playheadből számol)
        └── events[]: `ai: SPLIT_CLIP …` (provenancia, undo-zható)
```

Ugyanez a lánc fut, ha a felhasználó a borotva-eszközzel koppint — **csak az
`actor` más** (`'user'` vs `'ai'`). Ez a szimmetria a rendszer legfontosabb
tulajdonsága.

---

## 4. A Command Bus — a rendszer gerince

**Invariáns (nem opció):** a projektet **soha nem írjuk közvetlenül.** Nincs
`.tracks.push`, `.clips.splice`, sem store-on kívüli `setState`
([AGENTS.md](AGENTS.md)). Minden változás egy `EditorCommand`, amit a
[lib/commands.ts](src/lib/commands.ts) `applyCommand()` **pure reducere** hajt
végre.

**Felület** ([store/editorStore.ts](src/store/editorStore.ts)):

```ts
dispatch(command, actor?)          // egy művelet, egy undo-lépés, egy esemény
applyBatch(commands, actor?)       // több command → EGY undo-lépés (AI-köteg, preset)
```

A jelenlegi command-készlet (a `EditorCommand` unió,
[commands.ts](src/lib/commands.ts)): `ADD_CLIP(S)`, `UPDATE_CLIP`, `REMOVE_CLIP`,
`SPLIT_CLIP`, `REPLACE_TRACK_CLIPS`, `REPLACE_TRACKS`, `SET_ASPECT`, `SET_FPS`,
`RENAME_PROJECT`, `ADD/UPDATE_ASSET`, `RELINK_URI`, `SET_PARTICLES`,
`SET_MARKERS`, `SET_CHAPTERS`, `SET_REGIONS`, `SET_LINKS`,
`UPSERT/REMOVE_IMAGE_DOC`.

Mit ad ez, amit egy „setState mindenütt" nem adna:

- **Undo/redo** egyetlen csővezetéken (50 lépés) — a `past`/`future` teljes
  projekt-pillanatképeket tart, a reducer immutábilisan cserél.
- **Provenancia** — minden művelet `actor`-t kap (`'user' | 'ai' | 'system'`), és
  bekerül az `events[]` naplóba (300 esemény, az AI-memória nyersanyaga). A
  napló a „nehéz" mezőket csonkolja ([eventLog.ts](src/lib/eventLog.ts)), hogy az
  autosave ne írjon újra megabájtokat.
- **Determinizmus az AI-nak** — az AI kimenete *ugyanaz a command*, validálva és
  undo-zhatóan (lásd [10. szakasz](#10-ai-vezérlés--az-ai-mint-command-forrás)).
- **Kollaboráció-készség** — szerializálható műveletek → később operation-alapú
  szinkron ([collab.ts](src/lib/collab.ts), `cloud_projects` migráció).

### 4.1 Session-állapot ≠ projekt-igazság (fontos határvonal)

A store egy részét a `SESSION_RESET` konstans nullázza projekt-nyitáskor és
-záráskor. Ez **szándékos architekturális határ**: a `mutedTracks`, `soloTracks`,
`hiddenTracks`, `trimMode`, `snapStrength`, `focusMode`, `variantPreview` stb.
**NEM kerül a projektbe és NEM hat a renderre.** Így a némítás sosem lesz „miért
hiányzik a zene az exportból?" csapda — a végleges elnémításra a klip `volume`-ja
való, ami *projekt-adat, ami command buson megy át*. A monitorozás session, az
igazság projekt.

---

## 5. Az egy-mesteróra elv

**Egy** `requestAnimationFrame`-óra hajtja a lejátszást
([hooks/usePlaybackClock.ts](src/hooks/usePlaybackClock.ts)): a `playhead` a
store-ban él, ő a **mester**, és a videó- és hangréteg
([components/preview/](src/components/preview/)) *ehhez szinkronizál*
(drift-korrekcióval). Így a szöveg-animációk, a hotspot-időzítés és a beat-rács
görgetésre is determinisztikus.

**Szabály új, időzített funkcióhoz:** a playheadből számolj, **ne indíts saját
órát** ([AGENTS.md](AGENTS.md)). Az óra emellett kezeli a shuttle-sebességet
(J/K/L), a hurok-tartományt (I/O) és az Auto-Edit változat-előnézetet — és van
**fókusz-kapu**, mert a szerkesztő és a lejátszó képernyő is hívja a hookot
(kapu nélkül dupla sebességgel haladna a playhead).

---

## 6. Preview vs Render paritás — a definitív elv

Ez az elv végigvonul a teljes [types/project.ts](src/types/project.ts) modellen,
és minden effekt-döntést átszínez:

> **Az előnézet közelít (React Native, valós idő), a render a mérvadó (worker,
> pixel-pontos).**

- Az **előnézet** natív RN-eszközökkel közelít: `transform`, `mixBlendMode`,
  overlay-tint a szűrőkre, RN-transzform a 3D-döntésre.
- A **render** a workeren a pontos eredményt égeti: FFmpeg szűrőlánc (grade,
  keyframe, chroma, maszk, hangkeverés), és a szöveg/forma/felirat **headless
  Chromiummal** rasterizálódik PNG-vé — így a stíluspresetek pixelre egyeznek.

**Miért így?** A telefon nem tud valós időben LUT-ot, per-frame optical flow-t
vagy Chromium-tipográfiát számolni 60 fps-en; a worker igen. A modell ezért
minden „nehéz" mezőnél kimondja a kommentben, hogy az a *renderben* érvényesül.
**Következmény új effektnél:** először a modell-mező + a render-paritás, aztán az
előnézeti közelítés — sosem fordítva.

---

## 7. Az adatmodell — `Project → Track → Clip`

A domain [types/project.ts](src/types/project.ts)-ben él, kereszt-idézhetően.

**Egyezmények (kőbe vésve):**

- **Idő mindenhol másodpercben.** Vászon-pozíciók/méretek **0–1 normalizálva**
  (az előnézeti felület méretétől függetlenül).
- **Frame-rács.** A vágások és kulcskockák a projekt **frame-rácsára** ülnek
  ([lib/frames.ts](src/lib/frames.ts), `project.fps`, alap 30); a timecode
  `HH:MM:SS:FF`.
- **Asset ≠ klip.** A projekt *hivatkozik* a médiára (`Asset`, md5+méret
  ujjlenyomattal a relinkhez), nem birtokolja. A klip `uri`-ja denormalizált
  gyorsítás.
- **Interaktivitás = metaadat.** A hotspotok normalizált téglalapjai és műveletei
  JSON-ként utaznak (sidecar); a videó hagyományos MP4 marad — a lejátszó
  overlay-ként értelmezi.
- **schemaVersion + migráció.** A betöltő migrál (1 → 2 → 3 → 4); régi projektek
  hiányzó mezői defaultra állnak (a modell szinte minden új mezője opcionális).

Sávtípusok (`TrackType`): `video · pip · adjust · text · captions · overlay ·
interactive · music · voiceover · sfx`. A tartalom-típus kap sávot; a
transition/filter/mask/keyframe a **klip property-je** marad.

---

## 8. Feature-ownership — a jelenlegi `src/` a Meta-modellben

A Meta a kódot **feature-tulajdonlás** mentén szervezi (egy feature kódja egy
helyen), nem `components/ / screens/ / hooks/` vízszintes szeletekben. A ReMix
ma **hibrid**: a rétegek tiszták (`store` / `lib` / `components` / `app`), de a
feature-ek a `components/`-en és a `lib/`-en belül vannak csoportosítva.

**Fontos döntés: NEM szervezzük át a fát pusztán az esztétikáért.** A mai
struktúra 246 fájlon skálázódik, és a réteg-határok élesek. A *feature-lencse*
inkább a **dokumentáció** és a **kód-review** eszköze legyen. Így térképezhető:

| Feature | Képernyő | Komponensek | Mag / kliens |
|---|---|---|---|
| **Editor** | [app/editor/[id].tsx](src/app/editor/[id].tsx) | [components/editor/](src/components/editor/), [preview/](src/components/preview/), [panels/](src/components/editor/panels/) | `commands`, `frames`, `keyframes`, `trimEdit`, `ripple`, `projectUtils` |
| **AI-asszisztens** | AssistantPanel | AiActivity, AiProviderPicker | [ai.ts](src/lib/ai.ts), [aiCommands.ts](src/lib/aiCommands.ts), [aiProviders.ts](src/lib/aiProviders.ts) |
| **Render/Export** | ExportPanel | ProgressOverlay | [render.ts](src/lib/render.ts), [nativeRender.ts](src/lib/nativeRender.ts), `*Client.ts` |
| **Feed / Social** | [app/feed.tsx](src/app/feed.tsx), [channel/[id]](src/app/channel/[id].tsx) | BottomNav, NotificationBell | [feed.ts](src/lib/feed.ts), [supabase.ts](src/lib/supabase.ts), [types/social.ts](src/types/social.ts) |
| **Pro / Fizetés** | [PaywallSheet](src/components/PaywallSheet.tsx) | — | [billing.ts](src/lib/billing.ts), [subscription.ts](src/lib/subscription.ts), `entitlementStore` |
| **Shop** | [app/shop.tsx](src/app/shop.tsx) | — | [shop.ts](src/lib/shop.ts) |
| **Collab** | [app/collab/[id].tsx](src/app/collab/[id].tsx) | RemixGraphModal | [collab.ts](src/lib/collab.ts), `collabStore` |

**Ha új, önálló nagy feature jön** (nem az editor-magra épül), akkor érdemes a
Meta-féle `features/<név>/{components,hooks,state,api,screens,types}` mintát
követni — de a meglévő magot (editor/command bus/clock) nem bontjuk szét.

---

## 9. A felhő-réteg — router + capability-kapu + worker + Supabase

### 9.1 Backend-router és a Pro-kapu

Egyetlen forrás dönt címről és jogosultságról:
[lib/backend.ts](src/lib/backend.ts).

- **CÍM:** a fizetős felhő-worker hosztolt címe (`EXPO_PUBLIC_CLOUD_URL`), nem a
  fejlesztői gép; dev-ben visszaesik a lokális workerre. Release buildben a sima
  HTTP tiltott (a Supabase-token, a BYOK-kulcs és a média utazik rajta).
- **KAPU:** `ensureCloud(cap)` — Pro-funkció előtt ellenőrzi az előfizetést; nincs
  Pro → `ProRequiredError` → a UI paywallra fordítja, **a hívás el sem indul**.
  Így a ~15 `*Client` modul egyetlen egysorossal gate-elhető.

### 9.2 A capability-katalógus — típus-szinten kikényszerített üzleti szabály

[lib/capabilities.ts](src/lib/capabilities.ts) mondja ki, hogy egy művelet **HOL**
fut (`where: 'local' | 'cloud'`) és **kell-e** hozzá Pro (`pro`). Az elegancia:

```ts
type CapabilityMeta =
  | { where: 'local'; pro: false; label: string }   // on-device ⇒ KÖTELEZŐEN ingyen
  | { where: 'cloud'; pro: boolean; label: string }; // felhő ⇒ lehet Pro
```

Egy `{ where: 'local', pro: true }` sor **fordítási hibát** ad → az üzleti szabály
(*„on-device = ingyen, csak a worker/AI/felhő-tárhely Pro"*) minden
`tsc --noEmit`-nél automatikusan auditálva van. Ezt a `backend` router és a
[nativeRender](src/lib/nativeRender.ts) olvassa. Ez tankönyvi ADR-anyag (lásd
[13. szakasz](#13-adr-index-javasolt)).

### 9.3 A worker (`server/`)

Node/Express, **~40 végpont**, feladat-modulokra bontva (`ai.js`, `render.js`,
`tts.js`, `youtube.js`, `bgremove.js`, `depth.js`, `reframe.js`, `vision.js`,
`beats.js`, `color.js`, `storage.js`, `library.js`, `sfx.js`, …). Fő motívumok:

- **Render:** FFmpeg-lánc + headless Chromium (`playwright-core`) a
  szöveg/forma/felirat rasterhez. **Hibrid, skálázható:** rövid videók a lokális
  szerveren; a hosszabbak **BullMQ-queue (Redis) + S3** úton, külön
  `render-worker.js` process(ek)en — több példány = vízszintes skálázás.
- **AI:** `/ai/*` — assist, autoedit, story, highlights, translate, captionstudio,
  hooks. Provider-független (env-AI vagy a felhasználó BYOK-modellje).
- **Media:** proxy (720p munka-példány, a render mindig az eredetivel fut),
  waveform, thumbnails, captions (Whisper), TTS, storage-gateway (WebDAV/S3
  auth-proxy — a hitelesítés a workeren marad), library, music.
- **Védelem:** `proOnly`/`requireAuth` middleware, `corsAllowlist`, SSRF-guard
  ([ssrf.js](server/ssrf.js)), billing + RevenueCat webhook.

### 9.4 On-device render (natív modul)

[modules/remix-render](modules/remix-render/index.ts) — opcionális Expo natív
modul (`requireOptionalNativeModule`): a render-tervet MP4-re rendereli az eszközön
(AVFoundation/MediaCodec). Ez az **ingyenes `localRender`** út; Expo Go-ban `null`,
natív buildben az igazi modul.

### 9.5 Supabase (social + fizetés + felhő-projekt)

Postgres + Auth + Realtime + Storage + **RLS mindenhol**
([supabase/migrations/](supabase/migrations/)): `profiles` (az `auth.users`
tükre signup-triggerrel), `posts` (a szerkeszthető projekt JSONB-ként utazik →
egy koppintásos Remix), `follows/likes/saves/comments/notifications/reports`,
**denormalizált számlálók triggerrel**, **feed-RPC-k** (`get_feed` keyset,
`get_for_you` hot-rank), `subscriptions` (szerver-autoritatív), `shop_marketplace`
(atomi vásárlás-RPC), `project_collaboration`, `cloud_projects`, `media` bucket.
A kliens sosem self-grantol Pro-t/kreditet — csak szinkronizál.

---

## 10. AI-vezérlés — az AI mint command-forrás

**Anti-cél:** az AI *soha* nem írja közvetlenül a state-et vagy a React
komponenst. Az AI egy **command-forrás**, semmi több:

```
  buildAiContext()   ← RÉTEGZETT, tömör kontextus (NEM a teljes projekt-JSON):
  (aiCommands.ts)      global (cél) · relevant (sávok röviden) · current
                       (playhead/kijelölés) · memory (utolsó 15 esemény)
        │
        ▼
  askAssistant()  →  worker /ai/assist  →  whitelist-parancsok (zod-séma)
  (ai.ts)
        │
        ▼
  toEditorCommands()  ← PATCHABLE_FIELDS whitelist; ismeretlen mező kiesik;
  (aiCommands.ts)       szövegklip teljes klippé egészül; `aiReason` provenancia
        │
        ▼
  applyBatch(commands, 'ai')   ← egy köteg = EGY undo-lépés
```

Kulcs-tulajdonságok: **BYOK** — a felhasználó saját modellje task-onként
rendelhető ([aiProviders.ts](src/lib/aiProviders.ts) `AiTask`/`aiConfigForTask`);
**action preview** — a felhasználó *alkalmazás előtt* tételesen látja, mi fog
változni (`describeAiCommand`); **undo** — mivel command buson megy, egy
visszavonás az egész AI-köteget törli.

---

## 11. Minőség-kapuk és tesztelhetőség

- **`npm run audit`** = `tsc --noEmit` + `expo lint` + `jest`
  ([package.json](package.json)). Ez a merge-kapu.
- **Expo-mentes magok** → önmagukban tesztelhetők. Van is rájuk teszt:
  `frames`, `keyframes`, `trimEdit`, `rangeEdit`, `projectUtils`, `preCompose`,
  `safeZone`, `lruCache`, `netRetry`, `secureStorage`, `eventLog`,
  `captionFormats`, `parseGuards`, `cancel`, `autoVersion` (`*.test.ts`).
- **Szándékos lint-kivételek:** `react-hooks/immutability` és `react-hooks/refs`
  kikapcsolva — Reanimated shared value-k és expo-video/audio player-mutációk
  miatt ([AGENTS.md](AGENTS.md)).
- Új teszt helye: `src/**/*.test.ts` (kliens) vagy `server/**/*.test.js` (worker).

---

## 12. Mire van szükség, hogy PROFIK legyünk

A **kód** már pro-szintű (típus-kikényszerített invariánsok, pure reducer,
tesztelt magok). A **rés** a *rendszer-szintű dokumentáció fegyelemben* van — épp
abban, amit a Meta a saját RN-appjainál külön rétegként kezel. Konkrét,
prioritált teendők:

**P0 — a mag rögzítése (ez a fájl a kezdet)**
1. **Ez az Arch.md** — a hiányzó capstone. ✅ (most jött létre)
2. **ADR-fegyelem bevezetése.** A kódban *már meghozott* nagy döntéseket
   visszamenőleg ADR-ként rögzíteni (lásd [13. szakasz](#13-adr-index-javasolt)) —
   így a *„miért?"* nem vész el a git-history-ban.
3. **A command-készlet mint szerződés.** A `EditorCommand` unió + a
   `PATCHABLE_FIELDS` whitelist a kliens–AI szerződése; ezt dokumentálni és
   verziózni kell (a séma bővítése ADR-t érdemel).

**P1 — a hiányzó réteg-doksik (`docs/architecture/`)**
4. Rétegenként egy rövid `.md`: `runtime` (New Arch/Hermes), `state`, `commands`,
   `rendering` (a **preview↔render paritás** részletei), `ai`, `networking`
   (router + kapu), `storage`, `collaboration`, `performance`.
5. **Diagram-fegyelem.** A jelen ASCII-diagramok jók belépőnek; a hosszú életű
   ábrákat érdemes forrásból generálni (pl. Mermaid), hogy ne rothadjanak el.

**P2 — a rendszer „élővé" tétele**
6. **Teljesítmény-költségvetés dokumentálva** (a Meta New-Arch-célja): mi fut a
   UI-szálon (gesztus/animáció), mi a JS-szálon, mi a workeren — és a határok
   *miért* ott vannak (lásd 5–6. szakasz). Egy `performance.md` explicit budget-tel.
7. **Kontraktus-tesztek a worker↔kliens határra** (a `*Client.ts` és a
   `server/*.js` séma-egyezésére), hogy a felhő-verzióváltás ne törjön csendben.
8. **Observability terv** (naplózás/metst a workeren, render-queue-egészség) — az
   [OPS.md](OPS.md)/[DEVOPS.md](DEVOPS.md) kiegészítéseként.

### Javasolt dokumentum-struktúra (Meta-minta)

```
docs/
├── ../Arch.md                      ← ez a fájl (a gyökérben marad, capstone)
├── architecture/
│   ├── runtime.md      · New Architecture, Hermes, szálmodell
│   ├── state.md        · zustand, session ≠ projekt, autosave
│   ├── commands.md     · a command-szerződés + reducer-invariánsok
│   ├── rendering.md    · a preview↔render paritás mechanikája
│   ├── ai.md           · kontextus-építés, whitelist, BYOK-routing
│   ├── networking.md   · backend-router, Pro-kapu, retry
│   ├── storage.md      · asset-identitás, relink, providerek
│   ├── collaboration.md· operation-szinkron terve (cloud_projects)
│   └── performance.md  · szál-budget, mesteróra, proxy
├── decisions/          · ADR-001 … (lásd lent)
└── development/
    ├── coding-standards.md   (nagyrészt AGENTS.md-ből)
    ├── testing.md
    └── release.md            (EAS, worker deploy — DEVOPS.md-ből)
```

> **Elv:** a `docs/architecture/*` a *miért* és a *hogyan együtt* — a
> feature-listákat (STUDIO.md, PRO.md) és az ops-részleteket (OPS/DEVOPS) nem
> ismételjük, csak linkeljük.

---

## 13. ADR-index (javasolt)

Architecture Decision Record = *döntés + kontextus + a mérlegelt, elvetett
alternatívák*. Az alábbiak **már megszülettek a kódban** — csak rögzíteni kell
őket. Minta (a `command bus`-ra):

> **ADR-001 — Minden szerkesztés command buson megy.**
> **Döntés:** nevesített `EditorCommand` + pure `applyCommand` reducer; a
> projektet közvetlenül soha nem írjuk.
> **Miért:** a timeline és a preview szinkronban kell maradjon · az AI
> determinisztikus, undo-zható mutációt igényel · az undo/redo egyetlen
> csővezetéket kíván · a kollaboráció szerializálható műveleteket.
> **Elvetve:** komponens-lokális state · közvetlen mutáció · független
> timeline-state.

Kezdő ADR-lista (mind valós döntés a mai kódból):

| ADR | Döntés | Horgony |
|---|---|---|
| 001 | Command bus + pure reducer | [commands.ts](src/lib/commands.ts) |
| 002 | Egy rAF-mesteróra, a playhead a mester | [usePlaybackClock.ts](src/hooks/usePlaybackClock.ts) |
| 003 | Preview közelít, render a mérvadó | [types/project.ts](src/types/project.ts) |
| 004 | On-device = ingyen, felhő = lehet Pro (típus-kikényszerítve) | [capabilities.ts](src/lib/capabilities.ts) |
| 005 | Session-állapot ≠ projekt-igazság | [editorStore.ts](src/store/editorStore.ts) (`SESSION_RESET`) |
| 006 | AI = validált command-forrás, sosem közvetlen state | [aiCommands.ts](src/lib/aiCommands.ts) |
| 007 | Hibrid render (lokális ≤N mp · felhő queue+S3) | [server/queue.js](server/queue.js), [render.js](server/render.js) |
| 008 | Proxy nem-destruktív; a render mindig az eredetivel | [proxy.ts](src/lib/proxy.ts) |
| 009 | Egyetlen backend-router a címért és a Pro-kapuért | [backend.ts](src/lib/backend.ts) |
| 010 | BYOK task-alapú AI-provider routing | [aiProviders.ts](src/lib/aiProviders.ts) |

---

## 14. Szószedet / konvenciók

- **Command / dispatch / actor** — nevesített művelet · a bus belépője · ki adta
  ki (`user`/`ai`/`system`).
- **Playhead / mesteróra** — az idő-igazság a store-ban; minden réteg ehhez
  szinkronizál.
- **Paritás** — az előnézet és a render vizuálisan egyeznek; eltérésnél a
  **render** a mérvadó.
- **`where` / `pro`** — hol fut a művelet · kell-e előfizetés
  ([capabilities.ts](src/lib/capabilities.ts)).
- **`*Client.ts`** — egy `lib/` mag hálózati párja (a mag expo-mentes marad).
- **Asset-identitás** — md5 + méret ujjlenyomat a relinkhez (a projekt hivatkozik,
  nem birtokol).
- **Timebase** — `project.fps` frame-rács; timecode `HH:MM:SS:FF`
  ([frames.ts](src/lib/frames.ts)).

---

*Karbantartás: ez a fájl akkor frissül, amikor egy rétegközi szerződés vagy egy
ADR-szintű döntés változik — nem minden PR-nél. Fájl-szintű részletet ide ne
másolj; azt a kód és a [README.md](README.md) hordozza.*
