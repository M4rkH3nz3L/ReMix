import { create } from 'zustand';

import {
  listMembers,
  myRole as fetchMyRole,
  subscribeMembers,
  type CollabRole,
  type ProjectMember,
} from '@/lib/collab';

/**
 * 👥 Kollaboráció-store — az ÉPPEN nézett projekt taglistája + a saját szerep,
 * REALTIME frissítéssel. A Studio-képernyő nyitja/zárja; a taglista változásaira
 * (meghívás/szerep-váltás/eltávolítás) automatikusan újratölt.
 */

interface CollabState {
  ownerId: string | null;
  projectId: string | null;
  members: ProjectMember[];
  role: CollabRole | null;
  loading: boolean;
  error: string | null;
  /** projekt megnyitása: taglista + szerep betöltése + realtime feliratkozás */
  open: (ownerId: string, projectId: string) => Promise<void>;
  /** újratöltés (realtime-változás vagy manuális művelet után) */
  refresh: () => Promise<void>;
  /** bezárás: leiratkozás + ürítés */
  close: () => void;
}

let unsub: (() => void) | null = null;

async function load(ownerId: string, projectId: string) {
  const [members, role] = await Promise.all([
    listMembers(ownerId, projectId),
    fetchMyRole(ownerId, projectId),
  ]);
  return { members, role };
}

export const useCollab = create<CollabState>((set, get) => ({
  ownerId: null,
  projectId: null,
  members: [],
  role: null,
  loading: false,
  error: null,

  open: async (ownerId, projectId) => {
    if (unsub) {
      unsub();
      unsub = null;
    }
    set({ ownerId, projectId, loading: true, error: null, members: [], role: null });
    try {
      const { members, role } = await load(ownerId, projectId);
      set({ members, role, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
    // realtime: bármely tagsági változásnál újratöltés
    unsub = subscribeMembers(projectId, () => {
      void get().refresh();
    });
  },

  refresh: async () => {
    const { ownerId, projectId } = get();
    if (!ownerId || !projectId) {
      return;
    }
    try {
      const { members, role } = await load(ownerId, projectId);
      set({ members, role });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  close: () => {
    if (unsub) {
      unsub();
      unsub = null;
    }
    set({ ownerId: null, projectId: null, members: [], role: null, loading: false, error: null });
  },
}));
