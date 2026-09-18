# Rendering — a preview↔render paritás

> Forrás: [Arch.md](../../../Arch.md) 6. szakasz +
> [render.ts](../../../src/lib/render.ts) · [nativeRender.ts](../../../src/lib/nativeRender.ts) ·
> [server/render.js](../../../server/render.js) + a kód. ↑ [docs/hu index](../README.md)

## 1. A definitív elv

> **Az előnézet közelít (RN, valós idő), a render a mérvadó (worker/natív,
> pixel-pontos).** ([ADR-003](../decisions/ADR-003-preview-render-parity.md))

Ez az elv végigvonul a [types/project.ts](../../../src/types/project.ts) egész
modelljén: majdnem minden „nehéz" effekt-mező kommentje kimondja, hogy a hatás a
*renderben* érvényesül, az előnézet csak *közelít*. Miért? A telefon nem tud valós
időben 3D-LUT-ot, per-frame optical flow-t vagy Chromium-tipográfiát számolni
60 fps-en — a render-motor igen.

**Következmény új effektnél:** először a modell-mező + a render-paritás, aztán az
előnézeti közelítés — **sosem fordítva**.

## 2. Három render-út

```
                         RENDER
        ┌───────────────────┴───────────────────┐
   ELŐNÉZET (valós idő)                    VÉGLEGES (MP4)
   components/preview/*                ┌────────┴────────┐
   RN + mesteróra                 ON-DEVICE           FELHŐ (Pro)
   (közelít)                      remix-render        FFmpeg + Chromium
                                  (ingyen, alap)      (teljes, HD/4K)
```

| Út | Hol | Kinek | Mit tud |
|---|---|---|---|
| **Előnézet** | [components/preview/](../../../src/components/preview/) | mindenki | valós idejű közelítés, a [mesteróra](./performance.md) hajtja |
| **On-device** | [nativeRender.ts](../../../src/lib/nativeRender.ts) → [remix-render](../../../modules/remix-render/index.ts) | **Free** | alap: vágás/összefűzés/sebesség + hang-mix + kimeneti méret |
| **Felhő** | [render.ts](../../../src/lib/render.ts) → [server/render.js](../../../server/render.js) | **Pro** | teljes effekt-készlet, HD/4K, gyorsabb |

## 3. Az előnézeti út

A [components/preview/](../../../src/components/preview/) rétegei RN-eszközökkel
közelítenek, és mind a [mesteróra](./performance.md) `playhead`-jéből számolnak:

- `PreviewSurface` — a videó/kép kompozit + szűrő-overlay
- `TextOverlay` · `ShapeOverlay` · `HotspotOverlay` · `MaskOverlay` ·
  `TransitionLayer` · `PipLayer` · `SafeZoneOverlay`
- `AudioLayer` — a hang a `playhead`-hez szinkronizál (drift-korrekció)

Közelítés-eszközök: RN `transform`, `mixBlendMode`, overlay-tint a szűrőkre,
RN-transzform a 3D-döntésre. Amit itt **nem** látsz pontosan (LUT, per-frame flow,
Chromium-tipográfia), az a renderben lesz pontos.

## 4. Az on-device út (Free)

A [nativeRender.ts](../../../src/lib/nativeRender.ts) a **#1 termék-blokkoló
feloldása**: az alap MP4 a telefonon készül, szerver nélkül, ingyen.

- **Projekt → render-terv:** `buildRenderPlan()` a projektből a natív oldal
  által értelmezett `RenderPlan`-t épít: videó-szegmensek (uri, `atSec`, `inSec`,
  `durationSec`, `speed`, `volume`, `filter`) + hang-szegmensek, idővonal-
  sorrendbe rendezve. A **http-stream** (URL-import) klipeket **kihagyja** — azok
  a felhő-render sajátjai.
- **Natív végrehajtás:** iOS `AVFoundation` (AVMutableComposition +
  AVAssetExportSession), Android `MediaCodec + MediaMuxer` — a
  [remix-render](../../../modules/remix-render/index.ts) `exportPlan(planJson, out)`-ja.
- **Elérhetőség:** `isNativeRenderAvailable()` — Expo Go-ban `false` (a
  [router](./networking.md) ilyenkor felhő-renderre esik vagy beszédes hibát ad).
- **Őszinte korlátok** (a kód kommentjeiből):
  - a natív felület `exportPlan`-je **nem tud cancelt** — a `signal` csak elengedi
    a hívást és eldobja a részeredményt (nem osztja meg, nem menti a Fotókba);
  - a fejlett effektek (fejlett átmenetek, 3D, AI, Chromium-tipográfia) **csak** a
    felhő-render sajátjai.

## 5. A felhő-út (Pro)

A [render.ts](../../../src/lib/render.ts) feltölti a projekt-JSON-t + a
médiafájlokat a workernek, státuszt pollozik (`POLL_MS = 2000`,
`MAX_POLLS = 300` ≈ 10 perc), majd letölti a kész MP4-et.

- **FFmpeg-lánc** ([server/render.js](../../../server/render.js)): videó/kép-
  konkatenáció, sebesség, szűrő/grade, keyframe, chroma, maszk, fade, többsávos
  hangkeverés (amix).
- **Headless Chromium raster** ([server/text-render.js](../../../server/text-render.js)):
  a szöveg/forma/felirat PNG-vé rasterizálódik → a stíluspresetek **pixelre
  egyeznek** az előnézettel.
- **Hibrid, skálázható** ([ADR-007](../decisions/ADR-007-hybrid-render.md)): rövid
  videók a lokális szerveren azonnal; a hosszabbak BullMQ-queue (Redis) + S3 úton,
  külön [render-worker.js](../../../server/render-worker.js) process(ek)en (több
  példány = vízszintes skálázás). Küszöb: `CLOUD_RENDER_MIN_SEC`.

## 6. Cache és asset-identitás

- **Render-cache kulcs:** [projectHash.ts](../../../src/lib/projectHash.ts)
  `renderCacheKey()` — azonos projekt-állapot → nem renderelünk újra.
- **Asset-ujjlenyomat:** [fingerprint.ts](../../../src/lib/fingerprint.ts)
  `withFingerprints()` — md5+méret a feltöltéshez/relinkhez ([storage.md](./storage.md)).
- **Progressz:** [progress.ts](../../../src/lib/progress.ts) `weightedStages()` +
  [progressStore](../../../src/store/progressStore.ts).

## 7. Paritás-mátrix (kivonat)

| Effekt | Előnézet | On-device | Felhő |
|---|---|---|---|
| Vágás / sebesség / hang-mix | közelít | ✅ | ✅ |
| Szűrő / grade / LUT | tint-közelítés | alap szűrő | ✅ pontos |
| Kulcskocka (zoom/pan/opacity) | ✅ | részleges | ✅ |
| Szöveg-stíluspreset / kinetic | RN-közelítés | ❌ | ✅ (Chromium) |
| Átmenetek (3D/xfade) | közelít | ❌ | ✅ |
| Chroma / maszk / matte | közelít | ❌ | ✅ |
| Hotspot (interaktív) | ✅ élő | sidecar-JSON | sidecar-JSON |

## 8. Kapcsolódások

- Az elv indoklása → [ADR-003](../decisions/ADR-003-preview-render-parity.md)
- A hibrid render → [ADR-007](../decisions/ADR-007-hybrid-render.md)
- A mesteróra, ami az előnézetet hajtja → [performance.md](./performance.md)
- A Free/Pro kapu → [networking.md](./networking.md)
