# Storage — asset-identitás, relink, providerek

> Forrás: [Arch.md](../../../Arch.md) 7. + 9.5 szakasz +
> [videdFile.ts](../../../src/lib/videdFile.ts) · [fingerprint.ts](../../../src/lib/fingerprint.ts) ·
> [storageProviders.ts](../../../src/lib/storageProviders.ts). ↑ [docs/hu index](../README.md)

## 1. Az alapelv: asset ≠ klip

A projekt **hivatkozik** a médiára, nem birtokolja
([types/project.ts](../../../src/types/project.ts) `Asset`). A klip `uri`-ja
denormalizált gyorsítás; az igazi identitás az **ujjlenyomat**. Ezért egy projekt
átvihető gépek közt: a nyers fájl máshol lehet, a hivatkozás **relinkelhető**.

## 2. Asset-identitás — md5 + méret

[fingerprint.ts](../../../src/lib/fingerprint.ts):

- `fingerprintFile(uri)` → `{ md5, size }` egy fájlra.
- `withFingerprints(project)` → a projekt minden assetjét ujjlenyomatozza
  (feltöltés/relink előtt). A méret gyors előszűrő, az md5 az igazolás.

## 3. Hordozható projektfájl (`.ReMix`) + relink

[videdFile.ts](../../../src/lib/videdFile.ts) — a projekt + asset-referenciák
(nyers média nélkül), verziózva (`VIDED_FORMAT`):

```
  Export:  shareVidedFile(project)      → .ReMix (asset-ujjlenyomatokkal)
  Import:  pickAndParseVided()          → ImportResult (validálás + séma-migráció)
             │
             ├─ findMissingMedia(project)      → MissingMedia[]
             ├─ findAutoRelinkPairs(...)        → RelinkPair[]   (tartalom-egyezés: méret→md5)
             ├─ autoRelink(...)                 → a talált párok bekötése
             └─ pickRelinkPairs(missing)        → tételenkénti kézi választó a maradékra
```

A **Collect Project** (worker `/collect`) a projektet + minden médiát egyetlen
zipbe csomagol (`project.ReMix` + `media/`, relatív uri-kkal) — archiváláshoz.

## 4. StorageProvider-gateway — forrás-független média

[storageProviders.ts](../../../src/lib/storageProviders.ts) — a **Tár** panel
mögötti absztrakció: a klip-hozzáadás nem tudja, honnan jön a média.

- **`StorageProvider` interfész** → `StorageEntry` (böngészés) + `resolveMedia()`
  → `ResolvedMedia { uri, provider }` (`local` | `library` | `remote`).
- **Beépített:** `serverLibraryProvider` (a worker `/library` mappája).
- **Távoli:** `remoteSourceProvider(source)` — a worker storage-gateway-én
  konfigurált források ([server/storage.js](../../../server/storage.js): **WebDAV**
  NAS/Nextcloud + **S3**-kompatibilis; a hitelesítés a **workeren marad**,
  auth-proxyval — a kliens sosem látja).
- **Futásidejű összeállítás:** `loadStorageProviders()` = beépítettek + a
  gateway-forrásai; worker nélkül csendben a beépítettekkel megy tovább.

> **Bővítés:** új forrás-típus (Drive/S3/…) = egy új adapter a listában — a panel
> és a klip-hozzáadás változatlan.

## 5. Helyi tárolás

- **Projekt-draft:** [storage.ts](../../../src/lib/storage.ts) — AsyncStorage,
  ~0,8 mp autosave-debounce ([state.md](./state.md)).
- **Titkos adat:** [secureStorage.ts](../../../src/lib/secureStorage.ts) — tokenek,
  BYOK-kulcsok (expo-secure-store); tesztelt mag (`secureStorage.test.ts`).
- **Proxy-cache:** [proxy.ts](../../../src/lib/proxy.ts) — determinisztikus kulcsú
  (fájlnév+méret) lemez-cache (`Documents/proxies`); nem kerül a projekt-JSON-ba
  ([ADR-008](../decisions/ADR-008-nondestructive-proxy.md)).
- **Cache-kezelés:** [cacheManager.ts](../../../src/lib/cacheManager.ts),
  [lruCache.ts](../../../src/lib/lruCache.ts) (filmstrip/waveform).

## 6. Felhő-tárhely (Pro)

- **Projekt felhő-sync:** [cloudSync.ts](../../../src/lib/cloudSync.ts) —
  `pushProject()` / `pullProject()` a Supabase `cloud_projects`-be (Pro:
  `cloudSync` capability, [networking.md](./networking.md)).
- **Média-feltöltés:** [upload.ts](../../../src/lib/upload.ts) → worker
  `/media/upload` → Supabase Storage bucketek (media/videos/posters) a
  cross-device lejátszáshoz/feedhez.

## 7. Kapcsolódások

- A proxy nem-destruktivitása → [ADR-008](../decisions/ADR-008-nondestructive-proxy.md)
- A felhő-kapu → [networking.md](./networking.md)
- A megosztott (kollaborációs) projekt → [collaboration.md](./collaboration.md)
