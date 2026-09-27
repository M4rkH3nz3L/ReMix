# 🧩 ReMix — Alkotói hiánypótlás (MISSING)

> Forrás: a 2026-09-27-i **profi-creator audit** (11 alkotótípus) + a **Creator OS-vízió** [devs/source/MASTER.md](../source/MASTER.md) (28 szekció).
> Testvér-tervek: [devs/tasks/VIDEO.md](./VIDEO.md) · [devs/tasks/AUDIO.md](./AUDIO.md) · [devs/tasks/IMAGE.md](./IMAGE.md) · [devs/tasks/PROD.md](./PROD.md).
> Ez a doksi a **keresztmetszeti hiányok teljes backlogja**: a platform-mag (Creator OS) + minden alkotói stúdió + a közös rendszerek — mind a **valódi app-architektúrához** kötve (command bus, capability-katalógus, projekt-modell, worker). A per-stúdiós összhangosítás a testvér-tervekben él; ez a **új-képesség** gazda-lista.

---

## 0. Kiindulás és cél

**A MASTER.md központi felismerése (ezt tegyük magunkévá):**

> **Nem 100 külön feature hiányzik — a közös Creator OS hiányzik**, amely ugyanazt az asset/projekt/AI/social/workflow rendszert MINDEN művészeti ág számára használhatóvá teszi. A ReMix ma még „videós appként" gondolkodik (`Project → Timeline → Clips → Render`); a cél az, hogy a videós mag **platformmaggá** absztrahálódjon, ahol a `VideoProject` csak **egy dokumentumtípus** a sok közül.

**Az app DNS-e (ezt ne törjük meg):** a [src/lib/capabilities.ts](../../src/lib/capabilities.ts) katalógus kimondja az üzleti modellt — **kézi szerkesztés + alap export = mindig ingyen, eszközön fut** (`where: 'local'`, `pro: false`, típus-szinten kényszerítve); az **AI-réteg + felhő-HD render = Pro** (`where: 'cloud'`). Minden új képesség EBBE a katalógusba kerül egy sorral, és a `where`/`pro` mező dönt a paywallról.

**Jó hír — nem újraírás, hanem absztrakció.** A MASTER.md konklúziója: a **Command Bus + Project Model + Creative Canvas + AI Context + Asset + Social + Marketplace** kombináció MÁR alkalmas erre. A legnagyobb technikai lépés:

```text
Project → CreativeDocument → Scene / Layer / Track / Asset → Commands → AI → Renderers
```

ahol a `layer / transform / mask / keyframe / asset / version / command / AI-context / collab / search / export` **közös** videóban, képben, designban, hangban és később más dokumentumokban is. A projekt-modell ehhez már félúton van: a `Project.kind` (`video`/`image`/`audio` — [src/types/project.ts](../../src/types/project.ts:200)) + a kanonikus sávok + `imageDocs` ezt a közös alapot adják.

**Vezérelvek** (a testvér-tervekből + MASTER-ből):

- **Új képesség = új sor a capability-katalógusban** ([capabilities.ts](../../src/lib/capabilities.ts)). On-device funkciót SOHA nem kapuzunk Pro mögé.
- **Command bus mindenhez.** Minden szerkesztő-művelet `dispatch(command, actor)` / `applyBatch(...)` — undo/redo ingyen; a collab-szinkron és az AI is ezen megy. Új médiatípus is a meglévő `EditorCommand` unionra képződjön le, ahol lehet.
- **Egy motor, több nézet.** A `Project` a közös állapot; a stúdiók ne forkolják az előnézet/worker-motort. Új médiatípus = új `kind` + renderer, nem külön app.
- **Provider-független rétegek.** AI ([aiProviders.ts](../../src/lib/aiProviders.ts)), tár ([storageProviders.ts](../../src/lib/storageProviders.ts)), TTS ([tts.ts](../../src/lib/tts.ts)) már adapter-mintás — az új generatív/stream/DSP-szolgáltatók IS adapterként jöjjenek (dev-fallback → cloud-provider csere env-vel).
- **Ne 5 külön app legyen egy appban.** A creator-profil dönti el, MELYIK eszközök vannak előtérben — nem külön appot kap, hanem a releváns stúdiókat.

**Jelölés:** 🔴 P0 (platform-mag / több alkotót nyit meg) · 🟠 P1 · 🟡 P2 · 🔵 P3. `[ ]` = nyitott · `[x]` = már megvan (a teljesség kedvéért). A ✚ = a MASTER.md-ből behozott új tétel; a ★ = az audit-epikből.

---

## 1. Alkotó-fedettségi térkép (2026-09-27-i audit)

| Alkotó | Fedettség | Fő hiány → epik |
| --- | --- | --- |
| 🎬 Videós | ~85% ✅ | média-management, felvétel-luxus, LUT-import, átmenet-render → **S-VIDEO** + [VIDEO.md](./VIDEO.md) |
| ✍️ Író | ~75% 🟢 | Writer Studio **mag kész** (Book→Chapter+bible+markdown+AI-context — `writingDoc.ts`); hátra: UI + worker → **S-WRITER** |
| 🎧 Producer | ~75% 🟢 | mixer-mag **kész** (channel/bus/send/sidechain/master + validáció/render-terv — `mixer.ts`); hátra: worker-render + automation-lane + UI → **S-PRODUCER** |
| 🤖 AI Creator | ~55% 🟡 | **0 generatív média** + Creator Memory → **S-GENAI** + **PM4/PM5** |
| 📸 Fotós | ~62% 🟡 | non-destruktív RAW-develop param-mag **kész** (detail+sync — `photoDevelop.ts`); hátra: RAW-dekódolás + retus-ecsetek + culling-UI → **S-PHOTO** |
| 🎨 Designer | ~62% 🟡 | layout-engine **mag kész** (auto-layout/align/distribute/grid/constraints — `layout.ts`); hátra: vektor-node-editing + komponens/design-system + vektor-export → **S-DESIGN** |
| 🎤 Énekes | ~55% 🟡 | pitch-correction + harmónia terv-mag **kész** (`pitch.ts`); hátra: pitch-detektálás/render (worker) + comping + UI → **S-VOCAL** |
| 🎙️ Podcaster | ~40% 🟠 | multitrack+remote, silence/filler-vágás, fejezet/audiogram/RSS → **S-PODCAST** |
| 🎮 Gamer | ~55% 🟡 | capture-terv + jel-alapú auto-highlight/montázs **mag kész** (`gameHighlights.ts`/`captureCenter.ts`); hátra: natív rögzítés + UI + stream → **S-GAMER** |
| 💻 Developer | ~45% 🟠 | diff/patch **mag kész** (Git/diff + DIFF→APPROVE→APPLY — `codeDiff.ts`); hátra: code-editor/file-tree/terminal UI + API-doksi/SDK → **S-CODE** + **E8** |
| 🎵 Zenész | ~40% 🟠 | időzítés-mag **kész** (bars/beats+tempo-map+quantize+loop — `musicTime.ts`); hátra: MIDI/piano-roll/hangszer/felvétel → **S-MUSIC** |

---

## 2. A központi réteg: CREATOR OS (MASTER §1, §28, architektúra)

A cél-architektúra (MASTER §-záró ábra) — minden szerep EBBE ül, nem külön appba:

