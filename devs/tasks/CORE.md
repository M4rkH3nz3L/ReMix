# 🧱 CORE — Editor-mag (alapfunkció) → 100%

> **Forrás:** [audit](../source/audit-2026-10-main.md) §19 (`Editor core (alapfunkció) ~70–80%`) + §0 (a lánc: `PURE CORE → TEST → UI → parity → cloud`).
> **Testvérek:** [06-video-editor](./06-video-editor.md) (profi NLE — keyframe/color/mask/effect), [11-performance](./11-performance.md) (timeline-perf), [12-code-quality](./12-code-quality.md) (uri→assetId + command-refaktor), [03-collaboration](./03-collaboration.md) (clip-lock).
> **Érintett kód:** [src/lib/commands.ts](../../src/lib/commands.ts) · [src/store/editorStore.ts](../../src/store/editorStore.ts) · [src/lib/projectUtils.ts](../../src/lib/projectUtils.ts) · [src/lib/storage.ts](../../src/lib/storage.ts) · [src/hooks/usePlaybackClock.ts](../../src/hooks/usePlaybackClock.ts) · [src/components/preview/](../../src/components/preview/) · [src/components/editor/](../../src/components/editor/) · [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx).

---

> **📊 Haladás (2026-10-08):** ✅ 5 teljes · 🟡 3 mag kész · ⬜ 2 nyitva — Σ 10 tétel.
> **§2.1 + §2.2 KÉSZ:** a command-bus magja (reducer + store) most **bizonyítottan tesztelt**
> (`commands.test.ts` + `editorStore.test.ts`), és a **zárolt sáv a magban is védett**
> (user+ai no-op; remote kivétel) + dev-warn a néma no-opnál. **§2.3 mag kész:** a `MOVE_CLIP`
> parancs + `canHostClip` guard + `store.moveClip` (frame-snap) tesztelve — hátra a húzás-gesztus (🖼️).
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

### 2.2 Command-eredmény + core-guardok — P0 ✅ KÉSZ (2026-10-08)
- [x] ✅ **Guard a mag szintjén**: a zárolt sávot érintő parancs a `dispatch`/`applyBatch`-ben no-op —
  minden lokális író-út (user+ai) ezen megy át, így az AI/programozott hívó sem kerülheti meg a sáv-védelmet.
  A `touchedTrackTypes()` pure segéd adja a parancs érintett sávjait; a `'remote'` collab-visszajátszás
  **kivétel** (a társ edítje authoritatív, a lokális zár nem blokkolhatja → nincs állapot-széthúzás).
- [x] ✅ **Fejlesztői jelzés**: a `dispatch` `null`-ágán dev-only `console.warn(describeCommand)` (prodban
  `__DEV__`-guard mögött néma). Az API maradt `Project | null` / `boolean` — nem tört hívót.
- [x] ✅ **Teszt**: zárolt-sáv ADD_CLIP/UPDATE_CLIP elutasítva (user); az AI-köteg zárolt parancsa kimarad,
  a többi fut; a `'remote'` NEM blokkolt; a dev-warn spy-val igazolt (editorStore.test.ts, §2.2 blokk).

### 2.3 Klip sávok közötti mozgatása (MOVE_CLIP) — P1 (hiányzó alap-művelet)
Ma a klip csak **időben** tolható a SAJÁT sávján (`nudgeClipsBy` megtartja a sáv-típust); egy NLE-ben a klip
**másik (kompatibilis) sávra** is húzható kell legyen.
- [x] ✅ **Command**: `MOVE_CLIP { clipId, toTrackType, start }` a [commands.ts](../../src/lib/commands.ts)-ben
  — kiveszi a klipet a forrás-sávról, beteszi a cél-sávra (undo-zható). No-op, ha ismeretlen klip, inkompatibilis
  cél, vagy ugyanott maradna. A `store.moveClip` frame-re illeszti a `start`-ot (mint a `splitClipAt`), és a
  core-guard automatikusan tiltja a zárolt forrás/cél sávot (a `touchedTrackTypes` MOVE_CLIP-ága).
