/**
 * 🧱 collab-slice — élő klip-zárak (realtime kollaboráció).
 *
 * A zár-állapot session-szintű (nem kerül a projektbe). A zár-broadcast a
 * `broadcasters` modulon át megy (laza csatolás; a store nem ismeri a hálót).
 */
import {
  acquireLock,
  applyLockBroadcast,
  editableByMe,
  pruneStale,
  releaseLock,
  withLock,
  type LockMap,
} from '@/lib/clipLock';

import { getLockBroadcaster } from '../broadcasters';
import type { EditorState } from '../editorState';
import type { EditorSlice } from './types';

type CollabSlice = Pick<
  EditorState,
  | 'clipLocks'
  | 'collabSelf'
  | 'setCollabSelf'
  | 'applyRemoteLock'
  | 'acquireClipLock'
  | 'releaseClipLock'
  | 'pruneClipLocks'
  | 'canEditClip'
>;

export const createCollabSlice: EditorSlice<CollabSlice> = (set, get) => ({
  clipLocks: {} as LockMap,
  collabSelf: null,

  // ── 🔒 collab klip-zár (realtime) ─────────────────────────────────────────
  setCollabSelf: (self) => set({ collabSelf: self, clipLocks: self ? get().clipLocks : {} }),

  applyRemoteLock: (msg) =>
    set((s) => ({ clipLocks: applyLockBroadcast(s.clipLocks, msg, Date.now()) })),

  acquireClipLock: (clipId) => {
    const self = get().collabSelf;
    if (!self) {
      return; // nincs élő collab → nincs zárolás
    }
    const now = Date.now();
    const next = acquireLock(get().clipLocks[clipId], clipId, self.id, now, self.name);
    if (!next) {
      return; // más tartja (élő) → nem szerezhető meg
    }
    set((s) => ({ clipLocks: withLock(pruneStale(s.clipLocks, now), next) }));
    getLockBroadcaster()?.({ type: 'set', clipId, ownerId: self.id, lock: next });
  },

  releaseClipLock: (clipId) => {
    const self = get().collabSelf;
    if (!self) {
      return;
    }
    set((s) => ({ clipLocks: releaseLock(s.clipLocks, clipId, self.id) }));
    getLockBroadcaster()?.({ type: 'release', clipId, ownerId: self.id });
  },

  pruneClipLocks: () => set((s) => ({ clipLocks: pruneStale(s.clipLocks, Date.now()) })),

  canEditClip: (clipId) => {
    const self = get().collabSelf;
    if (!self) {
      return true; // nincs collab → nincs zár-korlát
    }
    return editableByMe(get().clipLocks, clipId, self.id, Date.now());
  },
});
