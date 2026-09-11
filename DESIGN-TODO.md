# ReMix — Design Master Directive & TODO

> **Cél:** a ReMix-et generikus „AI-szép" képernyők helyett **egységes, prémium,
> mozgásvezérelt mobil termékké** alakítani, a meglévő `design/` brand-assetek
> mint **egyetlen vizuális igazságforrás** alapján.
>
> **Ez nem „tedd szebbé" feladat.** A sorrend kötelező: **1) UI-audit →
> 2) design system → 3) képernyőnkénti implementáció.** Így nem lesz 15
> különböző stílusú képernyő.
>
> **A brand nem a logó. A brand az interakciós modell:**
> *cyan + magenta + 3D-szeparáció + remix-mozgás* = „ezt fogom, és a magamévá teszem".

**Termék-DNS:** `Watch it. Remix it. Make it yours.` — *„Üsd rá a saját nézőpontod!"*
**Tagline:** `WATCH / REMIX / SHARE` · *„More than videos. It's a movement."*

---

## Tartalom

1. [A vizuális azonosság a `design/` assetekből](#1-a-vizuális-azonosság-a-design-assetekből)
2. [Vezérelvek](#2-vezérelvek)
3. [Design token rendszer](#3-design-token-rendszer)
4. [A jelenlegi állapot auditja (kódbázis)](#4-a-jelenlegi-állapot-auditja-kódbázis)
5. [A Remix-transition — a termék szignója](#5-a-remix-transition--a-termék-szignója)
6. [Munkafolyamat és fázisok](#6-munkafolyamat-és-fázisok)
7. [Képernyő-prioritások és checklisták](#7-képernyő-prioritások-és-checklisták)
8. [Komponens-könyvtár](#8-komponens-könyvtár)
9. [Ikonográfia és a Remix-ikon](#9-ikonográfia-és-a-remix-ikon)
10. [Motion rendszer](#10-motion-rendszer)
11. [Reszponzivitás (telefon / tablet)](#11-reszponzivitás-telefon--tablet)
12. [Akadálymentesség és teljesítmény](#12-akadálymentesség-és-teljesítmény)
13. [Anti-minták — amit KERÜLNI kell](#13-anti-minták--amit-kerülni-kell)
14. [Design-review checklista (implementáció ELŐTT)](#14-design-review-checklista-implementáció-előtt)
15. [Végső minőségi léc](#15-végső-minőségi-léc)

---

## 1. A vizuális azonosság a `design/` assetekből

> **KÖTELEZŐ:** minden UI-döntés előtt a `design/` mappa a forrás. A logót
> **ne tervezd újra**, ne gyárts CSS-közelítést, ha kész asset van — **használd
> a valódi PNG-t**.

A `design/` mappa három brand-lapot tartalmaz (nyisd meg őket):

| Fájl | Tartalom |
|------|----------|
| `design/5d654e3b-…png` | Logó-rendszer: app-ikon méretek (1024→60), **logó-variációk** (fő logó / egyszerűsített 2D / mono), **színváltozatok** (színes / cyan mono / pink mono), App Store banner, splash, feature graphic, Expo-ikon |
| `design/9fa70798-…png` | **Brand + UI mockup**: színpaletta hexekkel, logó (app-ikon / horizontális / mono / light mode), **két képernyő-mockup** (For You feed + Remix-szerkesztő), a **Remix-ikon** (két ívelt nyíl), navigáció |
| `design/d0cde7bc-…png` | Fizikai **anaglif 3D szemüveg** (cyan bal + magenta jobb lencse, „R" a száron), 3D „ReMix" felirat, brand-színek, tipográfia-jelző (*Modern · Merész · Ikonikus*), splash + „Get Started" |

**A logó-DNS:** 3D-extrudált „**R**" betű, ami retro **anaglif 3D-szemüveget** visel —
**cyan (bal lencse)** és **magenta/pink (jobb lencse)**, chromatic-offset / 3D-eltolás,
sötét prémium háttér, üveges-fémes anyag, neon élfény.

**Vizuális nyelv:** *1990-es évek 3D-szemüvege × modern TikTok × prémium
videószerkesztő × futurisztikus kreatív eszköz.* Futurisztikus, de nosztalgikus.

**A legfontosabb elv:** a felület úgy nézzen ki, mintha **a ReMix 3D-szemüvegén
keresztül** terveztük volna — a cyan/magenta viszonyt **hierarchikusan**
használd, ne szórd szét mindenhová.

---

## 2. Vezérelvek

**A termék érződjön:** futurisztikus · kreatív · energikus · prémium · játékos ·
mozis · tapintható · gyors · fiatalos · enyhén nosztalgikus · technológiailag kifinomult.

**De egyszerre:** tiszta · minimál · olvasható · zsúfoltságmentes · azonnal érthető · rendkívül használható.

**A vizuális komplexitás forrása a MOZGÁS, mélység, átmenet, videó, finom 3D,
fény és rétegzés — NEM a több UI-elem a képernyőn.**

- **A videó mindig a hős.** A UI sose nyomja el a tartalmat.
- **A felület tűnjön el, amíg a felhasználó néz.** Kontextuális UI a permanens helyett.
- A felhasználó azonnal értse: *Mit nézek? · Ki készítette? · Mit kezdhetek vele?*
- **A cyan/magenta 3D a szignó — de fegyelmezetten.** „Apple-szintű motion a ReMix
  anaglif azonosságával", nem olcsó glitch-effekt.

**A vizuális aranyszabály:** > **Minimál felület. Maximális kreatív energia.**

---

## 3. Design token rendszer

> Építsünk **valódi token-rendszert** (`src/constants/theme.ts` — új), amit a
> meglévő `src/constants/editor.ts` `palette`-je mögé kötünk (lásd
> [4. audit](#4-a-jelenlegi-állapot-auditja-kódbázis) migrációját). Semmilyen
> komponens ne írjon nyers hexet — csak tokent.

### 3.1 Szín — szerep-alapú (a hexek a `design/` assetekből igazolva)

**A cyan/magenta NEM dekoráció, hanem hierarchia:**

| Szerep | Token | Hex | Mikor |
|--------|-------|-----|-------|
| **Cyan — elsődleges interaktív energia** | `brand.cyan` | `#00F0FF` | aktív állapot, kijelölt vezérlő, elsődleges CTA, progress, fókusz |
| Cyan (mély) | `brand.cyanDeep` | `#00D9FF` | gradiens-vég, hover/press |
| **Magenta — remix / kreatív akció** | `brand.magenta` | `#FF2D9B` | **Remix**-gombok, kreatív műveletek, fontos átmenetek |
| Magenta (mély) | `brand.magentaDeep` | `#FF008B` | gradiens-vég, hangsúly |
| **Lila — másodlagos kreatív állapot** | `brand.purple` | `#A855F7` | „Your Remix", másodlagos kreatív jelölés |
| **Fehér — elsődleges tartalom/szöveg** | `content` | `#F5F7FA` | fő szöveg, ikonok tartalom felett |
| Másodlagos szöveg | `textDim` | `#A7ADB8` | metaadat, alcím |
| Halvány szöveg | `muted` | `#626975` | inaktív, harmadlagos infó |

**Sötét vászon-skála (háttér-mélység):**

| Token | Hex | Használat |
|-------|-----|-----------|
| `bg.base` | `#050609` | legmélyebb réteg, feed-háttér |
| `bg.surface` | `#0A0B0E` | fő felület (brand-igazolt) |
| `bg.raised` | `#101217` | kártya, kiemelt felület |

**Vonal / üveg:**

| Token | Érték |
|-------|-------|
| `border.hairline` | `rgba(255,255,255,0.08)` |
| `glass.surface` | `rgba(255,255,255,0.04)` (+ blur) |

**Gradiensek — visszafogottan, csak nagy pillanatokra:**

- `gradient.remix` = `#00F0FF → #FF2D9B` (**a Remix-akció szignója**, cyan→magenta)
- `gradient.creative` = `#A855F7 → #FF2D9B` („Your Remix" sáv, kreatív állapot)
- Gradienst **csak** branding · Remix-gomb · aktív állapot · nagy vizuális
  pillanat · átmenet kap. **Sehol máshol.**

> **A cyan/magenta megjelenésének helyei:** Remix-akciók · aktív állapotok ·
> fontos átmenetek · kijelölt vezérlők · progress · kreatív effektek ·
> highlightok · logó-pillanatok · mikrointerakciók. **Máshol ne.**

### 3.2 Tipográfia

Modern, geometrikus, **merész + editorial** sans-serif. Erős cím-jelenlét,
kompakt, jól olvasható UI-szöveg. Hierarchiát **agresszíven** használd.

| Szint | Használat |
|------|-----------|
| Display | brand-pillanat, splash, nagy üres állapot |
| Headline | képernyő-cím |
| Title | szekció-cím, kártya-cím |
| Body | törzsszöveg, felirat |
| Caption | metaadat, segédszöveg |
| Metadata | számláló, időbélyeg (tabular-nums) |

A projektben már betöltött family-k (`src/app/_layout.tsx`): Anton, BebasNeue,
Poppins, Oswald, ArchivoBlack, Bungee, Righteous, Lobster, Pacifico,
PermanentMarker — a **display/headline** szintekhez ezekből válassz (pl.
ArchivoBlack/Anton a nagy címekhez), a **UI-szöveghez** rendszer-sans marad.

### 3.3 Spacing · radius · elevation · motion

- **Spacing skála:** 4 · 8 · 12 · 16 · 20 · 24 · 32 (a meglévő `useLayout()`
  `spacing`-jéhez igazítva).
- **Radius:** vezérlő 10–14 · kártya 16–20 · sheet 24 · pill 999.
- **Elevation:** finom, cyan/magenta-árnyalt árnyékok a nagy elemeknél
  (lásd 3D motion-nyelv), nem szürke doboz-árnyék.
- **Motion időzítések** (globális, [10. szakasz](#10-motion-rendszer)):
  Fast `120–180ms` · Standard `200–300ms` · Emphasis `350–500ms`.

---

## 4. A jelenlegi állapot auditja (kódbázis)

> **Ez a fázis megelőz minden implementációt.** Az alábbi megállapítások a jelen
> kódból származnak — ezek a design-system első feladatai.

### 4.1 Token-eltérések (`src/constants/editor.ts` → `palette`)

| Jelenlegi | Érték most | Probléma | Cél |
|-----------|-----------|----------|-----|
| `palette.accent` | `#7c5cff` (**lila**) | **A brand elsődleges színe a cyan — most a cyan HIÁNYZIK az interaktív rétegből.** | `brand.cyan #00F0FF` |
| `palette.accent2` | `#ff5ca8` (pink) | közel jó, de nem a brand-magenta | `brand.magenta #FF2D9B` |
| `accentGradient` | `#7c5cff → #b95ce0 → #ff5ca8` (lila→pink) | nem a szignó cyan→magenta | Remix: `#00F0FF → #FF2D9B` |
| `palette.bg` | `#07080d` | közel jó | `bg.surface #0A0B0E` skálára |
| `palette.text` | `#f4f5fa` | ~ jó | `content #F5F7FA` |
| `palette.textDim` | `#8d93a8` | ~ jó | `textDim #A7ADB8` + `muted #626975` |

**Feladat:**
- [ ] `src/constants/theme.ts` — új, szerep-alapú token-réteg (3. szakasz).
- [ ] `palette` átkötése a tokenekre **visszafelé kompatibilisen** (a ~40
      komponens, ami `palette.accent`-et használ, ne törjön) — az `accent`
      mutasson a `brand.cyan`-ra, jöjjön létre `brand.magenta` és `brand.purple`.
- [ ] A `trackColors` felülvizsgálata a token-rendszerhez (a videó-sáv legyen
      brand-cyan közeli, a felirat magenta — a mostani ad-hoc hexek helyett).

### 4.2 Struktúra-eltérés: szerkesztő-app vs. remix-közösség

A **brand-mockup** egy **social remix-platformot** ábrázol
(For You feed · Remix · alsó nav: Home/Explore/Create/Inbox/Profile), a
**social adatmodell megvan** (`src/types/social.ts`: `FeedPost`, `Creator`,
`EngagementCounts`, remix-lánc mezők) — **de a feed/social UI még nincs
megépítve**. A jelenlegi app projekt-központú:

- `src/app/index.tsx` — projekt-lista + sablonok, alsó fülek: **Projektek /
  Sablonok / AI eszközök** (nem a mockup Home/Explore/Create/Inbox/Profile-ja).
- `src/app/editor/[id].tsx` — a szerkesztő (ez megvan és erős).
- `src/app/player/[id].tsx` — interaktív lejátszó (nem a feed).

**Feladat (termék-döntést igényel — lásd nyitott kérdések):**
- [ ] Eldönteni: a redesign a **social feedet is bevezeti** (a `social.ts`-re
      építve), vagy **egyelőre a szerkesztő + projekt-lista** kap brand-frissítést,
      és a feed külön mérföldkő. **A brand teljes ereje a feedben + Remix-flow-ban
      mutatkozik meg — ez a fő ajánlás.**
- [ ] A menüfa (`docs/hu/menu-tree.md`) frissítése a végleges navigációval.

### 4.3 Meglévő, megtartandó erősségek (NE írd újra)

- A szerkesztő architektúrája: rAF-mesteróra, `mutateProject`/undo, méret-osztályos
  elrendezés (compact/medium/expanded), kontextusfüggő eszköztár, dokkolt inspector.
- i18n (hu/en/de) — **minden új szöveg i18n-kulcsból**, nyers string tilos.
- `useLayout()` reszponzív rendszer, `PreviewSurface` réteg-modell.

> **Refaktor csak ott, ahol a konzisztenciát / karbantarthatóságot /
> teljesítményt / UX-et javítja.** A működő architektúrát nem bántjuk.

---

## 5. A Remix-transition — a termék szignója

> **Ez a ReMix legerősebb, azonnal felismerhető UX-eleme.** Ezt tervezd meg
> kiemelkedően — más appoknál is felismerhető jel legyen.

**Nem** „Watch → másik képernyő megnyílik", **hanem** „Watch → belépek a projektbe → Remix".

### A koreográfia (koppintás a `REMIX` gombra):

1. **Frame-freeze** — a jelenlegi kocka egy pillanatra megáll.
2. **Anaglif szeparáció** — a kép finoman szétválik **cyan + magenta**
   csatornákra (chromatic split), a szignó-effekt.
3. **UI behúzódik** — a feed-vezérlők (jobb rail, felirat, nav) a **középpont
   felé** mozognak / eltűnnek.
4. **Átmenet szerkesztőbe** — a videó a szerkesztő-előnézetté alakul (morph, nem vágás).
5. **Timeline felúszik** — az eredeti projekt idővonala láthatóvá válik alul.
6. **Attribúció** — kis jelző: **„Original by @creator"**.
7. **A projekt szerkeszthetően megnyílik** — *ugyanaz a videó, most már projekt.*

**Érzés:** `Watch → Enter Project → Remix`. A gomb ne egyszerű navigáció legyen —
**morfoljon** az átmenetbe.

**Feladat:**
- [ ] `RemixTransition` komponens (Reanimated + `expo-blur`/shader) — megszakítható,
      60fps, `prefers-reduced-motion` fallback (kereszt-fade).
- [ ] Chromatic-split shader/réteg a freeze-kockán (cyan/magenta offset).
- [ ] Belépési pont a feed `Remix` gombjából a `player`/`editor` felé, az
      `Original by @creator` lineage-jelzővel (`social.ts` `remixOfCreator`).

### Remix-lánc (lineage)

Minden Remix őrizze meg a látható kapcsolatot a forrásához — **finoman**, sose
uralja a képernyőt:

```
Original → Remix @alex → Remix @sarah → A te Remixed
```

Megjelenhet: kis lánc-jelző · kibontható remix-fa · lapozható lineage. Cél: a
ReMix-ökoszisztéma **kreatív evolúciónak** érződjön (a `social.ts`
`remixOfPostId` / `remixOfCreator` / `remixes` számláló erre van).

---

## 6. Munkafolyamat és fázisok

> **A sorrend nem opcionális.** Ne tegyél egyes képernyőket „szebbé" izoláltan.

### Fázis 0 — Audit (ez a dokumentum 4. szakasza)
- [ ] Jelenlegi képernyők, navigáció, komponensek, stílusok, assetek átnézése.
- [ ] Token-eltérések és struktúra-eltérés dokumentálva (kész: [4. szakasz](#4-a-jelenlegi-állapot-auditja-kódbázis)).

### Fázis 1 — Design system (a `design/` assetekből)
- [ ] `theme.ts` tokenek (szín, tipó, spacing, radius, motion, glass).
- [ ] `palette` migráció visszafelé kompatibilisen.
- [ ] Alap-primitívek: `Text` (variánsok), `Button`/`IconButton`, `Surface`/`GlassSurface`, `Chip`, `Sheet`, `Toast`, `Skeleton`.
- [ ] A logó-asset beépítése (`design/` → `assets/`) valódi képként (nem CSS-másolat).
- [ ] A **Remix-ikon** mint komponens ([9. szakasz](#9-ikonográfia-és-a-remix-ikon)).

### Fázis 2 — Képernyőnkénti implementáció (prioritás-sorrendben)
A [7. szakasz](#7-képernyő-prioritások-és-checklisták) sorrendje szerint, minden
képernyő a design-system komponenseiből épül. Minden képernyő menjen át a
[14. review-checklistán](#14-design-review-checklista-implementáció-előtt) az
implementáció **előtt**.

**Prioritás:** 1) Feed → 2) Videó-nézés → 3) **Remix-interakció** → 4) Szerkesztő →
5) Közzététel → 6) Profil → 7) Discover → 8) Kommentek / social.

---

## 7. Képernyő-prioritások és checklisták

### 7.1 Feed / For You  (`src/app/` — új `feed` screen)
Referencia: `design/9fa70798-…png` bal telefon-mockup.
- [ ] Teljes képernyős, függőleges, **edge-to-edge** videó, minimál chrome.
- [ ] Fejléc: ReMix-logó + wordmark · kereső · tabok **For You / Following / Trending**.
- [ ] Jobb akció-rail: avatar · like · komment · megosztás · mentés · **Remix**.
- [ ] Felirat: `@creator` · szöveg · hashtagek · hang/forrás-info.
- [ ] **A Remix-gomb vizuálisan a legfontosabb kreatív akció** (magenta/gradiens, [5. szakasz](#5-a-remix-transition--a-termék-szignója)).
- [ ] Alsó nav: **Home · Explore · Create(+) · Inbox · Profile** (a Create kiemelve).

### 7.2 Videó-nézés / Player
- [ ] A vezérlők **progresszíven** jelennek meg; nézés közben eltűnnek.
- [ ] Az interaktív hotspot-réteg (URL / seek / kvíz) megmarad (`player/[id].tsx`), brandelve.

### 7.3 Remix-interakció → [5. szakasz](#5-a-remix-transition--a-termék-szignója) (a szignó)

### 7.4 Szerkesztő  (`src/app/editor/[id].tsx` — meglévő, brand-frissítés)
Referencia: `design/9fa70798-…png` jobb telefon-mockup.
- [ ] Fent: vissza · projektnév · undo · redo · export/share.
- [ ] Közép: nagy videó-előnézet.
- [ ] Lent: idővonal (klipek, sávok, playhead).
- [ ] Eszköztár **ikon-first**: Split · Trim · Speed · Audio · Text · Image ·
      Overlay · Effects · Filters · Stickers · Adjust · AI · More.
- [ ] Az „Original + a te nézőpontod" (PiP) remix-kontextus vizualizálva.
- [ ] „Your Remix" sáv/CTA a kreatív gradiens-tokennel.
- [ ] **Touch-first**: hüvelykujj-elérés, nagy hit-target, vízszintes görgő
      eszköztár, pinch/drag/swipe/long-press, kontextus-menük. **Ne** asztali
      szerkesztő telefonba préselve.

### 7.5 Timeline (a szerkesztő legfontosabb komponense)
- [ ] Tiszta, nagy kontraszt, precíz, touch-friendly, vízszintesen görgethető, multi-track.
- [ ] Videó-thumbnail · hang-hullámforma · szöveg-blokk · effekt · overlay ·
      kulcskocka · marker.
- [ ] A **playhead rendkívül tiszta**, a húzás sima és fizikai.

### 7.6 Közzététel / Export  (`ExportPanel` — meglévő)
- [ ] Export az eszközön (ingyen) vs. Felhő HD (Pro) tiszta hierarchia.
- [ ] Posztolás közösségi platformra · SRT · Hotspot-JSON · .remix / Collect.
- [ ] A [SEO-meta](#) (cím/leírás/hashtag/kulcsszó) előtöltése a posztoláshoz
      (már a projekten van — lásd `ProjectSeo`).

### 7.7 Profil (creator-portfólió)
- [ ] Avatar · név · bio · követők · követés · like-ok.
- [ ] Fülek szétválasztva: **Originals · Remixek · Projektek · Mentett**.

### 7.8 Discover (vizuális, nem sima kereső)
- [ ] Trending videók · creatorök · hangok · effektek · **remix-láncok** · challenge-ek · sablonok.
- [ ] A hangsúly azon, **amivel alkotni lehet**, nem csak amit nézni.

### 7.9 Kommentek / social
- [ ] Komment · válasz · reakció · időbélyeg-linkelt komment · creator-válasz.
- [ ] Az architektúra ne zárja ki a jövőbeli **„Remix this comment"**-et.

### Üres / hiba / loading állapotok (minden képernyőn)
- [ ] **Üres állapot** hasznos, nem „Nincs tartalom" — pl. *„Még nincs Remix.
      Legyél te az első, aki újravágja."* / *„Üres a vásznad. Kelts életre egy videót."*
- [ ] **Hiba**: barátságos, magyarázat + helyreállító akció, nyers technikai üzenet nélkül.
- [ ] **Loading**: skeleton / videó-placeholder / animált chromatic-gradiens —
      **ne** generikus pörgő spinner.

---

## 8. Komponens-könyvtár

> Építs **újrahasznosítható** komponenseket; egyedi one-off komponenst csak
> indokolt esetben. (A meglévő `src/components/ui/controls.tsx` a mag.)

- [ ] Gombok: `PrimaryButton` (van, gradiens+disabled), `IconButton`, `RemixButton` (kiemelt).
- [ ] Navigáció: alsó `TabBar` (Home/Explore/Create/Inbox/Profile), `TopTabs` (For You/Following/Trending).
- [ ] Kártyák: `VideoCard`, `CreatorCard`, `Avatar`, `Badge`.
- [ ] Feed-elemek: akció-rail (`LikeButton`/`CommentButton`/`ShareButton`/`SaveButton`), `CaptionBlock`, `LineageChip`.
- [ ] Overlay/mélység: `Sheet` (bottom sheet), `Modal`, `GlassSurface`, `Toast`, `ContextMenu`.
- [ ] Vezérlők: `Slider`, `Switch`, `Chip` (van), `Stepper` (van).
- [ ] Szerkesztő: `Toolbar` (van), `ToolButton` (van), timeline-vezérlők, `PlayheadHandle`.
- [ ] Állapotok: `Skeleton`, `EmptyState`, `ErrorState`, `LoadingState`.

---

## 9. Ikonográfia és a Remix-ikon

- **Koherens, modern ikon-rendszer** — egyszerű, geometrikus, felismerhető,
  **egységes vonalvastagság**. Ne keverj véletlenszerű ikon-stílusokat.
- **A Remix-ikon a termék szimbóluma** (a `design/9fa70798-…png`-en: **két ívelt
  nyíl** — egy cyan felfelé, egy magenta lefelé, remix/recirkuláció-hurok).
  Kommunikálja: **forrás → átalakítás → új alkotás.**
- [ ] `RemixIcon` komponens: működjön eszköztár-ikonként · gomb-ikonként ·
      animációként · értesítés-ikonként · badge-ként · social-akcióként · brand-szimbólumként.
- [ ] Az „important" akciók (Remix, Create) kaphatnak egyedi ReMix-kezelést; a
      többi ikon egységes készletből.

---

## 10. Motion rendszer

**Minden animáció kommunikáljon:** *állapot · hierarchia · folytonosság · ok→okozat.*
Animáció önmagáért **tilos**.

- **Időzítés:** Fast `120–180ms` (gomb, toggle) · Standard `200–300ms` (tab,
  kártya, navigáció) · Emphasis `350–500ms` (Remix, export, nagy átmenet).
- **Fizika:** spring, ahol illik; konzisztens easing-görbék. **Túlzott bounce
  kerülendő.**
- **Folytonos, nem lapozós navigáció:** inkább `morph → slide → fade → scale`,
  mint hirtelen képernyő-csere.
- **3D / anaglif mozgás-nyelv (szignó, visszafogottan):**
  - Kártya-belépés: `cyan árnyék → objektum → magenta árnyék`.
  - Remix-aktiválás: a tartalom kissé cyan/magenta csatornákra válik az átmenet előtt.
  - Fontos gomb lenyomása: apró chromatic-eltolás.
  - Navigáció: elő- és háttér kissé eltérő sebességgel (parallax).
  - **Ne** nézzen ki az egész app olcsó glitch-effektnek — prémium és kontrollált.
- **Implementáció:** Reanimated (UI-szálon), megszakítható animációk, nincs
  felesleges re-render; a látvány **ne ejtsen frame-et** görgetés / lejátszás /
  timeline-húzás / gesztus közben. **A teljesítmény a design része.**

---

## 11. Reszponzivitás (telefon / tablet)

Expo / React Native — iPhone · Android telefon · iPad · Android tablet.
**Ne** csak skálázd a telefon-UI-t.

- Tableten: több vízszintes tér · nagyobb szerkesztő-előnézet · jobb
  timeline-láthatóság · split-elrendezés · intelligensen nagyobb
  információsűrűség — **ugyanaz a design-nyelv**.
- A meglévő `useLayout()` méret-osztályai (compact / medium / expanded) a bázis.

---

## 12. Akadálymentesség és teljesítmény

**Akadálymentesség — az esztétika sose menjen a használhatóság rovására:**
- [ ] Elég kontraszt · 44pt touch-target · olvasható tipó · tiszta aktív állapotok.
- [ ] `prefers-reduced-motion` támogatás (a Remix-transition és a 3D-mozgás fallbackje).
- [ ] Akadálymentes címkék · screen-reader kompatibilitás.
- [ ] **A 3D-effekt sose legyen szükséges a UI-állapot megértéséhez** (a cyan/magenta
      mellett legyen nem-szín jelölés is).

**Teljesítmény ([10. szakasz](#10-motion-rendszer)):** sima animáció görgetés,
lejátszás, timeline-manipuláció, gesztus és navigáció közben; nincs látványos, de
frame-ejtő animáció.

---

## 13. Anti-minták — amit KERÜLNI kell

**Kerüld:** túlzott neon · túl sok gradiens · túl sok glow · túl sok glass · túl
sok lekerekített kártya · **generikus AI-esztétika** · óriási szöveg mindenhol ·
felesleges keret · céltalan dekoráció · random lebegő részecske · értelmetlen 3D-effekt.

> **A ReMix legyen *drága*, ne *zajos*.**
> **Minimál felület. Maximális kreatív energia.**

---

## 14. Design-review checklista (implementáció ELŐTT)

Minden képernyő előtt, senior product-designer szemmel:

- [ ] A cél azonnal világos?
- [ ] Az elsődleges akció nyilvánvaló?
- [ ] A videó a hős?
- [ ] Úgy érződik, mint a **ReMix** (nem generikus)?
- [ ] A cyan/magenta 3D-azonosság jelen van — **túlzás nélkül**?
- [ ] Prémiumnak érződik?
- [ ] Az animációnak **célja** van?
- [ ] Instrukció nélkül érthető?
- [ ] Egy kézzel használható?
- [ ] Animáció nélkül is jól néz ki?
- [ ] Telefonon ÉS tableten is jó?

**Ha bármelyik „nem" — javíts a design-on az implementáció előtt.**

---

## 15. Végső minőségi léc

A kész app érződjön ezek kombinációjának — **de ne legyen egyik klónja sem**:

**TikTok** (immerzív social videó) · **CapCut** (erős szerkesztés) ·
**Apple** (interakció-minőség és motion) · **modern kreatív szoftver**
(profi workflow) · **retro 3D-szemüveg** (a ReMix egyedi azonossága).

**A pszichológiai út legyen látható a UX-ben:**
> „Tetszik." → „Jobbá tudnám tenni." → „Remixelni akarom." → „Ez az én verzióm."

A távolság **watching → editing → publishing** között legyen a lehető legkisebb.

---

**Design with restraint. Animate with purpose. Make the video the hero.
Make Remix the identity. Make the 3D glasses the visual signature.**

*(Forrás: `design/` brand-assetek · jelen kódbázis auditja · ReMix Master Prompt.
A szövegek magyar UI-hoz i18n-kulcsból — hu/en/de.)*
