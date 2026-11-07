import { DRUM_VOICES, type DrumPattern } from '@/lib/drums';
import type { SynthNote, SynthWave } from '@/lib/synth';
import type { AudioFx, AudioMaster } from '@/types/project';

/**
 * ⭐ Saját presetek (Hang Stúdió) — tiszta mag. Négy fajta: klip-effekt, master, dobminta és
 * synth-dallam. A tárolt adat a telefonon él (offline, projekteken átívelő); betöltéskor minden
 * bejegyzés ellenőrződik és megtisztul — egy sérült vagy régi bejegyzés kimarad, nem tör el semmit.
 */

export interface DrumPresetValue {
  bars: number;
  pattern: DrumPattern;
}
export interface SynthPresetValue {
  bars: number;
  wave: SynthWave;
  notes: Omit<SynthNote, 'id'>[];
}

export interface PresetValues {
  clipFx: AudioFx;
  master: AudioMaster;
  drums: DrumPresetValue;
  synth: SynthPresetValue;
}
export type PresetKind = keyof PresetValues;

export interface UserPreset<K extends PresetKind = PresetKind> {
  id: string;
  kind: K;
  name: string;
  value: PresetValues[K];
  /** ISO idő (a lista sorrendje: a legutóbb mentett elöl) */
  savedAt: string;
}

export const PRESET_NAME_MAX = 32;
export const PRESETS_PER_KIND_MAX = 40;

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
const bool = (v: unknown): true | undefined => (v === true ? true : undefined);
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function cleanFx(v: unknown): AudioFx | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const eq = x.eq && typeof x.eq === 'object' ? (x.eq as Record<string, unknown>) : null;
  return clean<AudioFx>({
    highpass: num(x.highpass, 0, 2000),
    lowpass: num(x.lowpass, 0, 20000),
    eq: eq ? { low: num(eq.low, -12, 12) ?? 0, mid: num(eq.mid, -12, 12) ?? 0, high: num(eq.high, -12, 12) ?? 0 } : undefined,
    denoise: bool(x.denoise),
    deEsser: bool(x.deEsser),
    compressor: bool(x.compressor),
    limiter: bool(x.limiter),
    normalize: bool(x.normalize),
    gate: bool(x.gate),
    stereoWide: bool(x.stereoWide),
    reverb: num(x.reverb, 0, 1),
    delay: num(x.delay, 0, 1),
    pitchSemitones: num(x.pitchSemitones, -12, 12),
    harmony: num(x.harmony, -12, 12),
  });
}

const TARGETS = ['video', 'podcast', 'music', 'social', 'youtube', 'spotify', 'appleMusic', 'tiktok', 'club', 'custom'];
function cleanMaster(v: unknown): AudioMaster | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const lufs = num(x.lufs, -40, -5);
  const truePeak = num(x.truePeak, -9, 0);
  if (lufs === undefined || truePeak === undefined || !TARGETS.includes(String(x.target))) return null;
  const eq = x.eq && typeof x.eq === 'object' ? (x.eq as Record<string, unknown>) : null;
  return clean<AudioMaster>({
    target: x.target as AudioMaster['target'],
    lufs,
    truePeak,
    dynamics: (['natural', 'balanced', 'punchy'].includes(String(x.dynamics)) ? x.dynamics : 'balanced') as AudioMaster['dynamics'],
    eq: eq ? { low: num(eq.low, -12, 12) ?? 0, mid: num(eq.mid, -12, 12) ?? 0, high: num(eq.high, -12, 12) ?? 0 } : undefined,
    multiband: bool(x.multiband),
    // a halkítás kulcs-sávja projektfüggő: a presetbe nem kerül
  });
}

function cleanDrums(v: unknown): DrumPresetValue | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as { bars?: unknown; pattern?: Record<string, unknown> };
  const bars = Math.round(num(x.bars, 1, 4) ?? 0);
  if (!bars || !x.pattern) return null;
  const pattern = {} as DrumPattern;
  for (const voice of DRUM_VOICES) {
    const row = Array.isArray(x.pattern[voice]) ? (x.pattern[voice] as unknown[]) : [];
    pattern[voice] = Array.from({ length: bars * 16 }, (_, i) => row[i] === true);
  }
  return { bars, pattern };
}

