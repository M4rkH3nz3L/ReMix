# ADR-010 — BYOK task-alapú AI-provider routing

> ↑ [docs/hu index](../README.md) · [architecture/ai.md](../architecture/ai.md)

- **Státusz:** Elfogadva
- **Horgony:** [aiProviders.ts](../../../src/lib/aiProviders.ts)

## Kontextus
Az AI-funkciók futhatnak a mi env-AI-nkon, de a felhasználók egy része a **saját**
modelljét akarja használni (költség, adatvédelem, minőség). Ráadásul a különböző
feladatok (asszisztens vs. auto-edit vs. felirat) más-más modellt kívánhatnak.

## Döntés
**BYOK** (Bring Your Own Key), **task-onként** rendelhető providerrel. A
provider-fajták: `openai` · `anthropic` · `ollama` · `custom`. A feladatok
(`AiTask`): `assistant` · `autoEdit` · `captionStudio` · `hooks` ·
`thumbHeadlines` · `storyStructure`. Az `aiConfigForTask(task)` adja a
kérés-konfigot (a Supabase-ben tárolt provider-sorokból); BYOK hiányában a worker
env-AI-ja a fallback.

## Miért
- A felhasználó a saját költségén/kulcsán futtathat (adatvédelem + kontroll).
- Task-szintű finomhangolás (olcsó modell egyszerű feladatra, erős a nehézre).
- Provider-független réteg → a szolgáltató-váltás egy adapter.

## Elvetett alternatívák
- **Egyetlen, globális modell** — nincs BYOK, nincs task-finomhangolás.
- **Kliens-oldali kulcstárolás kizárólag** — a task-hozzárendelést a szerver
  (Supabase, RLS) authoritatívan tartja; a kulcs [secureStorage](../architecture/storage.md)-ban.

## Következmények
- A profil-UI a `AI_TASKS` sorrendben listázza a hozzárendeléseket.
- A worker `/ai/*` végpontjai provider-függetlenek (env-AI vagy BYOK).

## Kapcsolódó
[ADR-006](./ADR-006-ai-as-command-source.md) · [architecture/ai.md](../architecture/ai.md).
