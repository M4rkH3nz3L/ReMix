# Remix — teljes menüstruktúra (fa)

> Ez a dokumentum az alkalmazás teljes felhasználói felületét ábrázolja fa
> szerkezetben, a tényleges magyar címkékkel (`src/i18n/locales/hu.json`).
> A csomópontok mellett zárójelben a forrás-komponens szerepel, ahol hasznos.
> Jelölések: **(gomb)**, *(panel)*, „modal”, → átvezetés másik nézetre.

```
Remix (mobil videószerkesztő — Expo / expo-router)
│
├─ 🏠 Kezdőképernyő — Projektek  (src/app/index.tsx)
│   │
│   ├─ Fejléc
│   │   ├─ Logó + „Remix”
│   │   ├─ 🌐 Nyelv               → Nyelvválasztó modal
│   │   ├─ ✨ Demók               (demó-projektek generálása)
│   │   └─ ⬇️ Import              (.vided / .remix projektfájl betöltése)
│   │                              └─ Hiányzó média → „Újracsatolás” / „Később” / „Mégse”
│   │
│   ├─ ➕ Új projekt  (elsődleges gomb)   → „Új projekt” modal
│   │   ├─ Cím (= projekt neve, szövegmező)         ⟵ kötelező
│   │   ├─ SEO — a felfedezéshez  (mind kötelező)
│   │   │   ├─ Leírás (kulcsszavakkal)
│   │   │   ├─ Hashtagek (# nélkül tárolva)
│   │   │   └─ Kulcsszavak (vesszős lista)
│   │   ├─ Képarány
│   │   │   ├─ Fekvő 16:9
│   │   │   ├─ Álló 9:16
│   │   │   └─ Négyzet 1:1
│   │   ├─ Létrehozás  (csak mind kitöltve aktív)   → Szerkesztő
│   │   └─ Mégse
│   │
│   ├─ Utolsó projektek (rács/lista)
│   │   └─ Projekt-kártya
│   │       ├─ koppintás           → Szerkesztő
│   │       └─ hosszú koppintás    → Projekt-menü (ActionSheet)
│   │           ├─ Átnevezés       → „Projekt átnevezése” modal
│   │           ├─ Duplikálás
│   │           ├─ Törlés          → megerősítés
│   │           └─ Mégse
│   │
│   ├─ Sablonok (vízszintes karusszel)
│   │   ├─ Hook + CTA         (🔥 TREND jelölhető)
│   │   ├─ 3 tipp
│   │   ├─ Előtte / Utána
│   │   ├─ Storytime
│   │   ├─ Termékbemutató
│   │   └─ Idézet
│   │       └─ koppintás → új projekt a sablonból → Szerkesztő
│   │
│   └─ Alsó fül-sáv
│       ├─ Projektek   (aktív)
│       ├─ Sablonok    → Új projekt modal
│       └─ AI eszközök → info (az AI a szerkesztőben érhető el)
│
├─ ✂️ Szerkesztő  (src/app/editor/[id].tsx)
│   │  Elrendezés méret-osztály szerint: telefon (compact) / iPad álló (medium) /
│   │  iPad fekvő·desktop (expanded). A rail és a dokkolt inspector csak nagy kijelzőn.
│   │
│   ├─ Fejléc
│   │   ├─ ‹ Vissza                → Kezdőképernyő
│   │   ├─ Projektnév ( • = mentetlen )
│   │   ├─ Képarány-váltó          (16:9 / 9:16 / 1:1 körforgás)
│   │   ├─ ▶ Lejátszó              → Lejátszó nézet
│   │   └─ Export (gomb)           → *Exportálás* panel
│   │
│   ├─ Előnézet (PreviewSurface, „edit” mód)
│   │   └─ rétegek: videó · PiP · grade · szöveg · felirat · matrica · forma · hotspot
│   │
│   ├─ Transport-sáv  (TransportBar)
│   │   ├─ ↶ Visszavonás (undo)
│   │   ├─ ↷ Újra (redo)
│   │   ├─ ⏮ Ugrás az elejére
│   │   ├─ ‹ / › léptetés (−0,1 / +0,1 mp)
│   │   ├─ ▶ / ⏸ Lejátszás / Szünet
│   │   ├─ Idő kijelző (playhead / összhossz)
│   │   ├─ 🔖 Jelölő a lejátszófejnél   („Új jelölő” névvel / meglévő törlése)
│   │   ├─ 🎬 Részlet-előnézet          → valódi render a playhead körül (480p)
│   │   └─ 🔁 Loop (ismétlés)
│   │
│   ├─ Eszköz-rail  (bal oldali, medium/expanded)
│   │   ├─ AI
│   │   ├─ Média
│   │   ├─ Audio
│   │   ├─ Felirat
│   │   ├─ Átirat
│   │   ├─ Elemek
│   │   └─ Export
│   │
│   ├─ Idővonal  (Timeline)
│   │   ├─ Sávok: Videó/kép · PiP · Grade · Szöveg · Felirat · Matrica ·
│   │   │         Interaktív · Zene · Voiceover · SFX
│   │   ├─ Klip: koppintás = kijelölés · húzás · trimmelés · csippentés (zoom/pan)
│   │   └─ Sáv-fejléc menü (hosszú koppintás)
│   │       ├─ 🔇 Némítás / 🔊 Némítás vissza
│   │       ├─ ⭐ Solo be / ki
│   │       └─ 🔒 Zárolás / 🔓 fel
│   │
│   ├─ Eszköztár  (Toolbar) — kontextusfüggő
│   │   │
│   │   ├─ [Kijelölés NÉLKÜL — hozzáadás-műveletek]
│   │   │   ├─ ✨ AI               → *AI-asszisztens* panel
│   │   │   ├─ ⏺ Felvétel          → Kamera-felvevő (modal)
│   │   │   ├─ 🎥 Videó            (videó a videósávra)
│   │   │   ├─ PiP                 (kép-a-képben overlay)
│   │   │   ├─ 🎨 Grade            (grade-réteg) → *Grade-réteg* panel
│   │   │   ├─ 🖼️ Kép
│   │   │   ├─ 🅰️ Szöveg           → *Szöveg* panel
│   │   │   ├─ 💬 Felirat          → *Gyors felirat* panel
│   │   │   ├─ 📄 Átirat           → *Átirat-vágó* panel
│   │   │   ├─ 😊 Matrica          → *Matrica* panel
│   │   │   ├─ 🎵 Zene             → *Hang* panel
│   │   │   ├─ 🗂️ Rétegek          → *Kép-dokumentum* panel
│   │   │   ├─ 🗄️ Tár              → *Médiatár* panel
│   │   │   ├─ 🎯 Hotspot          (interaktív elem) → *Interaktív elem* panel
│   │   │   └─ 📤 Export           → *Exportálás* panel
│   │   │
│   │   └─ [Kijelölt klippel — klip-műveletek]
│   │       ├─ ✕ Kész (kijelölés vége)
│   │       ├─ ☑️ Több (multi-select köteg)
│   │       ├─ ✂️ Vágás (split a playheadnél)
│   │       ├─ ⑂ Ripple (mód: lyuk-bezáró törlés/hossz)
│   │       ├─ 📋 Stílus másol
│   │       ├─ 🪄 Stílus beilleszt  (csak azonos fajtájú klipre)
│   │       ├─ 📄 Duplikálás
│   │       ├─ ⏱️ Pontos           → *Pontos igazítás* panel
│   │       ├─ 🖼️ Képkocka         (frame capture → Kép Stúdió)  [csak videó]
│   │       ├─ Típus-specifikus panelgomb:
│   │       │   ├─ Szöveg      → *Szöveg* panel
│   │       │   ├─ Szűrő       → *Szűrők* panel        [videó/kép]
│   │       │   ├─ Áttűnés     → *Áttűnés* panel       [videó/kép]
│   │       │   ├─ Keret       → *PiP-keret* panel     [PiP-sávon]
│   │       │   ├─ Sebesség    → *Sebesség és hangerő* [videó]
│   │       │   ├─ Forma       → *Forma* panel         [forma]
│   │       │   ├─ Grade       → *Grade-réteg* panel   [grade]
│   │       │   ├─ Keverés     → *Hang* panel          [hang]
│   │       │   └─ Művelet     → *Interaktív elem* panel [hotspot]
│   │       └─ 🗑️ Törlés
│   │
│   └─ SZERKESZTŐ-PANELEK  (PanelHost — lap alul, vagy dokkolt inspector)
│       │
│       ├─ ✨ AI-asszisztens  (*assistant*)
│       │   ├─ Gyors műveletek (chipek): „Rövidítsd 30 mp alá” · „Cím + záró CTA” ·
│       │   │   „Feliratok az alsó harmadba” · „Feliratok egységes stílusa”
│       │   ├─ Mit csináljak? (utasítás-mező) → Küldés az asszisztensnek
│       │   ├─ Parancsok (chipek): ✂️ Csend ki · 🎵 Beat-vágás · 🎯 Reframe ·
│       │   │   ⚡ 30 mp-es short · 💬 Feliratozz · 🔥 Címet a hookra
│       │   ├─ Smart Search — keresés a videó képi tartalmában
│       │   ├─ Auto Edit — 3 változat (🔥 Viral · 🎬 Cinematic · ⚡ Fast-paced)
│       │   │   └─ ▶ Előnézet / koppintás = alkalmazás
│       │   ├─ 🪝 Hook Generator (6 erősebb nyitómondat)
│       │   ├─ 🎬 Look-csomagok (motion-presetek)
│       │   ├─ 🎨 Márka (Brand Kit): stílus mentése / alkalmazása
│       │   ├─ 🎬 Intro / 🏁 Outro beszúrása
│       │   ├─ Vágó-eszközök:
│       │   │   ├─ Holtidő kivágása (csend-vágás)
│       │   │   ├─ Vágás a jelenetváltásoknál
│       │   │   ├─ Vágás a zene ütemére (Beat Sync)
│       │   │   ├─ Beat-pulzus (zoom az ütemre)
│       │   │   ├─ Beat-flash (villanás a 4-esekre)
│       │   │   └─ Smart Reframe (téma-követő kitöltés)
│       │   ├─ 🔊 Sound Design AI (intenzitás: Finom / Normál / Ütős)
│       │   └─ Javaslat-doboz → „N művelet alkalmazása”
│       │
│       ├─ 🎨 Szűrők  (*filter* — videó/kép)
│       │   ├─ Szűrők: Nincs · Meleg · Hideg · Mono · Élénk · Fakó · Éjjel ·
│       │   │           Retró · Naplemente · Erdő   (Erősség csúszka)
│       │   ├─ Auto Color · Illesztés az előzőhöz
│       │   ├─ Képjavítás: Fényerő · Kontraszt · Szaturáció · Hőmérséklet · Vignetta
│       │   ├─ Háttér-kitöltés: Fekete · Elmosott · Nincs
│       │   ├─ Animálás (Animate Photo): Ken Burns · Zoom be/ki · Pan ←/→ · Lebegés
│       │   ├─ 🙈 Arc-elmosás: Arc elmosása · Mozaik · Lágy
│       │   ├─ 🌅 Égbolt-csere: Naplemente · Vihar · Éjszaka · Filmes
│       │   ├─ 💡 Fény (lighting)
│       │   ├─ 🧊 3D tér: Döntés ↕/↔ · 2.5D mélység · Portré-blur ·
│       │   │            Fókusz hátra/előre · Téma kivágása
│       │   ├─ 🔍 Felnagyítás 2× (képekre)
│       │   ├─ Maszk: Ellipszis · Téglalap · Gyémánt/Ötszög/Hatszög/Nyolcszög ·
│       │   │        Invert · Igazítás a vásznon · Lágy szél
│       │   ├─ Green screen (chroma): 🟩 Zöld · 🟦 Kék · Tűrés · Lágy szél
│       │   └─ Kép Stúdió megnyitása → Kép Stúdió (modal)
│       │
│       ├─ ⚡ Sebesség és hangerő  (*speed* — videó)
│       │   ├─ Sebesség (csúszka + finomhangolás)
│       │   ├─ 🚀 Speed ramp presetek: 🦸 Hero · 🔫 Bullet time · 🎞️ Montázs ·
│       │   │   ⚡ Berántás · 🐢 Lassú zárás · Egyéni görbe (görbe-szerkesztő)
│       │   ├─ 🌀 Mozgás-elmosás: Ki · Finom · Közepes · Erős
│       │   └─ Hangerő: Klip hangja · ✨ Enhance Voice · 🔇 Visszhang le ·
│       │              ◆ Hangerő-kulcskocka · Automáció törlése
│       │
│       ├─ 🔊 Hang  (*audio* — Zene / Keverés)
│       │   ├─ Hang-könyvtár (worker) — koppintás = hozzáadás
│       │   ├─ Saját fájl: Zene importálása fájlból
│       │   ├─ Voiceover: Felvétel indítása a lejátszófejtől
│       │   ├─ 🗣️ AI-hang (szöveg → beszéd): szövegmező → Hang generálása
│       │   ├─ Keverés (kijelölt hangklipre):
│       │   │   ├─ Hangerő
│       │   │   ├─ ✨ Enhance Voice
│       │   │   ├─ 🔇 Visszhang le
│       │   │   ├─ 🎚️ Halkítás beszéd alatt (auto-duck)
│       │   │   ├─ ◆ Hangerő-kulcskocka
│       │   │   └─ Automáció törlése
│       │   └─ Hang Stúdió megnyitása → Hang Stúdió (modal)
│       │
│       ├─ 🎯 Interaktív elem  (*hotspot*)
│       │   ├─ Felirat (címke szövege)
│       │   ├─ Időtartam (mp)
│       │   └─ Művelet: URL · Ugrás (időpontra) · Kvíz (kérdés + válaszok)
│       │
│       ├─ 💬 Gyors felirat  (*captions*)
│       │   ├─ Automatikus felirat (AI): Felirat a beszédből (Whisper)
│       │   ├─ Kiemelések + emoji (AI · Caption Studio)
│       │   ├─ Chipek: 🗣️ Beszélő-színek · 🎤 Szó-időzítés · 📐 Okos pozíció
│       │   ├─ Stílus: Sima · Buborék · Kontúr · Neon
│       │   ├─ Kézi feliratok (soronként egy) → hozzáadás a lejátszófejtől
│       │   └─ SRT-import: SRT-felirat importálása
│       │
│       ├─ 😊 Matrica  (*sticker*)
│       │   ├─ Koppints egy matricára (emoji-tár)
│       │   ├─ Formák: Téglalap · Ellipszis · Vonal · Nyíl · Csillag · Logó/kép
│       │   ├─ ✨ Részecskék (render): 🎉 Konfetti · ✨ Szikrák · ❄️ Hó · 🔥 Parázs
│       │   │   └─ 🥁 Beat-sync be/ki
│       │   ├─ ✏️ Rajzolás a vászonra: ecset (🖊️ Filctoll · 🖍️ Szövegkiemelő ·
│       │   │   💡 Neon) · Szín · Vastagság
│       │   ├─ 🧊 3D objektumok: Anyag (Eredeti/Króm/Arany/Üveg/Matt) ·
│       │   │   Környezet (Studio/Sunset/Night/Neon)
│       │   └─ 🙂 Arc-matrica (az arcra helyezve)
│       │
│       ├─ 🎬 Áttűnés  (*transition* — videó/kép)
│       │   ├─ Áttűnés: Bejövő (fade in) · Kimenő (fade out)
│       │   └─ 🎬 Átmenet a következő klipre (Hossz + típus):
│       │       🔍 Zoom-through · 🌀 Pörgés · ↕️ Billenés · 🧊 Kocka · ⭕ Kör ·
│       │       ✨ Feloldás · Wipe (⬅️/➡️/⬆️/⬇️) · Csúszás (⏪/⏩) · 👾 Pixel ·
│       │       🌫️ Elmosás · 🕐 Radiális · 🎬 Feketén át · ⚪ Fehéren át
│       │
│       ├─ ⏱️ Pontos igazítás  (*precision*)
│       │   ├─ Időzítés: Kezdet · Hossz (lépés: 0,1 mp / 1 képkocka)
│       │   ├─ Igazítás: ◀ 1 kocka / 0,1 mp ▶ · Kezdet a lejátszófejhez ·
│       │   │   Lejátszófej a klip elejére / végére
│       │   ├─ Kulcskockák — zoom/pan: ◆ Kulcskocka itt · ✕ Törlés itt ·
│       │   │   Összes törlése · easing (Lágy/Lineáris/Felpörgő/Lassuló)
│       │   └─ Megjelenés: Forgatás · Átlátszóság
│       │
│       ├─ 🗄️ Médiatár  (*library*)
│       │   ├─ 🔗 Import linkből (YouTube, TikTok…): URL · Videó/Hang/Kép
│       │   ├─ 🔎 Keresés a Tárban (fájlnév)
│       │   └─ Frissítés  (szerver-tár: server/library)
│       │
│       ├─ 📄 Átirat-vágó  (*transcript*)
│       │   ├─ Átirat készítése a beszédből / Szerkesztés szövegből
│       │   ├─ Töltelék- és ismételt szavak kijelölése (ööö, umm, dadogás…)
│       │   ├─ Szavakra koppintás = kijelölés (a playhead odaugrik)
│       │   └─ N szó törlése a videóból  (ripple-vágás, visszavonható)
│       │
│       ├─ 🔷 Forma  (*shape*)
│       │   ├─ Forma: Téglalap · Ellipszis · Vonal · Kép
│       │   ├─ Kitöltés: Lila–pink · Kék–türkiz · Naplemente · Sima szín
│       │   ├─ Blend: Normál · Szorzás · Világosít · Különbség
│       │   ├─ Méret és stílus: Szélesség · Magasság · Lekerekítés · Keret ·
│       │   │   Átlátszóság · 🌒 Árnyék
│       │   ├─ 📐 Igazítás (rács ki/be)
│       │   └─ ✨ Ragyogás és kontúr: Ragyogás (Cián/Pink/Fehér/Arany) + méret ·
│       │       Kontúr (Fehér/Fekete/Pink) + vastagság
│       │
│       ├─ 🎨 Grade-réteg  (*adjust*)
│       │   ├─ 🎬 Filmes look (grade-preset): Teal & Orange · Moody · Vintage ·
│       │   │   Noir · Warm Film · Cold · Vibrant · Dreamy · Nincs
│       │   ├─ Erősség · Erősödés (fade in) · Halványulás (fade out)
│       │   └─ 🎛️ Kézi finomhangolás: Fényerő · Kontraszt · Szaturáció ·
│       │       Hőmérséklet · Vignetta
│       │
│       ├─ ⬛ PiP-keret  (*pip* — videó/kép a PiP-sávon)
│       │   ├─ Sarok-lekerekítés: Szögletes · Lekerekített · Nagyon kerek · 🔵 Kör
│       │   ├─ Keret (Vastagság)
│       │   ├─ Keverés a fő videóval (blend): Screen · Multiply · Overlay · Lighten
│       │   └─ Árnyék: 🌒 Vetett árnyék
│       │
│       ├─ 🅰️ Szöveg  (*text*)
│       │   ├─ Szöveg (szövegmező)
│       │   ├─ 🎞️ Sablonok: 📢 Címkártya · 🎬 Mozis · 🟪 Alsó-harmad ·
│       │   │   💬 Feliratdoboz · ✨ Neon · 🪞 Króm 3D · 🥇 Arany 3D · 🎈 Buborék
│       │   ├─ Fülek: Stílus · Animáció · Extra
│       │   │   ├─ Stílus: Stíluspreset (Sima/Buborék/Kontúr/Neon) · Betűtípus ·
│       │   │   │   Szín · Háttér · Méret · Félkövér · 🧊 3D szöveg
│       │   │   │   (Chrome/Arany/Neon 3D/Plasztik · Mélység · Dőlés ↕/↔)
│       │   │   ├─ Animáció: Beúszás · Felcsúszás · Pulzálás · Gépelés · Pop ·
│       │   │   │   Rázás · Karaoke  +  Igazítás (bal/közép/jobb, fent/közép/lent)
│       │   │   └─ Extra: 🎯 Követés (3D) — Pont követése · 🎯 Pont kijelölése ·
│       │   │       🙂 Arc követése · Követés törlése
│       │   └─ (közös a Gyors felirat animációival és stílusaival)
│       │
│       └─ 📤 Exportálás  (*export*)
│           ├─ Videó (MP4): Felbontás · Képfrissítés · Minőség (Takarékos/Normál/Magas)
│           │   ├─ Export az eszközön · ingyen
│           │   └─ Felhő HD render (Remix Pro)
│           ├─ 📲 Posztolás közösségi platformra: TikTok · YouTube · Reels · Egyéb
│           ├─ Borítókép-javaslatok (AI-címekkel) → mentés a Fotókba
│           ├─ Feliratok: Feliratok megosztása (SRT)
│           ├─ Interaktív metaadat: Hotspot-JSON megosztása
│           └─ Projektfájl: .remix megosztása · Collect — csomag a médiával (zip)
│
├─ ▶️ Lejátszó  (src/app/player/[id].tsx) — interaktív lejátszás
│   ├─ ✕ Bezárás → vissza
│   ├─ Előnézet + kattintható hotspotok
│   │   ├─ URL megnyitása
│   │   ├─ Ugrás időpontra (elágazó történet)
│   │   └─ Kvíz (kérdés + válaszok → Helyes/Hibás → Tovább)
│   └─ Vezérlők: ▶/⏸ · haladás-sáv · idő
│
├─ 📷 Kamera-felvevő  (modal — Toolbar „Felvétel”)
│   ├─ Felső sáv: ✕ Bezárás · # Harmadoló rács · ⚡ Vaku (torch) ·
│   │   🔄 Elöl/hátsó kamera
│   ├─ Sebesség-presetek: 0.5× · 1× · 2× · 3×
│   ├─ Szűrő-karusszel (élő előnézet, a klipbe ég)
│   └─ ⏺ Felvevő-gomb (3 mp visszaszámláló, max 60 mp auto-stop)
│
├─ 🖼️ Kép Stúdió  (modal — ImageStudio)
│   ├─ Átalakítás: Balra / Jobbra forgatás · Tükör V / F
│   ├─ Vágás: Szabad · Kiegyenesítés
│   ├─ Korrekció: Fényerő · Kontraszt · Szaturáció · Melegség
│   └─ Rajz
│
├─ 🎧 Hang Stúdió  (modal — HangStudio)
│   ├─ Hangerő
│   ├─ Beúsztatás / Kiúsztatás
│   ├─ Hangjavítás (enhance)
│   ├─ Visszhang-csökkentés
│   └─ Auto-halkítás beszéd alatt
│
├─ 🌐 Nyelvválasztó  (modal — LanguageSwitcher)
│   ├─ English 🇬🇧
│   ├─ Deutsch 🇩🇪
│   └─ Magyar 🇭🇺
│
└─ 💎 Remix Pro (paywall)  (sheet — PaywallSheet)
    ├─ PRO — felhő-workerek (AI-eszközök + felhő-HD render)
    ├─ Mindig ingyen — az eszközödön (teljes szerkesztő · kamera · export)
    ├─ Pro aktiválása
    └─ Most nem
```

## Megjegyzések a fához

- **Kontextusfüggő eszköztár:** a szerkesztő alsó eszköztára attól függ, van-e
  kijelölt klip. Kijelölés nélkül a *hozzáadás*-műveletek, kijelöléssel a
  *klip*-műveletek és a klip fajtájához illő panelgombok látszanak
  (`src/components/editor/Toolbar.tsx`).
- **Panelek megjelenése:** telefonon alulról feljövő lapként, iPad
  fekvő/desktop nézetben jobb oldali dokkolt inspectorként — a lista ugyanaz
  (`src/components/editor/PanelHost.tsx`).
- **Rail vs. eszköztár átfedés:** a bal oldali rail (AI · Média · Audio ·
  Felirat · Átirat · Elemek · Export) ugyanazokat a paneleket nyitja, mint az
  eszköztár megfelelő gombjai — csak nagy kijelzőn jelenik meg.
- **Worker-függő funkciók:** az AI-, felhő-render-, import- és
  hang-könyvtár-műveletekhez fut a háttér-worker; Pro-előfizetéshez kötött
  elemek a paywallt hozzák fel.
- **Címkeforrás:** minden felirat a `src/i18n/locales/hu.json` fájlból; angol
  és német megfelelője `en.json` / `de.json`.