```text
                    ReMix
                      │
                 Creator OS
                      │
 ┌────────────────────┼────────────────────┐
WORKSPACE            ASSETS               AI
 │                    │                    │
PROJECTS          UNIVERSAL LIBRARY    AGENTS
 └────────────────────┼────────────────────┘
                      │
               CREATIVE ENGINE (command bus + renderers)
                      │
       ┌──────────────┼──────────────┐
      TIME          CANVAS          AUDIO
      VIDEO         DESIGN          MUSIC
       └──────────────┼──────────────┘
             SOCIAL / COLLAB → MARKETPLACE → PUBLISHING → ANALYTICS
```

A 3. szakasz a **platform-mag** epikjei (P0 — ezek nyitnak meg mindenkit), a 4. a **stúdiók** (per-szerep), az 5. a **közös rendszerek** (P1), a 6. az összesített prioritási mátrix.

---

## 3. Platform-mag epikek (🔴 P0 — Creator OS foundation)

### PM1 — Project → Workspace + CreativeDocument  ·  MASTER §16, §26, záró-szakasz

**Miért P0:** ez a MASTER legfontosabb technikai lépése. Ma `Project → timeline`; kell egy **Workspace**-konténer, amiben a projektek, assetek, dokumentumok, feladatok együtt élnek — hogy a creator „ne hagyja el az appot".

- [x] ✅ **`CreativeDocument` absztrakció** (adat-szintű alap) — a `Project.kind` union additívan kiterjesztve `writing`/`code`/`music`/`design`-ra ([src/types/project.ts](../../src/types/project.ts:19)); migráció nem kell (a `kind` szabad mező, a régi projektek `video`-ra esnek). Az igazság-forrás a [projectKinds.ts](../../src/lib/projectKinds.ts) katalógus (`PROJECT_KINDS` + `isEditableKind`/`creatableKinds`): az új fajták **adat-szinten léteznek** (Workspace/Graph/Memory/⌘K hordozza+címkézi őket), de `editable:false` → nem hozhatók létre UI-ból, amíg a stúdiójuk el nem készül; a create-választó és a `studioRoute` ebből épül (12 teszt, i18n címkék en/hu/de). *Hátra: a közös primitívek (layer/transform/mask/keyframe) általánosítása + a writing/code/music/design stúdiók.*
- [x] ✅ **Workspace-konténer** — projektek/assetek/memória/notes/tasks/brand/sablon EGY állapotban. **Mag kész:** [workspace.ts](../../src/lib/workspace.ts) — a négy platform-mag magot komponáló aggregátum-gyökér: `ingestProject` (projekt-ref + Asset Library-behúzás usage-gel + Creator Memory-tanulás egy hívásban, idempotens), Planner-mag (`WorkspaceTask` kanban + `tasksByStatus`), és a származtatott KÖZÖS nézetek `workspaceGraph` (Creative Graph a teljes workspace fölött) + `workspaceSearch`/`workspaceSearchDocs` (⌘K az egész workspace-re) — 18 teszt. **Felhő-perzisztencia KÉSZ:** [workspaceClient.ts](../../src/lib/workspaceClient.ts) — a `workspace` JSONB tábla + a per-user library/memory ÖSSZEÁLLÍTÁSA (`load/saveWorkspace`, `splitWorkspace`/`assembleWorkspace`; migráció 20260927170000 PRODon). *Hátra: UI + collab-megosztás.*
- [x] ✅ **Creative Graph** (MASTER §26) — Person → Project → {Video/Audio/Image/Design} → Asset/Brand/Template/Music/AI kapcsolati gráf, hogy az AI ténylegesen értse a creator világát. **Mag kész:** [creativeGraph.ts](../../src/lib/creativeGraph.ts) — tiszta, szerializálható node/edge modell + `buildGraph` (person/projekt/asset/brand/sablon a projekt-`remixOf` lineage-ből és az Asset Library `usage`-éből) + `projectsUsingAsset` / `assetsUsedInProject` / `lineage` / `descendants` lekérdezések (18 teszt). *Hátra: UI (a gráf származtatott — a perzisztencia a workspace/library JSONB-n át megy).*

### PM2 — Universal Asset Library  ·  MASTER §14 (P0)

**Miért P0:** „minden creator közös alapja". Ma a média a `storageProviders`-en át böngészhető (szerver-tár/WebDAV/S3), és van vision-index — de nincs egységes „My Assets" tag/kollekció/verzió/usage-kezeléssel.

- [x] részben: média-források adaptere ([storageProviders.ts](../../src/lib/storageProviders.ts)) + semantic vision-keresés ([visionSearch.ts](../../src/lib/visionSearch.ts), [visionIndex.ts](../../src/lib/visionIndex.ts)).
- [x] ✅ **Központi „My Assets"** típusonként: 🎥 videó · 📸 fotó · 🎵 zene · 🎙️ voice · 🔊 SFX · 🎨 grafika · 🔤 font · 🧊 3D · 📝 dokumentum · 💻 kód · 🤖 AI. **Mag kész:** [assetLibrary.ts](../../src/lib/assetLibrary.ts) — `AssetKind` (11 típus) + `LibraryAsset` modell + `assetsByKind` csoportosítás.
- [x] ✅ Asset-metaadat: **preview · tags · collections · favorites · versions · source · license · creator · project-usage · AI-embedding**. **Mag kész:** [assetLibrary.ts](../../src/lib/assetLibrary.ts) — tag/collection/version/favorite/rating reducerek, `filterAssets`/`searchAssets`, `findDuplicates`/`findMissing`, `ingestProjectAssets` (projekt-`Asset[]` behúzás usage-gel) — 30 teszt. **Felhő-perzisztencia KÉSZ:** [assetLibraryClient.ts](../../src/lib/assetLibraryClient.ts) — per-user `asset_library` JSONB (`load/saveAssetLibrary`, védett `parseLibraryDoc`). *Hátra: UI + szerver-embedding feltöltés.*
- [x] ✅ **Usage-lekérdezés** („Hol használtam ezt a logót?", „Mely projektek használják ezt a zenét?") — `recordUsage`/`usageOf`/`assetsInProject` az Asset Libraryben, ÉS a [creativeGraph.ts](../../src/lib/creativeGraph.ts) `projectsUsingAsset` a gráf fölött.

### PM3 — Universal Search / ⌘K  ·  MASTER §15 (P0)

**Miért P0:** ma a Smart Search videó-scope-ú ([search.tsx](../../src/app/search.tsx) + [visionSearch.ts](../../src/lib/visionSearch.ts)); kell **globális** kereső minden tartalomra.

- [x] ✅ **⌘K / Global Search** minden felett: Projects · Assets · People · Messages · Music · Photos · Videos · Documents · Templates · Shop · AI. **Mag kész:** [universalSearch.ts](../../src/lib/universalSearch.ts) — `SearchScope` (11) + `SearchDoc`/`search`/`groupByScope` + `projectToDoc`/`assetToDoc` adapterek. *Hátra: ⌘K UI + további adapterek (people/messages/shop).*
- [x] ✅ **Természetes nyelvi keresés** („tavalyi nyári fotók", „hol a neon logóm", „félbehagyott projektek", „hol használtam a H3nz3L intro-t") — **Mag kész:** on-device, determinisztikus NL-parser ([universalSearch.ts](../../src/lib/universalSearch.ts) `parseQuery`/`resolveTimeRange`): scope- + státusz- (félbehagyott/kész) + idő-szűrők (ma/tegnap/e heti/idei/tavalyi/nyári) magyar+angol, kulcsszó-pontozással — 25 teszt. A szemantikus (embedding) réteg a meglévő [visionSearch.ts](../../src/lib/visionSearch.ts)-ben marad (felhő).

