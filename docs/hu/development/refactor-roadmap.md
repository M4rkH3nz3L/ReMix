# Nagy fájlok bontása — REFACTOR roadmap

> Ág: `refactor`. Cél: minden 500 sornál hosszabb éles forrásfájl felelősség szerinti bontása
> **viselkedésváltozás nélkül** — a publikus API, a szerkesztési képességek, a render-kimenet és a
> platform-kompatibilitás változatlan. Szabály: nem sorszám, hanem felelősség, kohézió, csatolás és
> tesztelhetőség szerint bontunk; a szerkezeti és a funkcionális változás sosem kerül egy commitba.

## Bizonyítási kapuk (minden lépés után)

| Kapu | Parancs | Mit bizonyít |
|---|---|---|
| Típusok | `npm run typecheck` | a bekötés hibátlan (kliens + worker) |
| Lint | `npm run lint` | 0 hiba; a figyelmeztetések száma nem nő (kiinduló: 70) |
| **API-felület** | `node scripts/quality/api-surface.js` | minden korábbi export **neve és TS-típusa** változatlan (6001 export, 1100 modul — `api-surface.json`); a szétbontott fájl re-exportál |
| **Körfüggőség** | `node scripts/quality/cycles.js` | új futásidejű import-kör nem keletkezett (kiinduló: 2 kör — `cycles-baseline.json`) |
| Fájlméret | `node scripts/quality/file-size.js` | az óriásfájlok nem nőnek; bontás után a lista zsugorodik |
| Tesztek | `npm test` | a meglévő tesztek + a kiemelt modulok új regressziós tesztjei zöldek |

A három struktúra-kapu: `npm run structure`, és része az `npm run audit`-nak és a CI-nek.

## 0. fázis — kiinduló állapot (2026-11-20, `e463d0a`)

- `npm run audit`: zöld — tsc 0 hiba, lint 0 hiba / 70 figyelmeztetés,
  **561 suite, 5981 sikeres + 1 kihagyott teszt** (49 s; teljes audit 1:52).
- Körfüggőség: 2 ismert kör — `src/lib/errors.ts ↔ src/lib/logCaught.ts`,
  `src/dev/smoke/phases15.tsx ↔ src/dev/smoke/shared.tsx`.
- 500 sor feletti fájl: **81** = 63 éles + 2 teszt (`contract.test.ts`, `commands.test.ts`)
  + 16 dev-only smoke (`src/dev/smoke/*`). Generált, asset- és vendored fájl nincs köztük
  (a `git ls-files` + `node_modules`/`ios`/`android` kizárással mérve).
- Hiányzó regressziós tesztek: a nagy UI-komponenseknek (Timeline, PreviewSurface, panelek) nincs
  komponens-tesztjük; a bontásnál a kiemelt **tiszta logika** kap unit-tesztet, a UI-bekötést a
  típusellenőrzés + az API-kapu + a meglévő integrációs tesztek fedik, az érintős munkafolyamatokat
  az iPad-es eszközkör.

## Éles fájlok (63)

