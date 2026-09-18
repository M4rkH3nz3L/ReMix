# Performance — szál-budget, mesteróra, proxy

> Forrás: [Arch.md](../../../Arch.md) 5–6. szakasz +
> [usePlaybackClock.ts](../../../src/hooks/usePlaybackClock.ts) ·
> [proxy.ts](../../../src/lib/proxy.ts) · a kód. ↑ [docs/hu index](../README.md)

A teljesítmény a ReMixben nem „optimalizálás", hanem **architektúra**: a
[runtime](./runtime.md) szálmodellje eleve eldönti, mi hol futhat. Ez a doksi a
*budget* — a szabály, hogy melyik szál mit *nem* csinálhat.

## 1. Szál-budget

| Szál | Mi fut rajta | Mi TILOS rajta |
|---|---|---|
| **UI (natív)** | Fabric mount · Reanimated worklet · gesztus (húzás/trim/pinch, 60 fps) | store-írás per-frame; nehéz számítás |
| **JS (Hermes)** | zustand store · `applyCommand` · rAF-óra · React render | blokkoló I/O; nehéz kép/videó-feldolgozás |
| **Worker (felhő)** | HD render, Whisper, AI, vision, depth | — (ez a „nehéz" célja) |

**A két aranyszabály:**

1. **Gesztus élőben, állapot elengedéskor.** A húzás/trim Reanimated shared
   value-n fut a UI-szálon (nincs React re-render); a store-ba **csak a gesztus
   végén** ír — egy `dispatch`, egy undo-lépés ([commands.md](./commands.md),
   [README.md](../../../README.md)).
2. **A nehéz munka a workerre megy.** Amit a telefon nem tud valós időben, azt a
   [render](./rendering.md) csinálja — az előnézet csak közelít.

## 2. A mesteróra

Egyetlen `requestAnimationFrame`-óra hajtja a lejátszást
([usePlaybackClock.ts](../../../src/hooks/usePlaybackClock.ts),
[ADR-002](../decisions/ADR-002-master-clock.md)): a `playhead` a mester, a
videó/hang réteg ehhez szinkronizál (drift-korrekció). Minden időzített funkció
**a playheadből** számoljon, ne saját órából.

- **Fókusz-kapu:** a hookot a szerkesztő ÉS a lejátszó képernyő is hívja, és a
  navigáció `push`-sal megy (az előző képernyő mountolva marad). Kapu nélkül **két**
  rAF-ciklus futna, és a playhead **dupla sebességgel** haladna → `useIsFocused()`
  csak a fókuszált képernyőt tickeli.
- **Egy óra, sok mód:** shuttle (J/K/L, `playbackRate`), hurok-tartomány (I/O),
  Auto-Edit változat-előnézet — mind ugyanezen az órán.

## 3. Proxy — a szerkesztés gyorsítása

[proxy.ts](../../../src/lib/proxy.ts): a nagy felbontású videóból 720p munka-
példány készül; az **előnézet és a filmstrip** ezt használja, a **render mindig
az eredetivel** fut ([ADR-008](../decisions/ADR-008-nondestructive-proxy.md)). A
proxy eszköz-lokális, determinisztikus kulcsú lemez-cache — nem kerül a
projektbe. Előmelegítés projekt-nyitáskor és videó-hozzáadáskor; worker nélkül az
eredetivel megy tovább minden.

## 4. Cache-ek és a napló-terhelés

- **LRU:** [lruCache.ts](../../../src/lib/lruCache.ts) (tesztelt) — filmstrip/
  waveform mem-cache; a waveform/filmstrip lemezre is cache-elődik (fájlnév+méret
  kulcs) → egy fájl csak egyszer megy fel.
- **Slim napló:** a teljes klip-tömbök újraírása autosave-nként MB-okat jelentett;
  az esemény-napló a nehéz mezőket csonkolja
  ([eventLog.ts](../../../src/lib/eventLog.ts) `slimForLog`/`isHeavyCommand`).
- **Autosave-debounce:** ~0,8 mp ([state.md](./state.md)) — nem minden
  billentyűleütésre írunk lemezre.

## 5. Memória — az undo ára

Az undo teljes projekt-pillanatképeket tart (`past`/`future`, 50 lépés). Egy
sok-klipes projektnél ez memória-érzékeny → a **Hermes** ([runtime.md](./runtime.md))
kisebb heap-je és a slim-napló együtt tartja kordában. A `RenderedVersion`
műtermék NEM undo-adat ([state.md](./state.md)).

## 6. Kapcsolódások

- A szálmodell forrása → [runtime.md](./runtime.md)
- A mesteróra döntése → [ADR-002](../decisions/ADR-002-master-clock.md)
- A proxy → [ADR-008](../decisions/ADR-008-nondestructive-proxy.md)
- A render-határ → [rendering.md](./rendering.md)
