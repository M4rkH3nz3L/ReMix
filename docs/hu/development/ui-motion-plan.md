# ReMix — „Motion-first" fejlesztési terv (pro iOS-editor szint)

> Cél: a ReMix ne „szép React Native app" legyen, hanem egy **fluid, iOS-native
> érzésű creative instrument** — ahol a videó az elsődleges, a UI rétegekben jön
> elő, és a mozgás/gesztus/haptika/timeline **egyetlen rendszerként** működik.
>
> **Ez a terv ŐSZINTE:** a ReMix magja már erős — nem építjük újra. Csak a valós
> réseket célozzuk a „pro" szintig, és kimondjuk azt is, mit NEM csinálunk.
> ↑ [docs/hu index](../README.md) · a mozgás mögötti architektúra:
> [performance.md](../architecture/performance.md) · [commands.md](../architecture/commands.md)

---

## Implementációs állapot (2026-09)

A terv **kód-oldali** részei implementálva, végig zöld audittal (tsc + lint +
jest 279). Amit külön kiemelünk: több tétel **már megvolt** — ezeket felülvizsgáltuk,
nem építettük újra.

| Tétel | Állapot |
|---|---|
| 0.2–0.3 design-token réteg (`src/design/`) + központi haptika | ✅ implementálva |
| 1.1 motion a kulcs-átmenetekben · 1.2 `BottomSheet` primitív · 1.4 micro-interakciók (drag-lift, `PressableScale`) | ✅ implementálva |
| 2.1 timeline klip-virtualizáció (`src/lib/virtualize.ts`) · 2.2 pinch churn-csökkentés | ✅ implementálva |
| 3.1 AI before/after preview · 3.2 kontextuális toolbar-morf · 3.4 kétrétegű hiba (`src/lib/errors.ts`) | ✅ implementálva |
| 3.3 loading UX · 2.3 playhead · 1.3 kontextuális toolbar-logika | ✅ már megvolt (felülvizsgálva) |
| 4.1 iPad split (`expanded`) · 4.2 landscape (`medium+landscape`) | ✅ már megvolt + landscape safe-area fix |
| 4.3 vizuális finomítás (radius-token + 44pt touch-target) | ✅ első kör kész |
| **Eszköz-teszt-igényes finomhangolás** (layout-arányok, teljes shared-value pinch, idle-toolbar declutter) | ⏳ dev-build QA (0.1) után |

---

## 0. Ami MÁR MEGVAN (ne építsük újra)

A beillesztett „UI Constitution" nagy része **már teljesül** a kódban:

| Elv | Hol él ma |
|---|---|
| Command bus + undo/redo (AI is ezt használja) | [commands.ts](../../../src/lib/commands.ts), [editorStore.ts](../../../src/store/editorStore.ts) — [ADR-001](../decisions/ADR-001-command-bus.md) |
| Egy mesteróra (playhead 1:1 az ujjal) | [usePlaybackClock.ts](../../../src/hooks/usePlaybackClock.ts) — [ADR-002](../decisions/ADR-002-master-clock.md) |
| Gesztus a UI-szálon, state csak elengedéskor | Reanimated 4 + gesture-handler ([runtime.md](../architecture/runtime.md)) |
| Autosave mindent | [storage.ts](../../../src/lib/storage.ts) + editor autosave-effekt |
| Kontextuális eszközök (nem 30-gombos toolbar) | [PanelHost](../../../src/components/editor/PanelHost.tsx) + 20+ panel |
| Thumbnail/waveform cache | [thumbnails.ts](../../../src/lib/thumbnails.ts), [waveform.ts](../../../src/lib/waveform.ts), [lruCache](../../../src/lib/lruCache.ts), [proxy](../../../src/lib/proxy.ts) |
| AI = validált command + „action preview" | [aiCommands.ts](../../../src/lib/aiCommands.ts) (`describeAiCommand`) |
| „Quiet UI" (immerzív) | a feed már immerzív (chrome elrejthető) |

→ Az alábbi fázisok **erre a fundamentumra** épülnek.

## A valós RÉSEK (leletekkel)

