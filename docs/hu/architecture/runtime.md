# Runtime — platform, New Architecture, szálmodell

> Forrás: [Arch.md](../../../Arch.md) 2. szakasz + [package.json](../../../package.json) +
> a kód. ↑ [docs/hu index](../README.md)
>
> **A platform alapelveihez a verziózott, hivatalos forrás a mérvadó:**
> <https://docs.expo.dev/versions/v57.0.0/> és
> <https://reactnative.dev/architecture/overview> — kód írása előtt ezeket kell
> olvasni ([AGENTS.md](../../../AGENTS.md)).

Ez a réteg a **legalsó** az [Arch.md rétegtérképén](../../../Arch.md): a
runtime, amin minden más ül. Nem funkció — hanem az a *fizika*, ami eldönti,
mi hol futhat (és ezért miért ott van a [mesteróra](./performance.md) és a
[command bus](./commands.md)).

## 1. A platform-stack (a valóság, verziószám szerint)

A [package.json](../../../package.json)-ból, nem emlékezetből:

| Réteg | Verzió | Megjegyzés |
|---|---|---|
| Expo SDK | `~57.0.23` | belépő: `expo-router/entry` ([package.json](../../../package.json) `main`) |
| React | `19.2.3` | + `react-dom` a web-célhoz |
| React Native | `0.86.3` | New Architecture az alap |
| TypeScript | `~6.0.3` | `tsc --noEmit` a merge-kapu része |
| Reanimated | `4.5.1` | **csak New Architecture-ön fut** |
| Worklets | `react-native-worklets 0.10.1` | a Reanimated 4 külön worklet-runtime-ja |
| Gesture Handler | `~2.32.0` | a UI-szálon futó gesztusok |
| Videó / hang | `expo-video ~57`, `expo-audio ~57`, `react-native-audio-api 0.13` | az előnézet lejátszói |
| Web | `react-native-web ~0.21` | a szerkesztő weben is fut (közelítésekkel) |

## 2. New Architecture — mit jelent *nekünk*

Az RN 0.86 + Expo SDK 57 alatt a **New Architecture** az alapértelmezett. Ami a
ReMix szempontjából számít belőle:

- **Fabric (új renderer).** A React-fa mount-ja a natív UI-szálon, szinkron
  méréssel — ez teszi lehetővé a folyamatos, akadásmentes idővonal-görgetést és a
  vászon-overlay-ek pontos illesztését.
- **JSI (JavaScript Interface).** A JS ↔ natív hívás **szinkron**, a régi
  aszinkron „bridge" nélkül. Ezért tud a natív render-modul
  ([modules/remix-render](../../../modules/remix-render/index.ts)) közvetlenül,
  hídszerializáció nélkül dolgozni.
- **Hermes motor.** Bytecode-ra fordított JS → gyorsabb indulás, kisebb memória —
  fontos egy sok-klipes projektnél, ahol az undo teljes projekt-pillanatképeket
  tart ([state.md](./state.md)).
- **Worklets.** A Reanimated 4 a `react-native-worklets` runtime-ján futtat
  kódot a **UI-szálon** — innen jön a 60 fps-es húzás/trim.

> **Miért lényeges ez a doksinak?** Mert a ReMix teljesítmény-döntései — a
> [mesteróra](./performance.md), a „gesztus élőben, állapot elengedéskor" elv, a
> [proxy](../decisions/ADR-008-nondestructive-proxy.md) — mind a szálmodellből
> következnek. New Arch nélkül a Reanimated 4 el sem indulna.

## 3. Szálmodell — ki min fut

```
  ┌──────────────── UI-SZÁL (natív) ─────────────────┐
  │  Fabric mount · Reanimated worklet-ek            │
  │  gesture-handler → 60 fps húzás / trim / pinch   │
  │  (shared value-k; NEM re-renderel a React-fa)    │
  └───────────────────────┬──────────────────────────┘
                          │  csak a gesztus VÉGÉN ír
                          ▼
  ┌──────────────── JS-SZÁL (Hermes) ────────────────┐
  │  zustand store · applyCommand reducer            │
  │  usePlaybackClock (rAF) · React render           │
  └───────────────────────┬──────────────────────────┘
                          │  JSI (szinkron)      hálózat (async)
              ┌───────────┴───────────┐         │
              ▼                       ▼         ▼
      NATÍV MODUL              expo-video /   FELHŐ-WORKER
      remix-render             expo-audio     (nehéz render/AI)
      (on-device MP4)          lejátszók
```

**A vezérelv:** a *nehéz, valós idejű* munka (gesztus, animáció) a UI-szálon fut,
és **csak a gesztus végén** ír a store-ba — egy undo-lépésként ([README.md](../../../README.md),
[state.md](./state.md)). A *nehéz, nem valós idejű* munka (HD render, AI, Whisper)
a [workerre](./rendering.md) kerül. A kettő közt a JS-szál koordinál.

## 4. Az Expo Go ↔ natív build határ

Fontos, gyakran félreértett határvonal:

- **A szerkesztő-MVP Expo Go-ban fut** — minden alap natív modul Expo
  Go-kompatibilis, dev build nem kötelező ([README.md](../../../README.md)).
- **Két dolog natív buildet igényel:**
  1. **On-device render** — a [remix-render](../../../modules/remix-render/index.ts)
     lokális Expo-modul; Expo Go-ban a `requireOptionalNativeModule('RemixRender')`
     `null`-t ad, natív buildben az igazi modult. A kód ezért **sosem dob** emiatt.
  2. **IAP / előfizetés** — `react-native-purchases` (RevenueCat) natív modul.
- **Web-cél** ([react-native-web](../../../package.json)): a szerkesztő böngészőben
  is fut, de bizonyos műveletek közelítenek (pl. a Tár/Zene weben streamel
  letöltés helyett — [README.md](../../../README.md)).

## 5. Kapcsolódások

- Szál-budget és a mesteróra részletei → [performance.md](./performance.md)
- Miért egy óra hajt mindent → [ADR-002](../decisions/ADR-002-master-clock.md)
- A natív vs. felhő render → [rendering.md](./rendering.md),
  [ADR-007](../decisions/ADR-007-hybrid-render.md)
