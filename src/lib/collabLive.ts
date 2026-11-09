import type { LockBroadcast } from '@/lib/clipLock';
import type { EditorCommand } from '@/lib/commands';
import { supabase } from '@/lib/supabase';
import { logCaught } from '@/lib/logCaught';

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
  /** 🔒 klip-zár esemény (más szerkesztő zárolt/feloldott egy klipet) */
  onLock?: (msg: LockBroadcast) => void;
}

export interface LiveChannel {
  broadcast: (commands: EditorCommand[]) => void;
  sendCursor: (playhead: number) => void;
  /** 🔒 saját klip-zár/feloldás broadcastja a többieknek */
  sendLock: (msg: LockBroadcast) => void;
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
    return { broadcast: () => {}, sendCursor: () => {}, sendLock: () => {}, stop: () => {} };
  }
  // 🛡️ A realtime-kliens `channel(topic)` a MÁR LÉTEZŐ azonos topicú csatornát adja vissza,
  // a `removeChannel` pedig aszinkron. Gyors stop→újranyitásnál (reload, remount,
  // projektváltás) így a régi, már feliratkozott csatornát kapnánk, amire a
  // `.on('presence')` kivételt dob („cannot add presence callbacks … after subscribe()").
  // Ezért ha még él, előbb megvárjuk a lebontását, és csak utána nyitunk újat.
  const stale = sb.getChannels().find((c) => c.topic === `realtime:${topic}`);
  if (stale) {
    let inner: LiveChannel | null = null;
    let stopped = false;
    void sb
      .removeChannel(stale)
      .catch((caught) => { logCaught('lib/collabLive.ts:openLiveChannel', caught); return 'error'; })
      .then(() => {
        // ha a lebontás nem sikerült, a topic még foglalt → nem próbálkozunk (nincs végtelen ciklus)
        if (!stopped && !sb.getChannels().some((c) => c.topic === `realtime:${topic}`)) {
          inner = openLiveChannel(topic, self, handlers);
        }
      });
    return {
      broadcast: (commands) => inner?.broadcast(commands),
      sendCursor: (playhead) => inner?.sendCursor(playhead),
      sendLock: (msg) => inner?.sendLock(msg),
      stop: () => {
        stopped = true;
        inner?.stop();
      },
    };
  }

  // ✅ ack: a szerver visszaigazolja a broadcastot — a visszaigazolatlan szerkesztés újra megy (mérve:
  // a visszaigazolás nélküli küldésnél két eszköz között egy szerkesztés elveszett, és a projekt eltért)
  const channel = sb.channel(topic, {
    config: { presence: { key: self.id }, broadcast: { self: false, ack: true } },
  });
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  // a szerkesztések és a zárak SORBAN mennek (a sorrend a társnál is ugyanaz), csatlakozás után
  let queue: Promise<void> = Promise.resolve();
  const reliable = (event: string, payload: Record<string, unknown>) => {
    queue = queue.then(() =>
      sendWithRetry(async () => {
        await Promise.race([ready, new Promise((r) => setTimeout(r, 10_000))]);
        return channel.send({ type: 'broadcast', event, payload });
      }).then((ok) => {
        if (!ok) logCaught('lib/collabLive.ts:send', new Error(`a közös szerkesztés üzenete nem ment ki (${event})`));
      })
    );
  };

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
    .on('broadcast', { event: 'lock' }, ({ payload }) => {
      const msg = payload?.lock as LockBroadcast | undefined;
      if (msg && (msg.type === 'set' || msg.type === 'release') && typeof msg.clipId === 'string') {
        handlers.onLock?.(msg);
      }
    })
    .on('presence', { event: 'sync' }, readPresence)
    .on('presence', { event: 'join' }, readPresence)
    .on('presence', { event: 'leave' }, readPresence)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        markReady();
        void channel.track({ id: self.id, name: self.name, avatar: self.avatar } satisfies PresenceMeta);
      }
    });

  return {
    broadcast: (commands) => reliable('cmd', { commands }),
    sendCursor: (playhead) => {
      void channel.send({ type: 'broadcast', event: 'cursor', payload: { id: self.id, playhead } });
    },
    sendLock: (msg) => reliable('lock', { lock: msg }),
    stop: () => {
      void sb.removeChannel(channel);
    },
  };
}

/**
 * ✅ küldés visszaigazolásra várva: `'ok'`-ig, legfeljebb `attempts`-szer, növekvő várakozással
 * (300, 600, 900… ms); igaz, ha kiment. Tiszta (a csatorna-hívás paraméter) — tesztelhető.
 */
export async function sendWithRetry(send: () => Promise<string>, attempts = 5, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await send()) === 'ok') return true;
    } catch (caught) {
      logCaught('lib/collabLive.ts:sendWithRetry', caught);
    }
    if (i < attempts - 1) await wait(300 * (i + 1));
  }
  return false;
}
