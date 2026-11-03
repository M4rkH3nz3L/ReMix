import { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { logCaught } from '@/lib/logCaught';
import { mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan, pcm16, wavHeader16, type DecodedSource, type OfflineUnsupported } from '@/lib/offlineMix';
import type { ProgressUpdate } from '@/lib/progress';
import { RenderCancelledError } from '@/lib/render';
import type { Project } from '@/types/project';

/** a telefonos export felső határa (a dekódolt források a memóriában vannak) */
export const OFFLINE_MAX_SEC = 20 * 60;
const CHUNK_SEC = 5;

/**
 * 🎧📱 PRO-AUDIO A26: a hang-mix WAV-ként, TELJESEN a telefonon (Free, szerver nélkül). A
 * források a natív dekóderrel 44,1 kHz-re dekódolódnak, a keverés a `offlineMix` pure magja
 * (a szerveres renderrel paritás-tesztelt), a WAV darabonként íródik a fájlba.
 */
export async function exportOfflineWav(
  mix: Project,
  target: File,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{ uri: string; unsupported: OfflineUnsupported[] }> {
  const plan = offlineMixPlan(mix);
  if (plan.duration > OFFLINE_MAX_SEC) {
    throw new Error(tr('studio.audio.offline.tooLong', { minutes: OFFLINE_MAX_SEC / 60 }));
  }
  const api = await loadAudioApi();
  if (!api) {
    throw new Error(tr('studio.audio.offline.noDecoder'));
  }
  const sources = new Map<string, DecodedSource>();
  const uris = [...new Set(plan.clips.map((c) => c.uri))];
  for (let i = 0; i < uris.length; i++) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    onProgress?.({ phase: tr('studio.audio.offline.decoding'), ratio: (i / uris.length) * 0.4 });
    try {
      const buf = await api.decodeAudioData(uris[i], OFFLINE_SAMPLE_RATE);
      markAudioApi(true);
      sources.set(uris[i], {
        channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)),
        sampleRate: buf.sampleRate,
      });
    } catch (caught) {
      logCaught('lib/offlineMixClient.ts:decode', caught);
      throw new Error(tr('studio.audio.offline.decodeFailed', { name: uris[i].split('/').pop() }));
    }
  }

  const frames = Math.round(plan.duration * OFFLINE_SAMPLE_RATE);
  if (target.exists) {
    target.delete();
  }
  target.create();
  const handle = target.open();
  try {
    handle.writeBytes(wavHeader16(frames, 2, OFFLINE_SAMPLE_RATE));
    const chunk = CHUNK_SEC * OFFLINE_SAMPLE_RATE;
    for (let from = 0; from < frames; from += chunk) {
      if (signal?.aborted) {
        throw new RenderCancelledError();
      }
      const to = Math.min(frames, from + chunk);
      const out: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
      mixRange(plan, sources, out, from, to);
      handle.writeBytes(pcm16(out));
      onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * (to / frames) });
      // a felület ne fagyjon: darabonként visszaadjuk a vezérlést
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (caught) {
    handle.close();
    try {
      target.delete();
    } catch (cleanup) {
      logCaught('lib/offlineMixClient.ts:cleanup', cleanup);
    }
    throw caught;
  }
  handle.close();
  return { uri: target.uri, unsupported: plan.unsupported };
}