- [x] ✅ **Kompatibilitás-guard** ([projectUtils.ts](../../src/lib/projectUtils.ts)): `canHostClip(trackType, kind)`
  pure függvény (`video|pip ↔ video/image`, `music|voiceover|sfx ↔ audio`, `text|captions ↔ text`,
  `overlay ↔ shape/image`, `adjust/interactive ↔ saját`); inkompatibilis célon no-op. Tesztelve (§2.1 + canHostClip-blokk).
- [ ] 🖼️ **Gesztus** ([TimelineClip.tsx](../../src/components/editor/TimelineClip.tsx)): függőleges húzás a
  szomszédos kompatibilis sávra (vizuális drop-highlight), elengedéskor `store.moveClip`. A zárolt cél-sáv tiltott. **(HÁTRA — UI)**

### 2.4 Klip-vágólap (cut/copy/paste egész klip) — P1
Ma csak **stílus**-vágólap van (`copyStyle`/`pasteStyle`); a **klip** maga nem másolható/vágható ki a
lejátszófejhez vagy másik projektbe. (A `duplicate` megvan — ugyanarra a sávra, offszettel.)
- [x] ✅ **Store**: `copyClips()` / `cutClips()` + `pasteClipsAt(trackType, time)` → `ADD_CLIPS` a
  frame-illesztett playheadnél (új id-k, a horgony a playheadre, a relatív rend marad). A `cut` = copy +
  a kijelöltek eltávolítása EGY undo-lépésben. A `clipClipboard` a store-state-ben (mint a `styleClipboard`),
  SZÁNDÉKOSAN a SESSION_RESET-en kívül → **projektek közt is** beilleszthető. `canPasteTo(trackType)` a UI-hoz.
- [x] 🖼️ **UI** ([Toolbar.tsx](../../src/components/editor/Toolbar.tsx)): Másol/Kivág/Beilleszt gombok a
  duplikálás mellé; a Beilleszt a playheadnél, a kijelölt klip sávjára (vagy a vágólap fajtájához illő alapra).
- [x] ✅ **Teszt**: copy→paste új id-kkal + a forrás változatlan + frame-illesztés; cut = eltűnik + beilleszthető
  (a relatív rend marad); inkompatibilis sáv → 0; a vágólap túléli a projekt-váltást (editorStore.test.ts §2.4).

### 2.5 Sáv-modell: extra lane-ek döntése — P1 ✅ KÉSZ (2026-10-08) — döntés: (B)
A `CANONICAL_TRACKS` **fix** készlet (type-onként EGY sáv). A döntés rögzítve:
**[ADR-011 — Fix kanonikus sávmodell](../../DOCS/HU/decisions/ADR-011-fixed-canonical-tracks.md)**.
- [x] ✅ **(B) A fix modell FORMÁLIS kiírása** — ADR-011: a fix kanonikus sávok maradnak (mobil-UX +
  lánc-stabilitás); a „több vizuális réteget" a `pip`/`overlay`/`adjust` adja, a sávok közti mozgatást a
  §2.3 `MOVE_CLIP` + `canHostClip`. A sáv-azonosítás a parancsokban `trackType` marad (nem `trackId`).
- [ ] ⬜ ~~**(A) Több-lane most**~~ — ELVETVE (ADR-011): nagy, lánc-széles `type→trackId` refaktor, amit a
  mobil-UX nem indokol; ha később előjön a termék-igény (desktop-shell, [09](./09-native-rendering.md) után),
  külön epik-ként, a `MOVE_CLIP`-re építve, új ADR-rel.

### 2.6 Lejátszás-parity: frame-pontos scrub + A/V-sync — P1
A `Preview == Export` elv a mag-interakciókra is: a lejátszófej és az A/V-szinkron frame-pontos legyen.
- [x] ✅ **Frame-pontos scrub**: a `setPlayhead(t, snap?)` opcionális `snap`-pel a projekt frame-rácsára ül;
  a lejátszó-óra snap NÉLKÜL hívja (folytonos), az idővonal-scrub ([Timeline](../../src/components/editor/Timeline.tsx))
  `snap:true`-val. (A split már frame-re ült — a scrub most követi.) Tesztelve (editorStore.test.ts §2.6).