### PM4 — Creator Profile 2.0 (alkotói identitás)  ·  MASTER §13 (P0)

**Miért P0:** a profil ne csak account legyen, hanem **alkotói identitás több szereppel egyszerre** (Videós + Producer + Designer). Sok alapja MÁR megvan.

- [x] részben: 4-rétegű profil (identity/creator/social/showcase + per-mező privacy, bio/típusok/skillek editor — [creatorProfile.ts](../../src/lib/creatorProfile.ts)) + multi-role RBAC ([roles.ts](../../src/lib/roles.ts)) + AI-persona ([aiPersona.ts](../../src/lib/aiPersona.ts)).
- [ ] ✚ **Equipment · Software · Portfolio · Presets-könyvtár · Brand** rétegek a profilhoz (a [brandKit.ts](../../src/lib/brandKit.ts) + [creatorPreset.ts](../../src/lib/creatorPreset.ts) bekötésével).
- [x] ✅ **Creator Memory** (MASTER §12) — „ez az én YouTube-stílusom", „mindig ilyen feliratot használok", „kedvenc hangszíneim/zenéim/LUT-om/kamerám". Az AI-context perzisztens rétege → minden stúdió AI-ja ezt olvassa. **Mag kész + bekötve:** [creatorMemory.ts](../../src/lib/creatorMemory.ts) — 10-kategóriás `MemoryFact` modell, kulcs-alapú dedup + `reinforceFact` auto-tanulás, `observeProject` (determinisztikus jel-kinyerés kész projektből → a „AI LEARNS" loop magja), scope-os `rankedFacts`/`memoryContext`, `mergeMemory` (felhő+helyi); és a [aiCommands.ts](../../src/lib/aiCommands.ts) `buildAiContext` új, opcionális `creatorMemory` rétege (back-compat) — 24 teszt. **Felhő-perzisztencia KÉSZ:** [creatorMemoryClient.ts](../../src/lib/creatorMemoryClient.ts) — per-user `creator_memory` JSONB (`load/saveCreatorMemory`, védett `parseMemoryDoc`). *Hátra: szerkesztő-UI.*
- [ ] ✚ **Szerep-vezérelt UI** — a profil dönti el, mely stúdiók/eszközök vannak előtérben (nem külön app).

---

## 4. Stúdió-epikek (per-szerep — audit-epik ★ + MASTER feature-listák ✚)

> Minden stúdió: mai állapot (fájlokkal) → csoportosított `[ ]` tételek → a felveendő capability-ID-k. A nehéz feldolgozás mindig a workerbe (BullMQ), az on-device DSP ingyen.

### S-VIDEO — 🎬 Videós  ·  audit-★E10 + MASTER §2

**Mai állapot:** a legérettebb stúdió (timeline, ripple/roll/slip/slide, keyframe/Graph, color, mask/rotoscope, multicam, reframe, 3D, render 480p–8K). Részletek: [VIDEO.md](./VIDEO.md).

**Felvétel (MASTER §2):** [ ] ✚ több-szegmenses kamera · [ ] pause/resume · [ ] front/back multicam felvétel · [ ] külső/Bluetooth mikrofon + input-választás · [ ] exposure/focus/WB-lock · [ ] manuális ISO/shutter · [ ] 24/25/30/50/60/120 fps · [ ] log/flat felvétel · [ ] **teleprompter** · [ ] remote camera · [ ] clap/sync marker · [ ] recording presets. *(A [CameraRecorder.tsx](../../src/components/editor/CameraRecorder.tsx) az alap.)*

**Vágás (MASTER §2):** [ ] ✚ J/L/K finomítás · [ ] iPad/desktop keyboard-shortcutok · [ ] pancake timeline · [ ] source + program monitor · [ ] **audio-méterek** · [ ] clip-markerek · [ ] subclipek · [ ] adjustment clips · [ ] **nested sequences** (a `buildPreComposePlan` mag megvan — [preCompose.ts](../../src/lib/preCompose.ts)) · [ ] compound-sequence sablonok.

**Média-management (MASTER §2 — P0!):** [ ] ✚ projekt-binek (Footage/Audio/Images/Graphics/Fonts/SFX/Exports/Proxies) · [ ] smart bins · [ ] tags/ratings/favorites/color-labels · [ ] metadata · [ ] duplicate + missing-media detektálás · [ ] relink (a `.ReMix` relink megvan — [videdFile.ts](../../src/lib/videdFile.ts)) · [ ] proxy-státusz/forrás-felbontás/codec/FPS/audio-channels/kamera-metaadat. *(→ a PM2 Asset Library projekt-scope-ú nézete.)*

**NLE-luxus (audit ★):** [ ] ★ LUT-**import** klipre (ma csak .cube-export — [colorClient.ts](../../src/lib/colorClient.ts)) · [ ] ★ színkerekek (3-way) · [ ] ★ HSL hue-tartományok · [ ] ★ **átmenet-render** (a `TransitionOut` típus megvan, a vizuális render nem — README/Skia-fázis) · [ ] ★ XML/EDL/AAF · [ ] ★ batch render-sor.

### S-PHOTO — 📸 Fotós  ·  audit-★E6 + MASTER §3

**Mai állapot:** rétegelt kép-stúdió ([imageDoc.ts](../../src/lib/imageDoc.ts)), görbék/HSL/3-way ([curves.ts](../../src/lib/curves.ts)), AI-retus (bgremove/upscale/sky/depth/face). Részletek: [IMAGE.md](./IMAGE.md).

**RAW (MASTER §3):** [ ] RAW/DNG/ProRAW import + metaadat *(natív dekódolás — worker, hátra)* · [x] ✅ **non-destruktív RAW-develop param-mag** — [photoDevelop.ts](../../src/lib/photoDevelop.ts) (13 teszt, audit-zöld): a `ClipAdjust` tónus/szín-vezérlőire (exposure/highlights/shadows/whites/blacks/temperature/tint/vibrance/görbék) épít + új **DetailParams** (**texture/clarity/dehaze** · sharpening · noise-reduction · chromatic-aberration · lens-distortion · vignette), `clampDevelop`/`isNeutralDevelop`, **copy/paste + `syncDevelop`** (csoport-allowlist: tone/color/detail/lens — a batch-fotózás magja), `developToFilterPlan` (deklaratív, a workerhez) + `summarizeDevelop`. *Hátra: a natív RAW-dekódolás + a filter-terv render-bekötése + retus-ecsetek.*

**Retus (MASTER §3):** [ ] ✚ **healing brush** · [ ] clone stamp · [ ] blemish removal · [ ] skin-retouch · [ ] teeth/eyes · [ ] dodge & burn · [ ] frequency-separation workflow · [ ] face-aware retouch (a face-detektálás megvan — [faceClient.ts](../../src/lib/faceClient.ts)).

**Selection (MASTER §3):** [ ] ✚ subject/person/sky/background/hair/object select · [ ] color-range · [ ] luminosity-range. *(A bgremove-maszk + sky-maszk az alap.)*

