# ReMix — mit tud ma, és mi vár még fejlesztésre

> **Give me your footage. I'll help you make the video.**
> A vided nem egy újabb CapCut-klón, hanem **AI Creator Operating System**:
> **Video + Image + 2.5D/3D + Motion + AI** egyetlen közös layer/asset/render
> rendszerben, mobil-first, érintőre tervezve.
>
> A teljes folyamat egy termékben:
> `RAW → UNDERSTAND → SELECT → EDIT → STYLE → LOCALIZE → PUBLISH → ANALYZE → IMPROVE`

Ez a dokumentum egy **bemutató-szerű pillanatkép**: a bal oldalon az, ami már
működik, a jobb oldalon (lentebb) az, ami még hátravan. Részletes napló és
állapot: [FUNC.md](FUNC.md) · [DEV-PLAN.md](DEV-PLAN.md) · [SOCIAL-TODO.md](SOCIAL-TODO.md).

---

## ✅ Amit az app MA tud

### 🎬 Vágás és idővonal
Több sávos idővonal (videó/kép · PiP · Grade · szöveg · felirat · matrica ·
interaktív · zene · voiceover · SFX). Trim, split, húzás + mágneses snap,
duplikálás, undo/redo (50 lépés), pinch-zoom. **PiP / több videóréteg**
(reakció, split-screen, webcam-overlay). **Speed ramp** presetekkel vagy saját
rajzolt görbével + **mozgásel­mosás**. **Több-kijelölés** kötegelt szerkesztéssel,
**stílus-másolás** klipről klipre, **sáv-némítás/solo/zárolás**, **ripple mód**,
**jelölők**, képkocka-pontos léptetés, loop, vászon-transzform (zoom/pan/forgatás/
átlátszóság). Filmstrip-előnézet és hullámforma a klipeken.

### 📝 Feliratok és szöveg
4 stíluspreset (sima/buborék/kontúr/neon), 8 animáció (pop, karaoke, gépelés…),
gyors felirat, **AI auto-caption (Whisper)**, SRT import/export. **Caption
Studio** (AI kiemeli az ütős szavakat + emoji), **szó-szintű karaoke-időzítés**,
**beszélő-színek** és **okos pozíció** (arc-kikerülés). Minden animáció **beég a
renderelt MP4-be**.

### 🎨 Kép-eszközök (Creative Canvas)
A kép **réteg-fa, nem bitmap**: háttér / fotó / forma / szöveg egymáson,
átrendezhető, nem-destruktív. Képjavítás, **rajzolás a videóra** (3 ecset),
formák (téglalap/ellipszis/vonal/nyíl/csillag), **ragyogás + kontúr**, **Auto
Color** és **szín-igazítás az előző kliphez**, **Képkocka rögzítése**, **Animate
Photo** (6 kameramozgás-preset), **smart guides + snapping** (rács, safe-zone),
**logó/kép/SVG-import**, **blend-módok**, **Upscale/Enhance**, **AI Select**,
**Égcsere**.

### 🧊 3D eszközök (3D V1 kész)
**3D szöveg** (Chrome/Arany/Neon/Plasztik anyagok, extrúzió, döntés), **3D tér a
klipeken** (döntés + 5 kamera-preset: Push in/out, Orbit, Hero…), **2.5D
fotó-mélység** (parallax Ken Burns), **portré-blur** + **fókusz-húzás**, **AI
téma-kivágás**, **3D objektumok** (CC0 modellek, anyag + fény), **arc-matrica**,
**3D captions**, **3D átmenetek**, **tárgy-árnyékok**.

### ✨ Effektek, átmenetek, szűrők
**Arc-elmosás** (adatvédelem), **hangulat-világítás** (Studio/Sunset/Neon/
Cyberpunk), **Grade-réteg** (adjustment layer az egész kompozitra),
**részecske-réteg** (konfetti/szikra/hó/parázs, beat-syncelt), 10 szűrő
erősség-szabályzóval, fade + **17 átmenet** (3D + 2D wipe/csúszás/glitch/blur…),
**blur-háttérkitöltés**, **maszk** (téglalap/ellipszis/szabadkezes, a vásznon
igazítható) és **green screen chroma key**.

### 🎵 Audio
Hang-könyvtár (generált SFX + saját zenék), voiceover-felvétel, **AI-hang
(TTS)**, hangerő + fade + **hangerő-automáció (kulcskockák)**, **Voice Studio**
(Enhance + auto-ducking + de-reverb) — **a javított hang a szerkesztőben is
hallható**, **Sound Design AI** (SFX-kiosztás a vágásokra és a beatre).

### 🤖 AI-asszisztens és vágó-eszközök
Assistant panel **látható tevékenység-sávval** (időkorláttal), provider-független
AI-motor (Claude vagy lokális Ollama). **Auto Edit (AI Edit Engine)** — 3 kész
vágás-változat (Viral/Cinematic/Fast-paced). **Smart Search** a képi tartalomban.
**Holtidő-vágás**, **jelenetvágás**, **beat-vágás**, **Hook Generator**,
**Termékvideó egy gombbal**, **Look-csomagok**, **Smart Reframe** (16:9→9:16→1:1),
**Brand Kit** + intro/outro sablonok, **AI Command Bar**, **Átirat-vágó**
(text-based editing + töltelékszó-eltávolítás).

