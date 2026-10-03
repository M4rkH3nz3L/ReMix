# 📱 ReMix — Natív build + eszközön futó render-motor (terv)

> **Miért ez a terv?** Az Expo Go csak a beépített Expo-API-khoz enged hozzá —
> a ReMix viszont a telefon **hardveres videó-enkódolását** (Android MediaCodec /
> iOS VideoToolbox) és **saját natív modult** (`modules/remix-render/`) használ.
> Ezekhez **Development / native build** kell, nem Expo Go. Ez a dokumentum a
> natív build munkafolyamatát ÉS a háromszintű render-motort tervezi meg, a
> repo jelenlegi valós állapotára építve.
>
> **Testvér-tervek:** [VIDEO.md](./VIDEO.md) · [AUDIO.md](./AUDIO.md) ·
> [IMAGE.md](./IMAGE.md) · [PROD.md](./PROD.md) · go-live/security:
> [remix/00-README.md](./remix/00-README.md).

---

## 0. Jelenlegi állapot (kiindulás — bizonyítékkal)

| Réteg | Állapot | Hol |
| --- | --- | --- |
| **Development Build alap** | 🟢 kész | `expo-dev-client` dep, `eas.json` profilok, `android/` + `ios/` prebuild, `app.json` plugins/permissions |
| **Natív render modul (váz)** | 🟡 részben | [modules/remix-render/](../../modules/remix-render/) — `RemixRender` Expo-module |
| **iOS render (AVFoundation)** | 🟢 v1 | [RemixRenderModule.swift](../../modules/remix-render/ios/RemixRenderModule.swift) — multi-szegmens vágás+sebesség, aspect-fill vászon, hang-mix, H.264 MP4, progressz |
| **Android render (MediaCodec)** | 🔴 **csak triviális copy** | [RemixRenderModule.kt](../../modules/remix-render/android/src/main/java/expo/modules/remixrender/RemixRenderModule.kt) — 1 klip, vágás/sebesség/szűrő nélkül → minden más a felhőre esik |
| **JS-híd / terv-fordító** | 🟢 kész | [src/lib/nativeRender.ts](../../src/lib/nativeRender.ts) — `buildRenderPlan`, `renderLocal`, `requireOptionalNativeModule('RemixRender')` |
| **Render-orkesztrátor + router** | 🟢 kész | [src/lib/render.ts](../../src/lib/render.ts) + [src/lib/backend.ts](../../src/lib/backend.ts) — local vs cloud döntés |
| **Felhő-render (Level 3)** | 🟢 kész | `server/render-worker.js` + FFmpeg (BullMQ queue) |
| **iOS natív build** | ⛔ blokkolt | Xcode 26.4+ kell (lásd §5) |

**Egy mondatban:** a natív build-lánc és a JS-oldal kész, az iOS-motor v1-en van,
a **#1 technikai hiány az Android eszközön-render-motor** (jelenleg csak egyetlen,
érintetlen klipet tud kimásolni).

### Üzleti modell (nem változik)
`modules/remix-render/README.md` szerint: **eszközön-render = ingyen** (ez a modul),
**felhő-HD + AI = Pro**. A security-hardening és a natív motor **nem** kapuzhat Pro
mögé eddig-ingyen, on-device funkciót (lásd `free-vs-pro` modell).

---

## 1. A háromszintű render-architektúra (cél)

```text
Level 1 — PREVIEW            Level 2 — LOCAL RENDER         Level 3 — CLOUD RENDER
(szerkesztés közben)         (export a telefonon, ingyen)   (nagy projekt / Pro)
──────────────────           ────────────────────────       ──────────────────────
timeline → GPU preview       plan → native engine →          project → queue →
expo-video + usePlaybackClock   Android MediaCodec /          GPU szerver →
60 FPS, nincs fájl              iOS VideoToolbox →            4K / komplex FX / AI
                                H.264/H.265 MP4               → MP4
  [MEGVAN]                      [iOS v1 / Android HIÁNY]       [MEGVAN]
```

- **Level 1 — Preview:** már a `src/components/preview/` + `usePlaybackClock`
  rajzolja; nincs teendő ebben a tervben (a timeline-vízió a [VIDEO.md](./VIDEO.md)).
- **Level 2 — Local render:** EZ a terv fő tárgya → §3 (Android), §4 (iOS).
- **Level 3 — Cloud render:** kész; a router (`backend.ts`) akkor választja, ha a
  projekt nem renderelhető helyben (nincs helyi videó, vagy fejlett FX/AI/4K/HD + Pro).

