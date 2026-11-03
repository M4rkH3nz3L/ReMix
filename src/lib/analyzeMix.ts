import { File } from 'expo-file-system';

import { analyzeAudio, type LoudnessStats } from '@/lib/audioAnalyze';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import type { ProgressUpdate } from '@/lib/progress';
import { exportAudioFile } from '@/lib/render';
import type { Project } from '@/types/project';

/**
 * A19: a mérés a MOSTANI mixről szól: a projektet renderelni kell, mert a korábbi
 * `rendered` elavult lehet, az első klip pedig nem a keverés. WAV, hogy a mérés ne a
 * veszteséges kódolót mérje; a letöltött fájl nem marad a projekt-mappában.
 */
export async function analyzeMix(
  mix: Project,
  onProgress?: (update: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<LoudnessStats> {
  const url = await exportAudioFile(mix, 'wav', onProgress, signal, { notify: false });
  const local = await downloadToCache(url, `analyze_${mix.id}.wav`);
  if (!local) {
    throw new Error('mix_download_failed');
  }
  try {
    return await analyzeAudio(local);
  } finally {
    try {
      new File(local).delete();
    } catch (caught) {
      logCaught('lib/analyzeMix.ts:analyzeMix', caught);
    }
  }
}
