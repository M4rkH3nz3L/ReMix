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

> **📊 Haladás (2026-10-08):** ✅ 4 · 🟡 2 · ⬜ 1 nyitva — Σ 7 tétel. **§2.1 KÉSZ** (látható forrás-mappa);
> **§2.2 mag kész** (sávváltás-gomb; húzás-gesztus 🖼️ device); **§2.3 KÉSZ** (mentés-UX: ⋯ projekt-menü + méret-banner);
> **§2.5 üres-állapot KÉSZ** (onboarding-kártya; granuláris recovery 🖼️ device); **§2.7 KÉSZ** (egységes keymap-mag + teszt
> + web-bekötés + help-overlay). Nyitva: §2.4 (toolbar-ergonómia, P2) · §2.6 (gapless, P2) · §2.2/§2.5 device-remainderek.
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

### 2.2 Drag-and-drop: forrásból a timeline-ra + sávok közt — P1 🟡 (sávváltás KÉSZ, húzás hátra)
- [x] ✅ **Klip sávok közti mozgatása — GOMBBAL (verifikálható):** a Toolbar **„Sávváltás"** gombja a kijelölt klipet a
  **következő kompatibilis sávra** lépteti (`store.moveSelectedClipToNextTrack` → `moveClip`, a kezdetet megtartva); csak
  akkor látszik, ha a klip fajtájához ≥2 kompatibilis sáv van (`compatibleTracksFor` pure + teszt: video↔pip,
  music→voiceover→sfx, text↔captions). A core-guard a zárolt cél-sávot tiltja. **Ez adja a funkciót** a húzás-gesztus nélkül is.
- [ ] 🖼️ **Klip sávok-közti HÚZÁSA (MOVE_CLIP gesztus):** a [TimelineClip](../../src/components/editor/TimelineClip.tsx)
  `movePan`-je `translationY`-t is figyeljen → a szomszédos kompatibilis sávra; timeline-szintű sáv-geometria kell (a klip ma
  csak a saját sávját ismeri) → **device-verifikált gesztus-munka (login mögött itt nem látszik).**
- [ ] 🖼️ **Forrás → timeline HÚZÁS:** a `SourceBin` elemét a timeline-ra húzva `ADD_CLIP` a drop-pozíciónál
  (`insertSourceAsset(asset, atSec)` KÉSZ hozzá) — RN cross-komponens DnD, **device-verifikált.** (A koppintásos insert a dokkolt panelen már megy.)
- **Kész, ha:** a klip másik sávra tehető (gombbal ✅ + húzással 🖼️), és forrás húzással is a timeline-ra kerül (🖼️).

### 2.3 Mentés-UX láthatóvá tétele (CORE §2.7 remainderek) — P1 ✅ KÉSZ (2026-10-08)
A mentés-mag kész; a felhasználó lássa + vezérelhesse.
- [x] ✅ **Mentés-állapot + „Mentés most":** a fejlécben mentve / „mentés…" / „bukott" jelző (a `dirty`/`saveFailed`
  állapotból, [editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx)) + a **⋯ projekt-menü** „Mentés most" tétele (azonnali
  `saveProjectAndEvents` + `markSaved` + `clearRecovery`).
- [x] ✅ **„Mentés másként / duplikálás" belépő:** a ⋯ projekt-menü „Mentés másként (másolat)" tétele a jelenlegi mentése
  után `duplicateProject`-et hív (CORE §2.7, KÉSZ) és a MÁSOLATRA navigál (`router.replace`).
- [x] ✅ **Méret-jelzés:** `isProjectTooLarge` → finom amber figyelmeztető banner (mind a 4 elrendezés-sávban), a bannerre
  koppintva nyílik a ⋯ projekt-menü (ott duplikálható/szétszedhető). *(history-limit-elévülés jelzése külön, nem kritikus.)*
- **Kész, ha:** a mentés-állapot látszik ✅, „Mentés most" + „Mentés másként" a ⋯-menüből elérhető ✅, nagy projekt bannert kap ✅.

### 2.4 Toolbar + panel-ergonómia — P2
- [ ] ⬜ **Toolbar tabletre:** a kontextuális [Toolbar](../../src/components/editor/Toolbar.tsx) (807 sor, sok gomb) `expanded`-en
  ne csak vízszintes scroll legyen — csoportosított, kétsoros vagy oldal-rail elrendezés a nagyobb kijelzőn; nagyobb érintő-célok.
