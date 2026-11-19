# Minőségi kiinduló mérés (baseline)

> **Dátum:** 2026-11-19 · **Commit:** `ce1b34b` (main) · **Gép:** macOS (Darwin 27), 10 mag, Node 22.17.0,
> ffmpeg 8.1.2, Chromium a Playwright-gyorsítótárból.
> ↑ [docs/hu index](../README.md) · kapcsolódó: [testing.md](./testing.md)
>
> Ez a viszonyítási alap a kódminőség-emelés minden további fázisához. Kódváltoztatás
> nélkül mérve. A végső összevetés: `quality-report.md` (később).

## 1. Merge-kapu (`npm run audit`)

| Lépés | Eredmény | Idő (fali) |
|---|---|---|
| `tsc --noEmit` | ✅ 0 hiba | 15,2 s |
| `expo lint` | ✅ 0 hiba, **111 figyelmeztetés** (77 automatikusan javítható) | 2,0 s (gyorsítótárral) |
| `jest` (kliens + worker + build, egy futtatóban) | ✅ 535/535 suite · 5340 átment · 1 kihagyott · 0 bukás | 41,0 s |

A worker tesztjei (`server/**/*.test.js`) a gyökér `jest.config.js` `server` projektjében
futnak, a `npm test` része.

### Tesztszám projektenként

| Projekt | Suite | Teszt | Összesített suite-idő* |
|---|---|---|---|
| client (`src/`) | 424 | 4463 | 318,5 s |
| server (`server/`) | 110 | 867 (1 kihagyott) | 65,2 s |
| build (`tools/`) | 1 | 11 | 4,2 s |
| **összesen** | **535** | **5341** | fali idő: **41 s** (párhuzamos) |

\* a suite-ok saját idejének összege, coverage-dzsel mérve.

### A 10 leglassabb suite (coverage-futás)

| Idő | Suite |
|---|---|
| 30,8 s | `src/lib/imageCanvasOps.test.ts` |
| 23,7 s | `src/lib/imagePixelPipeline.test.ts` |
| 22,9 s | `src/lib/mixAssist.test.ts` |
| 22,1 s | `src/lib/imageTextShape.test.ts` |
| 21,2 s | `src/lib/svgRoundTrip.test.ts` |
| 20,9 s | `server/imagedoc.render.test.js` |
| 18,4 s | `src/lib/offlineMix.parity.test.ts` |
| 13,5 s | `src/components/studio/audio/ClipEditSheet.test.tsx` |
| 10,8 s | `src/lib/imageGestures.test.tsx` |
| 7,6 s | `src/lib/audioSync.test.ts` |

## 2. Coverage (`jest --coverage`)

| | Utasítás | Branch | Függvény | Sor |
|---|---|---|---|---|
| **Összesen** | 65,41 % | **57,92 %** | 66,04 % | **65,09 %** |
| csak `src/` | — | 62,95 % | — | 71,20 % |
| csak `server/` | — | 45,06 % | — | 50,80 % |

**Fontos megkötések:**

- Nincs `collectCoverageFrom`, ezért a szám **csak a tesztek által betöltött fájlokra** vonatkozik;
  a teszt nélküli fájlok kimaradnak a nevezőből (a valós arány alacsonyabb).
- ⚠️ **A coverage-futás 4 suite-ot / 22 tesztet hamisan buktat** (`imagedoc.render`,
  `imageTextShape`, `render.degraded`, `imageCanvasOps`): az istanbul a `page.evaluate`-nek
  átadott függvényekbe is számlálót (`cov_…`) injektál, ami a Chromiumban nem létezik →
  `ReferenceError: cov_… is not defined`. Sima futásban ezek zöldek. Ezért a fenti coverage-
  számok ezeknek a suite-oknak a lefedését részben nem tartalmazzák. (Javítás: 1. fázis.)

### A 2. fázis célfájljai

