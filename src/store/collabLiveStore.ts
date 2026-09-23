import { create } from 'zustand';

import { myMembership } from '@/lib/collab';
import { openLiveChannel, type LiveChannel, type LiveParticipant } from '@/lib/collabLive';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import { setLiveBroadcaster, useEditorStore } from '@/store/editorStore';

/**
 * 👥 Élő kollaboráció store — a szerkesztő nyitja egy projektre. Ha a projekt
 * MEGOSZTOTT (myMembership), realtime csatornát nyit: presence (résztvevők) +
 * a lokális command-ok broadcastja + a távoli command-ok visszajátszása a
 * command buson (`'remote'` actor → nincs echo). Nem megosztott projektnél no-op.
 */

interface CollabLiveState {
  active: boolean;
  ownerId: string | null;
  projectId: string | null;
  /** a többi résztvevő (én nélkülem), presence szerint */
  participants: LiveParticipant[];
  start: (projectId: string) => Promise<void>;
  stop: () => void;
  sendCursor: (playhead: number) => void;
}

let channel: LiveChannel | null = null;
const cursors = new Map<string, number>();

export const useCollabLive = create<CollabLiveState>((set, get) => ({
  active: false,
  ownerId: null,
  projectId: null,
  participants: [],

  start: async (projectId) => {
    if (get().active && get().projectId === projectId) {
      return; // már fut erre a projektre
    }
    get().stop();
    const me = useAuth.getState().user;
    if (!me?.id) {
      return;
    }
    const membership = await myMembership(projectId).catch(() => null);
    if (!membership) {
      return; // nem megosztott projekt → nincs élő collab
    }
    // saját denormalizált adatok (a presence-hez)
    let name = me.email?.split('@')[0] ?? 'Én';
    let avatar: string | null = null;
    if (supabase) {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', me.id)
        .maybeSingle();
      name = (data?.full_name as string | undefined) || name;
      avatar = (data?.avatar_url as string | undefined) ?? null;
    }
    // közben nem zártuk-e / váltottunk-e projektet?
    if (get().projectId && get().projectId !== projectId) {
      return;
    }
    const topic = `collab-live:${membership.ownerId}:${projectId}`;
    channel = openLiveChannel(
      topic,
      { id: me.id, name, avatar },
      {
        onCommands: (cmds) => {
          const ed = useEditorStore.getState();
          if (cmds.length === 1) {
            ed.dispatch(cmds[0], 'remote');
          } else {
            ed.applyBatch(cmds, 'remote');
          }
        },
        onPresence: (list) => {
          const others = list
            .filter((p) => p.id !== me.id)
            .map((p) => ({ ...p, playhead: cursors.get(p.id) ?? 0 }));
          set({ participants: others });
        },
        onCursor: (id, playhead) => {
          cursors.set(id, playhead);
          set((s) => ({
            participants: s.participants.map((p) => (p.id === id ? { ...p, playhead } : p)),
          }));
        },
      }
    );
    // a saját szerkesztések innentől broadcastolódnak
    setLiveBroadcaster((commands) => channel?.broadcast(commands));
    set({ active: true, ownerId: membership.ownerId, projectId, participants: [] });
  },

  stop: () => {
    setLiveBroadcaster(null);
    channel?.stop();
    channel = null;
    cursors.clear();
    set({ active: false, ownerId: null, projectId: null, participants: [] });
  },

  sendCursor: (playhead) => {
    channel?.sendCursor(playhead);
  },
}));