- [ ] ⬜ **Panel ↔ timeline átmenet:** `compact`-on a panel teljesen elfedi a timeline-t — egy „vissza a timeline-hoz" gyorsgomb + a kijelölés megtartása.

### 2.5 Üres-állapot + onboarding (CORE §2.8) — P1 🟡 (üres-állapot KÉSZ, granuláris recovery device hátra)
- [x] ✅ **Üres-projekt állapot (2026-10-08):** `isProjectEmpty` pure + teszt ([projectUtils.ts](../../src/lib/projectUtils.ts)) →
  üres timeline esetén a fekete vászon helyett **onboarding-kártya** ([editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx),
  mind a 4 elrendezés-sávban): tableten a dokkolt forrás-mappára mutat (←), telefonon megnyitja a forrás-sheetet (CTA).
- [ ] 🖼️ **Granuláris média-helyreállítás:** a bulk felhő-restore ([mediaSync.restoreMissingMedia](../../src/lib/mediaSync.ts),
  betöltéskor) + auto-content-relink + kézi picker (`relinkMissing`) **MEGVAN**; a per-fájl progress + részleges retry a
  `restoreMissingMedia` progress-callback refaktorát kéri + valós hiányzó-fájl tesztet → **device-verifikált remainder.**
- **Kész, ha:** üres projekt nem ragad fekete vásznon ✅; a hiányzó média visszaáll (bulk ✅, per-fájl progress 🖼️).

### 2.6 Lejátszás-parity UI (CORE §2.6 remainder) — P2
- [ ] ⬜ **Klip-határ gapless előnézet:** a vágott klipek határán ne „kattanjon" (következő klip előre-betöltése a playheadből).

### 2.7 Billentyű/gesztus-teljesség + help (CORE §2.10) — P2 ✅ KÉSZ (2026-10-08)
- [x] ✅ **Egységes parancskészlet:** pure `resolveShortcut` mag + teszt ([editorKeymap.ts](../../src/lib/editorKeymap.ts),
  14 eset): space/J-K-L/I-O/S/⌫/⌘Z-⇧⌘Z-Ctrl+Y/⌘C-X-V/←→; szövegmezőben + Alt-kombónál nem sül el. A bekötés
  ([useEditorKeyboard.ts](../../src/hooks/useEditorKeyboard.ts)) a feloldott akciót a store-on futtatja (a billentyű = a gomb:
  split/paste a Toolbar-logikát tükrözi), **web/tablet-billentyűzeten** (natíven no-op, ott a gesztus+help vezet).
- [x] ✅ **Help-overlay:** a Toolbar **„Súgó" (?)** gombja → [HelpOverlay](../../src/components/editor/HelpOverlay.tsx)
  (StudioSheet): gesztus-térkép + a `SHORTCUT_HINTS` magból épülő billentyű-lista (garantáltan szinkronban a `resolveShortcut`-tal).
- **Kész, ha:** a parancskészlet egy helyen definiált + tesztelt ✅; a „?"-ből előjön a gesztus/billentyű-térkép ✅.

## 3. Kész, ha
1. A **forrás-mappa láthatóvá válik**: iPad-en/fekvőben állandó oldal-oszlop a timeline mellett, telefonon egy koppintás;
   mind a 3 forrás-fajta (video/kép/hang) látszik, állapot-badge-ekkel, üres-CTA-val.
2. **Húzással is szerkeszthető**: forrás → timeline drop, és klip sávok közti húzása (`MOVE_CLIP`).
3. A **mentés látható + vezérelhető** (állapot + „Mentés most" + duplikálás + méret-jelzés), az üres-állapot a forrás-binre vezet.
4. A reszponzív finomítások (toolbar-ergonómia tabletre, panel↔timeline átmenet) + a help-overlay megvannak.

> A terv a MEGLÉVŐ reszponzív vázra (`useLayout`/`EditorMetrics`) + a kész magokra (`moveClip`, mentés-robusztusság,
> recovery) épít — nem új layout-motort ír, hanem a már bizonyított logikát teszi **láthatóvá és kézre-esővé**.
