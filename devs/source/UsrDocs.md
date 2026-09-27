# UsrDocs — teljeskörű felhasználói dokumentáció (megvalósítási TODO)

Ez a dokumentum **megvalósítási terv + checklist** egy beépített, kezdőtől profi
szintig vezető **felhasználói dokumentációhoz** (Súgó/Tudásbázis). Nem maga a
dokumentáció — hanem az, *amit meg kell építeni és meg kell írni* hozzá, a
videós szakma best practice-eivel átszőve, a **rövid videó (short) készítők**
mint fő célközönség szemével.

- Funkció-forrás (hiteles): [STUDIO.md](STUDIO.md) + [src/lib/capabilities.ts](src/lib/capabilities.ts)
- Meglévő interaktív tutorial (NE duplikáld): [src/lib/tutorial.ts](src/lib/tutorial.ts),
  [src/components/tutorial/](src/components/tutorial/)
- Architektúra: [README.md](README.md) · Sablonok: [src/constants/templates.ts](src/constants/templates.ts)

---

## 0. Miért — cél és a viszony a meglévő tutorialhoz

Ma **kétféle** segítség van, és **egy hiányzik**:

| Réteg | Mi ez | Hol | Állapot |
|---|---|---|---|
| **Interaktív tutorial** | Felület-vezető, spotlightos lépések (csináld velem) | „?" gomb a szerkesztő fejlécében → [TutorialMenu](src/components/tutorial/TutorialMenu.tsx) | ✅ kész, 3 szint, hu/en/de |
| **README / STUDIO.md** | Fejlesztői/architektúra-leltár | repo | ✅ kész, de nem end-user |
| **Felhasználói dokumentáció** | **Böngészhető, kereshető olvasmány** — fogalmak, munkafolyamatok, best practice, „miért így" | *nincs* | ❌ **ezt építjük** |

> **Vezérelv:** a UsrDocs a tutorial **olvasható párja**, nem a helyettesítője.
> A tutorial *megmutatja a gombot*; a UsrDocs *elmagyarázza a szakmát mögötte*.
> Minden doksi-cikk végén **„Próbáld ki" → a hozzá tartozó tutorial-lecke indul**
> ([`start(lessonId)`](src/store/tutorialStore.ts)), és minden tutorial-lecke
> „Tudj meg többet" linkje a doksi-cikkre visz. Egyetlen tartalmi igazságforrás,
> két nézet.

**Ne írjunk kétszer.** A szint-taxonómia (`beginner`/`advanced`/`pro`), a
háromnyelvűség (`Loc = {hu,en,de}`) és a SIMA/PRO kapuzás a
[capabilities.ts](src/lib/capabilities.ts)-ből átvéve — a UsrDocs ezeket
újrahasználja, nem újradefiniálja.

---

## 1. Célközönség és hangnem

- **Elsődleges:** rövid videós tartalomgyártó (TikTok / Reels / YouTube Shorts),
  telefonról, gyorsan, gyakran egyedül. Nem vág profi NLE-t, de **eredményt** akar:
  megállítja a görgetést, tartja a nézőt, konvertál.
- **Másodlagos:** haladó creator/small studio, aki színt fényel, multicam-et vág,
  márkás sablont épít.
