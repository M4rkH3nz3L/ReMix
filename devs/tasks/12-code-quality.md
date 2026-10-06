# 🧱 12. Code quality / robustness — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §12, §14. · **Testvér:** [06-video-editor](./06-video-editor.md) (command/asset), [03-collaboration](./03-collaboration.md) (event-log), [13-documentation](./13-documentation.md) (contract-tesztek).
> **Érintett kód:** [src/lib/parseGuards.ts](../../src/lib/parseGuards.ts) · `src/lib/netRetry.ts` · `AssistantPanel.tsx` · [src/store/editorStore.ts](../../src/store/editorStore.ts) · [server/](../../server/) (render-cancel).

---

## 0. Kontextus & cél
A kódbázis nagy és gyors fejlődésű — a robusztusság (validáció, retry, cancellation, race-védelem,
cache-limitek, event-log-méret) a production-stabilitás alapja. Vezérelv: **UI → Command → Pure →
Store**, tipizált hálózat, determinisztikus állapot.

## 1. Jelenlegi állapot (bizonyíték)
- Van `parseGuards.ts` + `netRetry.ts` (tehát a „nincs retry" MISSING.md-állítás elavult).
- Hiány: egységes response-validáció + retry-policy minden kritikus path-on, render-cancellation,
  UI-rollback, race-védelem, timer-cleanup, cache-limitek, event-log-compaction, nagy-fájl-refaktor.

## 2. Feladatlista

### 2.1 HTTP response validation — P1
- [x] ~ **Toolkit kibővítve + első adopter**: [parseGuards.ts](../../src/lib/parseGuards.ts) a `str`/`boolOr`/`strList`/**`asRecord`** narrowerekkel (a meglévő `finiteNum`/`timeList`/… mellé) → `const o = asRecord(await res.json()); str(o?.name)` a `… as T` helyett. Teszt: `parseGuards.test.ts` (+5). Első bekötés: [aiHealth.ts](../../src/lib/aiHealth.ts) (`boolOr(asRecord(...)?.ok)`).
- [ ] ⬜ **Hátra**: a maradék ~20 fájl `res.json() as T` castjainak inkrementális migrálása a guardokra (biztonsági/kritikus path-ok elöl: billing, externalStorage, colorClient).

### 2.2 Retry / backoff egységesítés — P1
- [ ] 🟡 `netRetry.ts` VAN → ⬜ **egységes policy** minden kritikus path-on: exponential-backoff + jitter + idempotency + max-attempts + Retry-After.

### 2.3 Render cancellation — P1
- [x] ✅ MÁR KÉSZ (natív): [nativeRender.ts](../../src/lib/nativeRender.ts) `signal?: AbortSignal` — `signal.aborted` ellenőrzés + `abort`-listener → `cancelledError()`; a hívás azonnal elengedhető. (Az audit `main`-je elavult volt.) Hátra: a felhő-render-queue job-cancel + temp-cleanup végigvezetése.

### 2.4 UI rollback — P1
- [x] ✅ **Közös helper + bekötés KÉSZ (2026-10-06)**: [src/lib/optimistic.ts](../../src/lib/optimistic.ts) `runOptimistic` (apply azonnal → commit → hibánál rollback + onError; sosem dob, `true/false` a sikerre). Teszt: `optimistic.test.ts` (4 — sorrend + rollback + fire-and-forget). **Bekötve:** a feed like/save ([index.tsx](../../src/app/index.tsx) — az ad-hoc `catch`-ek egységesítve) + **javítva a csatorna-követés bugja** ([channel/[id].tsx](../../src/app/channel/)): a `toggleFollow(...).catch(() => {})` elnyelte a hibát rollback nélkül → a UI tévesen „követed"-et + rossz követő-számot mutatott; most visszagörget.
- [ ] 🟡 Hátra: a maradék ad-hoc optimista helyek migrálása a `runOptimistic`-ra. (A shop-purchase NEM optimista — `onBuy` confirm-after: előbb `purchaseItem`, sikerkor `refreshBalance` → nincs hibás-állapot, rollback nem kell.)

### 2.5 Async race protection — P1
- [x] ✅ **Közös util KÉSZ**: [src/lib/asyncGuard.ts](../../src/lib/asyncGuard.ts) — `createGenerationGuard` (token: csak a legfrissebb válasz megy át) + `createAliveGuard` (unmount után eldob) + `latestOnly` (stale → `StaleResponseError`). Teszt: `asyncGuard.test.ts` (8). Első adopter: [search.tsx](../../src/app/search.tsx) (a korábbi ad-hoc `seqRef` lecserélve a közös utilra).
- [ ] 🟡 Hátra: a többi ad-hoc race-kezelés (más async-betöltő képernyők) migrálása a közös utilra — inkrementális.

### 2.6 Timer cleanup — P1
- [ ] ⬜ CameraRecorder + editor-timeoutok + polling + background-listeners takarítása unmountkor.

### 2.7 Cache limits — P1
- [x] ✅ MÁR KÉSZ: [src/lib/lruCache.ts](../../src/lib/lruCache.ts) (LRU + méret/elem-limit) + teszt (`lruCache.test.ts`) + **6 fogyasztó** (thumbnails/cutlist/visionSearch/beats/transcripts/voiceProxy). (Az audit `main`-je elavult volt.) Hátra: a maradék nem-korlátos cache-ek átállítása + TTL-opció ahol kell.

### 2.8 Event log size — P1
- [x] ~ **Nagyrészt kész (verify-first, az audit elavult)**: az esemény-napló NEM az undo-verem (az a `past`/`future` teljes snapshotjaiban él). A napló a nehéz commandokat **lecsupaszítja** ([eventLog.ts](../../src/lib/eventLog.ts) `isHeavyCommand`/`slimForLog` → klip-csonkok, `slim:true` jelölés) és **capelt** (`EVENT_LIMIT=300`); az undo-verem is **capelt** (`HISTORY_LIMIT=50`). A „korlátlan növekedés / nehéz-snapshot-event" kockázat így kezelt.
- [ ] ⬜ Hátra (nagy, opcionális): patch-alapú undo (strukturális megosztás) a teljes-snapshot helyett a 4K/sok-klipes projektek undo-memóriájára — architekturális, csak ha a mérés indokolja.

### 2.9 Large-file refactor — P1
- [ ] ⬜ `AssistantPanel.tsx` + editor-store szétbontása a `UI → Command → Pure-operation → Store` mentén.

## 3. Kész, ha
Minden hálózati válasz tipizáltan **validált**; a kritikus path-ok egységes retry-policyval mennek;
a render **megszakítható** (takarítással); az optimistic-UI hibánál **rollback**-el; nincs race/
stale-response; a timerek takarítanak; a cache-ek korlátosak; az event-log compact; a nagy fájlok szétbontva.