**Workflow + batch (MASTER §3 — nagyon fontos):** [ ] ✚ Import → **Culling → Rating → Selection** → Develop → Retouch → Preset → Album → Export · [ ] copy/paste adjustments · [ ] **sync edits** · [ ] batch AI/resize/watermark/export · [ ] contact sheet · [ ] before/after · [ ] compare view. *(A [batchEdit.ts](../../src/lib/batchEdit.ts) allowlist-mintája az alap.)*

**Profi kimenet (audit ★):** [ ] ★ EXIF/XMP megőrzés · [ ] ★ ICC-profilok (sRGB/AdobeRGB/ProPhoto) · [ ] ★ nyomdai (DPI/CMYK/kifutó) · [ ] ★ 16/32-bit pipeline.

### S-DESIGN — 🎨 Designer  ·  audit-★E5 + MASTER §4

**Mai állapot:** vektor-alakzatok ([draw.ts](../../src/lib/draw.ts)), multi-stop gradiens ([gradient.ts](../../src/lib/gradient.ts)), tipográfia, 3D-matrica, Brand Kit. Részletek: [IMAGE.md](./IMAGE.md).

**Vector engine (MASTER §4):** [ ] ✚ **SVG natív szerkesztés** · [ ] pen/node-editing · [ ] boolean/compound paths · [ ] path-operations · [ ] outline stroke · [ ] expand appearance · [ ] pattern-fill · [ ] vector masks. *(A Bézier-path + stroke/fill/gradient már megvan.)*

**Layout engine (MASTER §4):** [x] ✅ **MAG kész** — [layout.ts](../../src/lib/layout.ts) (22 teszt, audit-zöld): **auto-layout** (`autoLayout` flex: direction/gap/padding/align/justify + stretch), **constraints/responsive resize** (`resizeWithConstraints`: start/end/stretch/center/scale tengelyenként), **grids/columns** (`gridColumns` margó+gutter, `snapToGrid`), **alignment/distribution** (`alignRects` 6 él, `distributeSpacing`/`distributeCenters`, `boundingBox`). *Hátra: guides/rulers UI + spacing-tokenek a design-systemből + a rétegekre kötés.*

**Components + design system (MASTER §4):** [ ] ✚ Component (variants/properties/states/instances) · [ ] design-tokenek (colors/typography/spacing/radius/shadows). *(A Brand Kit → komponens-könyvtárrá bővítve — PM2/PM4.)*

**Figma-szerű collab (MASTER §4):** [ ] ✚ multiplayer-kurzor · [ ] comments/mentions/selections · [ ] version history · [ ] branch/duplicate · [ ] review mode. *(A video-collab-live [collabLive.ts](../../src/lib/collabLive.ts) átemelése a kép-stúdióba.)*

**Export (MASTER §4 + audit ★):** [ ] ★✚ **SVG · PDF · WebP · AVIF** · [ ] transparent · [ ] @1x/@2x/@3x · [ ] **artboard/batch-export** több platform-méretre (a [variantPreview.ts](../../src/lib/variantPreview.ts) mintájára).

### S-MUSIC — 🎵 Zenész  ·  audit-★E4 + MASTER §5

**Mai állapot (a legnagyobb szakadék):** hang-összeállítás megvan (multitrack, fade/volume/pan, beat-detektálás — [beats.ts](../../src/lib/beats.ts)), de **nincs DAW**. Nehéz DSP → worker ([AUDIO.md](./AUDIO.md)).

**Timeline (MASTER §5):** [x] ✅ **BPM/time-signature/tempo-map ↔ sec/bars-beats** + **bars/beats** + **loop-régiók** + **quantization** — [musicTime.ts](../../src/lib/musicTime.ts) (22 teszt, audit-zöld): `timeAtBeat`/`beatAtTime` (tempo-mapen integrálva), `beatToBarsBeats` (TICKS_PER_BEAT), `beatGridTimes`/`barGridTimes` rács, `quantizeBeat`/`quantizeTime` (subdivision + strength + **swing**), `loopFromBars`/`loopWrap`, `timingFromBeatGrid` bridge a detektált BPM-ből ([beats.ts](../../src/lib/beats.ts)). *Hátra: a rács/loop/quantize bekötése a timeline-UI-ba + a klip-vágások kvantálása.*

**MIDI (MASTER §5):** [ ] ✚ MIDI-sávok · [ ] **piano roll** · [ ] note-editing/velocity · [ ] quantize/swing/transpose · [ ] scale-lock · [ ] chord-detection. *(Nagy tétel — saját RFC, ne csússzon be scope nélkül.)*

**Instruments (MASTER §5):** [ ] ✚ sampler · [ ] drum machine · [ ] synth · [ ] piano/bass/guitar/orchestral.

**Felvétel + audio (MASTER §5):** [ ] ✚ multitrack-felvétel · [ ] punch in/out · [ ] overdub/takes/comping · [ ] latency-kompenzáció/monitoring · [ ] time-stretch · [ ] **pitch-shift** · [ ] reverse · [ ] crossfade (a normalize/fade/gain már megvan).

### S-VOCAL — 🎤 Énekes  ·  audit-★E4 + MASTER §6

**Mai állapot:** Voice Enhance/de-reverb/de-esser/kompresszor/EQ/reverb/delay a workeren ([voicechain.js](../../server/voicechain.js)), élő felvétel. Vokál-specifikus eszköz nincs.

- [ ] ✚ vocal recording + **takes/comping** (a felvétel ma egyklipes — [AudioStudioBody.tsx](../../src/components/studio/audio/AudioStudioBody.tsx)).
- [x] ✅ **pitch-correction terv-mag + harmony-generation** — [pitch.ts](../../src/lib/pitch.ts) (19 teszt, audit-zöld): note↔freq↔MIDI, hangnév-parse, 9 skála + `snapMidiToScale`, `pitchCorrectionPlan` (auto-tune állítható `strength`-tel, unvoiced-átengedés), diatonikus `harmonize`/`harmonyLine` (terc/kvint/oktáv), `pitchCorrect` capability (cloud+pro, i18n en/hu/de). *Hátra: a pitch-DETEKTÁLÁS + a shift-RENDER a workeren (Rubber Band/world), pitch-visualization UI.*
- [ ] ✚ **timing-correction** · [x] ✅ **harmony-generation** (mag — lásd fent) · [ ] doubles/adlibs · [ ] vocal-layering.
- [x] noise-removal/de-reverb/de-esser/compressor/EQ/reverb/delay ([voicechain.js](../../server/voicechain.js)).
- [ ] ✚ saturation · [ ] konvolúciós reverb (a mostani szintetikus `aecho` helyett).
- [ ] ✚ **AI Vocal Assistant** — „Tisztítsd meg az éneket", „rádióhangzás", „duplázd meg a refrént", **hangkarakter-leírásból** vezérelve (nem konkrét élő előadó utánzása). A command buszra képződik.

### S-PRODUCER — 🎧 Producer  ·  audit-★E7 + MASTER §7

**Mai állapot:** bit-pontos **master** (kétmenetes loudnorm + multiband — [render.js](../../server/render.js), [audioMaster.ts](../../src/lib/audioMaster.ts)), Demucs stem-szeparáció ([stems.ts](../../src/lib/stems.ts)). A **mixer-mag KÉSZ** — [mixer.ts](../../src/lib/mixer.ts) (18 teszt, audit-zöld): a routing-modell + validáció + render-terv.