- **Hangnem:** rövid, cselekvő, második személy („Húzd…", „Tedd a hookot 0–3 mp-be").
  Minden szakasz **eredménnyel** kezd („mit nyersz vele"), nem funkciólistával.
- **Formátum-kánon:** minden cikk = **Cél → Lépések → Best practice → Buktatók →
  Kapcsolódó** blokk. Rövid bekezdések, sok kép/GIF, mobilon olvasható.

---

## 2. Video-craft best practice réteg (a fő megkülönböztető)

Ezeket **át kell szőni** a cikkeken (nem külön „elmélet" fejezet — beágyazott
„💡 Pro tipp" dobozok). Checklist a tartalomíráshoz:

- [ ] **Hook (0–3 mp):** az első 1–3 mp dönt; vizuális/hangos horog, szöveges ígéret.
- [ ] **9:16 biztonságos zóna:** UI-takarás (jobb oldali gombsor, alsó caption-sáv);
      hivatkozz a [safeZone.ts](src/lib/safeZone.ts) overlay-re.
- [ ] **Felirat-olvashatóság:** kontúr/buborék stílus, max ~40 karakter/sor, alsó-közép,
      a caption-safe zóna felett (mobil néma-lejátszás → felirat kötelező).
- [ ] **Beat-vágás & ritmus:** vágj a zene ütemére ([beats.ts](src/lib/beats.ts));
      a J-cut/L-cut a hangátfedéshez.
- [ ] **Megtartás (retention):** vágj minden 1–3 mp-nél, kerüld a holtidőt, pattern-interrupt.
- [ ] **Tempó/pacing:** gyors nyitás, ne temesd a lényeget; hivatkozz a
      [PacingLane](src/components/editor/PacingLane.tsx)-re.
- [ ] **CTA & loop:** a végén tiszta felszólítás; a loopolható vég növeli az ismételt lejátszást.
- [ ] **Hangosság (loudness):** beszéd −14…−16 LUFS környék, zene alárendelve (ducking).
- [ ] **Borító/thumbnail:** első kocka mint borító, olvasható felirattal
      ([thumbStudio.ts](src/lib/thumbStudio.ts)).
- [ ] **Trend & sablon:** használj kész sablont a bevált struktúráért, aztán testre.
- [ ] **Szín & konzisztencia:** egységes look/LUT a márkához; ne told túl a szaturációt.
- [ ] **Export-preset platformra:** TikTok/Reels/Shorts felbontás-fps-bitráta helyesen.
- [ ] **SEO/leírás:** cím + leírás + hashtag + kulcsszó — a felfedezhetőségért
      (az app létrehozáskor kötelezővé teszi, lásd 6. fejezet).

---

## 3. Információs architektúra — a dokumentáció tartalomfája

A doksi **fejezetekre** (`section`) és azon belül **cikkekre** (`article`) bomlik,
szint szerint jelölve (🟢 kezdő · 🟡 haladó · 🔵 pro). Minden cikk egy meglévő
panelhez/funkcióhoz és egy tutorial-leckéhez köthető.

### 🟢 Kezdő

- [ ] **Üdvözlünk / mi ez az app** — mit tud, ingyenes vs. PRO egy mondatban, hova nyúlj.
- [ ] **Projektek** *(kiemelt fejezet — lásd 6.)* — létrehozás, sablonok, SEO-meta,
      képarány, bélyegkép, átnevezés/másolás/törlés, import/export, felhő-backup, remix.
- [ ] **A szerkesztő térképe** — előnézet · transport (lejátszófej, K = play/pause) ·
      idővonal · kontextusos eszköztár · panelek. Kép a fő zónákkal.
- [ ] **Média hozzáadása** — Videó · Kép · Kamera-felvétel · Tár (StorageProvider).
- [ ] **Idővonal alapok** — playhead középen, görgetés-léptetés, csippentés-zoom, kijelölés.
- [ ] **Vágás & trimmelés** — split a fejnél, borotva, szél-fogantyúk (+ trim-módok előszele).
- [ ] **Szöveg & felirat-stílus** — stíluspresetek (plain/outline/bubble/neon), animációk, pozicionálás.
- [ ] **Zene & hang alapok** — import, hangerő, fade, voiceover-felvétel.
- [ ] **Sávok kezelése** — némítás/solo/láthatóság/zár/összecsukás/magasság.
- [ ] **Első export** — local MP4 mentése, platform-preset választás.

### 🟡 Haladó

- [ ] **Trim-módok profin** — ripple / roll / slip / slide (mikor melyik).
- [ ] **Kulcskocka-animáció (Graph Editor)** — csatornák, easing/Bézier, overshoot.
- [ ] **Sebesség & time-remap** — presetek, egyéni görbe, optical flow, freeze.
- [ ] **Színfényelés** — tónus/szín, görbék csatornánként, szkópok, 3D LUT (.cube).
- [ ] **Maszkolás & rotoszkóp** — alak/rajzolt maszk, animált maszk.
- [ ] **Átmenetek** — típusok, hossz/irány/easing/blur/zoom-forgás.
- [ ] **Compositing** — blend-módok, green screen kulcsolás, pre-compose.
- [ ] **Vektorformák** — toll/path, gradient, boolean, path-animáció.
- [ ] **PiP & képkeret** — sarok-elrendezés, méret/pozíció, keret-stílus.
- [ ] **Pro audio & beat** — EQ/kompresszor/pan/reverb, hangerő-automáció, beat-markerek/vágás.
- [ ] **Stickerek, formák, layers (imagedoc)** — overlay-rétegek kezelése.

### 🔵 Pro (felhő / AI — PRO-kapuval jelölve)

- [ ] **Automatikus felirat (Whisper)** — beszéd → időzített felirat, fordítás, karaoke.
- [ ] **AI-vágás & kép-AI** — Auto-Edit / Smart Reframe / Shorts; alany-kivágás, ég-csere, upscale.
- [ ] **AI-változások előnézete** — utasítás → változás-lista → Előnézet → Megtartás/Visszavonás.
- [ ] **Objektum-követés (tracking)** — elem ráültetése mozgó objektumra.
- [ ] **Multicam** — szögek, auto-sync (hang), élő szögváltás, szekvencia.
- [ ] **HD/4K felhő-render & közzététel** — preset, HDR/10-bit, feed-publikálás, remix.
- [ ] **Collab** — megosztás, szerepkörök, valós idejű jelenlét/chat.

### Kereszt-fejezetek

- [ ] **Best practice a short videóhoz** — a 2. fejezet dobozainak gyűjtő-cikke (hub).
- [ ] **Ingyenes vs. PRO** — a kapuzás elve egyszerűen (on-device = ingyen).
- [ ] **Billentyűk/gesztusok referencia** — gyorsgombok, ujjmozdulatok.
- [ ] **GYIK & hibaelhárítás** — worker nem fut, hiányzó média-relink, export-hibák.
- [ ] **Szótár** — playhead, ripple, keyframe, LUT, LUFS, safe zone… laikus definíciók.

---

## 4. In-app megvalósítás — engineering TODO

### 4.1 Adatréteg (egy igazságforrás, expo-mentes, tesztelhető)

- [ ] Új modul: `src/lib/userDocs.ts` a [tutorial.ts](src/lib/tutorial.ts) **mintájára**
      (`Loc = {hu,en,de}`, `localize()`, tiszta adat + szelektorok, React nélkül).
- [ ] Típusok: `DocSection { id, level, icon }` → `DocArticle { id, sectionId, level,
      pro?, title, blocks[] }`; blokk-típusok: `heading | paragraph | steps | tip |
      pitfall | media | proTag`.
- [ ] Kereszt-hivatkozás mezők: `article.lessonId?` (→ `getLesson`/`start`) és fordítva
      a tutorial-lecke `docId?`-je (opcionális bővítés a `TutorialLesson`-ön).
- [ ] SIMA/PRO jelölés a [capabilities.ts](src/lib/capabilities.ts)-ből származtatva
      (ne kézzel — a cikk egy `capabilityId`-t hivatkozzon, a badge abból jöjjön).
- [ ] Szelektorok: `docsByLevel()`, `getArticle(id)`, `searchDocs(query, lang)`.
- [ ] Unit teszt: `src/lib/userDocs.test.ts` — minden `lessonId`/`capabilityId`
      létező-e, nincs árva link, minden cikknek van mindhárom nyelve.

### 4.2 Képernyők / navigáció

- [ ] `src/app/docs/index.tsx` — tudásbázis kezdőlap: szint-szűrő (🟢🟡🔵),
      fejezet-lista, keresősáv, „Folytasd, ahol abbahagytad".
- [ ] `src/app/docs/[topic].tsx` — cikk-nézet (blokk-renderer), fejléc-breadcrumb,
      „Próbáld ki" (tutorial indítás) + „Kapcsolódó cikkek".
- [ ] Regisztráció az [_layout.tsx](src/app/_layout.tsx) stackben (route-védelem nem kell,
      publikus).
- [ ] Mélylink: `/docs/<articleId>` és a szerkesztő „?" menüjéből „Teljes dokumentáció"
      gomb a bottom sheet aljára (a [TutorialMenu](src/components/tutorial/TutorialMenu.tsx)-be).

### 4.3 A hozzáférés gomb — a projektlistán (kiemelt kérés)

> Ma a projektlista fejlécében **Account · Shop · Import** gombok vannak
> ([src/app/index.tsx:349-372](src/app/index.tsx#L349-L372)), és lent egy
> **Projektek / Sablonok / AI eszközök** tab-sor. Doksi-belépő **nincs**.

- [ ] **Fejléc-gomb** hozzáadása az Import mellé: `book-outline` (vagy `help-buoy-outline`)
      ikon + `t('docs.title')` felirat, `onPress={() => router.push('/docs')}` — az
      `importButton` stílust újrahasználva (konzisztens megjelenés).
- [ ] **Üres állapot CTA:** amikor nincs projekt ([ListEmptyComponent](src/app/index.tsx#L428)),
      a „Hozd létre az elsőt" mellé egy másodlagos link: „Nézd meg, hogyan → Dokumentáció".
- [ ] **(Opció) negyedik tab** a bottom tab-sorban („Súgó", `help-circle-outline`) — dönteni
      kell fejléc-gomb *vagy* tab; a fejléc-gomb az ajánlott (a tab-sor már 3 elemű és
      a BottomNav is jelen van).
- [ ] A11y: `accessibilityRole="button"`, `accessibilityLabel`, `hitSlop`.

### 4.4 Keresés, i18n, offline, megjelenés

- [ ] Kliens-oldali kereső a `searchDocs()`-ra (cím + törzs, ékezet-érzéketlen, nyelv-szűrt).
- [ ] i18n: a **chrome** (gombok, fejezet-nevek) az [src/i18n/locales](src/i18n/locales) alá
      (`docs.*` kulcsok); a **cikk-törzs** inline háromnyelvű a `userDocs.ts`-ben (mint a
      tutorial — nem duplázunk kulcs-özönt).
- [ ] Offline: a tartalom bundle-be égetve (nincs hálózat) — a képek/GIF-ek `require`-rel
      vagy `expo-image` local asset.
- [ ] Design: [BottomSheet](src/components/ui/BottomSheet.tsx)/`palette`/`radius` a
      [src/design](src/design)-ból; sötét téma, mobil-tipográfia.
- [ ] Verziószám a doksi lábában (app-verzió + „utolsó frissítés").

---

## 5. Tartalom-produkció — writing TODO

- [ ] **Írási sablon** rögzítése: minden cikk `Cél → Lépések → 💡 Best practice →
      ⚠️ Buktató → 🔗 Kapcsolódó`.
- [ ] **Asset-terv:** cikkenként 1–3 screenshot vagy rövid GIF; egységes eszköz-keret,
      9:16 példaprojekt; tárolás `assets/docs/`.
- [ ] **Nyelvi sorrend:** először **hu**, majd **en**, majd **de** (a tutorial gyakorlatához igazodva).
- [ ] **Terminológia-lista** (szótárral szinkronban), hogy a fordítások egységesek.
- [ ] **Lektorálás:** 1 kör tartalmi (creator-szemmel), 1 kör nyelvi/nyelvenként.
- [ ] **„Best practice" dobozok** a 2. fejezet checklistjéből visszahivatkozva.

---

## 6. „Projektek" fejezet — részletes vázlat (kiemelt kérés)

A doksinak **be kell mutatnia magukat a projekteket** is. Cikkvázlat
([forrás: src/app/index.tsx](src/app/index.tsx) + [projectUtils.ts](src/lib/projectUtils.ts)):

- [ ] **Mi az a projekt** — egy szerkeszthető munka (sávok, klipek, meta); a bélyegkép az
      első videó-kocka; a lista a Studio kezdőlapja.
- [ ] **Új projekt létrehozása** — a **„+ Új projekt"** gomb ([index.tsx:376](src/app/index.tsx#L376)):
  - [ ] Cím megadása (ez a projekt neve és a SEO-cím is).
  - [ ] **SEO-meta kötelező** — leírás + hashtagek + kulcsszavak; a „Létrehozás" csak
        akkor aktív, ha mind kitöltve ([seoReady](src/app/index.tsx#L155)). Magyarázd el
        *miért* (felfedezhetőség, feed-ranking).
  - [ ] **Képarány** választás: 9:16 (alap, short), 16:9, 1:1 — mikor melyik.
- [ ] **Sablonból indulás** — 12 kész sablon ([templates.ts](src/constants/templates.ts)):
      hook-cta, three-tips, before-after, storytime, product, quote, pov, listicle,
      tutorial, promo-sale, testimonial, meme; „felkapott" jelölés; a szövegsáv előre
      feltöltve, a videó a creatoré. Best practice: melyik sablon melyik célra.
- [ ] **Projekt megnyitása / bélyegkép / meta-sor** — koppintás → szerkesztő; a kártya
      mutatja képarány · hossz · klip-szám.
- [ ] **Projekt-menü (hosszú nyomás)** — Megosztás a feedbe · Átnevezés · Másolás ·
      Collab-megosztás · Törlés ([projectMenu](src/app/index.tsx#L271)).
- [ ] **Másolás & remix-lineage** — a másolat `remixOf`-fal jelöli az eredetit.
- [ ] **Import / Export** — `.ReMix` fájl (asset-ujjlenyomat + automatikus relink hiányzó
      médiára), Collect Project (zip). Import-gomb a fejlécben.
- [ ] **Felhő-backup & eszközváltás** — automatikus `backupProjectToCloud`, belépéskor
      `syncProjectsFromCloud` visszahozza a hiányzókat.
- [ ] **Velem megosztott projektek** — a collab-blokk a lista tetején; szerepkörök.
- [ ] **Törlés következménye** — „nincs projekt → nincs videó": a feed-posztok és a
      felhő-projekt is törlődik (cascade).
- [ ] **Hol a dokumentáció** — mutasd meg az új doksi-gombot (4.3), zárd „Próbáld ki"-vel.

---

## 7. Fázisok / mérföldkövek

- [ ] **M1 — Váz (engineering):** `userDocs.ts` típusok + üres adat, `docs/index` +
      `docs/[topic]` képernyők, projektlista-gomb, route. *(Kész, ha üres doksi böngészhető.)*
- [ ] **M2 — Kezdő tartalom (hu):** a 🟢 fejezet összes cikke + a Projektek fejezet (6.),
      képekkel; „Próbáld ki" bekötve a tutorialhoz.
- [ ] **M3 — Haladó + Pro tartalom (hu):** 🟡 és 🔵 cikkek, SIMA/PRO badge-ek.
- [ ] **M4 — Kereszt-fejezetek:** best practice hub, ingyenes/PRO, gyorsgombok, GYIK, szótár.
- [ ] **M5 — Kereső + i18n (en/de):** teljes fordítás, keresés, offline assetek.
- [ ] **M6 — Lektorálás & polish:** creator-review, nyelvi kör, verziószám, telemetria (mit olvasnak).

---

## 8. Definition of Done / elfogadási kritériumok

- [ ] A projektlistáról **egy koppintással** elérhető a dokumentáció (gomb látszik, működik).
- [ ] A dokumentáció **böngészhető** szint szerint (🟢🟡🔵) és **kereshető**.
- [ ] Minden **panel/fő funkció** lefedve legalább egy cikkel; minden cikknek van
      **hu/en/de** változata.
- [ ] A **Projektek** fejezet bemutatja a létrehozást (SEO-metával), sablonokat, menüt,
      import/export/backup/remix/collab folyamatot.
- [ ] Minden cikk tartalmaz legalább egy **best practice** és egy **buktató** dobozt.
- [ ] A **PRO** funkciók egyértelműen jelölve (a capabilities-ből), az ingyenes/PRO elv
      egy külön cikkben tisztázva.
- [ ] „Próbáld ki" linkek a tutorial-leckékre **mind élnek** (teszt zöld).
- [ ] `npm run audit` zöld (tsc + lint + jest, benne a `userDocs.test.ts`).

---

## 9. Nem cél (most)

- Videós oktatóvideók/screencast-ok gyártása (később, külön).
- Külső (weboldalas) dokumentáció-portál — most **in-app**, offline.
- A meglévő interaktív tutorial átírása — csak **linkeljük** oda-vissza.
- Közösségi/creator-tartalom (feed) dokumentálása azon túl, ami a közzétételhez kell.

---

### Gyors forrás-térkép (implementációhoz)

| Terület | Fájl |
|---|---|
| Projektlista + gomb helye | [src/app/index.tsx](src/app/index.tsx) |
| Szerkesztő „?" / tutorial belépő | [src/app/editor/[id].tsx:455](src/app/editor/[id].tsx#L455) |
| Tutorial adat (minta a userDocs-hoz) | [src/lib/tutorial.ts](src/lib/tutorial.ts) |
| Tutorial menü/overlay | [src/components/tutorial/](src/components/tutorial/) |
| Funkció-leltár (SIMA/PRO) | [STUDIO.md](STUDIO.md) · [src/lib/capabilities.ts](src/lib/capabilities.ts) |
| Sablonok | [src/constants/templates.ts](src/constants/templates.ts) |
| Eszköztár (funkció-belépők) | [src/components/editor/Toolbar.tsx](src/components/editor/Toolbar.tsx) |
| i18n | [src/i18n/locales](src/i18n/locales) |
| Design-tokenek | [src/design](src/design) |
