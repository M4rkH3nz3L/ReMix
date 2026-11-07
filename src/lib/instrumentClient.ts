import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { loadAudioApi } from '@/lib/audioApiGuard';
import { activeSteps } from '@/lib/sampler';
import type { DrumHit } from '@/lib/drums';
import { INSTRUMENT_SR, renderDrumsPcm, renderSamplerPcm, renderSynthPcm } from '@/lib/instrumentRender';
import { logCaught } from '@/lib/logCaught';
import { encodeWav16 } from '@/lib/offlineMix';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { SamplerPattern } from '@/lib/sampler';
import type { SynthNote, SynthWave } from '@/lib/synth';

/**
 * 🎹🥁🎛️ Offline-first beégetés: a hangszer hangja a telefonon készül (`instrumentRender`),
 * 16 bites WAV-ként a projekt mappájába — szerver, hálózat és Pro nélkül. `null`: a telefonos út
 * nem elérhető (web) vagy hibázott → a hívó a szerverhez fordul.
 */

type Clip = { uri: string; durationSec: number };

function writeWav(stereo: Float32Array[], prefix: string): Clip {
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const target = new File(dir, `${prefix}_${Date.now().toString(36)}.wav`);
  target.create();
  target.write(encodeWav16(stereo, INSTRUMENT_SR));
  return { uri: target.uri, durationSec: Math.round((stereo[0].length / INSTRUMENT_SR) * 1e6) / 1e6 };
}

export async function synthOnDevice(notes: SynthNote[], opts: { bpm: number; wave: SynthWave }): Promise<Clip | null> {
  if (Platform.OS === 'web' || notes.length === 0) return null;
  try {
    return writeWav(renderSynthPcm(notes, opts.wave, opts.bpm), 'synth');
  } catch (caught) {
    logCaught('lib/instrumentClient.ts:synth', caught);
    return null;
  }
}

export async function drumsOnDevice(hits: DrumHit[], opts: { bpm: number; bars: number }): Promise<Clip | null> {
  if (Platform.OS === 'web' || hits.length === 0) return null;
  try {
    return writeWav(renderDrumsPcm(hits, opts.bars, opts.bpm), 'drums');
  } catch (caught) {
    logCaught('lib/instrumentClient.ts:drums', caught);
    return null;
  }
}

const sampleCache = new Map<string, Float32Array[]>();
/** a minta dekódolva (44,1 kHz), fájlonként tárolva — az előhallgatás is ezt használja */
export async function decodeSample(uri: string): Promise<Float32Array[] | null> {
  const hit = sampleCache.get(uri);
  if (hit) return hit;
  const api = await loadAudioApi();
  if (!api) return null;
  try {
    const buf = await api.decodeAudioData(uri, INSTRUMENT_SR);
    const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    sampleCache.set(uri, ch);
    return ch;
  } catch (caught) {
    logCaught('lib/instrumentClient.ts:decodeSample', caught);
    return null;
  }
}

export async function samplerOnDevice(sampleUri: string, pattern: SamplerPattern, opts: { bpm: number; bars: number }): Promise<Clip | null> {
  const steps = activeSteps(pattern);
  if (Platform.OS === 'web' || steps.length === 0) return null;
  const sample = await decodeSample(sampleUri);
  if (!sample) return null;
  try {
    return writeWav(renderSamplerPcm(sample, steps, opts.bars, opts.bpm), 'sampler');
  } catch (caught) {
    logCaught('lib/instrumentClient.ts:sampler', caught);
    return null;
  }
}