1. **Nincs központi motion/design token** — az animációk ad-hoc Reanimated-hívások, nincs `motion.ts`/`spacing`/`radius`/`typography` réteg.
2. **Nincs egységes BottomSheet primitív** (snap points + morph) — a panelek fix magasságú `PanelHost`-tal jönnek, „sheet→sheet" csere, nem tartalom-morph.
3. **A timeline nem virtualizál klip-szinten** — viewport-tudatos, de sávonként MINDEN klipet renderel (hosszú projekten akadhat).
4. **Haptics ad-hoc** — ~10+ komponens hívja közvetlenül az `expo-haptics`-ot, nincs központi „haptic token".
5. **Nincs dev-build workflow** — a natív render + IAP miatt valós eszközön csak dev buildben tesztelhető (ma Expo Go-központú).

---

## Fázis 0 — Fundamentum + tesztelhetőség (ENABLING)

> Enélkül a többi fázis nem mérhető/nem tesztelhető eszközön. Ez a „hibákat
> javítjuk, teszteljük az appot" bázisa.

**0.1 Development build + on-device QA.** EAS dev build (a `remix-render` natív modul
+ IAP miatt) → a session összes új funkciója (feed-komment, RBAC-admin, GDPR,
report) **valós eszközön** végigpróbálva. Ez a felhasználó „teszteljük az appot"
kérésének a tényleges beváltása.
- *Elfogadás:* iPhone dev buildben a fő flow-k (import → vágás → export; közzététel;
  komment; admin; fiók-export/deaktiválás) manuálisan zöldek; a `npm run audit` a
  merge-kapu (tsc + lint + jest 260/260).

**0.2 Design-token réteg** (`src/design/`): `motion.ts` (durations + spring-presetek),
`spacing.ts`, `radius.ts`, `typography.ts` (SF Pro súlyok), és a `palette` ide-húzása.
- *Miért:* egy helyen finomhangolható az egész app „érzése"; a többi fázis ezekre épít.
- *Elfogadás:* legalább a szerkesztő-toolbar + PanelHost + egy modal a tokeneket használja.

**0.3 Központi haptika** (`src/design/haptics.ts`): `haptics.snap()/edge()/delete()/success()`
— az ad-hoc hívások cseréje. Csak **fontos állapotváltozáskor**, sosem folyamatosan.

---

## Fázis 1 — Motion & interakció rendszer

**1.1 `motion.ts` bevezetése** a kulcs-átmenetekre: bottom sheet, tabváltás,
panel-megjelenés, toast, play/pause, trim-handle. Szabály: **fast-in, soft-out**
(gomb 100–150 ms · panel 200–300 ms · nagy átmenet 300–450 ms; spring nem túl bounce-os).

**1.2 Egységes `BottomSheet` primitív** (snap points: 12% / 45% / 90%, drag handle,
spring, backdrop-opacity, swipe-to-dismiss). A `PanelHost` erre épüljön át.
- *„Sheet→sheet" helyett tartalom-MORPH:* pl. Audio → (Music | Voice | SFX | Record)
  UGYANAZON a felületen, nem új modal.

**1.3 Kontextuális toolbar konzisztencia:** a kiválasztott objektum típusa szabja meg
az eszközöket (Video: Trim|Split|Speed|Adjust · Text: Font|Color|Animation|Position ·
Audio: Volume|Fade|Noise|Voice). A panel-logika nagyrészt megvan — a *toolbar-morfológia*
kell egységesre.

**1.4 Micro-interakciók** (a prémium-érzés forrása): klip split (vonal → két klip),
delete (shrink → collapse → rés bezárul), add (slide+scale → snap), drag „lift"
(scale 1→1.03 + árnyék) + előre megjelenő drop-zone. Mind a UI-szálon (Reanimated).

- *Elfogadás:* a fenti interakciók 60 fps-en futnak (nincs per-frame React-render);
  a `react-hooks/immutability` kivétel indokoltsága megmarad.

---

## Fázis 2 — Timeline „pro" szint

