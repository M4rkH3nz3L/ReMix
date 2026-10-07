# 🧱 CORE — Editor-mag (alapfunkció) → 100%

> **Forrás:** [audit](../source/audit-2026-10-main.md) §19 (`Editor core (alapfunkció) ~70–80%`) + §0 (a lánc: `PURE CORE → TEST → UI → parity → cloud`).
> **Testvérek:** [06-video-editor](./06-video-editor.md) (profi NLE — keyframe/color/mask/effect), [11-performance](./11-performance.md) (timeline-perf), [12-code-quality](./12-code-quality.md) (uri→assetId + command-refaktor), [03-collaboration](./03-collaboration.md) (clip-lock).
> **Érintett kód:** [src/lib/commands.ts](../../src/lib/commands.ts) · [src/store/editorStore.ts](../../src/store/editorStore.ts) · [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) · [src/lib/storage.ts](../../src/lib/storage.ts) · [src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts) · [src/components/preview/](../../src/components/preview/) · [src/components/editor/](../../src/components/editor/) · [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx).

---

> **📊 Haladás (2026-10-08):** ✅ 1 teljes · 🟡 0 mag kész · ⬜ 9 nyitva — Σ 10 tétel.
> **§2.1 KÉSZ:** a command-bus magja (reducer + store) most **bizonyítottan tesztelt** —
> `commands.test.ts` + `editorStore.test.ts`, 69 teszt, a `npm run audit` futtatja.
> Az **editor-mag a platform legfontosabb rétege** — minden stúdió (video/image/audio/live) és az AI is
> a command-buson+store-on keresztül dolgozik. A mag **funkcionálisan ~70–80%**, de a maradék 20–30% nem
> „még egy feature", hanem **megbízhatóság**: a reducer+store **tesztelve**, a szerkesztés **sosem veszít
> munkát**, a `Preview == Export` a mag-interakciókra is igaz, és a hiányzó alap-műveletek (klip sávok
> közti mozgatása, klip-vágólap) megvannak. Ez a fájl ezt a 20–30%-ot zárja.

## 0. Kontextus & cél

Az audit (§19) külön kezeli az **„Editor core (alapfunkció)"-t** (a felhasználó által végigjárható alap-
szerkesztő hurok: *projekt megnyit → média az idővonalra → trim/split/mozgat → előnézet → mentés*) és a
**„Profi NLE"-t** (keyframe/color/mask/effect-chain → az a [06](./06-video-editor.md)). **Ez a fájl CSAK az
alap-magot viszi 100%-ra** — nem duplikálja a 06/11/12-t.

**Vezérelv (AGENTS.md + audit §0):** minden módosítás a **command-buson** megy át (undo!), az idő
másodpercben, a vágások a **frame-rácsra** ülnek, és a mag **expo-mentes → tesztelhető**. A 100% definíciója:

```text
a command-bus + store BIZONYÍTOTTAN helyes (teszt) → minden alap-művelet megvan és undo-zható
  → a lejátszás frame-pontos és A/V-szinkron → a munka SOHA nem vész el (atomi mentés + recovery)
```

A „miért most": a `00-README.md` §0 szerint *„a mag nélkül nem lehet rendesen fejleszteni"* — minden további
epik (06/07/03/05) erre a magra épít. Egy tesztelt, megbízható mag a **legjobb ár/érték** az egész tervben.

## 1. Jelenlegi állapot (bizonyíték)

**Szilárd (ez adja a ~70–80%-ot):**
- **Command-réteg** — 24 nevesített parancs + pure `applyCommand` reducer ([commands.ts](../../src/lib/commands.ts)),
  `dispatch`/`applyBatch` (köteg = egy undo), `undo`/`redo` (50 lépés), event-napló (AI-memória nyersanyag),
  élő-collab broadcast + klip-zár ([editorStore.ts](../../src/store/editorStore.ts)).
- **Idővonal-interakció** — trim/split/**duplikálás**/ripple/roll/slip/slide, snap (erősség + célpont-fajták),
  marker/régió/fejezet, több-kijelölés + stílus-fanout + link-csoport + pre-compose, borotva/rajz/maszk-mód.
- **Lejátszás** — rAF-mesteróra ([usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts)) + shuttle (J/K/L) +
  loop + range-in/out; a preview/audio rétegek a playheadhez szinkronizálnak.
