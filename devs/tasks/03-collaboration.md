# 👥 03. Collaboration — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §3. · **Testvér:** [08-storage](./08-storage.md) (shared-media), [04-social](./04-social.md) (RBAC/moderation), [12-code-quality](./12-code-quality.md) (command/event).
> **Érintett kód:** [src/store/editorStore.ts](../../src/store/editorStore.ts) (`setLiveBroadcaster`) · [src/lib/commands.ts](../../src/lib/commands.ts) · [src/app/collab/[id].tsx](../../src/app/collab/) · collab/presence lib + realtime.

---

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
- [ ] ⬜ **Hátra**: a zárak realtime-broadcastja (a collab-csatornán) + a UI-jelző (ki szerkeszti) + az `acquireLock`/`heartbeat` bekötése az `editorStore` szerkesztés-flowjába.

### 2.2 Timeline comments — P1
- [x] ✅ MÁR KÉSZ (az audit `main`-je elavult): [src/lib/collabComments.ts](../../src/lib/collabComments.ts) — `Comment` (**anchor**-horgony a timeline-ra + `authorId` + `resolved` + `mentions` + `parentId` szálak) + `addComment`/`resolveComment`/`reopenComment`/`removeComment` + `roots`/`replies` + `extractMentions`. Tesztelt (`collabComments.test.ts`) + UI ([CommentSheet.tsx](../../src/components/CommentSheet.tsx)).

### 2.3 Review mode — P1
- [ ] ⬜ Reviewer-szerep + **approve / request-changes / reject** + revision-lánc.

### 2.4 Shared media synchronization — P1
- [ ] 🔌 Asset-upload + **shared asset-id** + cloud-asset + **checksum** + download/upload/conflict/offline állapot (lásd [08](./08-storage.md) §8.2).

### 2.5 CRDT / OT — P1 (nagy)
- [ ] ⬜ **Operation-log** + konfliktus-feloldás + deterministic merge + revision-id + optimistic-op + rollback + replay (a last-write-wins kiváltása).

### 2.6 Finom RBAC — P1
- [x] ~ **Nagyrészt kész**: projekt-tag-szerepek [collab.ts](../../src/lib/collab.ts) `CollabRole = owner/editor/viewer` (meghívás + szerep-váltás, owner-védett) + globális governance-RBAC [roles.ts](../../src/lib/roles.ts) (app_permissions/app_roles/user_roles RPC) + content-scoped ownership ([[rbac-roles-permissions]]). (Az audit `main`-je elavult.)
- [ ] ⬜ **Hátra**: a 4. `commenter` szerep + finomabb per-erőforrás permissions (asset/chat/export külön).

## 3. Kész, ha
Két (vagy több) user egyszerre szerkeszt: a klip-zár megakadályozza az ütközést, a kommentek a
timeline-on jelennek meg + resolválhatók, a review-flow jóváhagy/elutasít, a megosztott média
konzisztensen szinkronizál, és a konfliktusok **determinisztikusan** oldódnak (nem adatvesztéssel).
