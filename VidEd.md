# VidEd — platform-terv

> **A cél egy mondatban:** a vided ma egyetlen szerkesztő-alkalmazás; legyen belőle
> egy videó-megosztó platform **tartalom-rétege**, ami minden eszközön fut, és a
> nehéz munkát ott végzi, ahol a felhasználó van — nem egy szerverfarmon.
>
> Ez a dokumentum architektúra-terv és döntési anyag, nem funkciólista. A
> funkció-roadmap a `DEV-PLAN.md`-ben, a backend-fázisok a `devs/full-plan.md`-ben
> vannak; ez a kettő fölé húz egy hordozhatósági és platform-réteget.

---

## 1. Hol tartunk ma — leltár, nem vágyálom

**Ami már ma hordozható.** A kliens `src/lib/` 73 moduljából **43 teljesen pure**:
nincs bennük `react-native` és `expo-*` import. Ez nem véletlen — végig ez volt a
munkamódszer (a tesztelhetőség kényszerítette ki), és most kiderül, hogy egyben a
platform-hordozhatóság alapja is. Pure a **teljes döntési logika**: a
dokumentum-modell és a parancs-réteg (`commands.ts`, `projectUtils.ts`), a
szerkesztő-műveletek (`ripple.ts`, `batchEdit.ts`, `snapping.ts`, `maskEdit.ts`,
`keyframes.ts`, `speedRamp.ts`), a kép-dokumentum (`imageDoc.ts`) és minden
AI-tervező (`autoedit.ts`, `soundDesign.ts`, `captionLayout.ts`, `wordTiming.ts`,
`brandIntro.ts`, `motionPacks.ts`, `productAd.ts`, `colorAuto.ts`, `reframe.ts`).

**Ami nem hordozható.** A `server/` worker: 2 220 sor render-kód, ami **három külső
binárisra** támaszkodik — `ffmpeg` (31 hívás), `ffprobe` (12), `whisper-cli` (1) —
plusz egy **headless Chromium** (4 hívás) a feliratok, formák és a 3D objektumok
raszterizálásához. Ezek egyike sem fut iOS-en vagy Androidon.

**A modellek viszont már ma kicsik.** Összesen ~405 MB, és ebből a legnagyobbak is
elférnek egy mai telefonon:

| modell | méret | feladat | mobilon reális? |
|---|---|---|---|
| `u2net.onnx` | 168 MB | háttér-kivágás | igen (ORT Mobile) |
| `ggml-base.bin` | 141 MB | Whisper átirat | igen (whisper.cpp) |
| `depth-anything-v2-small.onnx` | 94 MB | mélységtérkép | igen |
| `ultraface-rfb-320.onnx` | 1,2 MB | arcdetektálás | triviálisan |
| `superres.onnx` (ESPCN) | 236 KB | felskálázás | triviálisan |
| `rnnoise-std.rnnn` | 292 KB | de-reverb | triviálisan |

A kivétel a **szöveges LLM** (ma Ollama / `qwen3:14b`), ami telefonon nem fut. Ez a
terv leggyengébb láncszeme, és külön döntést igényel (lásd 8. pont).

**Összegzés:** a hordozhatóság akadálya nem az AI, hanem a **render**.

---

## 2. A cél-architektúra — négy réteg

```
┌─ vided-platform ── feed · identity · feltöltés · transzkód · CDN · social gráf
├─ vided-ai ─────── modell-futtató: eszközön (ORT/whisper.cpp) vagy szerveren
├─ vided-render ─── vászon + idővonal → képkocka/MP4; cserélhető backendekkel
└─ vided-core ───── dokumentum-modell, parancsok, tervezők  (ma már 43 pure modul)
```

### vided-core — a mag, ami már megvan

Kiemelendő önálló csomagba. Nulla platform-függősége van, tehát fut böngészőben,
Node-ban, React Native-ben, sőt szerver-oldali újrarenderben is. Ez tartalmazza:

- a **projekt-dokumentumot** (sávok, klipek, kép-dokumentumok, markerek),
- a **parancs/eseményrendszert** — minden művelet nevesített, validált,
  visszavonható és naplózott (`EditorCommand` + `applyCommand`),
- a **tervezőket**, amik jelekből szerkesztési döntést hoznak.

### vided-render — itt a munka java

A jelenlegi render két motorból áll: **FFmpeg filtergráf** (videó, hang,
átmenetek, maszkok, sebesség) és **Chromium-raszter** (feliratok, formák, 3D
objektumok, részecskék PNG-be, amit az FFmpeg overlayként ráéget).

