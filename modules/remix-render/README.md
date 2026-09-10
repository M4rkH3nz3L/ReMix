# remix-render (lokális Expo-modul)

**Eszközön futó videó-render** — a Remix ingyenes export-útja. A timeline-t MP4-be
kompozitálja a telefonon, **szerver nélkül**. Ez oldja fel a „#1 termék-blokkolót"
(a render eddig csak a fejlesztői gép workerén ment).

## Üzleti modell

| Út | Hol | Ár |
|----|-----|----|
| **Eszközön-render** (ez a modul) | a felhasználó telefonján | **ingyen** |
| **Felhő-HD render + AI** | a mi fizetős workereinken | **Pro** |

A döntést a `src/lib/render.ts` orchesztrátor + a `src/lib/backend.ts` router hozza;
a Pro-kaput a `src/store/entitlementStore.ts` + `PaywallSheet` intézi.

## Hogyan aktiválódik

A JS-oldal (`src/lib/nativeRender.ts`) `requireOptionalNativeModule('RemixRender')`-rel
oldja fel a modult **futásidőben**:

- **Expo Go / web** → `null` → az app a felhő-renderre esik vissza (Pro), vagy
  beszédes üzenetet mutat. Semmi sem törik.
- **Natív / EAS build** → az igazi modul él → az export a telefonon készül, ingyen.

Natív build a teszteléshez:

```bash
npx expo prebuild        # legenerálja az ios/ + android/ projektet
npx expo run:ios         # vagy: npx expo run:android
```

(Expo Go-ban NEM tesztelhető — a natív modul csak saját buildben töltődik be.)

## Állapot

- **iOS (AVFoundation)** — v1 kész: videó-szegmensek vágással + sebességgel egy fix
  vászonra (aspect-fill), a szegmensek saját hangja + külön hang-szegmensek keverve,
  H.264 MP4 export, progressz-jelzés. A fejlett effektek (fejlett átmenetek, 3D,
  AI-szűrők beégetése) egyelőre a felhő-render sajátjai.
- **Android (MediaCodec)** — v1: az egyszerű egy-videós vágást kezeli; összetett
  projektnél a felhő-renderre irányít. A teljes MediaCodec+MediaMuxer kompozitálás
  követő lépés.

## Terv-formátum (JS → natív)

A `buildRenderPlan` (`src/lib/nativeRender.ts`) állítja elő:

```jsonc
{
  "width": 1080, "height": 1920, "fps": 30, "background": "#000000",
  "video": [{ "uri", "atSec", "inSec", "durationSec", "speed", "volume", "filter" }],
  "audio": [{ "uri", "atSec", "inSec", "durationSec", "volume" }]
}
```
