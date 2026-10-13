import { Directory, File, Paths } from 'expo-file-system';

import { type DrumHit, patternDurationSec } from '@/lib/drums';
import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';

/**
 * 🥁 A dob-minta ütéseinek renderelése hang-fájllá a worker `/drums`-án (szintetizált dob-hangok),
 * a bájtok helyi fájlba mentése → `uri` + hossz. A hívó sima `AudioClip`-et tesz a sávra. Hiba/web → null.
 */
export async function renderDrumsToClip(
  hits: DrumHit[],
  opts: { bpm: number; bars: number }
): Promise<{ uri: string; durationSec: number } | null> {
  if (!hits || hits.length === 0) {
    return null;
  }
  try {
    const res = await uploadFetch(`${renderServerUrl()}/drums`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hits, bpm: opts.bpm, bars: opts.bars, format: 'm4a' }),
    });
    if (!res.ok) {
      return null;
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `drums_${Date.now().toString(36)}.m4a`);
    target.write(new Uint8Array(await res.arrayBuffer()));
    const headerDur = Number(res.headers.get('X-Duration-Sec'));
    const durationSec = Number.isFinite(headerDur) && headerDur > 0 ? headerDur : patternDurationSec(opts.bars, opts.bpm);
    return { uri: target.uri, durationSec };
  } catch {
    return null;
  }
}
