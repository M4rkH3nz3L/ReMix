import { create } from 'zustand';

import { myMembership, pullSharedProject } from '@/lib/collab';
import { openLiveChannel, type LiveChannel, type LiveParticipant } from '@/lib/collabLive';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import { setLiveBroadcaster, setLockBroadcaster, useEditorStore } from '@/store/editorStore';

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
// 🔒 klip-zár: a kijelölés-követő leiratkozás + a heartbeat/prune időzítő
let lockUnsub: (() => void) | null = null;
let lockTimer: ReturnType<typeof setInterval> | null = null;

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
    // 🔄 join-kori resync: a TAG (nem tulaj) a tulaj FRISS felhő-verzióját húzza —
    // de CSAK ha nincs helyi mentetlen szerkesztése (dirty), így sosem clobberöl.
    // Így konzisztens állapotból indul; a divergenciát az élő parancs-szinkron
    // tartja utána. (A tulaj a forrás, ő nem húz vissza.)
    if (membership.role !== 'owner') {
      const ed = useEditorStore.getState();
      if (ed.project?.id === projectId && !ed.dirty) {
        const fresh = await pullSharedProject(membership.ownerId, projectId).catch(() => null);
        const now = useEditorStore.getState();
        // a pull alatt nem kezdett-e szerkeszteni / másik projektre váltani?
        if (fresh && now.project?.id === projectId && !now.dirty) {
          now.loadProject(fresh);
        }
      }
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
        // 🔒 távoli klip-zár esemény → a command-buson kívüli zár-térkép frissítése
        onLock: (msg) => useEditorStore.getState().applyRemoteLock(msg),
      }
    );
    // a saját szerkesztések + klip-zárak innentől broadcastolódnak
    setLiveBroadcaster((commands) => channel?.broadcast(commands));
    setLockBroadcaster((msg) => channel?.sendLock(msg));
    useEditorStore.getState().setCollabSelf({ id: me.id, name });
    // 🔒 a KIJELÖLT klipre zárat kérünk (ki szerkeszti), a korábbit feloldjuk;
    // ha más tartja (élő), az acquire no-op → a UI jelzi a zárat (nem lopunk).
    let lockedClip: string | null = null;
    const syncLock = (sel: string | null) => {
      if (sel === lockedClip) {
        return;
      }
      if (lockedClip) {
        useEditorStore.getState().releaseClipLock(lockedClip);
      }
      lockedClip = sel;
      if (sel) {
        useEditorStore.getState().acquireClipLock(sel);
      }
    };
    lockUnsub = useEditorStore.subscribe((state, prev) => {
      if (state.selectedClipId !== prev.selectedClipId) {
        syncLock(state.selectedClipId);
      }
    });
    syncLock(useEditorStore.getState().selectedClipId);
    // életjel + takarítás: a saját zár frissül (broadcast), az elavultak kiesnek
    lockTimer = setInterval(() => {
      const ed = useEditorStore.getState();
      ed.pruneClipLocks();
      if (lockedClip) {
        ed.acquireClipLock(lockedClip); // heartbeat (acquiredAt marad, heartbeatAt frissül)
      }
    }, 10_000);
    set({ active: true, ownerId: membership.ownerId, projectId, participants: [] });
  },

  stop: () => {
    setLiveBroadcaster(null);
    setLockBroadcaster(null);
    lockUnsub?.();
    lockUnsub = null;
    if (lockTimer) {
      clearInterval(lockTimer);
      lockTimer = null;
    }
    useEditorStore.getState().setCollabSelf(null); // üríti a zár-térképet is
    channel?.stop();
    channel = null;
    cursors.clear();
    set({ active: false, ownerId: null, projectId: null, participants: [] });
  },

  sendCursor: (playhead) => {
    channel?.sendCursor(playhead);
  },
}));