**Elv (fontos, a user kérésére kiemelve):** a natív build önmagában **nem** gyorsít
— a `renderVideo` JS-ben marad JS. A sebességet a **JSI/TurboModule → Kotlin/Swift →
MediaCodec/VideoToolbox** lánc adja. A ReMix ezt a `remix-render` Expo-modullal
valósítja meg (nem kézi eject): **Expo + Expo Modules + natív kód** marad.

---

## 2. Render-terv formátum (JS → natív) — már létezik, STABIL

A `buildRenderPlan` ([nativeRender.ts](../../src/lib/nativeRender.ts)) állítja elő;
az iOS és az Android oldal UGYANEZT a JSON-t fogyasztja:

```jsonc
{
  "width": 1080, "height": 1920, "fps": 30, "background": "#000000",
  "video": [{ "uri", "atSec", "inSec", "durationSec", "speed", "volume", "filter" }],
  "audio": [{ "uri", "atSec", "inSec", "durationSec", "volume" }]
}
```

- Csak **helyi** (nem `http`) fájlokat tesz a tervbe → a felhő-forrásokat a
  Level 3 viszi. A `video`/`audio` idővonal szerint rendezve.
- **A formátumot NEM változtatjuk** — az Android motor ezzel paritásban épül az
  iOS-hez. Ha bővül (pl. `transition`, `textOverlay`), az iOS + Android együtt kövesse.

---

## 3. 🔴 Android eszközön-render-motor (a fő munka)

**Cél:** az [RemixRenderModule.kt](../../modules/remix-render/android/src/main/java/expo/modules/remixrender/RemixRenderModule.kt)
`exportPlan(planJson, outputPath)`-ja az iOS-sel **funkcionális paritásba** kerüljön:
több videó-szegmens vágással + sebességgel, egy fix vászonra (aspect-fill), a
szegmensek saját hangja + külön hang-sávok keverve, H.264 MP4, valós progressz.

Technológia: **MediaExtractor → MediaCodec (decode) → OpenGL ES (vászon/skálázás/
szűrő) → MediaCodec (encode) → MediaMuxer**, az audio külön `MediaCodec` decode →
PCM mix → AAC encode ágon.

### Fázis A — Single-clip **remux vágással** (gyors győzelem) 🎯 ELSŐ
Cél: a mai „byte-copy" helyett valódi, veszteségmentes vágás, ha nincs
transzkódolási kényszer (speed=1, filter=none, a klip mérete = vászon).
- [ ] `MediaExtractor` + `MediaMuxer`: a kijelölt `[inSec, inSec+durationSec]`
      tartomány átmuxolása (video+audio sáv), legközelebbi keyframe-hez igazítva.
- [ ] Progressz a kimuxolt minták arányából (`onProgress`).
- [ ] Ha a klip mérete ≠ vászon VAGY forgatott → NEM remux, tovább a Fázis B-re.
- **Kész, ha:** egy helyi klip vágott exportja MP4-et ad, lejátszható, hang szinkron.

### Fázis B — Single-clip **transzkód** (vászon + sebesség + szűrő)
- [ ] Decode→GL→encode pipeline: a forrást a `renderSize` vászonra rajzolja
      (aspect-fill transform, a `preferredTransform`/rotáció kezelésével — az iOS
      `aspectFillTransform` párja GL-shaderben).
- [ ] `speed`: a PTS-skálázás a kódolt frame-ek időbélyegén (a hang `atempo`-szerű
      újramintázása PCM-ben).
- [ ] `filter` v1: a már meglévő `filterId`-k közül a GL-ben olcsón megoldhatók
      (brightness/contrast/saturation/LUT) — a bonyolultak maradnak a felhőben.
- **Kész, ha:** 9:16 vászon + 2× sebesség + egy alap szűrő helyben renderel.

### Fázis C — **Multi-segment** összefűzés + hang-mix (iOS-paritás)
- [ ] A `video[]` szegmensek egymás után a közös encoder-be (folytonos PTS).
- [ ] A szegmensek saját hangja + a `audio[]` sávok PCM-mixe (volume-mal),
      abszolút `atSec`-re időzítve → egy AAC sáv.
- [ ] Szegmens-határ: a GL-encoder folytonos marad (nincs muxer-újranyitás).
- **Kész, ha:** egy 3-klipes + zene + voiceover projekt helyben, az iOS-sel
  vizuálisan/időben egyező MP4-et ad.