### ☁️ Média, storage, export
**Vágási proxy** (720p munka-példány), **Médiatár** (szerver-tár + WebDAV/NAS +
S3/MinIO/R2, auth a workeren marad), **hiányzó média + auto-relink**,
**Thumbnail Studio** (AI-borító + AI-címjavaslat). **MP4-render** a workeren valós
százalékkal, export-beállítások (480p–4K, 24/30/60 fps, minőség + becsült méret),
automatikus mentés a Fotókba. **`.vided` projektfájl** (md5-identitással) +
**Collect Project** zip. **Felhő-render** (queue + S3 + skálázó workerek).
**Részlet-előnézet** (👁): a render-only hatások export nélkül is megnézhetők.

### 📱 Social — TikTok-feed a Studióval (valódi Supabase backend)
Teljes képernyős függőleges feed (Neked/Követett/Friss), autoplay, dupla-koppintás
= like, akciósor. **A lényeg: minden videó egy szerkeszthető projekt** — a
**✂️ Remix** bármely eszközön megnyitja a projektet a Studióban. **Fiók + belépés**,
**profilok**, **kereső + hashtag**, **értesítés-központ** (élő badge),
**komment-szálak + kedvelés**, **chat (DM)** poszt-megosztással, **személyre
szabott feed**, **moderáció** (jelentés/letiltás/némítás, auto-elrejtés). A hurok
zárt: **szerkesztés → Közzététel → feed → Remix → szerkesztés**.

### 🏗️ Architektúra
Command-alapú szerkesztés (minden művelet nevesített, validált, undo-zható — az AI
is ezt használja), projekt-eseménynapló, asset-registry séma-migrációval. Egy
rAF-mesteróra hajtja a lejátszást, minden réteg ehhez szinkronizál.

---

## ⏳ Ami még HÁTRAVAN

### 🚀 Backend élesítés (F1 — infrastruktúra-kapu)
A worker ma **dev-módban** fut; élesítése (hoszting, job queue, S3, retry) minden
továbbihoz kapu. **Hátra:** OAuth (Google/Apple belépés), **cloud project-sync**
(eszközök közti folytatás, verziózott mentés), **push-értesítések**, adatbázis-
alapú **jogtiszta zene-katalógus**, éles Whisper (nagyobb modell + nyelvválasztó).

### 🤖 AI-réteg mélyítése
**Szemantikus index / knowledge graph** (jelenet + tartalom-címkék rendszerezve),
**AI-memória** (a user szándékának és elutasított javaslatainak betartása),
**további AI-profilok** (Director / Music / Color / Social AI).

### 🎨 Creative Canvas — hátralévő tételek
**Crop / resize / perspektíva-crop**, **Text-objektum** teljes tipográfiája
(warp/curved), a képjavítás bővítése (highlights/shadows, sharpness, grain),
**AI Image Expansion** (outpaint 16:9→9:16), **retouch** (blemish/skin/teeth),
finomabb layer effects (inner shadow, bevel, gradient overlay).

### 🧊 3D bővítés (V2/V3)
**Advanced tracking** (arc/forgás-követés, mélység-okklúzió), valódi GL-átmenetek,
élő 3D előnézet, majd V3: **AI scene generation** („tedd futurisztikus utcára”),
generatív 3D objektum/environment, **spatial audio**, AR-szerű „Place in scene”.

### 🎥 Nehéz AI (GPU-döntést vár)
**AI object removal** (video-inpainting — „töröld ki a mikrofont”),
**videó-háttéreltávolítás** (a fotó-változat kész, a videó GPU-kérdés),
**AI dubbing / fordítás** (HU→EN/DE/FR… — TTS-szolgáltató kell hozzá).

### 👥 Ökoszisztéma és kollaboráció (P1)
**Template marketplace + remix-lánc** (creator-eszközök megosztása),
**real-time kollaboráció** (CRDT, presence, timecode-kommentek, verziótörténet),
**shared projects** jogosultságokkal (OWNER/EDITOR/COMMENTER/VIEWER).

### 📱 Publishing és analytics (P2)
**Multi-platform publishing** (TikTok/IG/YT/FB — arány/cím/hashtag/ütemezés),
**Creator analytics** (retention/drop-off vissza a szerkesztőbe), **AI Presenter /
avatar**, **AI videógenerálás**, **Voice clone** (consent-réteggel),
**monetizáció** (marketplace-fizetések, pro tier), valós **trend-backend**.

### 💬 Social — hátralévő mérföldkövek
**Csoport-chat**, teljesebb komment-eszközök (pin, @mention, edit),
**Collections/Library** (mentett mappák), **admin/moderátor-felület**,
**Creator Studio** (tartalom-kezelés + statisztikák), **For You-ranker** finomítás.

---

## 🔑 Nyitott döntések (felhasználói input kell)

| Döntés | Miért fontos |
|---|---|
| **Éles AI-motor** | dev-ben lokális Ollama fut; élesben Claude a minőséghez (API-kulcs) |
| **Hoszting (F1)** | hova települ a worker + backend — marketplace, collab, publishing kapuja |
| **GPU-backend** | videó-léptékű modellekhez (object removal, inpainting) kell |
| **TTS-szolgáltató + voice-policy** | a dubbing és a voice clone előfeltétele |
| **Google Drive connector** | kell-e, és ki hozza létre az OAuth-appot |

---

## 🎯 Egy mondatban
A **szerkesztő + AI-réteg + 3D + social hurok dev-szinten kész** (a 10 P0
mind megvan) — a hátralévő munka nem effekt-halmozás, hanem a **backend
élesítése**, a **kollaboráció/marketplace** és a **generatív + platform** réteg.
