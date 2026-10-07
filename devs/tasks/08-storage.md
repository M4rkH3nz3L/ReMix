# 🗄️ 08. Storage / Asset Management — P1 (a régi MISSING.md ezen része részben ELAVULT)

> **Forrás:** [audit](../source/audit-2026-10-main.md) §8. · **Testvér:** [03-collaboration](./03-collaboration.md) (shared-media), [06-video-editor](./06-video-editor.md) (`uri→assetId`), security-backlog `05`.
> **Érintett kód:** `src/lib/storageProviders.ts` · `src/lib/videdFile.ts` (→ `.remix`) · [server/s3store.js](../../server/s3store.js) · [server/userStorage.js](../../server/userStorage.js) · [src/lib/storage.ts](../../src/lib/storage.ts).

---

> **📊 Haladás (2026-10-07):** ✅ 2 teljes · 🟡 4 mag kész · ⬜ 2 nyitva — Σ 8 tétel.
> **R2 = élő platform-tár** + provider-IO timeout/retry (§2.1) · **forrás-mappa** (§2.8) · **OneDrive-adapter**
> (§2.3) KÉSZ; az **asset-állapotgép** (§2.2), a **fájl-konfliktus** (§2.6) és a **WebDAV/S3-hardening** (§2.4)
> magja/alapja kész. Hátra: a mélyebb folyamok (uri→assetId, base-hash) + .ReMix-doksi (§2.5) + collab-jogok (§2.7).

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
- [x] ✅ **Provider-IO hardening: timeout + retry (2026-10-07)**: worker [netFetch.js](../../server/netFetch.js) (`fetchWithTimeout` + `fetchRetry` — átmeneti hibára: 408/425/429/5xx + dobás, CSAK idempotens kérésnél, exponenciális backoff) bekötve a külső-tár OAuth-provider **metaadat/auth-hívásaiba** ([userStorage.js](../../server/userStorage.js): token-csere időkorláttal, Drive/Dropbox listázás timeout+retry). A streamelő/feltöltő hívások SZÁNDÉKOSAN érintetlenek (nagy fájl ne szakadjon meg a timeouttól). Teszt: `netFetch.test.js` (6). Audit zöld (124 suite / 1338 teszt).
- [ ] 🟡 Hátra (infra): prod **custom domain + CORS** (ma `r2.dev` dev-URL, rate-limitelt) + a WebDAV/S3 **reconnect** (§2.4) + EU-jurisdiction, ha GDPR-residency kell.

### 2.2 Asset state machine — P1
- [x] ✅ **Állapotgép-mag + teszt**: [src/lib/assetState.ts](../../src/lib/assetState.ts) — `AssetState` (`external/cached/imported/stale/invalidated`) + `assetStateOf` (a valós Asset-mezőkből: provider + localAvailable + remoteChanged + invalidated) + `nextState`/`canTransition` átmenet-tábla (download/import/evict/invalidate/remoteChanged/refresh) + `isLocallyAvailable`/`needsFetch`. Teszt: `assetState.test.ts` (8) — fő életciklus + eviction/stale/invalidation + tiltott átmenetek.
- [x] ✅ **UI-állapotjelző KÉSZ (2026-10-07)**: a SZINKRON megjelenítés-állapot ([assetState.ts](../../src/lib/assetState.ts) `assetDisplayState` a provider+uri-ból + `assetStateBadge` → ikon/i18n/tone: **☁️ external / ✓ cached/imported / ⚠️ stale**) a projekt forrás-mappájában ([SourceSheet](../../src/components/SourceSheet.tsx)) minden assetnél látszik. Teszt: `assetState.test.ts` (+3 — localAvailable/displayState/badge). Audit zöld (123 suite / 1329 teszt).
- [x] ✅ **Letöltés + eviction a binben KÉSZ (2026-10-07)**: külső (felhő) forrás letöltése HELYI másolatként ([media.ts](../../src/lib/media.ts) `downloadToCache` → `ADD_ASSET`) a forrás-mappa „⬇ Letöltés" gombjával ([SourceSheet](../../src/components/SourceSheet.tsx), csak `canDownload`-állapotnál), az eviction a meglévő `REMOVE_ASSET` (nem-használt forrás). Akció-politika: [assetState.ts](../../src/lib/assetState.ts) `canDownload`/`canEvict`. Teszt: `assetState.test.ts` (+2). Audit zöld (124 suite / 1339 teszt).
- [ ] 🔌 Hátra: a HELYBEN-transzformáló state-gép-folyam (external→cached UGYANAZON asseten, **klip-propagációval**) — ez a **uri→assetId** refaktoron múlik ([06](./06-video-editor.md) §2.10); + offline-cache-politika (auto-evict hely-nyomásra).