**Kulcs-döntés: a Chromium-rasztert Skia váltsa.**

Indoklás: a `react-native-skia` iOS-en, Androidon és böngészőben (CanvasKit) is
fut, ugyanazzal a rajz-API-val. A jelenlegi generátorok részben már **SVG-t
adnak** — a rajz-ecset polyline-ja és a nyíl/csillag polygonja azért került
SVG-re, mert a Chromium a `clip-path` élét nem simítja. Ezek szinte 1:1 átjönnek
Skiába. A CSS-alapú részek (felirat-tipográfia, gradiensek, `drop-shadow`)
átírandók, de a geometria és a színkezelés már normalizált (0–1 vászon-koordináta,
a betűméret a vászonmagasság %-a).

> **Kockázat és mérséklés.** Ez vizuális paritási kockázat: a Skia-kimenet
> eltérhet a maitól. Ellenszer: **golden-image tesztek** a MAI Chromium-kimenettel
> szemben, PSNR-küszöbbel — az e2e render-infrastruktúra és a képkocka-összevetés
> már megvan (ezzel igazoltam a mozgás-elmosást, a poligon-maszkot és a
> layer effecteket is).

Az FFmpeg-oldal backendjei:

| backend | hol | mivel |
|---|---|---|
| natív | iOS / Android | karbantartott FFmpeg-build RN natív modulon át |
| natív | Mac / PC | a MAI worker változatlanul (Node + rendszer-FFmpeg) |
| wasm | böngésző | `ffmpeg.wasm` — csak rövid/kis felbontású munkára |
| szerver | minden | a mai worker, skálázva — túlcsordulás és végső minőség |

### vided-ai — modell-futtató absztrakció

Egy interfész (`depth`, `segment`, `faces`, `transcribe`, `enhance`, `superres`,
`generate`), több háttérrel: **ORT Mobile / ORT Web / onnxruntime-node /
szerver**. A hívó kód nem tudja, hol futott — a jelenlegi `*Client.ts` modulok
már pontosan így néznek ki, csak a végpont-választás kerül alájuk.

### vided-platform — a megosztó réteg

Identity, feltöltés, transzkód-létra, CDN, feed, social gráf, moderáció. Ez a
`devs/full-plan.md` F1–F5 fázisainak felel meg; a jelen dokumentum nem írja
felül, csak megadja, hogy a **szerkesztő mit vár tőle** (7. pont).

---

## 3. Eszköz-mátrix — őszintén

| eszköz | szerep | render | AI | korlát |
|---|---|---|---|---|
| **Telefon** (iOS/Android) | teljes szerkesztő | eszközön 1080p-ig | kis/közepes modellek | hő és akku; hosszú 4K export szerverre |
| **Tablet / iPadOS** | teljes szerkesztő + több sáv | eszközön 4K-ig | mint a telefon, nagyobb kerettel | — |
| **Mac / PC** | teljes szerkesztő + nehéz munka | helyben, korlát nélkül | **minden modell, LLM is** | — |
| **Web** | néző teljes, szerkesztő könnyű | WASM rövid vágásra | ORT Web (kis modellek) | hosszú render szerverre |
| **watchOS** | **NEM szerkesztő** | — | — | távvezérlő: lejátszás, jóváhagyás, hangjegyzet, értesítés |
| **TV** | csak lejátszás | — | — | — |

> A watch-ot szándékosan nem szerkesztőnek tervezzük. Egy 45 mm-es kijelzőn a
> többsávos idővonal nem használható; ami ott értelmes: a felvétel indítása, a
> kész változat jóváhagyása, hangjegyzet a voiceoverhez, és értesítés a render
> elkészültéről. Ez becsületesebb, mint egy zsugorított szerkesztő.

---

## 4. Hol fusson a nehéz munka — a szabály

**Local-first, remote overflow.** Alapértelmezés: a feladat ott fut, ahol a
felhasználó van. A szerver nem a normál útvonal, hanem a túlcsordulás.

A készülék **meghirdeti a képességeit** (kodek-támogatás, GPU/NPU, RAM, hőállapot,
akkuszint, hálózat), és egy ütemező feladatonként dönt. A döntés nem statikus:
ugyanaz a telefon hűvösen, töltőn mást bír, mint 20% akkun.