- **Mentés/betöltés** — autosave (debounce + exponenciális backoff + „mentés bukott" banner), kilépéskori
  végső mentés, felhő-backup, hiányzó-média felismerés + auto/kézi relink, throttle-olt auto-verziók.

**A maradék (amit EZ a fájl zár):**
- A **mag maga (reducer + store) nincs közvetlenül tesztelve** — nincs `commands.test.ts`/`editorStore.test.ts`
  (csak a `projectUtils` segédek tesztekje van). Az egész platform legkritikusabb rétege nem bizonyított.
- **Hiányzó alap-művelet:** klip **sávok közötti** mozgatása (csak időben tol a saját sávján), klip-**vágólap**
  (cut/copy/paste egész klip — ma csak *stílus*-vágólap van), „**Mentés másként**"/projekt-duplikálás.
- **Megbízhatóság:** `applyCommand` némán `null`-oz (nincs ok a UI-nak), nincs **crash-recovery**, a
  mentés nem atomi (projekt + event külön Promise), a history/event-limit némán nyel.
- **Parity:** a lejátszó A/V-drift-korrekciója minimál, a playhead-húzás nem frame-pontos, a klip-határokon
  nincs gapless átmenet.

## 2. Feladatlista

> Státusz-tagek a [00-README](./00-README.md) §1 szerint: ✅ DONE · 🟡 PARTIAL · 🖼️ UI-MISSING · 🔌 BACKEND-MISSING · 🧪 MOCK · ⬜ NOT-IMPL.
> **Sorrend-ajánlás:** §2.1 (teszt) → §2.2 (guard) ELŐSZÖR — ezek zárolják a magot a további munka alá; utána a hiányzó műveletek (§2.3–2.5), parity (§2.6), megbízhatóság (§2.7–2.8), majd a lezáró teszt (§2.9) és a UX (§2.10).

### 2.1 Command-bus + store teszt-lefedettség — P0 (a mag zárolása) ✅ KÉSZ (2026-10-08)
- [x] ✅ **`src/lib/commands.test.ts`** — az `applyCommand` reducer MIND A 24 parancsa: happy-path + a `null`
  (no-op/érvénytelen) ág (`SET_FPS` azonos/≤0, `UPDATE_CLIP` ismeretlen id, `ADD_ASSET` duplikált id/uri,
  `REMOVE_CLIP` nem létező, `SPLIT_CLIP` klip-élen, `SET_TRACK_GAIN` clamp+no-op, stb.) + immutabilitás-
  ellenőrzés (a bemeneti `project`/sáv-klipek referenciája nem változik) + `describeCommand` címke-teszt (minden típus).
- [x] ✅ **`src/store/editorStore.test.ts`** — store-invariánsok: `dispatch` igaz/hamis + `dirty`/`events`/`past`
  frissülés + actor; `applyBatch` = **egy** undo-lépés (N parancs → 1 `past`, N event) + csupa-no-op → 0;
  `undo`/`redo` szimmetria + kijelölés-elévülés + üres-history no-op; `HISTORY_LIMIT`(50)/`EVENT_LIMIT`(300)
  nyírás (305-ös körrel); az `updateClip` **több-kijelölés stílus-fanoutja** (kötegelhető `color` → igen,
  nem-kötegelhető `start` → csak az elsődleges); `nudgeClipsBy` csoport-clamp (0 alá nem, pozitív szabad).
- [x] ✅ **Teszthorog**: a mag expo-mentes → a `jest` közvetlenül importálja; az `audit` (`npm run audit`) futtatja
  (69 teszt / 2 suite). A mag minden ágát regressziós teszt védi.

### 2.2 Command-eredmény + core-guardok — P0
Ma a `applyCommand` `null`-t ad vissza érvénytelen/no-op esetén, **ok nélkül** → a UI nem tudja, miért nem
történt semmi, és a védelem (zárolt sáv, üres sáv) csak a UI-ban van, nem a magban.
- [ ] ⬜ **Guard a mag szintjén**: a zárolt sávra / nem létező sávra írás a reducerben is no-op legyen
  (ma a `lockedTracks` session-állapot a store-ban van — a command-réteg nem ismeri; az AI/remote megkerülheti).
  Döntés: a zár-ellenőrzés a `dispatch`-ben (store) maradjon, de **minden** író-út (user+ai+remote) átmenjen rajta.
- [ ] ⬜ **Fejlesztői jelzés**: `applyCommand` `null` ágán dev-only `console.warn(describeCommand + ok)` (prodban
  néma) — a néma no-op ma nehezen debugolható. (Az API marad `Project | null`, nem törünk hívót.)
- [ ] ⬜ **Teszt**: zárolt-sáv-írás elutasítva; az AI-köteg (`actor:'ai'`) ugyanúgy validálva, mint a user-é.

### 2.3 Klip sávok közötti mozgatása (MOVE_CLIP) — P1 (hiányzó alap-művelet)
Ma a klip csak **időben** tolható a SAJÁT sávján (`nudgeClipsBy` megtartja a sáv-típust); egy NLE-ben a klip
**másik (kompatibilis) sávra** is húzható kell legyen.
- [ ] ⬜ **Command**: `MOVE_CLIP { clipId, toTrackType, start }` a [commands.ts](../../src/lib/commands.ts)-ben
  — kiveszi a klipet a jelenlegi sávról, beteszi a célsávra, frame-re illesztett `start`-tal (undo-zható).
- [ ] ⬜ **Kompatibilitás-guard** ([projectUtils.ts](../../src/lib/projectUtils.ts)): egy `canHostClip(trackType, clip.kind)`
  pure függvény (pl. `video|pip ↔ video/image`, `music|voiceover|sfx ↔ audio`, `text ↔ text`); inkompatibilis
  célon no-op. Teszt a §2.1 reducer-tesztbe.
- [ ] 🖼️ **Gesztus** ([TimelineClip.tsx](../../src/components/editor/TimelineClip.tsx)): függőleges húzás a
  szomszédos kompatibilis sávra (vizuális drop-highlight), elengedéskor `MOVE_CLIP`. A zárolt cél-sáv tiltott.

### 2.4 Klip-vágólap (cut/copy/paste egész klip) — P1
Ma csak **stílus**-vágólap van (`copyStyle`/`pasteStyle`); a **klip** maga nem másolható/vágható ki a
lejátszófejhez vagy másik projektbe. (A `duplicate` megvan — ugyanarra a sávra, offszettel.)
- [ ] ⬜ **Store**: `copyClips()` / `cutClips()` (a kijelölésből egy modul-szintű clipboardba, új id-kkal a
  beillesztéskor) + `pasteClipsAt(trackType, time)` → `ADD_CLIPS` a frame-illesztett playheadnél. A `cut`
  = copy + `rippleDelete`/`removeClip`. Projektek közt is működjön (a clipboard a store-on kívül, modul-szint).
- [ ] 🖼️ **UI** ([Toolbar.tsx](../../src/components/editor/Toolbar.tsx)): Másol/Kivág/Beilleszt gombok a
  duplikálás mellé; a Beilleszt a playheadnél, a kijelölt (vagy a klip saját) sávra.
- [ ] ⬜ **Teszt**: copy→paste új id-kkal, a forrás változatlan; cut = eltűnik + beilleszthető; frame-illesztés.

### 2.5 Sáv-modell: extra lane-ek döntése — P1
A `CANONICAL_TRACKS` **fix** készlet (type-onként EGY sáv) — nincs 2. videó-/hang-sáv, átnevezés, átrendezés.
Egy komoly NLE-ben a több-lane alap. **Döntés kell** (ADR, lásd [13](./13-documentation.md)):
- [ ] ⬜ **(A) Több-lane bevezetése**: a sáv-azonosítás `type`-ról `trackId`-ra (a `ADD_CLIP`/`MOVE_CLIP`/
  `REPLACE_TRACK*` `trackId`-t kapjon, a `type` meta marad a rétegezéshez) + sáv-add/remove/rename command.
  **Nagy, lánc-széles változás** → ha ide megyünk, külön epik-részlépés, a §2.3 MOVE-ra építve. **VAGY**
- [ ] ⬜ **(B) A fix modell FORMÁLIS kiírása**: ha a termék-döntés a fix kanonikus sávok mellett marad (egyszerűbb
  mobil-UX), akkor ezt ADR-ben rögzítjük, és a `pip`/`overlay` sávok adják a „több vizuális réteget". Ez zárja
  a tételt kód nélkül. **Alapértelmezett ajánlás: (B)** a launchig, (A) a desktop-shell ([09](./09-native-rendering.md)) után.

### 2.6 Lejátszás-parity: frame-pontos scrub + A/V-sync — P1
A `Preview == Export` elv a mag-interakciókra is: a lejátszófej és az A/V-szinkron frame-pontos legyen.
- [ ] ⬜ **Frame-pontos scrub**: a playhead húzása/koppintása a `snapToFrame`-re üljön (ma a `setPlayhead`
  folytonos) — fél-kocka csúszás már látszik; a `setPlayhead` opcionális `snap` flaggel vagy a hívó-oldali
  illesztéssel. (A split már frame-re ül — a scrub is kövesse.)
- [ ] ⬜ **A/V-drift teszt + egységes seek-pont**: az [AudioLayer](../../src/components/preview/AudioLayer.tsx)
  több `seekTo` hívása egy közös szinkron-pontból (a playheadből számolt cél) — a drift-korrekció küszöbe
  tesztelt (headless időzítés-teszt a sync-matekra, RN-render nélkül).
- [ ] ⬜ **Klip-határ gapless**: a vágott klipek határán az előnézet ne „kattanjon" (a következő klip előre-
  betöltése a playheadből). A render-oldali határ a [06](./06-video-editor.md) parity-jéhez igazítva.

