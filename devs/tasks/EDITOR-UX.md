# 🎬 EDITOR-UX — a (sima) videó-szerkesztő: használhatóság + reszponzivitás + látható forrás-mappa

> **Forrás:** felhasználói kérés (2026-10-08) — „tegyük jobban használhatóvá + reszponzívabbá a UI-t,
> és kell egy mappa, ahol a forrásfájlok (mind) láthatóak". · **Testvérek:** [CORE.md](./CORE.md) (editor-mag —
> a gesztus/mentés/onboarding remainderek innen jönnek), [06-video-editor](./06-video-editor.md) (NLE-feature-ök),
> [10-brand-ui](./10-brand-ui.md) (vizuális nyelv), [08-storage](./08-storage.md) (forrás-asset/sync).
> **Érintett kód:** [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) (elrendezés, `:573–656`) ·
> [src/hooks/useLayout.ts](../../src/hooks/useLayout.ts) + [src/constants/layout.ts](../../src/constants/layout.ts)
> (`EditorMetrics`, méret-osztályok) · [SourceSheet.tsx](../../src/components/SourceSheet.tsx) (forrás-bin) ·
> [Toolbar.tsx](../../src/components/editor/Toolbar.tsx) · [Timeline.tsx](../../src/components/editor/Timeline.tsx) ·
> [TimelineClip.tsx](../../src/components/editor/TimelineClip.tsx) · [PanelHost.tsx](../../src/components/editor/PanelHost.tsx).

---

> **📊 Haladás (2026-10-08):** ✅ 1 · 🟡 0 · ⬜ 6 nyitva — Σ 7 tétel. **§2.1 KÉSZ** (látható forrás-mappa).
> **Az editor-MAG kész + tesztelt**
> ([CORE.md](./CORE.md) 8/10); ez a fájl a **UI-réteget** célozza: a forrás-mappa láthatóvá tétele, a
> húzásos szerkesztés, és a már kész magok (MOVE_CLIP, mentés-robusztusság, recovery) felhasználói felülete.

## 0. Kontextus & cél
A szerkesztő már **reszponzív**: a `useLayout()` három méret-osztályt ad (`compact` <600pt / `medium` 600–899 /
`expanded` ≥900×600), és az [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) 4 elrendezést vált (iPad-fekvő =
dokkolt inspector + teljes timeline; iPad-álló = timeline + felülről jövő panel; telefon-fekvő = 52% oldalsáv;
telefon-álló = panel ↔ timeline csere). A **mag** (command-bus, undo, mentés) [CORE.md](./CORE.md)-ben bizonyítottan kész.

**A hiány felhasználói szemmel:** (1) a **forrás-bin modal sheet** — nem látszik folyamatosan, pedig a user
„mappát" akar, ahol MIND a forrásfájl (video+kép+hang) látszik; (2) **nincs drag-and-drop** a forrásból/sávok
közt — csak koppintásos insert; (3) a kész magok (sávok-közti-mozgatás, „Mentés most", recovery) **UI nélkül**
láthatatlanok. Ez a terv ezt a három hiányt zárja, a MEGLÉVŐ reszponzív rétegre építve (nem új layout-motor).

## 1. Jelenlegi állapot (bizonyíték)
- **Reszponzív váz KÉSZ:** `useLayout` + `EditorMetrics` (`railWidth`/`inspectorWidth`/`trackHeaderWidth`/`trackScale`
  méret-osztályonként, [layout.ts](../../src/constants/layout.ts) `:92–114`); a dokkolt inspector már létezik
  (iPad-fekvő, `inspectorWidth:360`, [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) `:587–607`).
- **Forrás-bin VAN, de sheet:** [SourceSheet.tsx](../../src/components/SourceSheet.tsx) — `project.assets` böngésző,
  MINDEN fajta (video+kép+hang), thumbnail + állapot-badge (cached/cloud/stale) + sync-badge + import/insert/remove/
  download; a Toolbar „Forrás" gombjáról nyílik (`:738`), `StudioSheet` modalban.
- **Hozzáadás csak koppintással:** SourceSheet insert (+kör) / Toolbar pickerek / kamera. **Drag-and-drop NINCS.**
- **Kész, de UI nélküli magok:** `store.moveClip` + `canHostClip` (CORE §2.3), atomi mentés + `duplicateProject` +
  crash-recovery + `isProjectTooLarge` (CORE §2.7), `setPlayhead` frame-snap (CORE §2.6).

## 2. Feladatlista
> Státusz-tagek a [00-README](./00-README.md) §1 szerint. **Sorrend-ajánlás:** §2.1 (forrás-mappa — a fő kérés) →
> §2.2 (drag-to-timeline) → §2.3 (mentés-UX) → a többi.

### 2.1 Látható forrás-mappa (állandó forrás-bin) — P1 🎯 ✅ KÉSZ (2026-10-08)
- [x] ✅ **`SourceBin` kiszervezés:** a lista + badge-ek + import/insert/remove/download egy elrendezés-mentes
  [SourceBin](../../src/components/SourceBin.tsx)-be (`compact`/`scroll` propok); a [SourceSheet](../../src/components/SourceSheet.tsx)
  már csak vékony sheet-keret, ami a SourceBin-t tölti (egy kód minden elrendezéshez).
- [x] ✅ **Dokkolt forrás-panel a meglévő reszponzív layouton:** új `sourceBinWidth` az [EditorMetrics](../../src/constants/layout.ts)-ben
  (expanded 300 / medium 240 / compact 0); az [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) `expanded` (iPad-fekvő/desktop)
  + `medium-álló` (iPad-álló) sávjában a SourceBin **állandó bal oszlop** a preview mellett. `compact` (telefon-álló): marad a
  sheet (nincs hely dokknak), a Toolbar „Forrás" gombjáról egy koppintás.
- [x] ✅ **MIND a forrásfájl látszik** (video+kép+hang) — típus-szűrő chipek (`countSourceKinds` pure + teszt) darabszámmal
  + „in use" jelzés; üres-bin → import-CTA. A forrás→timeline beszúrás közös magja: `store.insertSourceAsset` (`buildSourceClip`
  pure + teszt), amit a Toolbar ÉS a dokkolt panel is hív.
