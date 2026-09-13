# Studio — a szerkesztő funkcionalitása (SIMA vs PRO)

Ez a dokumentum a **Studio** (a videószerkesztő mag) teljes funkció-leltárát adja,
két csoportra bontva: **SIMA** (ingyenes) és **PRO** (előfizetéses). A többi
architekturális részlet a [README.md](README.md)-ben van.

## A kapuzás elve — EGY szabály

> **Amit a készülék maga el tud végezni — worker, AI és felhő-tárhely nélkül —,
> az mindig INGYEN jár, előfizetés nélkül. Pro csak az, ami a fizetős felhő-workert
> / AI-t / cloud-tárhelyet használja.**

A szabály nem „ízlés kérdése", hanem **típus-szinten kikényszerített** a
[capabilities.ts](src/lib/capabilities.ts)-ben: minden képesség `where: 'local'`
(eszközön) vagy `where: 'cloud'` (felhő). A típus tiltja a `{ where: 'local', pro: true }`
sort → az on-device funkciót **nem lehet** véletlenül Pro mögé rakni, ez minden
`tsc --noEmit` futásnál auditálva van.

- **SIMA** = `where: 'local'` → mindig `pro: false`.
- **PRO** = `where: 'cloud'` + `pro: true` → az AI/worker/HD-render.
- **Kivétel** = felhőből jön, de mindenkinek jár (`where: 'cloud'`, `pro: false`) —
  ma egyetlen ilyen van: a **Hang-könyvtár** (`soundLibrary`).

A gyakorlatban a kapu egyetlen sor: a Pro-műveletek a hálózati hívás előtt
`ensureCloud('<capability>')`-et hívnak ([backend.ts](src/lib/backend.ts)); nincs
Pro → `ProRequiredError` → a UI paywallra fordítja (az AssistantPanel a
`guardPro(...)` burkolót használja ugyanerre).

---

## SIMA — ingyenes (minden az eszközön fut)

A teljes kézi szerkesztés és az alap-export ide tartozik. Ehhez **soha nem kell
szerver** — offline is, valós felhasználónál is működik.

### Projekt és idővonal
- Projekt létrehozása (16:9 / 9:16 / 1:1), lista, törlés, automatikus mentés (draft).
- Többsávos idővonal (videó/kép · szöveg · interaktív · hang): középre rögzített
  lejátszófej, görgetéses léptetés, kétujjas zoom (0,2×–4×).
- Vágás a lejátszófejnél, **duplikálás**, **törlés**, **ripple-törlés** (lyuk-mentes,
  minden sáv csúszik), **undo/redo** (50 lépés).
- Kijelölés, **több-kijelölés** (köteg-stílus), klipek **össze-/szétkapcsolása**,
  mágneses illesztés (0-ra és a lejátszófejre) haptikával.
- **Stílus másolása/beillesztése** klipek között (megjelenés átvétele, időzítés marad).
- **Pontos** panel: frame-pontos start/hossz/lejátszófej, keyframe-ek + easing.

### Klip-hozzáadás
- **Videó** és **Kép** importja az eszközről, **Felvétel** a kamerával, **Képkocka**-rögzítés.
- **Szöveg**, **PiP** (kép a képben), **Hotspot** (interaktív), **Grade-réteg** (fényelés).

### Vizuál
- **Szűrő** panel: 20+ színszűrő + erősség, maszkolás (ellipszis/gyémánt/poligon,
  lágyítás), blend-módok, kamera-mozgás (pásztázás/zoom/forgatás keyframe-mel).
- **Grade / Adjust** réteg: film-look presetek + kézi fényelés (fényerő, kontraszt,
  szaturáció, színhőmérséklet, vignetta), erősség és fade in/out.
- **Áttűnés** panel: 3D (zoom/spin/flip/cube/circle/dissolve), 2D wipe/slide,
  stilizált (pixelize/blur/radial/fadeBlack/fadeWhite), fade in/out.
