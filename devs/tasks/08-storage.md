# 🗄️ 08. Storage / Asset Management — P1 (a régi MISSING.md ezen része részben ELAVULT)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §8. · **Testvér:** [03-collaboration](./03-collaboration.md) (shared-media), [06-video-editor](./06-video-editor.md) (`uri→assetId`), security-backlog `05`.
> **Érintett kód:** `src/lib/storageProviders.ts` · `src/lib/videdFile.ts` (→ `.remix`) · [server/s3store.js](../../server/s3store.js) · [server/userStorage.js](../../server/userStorage.js) · [src/lib/storage.ts](../../src/lib/storage.ts).

---

> **📊 Haladás (2026-10-07):** ✅ 1 teljes · 🟡 3 mag kész · ⬜ 4 nyitva — Σ 8 tétel.
> **Cloudflare R2 = a platform ÉLŐ média-tárhelye** (§2.1 R2-út kész+tesztelve; a prod-hardening hátra) +
> a **projekt forrás-mappa KÉSZ** (§2.8, minden stúdióban). Az **asset-állapotgép** (§2.2) és a
> **fájl-konfliktus** (§2.6) magja kész — a bekötésük + UI, az OneDrive-adapter és a prod-hardening hátra.

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
- [x] ✅ **Cloudflare R2 = a platform ÉLŐ média-tárhelye (2026-10-07)**: a meglévő S3-adapter ([s3store.js](../../server/s3store.js)) az R2-t szolgálja ki — `STORAGE_BACKEND=r2` → az R2-út az ELSŐDLEGES (megelőzi a Supabase service_role-t, [mediastore.js](../../server/mediastore.js)) + `S3_PUBLIC_STYLE=domain` → publikus URL bucket-szegmens nélkül. **End-to-end tesztelve** (feltöltés + publikus GET 200 + S3 visszaolvasás a `remix` bucketbe). Setup: `devs/cloudflare-r2-setup-prompt.md`.
- [ ] 🟡 Hátra: teljes provider-abstrakció **prod-hardening** (timeout/retry/reconnect) + prod **custom domain + CORS** (ma `r2.dev` dev-URL, rate-limitelt) + EU-jurisdiction, ha GDPR-residency kell.

### 2.2 Asset state machine — P1
- [x] ✅ **Állapotgép-mag + teszt**: [src/lib/assetState.ts](../../src/lib/assetState.ts) — `AssetState` (`external/cached/imported/stale/invalidated`) + `assetStateOf` (a valós Asset-mezőkből: provider + localAvailable + remoteChanged + invalidated) + `nextState`/`canTransition` átmenet-tábla (download/import/evict/invalidate/remoteChanged/refresh) + `isLocallyAvailable`/`needsFetch`. Teszt: `assetState.test.ts` (8) — fő életciklus + eviction/stale/invalidation + tiltott átmenetek.
- [x] ✅ **UI-állapotjelző KÉSZ (2026-10-07)**: a SZINKRON megjelenítés-állapot ([assetState.ts](../../src/lib/assetState.ts) `assetDisplayState` a provider+uri-ból + `assetStateBadge` → ikon/i18n/tone: **☁️ external / ✓ cached/imported / ⚠️ stale**) a projekt forrás-mappájában ([SourceSheet](../../src/components/SourceSheet.tsx)) minden assetnél látszik. Teszt: `assetState.test.ts` (+3 — localAvailable/displayState/badge). Audit zöld (123 suite / 1329 teszt).
- [ ] ⬜ Hátra: a letöltés/eviction-**FOLYAM** bekötése a [storageProviders.ts](../../src/lib/storageProviders.ts)-be a `nextState` mentén (tényleges download/evict) + offline-cache-politika — a mag + a jelző már kész.

### 2.3 Drive / Dropbox / OneDrive / S3 — P1
- [ ] ✅ Drive/Dropbox/WebDAV/S3 megvan → ⬜ **OneDrive adapter** hozzáadása (a meglévő provider-interfészre).

### 2.4 WebDAV / NAS hardening — P1
- [ ] 🟡 Alap kész → ⬜ credentials-lifecycle + reconnect + timeout + version-detect + offline-handling.

### 2.5 `.ReMix` projektfájl egységesítés — P1 (doksi)
- [ ] 🟡 A `videdFile.ts` `.remix`-et ad → **egységesíteni** a doksit + konvenciót a hivatalos `.ReMix`/`.remix` formátumra ([13](./13-documentation.md)).

### 2.6 External file versioning — P1
- [x] ✅ **Konfliktus-detektáló mag KÉSZ (2026-10-06)**: [src/lib/fileConflict.ts](../../src/lib/fileConflict.ts) — 3-utas összevetés (lokális · távoli · közös ŐS) → `syncState` (`in-sync`/`local-only`/`remote-only`/`local-ahead`/`remote-ahead`/`conflict`/`absent`; base NÉLKÜL az eltérés KONFLIKTUS, nem találgat irányt → nincs csendes felülírás) + `resolutionActions` (a `Use new / Keep current / Compare` gombok állapotonként) + `needsAttention`/`isAutoResolvable`. Teszt: `fileConflict.test.ts` (12).
- [ ] 🖼️🔌 Hátra: a bázis-hash tárolása + a flow bekötése (mediaSync/storageProviders a `syncState` köré) + a konfliktus-UI (a `resolutionActions` gombjaival).

### 2.7 Collaborative storage permissions — P1
- [ ] ⬜ project / personal / shared storage + **asset-level** permissions (összeér [03](./03-collaboration.md) §2.4-gyel).

### 2.8 Projekt forrás-mappa (source bin) — P1
- [x] ✅ **KÉSZ e2e (2026-10-07)**: a `project.assets` köré épült, MINDEN stúdióban egységes forrás-mappa. [src/lib/projectSource.ts](../../src/lib/projectSource.ts) (`supportedSourceKinds` fajtánként + `pickSourceAsset` picker→Asset + `assetInUse` törlés-véd + `sourceSummary`) + új **`REMOVE_ASSET`** command (undo) + közös [SourceSheet](../../src/components/SourceSheet.tsx) (böngészés + támogatott import + nem-használt törlése). **Bekötve: létrehozáskor** (New-Project űrlap, minden fajta) + **mindhárom editorban** (kép→fotó-réteg · hang→music-klip · videó→idővonal). Teszt: `projectSource.test.ts` (7). Audit zöld (121 suite / 1313 teszt).
- [ ] 🟡 Hátra: a forrás-mappa feltöltése a projekt R2-tárába (backup) + nagy-bin virtualizáció + mappák/címkék.

## 3. Kész, ha
Egy külső asset végigmegy az **External→Cached→Imported** állapotgépen (offline/stale kezeléssel),
a remote-változás verziózottan feloldható, az OneDrive is elérhető a provider-interfészen, és a
megosztott storage asset-szintű jogosultságokkal védett. A projektfájl-formátum egységes + dokumentált.
