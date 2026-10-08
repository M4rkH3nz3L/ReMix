# ADR-012 — Asset-architektúra: `uri → assetId` (az asset a forrás-igazság)

> ↑ [docs/hu index](../README.md) · [architecture/state.md](../architecture/state.md)

- **Státusz:** Elfogadva, fokozatos bevezetés (2026-10-08) — Fázis 1 + 2a kész (mag + determinisztikus backfill bekötve)
- **Horgony:** [assetResolve.ts](../../../src/lib/assetResolve.ts) (`assetForClip`/`resolveClipUri`/`relinkAsset`/`ensureClipAssets`) ·
  [projectUtils.ts](../../../src/lib/projectUtils.ts) (`migrateToV2` asset-registry) · [06-video-editor §2.10](../../../devs/tasks/06-video-editor.md) · [12-code-quality](../../../devs/tasks/12-code-quality.md)

## Kontextus
A klipek ma **nyers `uri`-t** hordoznak (a `VideoClip`/`ImageClip`/`AudioClip`
`uri` mezeje az elsődleges, amit a preview/render közvetlenül olvas). A
`project.assets` registry + a klipeken lévő `assetId?` már létezik (a v1→v2
migráció `uri` szerint felépíti és linkeli), **de a fogyasztók nem az asseten át
oldják fel az URI-t**, és több add-clip út (`creatorPreset`, `AssistantPanel`,
`audioExtract`, hang-stem) `assetId` NÉLKÜL ad hozzá klipet. A relink
(`relinkUri`) régi-uri-string szerint cserél, nem asset-id szerint.

Ez a terv #1 technikai fókusza (00-README §0): **`uri → assetId`** — a média
egyetlen forrás-igazsága az asset legyen, mert erre épül a collab, az undo, az
AI-kontextus és a cloud-sync (egy relink/upload → minden rá hivatkozó klip).

## Döntés
**Az ASSET a média forrás-igazsága; a klipek `assetId`-vel hivatkoznak rá, és a
lejátszandó URI-t az asseten át oldják fel.** A bevezetés **fokozatos +
backward-compatible**:

1. **Fázis 1 (ez az ADR — KÉSZ):** pure mag + teszt (`assetResolve.test.ts`, 13 eset);
   a klip `uri` mezeje MEGMARAD *feloldott cache*-ként (a mai preview/render változatlanul működik):
   - `assetForClip(project, clip)` — klip → asset (`assetId`, visszaesés uri-egyezésre).
   - `resolveClipUri(project, clip)` — a klip lejátszandó URI-ja az asseten át
     (visszaesés a klip saját uri-jára).
   - `relinkAsset(project, assetId, newUri)` — **egy hívás → minden rá hivatkozó
     klip** (az asset uri-ja + a linkelt klipek uri-cache-e szinkronban).
   - `ensureClipAssets(project)` — idempotens backfill: a linkeletlen media-klipek
     `assetId`-t kapnak (uri szerint find-or-create), **determinisztikus** `assetIdForUri`-vel.
2. **Fázis 2a (KÉSZ):** `ensureClipAssets` **bekötve a `migrateProject` végére** (verzió-
   független, minden betöltéskor fut), `assetIdForUri` determinisztikus id-vel → a séma-
   migráció utáni utakon (preset/AI/hang-leválasztás) assetId nélkül hozzáadott klipek is
   linkelnek, a round-trip + collab determinizmus sértése nélkül (az arany-út teszt igazolja).
4. **Fázis 2b (következő):** a fogyasztók (preview/pip/audio/render-plan/proxy,
   `findMissingMedia`) a `resolveClipUri`-ra állnak → a klip `uri`-ja már csak cache.
5. **Fázis 3:** a relink/cloud-sync/collab az asset-registryre épül
   (`relinkAsset` + asset-id-alapú upload); a klip `uri` elhagyható (vagy csak cache).

### Determinizmus-megkötés (miért tartalom-címzett a backfill id-je)
A backfill/ingest **nem használhat `makeId` (véletlen) asset-id-t** sem a betöltő
úton (`migrateProject`), sem a reducerben: ugyanazt a (linkeletlen) projektet kétszer
betöltve eltérő asset-id-t adna → (a) elromlana a **bitre-azonos mentés→újratöltés**
round-trip (a `CORE §2.9` arany-út tesztje ezt ki is szúrta), (b) **collab-divergencia**
(a replay más id-t adna kliensenként). Ezért a backfill a **determinisztikus, tartalom-címzett
`assetIdForUri`-t** használja (`ast_<FNV-1a(uri)>`), ami kliensek közt is egyezik. A
parancs-épített assetek id-je továbbra is a **command-építéskor** rögzül és a commandban
utazik (az `ADD_CLIP { asset }` már így működik), nem a reducerben.

> ⚠️ **Fázis 3 collab-él:** ha két kliens UGYANARRA az uri-ra párhuzamosan hoz létre
> assetet KÜLÖNBÖZŐ úton (pl. forrás-bin `makeId`-s asset vs. backfill `assetIdForUri`),
> két asset keletkezhet egy fájlra. A registry collab-sync tervezésekor (Fázis 3) ez
> merge-stratégiát kíván; egyetlen kliensen a `byUri` dedup ezt már most kizárja.

## Miért
- **Egy forrás, egy relink:** egy médiafájl újracsatolása/felhő-feltöltése egy
  helyen történik (az asset), és minden rá hivatkozó klip automatikusan követi.
- **Collab/undo/AI/cloud alapja:** a stabil `assetId` a megosztott hivatkozás; az
  AI-kontextus és a creative-graph (`projectsUsingAsset`) már id-ben gondolkodik.
- **Kockázat-minimum:** a Fázis 1 additív — a klip `uri` cache marad, a preview/
  render egy sort sem változik, a backfill idempotens (nincs churn).

## Elvetett alternatíva
- **„Big-bang" refaktor** (minden fogyasztó egyszerre a resolverre + a klip `uri`
  azonnali elhagyása) — lánc-széles, a fragilis preview/render-utat vakon írná át,
  vizuális verifikáció nélkül (a szerkesztő a prod-login mögött). A fázisos út
  minden lépése külön tesztelhető + visszagörgethető.
- **Auto-ingest a reducerben** (`addClips` `makeId`-del) — collab-divergenciát
  okozna (replay → eltérő id); helyette a command-építés rögzíti az id-t, a
  backfill pedig lokális betöltés-lépés.

## Következmények
- Új add-clip út → a commandba `asset`-et is adjon (collab-biztos id); a backfill
  a hálót jelenti, de ne arra hagyatkozzunk elsődlegesen.
- A Fázis 2 fogyasztó-migráció a `resolveClipUri`-t vezeti be — klipenként/réteg­enként, tesztelve.
- A `relinkUri` (uri-first) megmarad a Fázis 2-ig; utána a `relinkAsset` váltja.

## Kapcsolódó
[ADR-001](./ADR-001-command-bus.md) (minden mutáció a buson) · [ADR-008](./ADR-008-nondestructive-proxy.md) ·
[ADR-009](./ADR-009-backend-router.md) · [06-video-editor §2.10](../../../devs/tasks/06-video-editor.md) · [08-storage](../../../devs/tasks/08-storage.md).