**Mixer + busz (MASTER §7):** [x] ✅ csatorna-strip: **Volume/Pan/EQ/Compressor/Sends/Sidechain/Bus-output** ([mixer.ts](../../src/lib/mixer.ts) `ChannelStrip` + immutábilis reducerek) · [x] ✅ **busz-rendszer** (drum/vocal/music/fx/group → master; többlépcsős, `resolveOutputChain`/`signalPath`) · [x] ✅ **sidechain** (`Sidechain` key-channel modell — az `autoDuck` valódi alapja; a render-terv hordozza) · **routing-validáció** (dangling output + **ciklus-detektálás** + hiányzó send-cél/sidechain-kulcs) + solo/mute-feloldás + `toRenderPlan` (busz-topo-rendezés a workerhez) + `mixerFromProject` bridge. *Hátra: a worker ffmpeg-filtergráf a render-tervből + FX-inzertek + UI.*

**Automation (MASTER §7):** [ ] ✚ volume/pan/**plugin-paraméter**/send/mute/filter automation (a volume-keyframe már megvan).

**Mastering (MASTER §7):** [x] LUFS/true-peak/limiter/compressor/EQ/loudness-meter/waveform/clipping-detektálás ([audioAnalyze.ts](../../src/lib/audioAnalyze.ts)) · [x] ✅ **stereo-width** + **parallel (NY) kompresszió** MODELLEZVE a [mixer.ts](../../src/lib/mixer.ts) `MasterBus`-ában (render-terv hordozza) · [ ] parametrikus multiband + állítható crossover. *Hátra: a worker-render bekötése a `MasterBus`-ból.*

