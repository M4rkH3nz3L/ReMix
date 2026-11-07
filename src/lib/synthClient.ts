import { File } from 'expo-file-system';

import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';
import { synthDurationSec, type SynthNote, type SynthWave } from '@/lib/synth';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { logCaught } from '@/lib/logCaught';
import { synthOnDevice } from '@/lib/instrumentClient';

/**
 * 🎹 A piano-roll hangjegyeinek renderelése hang-fájllá a worker `/synth`-jén (MIDI → generált
 * hang), és a visszakapott bájtok helyi fájlba mentése → az `uri` + a hossz. A hívó (Hang Stúdió)
 * ebből sima `AudioClip`-et tesz a sávra. Weben / hiba esetén `null`.
 * 📱 Offline-first (2026-11-07): előbb a telefonon készül (`instrumentClient`, Free-n is,
 * hálózat nélkül); a worker csak tartalék.
 */
export async function renderSynthToClip(
  notes: SynthNote[],
  opts: { bpm: number; wave: SynthWave }
): Promise<{ uri: string; durationSec: number } | null> {
  if (!notes || notes.length === 0) {
    return null;
  }
  // 📱 offline-first: a telefonon készül; a szerver csak tartalék (web, vagy ha a telefonos út hibázik)
  const local = await synthOnDevice(notes, opts);
  if (local) {
    return local;
  }
  try {
    const res = await uploadFetch(`${renderServerUrl()}/synth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, bpm: opts.bpm, wave: opts.wave, format: 'm4a' }),
    });
    if (!res.ok) {
      return null;
    }
    const dir = projectMediaDir();
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `synth_${Date.now().toString(36)}.m4a`);
    target.write(new Uint8Array(await res.arrayBuffer()));
    const headerDur = Number(res.headers.get('X-Duration-Sec'));
    const durationSec = Number.isFinite(headerDur) && headerDur > 0 ? headerDur : synthDurationSec(notes, opts.bpm);
    return { uri: target.uri, durationSec };
  } catch (caught) {
    logCaught('lib/synthClient.ts:renderSynthToClip', caught);
    return null;
  }
}
