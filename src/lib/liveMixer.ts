import { dbToGain } from '@/lib/mixer';
import type { LiveChannelId, LiveMixer, LiveMixerChannel } from '@/types/live';

/**
 * 🎚️ Élő audio-mixer tiszta-mag (Fázis C) — pure, expo-mentes, tesztelhető. A
 * solo/mute/gain/master/auto-duck logikát számolja; a tényleges hang-útvonalat a
 * kliens köti be (mikrofon = LiveKit mute, zene/média = lejátszó-hangerő). A
 * dB↔lineáris konverzió a `mixer.ts`-ből (közös util). Lásd devs/tasks/LIVE.md C.
 */

const DEFAULTS: { id: LiveChannelId; label: string; gainDb: number }[] = [
  { id: 'mic', label: 'Mic', gainDb: 0 },
  { id: 'music', label: 'Music', gainDb: -6 },
  { id: 'media', label: 'Media', gainDb: 0 },
  { id: 'system', label: 'System', gainDb: -3 },
];

export const MIN_DB = -60;
export const MAX_DB = 6;
/** mennyit halkul a zene, amíg a mikrofon aktív (auto-duck sidechain). */
export const DUCK_DB = -12;

const clampDb = (db: number): number => (db < MIN_DB ? MIN_DB : db > MAX_DB ? MAX_DB : db);

export function createLiveMixer(): LiveMixer {
  return {
    channels: DEFAULTS.map((d) => ({ ...d, mute: false, solo: false })),
    masterGainDb: 0,
    autoDuck: true,
  };
}

function mapChannel(
  mixer: LiveMixer,
  id: LiveChannelId,
  fn: (c: LiveMixerChannel) => LiveMixerChannel,
): LiveMixer {
  return { ...mixer, channels: mixer.channels.map((c) => (c.id === id ? fn(c) : c)) };
}

export function setChannelGainDb(mixer: LiveMixer, id: LiveChannelId, db: number): LiveMixer {
  return mapChannel(mixer, id, (c) => ({ ...c, gainDb: clampDb(db) }));
}

export function toggleMute(mixer: LiveMixer, id: LiveChannelId): LiveMixer {
  return mapChannel(mixer, id, (c) => ({ ...c, mute: !c.mute }));
}

export function toggleSolo(mixer: LiveMixer, id: LiveChannelId): LiveMixer {
  return mapChannel(mixer, id, (c) => ({ ...c, solo: !c.solo }));
}

export function setMasterGainDb(mixer: LiveMixer, db: number): LiveMixer {
  return { ...mixer, masterGainDb: clampDb(db) };
}

export function toggleAutoDuck(mixer: LiveMixer): LiveMixer {
  return { ...mixer, autoDuck: !mixer.autoDuck };
}

export function channelById(mixer: LiveMixer, id: LiveChannelId): LiveMixerChannel | undefined {
  return mixer.channels.find((c) => c.id === id);
}

/** Szól-e egyáltalán a csatorna (solo/mute logika: ha BÁRMI soloban van, a nem-solo néma). */
export function isAudible(mixer: LiveMixer, id: LiveChannelId): boolean {
  const ch = channelById(mixer, id);
  if (!ch || ch.mute) {
    return false;
  }
  const anySolo = mixer.channels.some((c) => c.solo);
  return !anySolo || ch.solo;
}

/**
 * A csatorna effektív LINEÁRIS gainje (0 = néma), master + auto-duck alkalmazva.
 * `micActive` esetén a zene duckol (ha az auto-duck be van kapcsolva).
 */
export function effectiveLinear(
  mixer: LiveMixer,
  id: LiveChannelId,
  opts?: { micActive?: boolean },
): number {
  const ch = channelById(mixer, id);
  if (!ch || !isAudible(mixer, id)) {
    return 0;
  }
  let db = ch.gainDb + mixer.masterGainDb;
  if (mixer.autoDuck && id === 'music' && opts?.micActive) {
    db += DUCK_DB;
  }
  return dbToGain(db);
}

/** Minden csatorna lineáris gainje egy lépésben (a kliens ezzel állítja a hangerőket). */
export function channelGains(
  mixer: LiveMixer,
  opts?: { micActive?: boolean },
): Record<LiveChannelId, number> {
  const out = {} as Record<LiveChannelId, number>;
  for (const c of mixer.channels) {
    out[c.id] = effectiveLinear(mixer, c.id, opts);
  }
  return out;
}
