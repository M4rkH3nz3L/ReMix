import { Directory, File, Paths } from 'expo-file-system';

import { renderServerUrl } from '@/lib/render';
import { activeSteps, samplerDurationSec, type SamplerPattern } from '@/lib/sampler';
import { uploadFetch } from '@/lib/upload';

/**
 * 🎛️🔊 A sampler step-mintájának renderelése a worker `/sampler`-én: a feltöltött minta-fájlt
 * a lépés-időpontokra helyezi, keveri, a bájtokat helyi fájlba menti → `uri` + hossz. A hívó
 * sima `AudioClip`-et tesz a sávra. Hiba/web → null.
 */
export async function renderSamplerToClip(
  sampleUri: string,
  pattern: SamplerPattern,
  opts: { bpm: number; bars: number }
): Promise<{ uri: string; durationSec: number } | null> {
  const steps = activeSteps(pattern);
  if (steps.length === 0) {
    return null;
  }
  try {
    const form = new FormData();
    const sample = new File(sampleUri);
    form.append('sample', sample as unknown as Blob, sample.name);
    form.append('steps', JSON.stringify(steps));
    form.append('bpm', String(opts.bpm));
    form.append('bars', String(opts.bars));
    form.append('format', 'm4a');
    const res = await uploadFetch(`${renderServerUrl()}/sampler`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `sampler_${Date.now().toString(36)}.m4a`);
    target.write(new Uint8Array(await res.arrayBuffer()));
    const headerDur = Number(res.headers.get('X-Duration-Sec'));
    const durationSec = Number.isFinite(headerDur) && headerDur > 0 ? headerDur : samplerDurationSec(opts.bars, opts.bpm);
    return { uri: target.uri, durationSec };
  } catch {
    return null;
  }
}