| Fájl | Sor % | Branch % | Branch (fedett/összes) |
|---|---|---|---|
| `src/lib/commands.ts` | 90,03 | 82,19 | 360/438 |
| `src/lib/tiers.ts` | 100 | 94,44 | 17/18 |
| `server/tiers.js` | 100 | 100 | 17/17 |
| `server/billing.js` | 66,18 | 51,12 | 68/133 |
| `server/coinSettle.js` | 87,09 | 67,56 | 25/37 |
| `server/payouts.js` | **18,18** | **3,84** | 1/26 |
| `server/payoutRunner.js` | 80,55 | 60,00 | 21/35 |
| `server/quota.js` | **6,66** | **0** | 0/49 |
| `server/usage.js` | 72,44 | 56,42 | 79/140 |
| `server/security/accountErase.js` | 100 | 88,23 | 15/17 |
| `server/security/auditLog.js` | 73,68 | 93,54 | 29/31 |
| `server/security/authorization.js` | 58,92 | 64,06 | 41/64 |
| `server/security/mediaPolicy.js` | 100 | 92,43 | 110/119 |
| `server/security/notifyPolicy.js` | 100 | 95,00 | 19/20 |
| `server/security/ownedKey.js` | 100 | 75,00 | 6/8 |
| `server/security/prodGates.js` | 86,66 | 47,05 | 8/17 |
| `server/security/rateLimit.js` | 82,08 | 89,13 | 41/46 |
| `server/security/redact.js` | 100 | 50,00 | 2/4 |
| `server/security/renderAuth.js` | 100 | 100 | 9/9 |
| `server/security/rtmpUrl.js` | 84,09 | 78,48 | 62/79 |
| `server/security/securityHeaders.js` | 100 | — | 0/0 |
| `server/security/uploadPolicy.js` | 75,67 | 65,00 | 13/20 |

**Mutation score:** nincs mérve (Stryker nincs a repóban) — a 2. fázis méri először.

## 3. Típus- és lint-kivételek

Hatókör: a git által követett `.ts/.tsx/.js/.jsx/.mjs/.cjs` fájlok (1616 fájl, 260 306 sor;
`node_modules` nélkül). Csak a valódi típus-használat számít (a kommentek és az `any` nevű
változók kiszűrve).

| Mutató | Éles kód | Teszt | Összesen |
|---|---|---|---|
| `any` (`: any`, `as any`, `any[]`, `<any>`) — sorok | 6 (mind `src/lib/billing.ts`, RevenueCat-objektumok) | 4 (`svgImport.test.ts` 3, `svgRoundTrip.test.ts` 1) | **10** |
| `@ts-ignore` | 0 | 0 | **0** |
| `@ts-expect-error` | 0 | 1 (`secureStorage.test.ts`, indokolt) | **1** |
| `@ts-nocheck` | 0 | 0 | **0** |
| `eslint-disable*` | — | — | **82** (`src/` 80, `server/` 2) |
| ebből ugyanabban a sorban indokolt (`-- ok`) | | | **0** |
| `server/` `// @ts-check` | | | 0 (nincs `server/tsconfig.json`) |

`eslint-disable` szabályonként:

| Db | Szabály |
|---|---|
| 35 | `@typescript-eslint/no-require-imports` (25 fájlszintű + 10 soros, jellemzően tesztekben) |
| 25 | `react-hooks/exhaustive-deps` (22 next-line + 3 line) |
| 12 | `no-console` |
| 3 | `react-hooks/set-state-in-effect` |
| 2 | `import/first` |
| 1–1 | `no-unused-vars`, `no-control-regex`, `import/no-named-as-default-member`, `@typescript-eslint/no-var-requires`, `@typescript-eslint/no-explicit-any` |

## 4. Fájlméretek

- **500 sornál hosszabb:** 65 fájl · **1000 sornál hosszabb:** 16 fájl.

### A 10 legnagyobb fájl

| Sor | Fájl |
|---|---|
| 13 975 | `src/lib/imageSmoke.tsx` |
| 3 328 | `server/render.js` |
| 2 993 | `src/components/studio/image/ImageStudioBody.tsx` |
| 2 303 | `src/components/studio/audio/AudioStudioBody.tsx` |
| 1 989 | `src/types/project.ts` |
| 1 531 | `src/components/editor/Timeline.tsx` |
| 1 508 | `src/components/editor/panels/AssistantPanel.tsx` |
| 1 459 | `src/app/editor/[id].tsx` |
| 1 424 | `src/components/preview/PreviewSurface.tsx` |
| 1 366 | `src/components/studio/model3d/Model3DStudio.tsx` |

<details>
<summary>Mind a 65 fájl 500 sor felett</summary>