- **Kész, ha:** iPad-en/fekvőben a forrás-mappa állandóan látszik a timeline mellett ✅; telefonon egy koppintás ✅; mind a 3 fajta látszik + szűrhető ✅.

### 2.2 Drag-and-drop: forrásból a timeline-ra + sávok közt — P1
- [ ] 🖼️ **Forrás → timeline húzás:** a `SourceBin` egy elemét a timeline-ra húzva `ADD_CLIP` a drop-pozíciónál, a
  **kompatibilis sávra** (`canHostClip`, CORE §2.3), frame-illesztve; vizuális drop-highlight. Ma csak koppintásos insert.
- [ ] 🖼️ **Klip sávok-közti húzása (MOVE_CLIP gesztus):** a [TimelineClip](../../src/components/editor/TimelineClip.tsx)
  függőleges húzása a szomszédos kompatibilis sávra → `store.moveClip` (a mag + guard CORE §2.3-ban KÉSZ); zárolt cél tiltott.
- **Kész, ha:** médiát a forrás-mappából húzással is a timeline-ra lehet tenni, és a klip húzással másik sávra mozgatható.

### 2.3 Mentés-UX láthatóvá tétele (CORE §2.7 remainderek) — P1
A mentés-mag kész; a felhasználó lássa + vezérelhesse.
- [ ] 🖼️ **Mentés-állapot + „Mentés most":** a fejlécben mentve / „mentés…" / „bukott" jelző (a `dirty`/`saveFailed`
  állapotból) + explicit „Mentés most" gomb (azonnali `saveProjectAndEvents`).
- [ ] 🖼️ **„Mentés másként / duplikálás" belépő:** a projekt-menüben `duplicateProject` (CORE §2.7, KÉSZ) hívása.
- [ ] 🖼️ **Méret/elévülés jelzés:** `isProjectTooLarge` → finom figyelmeztető banner; a history-limit elévülésének jelzése.

### 2.4 Toolbar + panel-ergonómia — P2
- [ ] ⬜ **Toolbar tabletre:** a kontextuális [Toolbar](../../src/components/editor/Toolbar.tsx) (807 sor, sok gomb) `expanded`-en
  ne csak vízszintes scroll legyen — csoportosított, kétsoros vagy oldal-rail elrendezés a nagyobb kijelzőn; nagyobb érintő-célok.
- [ ] ⬜ **Panel ↔ timeline átmenet:** `compact`-on a panel teljesen elfedi a timeline-t — egy „vissza a timeline-hoz" gyorsgomb + a kijelölés megtartása.

### 2.5 Üres-állapot + onboarding (CORE §2.8) — P1
- [ ] ⬜ **Üres-projekt állapot:** üres timeline → a forrás-mappára mutató onboarding („adj hozzá médiát a forrás-binből"),
  ne üres fekete vásznon ragadjon a felhasználó. (A `SourceBin` üres-CTA-jával közös.)
- [ ] ⬜ **Granuláris média-helyreállítás:** a `recoverMissingMedia` per-fájl progress + részleges retry + a maradékra kézi relink.

### 2.6 Lejátszás-parity UI (CORE §2.6 remainder) — P2
- [ ] ⬜ **Klip-határ gapless előnézet:** a vágott klipek határán ne „kattanjon" (következő klip előre-betöltése a playheadből).

### 2.7 Billentyű/gesztus-teljesség + help (CORE §2.10) — P2
- [ ] ⬜ **Egységes parancskészlet:** space/J-K-L/I-O/S/⌫/⌘Z-⇧⌘Z/⌘C-X-V (klip-vágólap, CORE §2.4)/←→ (frame-léptetés).
- [ ] 🖼️ **Help-overlay:** „?" a Toolbaron → gesztus/billentyű-térkép (a profi vágó-módok felfedezhetősége).

## 3. Kész, ha
1. A **forrás-mappa láthatóvá válik**: iPad-en/fekvőben állandó oldal-oszlop a timeline mellett, telefonon egy koppintás;
   mind a 3 forrás-fajta (video/kép/hang) látszik, állapot-badge-ekkel, üres-CTA-val.
2. **Húzással is szerkeszthető**: forrás → timeline drop, és klip sávok közti húzása (`MOVE_CLIP`).
3. A **mentés látható + vezérelhető** (állapot + „Mentés most" + duplikálás + méret-jelzés), az üres-állapot a forrás-binre vezet.
4. A reszponzív finomítások (toolbar-ergonómia tabletre, panel↔timeline átmenet) + a help-overlay megvannak.

> A terv a MEGLÉVŐ reszponzív vázra (`useLayout`/`EditorMetrics`) + a kész magokra (`moveClip`, mentés-robusztusság,
> recovery) épít — nem új layout-motort ír, hanem a már bizonyított logikát teszi **láthatóvá és kézre-esővé**.
