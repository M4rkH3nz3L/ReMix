import type { EditorCommand } from '@/lib/commands';
import { supabase } from '@/lib/supabase';

/**
 * 👥 Élő kollaboráció REALTIME csatornája — presence (ki van bent) + broadcast
 * (command-ok és kurzor). A projekt-JSON forrása továbbra is a `cloud_projects`
 * (mentés/betöltés); EZ a réteg csak az ÉLŐ eseményeket viszi:
 *
 *  • `presence`: mindenki „track"-eli magát (id/név/avatar) → a résztvevők listája;
 *  • `broadcast 'cmd'`: a szerializálható EditorCommand(ok) — a távoli oldal az
 *    ugyanazon `applyCommand`-dal alkalmazza (a store `'remote'` actorral, hogy ne
 *    broadcastolja vissza → nincs echo);
 *  • `broadcast 'cursor'`: a lejátszófej pozíciója (könnyű, nem perzisztens).
 *
 * A `broadcast: { self: false }` miatt a saját üzeneteket nem kapjuk vissza.
 */

export interface LiveSelf {
  id: string;
  name: string;
  avatar: string | null;
}

export interface LiveParticipant {
  id: string;
  name: string;
  avatar: string | null;
  color: string;
  playhead: number;
}

export interface LiveHandlers {
  onCommands: (commands: EditorCommand[]) => void;
  onPresence: (participants: LiveParticipant[]) => void;
  onCursor?: (id: string, playhead: number) => void;
}

export interface LiveChannel {
  broadcast: (commands: EditorCommand[]) => void;
  sendCursor: (playhead: number) => void;
  stop: () => void;
}

// stabil, jól elkülönülő színek a résztvevőknek (id-hash alapján)
const PALETTE = ['#7c5cff', '#ff5c8a', '#ffb020', '#22c55e', '#38bdf8', '#f472b6'];
export function colorForUser(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface PresenceMeta {
  id: string;
  name: string;
  avatar: string | null;
}

export function openLiveChannel(
  topic: string,
  self: LiveSelf,
  handlers: LiveHandlers
): LiveChannel {
  const sb = supabase;
  if (!sb) {
    return { broadcast: () => {}, sendCursor: () => {}, stop: () => {} };
  }
  const channel = sb.channel(topic, {
    config: { presence: { key: self.id }, broadcast: { self: false } },
  });

  const readPresence = () => {
    const state = channel.presenceState() as Record<string, PresenceMeta[]>;
    const list: LiveParticipant[] = [];
    for (const key of Object.keys(state)) {
      const meta = state[key]?.[0];
      if (!meta?.id) {
        continue;
      }
      list.push({
        id: meta.id,
        name: meta.name,
        avatar: meta.avatar ?? null,
        color: colorForUser(meta.id),
        playhead: 0,
      });
    }
    handlers.onPresence(list);
  };

  channel
    .on('broadcast', { event: 'cmd' }, ({ payload }) => {
      const cmds = (payload?.commands ?? []) as EditorCommand[];
      if (Array.isArray(cmds) && cmds.length > 0) {
        handlers.onCommands(cmds);
      }
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (payload && typeof payload.id === 'string' && typeof payload.playhead === 'number') {
        handlers.onCursor?.(payload.id, payload.playhead);
      }
    })
    .on('presence', { event: 'sync' }, readPresence)
    .on('presence', { event: 'join' }, readPresence)
    .on('presence', { event: 'leave' }, readPresence)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ id: self.id, name: self.name, avatar: self.avatar } satisfies PresenceMeta);
      }
    });

  return {
    broadcast: (commands) => {
      void channel.send({ type: 'broadcast', event: 'cmd', payload: { commands } });
    },
    sendCursor: (playhead) => {
      void channel.send({ type: 'broadcast', event: 'cursor', payload: { id: self.id, playhead } });
    },
    stop: () => {
      void sb.removeChannel(channel);
    },
  };
}
