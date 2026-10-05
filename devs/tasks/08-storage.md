# 🗄️ 08. Storage / Asset Management — P1 (a régi MISSING.md ezen része részben ELAVULT)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §8. · **Testvér:** [03-collaboration](./03-collaboration.md) (shared-media), [06-video-editor](./06-video-editor.md) (`uri→assetId`), security-backlog `05`.
> **Érintett kód:** `src/lib/storageProviders.ts` · `src/lib/videdFile.ts` (→ `.remix`) · [server/s3store.js](../../server/s3store.js) · [server/userStorage.js](../../server/userStorage.js) · [src/lib/storage.ts](../../src/lib/storage.ts).

---

## 0. Kontextus & cél
Fontos audit-jegyzet: a repo **már tartalmaz** `StorageProvider` interfészt + külső-storage
implementációkat — ezért a régi MISSING.md ezen része elavult. A valódi hiány: az **asset-
életciklus** (állapotgép), **versioning**, **OneDrive**, és a prod-hardening.

## 1. Jelenlegi állapot (bizonyíték)
- `storageProviders.ts` LÉTEZIK; Google Drive / Dropbox / WebDAV / S3 adapter VAN.
- Per-projekt byte-ledger + user-kvóta + aktív-cél-választó VAN (prod-migrációk élnek).
- `videdFile.ts` már **`.remix`** fájlt ad (a doksi helyenként `.vided`-et említ).
- Hiány: explicit asset-state-machine, external-file-versioning, **OneDrive adapter**, collab-permissions.

## 2. Feladatlista

### 2.1 StorageProvider hardening — P1
- [ ] 🟡 Upload + lifecycle + teljes provider-abstrakció + **prod-hardening** (timeout/retry/reconnect).

### 2.2 Asset state machine — P1
- [x] ✅ **Állapotgép-mag + teszt**: [src/lib/assetState.ts](../../src/lib/assetState.ts) — `AssetState` (`external/cached/imported/stale/invalidated`) + `assetStateOf` (a valós Asset-mezőkből: provider + localAvailable + remoteChanged + invalidated) + `nextState`/`canTransition` átmenet-tábla (download/import/evict/invalidate/remoteChanged/refresh) + `isLocallyAvailable`/`needsFetch`. Teszt: `assetState.test.ts` (8) — fő életciklus + eviction/stale/invalidation + tiltott átmenetek.
- [ ] ⬜ **Hátra**: bekötés a [storageProviders.ts](../../src/lib/storageProviders.ts)-be (letöltés/eviction a `nextState` mentén) + UI-jelző (☁️ external / ✓ cached) + offline-cache-politika.

### 2.3 Drive / Dropbox / OneDrive / S3 — P1
- [ ] ✅ Drive/Dropbox/WebDAV/S3 megvan → ⬜ **OneDrive adapter** hozzáadása (a meglévő provider-interfészre).

### 2.4 WebDAV / NAS hardening — P1
- [ ] 🟡 Alap kész → ⬜ credentials-lifecycle + reconnect + timeout + version-detect + offline-handling.

### 2.5 `.ReMix` projektfájl egységesítés — P1 (doksi)
- [ ] 🟡 A `videdFile.ts` `.remix`-et ad → **egységesíteni** a doksit + konvenciót a hivatalos `.ReMix`/`.remix` formátumra ([13](./13-documentation.md)).

### 2.6 External file versioning — P1
- [ ] ⬜ `Remote changed → Use new / Keep current / Compare` flow (konfliktus-UI).

### 2.7 Collaborative storage permissions — P1
- [ ] ⬜ project / personal / shared storage + **asset-level** permissions (összeér [03](./03-collaboration.md) §2.4-gyel).

## 3. Kész, ha
Egy külső asset végigmegy az **External→Cached→Imported** állapotgépen (offline/stale kezeléssel),
a remote-változás verziózottan feloldható, az OneDrive is elérhető a provider-interfészen, és a
megosztott storage asset-szintű jogosultságokkal védett. A projektfájl-formátum egységes + dokumentált.
