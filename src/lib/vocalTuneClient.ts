import { File } from 'expo-file-system';

import { formantCorrect } from '@/lib/formant';
import { decodeSample } from '@/lib/instrumentClient';
import { logCaught } from '@/lib/logCaught';
import { encodeWav16, OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import { pitchShiftBuffer } from '@/lib/offlineMixClient';
import type { MusicKey } from '@/lib/pitch';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { assembleShifted, harmonyPlan, noteSegments, pitchTrack, TUNE_XFADE_SEC, tunePlan, type ShiftSegment } from '@/lib/vocalTune';

/**
 * 🎤 V3.2: ének-hangolás a telefonon — a forrás dekódolva, a dallam hangokra bontva, hangonként a natív tolóval
 * eltolva és formáns-korrigálva (a hangszín marad), áttűnéssel visszaillesztve; az eredmény új WAV a projekt
 * mappájában (a klip erre mutat, az eredeti megmarad — újraszerkeszthető). A harmónia külön fájl (csak a hangok).
 */
export const TUNE_MAX_SEC = 10 * 60;

export interface TuneResult {
  tunedUri: string | null;
  harmonyUri: string | null;
  durationSec: number;
  /** a felismert hangok száma és a tolt hangok száma (tájékoztató) */
  notes: number;
  shifted: number;
  /** lépésenkénti idő (ms) — mérés és diagnózis */
  timings: Record<string, number>;
}

const T: Record<string, number> = {};
const tick = (k: string, t0: number) => {
  T[k] = (T[k] ?? 0) + (Date.now() - t0);
};

async function render(source: Float32Array[], plan: readonly ShiftSegment[], base: Float32Array[], onRatio?: (r: number) => void): Promise<Float32Array[]> {
  const sr = OFFLINE_SAMPLE_RATE;
  const xf = Math.round(TUNE_XFADE_SEC * sr);
  const pieces: { start: number; data: Float32Array[] }[] = [];
  for (let k = 0; k < plan.length; k++) {
    const seg = plan[k];
    const a = Math.max(0, Math.round(seg.start * sr) - xf);
    const b = Math.min(source[0].length, Math.round(seg.end * sr) + xf);
    if (b - a < 2 * xf) continue;
    const win = source.map((ch) => ch.slice(a, b));
    let t0 = Date.now();
    const shifted = await pitchShiftBuffer(win, seg.cents, sr);
    tick('shift', t0);
    if (!shifted) continue;
    t0 = Date.now();
    pieces.push({ start: a, data: shifted.map((ch, c) => formantCorrect(win[c] ?? win[0], ch, sr)) });
    tick('formant', t0);
    onRatio?.((k + 1) / plan.length);
  }
  return assembleShifted(base, pieces, xf);
}

function writeWav(stereo: Float32Array[], prefix: string): string {
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const f = new File(dir, `${prefix}_${Date.now().toString(36)}.wav`);
  f.create();
  f.write(encodeWav16(stereo, OFFLINE_SAMPLE_RATE));
  return f.uri;
}

export async function tuneVocal(
  sourceUri: string,
  opts: { key: MusicKey; strength: number; harmonySteps?: number },
  onRatio?: (r: number) => void
): Promise<TuneResult | null> {
  try {
    for (const k of Object.keys(T)) delete T[k];
    let t0 = Date.now();
    const src = await decodeSample(sourceUri);
    tick('decode', t0);
    if (!src || src[0].length === 0) return null;
    const stereo = [src[0], src[1] ?? src[0]];
    const sr = OFFLINE_SAMPLE_RATE;
    if (stereo[0].length > TUNE_MAX_SEC * sr) return null;
    // az ének szinte mindig mono (vagy két azonos csatorna): akkor egyszer számolunk, és mindkét csatorna ugyanaz
    const same = stereo[1] === stereo[0] || stereo[0].every((v, i) => Math.abs(v - stereo[1][i]) < 1e-6);
    const work = same ? [stereo[0]] : stereo;
    const widen = (chs: Float32Array[]) => (same ? [chs[0], chs[0]] : chs);
    const mono = Float32Array.from(stereo[0], (v, i) => (v + stereo[1][i]) * 0.5);
    t0 = Date.now();
    const segs = noteSegments(pitchTrack(mono, sr));
    tick('pitch', t0);
    const tp = tunePlan(segs, opts.key, opts.strength);
    const tuned = opts.strength > 0 ? widen(await render(work, tp, work, (r) => onRatio?.(r * (opts.harmonySteps ? 0.5 : 1)))) : null;
    const hp = opts.harmonySteps ? harmonyPlan(segs, opts.key, opts.harmonySteps) : [];
    const harmony = opts.harmonySteps ? widen(await render(work, hp, work.map((ch) => new Float32Array(ch.length)), (r) => onRatio?.(0.5 + r * 0.5))) : null;
    t0 = Date.now();
    const tunedUri = tuned ? writeWav(tuned, 'tuned') : null;
    const harmonyUri = harmony ? writeWav(harmony, 'harmony') : null;
    tick('write', t0);
    return { tunedUri, harmonyUri, durationSec: stereo[0].length / sr, notes: segs.length, shifted: tp.length, timings: { ...T } };
  } catch (caught) {
    logCaught('lib/vocalTuneClient.ts:tuneVocal', caught);
    return null;
  }
}
