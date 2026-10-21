# ADR-013 — Tárhely-szintek: Free = eszközön (lokál), Fizetős = R2 (mért)

> ↑ [docs/hu index](../README.md) · [ADR-012](./ADR-012-asset-id-architecture.md) (asset-arch)

- **Státusz:** Elfogadva (2026-10-09)
- **Horgony:** [storagePolicy.ts](../../../src/lib/storagePolicy.ts) · [cloudSync.ts](../../../src/lib/cloudSync.ts) (backup-gate) ·
  [storageQuota.ts](../../../src/lib/storageQuota.ts) + [server/quota.js](../../../server/quota.js) (mérés) ·
  [StorageCard](../../../src/components/profile/StorageCard.tsx) (UI) · [08-storage](../../../devs/tasks/08-storage.md)

## Kontextus
Kellett egy **világos, szakszerű tárhely-modell** a free vs fizetős szintre, mert
a free-média eddig csendben a MI R2-tárunkra ment (kvóta-alapon), és a felhasználó
**nem kapott tájékoztatást** arról, hogy mi történik az adataival. Konkrét eset: egy
free projekt lokális médiafájljai eltűntek az eszközről (app-törlés / tárhely-ürítés),
és a user nem tudta, hogy nem volt felhő-biztonsági háló.

## Döntés
**Free = a média a FELHASZNÁLÓ ESZKÖZÉN marad; Fizetős (Pro+) = a média R2-re
mentődik, szerver-hitelesen mérve.**

1. **Free:**
   - A média **NEM** töltődik fel automatikusan a MI R2-tárunkra (`canCloudBackupMedia('free') === false`,
     a [cloudSync](../../../src/lib/cloudSync.ts) `backupProjectToCloud` kihagyja a `backupProjectMedia`-t).
   - A projekt-**TERV (JSON)** felhő-mentése MEGMARAD (adatbiztonság, HYBRID-szabály — a terv kicsi, olcsó).
   - A szerkesztő **proaktívan figyelmeztet** (`projectMediaSafety(project).atRisk` → banner): „a média csak az
     eszközön van, törléskor elveszik — Pro-val felhő-mentés". A banner a `mediaBackup` capability paywallját nyitja.
   - A user SAJÁT külső tára (Drive/Dropbox/WebDAV/S3) ettől független: ha beállít aktív célt, a szerver oda ment
     (nem a mi kvótánkra) — ez a free „hozd a saját felhődet" útja.
2. **Fizetős (Pro+):**
   - A média **auto-backup R2-re** (`backupProjectMedia` → `/media/upload` → `mediastore` R2-backend).
   - A foglalt bájt **szerver-hitelesen** mérve: `wouldExceed` (elő-ellenőrzés) + `record_storage_object_for`
     (atomi napló + kvóta-enforcement) a `storage_objects` táblába; a `storage_usage` aggregál.
   - A használat a profil **StorageCard**-ján látszik (used / quota + koinos havi boost).
   - **Beárazás-alap:** `storageBillingBasis(usedBytes, includedBytes, coinPerGBMonth)` → a befoglaltságon felüli,
     díjköteles GB (determinisztikus, tesztelt). A tényleges árat a termék később rögzíti — a MÉRÉS már kész és pontos.

## Miért
- **Őszinteség + bizalom:** a free-user TUDJA, hogy a média lokális és veszélyeztetett → nem éri meglepetés.
- **Költség-kontroll:** a free-tömeg médiája nem terheli a MI R2-számlánkat; a felhő-tár a fizetős érték.
- **Pontos árazás:** a Pro-használat bájtra mérve, így az árazás valós fogyasztáson alapul (nem becslés).
- **A meglévő infra újrahasznosítva:** a kvóta-rendszer (`storage_objects`/`storage_usage`/boost) és a tier-modell
  (`tiers.ts`) adott volt — ez az ADR a **politikát** teszi explicitté + gatelt + tájékoztatóvá.

## Elvetett alternatíva
- **Free is kap kis R2-kvótát (1 GiB) auto-backuppal** — ezt a user-direktíva elvetette (free = eszközön);
  a kis ingyenes kvóta amúgy is hamis biztonságérzetet adna (1 GiB felett néma lokál-only).
- **Néma free-lokál (figyelmeztetés nélkül)** — ez volt a hibás kiindulás (adatvesztés magyarázat nélkül).

## Következmények
- A `MEDIA_BACKUP_MIN_TIER = 'pro'` (és a `mediaBackup` capability `minTier: 'pro'`) egy helyen állítható, ha a
  termék a „fizetős"-t basicre nyitja.
- A Pro→Free visszaesés: a már R2-n lévő (remoteUrl-es) média MARAD (nem töröljük), de új média már lokál-only.
- A tényleges egységár rögzítésekor a `storageBillingBasis` adja a számítási alapot (overage × ráta).

## Kapcsolódó
[ADR-012](./ADR-012-asset-id-architecture.md) (asset = forrás-igazság, remoteUrl az asseten) ·
[ADR-004](./ADR-004-capability-gating.md) (capability-gating) · [08-storage](../../../devs/tasks/08-storage.md) · [02-monetization](../../../devs/tasks/02-monetization.md).
