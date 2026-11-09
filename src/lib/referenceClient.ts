import * as DocumentPicker from 'expo-document-picker';

import { loadAudioApi } from '@/lib/audioApiGuard';
import { integratedLoudness } from '@/lib/loudness';
import { logCaught } from '@/lib/logCaught';
import { previewEngine } from '@/lib/previewEngine';
import { useReference, type ReferenceTrack } from '@/store/referenceStore';

/**
 * 🎧 Referencia-dal választása és mérése (a telefonon): a fájl az app cache-ében marad (a projektbe nem
 * kerül), az integrált hangossága BS.1770 szerint.
 */
export async function pickReferenceFile(): Promise<{ uri: string; name: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
  if (r.canceled || r.assets.length === 0) return null;
  return { uri: r.assets[0].uri, name: r.assets[0].name.replace(/\.[^.]+$/, '') };
}

/** a referencia hangossága és hossza; nem dekódolható / túl hosszú (> 15 perc) → null */
export async function measureReference(uri: string): Promise<{ lufs: number; duration: number } | null> {
  const api = await loadAudioApi();
  if (!api) return null;
  try {
    const buf = await api.decodeAudioData(uri, 44100);
    if (buf.duration > 15 * 60) return null;
    const l = buf.getChannelData(0);
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    const lufs = integratedLoudness(l, r, buf.sampleRate);
    return Number.isFinite(lufs) ? { lufs, duration: buf.duration } : null;
  } catch (caught) {
    logCaught('lib/referenceClient.ts:measure', caught);
    return null;
  }
}

/** a referencia beállítása + előre dekódolása a lejátszó-motorban (a B-váltás azonnal szóljon) */
export async function applyReference(r: ReferenceTrack): Promise<void> {
  useReference.getState().setRef(r);
  await previewEngine.preload(r.uri).catch((caught) => logCaught('lib/referenceClient.ts:preload', caught));
}