- **Sebesség** panel: 0,1×–10× + sebesség-rámpa presetek, visszafelé-mód, trim.
- **Forma** panel: téglalap/ellipszis/vonal, kitöltés, gradiens- és glow-presetek,
  körítés, rács-illesztés.
- **Matrica** panel — *ingyenes rész*: emoji-matricák és részecske-effektek
  (konfetti/csillám/hó/parázs), pozicionálás + animáció.
- **PiP** panel: sarok-lekerekítés, keret (szín/vastagság), árnyék, blend-mód.

### Szöveg és felirat
- **Szöveg** panel — *ingyenes rész*: tartalom, 20+ betűtípus, méret, vastagság,
  szín, háttér, animációk (beúszás/felcsúszás/pop/pulzálás/gépelés), pozíció + keyframe,
  szöveg-sablonok.
- **Felirat** panel — *ingyenes rész*: kézi felirat, stílus-presetek (buborék/kontúr/
  banner…), időzítés, **SRT-fájl importja**.
- **Átirat** panel — *szerkesztés*: szóra koppintás, tartomány-kijelölés, kitöltő/
  ismétlés-jelölés, ripple-törlés a videón (az átirat betöltése után minden művelet helyi).

### Hang
- **Zene**/hang import (dokumentumválasztó), **voiceover-felvétel** a lejátszófejtől.
- Hangerő, fade in/out, lejátszáskor szinkron háttérhang.
- **Hang-könyvtár** böngészése és letöltése — a *worker* szolgálja ki, de
  **mindenkinek ingyenes** (`soundLibrary` kivétel).

### Interaktivitás
- **Hotspot** panel: kattintható téglalap, művelet = URL-megnyitás · ugrás időpontra
  (elágazó történet) · kvíz (kérdés + válaszok + helyes).
- **Interaktív lejátszó** (`/player/[id]`): élő hotspotok, kvíz-modal, progress-sáv.

### Kép-dokumentum (Creative Canvas)
- **ImageDoc** panel: réteg-alapú képszerkesztés (réteg hozzáadás/duplikálás/
  átrendezés/elrejtés/törlés), kép-/szöveg-/forma-rétegek, szín-kitöltés, opacitás,
  rasterizálás klippé — teljesen eszközön renderelve.

### Export
- **Local MP4 export** (`localRender`): natív, eszközön futó render (AVFoundation /
  MediaCodec), felbontás-/FPS-/minőség-presetek, mentés a Fotókba, SRT/felirat export,
  `.ReMix` projektfájl-export.

