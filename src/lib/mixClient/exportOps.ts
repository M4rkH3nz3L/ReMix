import type { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { OFFLINE_SAMPLE_RATE, offlineMixPlan, measureMasterGain, type OfflineMixPlan, type OfflineUnsupported } from '@/lib/offlineMix';
import { ZipStoreWriter } from '@/lib/zipStore';
import { StreamResampler } from '@/lib/streamResampler';
import type { ProgressUpdate } from '@/lib/progress';
import { RenderCancelledError } from '@/lib/render';
import type { Project } from '@/types/project';

import { mixLoop } from './mixLoop';
import { frameRange, prepareOffline } from './prepare';
import { bytesPerSample, ensureRoom, withTargetFile, writeWav, type WavBits } from './wavOutput';

export interface OfflineExportOptions {
  /** ✂️ csak ez a tartomány (mp) — a keverés az elejétől fut, így a tartomány mintára az, ami a teljes exportban ott szól */
  range?: { from: number; to: number };
  bits?: WavBits;
  /** 🎧 csatornák: 1 = mono (a két csatorna átlaga), alap 2 */
  channels?: 1 | 2;
  /** 🎚️ kimeneti mintavétel: 48000 = folyamatos sinc-átmintavételezés a 44,1 kHz-es keverésből, alap 44100 */
  sampleRate?: 44100 | 48000;
}

/**
 * 🩺 A keverés darabonként a hívónak (fájl nélkül) — a hangellenőrzés ugyanazt a keverést méri,
 * amit az export kiír (masterrel együtt).
 */
export async function streamOfflineMix(
  mix: Project,
  onChunk: (l: Float32Array, r: Float32Array) => void,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<void> {
  const prep = await prepareOffline(mix, onProgress, signal);
  const plan = prep.plan.master
    ? { ...prep.plan, masterGain: await measureMasterGain(prep.plan, prep.sources, signal ?? undefined, prep.prepare) }
    : prep.plan;
  await mixLoop(prep, plan, frameRange(plan), onChunk, (r) => onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * r }), signal);
}

/**
 * 🎧📱 PRO-AUDIO A26: a hang-mix WAV-ként, TELJESEN a telefonon (Free, szerver nélkül). A
 * források a natív dekóderrel 44,1 kHz-re dekódolódnak, a keverés a `offlineMix` pure magja
 * (a szerveres renderrel paritás-tesztelt), a WAV darabonként íródik a fájlba.
 */
export async function exportOfflineWav(
  mix: Project,
  target: File,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal,
  /** `float32`: a Pro szerveres export köztes keveréke (veszteségmentes) */
  format: 'pcm16' | 'float32' = 'pcm16',
  opts: OfflineExportOptions = {}
): Promise<{ uri: string; unsupported: OfflineUnsupported[] }> {
  const bits: WavBits = format === 'float32' ? 32 : (opts.bits ?? 16);
  const draft = offlineMixPlan(mix);
  const [a, b] = frameRange(draft, opts.range);
  const outCh = opts.channels ?? 2;
  const outSr = opts.sampleRate ?? OFFLINE_SAMPLE_RATE;
  const needed = 44 + StreamResampler.outFrames(b - a, OFFLINE_SAMPLE_RATE, outSr) * outCh * bytesPerSample(bits);
  ensureRoom(needed);
  const prep = await prepareOffline(mix, onProgress, signal);
  // 📏 a master mérése (kétmenetes) — a teljes projekten, a tartomány is ugyanazt a szintet kapja
  const finalPlan = prep.plan.master
    ? { ...prep.plan, masterGain: await measureMasterGain(prep.plan, prep.sources, signal ?? undefined, prep.prepare) }
    : prep.plan;
  if (signal?.aborted) {
    throw new RenderCancelledError();
  }
  await withTargetFile(target, needed, (write) =>
    writeWav(prep, finalPlan, [a, b], bits, write, (r) => onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * r }), signal, { channels: outCh, sampleRate: outSr })
  );
  return { uri: target.uri, unsupported: prep.unsupported };
}

/** egy keverési menet: a megadott sávok (vagy mind), masterrel vagy anélkül, a darabok a `sink`-be */
export interface MixPass {
  solo?: string[];
  master: boolean;
  sink: (l: Float32Array, r: Float32Array) => void;
}

/**
 * 🎚️🤖 Több keverési menet EGY előkészítéssel (a dekódolás, a nyújtás és a normalizálás egyszer):
 * a mixjavaslat a sávonkénti szóló menetekből, a mastering-segéd a master nélküli és a masteres
 * teljes keverésből mér. A halkítás a szóló menetben is a teljes kulcsból jön (mint a stemeknél).
 */
export async function streamOfflinePasses(mix: Project, passes: MixPass[], onProgress?: (u: ProgressUpdate) => void, signal?: AbortSignal): Promise<void> {
  const prep = await prepareOffline(mix, onProgress, signal);
  for (let k = 0; k < passes.length; k++) {
    const pass = passes[k];
    let plan: OfflineMixPlan = { ...prep.plan, ...(pass.solo ? { solo: pass.solo } : {}) };
    if (!pass.master) plan = { ...plan, master: undefined, masterGain: undefined };
    else if (plan.master) plan = { ...plan, masterGain: await measureMasterGain(prep.plan, prep.sources, signal ?? undefined, prep.prepare) };
    await mixLoop(prep, plan, frameRange(plan), pass.sink, (r) => onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * ((k + r) / passes.length) }), signal);
  }
}

/** egy stem: a sáv típusa és a fájl neve a csomagban */
export interface StemSpec {
  track: string;
  name: string;
}

/**
 * 🎚️ Sávonkénti (stem) export a telefonon, egy STORE-zipbe (folyamatosan írva — a memóriában
 * sosem egy egész fájl). Minden stem a teljes keverésből jön, csak a saját sávja szól: a
 * klip-effektek, a sáv szintje, a buszra küldött része és a halkítás (a többi sáv beszéde
 * vezérli) benne van; a master-lánc nincs — a stemek összege a keverés master nélkül.
 */
export async function exportOfflineStems(
  mix: Project,
  target: File,
  stems: StemSpec[],
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal,
  opts: OfflineExportOptions = {}
): Promise<{ uri: string; files: string[] }> {
  const bits: WavBits = opts.bits ?? 16;
  const draft = offlineMixPlan(mix);
  const [a, b] = frameRange(draft, opts.range);
  const needed = stems.length * (44 + (b - a) * 2 * bytesPerSample(bits)) + 4096;
  ensureRoom(needed);
  const prep = await prepareOffline(mix, onProgress, signal);
  const zip = new ZipStoreWriter();
  const files: string[] = [];
  await withTargetFile(target, needed, async (write) => {
    for (let k = 0; k < stems.length; k++) {
      const name = `${stems[k].name}.wav`;
      files.push(name);
      write(zip.beginFile(name));
      const plan: OfflineMixPlan = { ...prep.plan, master: undefined, masterGain: undefined, solo: [stems[k].track] };
      await writeWav(prep, plan, [a, b], bits, (bytes) => write(zip.chunk(bytes)), (r) => onProgress?.({ phase: tr('studio.audio.offline.stems', { name: stems[k].name, n: k + 1, of: stems.length }), ratio: 0.4 + 0.6 * ((k + r) / stems.length) }), signal);
      write(zip.endFile());
    }
    write(zip.finish());
  });
  return { uri: target.uri, files };
}