| feladat | ma | alapból hol fusson | mikor menjen szerverre |
|---|---|---|---|
| arcdetektálás, felskálázás, de-reverb | worker | **eszköz** (< 2 MB modell) | soha |
| mélységtérkép, háttér-kivágás | worker | **eszköz** | csak batch-nél |
| átirat (Whisper) | worker | **eszköz** | > 10 perc anyag |
| vágás-tervezés (pure logika) | kliens | **eszköz** | soha |
| szöveges AI (hook, caption, terv) | Ollama 14B | **desktop: helyben**, mobil: lásd 8.1 | mobil alapból |
| végső render | worker | eszköz 1080p-ig | 4K, hosszú anyag, batch-export |
| transzkód-létra (publikálás) | — | **szerver** | mindig |

**A publikálás külön eset.** A megosztó platformnak több felbontású változat és
HLS-csomagolás kell — ezt sosem a telefon csinálja. A készülék egy jó minőségű
mestert tölt fel, a létrát a szerver gyártja.

---

## 5. A dokumentum mint csereformátum — ez a platform valódi éle

A `.vided` projekt hordozható JSON + tartalom-hash-elt asset-hivatkozások. Ha ezt
elsőrendű állampolgárként kezeljük, négy dolog **ingyen** adódik:

1. **Eszközök közti folytatás.** Telefonon elkezded, gépen befejezed. Nem videót
   szinkronizálunk, hanem a dokumentumot (kilobájtok) — a médiát külön, hash
   alapján, igény szerint.
2. **Szerver-oldali újrarender.** A dokumentum az igazság, nem a kirenderelt fájl.
   Publikáláskor a szerver újrarenderelheti magasabb minőségben ugyanabból.
   *(Ez ma is így működik a kép-dokumentumnál: a réteg-fa az igazság, a PNG csak
   az eredmény.)*
3. **Remix.** A feed nem csak videót oszthat, hanem **szerkeszthető receptet**.
   „Használd ezt a sablont" nem marketingszöveg, hanem a dokumentum megnyitása a
   te médiáddal. Ez az, amiben egy TikTok–CapCut páros nem tud versenyezni: náluk
   a szerkesztő és a feed két külön világ, itt ugyanaz az adatszerkezet.
4. **Provenance és kollaboráció.** Az eseménynapló megmutatja, hogyan készült egy
   videó; és ugyanez a parancs-log a CRDT-alapú együttműködés alapja.

> Ez a pont a legfontosabb stratégiai állítás a dokumentumban. A hordozhatóság
> önmagában csak költség; **a hordozható dokumentum viszont termék.**

---

## 6. Migrációs terv

Minden fázis önmagában is szállít értéket — nincs „nagy átállás", ami hónapokig
nem ad semmit.

### M0 — A mag kiemelése *(kicsi, azonnal indulhat)*
`vided-core` csomag a 43 pure modulból + a típusokból. Nincs viselkedés-változás,
a mai app importál. **Mérőszám:** a csomag Node-ban, böngészőben és RN-ben is
betölthető, a meglévő ~440 assertion változatlanul zöld.
**Kockázat:** alacsony. Ez főleg mappa-mozgatás és `package.json`.

### M1 — Skia render-backend *(a terv gerince)*
A `text-render.js` Chromium-generátorai mellé Skia-implementáció, közös
interfésszel. Sorrend: formák → feliratok → 3D/részecskék (ez utóbbi maradhat
szerveren a legtovább).
**Mérőszám:** golden-image paritás a mai kimenettel, PSNR ≥ 40 dB minden
regressziós jeleneten.
**Kockázat:** közepes-magas — ez a fázis dönti el, működik-e az egész terv.
Ezért **ez menjen másodikként**, ne utolsóként: ha itt elbukik, olcsón derül ki.

### M2 — On-device AI runtime
ORT Mobile + whisper.cpp integráció, a `*Client.ts` modulok alá csúsztatva.
A kis modellek (arc, felskálázás, de-reverb) elsőként, mert azoknál nulla a
kockázat és azonnal érezhető a késleltetés-csökkenés.
**Mérőszám:** arcdetektálás < 150 ms, mélységtérkép < 3 s középkategóriás
telefonon; a worker-útvonal továbbra is működik tartalékként.

### M3 — Desktop shell
A **mai worker változatlanul** becsomagolva (Tauri vagy Electron). Ez a
leggyorsabb út a „Mac/PC-n minden fut helyben" ígérethez, mert a worker már kész
és Node-alapú. A desktop lesz az egyetlen hely, ahol a nagy LLM helyben fut.
**Kockázat:** alacsony. **Ez adja a legnagyobb értéket a legkisebb munkával.**