### 2.7 Mentés-robusztusság — „soha ne vessz el munka" — P0
- [ ] ⬜ **Atomi mentés**: a projekt + event-napló ma külön `saveProject`/`saveEvents` (Promise.all — az egyik
  bukhat, a másik sikerülhet → inkonzisztens). Egy mentés-tranzakció (`storage.ts`), ami vagy MINDKETTŐT, vagy
  SEMMIT ír; bukásra a meglévő backoff.
- [ ] ⬜ **Crash-recovery snapshot**: minden autosave-nél (vagy N módosításonként) egy **külön recovery-kulcsra**
  írt pillanatkép; a szerkesztő indulásakor, ha a recovery frissebb a mentettnél → „Nem mentett munka
  visszaállítása?" ajánlat. Ma csak az AsyncStorage-főkulcs van (félbeszakadt írás → adatvesztés).
- [ ] ⬜ **„Mentés most" + „Mentés másként / duplikálás"**: explicit mentés-gomb (az autosave mellé) +
  `duplicateProject(id)` (új id, friss `createdAt`, név „… másolat") a [storage.ts](../../src/lib/storage.ts)-ben.
- [ ] ⬜ **Látható limitek**: a `HISTORY_LIMIT`(50)/`EVENT_LIMIT`(300) nyírás ma néma — a history-UI jelezze, hogy
  a legrégebbi lépések elévültek (ne tűnjön „elveszett" visszavonásnak); nagy projekt (AsyncStorage-méret) figyelmeztetés.

### 2.8 Betöltés/helyreállítás UX — P1
- [ ] ⬜ **Üres-projekt / első-indítás állapot**: ma a `missing` egy boolean; egy üres idővonalhoz vezetett
  „adj hozzá médiát a forrás-binből" onboarding-állapot ([SourceSheet](../../src/components/SourceSheet.tsx)-re
  mutatva) — a felhasználó sose ragadjon egy üres fekete vásznon.
- [ ] ⬜ **Granuláris média-helyreállítás**: a `recoverMissingMedia` ma köteg-szintű (mind-vagy-semmi) — per-
  fájl progress + részleges retry + a maradékra kézi relink (a `relinkMissing` mag megvan), hogy egy fájl
  bukása ne buktassa a többit.

### 2.9 Integrációs „arany-út" smoke-teszt — P1 (lezáró)
- [ ] ⬜ **`src/store/editorStore.integration.test.ts`** (headless, RN-render nélkül): a teljes mag-hurok egy
  tesztben — `loadProject` → `ADD_CLIP` → `splitClipAt` → `MOVE_CLIP` → trim (ripple) → `undo`×N → `redo`×N →
  (serialize→`saveProject` mock→`loadProject`) → az állapot bitre azonos. Ez a mag **regressziós pajzsa** minden
  további epikhez — ha egy jövőbeli változás eltöri az alap-hurkot, ez elbukik.

### 2.10 Core billentyű/gesztus-teljesség + help — P2
- [ ] ⬜ **Egységes alap-parancskészlet**: space (play/pause), J/K/L (shuttle), I/O (range), S (split a
  playheadnél), ⌫ (törlés), ⌘Z/⇧⌘Z (undo/redo), ⌘C/⌘X/⌘V (klip-vágólap §2.4), ←/→ (frame-léptetés). Ami már
  megvan (frame-léptetés, split, undo), azt csak egységesítjük; a hiányzókat bekötjük.
- [ ] 🖼️ **Help-overlay**: egy „?" a Toolbaron, ami a gesztus/billentyű-térképet mutatja (felfedezhetőség —
  ma a profi vágó-módok rejtettek a hosszú-nyomás mögött).

## 3. Kész, ha

1. A **command-bus + store minden ága tesztelt** (`commands.test.ts` + `editorStore.test.ts` + integrációs
   arany-út), és az `npm run audit` zöld.
2. Minden **alap-művelet megvan és undo-zható**: add/trim/split/duplikál/**sávok közti mozgatás**/**klip-
   vágólap**/törlés — user ÉS AI ugyanazon a validált buson.
3. A **lejátszás frame-pontos** (scrub a frame-rácson) és **A/V-szinkron** (tesztelt drift-küszöb), a
   klip-határokon nincs kattanás.
4. A **munka sosem vész el**: atomi mentés + crash-recovery ajánlat + „Mentés most/másként"; a limitek láthatók.
5. A §2.5 sáv-modell-döntés **ADR-ben rögzítve** (A vagy B), és a betöltés/helyreállítás (üres-állapot,
   granuláris recovery) felhasználó-barát.

> Ezzel az **„Editor core (alapfunkció)" a ~70–80%-ról 100%-ra** kerül: nem több feature, hanem a platform
> legfontosabb rétege **bizonyítottan helyes, teljes és megbízható** — a 06/07/03/05 epikek erre épülnek.