- [x] ✅ **A/V-drift teszt + egységes seek-pont**: [avSync.ts](../../src/lib/avSync.ts) pure mag
  (`sourceTimeOf` közös seek-pont + `shouldResync` küszöb) — headless teszttel (avSync.test.ts); az
  [AudioLayer](../../src/components/preview/AudioLayer.tsx) mindhárom seek-ága EBBŐL számol, és lejátszás
  közben a `shouldResync(…, player.currentTime)` > ¼ mp drift behúzza a szinkront. (⚠️ a lejátszás-közbeni
  drift-korrekció valós eszközön finomhangolandó — a küszöb konzervatív.)
- [ ] ⬜ **Klip-határ gapless**: a vágott klipek határán az előnézet ne „kattanjon" (a következő klip előre-
  betöltése a playheadből). **(HÁTRA — preview-preload, eszköz-verifikált.)**

### 2.7 Mentés-robusztusság — „soha ne vessz el munka" — P0 🟡 mag KÉSZ (2026-10-08)
- [x] ✅ **Atomi mentés**: `saveProjectAndEvents(project, events)` ([storage.ts](../../src/lib/storage.ts)) —
  projekt + index + event-napló EGY `multiSet`-ben (vagy mind, vagy semmi). Az autosave + a kilépő-mentés
  ([editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx)) ezt hívja a korábbi `Promise.all([saveProject, saveEvents])`
  helyett. Tesztelve (storage.test.ts: a multiSet bukásakor SEMMI nem íródik).
- [x] ✅ **Crash-recovery snapshot**: `writeRecovery`/`readRecovery`/`clearRecovery` külön kulcson; az autosave a
  FŐ mentés ELŐTT ír recovery-t, sikerkor törli, bukáskor marad. A szerkesztő indulásakor `recoveryIsFresher`
  (pure, tesztelt) → ha a recovery frissebb a mentettnél, **„Nem mentett munka visszaállítása?"** Alert
  (`editor.recovery.*`, hu/en/de) → `restoreProject`. Tesztelve (round-trip + freshness).
- [x] 🟡 **„Mentés másként / duplikálás"**: `duplicateProject(id, copyLabel)` ([storage.ts](../../src/lib/storage.ts))
  KÉSZ + tesztelt (új id, friss dátumok, „… másolat", a forrás érintetlen). **Hátra:** a UI-belépő (projekt-
  menü) + az explicit „Mentés most" gomb (az atomi mentést azonnal hívná). **(🖼️ UI)**
- [x] 🟡 **Látható limitek**: `estimateProjectBytes` + `isProjectTooLarge` (`PROJECT_SIZE_WARN_BYTES` ~2 MB)
  pure + tesztelt. **Hátra:** a history-UI „legrégebbi lépés elévült" jelzése + a méret-figyelmeztető banner. **(🖼️ UI)**

### 2.8 Betöltés/helyreállítás UX — P1
- [ ] ⬜ **Üres-projekt / első-indítás állapot**: ma a `missing` egy boolean; egy üres idővonalhoz vezetett
  „adj hozzá médiát a forrás-binből" onboarding-állapot ([SourceSheet](../../src/components/SourceSheet.tsx)-re
  mutatva) — a felhasználó sose ragadjon egy üres fekete vásznon.
- [ ] ⬜ **Granuláris média-helyreállítás**: a `recoverMissingMedia` ma köteg-szintű (mind-vagy-semmi) — per-
  fájl progress + részleges retry + a maradékra kézi relink (a `relinkMissing` mag megvan), hogy egy fájl
  bukása ne buktassa a többit.

### 2.9 Integrációs „arany-út" smoke-teszt — P1 (lezáró) ✅ KÉSZ (2026-10-08)
- [x] ✅ **`src/store/editorStore.integration.test.ts`** (headless, RN-render nélkül): a teljes mag-hurok egy
  tesztben — `loadProject` → `addClip` → `splitClipAt` → `MOVE_CLIP` → **ripple-trim** (`rippleResize`) →
  `undo`×4 → `redo`×4 (az „arany" állapot **bitre azonos**) → (`saveProjectAndEvents` → `loadProject`) → a
  TARTALOM bitre azonos + az eseménynapló (4 esemény) túléli. Ez a mag **regressziós pajzsa** — ha egy jövőbeli
  változás eltöri az alap-hurkot (reducer / store-invariáns / undo-redo / atomi mentés), ez elbukik.

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
