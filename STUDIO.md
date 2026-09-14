# Studio — a szerkesztő funkcionalitása + interaktív tutorial

Ez a dokumentum két dolgot ad:
1. a **Studio** (videószerkesztő mag) teljes **funkció-leltárát**, **SIMA** (ingyenes)
   és **PRO** (előfizetéses) bontásban;
2. egy **interaktív tutorialt** ([lásd lentebb](#interaktív-tutorial--leckék)) — rendezett
   leckék, mindegyik lépésenként a pontos UI-horoggal (panel · gomb · gesztus · eredmény),
   hogy egy felület-vezető (highlight-overlay) végig tudja mutatni a szerkesztő használatát.

Az architekturális részletek a [README.md](README.md)-ben; a hiteles capability-forrás a
[capabilities.ts](src/lib/capabilities.ts).

## A kapuzás elve — EGY szabály

> **Amit a készülék maga el tud végezni — worker, AI és felhő-tárhely nélkül —,
> az mindig INGYEN jár, előfizetés nélkül. Pro csak az, ami a fizetős felhő-workert
> / AI-t / cloud-tárhelyet használja.**

**Típus-szinten kikényszerített** a `capabilities.ts`-ben: minden képesség `where: 'local'`
(eszközön) vagy `where: 'cloud'` (felhő); a típus tiltja a `{ where: 'local', pro: true }`
sort, ezt minden `tsc --noEmit` auditálja. A Pro-műveletek `ensureCloud('<capability>')`-et
hívnak ([backend.ts](src/lib/backend.ts)); nincs Pro → `ProRequiredError` → paywall.

- **SIMA** = `where: 'local'` → mindig `pro: false`.
- **PRO** = `where: 'cloud'` + `pro: true` → AI / worker / HD-render / cloud-tárhely.
- **Kivétel** (felhőből jön, de mindenkinek jár): a **Hang-könyvtár** (`soundLibrary`);
  a **beat-detektálás** és a **hullámforma** szintén worker-served, de ingyenes (nincs
  külön capability alá vonva). A **szerkesztő-UX** (vágás, trim, kulcskocka, maszk-rajz)
  végig on-device → ingyen; a *render* effektjei ott égnek be, ahol a render fut
  (local = ingyen, felhő HD = Pro).

---

## SIMA — ingyenes (minden az eszközön fut)

### 🎬 Pro Workflow (Toolbar → Workflow) 🆕
- A profi vágás **10 szakasza** vezetett lépcsőként a „nagy toolbar" helyett:
  **Import → Rendszerezés → Nyers vágás → Finom vágás → Hang → Szín → Mozgás →
  Feliratok → Minőség-ellenőrzés → Export.** Nem új funkció — RÉTEG a meglévő eszközök
  fölött (`workflow.ts` + `WorkflowPanel`).
- **Állapot a projektből számolva** (`stageStatus`): minden szakasz pipát kap, ahol már
  van érdemi tartalom (pl. Szín = van adjust/LUT/filter; Feliratok = van felirat-klip;
  Export = renderelt), és a panel a **következő lépést** ajánlja.
- Szakaszonként a **meglévő panelek** nyílnak (a Command Bus-on át) — nincs duplikált logika.
- **Organize (asset-rendszerezés)** 🆕: minden médiához **kedvenc**, **1–5 csillag
  értékelés** és **címkék/„bin"-ek** (keep / talán / A-roll / B-roll / hook) — a döntés
  a projekt asset-jén tárolva (`UPDATE_ASSET` command, undo-zható), a metaadatokkal
  (felbontás/hossz) együtt. Ez a rész eddig hiányzott.

### Projekt és idővonal
- Projekt: létrehozás (16:9 / 9:16 / 1:1), lista, törlés, automatikus draft-mentés.
- **🎞️ Frame-kvantált idő-modell (timebase)** 🆕: a projekt saját **frame-rátán** fut
  (`project.fps`, 24/25/30/50/60 — a Pontos panelen állítható, `SET_FPS`, undo-zható). A
  **vágás a frame-rácsra ül** (`splitClipAt` → `snapToFrame`), a lejátszófej **kockára
  léptethető** (◀▮ ▮▶), és az idő **timecode**-ként jelenik meg (`HH:MM:SS:FF`) a
  transport-sávon és a Pontos panelen (`frames.ts`, pure + tesztelt). A régi projektek
  30 fps-re esnek vissza.
- Többsávos idővonal (videó/kép · PiP · grade · szöveg · felirat · overlay · interaktív ·
  zene · voiceover · SFX): középre rögzített lejátszófej, görgetéses léptetés, kétujjas
  zoom (0,2×–4×).
- **Undo/redo** (50 lépés), **stílus másolása/beillesztése**, **több-kijelölés** (köteg-
  stílus), klipek **össze-/szétkapcsolása** (link), mágneses illesztés haptikával.
- **🕓 Verziók / előzmények** (TransportBar → 🕓): **kézi pillanatkép** (snapshot) +
  🆕 **autosave-előzmény** (throttle-olt auto-verziók), **visszaállítás** (restore),
  🆕 **verzió duplikálása** és 🆕 **összehasonlítás a jelenlegivel** (hossz/klipszám +
  új/törölt/módosított klipek). On-device (projektenként max ~20 verzió); a **felhő-mentés**
  (`cloudSync`) erre épülő alap.

### ⚡ Teljesítmény / proxy (mobil)
- **Proxy-workflow**: a nehéz (4K/60/10-bit) forrásból a worker könnyű **munka-példányt**
  (proxy) készít; a vágás/előnézet ezt játssza (gyors dekódolás/seek), a **végső render
  mindig az eredetivel** fut (a klip uri-ja sosem íródik át).
- **Háttér-generálás**: importkor és projekt-nyitáskor automatikusan indul (nem blokkol).
- **🎚️ Proxy be/ki + minőség-tier** 🆕: Alacsony 360p / Közepes 540p / Magas 720p — a
  Profil → **Teljesítmény** alatt (a tier-váltás új proxyt old fel; a cache tierenként külön).
- **🧹 Cache-kezelés** 🆕: a proxy- és hullámforma-gyorsítótár mérete + egy gombos ürítés
  (a projekt-médiát és a renderelt kimeneteket nem érinti).
- **🗃️ Render-cache** 🆕: változatlan projekt + azonos beállítás → a legutóbbi render azonnal
  újrahasznosul (nincs újra-render), a kulcs a render-releváns tartalom + beállítás hash-e.
- **🛡️ Memóriavédelem** 🆕: legfeljebb 2 párhuzamos proxy-transzkód; a képkocka-cache LRU-
  korláttal (a legrégebbit dobja).

### Idővonal — profi vágó-eszközök 🆕
- **Vágás** a lejátszófejnél; **✂️ Borotva-mód** (insight-sáv olló): koppintásra vág az
  idővonalon a koppintás pontján.
- **Trim-mód választó** (insight-sáv): **Trim** (normál) · **Ripple** (a mögötte lévők
  csúsznak) · **Roll** (a szomszéddal közös vágáspont) · **Slip** (csak a forrás be/ki-pont)
  · **Slide** (a klip csúszik, a szomszédok elnyelik).
- **Clip-edge preview**: trim közben a vágott szélen lévő képkocka + időkód lebeg.
- **Ripple-törlés** (lyuk-mentes), **hézag-bezárás** a fő videósávon.
- **Sáv-műveletek**: némítás · solo · **láthatóság (👁️ szem, vizuális sávok)** · zárolás ·
  összecsukás · **magasság-léptetés** · **automatikus sáv-magasság**.
- **🧲 Illesztés**: erősség (ki/normál/erős) + **snap-célpont konfiguráció** (a magnet
  hosszú nyomása: lejátszófej / **klip-élek** / marker / beat / régió).
- **🅸🅾 Tartomány-kijelölés**: I/O pont → tartomány-sáv → **hurok a tartományon** (loop),
  **régió a tartományból**, **ripple range-törlés**.
- **🔖 Jelölők**: a lejátszófejnél könyvjelző; a vonalzón hosszú nyomásra **átnevezés /
  jegyzet / átszínezés / törlés**; a klip-él a jelölőre is illeszthető.
- **🎬 Multicam** 🆕 (Toolbar → Multicam): 2–6 kameraszög egy eseményről, **hang-alapú
  auto-sync** (waveform-keresztkorreláció), **élő szögváltás** (lejátszás közben a szögre
  koppintva vágást rögzít), majd **multicam-szekvencia** — néma videóklipek a fő sávra +
  a master szög folytonos hangja. A vágások utólag normál klipekként finomíthatók.

### Transport — profi lejátszás 🆕
- **J / K / L shuttle** (vissza / szünet / előre; ismételve 1×→2×→4×, visszafelé is).
- **Képkocka-pontos léptetés** (◀| / |▶, a projekt FPS-rácsára igazítva).
- **🕓 Előzmények**, **részlet-előnézet**, **hurok**.

### Animáció — kulcskocka + Graph Editor 🆕
- **Kulcskockázható csatornák**: méret (scale) · pozíció X/Y · **forgatás** · **átlátszóság**
  · hangerő (volume). (A forgatás/opacity per-frame a renderben is — guarded.)
- **📈 Graph Editor** (Pontos / Hang panel): value/time görbe a **valós interpolációval**
  kirajzolva; húzható kulcskocka-pontok (idő+érték), koppintásra hozzáadás, törlés,
  lejátszófej-kurzor.
- **Easing per kulcskocka**: linear · ease in · ease out · ease in/out · **🅷 hold (step)** 🆕
  (az érték a következő kulcskockáig áll, majd ugrik — pose-to-pose animáció) · **egyéni köbös
  Bézier** (húzható vezérfogók, overshoot is). Mind teljes **preview↔render paritással**.

### Vizuál
- **Szűrő** panel: 20+ színszűrő + erősség, blend-módok, kamera-mozgás (pásztázás/zoom/
  forgatás keyframe-mel), **maszkolás** (lásd külön).
- **🎯 Stabilizálás** 🆕 (videó): automatikus bemozdulás-kompenzálás a renderben
  (`deshake`) — **erősség** (keresési tartomány), **simaság** (blokkméret), **kivágás/zoom**
  (a bemozduló szélek eltüntetése), **rolling-shutter korrekció** (közelítő). A minőség-
  vizsgálat (Pro) MÉR, ez STABILIZÁL; az előnézet a nyers felvételt mutatja.
- **Grade / Adjust** réteg — **profi színfényelés** 🆕: film-look presetek + kézi
  vezérlők három csoportban:
  - **🎚️ Tónus:** expozíció · fényerő · kontraszt · csúcsfények · árnyékok · fehérek ·
    feketék (a 4 utóbbi egy 5-pontos tónusgörbén, mint Lightroomban).
  - **🎨 Szín:** valódi színhőmérséklet (`colortemperature` — a régi néma `colorbalance`
    helyett), árnyalat (zöld↔magenta), szaturáció, **élénkség (vibrance)**.
  - **📈 Görbék (Curves):** RGB + csatornánként (R/G/B) — koppints-húzd görbeszerkesztő
    (Catmull-Rom rajz, a render `curves` köbös spline-ja).
  - **🎨 HSL / Hue-Saturation:** globális színforgatás + telítettség + világosság.
  - **🩻 Szkópok:** waveform · RGB-parade · vektorszkóp · hisztogram (a kijelölt klip
    aktuális kockájáról, INGYEN, worker-generált).
  - **🎞️ 3D LUT (.cube):** tetszőleges LUT importja, ill. a teljes grade exportja
    `.cube`-ba (worker-bake az identitás-rácson) — megosztható/hordozható.
  - erősség, fade in/out. A pontos színkorrekció a renderben ég be, az előnézet tinttel közelít.
- **Áttűnés**: 3D (zoom/spin/flip/cube/circle/dissolve), 2D wipe/slide, stilizált
  (pixelize/blur/radial/fadeBlack/fadeWhite), fade. 🆕 **Átmenet-szerkesztő** (Áttűnés →
  szerkesztés): **hossz · irány** (irányos átmeneteknél az xfade-variáns) · **easing**
  (eased crossfade) · **erősség** · **elmosás / zoom-lökés / forgás-lökés** flourishök az
  átmenet-ablakban (a renderben `xfade` + enable-elt `gblur`/`zoompan`/`rotate`).
- **Sebesség / time remapping**: 0,1×–10× + **speed ramp** presetek és **egyéni
  sebesség-görbe** (velocity graph: húzható log-oszlopok, szegmens ±, kiegyenesítés),
  visszafelé, trim. 🆕 **⏱️ Idő-interpoláció** (optical flow / képkocka-keverés / nincs)
  a sima lassításhoz, és **❄️ Freeze / hold frame**: a lejátszófejnél állókocka — a kép
  áll, a többi klip ripple-el, az átívelő hang tovább szól.
- **Forma** panel: téglalap/ellipszis/vonal, kitöltés/gradiens/glow/kontúr, körítés,
  rács-illesztés — **+ pozíció/méret kulcskocka és objektum-követés**.
- **🌈 Fejlett gradient** 🆕 (forma + ImageDoc-háttér): **multi-stop** kitöltés,
  **lineáris / radiális / konikus** típus, állítható szöggel és stop-szerkesztővel
  (szín + pozíció / hozzáad / töröl). A renderben CSS/SVG gradient, az előnézetben
  expo-linear-gradient (lineáris) / react-native-svg (radiális); a konikus a renderben pontos.
- **✂️ Vonal-stílus** 🆕: **szaggatás (dash)** a path-on és a formakontúrokon, valamint
  **vonalvég** (kerek/vágott/négyzet) és **illesztés** (kerek/éles/levágott) a path-on.
- **✏️ Bézier path + toll-eszköz** 🆕: horgonypontok Bézier-fogókkal (`PathPoint`),
  **toll-szerkesztő** (koppints = új horgony, húzás = mozgatás, fogó-húzás = görbe),
  **simítás** (Catmull-Rom), **sarok**, **zárás** → zárt path = kitöltött (gradiens) forma.
- **🔗 Boolean műveletek** 🆕: **egyesítés / kivonás / metszet / kizárás** két kijelölt
  formán (többes kijelölés). Az eredmény összetett path (`subpaths` + `fill-rule`);
  a metszet/kivonás Sutherland–Hodgman-vágással pontos, függőség nélkül.
- **🎞️ Path-animáció** 🆕: **megrajzol (draw-on)** — a vonal megrajzolja magát
  (stroke-reveal + kitöltés-beúszás), és **morph** — a path átalakul egy rögzített
  célalakba. A render per-frame Chromium-képsort éget (a beérkező után a beállt alak áll ki).
- **Matrica** (ingyenes rész): emoji + részecske (konfetti/csillám/hó/parázs).
- **PiP** keret: lekerekítés, keret, árnyék, blend.

### Maszkolás 🆕 (Szűrő panel + vászon-fogantyúk)
- Alakzatok: **ellipszis / téglalap / poligon-presetek** + **invert**.
- **✏️ Rajzolt maszk**: ujjal/tollal körberajzolod a vásznon → poligon-maszk.
- **〰️ Simítás** (bezier-szerű, Catmull‑Rom), **pont-szerkesztés** (koppintás a keretre =
  új csúcs, hosszú nyomás a csúcson = törlés, húzás = mozgatás).
- **🩹 Kiterjesztés** (dilate/erode) és **🌓 maszk-opacity** (a kimaszkolt terület
  megtartott láthatósága).
- **🎬 Rotoszkóp / animált maszk**: a maszk geometriája kulcskockázható (lejátszófejnél
  szerkesztve) — a maszk követhet vagy képkockánként újrarajzolható; a render per-frame
  maszkot éget (arbitrer pontszám a worker-rasterizerrel, geq-fallbackkel).

### Compositing 🆕 (rétegek egymásra keverése)
- **Teljes blend-mód készlet** (11): multiply, screen, overlay, darken, lighten,
  difference, exclusion, hardlight, softlight, colordodge, colorburn — a **Forma**
  és a **PiP-keret** panelen; a preview `mixBlendMode`-dal, a render ffmpeg
  `blend=all_mode`-dal (WYSIWYG, a dodge/burn kissé közelít).
- **Green screen / chroma key** (`ChromaKey`) — teljes manuális workflow (az AI
  háttér-eltávolítás MELLETT, más folyamat): **🎨 Color Picker** (a vásznon a
  háttérre koppintva mintavett kulcs-szín, nem csak preset zöld/kék) → **Tolerance**
  (similarity) → **Feather** (él-lágyítás) → **🟢 Spill** (a zöld/kék perem
  eltávolítása, `despill`) → **✂️ Edge** (matte choke/grow, `erosion`/`dilation`).
- **🎭 Track / luma / alpha matte** (`ClipMatte`, Szűrő panel): egy külső kép
  fényereje (luma) vagy alfája (alpha) adja a klip átlátszóságát → clipping mask
  tetszőleges média-formára; invertálható.
- **🧱 Compound clip / pre-compose** (Toolbar → *Pre-compose* több-kijelölésnél):
  a kijelölt klipeket EGY beágyazott kompozíciós blokká fogja össze (hosszú
  projekthez). A render **rekurzívan** legyártja a beágyazott idővonalat, és a
  compound klipre a szokásos effekt/trim/blend/matte is hat. A **valós előnézet**
  a *Pontos* panel → **🧱 Compound → „Előnézet renderelése"** gombbal kérhető
  (proxy MP4, local-first; a timeline-on „🧱 Compound" címke jelzi).
- **Adjustment layer / grade-réteg** (`AdjustClip`): az alatta lévő teljes
  kompozitra ható színkorrekció (lásd Grade/Adjust).

### Szöveg és felirat
- **Szöveg**: tartalom, 20+ betűtípus, méret/vastagság/szín/háttér, animációk, pozíció +
  kulcskocka, sablonok, **objektum-követés**.
- **🔡 Pro tipográfia** 🆕: **betűköz (tracking)** · **sorköz (leading)** · **alapvonal** ·
  **kerning** — Chromium-renderben pontosan, előnézetben azonnal.
- **🎨 Szöveg-stílus+** 🆕 (granuláris, a preset fölé): **gradient-kitöltés** (szín→szín + szög) ·
  **kontúr** (szín/vastagság) · **árnyék** · **ragyogás** · **háttér-doboz** (padding/lekerekítés).
- **🎬 Kinetic typography** 🆕: **per-karakter / per-szó / per-sor** animáció — presetek:
  **Felúszás · Pop · Becsúszás · Gépelés · Hullám · Pattanás**, állítható egység-késleltetéssel
  és -hosszal. A render per-frame Chromium-képsort éget (a beérkező után a szöveg kiáll,
  a hullám ciklizál); az előnézet a lejátszófejből közelít.
- **🛤️ Szöveg görbén (text path)** 🆕: a betűk **ív / völgy / hullám / kör** mentén futnak
  (SVG `textPath`), állítható görbülettel.
- **🪟 Szöveg-maszk (videó a betűkben)** 🆕: a szöveg alakja ablak az alatta lévő képre —
  a betűkben éles videó, körülötte elmosott + sötétített változat.
- **🔁 Szöveg → Forma → Animáció** 🆕: a szöveget a teljes stílusával képpé sütjük (worker),
  és **forma-klipet** készítünk belőle — így a **forma-eszköztár** (blend / glow / kontúr /
  lekerekítés / kulcskocka / objektum-követés) is ráhúzható; a pozíció/skála kulcskockák
  átöröklődnek. A szövegklip megmarad (nem-destruktív).
- **Felirat**: kézi felirat, stílus-presetek, időzítés, **SRT-import**.
- **✨ Caption Studio**: kiemelt szavak + emoji (heurisztika ingyen / AI), **beszélő-színek** és
  **beszélő-címkék** (forrás+arc heurisztikus diarization), **szó-szintű karaoke-időzítés**,
  **okos pozíció** (arc-elkerülés).
- **🧼 Káromkodás-maszkolás** 🆕 (eszközön, determinista): maszk (f\*\*\*) / csillagok / törlés,
  en/hu/de szólistával; egy undo-lépés.
- **🛡️ Safe-zone validáció** 🆕 (eszközön): a platform-UI sávjain kívülre eső feliratokat
  visszatolja a biztonságos sávba (a `SafeZoneOverlay` arányaival egyezően).
- **Átirat**: szóra koppintás, tartomány-kijelölés, kitöltő/ismétlés-jelölés, ripple-törlés.

### Hang
- Zene/hang import, **voiceover-felvétel**, hangerő, fade in/out; **Hang-könyvtár**
  (worker-served, ingyen).
- **🎚️ Hangerő-automáció Graph Editorral** (value/time görbe, bezier).
- **🎛️ Pro-audio effektek** 🆕 (a klip-en tárolva, a renderben égnek be): **pan (L/R)**,
  **3-sávos EQ**, **high-pass / low-pass**, **kompresszor**, **limiter**, **de-esser**,
  **zajszűrés**, **reverb**, **delay**, **normalizálás**.
- **🥁 Beat → jelölők / vágáspontok** 🆕: a zene beatjeiből markerek vagy nem-destruktív
  vágás-előnézet, egy koppintással alkalmazva.

### Interaktivitás, Kép-dokumentum, Export
- **Hotspot**: URL / ugrás-időpontra / kvíz; **interaktív lejátszó**.
- **ImageDoc** (Creative Canvas): réteg-alapú képszerkesztés, rasterizálás klippé.
- **Local MP4 export** (`localRender`): natív render, felbontás/FPS/minőség, mentés a
  Fotókba, `.ReMix` projektfájl.
- **📝 Felirat-export**: **SRT** (univerzális) · **WebVTT** (web/HTML5, sor-pozícióval) ·
  **ASS** (stílussal: szín, pontos pozíció, félkövér, betűméret) — mind eszközön.
- **📤 Export-kontroll** (Toolbar → Export): **platform-presetek** (TikTok / Reels / Shorts /
  YouTube / Instagram — a preset a chipeket állítja), és **Haladó** kodek-beállítások:
  **H.264 / HEVC / AV1 / ProRes**, **bitráta-mód (CRF/VBR/CBR) + cél-bitráta**, **GOP**,
  **8/10-bit**, **színtér Rec.709 / Rec.2020 / HDR (PQ)**, **audio mintavétel/csatorna**.
  Az alap H.264 CRF eszközön (ingyen) renderel; minden tényleges pro encode-kontroll a
  felhő-workerre kerül (Pro).

### AI-asszisztens — ingyenes rész
- **Brand Kit**, **Motion/Look-csomagok**, **Intro/Outro** sablonok, **Safe zone**,
  variáns-előnézet/-alkalmazás, **beat-pulzus/flash**.

### 🎨 Creator Preset (Toolbar → Preset) 🆕
- Egy NEVEZETT „stílus" ("My YouTube Style") egy csomagban: **Font · Colors · Captions ·
  Logo** (Brand Kitből, a projektből derítve) + **Motion + Transitions** (Motion pack) +
  **Intro/Outro** sablon + **Sound** (a projekt zenéje).
- **Több preset** menthető/törölhető (eszközön, AsyncStorage), és **egy gombbal a
  projektre alkalmazható** ("Apply") — a meglévő, tesztelt apply-utakon (brand-feliratok,
  vízjel, motion pack, intro/outro ripple, háttérzene).

---

## PRO — előfizetéses (felhő-worker / AI / cloud-tárhely)

### Render és tárhely
- **Felhő HD/4K render** (`cloudRender`): **H.264 / HEVC / AV1 / ProRes**, **CRF/VBR/CBR
  bitráta + GOP**, **10-bit**, **HDR (PQ) / Rec.2020** — a FFmpeg-worker az enkóder-argokat a
  `RenderSettings`-ből építi (`videoEncoderArgs`/`audioEncoderArgs`); a ProRes `.mov`-ba megy.
  + AI-thumbnail/headline, feed-közzététel, platform-posztolás; **projekt felhő-mentés**
  (`cloudSync`); **kollaboráció** (`collab`).

### Import · felirat · beszéd
- **Import linkből** (`urlImport`, hibrid: eszközön ingyen próbál, worker-fallback Pro);
  **automatikus felirat** (`autoCaption`, Whisper + fordítás + karaoke); **felirat-fordítás** és
  **🌍 kétnyelvű felirat** (eredeti + fordítás egy sorban alatta); **TTS** (`tts`).

### 🤖 AI mint editor control layer (AssistantPanel)
- **Természetes nyelvű szerkesztés**: az utasítás (pl. „legyen az első 5 mp agresszívabb")
  végigmegy a **READ → UNDERSTAND → PLAN → COMMAND BUS → EDIT → PREVIEW → APPROVE** láncon.
  Az AI SOHA nem írja közvetlenül a projektet — csak a szigorú parancs-sémán át.
  - **READ/UNDERSTAND** (`buildAiContext`): rétegzett kontextus (projekt · sávok tömör
    klip-leírásokkal · playhead/kijelölés · esemény-napló · beszéd-átirat) — nem a nyers JSON.
  - **PLAN** (worker `/ai/assist`, structured output): a modell whitelist-parancsokat ad
    (UPDATE_CLIP a sebesség/szűrő/adjust/átmenet/hangerő/fade mezőkre, SPLIT/REMOVE,
    ADD_TEXT_CLIPS, SET_ASPECT, RENAME). „Vibe"-utasítás (agresszív/nyugodt/filmes) →
    az idősávba eső klipekre TÖBB mező együtt (speed + vivid szűrő + kontraszt + gyors átmenet).
  - **PREVIEW/APPROVE** 🆕 (`describeAiPlan`): tételes, FELOLDOTT terv — melyik klip, mi
    változik *miről mire* (pl. „video (0–3s): sebesség 1×→1.3× · színkorrekció: contrast +0.2”),
    a lépés indokával; a **👁 Megnéz** a lejátszófejet a régióra ugratja + kijelöli a klipet.
  - **COMMAND BUS/EDIT** (`toEditorCommands` → `applyBatch`, actor: `ai`): a teljes köteg
    **egyetlen, visszavonható lépés**.
- **AI Auto-Edit** (`autoEdit`, 15/30/60 mp + Shorts/B-roll), **story-struktúra**
  (`storyAnalyze`), **tempó-elemzés** (`pacingAnalyze`), **minőség-ellenőrzés**
  (`qualityScan`), **Smart Reframe** (`reframe`), Smart Search / Hook / Sound Design AI /
  Termékvideó.

### Kép-AI (FilterPanel)
- **Háttér-eltávolítás** (`bgRemove`) + szelektív igazítás, **ég-csere** (`skyReplace`),
  **3D/mélység/parallax** (`depth3d`), **arc-eszközök** (`faceTools`), **AI szín/auto-grade**
  (`colorAi`), **felskálázás** (`upscale`).

### 🎯 Objektum-követés (`objectTrack`) 🆕
- **Általános NCC-tracker** a workeren (**nem csak arc!**): kijelölsz egy objektumot a
  vásznon (pl. „kövesd a labdát"), a worker végigköveti a videón.
- **Bármi követheti**: **szöveg** · **matrica** (emoji=text) · **kép / 3D-kép** · **forma /
  3D-forma** · **maszk** (rotoszkóp) · **elmosás (blur)** — a követett pontsorból pozíció-
  (és méret-) kulcskockák épülnek, a maszknál track-keretek, a blurnál mozgó régió.
- **🎯 Track-simítás** 🆕: a nyers NCC-kimenet kockánként remeg — egy **zero-phase
  (nem késő) mozgóátlag** kisimítja a jittert, miközben a téma valós mozgását követi
  (`smoothTrackPoints`, pure + tesztelt); alapból bekapcsolva minden követés-fogyasztónál
  (pásztázás/pozíció kulcskockák), erősség-paraméterrel.
- **Arc-alapú változatok** a `faceTools` alatt (arc-blur, arcra ragasztott 3D, beszélő-címke).

### Matrica / 3D
- **3D matricák** (CC0 glTF), 3D anyag-/környezet-presetek, **3D arc-követés** (`faceTools`).

---

## Képesség-térkép (hiteles forrás: `capabilities.ts`)

| Capability | Címke | Csoport | Hol fut |
|---|---|---|---|
| `localRender` | Export az eszközön | **SIMA** | local |
| `soundLibrary` | Hang-könyvtár | **SIMA** (felhő-kivétel) | cloud |
| `cloudRender` | Felhő HD/4K render | PRO | cloud |
| `cloudSync` | Projekt felhő-mentés | PRO | cloud |
| `collab` | Projekt-kollaboráció | PRO | cloud |
| `urlImport` | Import linkből (YouTube/TikTok) | PRO¹ | cloud |
| `autoCaption` | Automatikus felirat (Whisper) | PRO | cloud |
| `tts` | Szöveg → beszéd | PRO | cloud |
| `autoEdit` | AI Auto-Edit (+ Shorts/B-roll) | PRO | cloud |
| `storyAnalyze` | AI story-struktúra | PRO | cloud |
| `pacingAnalyze` | AI tempó-elemzés | PRO | cloud |
| `qualityScan` | Felvétel-minőség ellenőrzés | PRO | cloud |
| `reframe` | AI újrakeretezés | PRO | cloud |
| `objectTrack` 🆕 | Objektum-követés (NCC) | PRO | cloud |
| `bgRemove` | Háttér-eltávolítás | PRO | cloud |
| `skyReplace` | Ég-csere | PRO | cloud |
| `depth3d` | 3D / mélység / parallax | PRO | cloud |
| `faceTools` | Arc-eszközök | PRO | cloud |
| `colorAi` | AI szín / auto-grade | PRO | cloud |
| `upscale` | Felskálázás | PRO | cloud |

¹ `urlImport`: local-first ingyen; csak a worker-fallback Pro.
² Worker-served, de **INGYEN** (determinisztikus mérőeszközök/renderek, nem AI, `renderServerUrl`):
  hang-könyvtár · beat/hullámforma · színpipetta · **🩻 szkópok** · **🎞️ LUT-export** ·
  **🔁 Szöveg → Forma bake** 🆕.
🆕 = az utolsó fejlesztési körökben érkezett.

---

## Interaktív tutorial — leckék

**Hogyan használd tutorial-motorként:** minden lecke lépések sora, minden lépés három
mezővel: **Művelet** (mit tegyen a felhasználó) · **Hol** (a kiemelendő UI-elem: panel,
gomb-címke vagy gesztus) · **Eredmény** (mit lát). A felület-vezető a „Hol"-t highlightolja,
a „Művelet"-et súgja, és az „Eredmény"-re lép tovább. A `[PRO]` leckék paywallt válthatnak ki.

A fő UI-zónák a leckékhez:
- **Idővonal** (alul): sávok, klipek, középre rögzített lejátszófej.
- **Insight-sáv** (az idővonal fölött): `Story/Térkép/Tempó` fülek · **🧲 illesztés** ·
  **trim-mód** · **✂️ borotva** · **🅸 / 🅾** tartomány · **Régió** gomb.
- **TransportBar**: undo/redo · 🕓 előzmények · ⏮ · ◀| frame · **J** · ▶/⏸ · **L** · |▶ frame ·
  🔖 jelölő · részlet-előnézet · 🔁 loop.
- **Eszköztár** (Toolbar): Videó · Kép · Szöveg · Felirat · Átirat · Matrica · Forma · Zene ·
  Szűrő · Áttűnés · Sebesség · Grade · Keret(PiP) · Rétegek · Hotspot · Pontos · Tár · Export.
- **Panelek** (a kijelöléstől függően nyílnak).

### 🟢 Kezdő

**1. lecke — Új projekt és az első klip**
1. *Művelet:* Hozz létre projektet. *Hol:* főképernyő → **Új projekt** (válassz arányt: 16:9/9:16/1:1). *Eredmény:* megnyílik a szerkesztő üres idővonallal.
2. *Művelet:* Adj hozzá videót. *Hol:* Eszköztár → **Videó** (vagy **Kép** / **Felvétel**). *Eredmény:* a klip megjelenik a videó-sávon, filmstrip-előnézettel.

**2. lecke — Navigáció és lejátszás**
1. *Művelet:* Léptesd a lejátszófejet. *Hol:* **Idővonal** — húzd/görgetsd (a playhead középen áll). *Eredmény:* az előnézet a playheadhez ugrik.
2. *Művelet:* Nagyíts/kicsinyíts. *Hol:* Idővonal — **kétujjas csippentés**. *Eredmény:* a lépték változik (0,2×–4×).
3. *Művelet:* Játszd le / állítsd meg. *Hol:* **TransportBar → ▶/⏸ (K)**. *Eredmény:* lejátszás a playheadtől.
4. *Művelet:* Pörgess. *Hol:* **J** (vissza) / **L** (előre) — ismételve gyorsít; **◀| / |▶** = képkocka-léptetés. *Eredmény:* shuttle-sebesség (pl. „2×"), ill. pontos kocka-lépés.

**3. lecke — Vágás és rendezés**
1. *Művelet:* Jelölj ki egy klipet. *Hol:* Idővonal — **koppintás** a klipre. *Eredmény:* keret + trim-fogantyúk.
2. *Művelet:* Vágd el a lejátszófejnél. *Hol:* Toolbar/klip-menü → **Vágás**. *Eredmény:* két klip lesz.
3. *Művelet:* Vágj tetszőleges ponton. *Hol:* **Insight-sáv → ✂️ Borotva** be, majd **koppints az idővonalon**. *Eredmény:* a koppintás pontján elvágja a lefedő klipet.
4. *Művelet:* Duplikálj / törölj / **Ripple**. *Hol:* klip-menü gombok. *Eredmény:* a Ripple lyuk-mentesen zár.

**4. lecke — Trimmelés és a profi trim-módok**
1. *Művelet:* Húzd a klip szélső **fogantyúját**. *Hol:* kijelölt klip bal/jobb éle. *Eredmény:* trim + **lebegő képkocka-előnézet** a szélen.
2. *Művelet:* Válts trim-módot. *Hol:* **Insight-sáv → trim-mód** (Trim→Ripple→**Roll**→**Slip**→**Slide**). *Eredmény:* a fogantyú/test-húzás a mód szerint viselkedik (roll=közös vágáspont, slip=forrás-ablak, slide=csúszás a szomszédok terhére).

**5. lecke — Szöveg és stílus**
1. *Művelet:* Adj szöveget. *Hol:* Toolbar → **Szöveg**. *Eredmény:* szöveg-klip + **Szöveg panel**.
2. *Művelet:* Állítsd a stílust. *Hol:* Szöveg panel — betűtípus/méret/szín/háttér/**animáció**. *Eredmény:* élő előnézet.
3. *Művelet:* Pozicionálj. *Hol:* **vászon** — húzd a szöveget (smart-guide-ok). *Eredmény:* a szöveg a helyére kerül.

**5b. lecke — Pro tipográfia, stílus és kinetic typography**
1. *Művelet:* Finomítsd a betűket. *Hol:* Szöveg panel → **Stílus** tab → **🔡 Tipográfia**: betűköz / sorköz / alapvonal / kerning. *Eredmény:* profi térközök.
2. *Művelet:* Adj stílust. *Hol:* **🎨 Stílus+** → kapcsold be a **Gradient / Kontúr / Árnyék / Ragyogás / Háttér** valamelyikét, majd hangold (szín/vastagság/méret). *Eredmény:* gradient-kitöltés, kontúr, glow stb. (a renderben pontosan).
3. *Művelet:* Animáld egységenként. *Hol:* **Anim** tab → **🎬 Kinetic typography** → **Mozgás** (Felúszás/Pop/Becsúszás/Gépelés/Hullám/Pattanás) → **Egység** (Karakter/Szó/Sor) → késleltetés/hossz. *Eredmény:* a szöveg egységenként lép be (a Hullám ciklizál).

**5c. lecke — Szöveg görbén, szöveg-maszk és Szöveg → Forma**
1. *Művelet:* Görbítsd a szöveget. *Hol:* **Extra** tab → **🛤️ Szöveg görbén** → Ív/Völgy/Hullám/Kör + görbület. *Eredmény:* a betűk a görbe mentén futnak (a renderben).
2. *Művelet:* Tedd a videót a betűkbe. *Hol:* **Extra** → **🪟 Szöveg-maszk** → *Videó a betűkben*. *Eredmény:* a betűkben éles videó, körülötte sötét/elmosott.
3. *Művelet:* Alakítsd formává. *Hol:* **Extra** → **🔁 Szöveg → Forma** → *Alakítás formává*. *Eredmény:* forma-klip a szövegből — a **Forma** panel eszközeivel (blend/glow/kontúr/kulcskocka/követés) tovább animálható.

**6. lecke — Sávok kezelése**
1. *Művelet:* Nyisd a sáv-menüt. *Hol:* a sáv **címkéjére/fejlécére** koppintás. *Eredmény:* némítás · solo · **👁️ láthatóság** · zárolás · összecsukás · **magasság** · **auto-magasság**.
2. *Művelet:* Rejts el egy vizuális sávot az előnézetből. *Hol:* **👁️ szem**. *Eredmény:* a sáv klipjei nem látszanak (monitorozás; a rendert nem érinti).

### 🟡 Haladó

**7. lecke — Kulcskocka-animáció a Graph Editorral**
1. *Művelet:* Nyisd a Pontos panelt. *Hol:* kijelölt videó/kép → Toolbar → **Pontos**.
2. *Művelet:* Válassz csatornát. *Hol:* **csatorna-chipek** (Méret / Pozíció X / Y / **Forgatás** / **Átlátszóság**).
3. *Művelet:* Rakj kulcskockát. *Hol:* **Graph Editor** — koppints a görbére (vagy „+" a lejátszófejnél). *Eredmény:* pont a value/time görbén.
4. *Művelet:* Formáld a görbét. *Hol:* húzd a pontot; válts **easinget** (linear/ease…/**Bézier**); Bézier-nél **húzd a fogókat**. *Eredmény:* az animáció görbéje (overshoot is).

**8. lecke — Maszkolás: alakzat + szabadkézi**
1. *Művelet:* Válassz maszkot. *Hol:* kijelölt videó/kép → **Szűrő** panel → Maszk (ellipszis/téglalap/poligon). *Eredmény:* maszk + vászon-fogantyúk.
2. *Művelet:* Rajzolj szabadkézi maszkot. *Hol:* Szűrő → **✏️ Rajzolt maszk**, majd **húzd körbe** a vásznon. *Eredmény:* poligon-maszk a rajzból.
3. *Művelet:* Finomíts. *Hol:* **〰️ Simítás**; a vásznon **koppintás a keretre** = új csúcs, **hosszú nyomás a csúcson** = törlés; **kiterjesztés** / **maszk-opacity** / **invert** chipek.

**9. lecke — Rotoszkóp (animált maszk)**
1. *Művelet:* Kapcsold be. *Hol:* Szűrő → **🎬 Rotoszkóp**. *Eredmény:* a maszk-szerkesztés mostantól kulcskockát ír.
2. *Művelet:* Kulcskockázz. *Hol:* mozgasd a **lejátszófejet**, igazítsd a maszkot a vásznon; ismételd pár képkockán. *Eredmény:* a maszk a köztes kockákon interpolál (a render per-frame maszkot éget).

**10. lecke — Jelölők és tartomány**
1. *Művelet:* Tegyél jelölőt. *Hol:* **TransportBar → 🔖**. *Eredmény:* marker a lejátszófejnél.
2. *Művelet:* Szerkeszd a jelölőt. *Hol:* a vonalzón a **jelölőre hosszú nyomás** → átnevezés / **jegyzet** / átszínezés / törlés.
3. *Művelet:* Jelölj tartományt. *Hol:* Insight-sáv → **🅸** (kezdet) és **🅾** (vég). *Eredmény:* tartomány-sáv; a **🔁 loop** azon belül ismétel; a tartomány-chip menüje: **régió** / **ripple-törlés** / törlés.

**11. lecke — Beat-alapú vágás és hang-effektek**
1. *Művelet:* Nyisd a Zene/Hang panelt, tölts be zenét. *Hol:* Toolbar → **Zene**.
2. *Művelet:* Beatből jelölők/vágások. *Hol:* **🥁 Beat** szekció → **→ Jelölők** vagy **→ Vágáspontok** → (utóbbinál) **Vágás alkalmazása**. *Eredmény:* markerek vagy kész vágások a ritmusra.
3. *Művelet:* Hang-effekt. *Hol:* kijelölt hangklip → Hang panel → **🎛️ Pro audio** (EQ / kompresszor / **pan** / reverb / …) és **hangerő-automáció Graph Editorral**.

**11b. lecke — Compositing (blend, green screen, matte, pre-compose)**
1. *Művelet:* Keverd a réteget az alatta lévővel. *Hol:* **Forma** / **PiP** panel → blend-mód (multiply/screen/overlay/…/hardlight). *Eredmény:* a réteg a blend szerint keveredik.
2. *Művelet:* Green screen kulcsolás + finomítás. *Hol:* **Szűrő** panel → green screen: **🎨 Színpipetta** (koppints a háttérre) → **Tolerance** → **Feather** → **Spill** → **✂️ Edge**. *Eredmény:* a háttér eltűnik, a perem letisztul és pontosan igazítható (choke/grow).
3. *Művelet:* Vágj a klipbe egy külső forma alapján. *Hol:* **Szűrő** panel → **🎭 Matte** → *Matte-kép választása* → **Luma/Alfa** + invertálás. *Eredmény:* a klip csak a matte világos/átlátszatlan részén látszik.
4. *Művelet:* Fogj össze sok klipet egy blokká. *Hol:* jelölj ki több klipet (**Több** mód) → Toolbar → **Pre-compose**. *Eredmény:* egy compound (beágyazott) klip, ami egyben mozgatható/effektelhető; a render rekurzívan legyártja a tartalmát.

**11c. lecke — Profi színfényelés (Basic · Curves · HSL · szkópok · LUT)**
1. *Művelet:* Alapfényelés. *Hol:* **Grade** réteg (vagy klip → **Szűrő** panel) → **🎚️ Tónus**: expozíció / csúcsfények / árnyékok / fehérek / feketék, **🎨 Szín**: hőmérséklet / árnyalat / szaturáció / **élénkség**. *Eredmény:* a kép tónusa és színvilága a helyére kerül.
2. *Művelet:* Görbézz. *Hol:* **📈 Görbék** → válts **RGB / R / G / B** közt, **koppints a rácsra** új ponthoz, **húzd** a pontokat. *Eredmény:* pontos tónus- és színcsatorna-kontroll.
3. *Művelet:* Ellenőrizd méréssel. *Hol:* **🩻 Szkópok** → **Waveform / RGB-parade / Vektorszkóp / Hisztogram**; **⟳** a lejátszófejnél újramér. *Eredmény:* objektív kép a fényről és a színről.
4. *Művelet:* LUT be/ki. *Hol:* **🎞️ 3D LUT** → **📥 .cube importálása** (kész look ráhúzása), vagy **📤 Export .cube** (a saját grade-ed hordozható LUT-ként). *Eredmény:* egységes, megosztható színvilág.

**11d. lecke — Vektorformák (toll, gradient, boolean, path-animáció)**
1. *Művelet:* Rajzolj path-t. *Hol:* **Forma** panel → *path* → **✏️ Toll / horgonypontok**: koppints új horgonyhoz, húzd a horgonyokat, a kijelölt **fogóit** húzva görbíts; **simítás / sarok / zárás**. *Eredmény:* pontos Bézier-forma (zárva = kitöltött).
2. *Művelet:* Színezd gradienssel. *Hol:* **🌈 Fejlett gradient** → **Lineáris/Radiális/Konikus** + stopok (szín/pozíció/±) + szög. *Eredmény:* multi-stop kitöltés. Vonalhoz: **✂️ szaggatás / vég / illesztés**.
3. *Művelet:* Kombinálj két formát. *Hol:* jelölj ki **két** formát (többes) → **🔗 Boolean** → egyesítés / kivonás / metszet / kizárás. *Eredmény:* egy összetett forma.
4. *Művelet:* Animáld a path-t. *Hol:* **🎞️ Path-animáció** → **Megrajzol** (a vonal megrajzolja magát) vagy **Morph** (rögzíts célalakot, majd szerkeszd a kezdőt). *Eredmény:* a renderben a path animálva ég be.

### 🔵 Pro (worker / AI)

**12. lecke — Automatikus felirat `[PRO]`**
1. *Művelet:* Kérj feliratot a beszédből. *Hol:* **Felirat** panel → „Felirat a beszédből (Whisper)". *Eredmény:* időzített feliratok (fordítás/karaoke opcióval).

**13. lecke — Objektum-követés `[PRO]`**
1. *Művelet:* Válaszd ki, mi kövessen. *Hol:* egy klip → **Pontos** (kép) / **Forma** / **Szöveg** / **Szűrő** (maszk vagy **🎯 Blur követ objektumot**).
2. *Művelet:* Indítsd a követést. *Hol:* **🎯 Kövess egy objektumot**, majd **koppints a videón a követendő objektumra** (pl. a labdára). *Eredmény:* a worker végigköveti; az elem (szöveg/kép/forma/maszk/blur) a mozgó objektumot követi kulcskockákkal.

**14. lecke — Kép-AI és AI-vágás `[PRO]`**
1. *Művelet:* Emeld ki az alanyt / cseréld az eget / skálázz fel. *Hol:* **Szűrő** panel → háttér-eltávolítás / ég-csere / felskálázás.
2. *Művelet:* Automatikus vágás/újrakeretezés. *Hol:* **AI-asszisztens** → Auto-Edit / Smart Reframe / Shorts.

**14b. lecke — Videó-stabilizálás**
1. *Művelet:* Kapcsold be. *Hol:* videóklip → **Szűrő** panel → **🎯 Stabilizálás** → *Automatikus stabilizálás*. *Eredmény:* a render kompenzálja a bemozdulást.
2. *Művelet:* Hangold. *Hol:* **Erősség** (mekkora rázást fog be) · **Simaság** · **Kivágás/zoom** (a bemozduló szélek eltüntetése) · **Rolling-shutter korrekció**. *Eredmény:* a beégetett videó stabil (az előnézet a nyerset mutatja).

**15. lecke — Export**
1. *Művelet:* Nyisd az Exportot. *Hol:* Toolbar → **Export**.
2. *Művelet:* Válassz **platform-presetet** (TikTok/Reels/Shorts/YouTube/Instagram) vagy állíts felbontást/FPS-t/minőséget/kodeket; a **Haladó** alatt bitráta (CRF/VBR/CBR), GOP, 8/10-bit, színtér (Rec.709/2020/HDR), audio. Majd exportálj. *Hol:* **Local MP4** (ingyen, eszközön) vagy **Felhő HD/4K** `[PRO]`; **közzététel a feedbe** `[PRO]`. *Eredmény:* kész MP4 a Fotókban / a feltöltött publikus videó.

**16. lecke — Teljesítmény nehéz felvételnél (proxy)**
1. *Művelet:* Importálj nehéz (4K/60/10-bit) videót. *Eredmény:* a háttérben proxy készül; a vágás gyors marad, a render az eredetivel fut.
2. *Művelet:* Állítsd a proxyt. *Hol:* **Profil → Teljesítmény** → proxy be/ki + minőség (Alacsony/Közepes/Magas). *Eredmény:* gyengébb eszközön alacsonyabb tier = folyékonyabb előnézet.
3. *Művelet:* Szabadíts fel helyet. *Hol:* ugyanott → **Gyorsítótár ürítése**. *Eredmény:* a proxy/hullámforma-cache törlődik (a projekt és a renderek megmaradnak).

**17. lecke — Multicam (több kameraszög)**
1. *Művelet:* Add hozzá a szögeket. *Hol:* Toolbar → **Multicam** → **+ Szög hozzáadása** (2–6 videó ugyanarról az eseményről); a ⭐-gal állítsd be a mastert.
2. *Művelet:* Szinkronizálj hang alapján. *Hol:* **🎚️ Auto-sync (hang)**. *Eredmény:* a szögök a hullámforma alapján egymáshoz igazodnak.
3. *Művelet:* Vágj élőben. *Hol:* **🔴 Élő szögváltás** → indítsd a lejátszást, és koppints a szög gombjaira — minden váltás vágást rögzít.
4. *Művelet:* Építs szekvenciát. *Hol:* **🎬 Multicam-szekvencia létrehozása**. *Eredmény:* a fő sávra néma videóklipek kerülnek a vágások szerint, a master hangja folytonosan szól; a vágások normál klipként tovább finomíthatók.

**17b. lecke — Átmenet-szerkesztő**
1. *Művelet:* Tegyél átmenetet. *Hol:* klip → **Áttűnés** panel → válassz típust a *Következő klipre* alatt. *Eredmény:* átmenet a következő klipre.
2. *Művelet:* Finomhangold. *Hol:* **🎬 Átmenet szerkesztése** → **hossz · irány · easing · erősség · elmosás · zoom-lökés · forgás-lökés**. *Eredmény:* a flourishök az átmenet ablakában hatnak (a renderben égnek be).

**17c. lecke — Creator Preset (saját stílus egy gombra)**
1. *Művelet:* Állítsd össze a stílust. *Hol:* Toolbar → **Preset** → adj nevet (pl. „My YouTube Style"), válassz **Motion + Intro + Outro** csomagot; a betűtípus/színek/felirat/logó/zene a jelenlegi projektből derül. *Eredmény:* mentett preset.
2. *Művelet:* Húzd rá egy másik projektre. *Hol:* **Presetjeim** → **Alkalmaz**. *Eredmény:* a font/színek/felirat-stílus/logó + motion + átmenetek + intro/outro + zene egy lépésben ráépül.

**17d. lecke — Verziók (pillanatkép, visszaállítás, összehasonlítás)**
1. *Művelet:* Ments pillanatképet. *Hol:* **TransportBar → 🕓** → **Mentés**. *Eredmény:* névvel mentett verzió; a szerkesztés közben **autosave-verziók** is keletkeznek automatikusan.
2. *Művelet:* Hasonlíts / duplikálj / állíts vissza. *Hol:* a verzió sorában **🔀 összehasonlítás** (mi változott a jelenlegihez képest), **⧉ duplikálás**, **Visszaállítás**. *Eredmény:* biztonságos kísérletezés — bármikor visszatérhetsz egy korábbi állapothoz.

**18. lecke — Time remapping (sebesség-görbe, interpoláció, freeze)**
1. *Művelet:* Rajzolj sebesség-görbét. *Hol:* egy videóklip → **Sebesség** panel → **Egyéni görbe** → húzd az oszlopokat (velocity graph), szegmenst ±-szal adj/vegyél; **Alkalmaz**. *Eredmény:* a klip a görbe szerint gyorsul/lassul (a hossza változatlan).
2. *Művelet:* Simítsd a lassítást. *Hol:* **⏱️ Idő-interpoláció** → **Optical flow** (mozgásbecslés) vagy **Keverés**. *Eredmény:* sima slow-motion köztes kockákkal (a renderben).
3. *Művelet:* Fagyassz kockát. *Hol:* **❄️ Freeze / hold frame** → állítsd a hosszt → **Kocka fagyasztása a lejátszófejnél**. *Eredmény:* a kép megáll, a többi klip arrébb csúszik, a hang tovább szól.

---

## Egysoros összefoglaló

**SIMA = a teljes profi kézi szerkesztő** (vágó-módok, J/K/L, Graph Editor + Bézier,
szabadkézi maszk/rotoszkóp, pro-audio-effektek, beat-vágás, teljes blend-készlet +
green screen/spill + luma/alpha matte + compound/pre-compose) **+ alap MP4-export —
minden az eszközön, ingyen.**
**PRO = az AI-réteg, az objektum-követés, a felhő-HD-render és a cloud-tárhely — a fizetős workeren.**
