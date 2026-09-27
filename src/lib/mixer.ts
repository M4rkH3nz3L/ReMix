import type { Project, TrackType } from '@/types/project';

/**
 * 🎧 Producer mixer-mag (S-PRODUCER — MASTER §7) — a keverő ROUTING-modellje:
 * csatorna-strip (Volume/Pan/EQ/Compressor/Sends/Sidechain) → busz (drum/vocal/
 * music/fx/group) → master (stereo-width + limiter + parallel kompresszió).
 *
 * Tiszta, expo-mentes, immutábilis reducer (a command-bus filozófia a saját
 * állapotán) — a nehéz DSP a workerbe megy; ez a modul a ROUTING-t + a gain-
 * staginget + a validációt (ciklus/dangling) + a determinisztikus render-tervet
 * adja, amit a worker ffmpeg-filtergráffá alakít. Minden dB-ben (mint az
 * `audioMaster`/`audioAnalyze`), a pan −1…+1.
 */

export const MASTER_ID = 'master';

export type BusKind = 'drum' | 'vocal' | 'music' | 'fx' | 'group';

export interface EqBand {
  freq: number;
  gainDb: number;
  q: number;
  type: 'peak' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass';
}

export interface CompressorSettings {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
  kneeDb?: number;
}

export interface Send {
  toBusId: string;
  gainDb: number;
  /** pre-fader küldés (a csatorna faderétől függetlenül) */
  preFader?: boolean;
}

/** Sidechain-kompresszió: a `keyChannelId` jele nyomja le ezt a csatornát
 *  (pl. a zene lehalkul a beszéd alatt — az `autoDuck` valódi megvalósítása). */