13975 src/lib/imageSmoke.tsx · 3328 server/render.js · 2993 src/components/studio/image/ImageStudioBody.tsx ·
2303 src/components/studio/audio/AudioStudioBody.tsx · 1989 src/types/project.ts ·
1531 src/components/editor/Timeline.tsx · 1508 src/components/editor/panels/AssistantPanel.tsx ·
1459 src/app/editor/[id].tsx · 1424 src/components/preview/PreviewSurface.tsx ·
1366 src/components/studio/model3d/Model3DStudio.tsx · 1195 src/lib/render.ts · 1174 server/text-render.js ·
1137 src/lib/feed.ts · 1137 src/app/live/studio/[id].tsx · 1105 src/components/studio/image/LayerInspector.tsx ·
1059 src/components/editor/panels/ExportPanel.tsx · 997 server/userFiles.js · 980 src/app/auth.tsx ·
975 src/hooks/useFeed.ts · 953 src/app/live/[id].tsx · 926 src/components/editor/panels/TextPanel.tsx ·
889 src/components/studio/audio/ClipEditSheet.tsx · 887 src/lib/offlineMix.ts ·
850 src/components/editor/panels/CaptionsPanel.tsx · 843 src/lib/commands.ts · 813 src/lib/vectorPath.ts ·
805 server/ai.js · 795 src/components/editor/Toolbar.tsx · 775 server/imagedoc.js ·
741 server/routes/imageTools.js · 732 src/components/editor/TimelineClip.tsx ·
718 src/components/editor/panels/AudioPanel.tsx · 715 src/lib/projectUtils.ts ·
715 src/components/studio/image/ImageCanvas.tsx · 693 src/app/channel/[id].tsx · 693 server/userStorage.js ·
687 src/components/studio/CreateProjectModal.tsx · 680 src/lib/audioDsp.ts · 677 src/components/preview/AudioLayer.tsx ·
674 src/components/profile/WalletCard.tsx · 667 server/routes/render.js · 637 src/components/editor/panels/ShapePanel.tsx ·
608 src/components/editor/panels/StickerPanel.tsx · 601 src/hooks/useProfile.ts · 595 src/lib/svgImport.ts ·
593 src/lib/universalSearch.ts · 592 src/lib/wallet.ts · 583 src/components/editor/panels/PrecisionPanel.tsx ·
578 src/lib/chat.ts · 576 src/lib/contract.test.ts · 559 src/hooks/useStudio.ts · 558 src/components/preview/TextOverlay.tsx ·
557 src/app/shop.tsx · 549 src/components/profile/StorageCard.tsx · 543 src/lib/offlineMixClient.ts ·
543 src/components/editor/CameraRecorder.tsx · 541 src/app/schedules.tsx · 532 src/lib/commands.test.ts ·
524 src/lib/storage.ts · 524 src/app/admin.tsx · 524 server/liveEgress.js · 523 src/lib/audioIntent.ts ·
523 src/components/editor/panels/LibraryPanel.tsx · 522 src/store/editorState.ts · 514 src/lib/assetLibrary.ts

</details>

## 5. Bundle-méret

`npx expo export --platform ios` (éles mód, Hermes):

| Mutató | Érték |
|---|---|
| iOS JS-bundle (`entry-*.hbc`) | **18 101 421 bájt (≈ 18,1 MB)** |
| teljes export-mappa (assetekkel) | ≈ 31,1 MB |
| export ideje | 40 s |

⚠️ A dev-only füstteszt-kód **benne van az éles bundle-ben**: a `[IMG-SMOKE]` jelölő
megtalálható a `.hbc`-ben. A `src/app/dev-image-smoke.tsx` dinamikusan importálja a
`@/lib/imageSmoke`-ot, de a hívás nincs `__DEV__` mögött, így a Metro beépíti (4. fázis).

## 6. Megfigyelések (még nem javítva)

1. **Coverage + Playwright ütközés** — lásd 2. szakasz; a coverage-futás ma nem zöld.
2. **Pénzügyi magok alacsony lefedése** — `server/quota.js` 0 % branch, `server/payouts.js`
   3,8 % branch; ezek a kvóta-kikényszerítés és a kifizetés útjai.
3. **Lint-zaj** — 111 figyelmeztetés (pl. `import/no-duplicates`); a kapu csak hibára bukik.
4. **`eslint-disable` indoklás** — a 82-ből egy sem visel ugyanabban a sorban indoklást
   (az ok, ha van, a szomszédos kommentben áll).
</content>
</invoke>