**2.1 Klip-virtualizáció:** csak a viewportban (± előtöltés) látható klipeket
rendereljük, memoizált klip-komponensekkel. A jelenlegi `viewportW`-tudat kész
alap; erre jön a windowing.
- *Elfogadás:* 200+ klipes projekt görgetése/zoomja is 60 fps.

**2.2 Fluid pinch-zoom shared value-vel:** a skála `SharedValue`, a timeline
`transform`-mal reagál — **nem** újrarendereléssel. (10s → 0.5s / képernyő.)

**2.3 Playhead-precizitás:** vékony, kontrasztos, mindig látható, nem ugráló (a
mesteróra már adja az alapot; a *vizuális* stabilitás a cél).

---

## Fázis 3 — AI-UX + progressive disclosure + „quiet editor"

**3.1 AI before/after preview** (a `describeAiCommand` fölé): a user az alkalmazás
ELŐTT lásson egy **változás-listát** („+ 2,4s levágva · + beat-vágások · sebesség 1,1×")
és/vagy before/after-t → [Preview] [Apply]. Az AI sose módosítson vakon.

**3.2 Progressive disclosure a SZERKESZTŐBEN** (a feed már immerzív): idle = videó +
timeline + 4 fő eszköz; kiválasztás → a klip kontextuális eszközei; AI → „mit
változtassak?". Ne mutass mindent egyszerre.

**3.3 Loading/haladás UX:** meghatározható vs. nem-meghatározható művelet
megkülönböztetése (Apple HIG), **content-first** (a user már dolgozhat, míg a
thumbnailek/AI a háttérben töltenek), nem „Loading…".

**3.4 Kétrétegű hibakezelés:** user-facing („Nem sikerült exportálni. A projekted
biztonságban van. [Újra]") ↔ dev-log (FFmpeg exit code…). Részben megvan
(beszédes hibák) — rendszerezni kell.

---

## Fázis 4 — Platform (iPad/landscape) + finomítás

**4.1 iPad split-layout** (nem nagyított iPhone): bal eszköz-rail + jobb videó +
alul timeline. A [useLayout](../../../src/hooks/useLayout.ts) méret-osztályai adják az alapot.

**4.2 Landscape editing** (desktop-közeli): videó fent, timeline középen, eszközök alul.

**4.3 Vizuális finomítás:** dark-token paletta (#08090C…), **funkcionális** színek
(cyan=selection · magenta=AI/remix · purple=effect · sárga=warning · zöld=success),
**glass = ACCENT** (a toolbar-on, nem mindenhol), 44×44 pt touch-targetek, konzisztens
SF-Symbols-szerű ikonok (kevesebb emoji a funkcionális helyeken).

---

## Nem-célok (amit SZÁNDÉKOSAN nem csinálunk)

- ❌ Animáció az animációért — minden mozgás **állapotot vagy térbeli kapcsolatot**
  közöl, különben nincs rá szükség.
- ❌ Glassmorphism mindenhol — a videó marad vizuálisan domináns.
- ❌ Neon-cirkusz a kiválasztásnál — a brand lehet látványos, az **editor visszafogott**.
- ❌ A magok újraírása (command bus / clock / gesztus-modell) — ezek jók, csak
  ráépítünk.
- ❌ Modal mindenre — sheet/popover/inline inspector helyette; modal csak ami tényleg
  megszakítja a workflow-t.

## Prioritási sorrend (ajánlott)

**Fázis 0 → 1 → 2** a „pro-érzés" gerince (tokenek + sheet/haptika + timeline). A
**Fázis 3** (AI-preview, quiet editor) a megkülönböztető érték. A **Fázis 4** (iPad/
landscape) a piac-bővítés. A stabilitás/QA (0.1) **végig** kíséri: minden fázis
mergéhez `npm run audit` zöld + dev-build smoke-test.

## Kapcsolódó

- Miért 60 fps a bázis, mi fut melyik szálon → [performance.md](../architecture/performance.md)
- A command bus (amire az AI és a micro-interakciók is ülnek) → [commands.md](../architecture/commands.md)
- New Architecture / Reanimated 4 / dev-build → [runtime.md](../architecture/runtime.md), [release.md](./release.md)