| Fájl | Sor | Állapot |
|---|---:|---|
| `src/components/editor/Timeline.tsx` | 1531 | ⬜ |
| `src/components/editor/panels/AssistantPanel.tsx` | 1507 | ⬜ |
| `src/app/editor/[id].tsx` | 1459 | ⬜ |
| `src/components/studio/image/ImageStudioBody.tsx` | 1444 | ⬜ |
| `src/components/preview/PreviewSurface.tsx` | 1423 | ⬜ |
| `src/components/studio/model3d/Model3DStudio.tsx` | 1365 | ⬜ |
| `src/lib/render.ts` | 1195 | ⬜ |
| `server/text-render.js` | 1174 | ⬜ |
| `src/lib/feed.ts` | 1137 | ⬜ |
| `src/app/live/studio/[id].tsx` | 1137 | ⬜ |
| `src/components/studio/image/LayerInspector.tsx` | 1105 | ⬜ |
| `src/components/editor/panels/ExportPanel.tsx` | 1059 | ⬜ |
| `server/userFiles.js` | 997 | ⬜ |
| `src/app/auth.tsx` | 980 | ⬜ |
| `src/hooks/useFeed.ts` | 975 | ⬜ |
| `src/app/live/[id].tsx` | 952 | ⬜ |
| `src/components/editor/panels/TextPanel.tsx` | 926 | ⬜ |
| `src/components/studio/audio/ClipEditSheet.tsx` | 889 | ⬜ |
| `src/lib/offlineMix.ts` | 887 | ⬜ |
| `src/components/editor/panels/CaptionsPanel.tsx` | 850 | ⬜ |
| `src/lib/commands.ts` | 843 | ⬜ |
| `src/lib/vectorPath.ts` | 813 | ⬜ |
| `server/ai.js` | 805 | ⬜ |
| `src/components/editor/Toolbar.tsx` | 795 | ⬜ |
| `server/imagedoc.js` | 775 | ⬜ |
| `server/routes/imageTools.js` | 741 | ⬜ |
| `src/components/studio/audio/AudioStudioBody.tsx` | 738 | ⬜ |
| `src/components/editor/TimelineClip.tsx` | 732 | ⬜ |
| `src/components/editor/panels/AudioPanel.tsx` | 718 | ⬜ |
| `src/lib/projectUtils.ts` | 715 | ⬜ |
| `src/components/studio/image/ImageCanvas.tsx` | 715 | ⬜ |
| `src/app/channel/[id].tsx` | 693 | ⬜ |
| `server/userStorage.js` | 693 | ⬜ |
| `src/components/studio/CreateProjectModal.tsx` | 687 | ⬜ |
| `src/lib/audioDsp.ts` | 680 | ⬜ |
| `src/components/preview/AudioLayer.tsx` | 676 | ⬜ |
| `src/components/profile/WalletCard.tsx` | 674 | ⬜ |
| `server/routes/render.js` | 667 | ⬜ |
| `src/components/editor/panels/ShapePanel.tsx` | 637 | ⬜ |
| `src/components/editor/panels/StickerPanel.tsx` | 608 | ⬜ |
| `src/hooks/useProfile.ts` | 601 | ⬜ |
| `src/components/studio/image/body/useImageExport.tsx` | 601 | ⬜ |
| `src/lib/svgImport.ts` | 595 | ⬜ |
| `src/lib/universalSearch.ts` | 593 | ⬜ |
| `src/lib/wallet.ts` | 592 | ⬜ |
| `src/components/editor/panels/PrecisionPanel.tsx` | 583 | ⬜ |
| `src/lib/chat.ts` | 578 | ⬜ |
| `server/render/clipChains.js` | 570 | ⬜ |
| `src/hooks/useStudio.ts` | 558 | ⬜ |
| `src/components/preview/TextOverlay.tsx` | 558 | ⬜ |
| `src/app/shop.tsx` | 557 | ⬜ |
| `src/components/profile/StorageCard.tsx` | 549 | ⬜ |
| `src/lib/offlineMixClient.ts` | 543 | ⬜ |
| `src/components/editor/CameraRecorder.tsx` | 543 | ⬜ |
| `src/app/schedules.tsx` | 541 | ⬜ |
| `src/lib/storage.ts` | 524 | ⬜ |
| `src/app/admin.tsx` | 524 | ⬜ |
| `server/liveEgress.js` | 524 | ⬜ |
| `src/lib/audioIntent.ts` | 523 | ⬜ |
| `src/components/editor/panels/LibraryPanel.tsx` | 523 | ⬜ |
| `src/store/editorState.ts` | 522 | ⬜ |
| `src/lib/assetLibrary.ts` | 514 | ⬜ |
| `server/render/videoFilters.js` | 502 | ⬜ |
