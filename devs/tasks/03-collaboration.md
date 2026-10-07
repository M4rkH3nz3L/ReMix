# 👥 03. Collaboration — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §3. · **Testvér:** [08-storage](./08-storage.md) (shared-media), [04-social](./04-social.md) (RBAC/moderation), [12-code-quality](./12-code-quality.md) (command/event).
> **Érintett kód:** [src/store/editorStore.ts](../../src/store/editorStore.ts) (`setLiveBroadcaster`) · [src/lib/commands.ts](../../src/lib/commands.ts) · [src/app/collab/[id].tsx](../../src/app/collab/) · collab/presence lib + realtime.

---

> **📊 Haladás (2026-10-07):** ✅ 2 teljes · 🟡 3 mag kész · ⬜ 1 nyitva — Σ 6 tétel.
> A **clip-lock most realtime + UI-val KÉSZ** (§2.1: zár-broadcast + „ki szerkeszti" badge + heartbeat),
> a timeline-komment (§2.2) kész; a review/media-sync/RBAC magja kész (bekötés hátra); nyitva a
> determinisztikus **CRDT/OT** (§2.5).

## 0. Kontextus & cél
A **collaboration-mag jó** (presence + live command-sync a command-buson). Ami hiányzik: a
**production-grade** együtt-szerkesztés — zárolás, komment, review, megosztott média, és a
determinisztikus konfliktus-feloldás (ma last-write-wins).

## 1. Jelenlegi állapot (bizonyíték)
- Presence + élő parancs-broadcast működik (az `editorStore` `setLiveBroadcaster` kampójával).
- A projekt-JSON szinkronizálható, de **nincs** clip-lock, timeline-comment, review, CRDT/OT, finom RBAC.

## 2. Feladatlista

### 2.1 Clip locking — P1
- [x] ✅ **Zár-mag + teszt**: [src/lib/clipLock.ts](../../src/lib/clipLock.ts) — `ClipLock` (owner + `acquiredAt`/`heartbeatAt`) + `LOCK_TTL_MS` + `isStale`/`isLockedByOther`/`canEdit` + `acquireLock` (szabad/elavult/saját → megszerezhető, más élő → null) + `heartbeat` + `LockMap` (`withLock`/`releaseLock`/`pruneStale` — stale-recovery). Teszt: `clipLock.test.ts` (10). A szerkesztés `canEdit` ellen ellenőriz.
- [x] ✅ **Realtime-zár + UI + bekötés KÉSZ (2026-10-07)**: a zárak broadcastja a collab-csatornán ([collabLive.ts](../../src/lib/collabLive.ts) `lock`-event + [collabLiveStore.ts](../../src/store/collabLiveStore.ts)); a `clipLock` **session-réteg** (`applyLockBroadcast` **first-come-wins** ütközés-feloldással + `editableByMe`/`locksByOthers`); az `editorStore` zár-slice (`clipLocks` + `acquireClipLock`/`releaseClipLock`/`pruneClipLocks` + `canEditClip`); a kijelölés automatikusan zárat kér (más élő zárát NEM lopja el) + 10 mp heartbeat/prune; és a **„ki szerkeszti" UI-jelző** a timeline-klipen ([TimelineClip.tsx](../../src/components/editor/TimelineClip.tsx): tulaj-színű 🔒 + név). Teszt: `clipLock.test.ts` (+5, determinisztikus ütközéssel). Audit: 122 suite / 1324 teszt zöld.
- [ ] ⬜ Opcionális: KEMÉNY edit-guard (a más által zárolt klip szerkesztő-parancsainak tiltása — ma a badge + az acquire-no-op véd, a dispatch nincs blokkolva; a `canEditClip` selector készen áll hozzá).

### 2.2 Timeline comments — P1
- [x] ✅ MÁR KÉSZ (az audit `main`-je elavult): [src/lib/collabComments.ts](../../src/lib/collabComments.ts) — `Comment` (**anchor**-horgony a timeline-ra + `authorId` + `resolved` + `mentions` + `parentId` szálak) + `addComment`/`resolveComment`/`reopenComment`/`removeComment` + `roots`/`replies` + `extractMentions`. Tesztelt (`collabComments.test.ts`) + UI ([CommentSheet.tsx](../../src/components/CommentSheet.tsx)).

### 2.3 Review mode — P1
- [x] ~ **Nagyrészt kész**: a verzió-státuszgép [src/lib/versions.ts](../../src/lib/versions.ts) (`draft → review → approved → published → archived` + `canTransition`/`nextStatuses`) lefedi a review-flowt (approve = review→approved, **request-changes** = review→draft, reject = →archived); tesztelt + lineage/compare ([[versions-core]]). (Az audit `main`-je elavult.)
- [ ] ⬜ Hátra: dedikált **reviewer-szerep** + review-UI (jóváhagy/változtatás-kér gombok) a collab-nézetben.

### 2.4 Shared media synchronization — P1
- [x] ~ **Nagyrészt kész**: [src/lib/mediaSync.ts](../../src/lib/mediaSync.ts) — `mediaRemoteMap` (shared remote-URL) + `needsBackup` (checksum/hash) + `backupProjectMedia` (upload) + `restoreMissingMedia` (download/relink). (Az audit `main`-je elavult.)
- [ ] ⬜ Hátra: explicit download/upload/**conflict/offline** állapotok — a [08 §2.2 asset-state-machine](./08-storage.md) (`assetState.ts`) bekötésével.

### 2.5 CRDT / OT — P1 (nagy)
- [ ] ⬜ **Operation-log** + konfliktus-feloldás + deterministic merge + revision-id + optimistic-op + rollback + replay (a last-write-wins kiváltása).

### 2.6 Finom RBAC — P1
- [x] ~ **Nagyrészt kész**: projekt-tag-szerepek [collab.ts](../../src/lib/collab.ts) `CollabRole = owner/editor/viewer` (meghívás + szerep-váltás, owner-védett) + globális governance-RBAC [roles.ts](../../src/lib/roles.ts) (app_permissions/app_roles/user_roles RPC) + content-scoped ownership ([[rbac-roles-permissions]]). (Az audit `main`-je elavult.)
- [ ] ⬜ **Hátra**: a 4. `commenter` szerep + finomabb per-erőforrás permissions (asset/chat/export külön).

## 3. Kész, ha
Két (vagy több) user egyszerre szerkeszt: a klip-zár megakadályozza az ütközést, a kommentek a
timeline-on jelennek meg + resolválhatók, a review-flow jóváhagy/elutasít, a megosztott média
konzisztensen szinkronizál, és a konfliktusok **determinisztikusan** oldódnak (nem adatvesztéssel).
