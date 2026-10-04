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
- [ ] ⬜ Lock-owner + **TTL + heartbeat** + release + **stale-lock recovery**; a szerkesztés a lock ellen ellenőriz.

### 2.2 Timeline comments — P1
- [ ] ⬜ `project/track/clip/timestamp/author/resolved` modell + UI (pin a timeline-ra) + resolve-flow.

### 2.3 Review mode — P1
- [ ] ⬜ Reviewer-szerep + **approve / request-changes / reject** + revision-lánc.

### 2.4 Shared media synchronization — P1
- [ ] 🔌 Asset-upload + **shared asset-id** + cloud-asset + **checksum** + download/upload/conflict/offline állapot (lásd [08](./08-storage.md) §8.2).

### 2.5 CRDT / OT — P1 (nagy)
- [ ] ⬜ **Operation-log** + konfliktus-feloldás + deterministic merge + revision-id + optimistic-op + rollback + replay (a last-write-wins kiváltása).

### 2.6 Finom RBAC — P1
- [ ] 🟡 `OWNER/EDITOR/COMMENTER/VIEWER` + külön project/asset/chat/export/invite permissions (a meglévő RBAC-ra építve).

## 3. Kész, ha
Két (vagy több) user egyszerre szerkeszt: a klip-zár megakadályozza az ütközést, a kommentek a
timeline-on jelennek meg + resolválhatók, a review-flow jóváhagy/elutasít, a megosztott média
konzisztensen szinkronizál, és a konfliktusok **determinisztikusan** oldódnak (nem adatvesztéssel).