export interface Sidechain {
  keyChannelId: string;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export interface ChannelStrip {
  id: string;
  name: string;
  /** melyik projekt-sávból (music/voiceover/sfx) vagy stem-ből jön a jel */
  source?: string;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  eq: EqBand[];
  compressor?: CompressorSettings;
  sends: Send[];
  /** ide fut a csatorna: egy busz-id vagy `MASTER_ID` */
  output: string;
  sidechain?: Sidechain;
}

export interface Bus {
  id: string;
  name: string;
  kind: BusKind;
  gainDb: number;
  pan: number;
  mute: boolean;
  eq: EqBand[];
  compressor?: CompressorSettings;
  output: string;
}

export interface MasterBus {
  gainDb: number;
  eq: EqBand[];
  compressor?: CompressorSettings;
  /** 0 = mono, 1 = normál sztereó, >1 = szélesítés */
  stereoWidth: number;
  /** true-peak biztonsági plafon (dBTP) */
  limiterCeilingDb: number;
  /** parallel (NY) kompresszió: a komprimált jel dB-ben visszakeverve */
  parallelCompression?: { amountDb: number; compressor: CompressorSettings };
}

export interface MixerGraph {
  channels: ChannelStrip[];
  buses: Bus[];
  master: MasterBus;
}

// ── dB ↔ lineáris ────────────────────────────────────────────────────────────

/** lineáris gain (0…) → dB; a 0 (némítás) a −60 dB padlóra esik. */
export function gainToDb(gain: number): number {
  if (gain <= 0) {
    return -60;
  }
  return Math.round(20 * Math.log10(gain) * 10) / 10;
}

export function dbToGain(db: number): number {
  return Math.round(Math.pow(10, db / 20) * 1000) / 1000;
}

// ── Alapértékek ──────────────────────────────────────────────────────────────

export function defaultMaster(): MasterBus {
  return { gainDb: 0, eq: [], stereoWidth: 1, limiterCeilingDb: -1 };
}

export function createMixer(): MixerGraph {
  return { channels: [], buses: [], master: defaultMaster() };
}

export interface ChannelInput {
  name: string;
  source?: string;
  output?: string;
  gainDb?: number;
  pan?: number;
}

/** Új csatorna (alapból a masterre routolva). */
export function addChannel(mixer: MixerGraph, input: ChannelInput, makeId: () => string): MixerGraph {
  const channel: ChannelStrip = {
    id: makeId(),
    name: input.name.trim() || 'Channel',
    ...(input.source ? { source: input.source } : {}),
    gainDb: input.gainDb ?? 0,
    pan: input.pan ?? 0,
    mute: false,
    solo: false,
    eq: [],
    sends: [],
    output: input.output ?? MASTER_ID,
  };
  return { ...mixer, channels: [...mixer.channels, channel] };
}

export interface BusInput {
  name: string;
  kind: BusKind;
  output?: string;
}

export function addBus(mixer: MixerGraph, input: BusInput, makeId: () => string): MixerGraph {
  const bus: Bus = {
    id: makeId(),
    name: input.name.trim() || 'Bus',
    kind: input.kind,
    gainDb: 0,
    pan: 0,
    mute: false,
    eq: [],
    output: input.output ?? MASTER_ID,
  };
  return { ...mixer, buses: [...mixer.buses, bus] };
}

// ── Reducerek (immutábilis) ──────────────────────────────────────────────────

function mapChannels(mixer: MixerGraph, id: string, fn: (c: ChannelStrip) => ChannelStrip): MixerGraph {
  let changed = false;
  const channels = mixer.channels.map((c) => {
    if (c.id !== id) {
      return c;
    }
    changed = true;
    return fn(c);
  });
  return changed ? { ...mixer, channels } : mixer;
}

export function updateChannel(
  mixer: MixerGraph,
  id: string,
  patch: Partial<Omit<ChannelStrip, 'id'>>
): MixerGraph {
  return mapChannels(mixer, id, (c) => ({ ...c, ...patch }));
}

/** Csatorna törlése — a rá hivatkozó sidechain-kulcsokat is kitakarítja. */
export function removeChannel(mixer: MixerGraph, id: string): MixerGraph {
  const channels = mixer.channels.filter((c) => c.id !== id);
  if (channels.length === mixer.channels.length) {
    return mixer;
  }
  const cleaned = channels.map((c) =>
    c.sidechain?.keyChannelId === id ? { ...c, sidechain: undefined } : c
  );
  return { ...mixer, channels: cleaned };
}

export function updateBus(mixer: MixerGraph, id: string, patch: Partial<Omit<Bus, 'id'>>): MixerGraph {
  let changed = false;
  const buses = mixer.buses.map((b) => {
    if (b.id !== id) {
      return b;
    }
    changed = true;
    return { ...b, ...patch };
  });
  return changed ? { ...mixer, buses } : mixer;
}

/**
 * Busz törlése — a rá routolt csatornákat/buszokat a MASTERre irányítja át
 * (nincs dangling output), és a rá menő sendeket eltávolítja.
 */
export function removeBus(mixer: MixerGraph, id: string): MixerGraph {
  const buses = mixer.buses.filter((b) => b.id !== id);
  if (buses.length === mixer.buses.length) {
    return mixer;
  }
  const reroute = (out: string) => (out === id ? MASTER_ID : out);
  return {
    ...mixer,
    buses: buses.map((b) => ({ ...b, output: reroute(b.output) })),
    channels: mixer.channels.map((c) => ({
      ...c,
      output: reroute(c.output),
      sends: c.sends.filter((s) => s.toBusId !== id),
    })),
  };
}

export function setChannelOutput(mixer: MixerGraph, channelId: string, output: string): MixerGraph {
  return updateChannel(mixer, channelId, { output });
}

/** Send upsert (a `toBusId`-re). */
export function setSend(mixer: MixerGraph, channelId: string, send: Send): MixerGraph {
  return mapChannels(mixer, channelId, (c) => {
    const exists = c.sends.some((s) => s.toBusId === send.toBusId);
    const sends = exists ? c.sends.map((s) => (s.toBusId === send.toBusId ? send : s)) : [...c.sends, send];
    return { ...c, sends };
  });
}

export function removeSend(mixer: MixerGraph, channelId: string, toBusId: string): MixerGraph {
  return mapChannels(mixer, channelId, (c) => ({ ...c, sends: c.sends.filter((s) => s.toBusId !== toBusId) }));
}

export function setSidechain(mixer: MixerGraph, channelId: string, sidechain: Sidechain | null): MixerGraph {
  return mapChannels(mixer, channelId, (c) => ({ ...c, sidechain: sidechain ?? undefined }));
}

// ── Routing-feloldás + validáció ─────────────────────────────────────────────

const busIds = (mixer: MixerGraph): Set<string> => new Set(mixer.buses.map((b) => b.id));

export interface OutputChain {
  path: string[];
  terminatesAtMaster: boolean;
  cycle: boolean;
  /** hiányzó cél-node id (ha az output nem létező buszra mutat) */
  missing: string | null;
}

/** Egy node (csatorna/busz) output-láncának bejárása a masterig. */
export function resolveOutputChain(mixer: MixerGraph, startId: string): OutputChain {
  const ids = busIds(mixer);
  const path: string[] = [];
  const seen = new Set<string>([startId]);
  // a start lehet csatorna vagy busz is: az első lépés az ő outputja
  const startChannel = mixer.channels.find((c) => c.id === startId);
  const startBus = mixer.buses.find((b) => b.id === startId);
  let next: string | null = startChannel?.output ?? startBus?.output ?? null;
  while (next) {
    if (next === MASTER_ID) {
      path.push(MASTER_ID);
      return { path, terminatesAtMaster: true, cycle: false, missing: null };
    }
    if (!ids.has(next)) {
      return { path, terminatesAtMaster: false, cycle: false, missing: next };
    }
    if (seen.has(next)) {
      return { path, terminatesAtMaster: false, cycle: true, missing: null };
    }
    seen.add(next);
    path.push(next);
    next = mixer.buses.find((b) => b.id === next)!.output;
  }
  return { path, terminatesAtMaster: false, cycle: false, missing: null };
}

/** A csatorna teljes jel-útja node-id-kben: [csatorna, ...buszok, master]. */
export function signalPath(mixer: MixerGraph, channelId: string): string[] {
  const chain = resolveOutputChain(mixer, channelId);
  return [channelId, ...chain.path];
}

export type MixerErrorCode = 'dangling_output' | 'routing_cycle' | 'send_missing_bus' | 'sidechain_missing_key';

export interface MixerError {
  code: MixerErrorCode;
  nodeId: string;
  detail?: string;
}

/** Teljes routing-validáció: dangling output, ciklus, hiányzó send-cél, hiányzó sidechain-kulcs. */
export function validateMixer(mixer: MixerGraph): { ok: boolean; errors: MixerError[] } {
  const errors: MixerError[] = [];
  const ids = busIds(mixer);
  const channelIds = new Set(mixer.channels.map((c) => c.id));

  for (const node of [...mixer.channels, ...mixer.buses]) {
    const chain = resolveOutputChain(mixer, node.id);
    if (chain.cycle) {
      errors.push({ code: 'routing_cycle', nodeId: node.id });
    } else if (chain.missing) {
      errors.push({ code: 'dangling_output', nodeId: node.id, detail: chain.missing });
    }
  }
  for (const c of mixer.channels) {
    for (const s of c.sends) {
      if (!ids.has(s.toBusId)) {
        errors.push({ code: 'send_missing_bus', nodeId: c.id, detail: s.toBusId });
      }
    }
    if (c.sidechain && !channelIds.has(c.sidechain.keyChannelId)) {
      errors.push({ code: 'sidechain_missing_key', nodeId: c.id, detail: c.sidechain.keyChannelId });
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── Solo / mute feloldás ─────────────────────────────────────────────────────

/** A ténylegesen NÉMA csatornák: ha bármelyik solo aktív, a nem-solo csatornák
 *  némák; az explicit mute mindig néma. */
export function effectiveMutes(mixer: MixerGraph): Set<string> {
  const anySolo = mixer.channels.some((c) => c.solo);
  const muted = new Set<string>();
  for (const c of mixer.channels) {
    if (c.mute || (anySolo && !c.solo)) {
      muted.add(c.id);
    }
  }
  return muted;
}

export function isAudible(mixer: MixerGraph, channelId: string): boolean {
  return !effectiveMutes(mixer).has(channelId);
}

// ── Render-terv (a worker ffmpeg-filtergráfjához) ────────────────────────────

export interface RenderChannel extends ChannelStrip {
  /** a solo/mute feloldás utáni tényleges némítás */
  muted: boolean;
}

export interface MixerRenderPlan {
  channels: RenderChannel[];
  /** a buszok jelfolyam-sorrendben (upstream → master előtti) */
  buses: Bus[];
  master: MasterBus;
}

/**
 * A buszok topologikus rendezése az output-függés szerint: egy busz ELŐBB
 * szerepel, mint az a busz, amelyikbe a jele fut. Ciklus esetén a maradék a
 * végére kerül (a validáció külön jelzi a ciklust).
 */
export function orderBuses(buses: Bus[]): Bus[] {
  const byId = new Map(buses.map((b) => [b.id, b]));
  const ordered: Bus[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (b: Bus): void => {
    const s = state.get(b.id);
    if (s === 'done' || s === 'visiting') {
      return;
    }
    state.set(b.id, 'visiting');
    const parent = byId.get(b.output);
    if (parent) {
      visit(parent);
    }
    state.set(b.id, 'done');
    ordered.push(b);
  };
  for (const b of buses) {
    visit(b);
  }
  // a DFS finish-sorrend a downstream-t adja elöl; a jelfolyamhoz (upstream →
  // downstream → master) meg kell fordítani
  return ordered.reverse();
}

/**
 * Determinisztikus render-terv: a csatornák tényleges némítással annotálva, a
 * buszok jelfolyam-sorrendben, a master-lánc. A worker EBBŐL építi a filtergráfot
 * (nem tartalmaz ffmpeg-stringet — deklaratív, így tesztelhető és paritásos).
 */
export function toRenderPlan(mixer: MixerGraph): MixerRenderPlan {
  const muted = effectiveMutes(mixer);
  return {
    channels: mixer.channels.map((c) => ({ ...c, muted: muted.has(c.id) })),
    buses: orderBuses(mixer.buses),
    master: mixer.master,
  };
}

// ── Bridge: projekt-audiosávok → mixer ───────────────────────────────────────

/** a projekt audio-sávjai (ezekből lesz alap-csatorna). */
const AUDIO_TRACKS: TrackType[] = ['music', 'voiceover', 'sfx'];

/**
 * Alap-mixer a projekt audio-sávjaiból: minden nem-üres music/voiceover/sfx sáv
 * egy csatorna lesz, a `trackMix` lineáris gainje dB-re váltva. Mind a masterre
 * fut. Ez a kiindulás; innen a producer buszokat/sendeket/sidechaint épít.
 */
export function mixerFromProject(project: Project, makeId: () => string): MixerGraph {
  let mixer = createMixer();
  for (const type of AUDIO_TRACKS) {
    const track = project.tracks.find((t) => t.type === type);
    if (!track || track.clips.length === 0) {
      continue;
    }
    const gain = project.trackMix?.[type]?.gain ?? 1;
    mixer = addChannel(mixer, { name: type, source: type, gainDb: gainToDb(gain) }, makeId);
  }
  return mixer;
}
