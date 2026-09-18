# Tesztelés

> Forrás: [Arch.md](../../../Arch.md) 11. szakasz + [package.json](../../../package.json) +
> a kód. ↑ [docs/hu index](../README.md)

## 1. A merge-kapu

```bash
npm run audit    # = tsc --noEmit  +  expo lint  +  jest
```

Külön is:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint (a szándékos hook-kivételekkel)
npm test            # jest
npm run test:watch  # jest --watch
```

Konfiguráció: [jest.config.js](../../../jest.config.js) +
[jest.setup.js](../../../jest.setup.js) (jest-expo preset).

## 2. Mit tesztelünk — és miért ott

A tesztek az **expo-mentes magokra** ülnek: ezek tiszta függvények, így gyorsan
és megbízhatóan tesztelhetők a natív réteg nélkül. Meglévő teszt-magok:

| Terület | Mag |
|---|---|
| Idő/frame | [frames.test.ts](../../../src/lib/frames.test.ts), [keyframes.test.ts](../../../src/lib/keyframes.test.ts) |
| Vágás | [trimEdit.test.ts](../../../src/lib/trimEdit.test.ts), [rangeEdit.test.ts](../../../src/lib/rangeEdit.test.ts), [projectUtils.test.ts](../../../src/lib/projectUtils.test.ts) |
| Kompozíció | [preCompose.test.ts](../../../src/lib/preCompose.test.ts), [trackPlan.test.ts](../../../src/lib/trackPlan.test.ts) |
| Infra | [lruCache.test.ts](../../../src/lib/lruCache.test.ts), [netRetry.test.ts](../../../src/lib/netRetry.test.ts), [secureStorage.test.ts](../../../src/lib/secureStorage.test.ts), [eventLog.test.ts](../../../src/lib/eventLog.test.ts) |
| Egyéb | [captionFormats.test.ts](../../../src/lib/captionFormats.test.ts), [parseGuards.test.ts](../../../src/lib/parseGuards.test.ts), [safeZone.test.ts](../../../src/lib/safeZone.test.ts), [cancel.test.ts](../../../src/lib/cancel.test.ts), [autoVersion.test.ts](../../../src/lib/autoVersion.test.ts) |
| Worker | [server/billing.test.js](../../../server/billing.test.js), [server/ssrf.test.js](../../../server/ssrf.test.js) |

**Új teszt helye:** `src/**/*.test.ts` (kliens) vagy `server/**/*.test.js` (worker).

## 3. A típus-rendszer mint folyamatos audit

Nem minden ellenőrzés jest-teszt. A [capabilities.ts](../../../src/lib/capabilities.ts)
`{ where, pro }` diszkriminált uniója **fordítási hibát** ad a tiltott
kombinációra ([ADR-004](../decisions/ADR-004-capability-gating.md)) — vagyis a
`tsc --noEmit` maga is üzleti-szabály-audit.

## 4. Amit érdemes elképzelni tesztnek (a magok mellett)

- **Kontraktus-tesztek** a `*Client.ts` ↔ `server/*.js` séma-egyezésére, hogy a
  felhő-verzióváltás ne törjön csendben ([Arch.md 12. szakasz](../../../Arch.md), P2).
- **Reducer-tulajdonságok:** `applyCommand` idempotencia/`null`-szemantika a
  `commands` magon.

## 5. Elv

A **nehéz logikát a `lib/` magba told** ([coding-standards.md](./coding-standards.md)) —
akkor tesztelhető. Ha egy komponensben van a vágó-matek, előbb emeld ki.
