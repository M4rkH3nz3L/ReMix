# AI — az AI mint validált command-forrás

> Forrás: [Arch.md](../../../Arch.md) 10. szakasz +
> [aiCommands.ts](../../../src/lib/aiCommands.ts) · [ai.ts](../../../src/lib/ai.ts) ·
> [aiProviders.ts](../../../src/lib/aiProviders.ts) · [server/ai.js](../../../server/ai.js).
> ↑ [docs/hu index](../README.md)

## 1. Az anti-cél

> **Az AI sosem írja közvetlenül a state-et vagy a React-komponenst.** Egy
> **command-forrás**, semmi több: `EditorCommand`-ot ad, amit a
> [bus](./commands.md) validál és undo-zhatóan futtat
> ([ADR-006](../decisions/ADR-006-ai-as-command-source.md)).

Ezért az AI *ugyanolyan* szerkesztő, mint a felhasználó — csak az `actor: 'ai'`
más ([commands.md](./commands.md) 7. pont).

## 2. A lánc

```
  buildAiContext()          rétegzett, TÖMÖR kontextus (NEM a teljes projekt-JSON):
  (aiCommands.ts)           project(cél) · tracks(röviden) · current(playhead/kijelölés)
        │                   · recentActions(utolsó 15 esemény, ember-olvashatóan)
        ▼
  askAssistant()  ─────────▶  worker POST /ai/assist   ──▶  whitelist-parancsok
  (ai.ts)                     { context, instruction, aiConfig }   (zod-séma)
        │  health-check: ha nincs env-AI ÉS nincs BYOK → beszédes hiba
        ▼
  toEditorCommands()        PATCHABLE_FIELDS whitelist; ismeretlen mező kiesik;
  (aiCommands.ts)           szövegklip TELJES klippé egészül; aiReason provenancia
        │
        ▼
  applyBatch(commands, 'ai')   ← egy köteg = EGY undo-lépés
```

## 3. Rétegzett kontextus — miért nem a teljes projekt

A `buildAiContext()` ([aiCommands.ts](../../../src/lib/aiCommands.ts)) **nem** a
nyers projekt-JSON-t küldi (token-drága és zajos), hanem négy réteget:

- **project** — név, típus, képarány, hossz (a cél)
- **tracks** — csak a nem üres sávok, klipenként `clipBrief()` (id, kind, start,
  duration + fajta-specifikus lényeg: szövegnél a `text`, videónál `speed/filter`…)
- **current** — `playhead`, `selectedClipId`
- **recentActions** — az utolsó 15 esemény ember-olvashatóan (`describeCommand`) →
  ez az **AI-memória**, amit az [esemény-napló](./state.md) táplál

## 4. A whitelist — a kliens–AI szerződés

A worker akármit küldhet; a kliens **csak** a biztonságosat engedi be:

- **`AiCommand` típusok:** `UPDATE_CLIP`, `REMOVE_CLIP`, `SPLIT_CLIP`,
  `ADD_TEXT_CLIPS`, `SET_ASPECT`, `RENAME_PROJECT`.
- **`PATCHABLE_FIELDS`** — az AI által módosítható mezők halmaza (start, duration,
  text, szín, fontSize, position, animation, stylePreset, speed, volume, filterId,
  fade, opacity, trimIn, transitionOut, adjust); minden más **kiesik**.
- **Új szövegklip** → teljes `TextClip`-pé egészül (id, biztonságos default-ok,
  clamp-elt hossz/méret) + `aiReason` provenancia.

> **Ez szerződés.** A whitelist bővítése = a kliens–AI interfész változása →
> **ADR-t érdemel** ([commands.md](./commands.md) 8. pont).

## 5. Action preview + provenancia

- **`describeAiCommand()`** — a felhasználó az **alkalmazás ELŐTT** tételesen
  látja, mi fog változni (nem „vakon" fut az AI).
- **`aiReason`** — a klipre írt indok („miért van ez itt?"), a naplóban `ai:`
  actorral → visszakövethető, ki (user vagy AI) mit csinált.

## 6. BYOK — task-alapú provider-routing

A felhasználó **saját modellje** ([aiProviders.ts](../../../src/lib/aiProviders.ts),
[ADR-010](../decisions/ADR-010-byok-ai-routing.md)):

- **Provider-fajták:** `openai` · `anthropic` · `ollama` · `custom`.
- **Task-onként rendelhető** (`AiTask`): `assistant` · `autoEdit` ·
  `captionStudio` · `hooks` · `thumbHeadlines` · `storyStructure`. A
  `aiConfigForTask(task)` adja a kérés-konfigot (Supabase-ben tárolt
  provider-sorokból: `user_ai_providers` + `user_ai_task_providers` migrációk).
- **Fallback:** ha nincs BYOK, a worker env-AI-ja megy; ha egyik sincs → beszédes
  hiba (`askAssistant` health-check).

## 7. AI-funkciók a workeren

A `/ai/*` végpontok ([server/ai.js](../../../server/ai.js)): `assist`, `autoedit`,
`story`, `highlights`, `translate`, `captionstudio`, `hooks`, `thumbheadlines`.
Provider-független (env-AI vagy BYOK). A **Pro-kapu** végpontonként dől el
([capabilities.ts](../../../src/lib/capabilities.ts), [networking.md](./networking.md)):
pl. az `autoEdit` `proOnly`, de a `thumbheadlines`/`captionstudio` nem.

## 8. Kapcsolódások

- A közös bus, amin az AI is fut → [commands.md](./commands.md)
- A kontextus forrása (esemény-napló) → [state.md](./state.md)
- A worker-kapu → [networking.md](./networking.md)
- Döntések → [ADR-006](../decisions/ADR-006-ai-as-command-source.md) ·
  [ADR-010](../decisions/ADR-010-byok-ai-routing.md)