### AI-asszisztens — ami helyben fut (ingyenes)
- **Brand Kit**: stílus (színek, felirat-preset, vízjel) mentése és alkalmazása.
- **Motion / Look-csomagok**: kamera + áttűnés + fényelés preset egy koppintással.
- **Intro / Outro** sablonok beszúrása (az egész idővonal ripple-eltolásával).
- **Safe zone** ki/be, variáns-**előnézet** és -**alkalmazás**, beat-**pulzus**/**flash**
  (ha már van beat-rács), köteges parancs-alkalmazás egy undo-lépésben.

> Megjegyzés: az AssistantPanel **maga is fut ingyenes elemekkel**, de a *tényleges
> AI-elemzés/generálás* (lásd lentebb) mind Pro — a helyi részek csak a felhő-eredmény
> alkalmazását/preset-jeit intézik.

---

## PRO — előfizetéses (felhő-worker / AI / cloud-tárhely)

Ezek a `capabilities.ts`-ben `pro: true` képességek. Mind a fizetős felhő-infrát
használja (FFmpeg-render, Whisper, Claude, vision/diffúziós modellek, S3-tárhely).

### Render és tárhely
- **Felhő HD/4K render** (`cloudRender`): queue + S3, gyorsabb, nagyobb felbontás/jobb
  kodekek (AV1/ProRes). Hibrid: a rövid videók helyben renderelnek ingyen, a hosszabbak
  felhőben (küszöb env-ből). *Extra worker-funkciók az Export panelen:* AI-thumbnail /
  headline-beégetés, közzététel a feedbe, platformra posztolás.
- **Projekt felhő-mentés** (`cloudSync`): projekt mentése/visszaállítása cloud-tárhelyre.
- **Projekt-kollaboráció** (`collab`): tagok meghívása + szerepkörök (megosztott felhő-projekt;
  a *tulaj* Pro, a meghívott ingyen csatlakozik).

### Import
- **Import linkből** (`urlImport`, YouTube/TikTok): **hibrid** — először eszközön
  próbál (ingyen, InnerTube-út), ha nem megy → worker-fallback = Pro. A Tár panel
  felhő-tárhely-forrásai (Drive/Dropbox/S3/WebDAV…) szintén Pro.

### Felirat és beszéd
- **Automatikus felirat** (`autoCaption`, Whisper): beszéd → időzített felirat,
  szó-szintű karaoke-időzítés, felirat-fordítás, worker-es stílus-javaslatok.
- **Szöveg → beszéd** (`tts`): AI-hang / Voice Studio, illetve „dub" a felirat szövegéből.

### AI-vágás és -elemzés (AssistantPanel)
- **AI Auto-Edit** (`autoEdit`): 15/30/60 mp-es változatok, „Shorten 30", rough-cut,
  **highlight/Shorts-keresés**, **B-roll helyek** — mind az `autoEdit` worker-út alatt.
- **AI story-struktúra** (`storyAnalyze`): Hook→Context→Value→CTA felismerés.
- **AI tempó-elemzés** (`pacingAnalyze`): lassú/gyors szakaszok jelzése.
- **Felvétel-minőség ellenőrzés** (`qualityScan`): homályos / alul-túlexponált kockák.
- **Smart Reframe** (`reframe`): AI újrakeretezés (pl. fekvő → álló) alany-követéssel;
  a Social-formátum presetek (TikTok/Reels/Shorts…) ezt hívják.
- **Smart Search**, **Hook Generator**, **Sound Design AI**, **Termékvideó**,
  szabad-szöveges AI-utasítás, jelenet-/beat-felismerés a *worker*-en — mind Claude/
  vision/FFmpeg felhő-jel, ezért Pro.

### Kép-AI (FilterPanel)
- **Háttér-eltávolítás** (`bgRemove`) — és az erre épülő szelektív igazítás (csak az
  alanyra / csak a háttérre).
- **Ég-csere** (`skyReplace`), **3D / mélység / parallax + mélység-fókusz** (`depth3d`).
- **Arc-eszközök** (`faceTools`): arc-felismerés/-követés, arc-blur, 3D-objektum arcra
  ragasztása, beszélő-címkézés — a TextPanel/StickerPanel/CaptionsPanel is ezt hívja.
- **AI szín / auto-grade** (`colorAi`): worker-mért színstatisztika → grade, szín-egyeztetés
  előző kliphez.
- **Felskálázás** (`upscale`): 2×/4× szuperfelbontás.

### Matrica / 3D (StickerPanel — Pro rész)
- **3D matricák** (CC0 glTF a worker-könyvtárból), 3D anyag-/környezet-presetek,
  **3D arc-követés** (`faceTools`).

---

## Képesség-térkép (a hiteles forrás: `capabilities.ts`)

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
| `bgRemove` | Háttér-eltávolítás | PRO | cloud |
| `skyReplace` | Ég-csere | PRO | cloud |
| `depth3d` | 3D / mélység / parallax | PRO | cloud |
| `faceTools` | Arc-eszközök | PRO | cloud |
| `colorAi` | AI szín / auto-grade | PRO | cloud |
| `upscale` | Felskálázás | PRO | cloud |

¹ `urlImport`: **local-first ingyen** (eszközön futó InnerTube-út), csak a
worker-fallback igényel Pro-t.

## Egysoros összefoglaló

**SIMA = a teljes kézi szerkesztő + alap MP4-export, minden az eszközön, ingyen.**
**PRO = az AI-réteg, a felhő-HD-render és a cloud-tárhely — mind a fizetős workeren.**
