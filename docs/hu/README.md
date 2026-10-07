# ReMix — magyar fejlesztői dokumentáció

Ez a `docs/hu/` a ReMix **teljes magyar fejlesztői dokumentációja**. A gyökérben
lévő [Arch.md](../../Arch.md) a **capstone** (a rendszer madártávlati térképe);
az itteni fájlok azt bontják rétegenként részletes, **kód-alapú** doksikra.

> **Elv.** Minden állítás a *kódból* van levezetve, fájl:sor horgonyokkal. A
> `docs/architecture/*` a *miért* és a *hogyan* együtt — a feature-listákat és
> fejlesztési terveket ([README.md](../../README.md), [devs/tasks/](../../devs/tasks/))
> és az ops-részleteket ([ops/SERVER.md](../../ops/SERVER.md)) nem ismételjük,
> csak linkeljük.

## Állapot (hol tartunk)

Jelmagyarázat: ✅ kész · 🚧 vázlat, kitöltésre vár

| Dokumentum | Tartalom | Állapot |
|---|---|---|
| [Arch.md](../../Arch.md) | Capstone — a rendszer madártávlatból | ✅ |
| **architecture/** | | |
| [runtime.md](architecture/runtime.md) | New Architecture, Hermes, szálmodell | ✅ |
| [state.md](architecture/state.md) | zustand, session ≠ projekt, autosave | ✅ |
| [commands.md](architecture/commands.md) | A command-szerződés + reducer-invariánsok | ✅ |
| [rendering.md](architecture/rendering.md) | A preview↔render paritás mechanikája | ✅ |
| [ai.md](architecture/ai.md) | Kontextus-építés, whitelist, BYOK-routing | ✅ |
| [networking.md](architecture/networking.md) | Backend-router, Pro-kapu, retry | ✅ |
| [storage.md](architecture/storage.md) | Asset-identitás, relink, providerek | ✅ |
| [collaboration.md](architecture/collaboration.md) | Operation-szinkron terve (cloud_projects) | ✅ |
| [performance.md](architecture/performance.md) | Szál-budget, mesteróra, proxy | ✅ |
| **decisions/** (ADR) | | |
| [ADR-001](decisions/ADR-001-command-bus.md) | Command bus + pure reducer | ✅ |
| [ADR-002](decisions/ADR-002-master-clock.md) | Egy rAF-mesteróra, a playhead a mester | ✅ |
| [ADR-003](decisions/ADR-003-preview-render-parity.md) | Preview közelít, render a mérvadó | ✅ |
| [ADR-004](decisions/ADR-004-capability-gating.md) | On-device = ingyen, felhő = lehet Pro | ✅ |
| [ADR-005](decisions/ADR-005-session-vs-project-state.md) | Session-állapot ≠ projekt-igazság | ✅ |
| [ADR-006](decisions/ADR-006-ai-as-command-source.md) | AI = validált command-forrás | ✅ |
| [ADR-007](decisions/ADR-007-hybrid-render.md) | Hibrid render (lokális · felhő queue) | ✅ |
| [ADR-008](decisions/ADR-008-nondestructive-proxy.md) | Proxy nem-destruktív | ✅ |
| [ADR-009](decisions/ADR-009-backend-router.md) | Egyetlen backend-router | ✅ |
| [ADR-010](decisions/ADR-010-byok-ai-routing.md) | BYOK task-alapú AI-provider routing | ✅ |
| [ADR-011](decisions/ADR-011-fixed-canonical-tracks.md) | Fix kanonikus sávmodell (nem szabad több-lane) | ✅ |
| **development/** | | |
| [coding-standards.md](development/coding-standards.md) | Kódolási szabályok (AGENTS.md-ből) | ✅ |
| [testing.md](development/testing.md) | Tesztelés, `npm run audit` | ✅ |
| [release.md](development/release.md) | EAS build, worker deploy | ✅ |
| [ui-motion-plan.md](development/ui-motion-plan.md) | „Motion-first" fejlesztési terv (pro iOS-editor) | ✅ |
| **kapcsolódó tervek** (repo-gyökér) | | |
| [devs/tasks/remix/](../../devs/tasks/remix/) | 🛡️ Security + production-readiness terv (P0–P2, számozott) | 🚧 |
| [devs/tasks/](../../devs/tasks/) | Stúdió- és platform-fejlesztési tervek (video/audio/image/MISSING) | 🚧 |
| [devs/source/remix.md](../../devs/source/remix.md) | A security-terv forrás-auditja (OWASP ASVS/MASVS/API-Top10) | ✅ |

> **Új fejlesztések (studio-social ág).** Az app a videó-editoron túl **multi-stúdió
> platformmá** nőtt (image/audio stúdiók + Creator OS platform-mag), **social
> réteggel** (fiók=csatorna, feed, remix, üzenetek), **alkotói gazdasággal**
> (shop-marketplace, coin-wallet, Pro-előfizetés) és **auth/RBAC/GDPR** alapokkal.
> Ezek architektúráját az [Arch.md](../../Arch.md) 8–10. szakasza + a
> [README.md](../../README.md) foglalja össze; a hozzájuk tartozó
> production-hardening a [devs/tasks/remix/](../../devs/tasks/remix/).

## Olvasási sorrend új fejlesztőnek

1. [README.md](../../README.md) — mit tud az app, hogyan indul
2. [Arch.md](../../Arch.md) — a rendszer madártávlatból (1–7. szakasz)
3. [architecture/runtime.md](architecture/runtime.md) →
   [state.md](architecture/state.md) → [commands.md](architecture/commands.md) — a **Shared Core**
4. A feature-hez tartozó terv (pl. [devs/tasks/](../../devs/tasks/)) + a vonatkozó
   `architecture/*` fájl
5. [decisions/](decisions/) — *miért* épp így épül a rendszer
6. Production/security előtt: [devs/tasks/remix/00-README](../../devs/tasks/remix/00-README.md)
   — a go-live blokkolók prioritás- és sorrend-mátrixa

## Térkép — melyik doksi mire válaszol

```
runtime      → mi hol futhat (a platform fizikája)
  ├─ state       → hol az igazság (projekt) vs. munkamenet (session)
  │    └─ commands  → hogyan változik az igazság (a bus)
  │         └─ ai        → hogyan ad az AI is commandot
  ├─ rendering   → előnézet közelít, render a mérvadó
  │    └─ performance → a szál-budget, ami mindezt lehetővé teszi
  ├─ networking  → cím + Pro-kapu a felhő felé
  └─ storage / collaboration → hol él és hogyan utazik a projekt
```

## Konvenciók

- **Kód-horgonyok.** Minden fájl `[fájl.ts](../../../src/…)` linkekkel hivatkozik
  a valóságra; ha a kód változik, a doksi is frissül.
- **Nyelv.** A teljes projekt-dokumentáció magyar (kód-kommentekkel egyezően).
- **Diagram.** ASCII a belépéshez; a hosszú életű ábrákat érdemes forrásból
  (Mermaid) generálni, hogy ne rothadjanak el.