**Stem separation (MASTER §7 — „óriási feature"):** [x] Vocals/Drums/Bass/Other (Demucs, env-gated Pro — [stems.ts](../../src/lib/stems.ts)) · [ ] ✚ Guitar/Piano/FX stemek · [ ] stem-preview render nélkül · [ ] minden stem azonnal szerkeszthető sávként.

### S-GAMER — 🎮 Gamer  ·  audit-★E2 + MASTER §8

**Mai állapot:** highlight (beszéd-alapú — [highlightsClient.ts](../../src/lib/highlightsClient.ts)), speed-ramp, reframe, kamera-felvétel. A **capture-terv + jel-alapú auto-highlight MAG kész** ([captureCenter.ts](../../src/lib/captureCenter.ts) + [gameHighlights.ts](../../src/lib/gameHighlights.ts), 18 teszt, audit-zöld).

**Capture Center (MASTER §8):** [x] ✅ **`screenRecord` capability** (`local`/ingyen) a [capabilities.ts](../../src/lib/capabilities.ts)-ben (i18n en/hu/de) + **capture-terv modell** ([captureCenter.ts](../../src/lib/captureCenter.ts)): screen/game/webcam/mic/**system-audio/party-audio KÜLÖN sávokra**, **replay-buffer** (instant-replay) mp, **hotkey-markerek**, terv-validáció (nincs forrás / nincs videó / ütköző sáv). *Hátra: a natív rögzítés (ReplayKit/MediaProjection) bekötése.*

**Gaming editor (MASTER §8):** [x] ✅ kill/death/round/clip **markerek** + **automatic highlight / best-moments** — [gameHighlights.ts](../../src/lib/gameHighlights.ts) `detectHighlights` (**audio-energia-csúcs + jelenet-váltás + markerek** klaszterezve — a beszéd-alapúnál gazdagabb), `momentsToSegments` (pre/post keret + átfedés-összevonás), `buildMontage` (top-score válogatás cél-hosszra + időrend + trim), `filterByMarker` („mutasd az összes killt"). *Hátra: match-timeline UI + facecam-kulcs-preset (chroma/bgremove+PIP fölött) + game-audio/voice-chat sávok bekötése.*

**AI (MASTER §8):** [ ] ✚ „Mutasd az összes killt" · „30 mp-es montage" · „legjobb clutch" · „TikTok-verzió" — a command buszra, a highlight+reframe+beat ([beats.ts](../../src/lib/beats.ts)) újrahasznosításával. [ ] multi-forrás auto-szinkron (game+webcam+mic — a [multicam.ts](../../src/lib/multicam.ts) `correlateOffset`). [ ] live-stream (RTMP) → **E-Growth**.

### S-WRITER — ✍️ Író  ·  MASTER §9 (teljesen hiányzó stúdió)

**Mai állapot:** a `writing` dokumentumtípus + Writer Studio **MAG kész** — [writingDoc.ts](../../src/lib/writingDoc.ts) + [markdown.ts](../../src/lib/markdown.ts) (23 teszt, audit-zöld). A `writing` kind adat-szinten él (PM1 CreativeDocument), a Workspace/Graph/Memory/⌘K hordozza. Videó-oldali segédek: [captionStudio.ts](../../src/lib/captionStudio.ts), [storyClient.ts](../../src/lib/storyClient.ts), [textedit.ts](../../src/lib/textedit.ts).

**Editor (MASTER §9):** [x] ✅ **Markdown**-mag ([markdown.ts](../../src/lib/markdown.ts) — `stripMarkdown`/`wordCount`/`charCount`/`readingTimeMin`/`extractOutline` TOC-vázlat, kódblokk-tudatosan) + `writingStats` (fejezetenként összegzett szó/karakter/olvasási-idő). *Hátra: WYSIWYG/lists/tables/footnotes/embeds UI.*

**Dokumentum-struktúra (MASTER §9):** [x] ✅ **Book → Chapters + story bible** — [writingDoc.ts](../../src/lib/writingDoc.ts) `WritingDoc` (chapters + `BibleEntry`: character/location/research/note) a command-bus reduceren (`applyWritingCommand`: fejezet/bible CRUD + `MOVE_CHAPTER` átrendezés, mind immutábilis/undo-zható). *Hátra: a Workspace-hez kötés + felhő-perzisztencia (a JSONB-minta kész).*

**Writing tools (MASTER §9):** [x] ✅ capability-alap — `writeAssist` (cloud+pro) a [capabilities.ts](../../src/lib/capabilities.ts)-ben (rewrite/tone/summarize/expand/translate/outline az AI-command buszra), i18n en/hu/de. *Hátra: a worker-végpont + a konkrét eszköz-parancsok bekötése.*

**AI context (MASTER §9):** [x] ✅ **`buildWritingContext`** ([writingDoc.ts](../../src/lib/writingDoc.ts)) — az AI megkapja: aktuális fejezet (kivonat) · **előző fejezet szinopszisa** · szereplők/helyszínek/kutatás/jegyzetek · a Creator Memory **`writing`-stílusa/terminológiája** (PM4 `memoryContext`).

**Videós-átfedés (audit ★):** [ ] ★ teleprompter (→ S-VIDEO felvétel is) · [ ] ★ script/screenplay-sablon · [ ] ★ kézi felirat-finomhangoló UI.

### S-PODCAST — 🎙️ Podcaster  ·  audit-★E3 + MASTER §10

**Mai állapot:** felvétel + Voice Enhance + Whisper-átirat + **audio-only export** (WAV/MP3/AAC/FLAC — [render.ts](../../src/lib/render.ts)) + podcast-master preset. A disztribúció + multitrack-workflow hiányzik.

**Podcast Studio (MASTER §10):** [ ] ✚ Host/Guest/Music/SFX/Ads/**Room-tone** sávok · [ ] **multitrack + remote guests** · [ ] separate audio tracks · [ ] **automatic sync** (a [multicam.ts](../../src/lib/multicam.ts) korrelációja) · [ ] **silence-removal** (a `silence` végpont megvan, tegyük ki panelként) · [ ] **filler-word removal** · [ ] speaker-detection.

**Kimenetek (MASTER §10):** [ ] ✚ **chapters/timestamps** · [ ] show-notes · [ ] clips · [ ] **audiograms/waveform-video** (a [waveform.ts](../../src/lib/waveform.ts) csúcslistájából) · [ ] subtitles (megvan) · [ ] podcast-cover · [ ] **RSS-feed** generálás (worker-végpont) · [ ] show-oldal ([channel/[id].tsx](../../src/app/channel/%5Bid%5D.tsx) fölött).

**Egy felvételből → sok (MASTER §10 — „nagyon ReMix-kompatibilis"):** [ ] ✚ AI-pipeline: 2 órás podcast → Full episode + 10 highlight + 20 Shorts + quote-cards + audiogramok + transcript + chapters + show-notes + social-posztok. *(→ Workflow Template, §5-Templates.)*

### S-CODE — 💻 Developer  ·  MASTER §11 (új kategória)

**Mai állapot:** nincs Code Studio; van viszont erős **AI Command Bus**, amit a MASTER kifejezetten újrahasznosíthatónak nevez erre.

- [ ] ✚ **Minimum**: code-editor + syntax-highlight · file-tree/tabs/search · terminal · preview · [x] ✅ **Git/diff** (mag) · snippets · extensions · env-variables. *(Nem teljes VS Code-klón első körben.)*
- [x] ✅ **AI-workflow „DIFF → APPROVE → APPLY" magja** — [codeDiff.ts](../../src/lib/codeDiff.ts) (13 teszt, audit-zöld): sor-alapú LCS `diffLines` + `diffStats`, `formatUnifiedDiff`/`parseUnifiedDiff` (unified `@@`-hunk), `applyUnifiedDiff` (**horgony-illesztéssel** sor-szám-eltolódásra robusztus, konfliktus-jelzéssel; round-trip garancia diff→format→parse→apply). Az AI javaslata DIFF, amit a user JÓVÁHAGY → ez alkalmazza (az [aiCommands.ts](../../src/lib/aiCommands.ts) mintájára). *Hátra: code-editor + file-tree/terminal + a diff-approve UI.*

### S-GENAI — 🤖 AI Creator  ·  audit-★E1 + MASTER §12

**Mai állapot:** kimagasló AI-**megértő/optimalizáló** réteg (auto-edit, átirat, vision-keresés, bgremove/upscale/sky/depth/face, TTS, hooks, story) + BYOK multi-modell ([aiProviders.ts](../../src/lib/aiProviders.ts)) — de **0 generatív média**. Az AI-creator a MASTER szerint **nem egy szerep a többi mellett, hanem az egész fölötti réteg**.

**Generatív média (audit ★ — a nagy rés):** [x] ✅ **MODELL+CAPABILITY kész** — [genMedia.ts](../../src/lib/genMedia.ts) (8 teszt, audit-zöld): `genImage` (text→kép/kép→kép/**inpaint/outpaint**) · `genVideo` (text/kép→videó) · `genMusic` · `voiceClone` (kötelező **hozzájárulás**-modell) · `aiAvatar` — mind `cloud`+`pro` capability (i18n en/hu/de) + `validateGenRequest` (bemenet-követelmények) + `buildGenPlan` (deklaratív job-terv a provider-adapternek). *Hátra: a tényleges inferencia-adapter bekötése (worker/BYOK) + generáló UI.*

**AI-context (MASTER §12):** [x] ✅ az AI ismeri: Roles/Skills/Preferences/Brand/Projects/Assets/History → **Creator Memory** (PM4, [creatorMemory.ts](../../src/lib/creatorMemory.ts) + `buildAiContext`) + **Creative Graph** (PM1, [creativeGraph.ts](../../src/lib/creativeGraph.ts)); a teljesítmény-visszacsatolás az E-Loop ([creatorLoop.ts](../../src/lib/creatorLoop.ts)).

---

## 5. Közös rendszer-epikek (🟠 P1 — MASTER §17–25, §27)

### E-Templates — Template System 2.0 / Workflow Templates  ·  MASTER §17

**Mai állapot:** videó-sablonok ([constants/templates.ts](../../src/constants/templates.ts)) + shop (template/LUT/SFX/font/preset). A **workflow-sablon MAG kész** — [workflowTemplate.ts](../../src/lib/workflowTemplate.ts) (9 teszt, audit-zöld).

- [x] ✅ **Workflow Template** — nem preset, hanem LÁNC. Beépítve: *YouTube Creator* (Footage → AI-Select → Transcript → Filler-Removal → Hook → Captions → B-roll → Color → Thumbnail → Export → Publish) + *Podcast* (Record → Sync → Clean → Transcript → Chapters → Clips → Audiogram → Publish). Minden lépés opcionálisan egy **`CapabilityId`-hez kötött → a Pro/felhő-kapu a KATALÓGUSBÓL jön** (`templateProSteps`/`templateRequiresPro`). Futtatás: `startRun`/`advanceRun`/`markStep`/`skipStep`/`nextPendingStep`/`runProgress`/`isRunComplete`. *(A [workflow.ts](../../src/lib/workflow.ts) a per-projekt stage-követő; ez az újrahasználható sablon+futtatás.)* *Hátra: a lépés-`kind`-ok bekötése a tényleges műveletekhez (command bus) + UI.*

### E-Versions — Version Control (globális)  ·  MASTER §18

**Mai állapot:** a **globális verzió-mag KÉSZ** — [versions.ts](../../src/lib/versions.ts) (14 teszt, audit-zöld); a videó-tartalmi diff a [versionDiff.ts](../../src/lib/versionDiff.ts), a kódé a [codeDiff.ts](../../src/lib/codeDiff.ts).

- [x] ✅ **globális állapotgép**: Draft → Review → Approved → Published → Archived (`VersionStatus` + `canTransition`/`nextStatuses`, csak engedélyezett átmenet) + v1/v2/v3 auto-címke.
- [x] ✅ minden creator-típusnál (domain-agnosztikus, a verzió `ref`-et hordoz): **restore/duplicate/branch/compare/approve** — `addVersion`/`duplicateVersion`(=branch)/`restoreVersion` (nem-destruktív) / `setStatus`+`approveVersion`/`publishVersion`/`archiveVersion` / `lineage` (ős-lánc) / `compareVersions` (meta) / `latestByStatus` / `statusCounts`. A **tartalmi** „mi változott?" a típus-specifikus diff (video `versionDiff`, code `codeDiff`, szöveg a `markdown`) a `ref`-snapshotokból. *Hátra: comment-réteg + a snapshot-tárolás bekötése + UI.*

### E-Collab — Creative Collaboration  ·  MASTER §19

**Mai állapot:** collab-mag KÉSZ (presence, kurzorok, parancs-szinkron, resync, collab-chat, gépel-jelző — [collabLive.ts](../../src/lib/collabLive.ts)).

- [x] live-presence/cursor/selection · project-roles (owner/editor/viewer — [collab.ts](../../src/lib/collab.ts)).
- [x] ✅ **MAG kész** — [collabComments.ts](../../src/lib/collabComments.ts) (11 teszt, audit-zöld): reviewer/producer szerep (`ReviewRole`) · **mentions** (`extractMentions`) · **timecode/frame/audio/design komment** (`CommentAnchor` + `commentsInTimeRange`) · szálak (reply/resolve) · **approval-workflow** állapotgép (`requestReview`/`submitDecision` → draft/in-review/changes-requested/approved). *Hátra: a live-szinkron ([collabLive.ts](../../src/lib/collabLive.ts)) rákötése + UI (komment-pinek a timeline-on/vásznon).*

### E-ChatCmd — Chat → Creative Command Center  ·  MASTER §20

**Mai állapot:** chat/DM/csoport KÉSZ ([chat.ts](../../src/lib/chat.ts), [inbox.tsx](../../src/app/inbox.tsx)).

- [x] ✅ **MAG kész** — [chatCommands.ts](../../src/lib/chatCommands.ts) (11 teszt, audit-zöld): `parseChatCommand` a chat-üzenetet strukturált workspace-paranccsá alakítja (open/send/version/export/share/schedule/search), címzett- (magyar rag + angol to/with), idő- (tegnap/holnap/e heti), platform- és mp-hossz-kinyeréssel — magyar+angol. *Hátra: a parancsok bekötése a command bushoz (send/share/export a meglévő chat/collab/render fölött) + UI.*

### E-Planner — Creator Planner  ·  MASTER §21

**Mai állapot:** a Planner-**MAG kész** — [planner.ts](../../src/lib/planner.ts) (10 teszt, audit-zöld) a Workspace `WorkspaceTask` kanbanja fölött ([workspace.ts](../../src/lib/workspace.ts)). A [schedules.ts](../../src/lib/schedules.ts) a render-sor-poll (más réteg).

- [x] ✅ pipeline: Ideas → Backlog → Production → Editing → Review → **Scheduled → Published** — a `TaskStatus`/`TASK_STATUSES` kanban + `nextStatus`/`prevStatus`/`isActive` ([planner.ts](../../src/lib/planner.ts) `PIPELINE`).
- [x] ✅ **tartalomnaptár** platformonként — `CONTENT_PLATFORMS` (YouTube/TikTok/Instagram/Spotify/Podcast/blog/newsletter) + `WorkspaceTask.platform`/`scheduledFor` + `scheduleTask` + `calendarByDate` (nap szerint) + `upcomingByPlatform`.
- [x] ✅ AI-lekérdezések magja: `weekPlan` („ezen a héten mit kell?"), `stalledTasks` („melyik áll félbe?" — aktív + rég nem érintett), `publishSchedule` („publikációs terv"), `plannerSummary` (kanban-darabszámok). *Hátra: kanban + naptár UI + a platform-publikálás bekötése.*

### E-Analytics — Creator Analytics  ·  MASTER §22

**Mai állapot:** az **analitika-MAG kész** — [analytics.ts](../../src/lib/analytics.ts) (13 teszt, audit-zöld); a poszt-számlálók/edit-sessionök/lépés-időzítések a hívótól jönnek, ez az ELEMZŐ réteg (dashboard-UI hátra).

- [x] ✅ **nem csak social**: `engagementRate`/`retentionRate` + `summarize` (Content) + `breakdownBy` (**melyik hook/thumbnail/template/platform működik** — átlag-engagement szerint rangsorolva) + `topPerformers`; **Workflow/Productivity**: `productivity` (mennyit szerkesztett — projekt/nap bontás) + `slowestSteps` (melyik workflow-lépés lassú, arányban).
- [x] ✅ AI-alap: **`whyItWorked`** — a tartalom engagement/views/retention eltérése a mezőny átlagától (|delta| szerint) → nyers alapanyag a „miért működött ez jobban?" válaszhoz. *Hátra: dashboard-UI + a nyers statok bekötése (feed-számlálók/eventLog).*

### E-Business — Creator Business / CRM  ·  MASTER §23

**Mai állapot:** hiányzik (van coin-wallet/payout [wallet.ts](../../src/lib/wallet.ts) + shop).

- [x] ✅ **MAG kész** (invoices/clients/quotes + pénzügy) — [business.ts](../../src/lib/business.ts) (6 teszt, audit-zöld): `Client` + `BusinessDoc` (quote/invoice, tételek, adókulcs, státusz) + származtatott pénzügy (`subtotal`/`taxAmount`/`docTotal`, `revenue`, `outstanding`, `clientRevenue`, `overdueDocs`). *Hátra: contracts/licenses/sponsorships/affiliate + a wallet/shop-bevétel bekötése + UI.*
- [x] ✅ **Creator CRM**: `CRM { clients, docs }` + `docsByClient` — a Client → Invoices/Deliverables váz. *(Projects/Files/Messages a Workspace/chat fölött köthető.)*

### E-Market — Marketplace 2.0  ·  MASTER §24

**Mai állapot:** Shop kész ([shop.ts](../../src/lib/shop.ts)) — template/LUT/SFX/font/preset, atomi vásárlás-RPC, 30% jutalék.

- [ ] ✚ **vásárolható/eladható bővítés**: music/**sample-packs/MIDI/instruments**/3D-assets/graphics/photo-presets/**design-systems/workflows/AI-agents/AI-personas** → creator→creator economy.

### E-Agents — AI Agent Marketplace  ·  MASTER §25

**Mai állapot:** AI-persona-alap megvan ([aiPersona.ts](../../src/lib/aiPersona.ts)); agent-piac nincs.

- [ ] ✚ szerep-agentek (🎬 Video Editor / 🎨 Art Director / 🎵 Music Producer / 📸 Photo Editor / ✍️ Writing / 🎙️ Podcast Producer / 💻 Coding / 📱 Social Media) — mind UGYANAZ az API: READ → UNDERSTAND → PLAN → PROPOSE → APPROVE → **COMMAND BUS** → EXECUTE → VERIFY. *(A mostani AI Edit Engine az alap.)*

### E-Loop — Retention loop  ·  MASTER §27

- [x] ✅ a „függővé tétel" loop **magja kész** — [creatorLoop.ts](../../src/lib/creatorLoop.ts) (8 teszt, audit-zöld): a `LOOP_STAGES` (create→save→share→publish→analyze→learn) + `loopStageOf`/`loopProgress`, és a ZÁRÓ visszacsatolás: `analyticsInsights` (a mezőny-átlag fölött teljesítő győztes hook/thumbnail/template lift-tel) → **`learnFromAnalytics`** = az „AI LEARNS" lépés, ami a tanulságot a Creator Memory `workflow`-tényévé írja (stabil kulccsal → ismétlésre MEGERŐSÍT). Így a következő CREATE már a tudással indul → **CREATE BETTER**. *(A remix + feed + AI-context megvolt; ez zárja a kört.)* *Hátra: a nyers statok bekötése + a memória-olvasás a generáló AI-ban (már bekötve a `buildAiContext`-be).*

---

## 6. Prioritási mátrix (MASTER §28 + audit egyesítve)

| Prioritás | Rendszer / stúdió | Miért | Epik |
| --- | --- | --- | --- |
| 🔴 P0 | Universal Asset Library | minden creator közös alapja | **PM2** |
| 🔴 P0 | Creator Profile 2.0 (+ Creator Memory) | szerepek + skill + brand + AI | **PM4** |
| 🔴 P0 | Workspace + CreativeDocument | ne csak videóprojekt legyen | **PM1** |
| 🔴 P0 | Universal Search / ⌘K | minden tartalom megtalálható | **PM3** |
| 🔴 P0 | Creative Graph | AI + cross-media alap | **PM1** |
| 🔴 P0 | Image/Design Studio | fotós + designer belépő | **S-PHOTO/S-DESIGN** |
| 🔴 P0 | Audio/Music Studio alap | zenész + producer belépő | **S-MUSIC/S-PRODUCER** |
| 🔴 P0 ★ | Generatív AI-média | AI-creator belépő (0 → van) | **S-GENAI** |
| 🔴 P0 ★ | Capture & Stream | gamer belépő | **S-GAMER** |
| 🟠 P1 | Podcast Studio | jól épül a meglévő audio/AI-ra | **S-PODCAST** |
| 🟠 P1 | Writer Studio | új creator-kategória | **S-WRITER** |
| 🟠 P1 | Creator Planner | napi visszatérés | **E-Planner** |
| 🟠 P1 | Creative Collaboration | csapatok | **E-Collab** |
| 🟠 P1 | Creator Analytics | feedback loop | **E-Analytics** |
| 🟠 P1 | Marketplace 2.0 | creator economy | **E-Market** |
| 🟠 P1 | Template System 2.0 / Workflows | erősebb, mint presetek | **E-Templates** |
| 🟠 P1 | Version Control (globális) | minden creator-típusnak | **E-Versions** |
| 🟡 P2 | Code Studio | developer creator | **S-CODE** |
| 🟡 P2 | AI Agent Marketplace | AI-ökoszisztéma | **E-Agents** |
| 🟡 P2 | Creator Business / CRM | teljes creator OS | **E-Business** |
| 🟡 P2 | Chat → Command Center | workspace-vezérlés | **E-ChatCmd** |
| 🔵 P3 | Videós NLE-luxus | már 85% | **S-VIDEO** / [VIDEO.md](./VIDEO.md) |

---

## 7. Alkotónkénti hiány-checklist (appendix — minden persona egy pillantással)

**🎬 Videós** → **S-VIDEO** · [VIDEO.md](./VIDEO.md): [ ] média-management (binek/tags/ratings) · [ ] felvétel-luxus (multicam/lock/fps/teleprompter) · [ ] source/program monitor + audio-méter · [ ] nested/adjustment clips · [ ] LUT-import · [ ] színkerekek · [ ] átmenet-render · [ ] XML/EDL · [ ] batch render-sor

**📸 Fotós** → **S-PHOTO**: [ ] RAW/DNG-develop · [ ] healing/clone/skin-retus · [ ] subject/sky/color/lum select · [ ] culling/rating/compare · [ ] batch sync/AI/export · [ ] EXIF/ICC/nyomdai · [ ] 16/32-bit

**🎨 Designer** → **S-DESIGN**: [ ] vektor-motor (pen/boolean/node) · [ ] layout-engine (auto-layout/grid/token) · [ ] komponens+design-system · [ ] Figma-collab · [ ] SVG/PDF/WebP/AVIF-export · [ ] artboard/batch

**🎵 Zenész** → **S-MUSIC**: [ ] bars/beats+tempo-map · [ ] loop/quantize · [ ] MIDI+piano-roll · [ ] hangszerek (sampler/synth/drum) · [ ] multitrack-felvétel/comping · [ ] time-stretch/pitch-shift

**🎤 Énekes** → **S-VOCAL**: [ ] pitch-visualization/correction · [ ] timing-correction · [ ] harmony/doubles/layering · [ ] saturation/konvolúciós reverb · [ ] AI Vocal Assistant

**🎧 Producer** → **S-PRODUCER**: [ ] mixer csatorna-strip + busz-rendszer · [ ] sidechain · [ ] automation (plugin-param) · [ ] stereo-width/parametrikus multiband/parallel · [ ] Guitar/Piano/FX-stem + preview

**🎮 Gamer** → **S-GAMER**: [ ] screen/game-recording · [ ] system/party-audio külön sáv · [ ] replay-buffer/instant-replay · [ ] kill/round-marker + match-timeline · [ ] auto-highlight/montage AI · [ ] facecam-kulcs · [ ] stream

**✍️ Író** → **S-WRITER**: [ ] rich-text/Markdown editor · [ ] Book→Chapter+Characters/Research struktúra · [ ] writing-tools (rewrite/tone/outline/citation) · [ ] AI-context (szereplő/előző fejezet/stílus) · [ ] teleprompter/script-sablon

**🎙️ Podcaster** → **S-PODCAST**: [ ] multitrack+remote guest · [ ] silence/filler-word removal · [ ] speaker-detection · [ ] chapters/show-notes/timestamps · [ ] audiogram · [ ] RSS + show-oldal · [ ] „1 felvétel → sok" AI-pipeline · [x] audio-only export

**💻 Developer** → **S-CODE** + **E8**: [ ] code-editor+file-tree/tabs/terminal · [ ] Git/diff · [ ] AI READ→PLAN→DIFF→APPROVE→RUN · [ ] publikus API-doksi (OpenAPI) · [ ] oEmbed/embed · [ ] SDK/npm · [ ] esemény-webhookok · [ ] CLI/self-host

**🤖 AI Creator** → **S-GENAI** + **PM4/PM5**: [ ] text→kép · [ ] inpaint/outpaint · [ ] text/kép→videó · [ ] voice-clone · [ ] gen-zene · [ ] AI-avatar · [ ] Creator Memory · [ ] Creative Graph · [ ] AI Agent Marketplace

**Közös (mind)**: [ ] Workspace/Asset-Library/⌘K-search (PM1–3) · [ ] globális version-control · [ ] planner+naptár · [ ] analytics · [ ] marketplace 2.0 · [ ] chat-command-center · [ ] business/CRM

---

## 8. Javasolt sorrend (egy mondatban)

Előbb a **platform-mag** (PM1 Workspace/CreativeDocument → PM2 Asset Library → PM3 ⌘K-search → PM4 Profile 2.0/Memory → Creative Graph) — mert ezek nyitják meg egyszerre az összes alkotót; párhuzamosan a **fotós/designer + zenész/producer stúdió-alap** és a két audit-★ P0 (**generatív AI**, **capture/stream**); majd a **P1 közös rendszerek** (podcast/writer stúdió, planner, collab, analytics, marketplace 2.0, workflow-template, version-control); végül a **P2** (code-stúdió, agent-piac, business/CRM, chat-command) és a videós NLE-finomhangolás. Minden tétel a capability-katalógusból induljon, a command buszon menjen, a nehéz feldolgozás a workerbe — így a hiánypótlás nem töri meg az architektúrát, hanem a videós magot **platformmaggá** absztrahálja.

---

## 9. Kapcsolódó dokumentumok

- [devs/source/MASTER.md](../source/MASTER.md) — a Creator OS-vízió (ennek a doksinak a forrása)
- [devs/tasks/VIDEO.md](./VIDEO.md) · [devs/tasks/AUDIO.md](./AUDIO.md) · [devs/tasks/IMAGE.md](./IMAGE.md) — per-stúdió összhangosítás
- [devs/tasks/PROD.md](./PROD.md) — kiadási runbook (env, build, store)
- [src/lib/capabilities.ts](../../src/lib/capabilities.ts) — a képesség-katalógus (minden új funkció ide egy sorral)
- [AGENTS.md](../../AGENTS.md) — architektúra-alapelvek