function cleanSynth(v: unknown): SynthPresetValue | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as { bars?: unknown; wave?: unknown; notes?: unknown };
  const bars = Math.round(num(x.bars, 1, 8) ?? 0);
  const wave = (['sine', 'square', 'triangle', 'sawtooth'].includes(String(x.wave)) ? x.wave : 'sine') as SynthWave;
  if (!bars || !Array.isArray(x.notes)) return null;
  const notes = x.notes
    .slice(0, 400)
    .map((n) => (n && typeof n === 'object' ? (n as Record<string, unknown>) : null))
    .filter((n): n is Record<string, unknown> => !!n)
    .map((n) => clean({ midi: Math.round(num(n.midi, 0, 127) ?? -1), startBeat: num(n.startBeat, 0, 64) ?? -1, lengthBeats: num(n.lengthBeats, 0.05, 64) ?? 1, velocity: num(n.velocity, 1, 127) }))
    .filter((n) => n.midi >= 0 && n.startBeat >= 0);
  return { bars, wave, notes };
}

const CLEANERS: { [K in PresetKind]: (v: unknown) => PresetValues[K] | null } = {
  clipFx: cleanFx,
  master: cleanMaster,
  drums: cleanDrums,
  synth: cleanSynth,
};

/** egy érték megtisztítása (null: nem érvényes) */
export function cleanPresetValue<K extends PresetKind>(kind: K, value: unknown): PresetValues[K] | null {
  return CLEANERS[kind](value) as PresetValues[K] | null;
}

/** a tárolt lista betöltéskori ellenőrzése: érvényes fajta, név és érték; fajtánként legfeljebb 40 */
export function sanitizePresets(raw: unknown): UserPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: UserPreset[] = [];
  const perKind = new Map<string, number>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const p = r as Partial<UserPreset>;
    if (!p.kind || !(p.kind in CLEANERS) || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    const name = p.name.trim().slice(0, PRESET_NAME_MAX);
    const value = cleanPresetValue(p.kind, p.value);
    if (!name || !value) continue;
    const n = perKind.get(p.kind) ?? 0;
    if (n >= PRESETS_PER_KIND_MAX) continue;
    perKind.set(p.kind, n + 1);
    out.push({ id: p.id, kind: p.kind, name, value, savedAt: typeof p.savedAt === 'string' ? p.savedAt : '' } as UserPreset);
  }
  return out;
}

/** mentés: azonos fajtán belül azonos nevű felülíródik, az új elöl; a fajta-korlát felett a legrégebbi kiesik */
export function upsertPreset<K extends PresetKind>(list: UserPreset[], kind: K, name: string, value: unknown, id: string, now: string): UserPreset[] | null {
  const clean = cleanPresetValue(kind, value);
  const n = name.trim().slice(0, PRESET_NAME_MAX);
  if (!clean || !n) return null;
  const same = (p: UserPreset) => p.kind === kind && p.name.toLowerCase() === n.toLowerCase();
  const prev = list.find(same);
  const item = { id: prev?.id ?? id, kind, name: n, value: clean, savedAt: now } as UserPreset;
  const rest = list.filter((p) => !same(p));
  const ofKind = rest.filter((p) => p.kind === kind);
  const drop = ofKind.length >= PRESETS_PER_KIND_MAX ? new Set(ofKind.slice(PRESETS_PER_KIND_MAX - 1).map((p) => p.id)) : new Set<string>();
  return [item, ...rest.filter((p) => !drop.has(p.id))];
}

export function renamePreset(list: UserPreset[], id: string, name: string): UserPreset[] {
  const n = name.trim().slice(0, PRESET_NAME_MAX);
  const target = list.find((p) => p.id === id);
  if (!n || !target) return list;
  // ha az új név már foglalt ugyanabban a fajtában, a másik kiesik (felülírás)
  return list.filter((p) => p.id === id || !(p.kind === target.kind && p.name.toLowerCase() === n.toLowerCase())).map((p) => (p.id === id ? { ...p, name: n } : p));
}

export const removePreset = (list: UserPreset[], id: string): UserPreset[] => list.filter((p) => p.id !== id);

export const presetsOf = <K extends PresetKind>(list: UserPreset[], kind: K): UserPreset<K>[] => list.filter((p): p is UserPreset<K> => p.kind === kind);
