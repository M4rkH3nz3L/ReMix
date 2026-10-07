# 🧱 12. Code quality / robustness — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §12, §14. · **Testvér:** [06-video-editor](./06-video-editor.md) (command/asset), [03-collaboration](./03-collaboration.md) (event-log), [13-documentation](./13-documentation.md) (contract-tesztek).
> **Érintett kód:** [src/lib/parseGuards.ts](../../src/lib/parseGuards.ts) · `src/lib/netRetry.ts` · `AssistantPanel.tsx` · [src/store/editorStore.ts](../../src/store/editorStore.ts) · [server/](../../server/) (render-cancel).

---

> **📊 Haladás (2026-10-06):** ✅ 0 teljes · 🟡 7 mag kész · ⬜ 2 nyitva — Σ 9 tétel.
> A robusztussági magok **nagyrészt kész + bekötve** (validáció / retry / cancel / rollback / race /
> cache / event-log — sok csak inkrementális adopció-farokkal); hátra a **timer-cleanup** (§2.6)
> és a **nagy-fájl-szétbontás** (§2.9).

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
- [x] ✅ **Kritikus kliensek migrálva (2026-10-06)**: [billing.ts](../../src/lib/billing.ts) (`proUntil` → `str(asRecord(...))`), [colorClient.ts](../../src/lib/colorClient.ts) (stats/pixel/scope → `asRecord`+`finiteNum`/`str`, nem a try/catch-re bízva a null-derefet), [externalStorage.ts](../../src/lib/externalStorage.ts) — kiemelt **pure** `parseConnectedProviders` + `parseStorageEntries` (`mapValid` elemenkénti validálással: hibás elem kiesik, null-body sem omlik) + a `readError`/OAuth-start hardening. Teszt: `externalStorage.test.ts` (7 — hibás/hiányos elem kiesik, null → []).
- [ ] 🟡 **Hátra**: a maradék fájlok `res.json() as T` castjainak inkrementális migrálása (feed/chat/other clients).

### 2.2 Retry / backoff egységesítés — P1
- [x] ✅ **Policy KÉSZ + tesztelt (verify-first, az audit elavult)**: [netRetry.ts](../../src/lib/netRetry.ts) — exponential-backoff **cappel** (`MAX_DELAY_MS`) + **full jitter** (`base*(0.5+random*0.5)`, thundering-herd ellen) + `Retry-After` (sec ÉS HTTP-dátum, felső korláttal) + `isRetryableStatus` (408/425/429/5xx) + abort-tudatos + `attempts` (max-attempts) + **idempotencia-tudatos** (`retryRead` CSAK olvasásra; a docstring kimondja, hogy a nem-idempotens POST-ot nem szabad). Teszt: `netRetry.test.ts`.
- [x] ~ **Adopció a kritikus pathokon (szándékosan SZELEKTÍV)**: `render.ts` a status-pollt (`/render/:id`) + `/music`-ot `fetchRead`-del retry-zi, a job-**submitet** (POST) szándékosan NEM (kettős-submit ellen); `schedules`/`stickers3d`/`tts` is adoptál. A health-**probe** (`aiHealth.ts`) szándékosan fail-fast (egy indikátor ne lógjon 12 mp-et, ha a provider tényleg le van).
- [ ] 🟡 Hátra: a maradék idempotens olvasó-pathok eseti felmérése (nem minden read-et érdemes retry-zni).

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