### M4 — Platform-backend
Identity, feltöltés, transzkód-létra, CDN, feed. A `devs/full-plan.md` F1–F4.
**Előfeltétel:** hoszting-döntés.

### M5 — Remix és kollaboráció
Dokumentum-publikálás a videó mellé, sablon-megnyitás saját médiával, majd CRDT
a parancs-logra. Ez a differenciáló réteg — de csak M4 után van hova tenni.

**Javasolt sorrend:** M0 → **M1** → M3 → M2 → M4 → M5.
Az M1 azért előre, mert az a terv legnagyobb kockázata; az M3 azért M2 elé, mert
kicsi munkával nagy értéket ad, és közben az M1 kockázata már ismert.

---

## 7. Amit a szerkesztő a platformtól vár

Hogy a backend ne találgassa a követelményeket:

- **Asset-tár tartalom-hash alapján** — ugyanaz a fájl kétszer ne töltődjön fel;
  a dokumentum hash-re hivatkozzon, ne útvonalra.
- **Dokumentum-szinkron** külön a médiától, ütközés-feloldással (a parancs-log
  erre való).
- **Render-job API**: dokumentum + minőség → job; státusz és eredmény. A mai
  `/render` végpont már pontosan ilyen (aszinkron job + poll).
- **Képesség-végpont**: mit vállal a szerver, mit hagy a kliensre.
- **Publikálás**: mester feltöltés → transzkód-létra → HLS + poszter + felirat-sáv.

---

## 8. Nyitott döntések — ezek rád várnak

### 8.1 Szöveges AI mobilon *(a legsürgősebb)*
A `qwen3:14b` telefonon nem fut. Három út:
- **(a)** kis modell eszközön (1–3B, llama.cpp/MLC) — olcsó, offline, de gyengébb
  szöveg; a hook-generátor és a caption-studio minősége visszaesik;
- **(b)** szerver minden szöveges feladatra — jó minőség, de hálózat- és
  költségfüggő, és sérti a „local-first" elvet;
- **(c)** hibrid: eszközön kis modell a gyors/rövid feladatokra, szerver a
  minőségi generálásra, a felhasználónak láthatóan.
**Javaslatom: (c)**, mert a mai `*Client.ts` réteg már fel van készítve a
végpont-választásra, és a felhasználó legalább kap valamit hálózat nélkül is.

### 8.2 FFmpeg mobilon
Az `ffmpeg-kit` archivált. Kell egy karbantartott fork vagy saját build — ez
licenc-kérdés is (GPL vs LGPL a kodekek szerint). **Döntés kell**, mielőtt az M1
mobil-ága indul.

### 8.3 Desktop shell: Tauri vagy Electron
Tauri kisebb és gyorsabb, Electron kiszámíthatóbb Node-integrációval — és a mai
worker Node. **Javaslatom: Electron az M3-ra** (gyors út), Tauri-átállás később,
ha a méret gondot okoz.

### 8.4 Modell-terjesztés
405 MB modell nem mehet az app-csomagba. Igény szerinti letöltés + eszközön
cache; a felhasználó lássa, mit tölt le és mekkorát. **Döntés:** melyik modell
legyen alapból ott (javaslat: arc + felskálázás + de-reverb, ~2 MB), és melyik
töltődjön első használatkor.

### 8.5 Hoszting és backend-platform
Változatlanul nyitott (`DEV-PLAN.md` döntési pontok). Ez kapuja az M4–M5-nek.

### 8.6 watchOS: építjük egyáltalán?
A 3. pont szerint csak társ-eszközként van értelme. **Döntés:** belefér-e a
scope-ba, vagy kimarad az első kiadásból.

---

## 9. Amit tudatosan NEM építünk

- **Saját kodek vagy konténer.** Nincs benne verseny.
- **Szerkesztő az órán.** Lásd 3. pont.
- **4K render böngészőben.** A WASM-út rövid, kis felbontású munkára való.
- **Saját CDN.** Bérelt megoldás.
- **Külön render-motor a képhez és a videóhoz.** Ez a mai architektúra
  vezérelve, és a platformon is az marad: *egy generátor, minden felületre* —
  különben a felhasználó mást lát az előnézetben, mint az exportban.

---

## 10. A legfontosabb mondat

A vided mai értéke nem a funkciók száma, hanem hogy **a döntési logika pure, a
dokumentum hordozható, és egyetlen generátor rajzol mindent**. A platform-terv
nem átépíti ezt — kihasználja. A render portolása (M1) az egyetlen valódi
kockázat; minden más ebből a három tulajdonságból következik.