### 2.3 Drive / Dropbox / OneDrive / S3 — P1
- [x] ✅ **OneDrive adapter KÉSZ (2026-10-07)**: Microsoft Graph-alapú provider ([userStorage.js](../../server/userStorage.js) `onedriveListMedia`/`onedriveStream`/`onedriveUpload` + OAuth-config, a Drive/Dropbox-mintára) bekötve mindhárom switchbe (list/stream/upload); kliens-oldalon connect-gomb + `OAuthProviderType` ([externalStorage.ts](../../src/lib/externalStorage.ts), [StorageCard](../../src/components/profile/StorageCard.tsx)). **Env-kapuzott** (`MS_OAUTH_CLIENT_ID/SECRET` — kulcs nélkül beszédes hiba). Audit zöld (124/1339). Élesítés: Azure-app-kulcsok (mint a Drive/Dropbox — a live-OAuth integrációs, nem unit-teszt).

### 2.4 WebDAV / NAS hardening — P1
- [x] ✅ **Timeout + retry (reconnect) KÉSZ (2026-10-07)**: a WebDAV PROPFIND-olvasás a §2.1-es `netFetch`-en át (az SSRF-védett `safeFetch`-et `fetchImpl`-ként injektálva → 10s timeout + retry átmeneti hibára, a privát-IP/NAS-védelem megmarad); az S3-kliensen ([storage.js](../../server/storage.js)) socket/connect-timeout (`NodeHttpHandler`, guardolt import → fallback a SDK-defaultra) + `maxAttempts: 3`. Audit zöld (124/1339).
- [ ] ⬜ Hátra: credentials-lifecycle (token-frissítés/újra-bejelentkezés) + version-detect (ETag/Last-Modified) + offline-handling (a §2.6 base-hash-sel összeér).

### 2.5 `.ReMix` projektfájl egységesítés — P1 (doksi)
- [ ] 🟡 A `videdFile.ts` `.remix`-et ad → **egységesíteni** a doksit + konvenciót a hivatalos `.ReMix`/`.remix` formátumra ([13](./13-documentation.md)).

### 2.6 External file versioning — P1
- [x] ✅ **Konfliktus-detektáló mag KÉSZ (2026-10-06)**: [src/lib/fileConflict.ts](../../src/lib/fileConflict.ts) — 3-utas összevetés (lokális · távoli · közös ŐS) → `syncState` (`in-sync`/`local-only`/`remote-only`/`local-ahead`/`remote-ahead`/`conflict`/`absent`; base NÉLKÜL az eltérés KONFLIKTUS, nem találgat irányt → nincs csendes felülírás) + `resolutionActions` (a `Use new / Keep current / Compare` gombok állapotonként) + `needsAttention`/`isAutoResolvable`. Teszt: `fileConflict.test.ts` (12).
- [x] ✅ **Sync-állapot UI-jelző + akció-címkék KÉSZ (2026-10-07)**: [fileConflict.ts](../../src/lib/fileConflict.ts) `assetSyncState` (a valós uri+remoteUrl-ből) + `syncStateBadge` (ikon/i18n/tone) + `syncActionLabelKey` (a §8.6 gombokhoz); a forrás-mappa ([SourceSheet](../../src/components/SourceSheet.tsx)) a helyi, még-nem-mentett forrásokat **„nincs mentve"** figyelmeztetéssel jelzi (backup-dimenzió, a §2.2 availability-badge mellett). i18n `sync.*`. Teszt: `fileConflict.test.ts` (+3). Audit zöld (123 suite / 1332 teszt).
- [ ] 🔌 Hátra: a **bázis-hash tárolása** (az Asseten, mentéskor) + a letöltés/feltöltés-IO + a `syncState` VALÓS hash-alapú számítása (mediaSync/storageProviders) + az interaktív „Use new / Keep current / Compare" feloldó-UI (a `resolutionActions`-re kötve) — ez a sync-folyam integráció.

### 2.7 Collaborative storage permissions — P1
- [ ] ⬜ project / personal / shared storage + **asset-level** permissions (összeér [03](./03-collaboration.md) §2.4-gyel).

### 2.8 Projekt forrás-mappa (source bin) — P1
- [x] ✅ **KÉSZ e2e (2026-10-07)**: a `project.assets` köré épült, MINDEN stúdióban egységes forrás-mappa. [src/lib/projectSource.ts](../../src/lib/projectSource.ts) (`supportedSourceKinds` fajtánként + `pickSourceAsset` picker→Asset + `assetInUse` törlés-véd + `sourceSummary`) + új **`REMOVE_ASSET`** command (undo) + közös [SourceSheet](../../src/components/SourceSheet.tsx) (böngészés + támogatott import + nem-használt törlése). **Bekötve: létrehozáskor** (New-Project űrlap, minden fajta) + **mindhárom editorban** (kép→fotó-réteg · hang→music-klip · videó→idővonal). Teszt: `projectSource.test.ts` (7). Audit zöld (121 suite / 1313 teszt).
- [ ] 🟡 Hátra: a forrás-mappa feltöltése a projekt R2-tárába (backup) + nagy-bin virtualizáció + mappák/címkék.

## 3. Kész, ha
Egy külső asset végigmegy az **External→Cached→Imported** állapotgépen (offline/stale kezeléssel),
a remote-változás verziózottan feloldható, az OneDrive is elérhető a provider-interfészen, és a
megosztott storage asset-szintű jogosultságokkal védett. A projektfájl-formátum egységes + dokumentált.
