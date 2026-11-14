/**
 * 🛍️ V4 (AUDIO-PROD) — hangcsomag a Shopban (expo-mentes, tiszta mag).
 *
 * Döntés 2026-11-15: a csomag MINTÁZAT (dob-rács, hangjegyek), nem hangfájl — mint a 20 beépített loop
 * (`loopLibrary`): a telefon a projekt tempóján süti, szerkeszthető, a vásárlás után offline is szól.
 * Bárki eladhat csomagot a SAJÁT projektjéből: a projekt dob- és szinti-mintái (`InstrumentDoc`) lesznek
 * a loopok (a sampler kimarad — az a telefon saját hangfájljára hivatkozik).
 *
 * A megvett csomag MÁS felhasználó adata → `parseSoundPack` mindent ellenőriz és korlátoz, mielőtt a
 * motor elé kerül (ismeretlen mező eldobva, számok tartományba szorítva, méret-plafonok).
 */
import { DRUM_ACCENT, DRUM_SOFT, DRUM_VOICES, STEPS_PER_BAR, type DrumVoice } from '@/lib/drums';
import { LOOP_CATEGORIES, type BuiltinLoop, type DrumDef, type LoopCategory, type NoteDef, type SynthDef } from '@/lib/loopLibrary';
import type { SynthWave } from '@/lib/synth';
import type { InstrumentDoc, Project } from '@/types/project';

export const SOUND_PACK_TYPE = 'soundPack';
export const SOUND_PACK_MAX_LOOPS = 32;
export const SOUND_PACK_MAX_NOTES = 512;
const NAME_MAX = 60;
const WAVES: readonly SynthWave[] = ['sine', 'square', 'triangle', 'sawtooth'];

export interface SoundPack {
  type: typeof SOUND_PACK_TYPE;
  v: 1;
  name: string;
  /** a loopok (a `name` mindig kitöltve) */
  loops: BuiltinLoop[];
}

/** a minta hossza a loop-rácson: 1, 2 vagy 4 ütem (a hosszabb minta első 4 üteme) */
function loopLen(bars: number): 1 | 2 | 4 {
  return bars >= 4 ? 4 : bars >= 2 ? 2 : 1;
}

function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
  return (s || fallback).slice(0, NAME_MAX);
}

/** szinti-minta kategóriája: mély (átlag < F3) → basszus, egyszerre ≥ 3 hang → akkord, különben dallam */
export function synthCategory(notes: readonly NoteDef[]): LoopCategory {
  if (notes.length === 0) return 'melody';
  const starts = new Map<number, number>();
  for (const n of notes) starts.set(n[1], (starts.get(n[1]) ?? 0) + 1);
  if ([...starts.values()].some((c) => c >= 3)) return 'chords';
  // az átlag (nem a medián): az oktávot ugráló basszus (45/57) is basszus maradjon
  const mean = notes.reduce((a, n) => a + n[0], 0) / notes.length;
  return mean < 53 ? 'bass' : 'melody';
}

function drumDefOf(doc: InstrumentDoc): DrumDef | null {
  const d = doc.drums;
  if (!d) return null;
  const len = loopLen(doc.bars);
  const span = len * STEPS_PER_BAR;
  const steps: DrumDef['steps'] = {};
  const accent: DrumDef['accent'] = {};
  const soft: DrumDef['soft'] = {};
  let any = false;
  for (const v of DRUM_VOICES) {
    const row = d.pattern[v] ?? [];
    const on: number[] = [];
    for (let i = 0; i < Math.min(span, row.length); i++) if (row[i]) on.push(i);
    if (on.length === 0) continue;
    any = true;
    steps[v] = on;
    const vel = d.velocity?.[v] ?? [];
    const acc = on.filter((i) => (vel[i] ?? 0) >= DRUM_ACCENT);
    const sft = on.filter((i) => vel[i] !== undefined && (vel[i] as number) <= DRUM_SOFT);
    if (acc.length) accent[v] = acc;
    if (sft.length) soft[v] = sft;
  }
  if (!any) return null;
  return {
    kind: 'drums',
    len,
    steps,
    ...(Object.keys(accent).length ? { accent } : {}),
    ...(Object.keys(soft).length ? { soft } : {}),
    ...(d.swing ? { swing: d.swing } : {}),
  };
}

function synthDefOf(doc: InstrumentDoc): SynthDef | null {
  const s = doc.synth;
  if (!s) return null;
  const len = loopLen(doc.bars);
  const beats = len * 4;
  const notes: NoteDef[] = s.notes
    .filter((n) => n.startBeat < beats)
    .slice(0, SOUND_PACK_MAX_NOTES)
    .map((n) => {
      const length = Math.min(n.lengthBeats, beats - n.startBeat);
      return n.velocity ? [n.midi, n.startBeat, length, n.velocity] : [n.midi, n.startBeat, length];
    });
  return notes.length ? { kind: 'synth', wave: s.wave, notes, len } : null;
}