### Fázis D — Robusztusság + megszakítás
- [ ] **Valódi cancel:** `exportPlan` kapjon megszakítást (az `AbortSignal`-hoz —
      ma a JS csak elengedi a hívást, a kódolás tovább fut, lásd `nativeRender.ts`
      figyelmeztetés). Natív oldali flag → a decode/encode loop kilép, részfájl törlés.
- [ ] Hibakezelés: sérült/variábilis-fps forrás, HDR/10-bit → tiszta hiba + cloud-fallback.
- [ ] `FOREGROUND_SERVICE_MEDIA_PLAYBACK` már engedélyezett — hosszú export ne haljon
      meg háttérben (foreground service a render idejére).
- **Kész, ha:** a ✕ ténylegesen megszakít, a hibás forrás nem crashel, hosszú render túléli a háttért.

### Fázis E — Codec/minőség
- [ ] H.265 (HEVC) opció, ha az eszköz enkódere támogatja (kisebb fájl); fallback H.264.
- [ ] Bitráta/preset a `settings.resolution`/`fps`-hez igazítva (a `RenderSettings`-ből).
- **Kész, ha:** a kimenet mérete/minősége összevethető a felhő-renderrel 1080p-ig.

> **Verifikáció:** minden fázis a FUTÓ emulátoron (`emulator-5554`) + egy valós
> eszközön tesztelve, nem csak fordítás. A terv-fordító JS-oldalhoz unit-teszt
> (`src/lib/nativeRender.test.ts`), a Kotlin-motorhoz manuális render-mintasor.

---

## 4. iOS — meglévő motor karbantartás (követ, nem vezet)
- [x] AVFoundation v1 (multi-szegmens + hang-mix + aspect-fill) — kész.
- [ ] Paritás a Fázis B–C bővítésekkel (szűrő-készlet, codec-opció), ahogy az
      Android eléri őket — a terv-formátum közös, a két motor együtt mozog.
- [ ] Valódi cancel (Fázis D) — az AVAssetExportSession `cancelExport()`-tal.

---

## 5. Build & release munkafolyamat

### 5.1 Fejlesztés (ma is ez megy)
```bash
npx expo start --dev-client     # Metro
npx expo run:android            # lokális natív debug build (dev-client) → emulátor/USB
```
- Dev-client build már telepítve az emulátoron (`com.h3nz3l.remix`), a natív modul
  CSAK itt töltődik be (Expo Go-ban `requireOptionalNativeModule` → `null`).

### 5.2 Telepíthető Android APK
- [ ] **EAS development build** (dev-client, belső terjesztés):
      `npx eas-cli build --profile development --platform android`
- [ ] **EAS preview build** (önálló APK, Metro nélkül, tesztelőnek):
      `npx eas-cli build --profile preview --platform android`
- [ ] **Lokális APK** (EAS nélkül, kreditmentes): `cd android && ./gradlew assembleDebug`
      (a debug APK a Metróhoz kapcsolódik; önálló release-hez signing-config kell).
- Előfeltétel kész: Expo-login (`vided`), `eas.json` profilok, `projectId` linkelve.
- [ ] `android.versionCode` → az `eas.json` `appVersionSource: remote` + `autoIncrement`
      kezeli a production profilban; a dev/preview belső.

### 5.3 iOS build — ⛔ BLOKKOLT
- A `npx expo run:ios` elhasal a jelenlegi Xcode-on (`expo-modules-jsi` `weak let` /
  SE-0481 nincs a Swift 6.2.0-ban) → **Xcode 26.4+ kell**. A `Podfile` WeakLet
  post_install hook betéve. EAS iOS buildhez Apple Developer account + signing.

### 5.4 Production
```bash
npx eas-cli build --profile production --platform android   # Google Play (.aab)
npx eas-cli build --profile production --platform ios       # App Store (Xcode 26.4+)
```

---

## 6. Sorrend (javasolt)

1. **Android build igazolása** → telepíthető APK gyártása (§5.2) — „elsőnek Androidra".
2. **Fázis A** (remux vágással) — gyors, veszteségmentes győzelem.
3. **Fázis B** (vászon + sebesség + alap szűrő) — a leggyakoribb rövidvideó-eset.
4. **Fázis C** (multi-segment + hang-mix) — teljes iOS-paritás.
5. **Fázis D–E** (cancel, foreground, codec/minőség).
6. iOS paritás-karbantartás, amint Xcode 26.4+ elérhető.

**Kész, ha (a terv egésze):** egy tipikus több-klipes, zenés rövidvideó
**internet nélkül, a telefonon, ingyen** renderel MP4-be, az iOS-sel egyező
eredménnyel; a fejlett FX/4K/AI pedig a felhő-render (Pro) sajátja marad.
