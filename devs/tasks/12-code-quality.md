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
- [ ] 🟡 `await res.json() as T` → **unknown → schema-validation → typed** minden kliens-worker híváson (a `parseGuards` kiterjesztése).

### 2.2 Retry / backoff egységesítés — P1
- [ ] 🟡 `netRetry.ts` VAN → ⬜ **egységes policy** minden kritikus path-on: exponential-backoff + jitter + idempotency + max-attempts + Retry-After.

### 2.3 Render cancellation — P1
- [ ] ⬜ `AbortSignal` a local-renderben: `Cancel → AbortController → FFmpeg kill → temp-cleanup → UI-reset`.

### 2.4 UI rollback — P1
- [ ] ⬜ Optimistic-update **rollback**: like/save/follow/shop-purchase hibánál visszaáll.

### 2.5 Async race protection — P1
- [ ] 🟡 Generation-token + alive-guard + request-cancellation + **stale-response reject** (a részben kezelt helyek egységesítése).

### 2.6 Timer cleanup — P1
- [ ] ⬜ CameraRecorder + editor-timeoutok + polling + background-listeners takarítása unmountkor.

### 2.7 Cache limits — P1
- [ ] ⬜ Globális **LRU + max-bytes + max-items + TTL** (a nem-korlátos cache-ek ellen).

### 2.8 Event log size — P1
- [ ] ⬜ A teljes `clips[]` snapshot eventként veszélyes → **patch-events + snapshot-compaction + checkpoint + pruning**.

### 2.9 Large-file refactor — P1
- [ ] ⬜ `AssistantPanel.tsx` + editor-store szétbontása a `UI → Command → Pure-operation → Store` mentén.

## 3. Kész, ha
Minden hálózati válasz tipizáltan **validált**; a kritikus path-ok egységes retry-policyval mennek;
a render **megszakítható** (takarítással); az optimistic-UI hibánál **rollback**-el; nincs race/
stale-response; a timerek takarítanak; a cache-ek korlátosak; az event-log compact; a nagy fájlok szétbontva.