/**
 * A projekt hangszer-mintáiból csomag (csak az idővonalon használt dob / szinti mintákból, egy minta
 * egyszer); `null`, ha nincs belőle loop. A loop neve a klip felirata.
 */
export function packFromProject(project: Project, name: string): SoundPack | null {
  const docs = new Map((project.instrumentDocs ?? []).map((d) => [d.id, d]));
  const seen = new Set<string>();
  const loops: BuiltinLoop[] = [];
  for (const tr of project.tracks) {
    for (const c of tr.clips) {
      if (c.kind !== 'audio' || !c.instrumentDocId || seen.has(c.instrumentDocId)) continue;
      const doc = docs.get(c.instrumentDocId);
      if (!doc) continue;
      seen.add(doc.id);
      const def = doc.kind === 'drums' ? drumDefOf(doc) : doc.kind === 'synth' ? synthDefOf(doc) : null;
      if (!def) continue;
      const category: LoopCategory = def.kind === 'drums' ? 'drums' : synthCategory(def.notes);
      loops.push({ id: `pk${loops.length}`, category, def, name: cleanName(c.label, `Loop ${loops.length + 1}`) });
      if (loops.length >= SOUND_PACK_MAX_LOOPS) break;
    }
    if (loops.length >= SOUND_PACK_MAX_LOOPS) break;
  }
  return loops.length ? { type: SOUND_PACK_TYPE, v: 1, name: cleanName(name, project.name || 'Pack'), loops } : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseSteps(raw: unknown, span: number): Partial<Record<DrumVoice, number[]>> {
  const out: Partial<Record<DrumVoice, number[]>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const v of DRUM_VOICES) {
    const arr = (raw as Record<string, unknown>)[v];
    if (!Array.isArray(arr)) continue;
    const steps = [...new Set(arr.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < span))].sort((a, b) => a - b);
    if (steps.length) out[v] = steps;
  }
  return out;
}

function parseDef(raw: unknown): DrumDef | SynthDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const len = d.len === 1 || d.len === 2 || d.len === 4 ? d.len : null;
  if (!len) return null;
  if (d.kind === 'drums') {
    const span = len * STEPS_PER_BAR;
    const steps = parseSteps(d.steps, span);
    if (Object.keys(steps).length === 0) return null;
    const accent = parseSteps(d.accent, span);
    const soft = parseSteps(d.soft, span);
    const swing = num(d.swing);
    return {
      kind: 'drums',
      len,
      steps,
      ...(Object.keys(accent).length ? { accent } : {}),
      ...(Object.keys(soft).length ? { soft } : {}),
      ...(swing && swing > 0 ? { swing: Math.min(0.5, swing) } : {}),
    };
  }
  if (d.kind === 'synth') {
    const wave = WAVES.includes(d.wave as SynthWave) ? (d.wave as SynthWave) : null;
    if (!wave || !Array.isArray(d.notes)) return null;
    const beats = len * 4;
    const notes: NoteDef[] = [];
    for (const n of d.notes.slice(0, SOUND_PACK_MAX_NOTES)) {
      if (!Array.isArray(n)) continue;
      const [midi, start, length, vel] = [num(n[0]), num(n[1]), num(n[2]), num(n[3])];
      if (midi === null || start === null || length === null) continue;
      if (!Number.isInteger(midi) || midi < 0 || midi > 127 || start < 0 || start >= beats || length <= 0) continue;
      const l = Math.min(length, beats - start);
      notes.push(vel !== null && vel >= 1 ? [midi, start, l, Math.min(127, Math.round(vel))] : [midi, start, l]);
    }
    return notes.length ? { kind: 'synth', wave, notes, len } : null;
  }
  return null;
}

/** egy (idegen) payload → ellenőrzött csomag; `null`, ha nem hangcsomag vagy nincs benne használható loop */
export function parseSoundPack(raw: unknown): SoundPack | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.type !== SOUND_PACK_TYPE || !Array.isArray(p.loops)) return null;
  const loops: BuiltinLoop[] = [];
  for (const l of p.loops.slice(0, SOUND_PACK_MAX_LOOPS)) {
    if (!l || typeof l !== 'object') continue;
    const r = l as Record<string, unknown>;
    const def = parseDef(r.def);
    if (!def) continue;
    const category = def.kind === 'drums' ? 'drums' : LOOP_CATEGORIES.includes(r.category as LoopCategory) && r.category !== 'drums' ? (r.category as LoopCategory) : synthCategory(def.notes);
    loops.push({ id: `pk${loops.length}`, category, def, name: cleanName(r.name, `Loop ${loops.length + 1}`) });
  }
  return loops.length ? { type: SOUND_PACK_TYPE, v: 1, name: cleanName(p.name, 'Pack'), loops } : null;
}

/** a csomag loopjai egy kategóriában, a csomaghoz kötött egyedi azonosítóval (a motor és a lista ezzel azonosít) */
export function packLoopsIn(itemId: string, pack: SoundPack, category: LoopCategory): BuiltinLoop[] {
  return pack.loops.filter((l) => l.category === category).map((l) => ({ ...l, id: `pack_${itemId}_${l.id}` }));
}
