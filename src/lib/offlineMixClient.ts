import { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { hasRoomFor, isDiskFullError, megabytes, wavBytes } from '@/lib/diskSpace';
import { freeDiskBytes } from '@/lib/diskSpaceClient';
import { logCaught } from '@/lib/logCaught';
import { mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan, pcm16, wavHeader16, type DecodedSource, type OfflineUnsupported } from '@/lib/offlineMix';
import type { ProgressUpdate } from '@/lib/progress';
import { RenderCancelledError } from '@/lib/render';
import type { Project } from '@/types/project';

/** a telefonos export felső határa (a dekódolt források a memóriában vannak) */
export const OFFLINE_MAX_SEC = 20 * 60;
const CHUNK_SEC = 0.25;
/** egy szeletben legfeljebb ennyi munka, utána a felület jön (60 Hz-en egy képkocka ~16 ms) */
const FRAME_BUDGET_MS = 12;

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
  // 💾 a WAV mérete előre ismert: ha nem fér el, a dekódolás el sem indul
  const needed = wavBytes(Math.round(plan.duration * OFFLINE_SAMPLE_RATE), 2);
  const free = freeDiskBytes();
  if (!hasRoomFor(needed, free)) {
    throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(free) }));
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
    // a hiányzó fájl elvárt helyzet (újracsatolásra vár), nem programhiba: érthető üzenet, napló nélkül
    if (uris[i].startsWith('file:') && !new File(uris[i]).exists) {
      throw new Error(tr('studio.audio.offline.decodeFailed', { name: decodeURIComponent(uris[i].split('/').pop() ?? '') }));
    }
    try {
      const buf = await api.decodeAudioData(uris[i], OFFLINE_SAMPLE_RATE);
      markAudioApi(true);
      // a csatornák átvétele között is a felület jön (egy hosszú forrás csatornája nagy tömb)
      const channels: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        channels.push(buf.getChannelData(c));
      }
      sources.set(uris[i], { channels, sampleRate: buf.sampleRate });
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
    // T2: időkeretes feldolgozás — negyed mp-es darabok, és ~12 ms munka után mindig visszaadjuk
    // a vezérlést (mérve: az 5 mp-es darabok 392 ms-ig fogták a felületet, látható akadás)
    const chunk = Math.round(CHUNK_SEC * OFFLINE_SAMPLE_RATE);
    let sliceStart = Date.now();
    for (let from = 0; from < frames; from += chunk) {
      if (signal?.aborted) {
        throw new RenderCancelledError();
      }
      const to = Math.min(frames, from + chunk);
      const out: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
      mixRange(plan, sources, out, from, to);
      handle.writeBytes(pcm16(out));
      if (Date.now() - sliceStart >= FRAME_BUDGET_MS) {
        onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * (to / frames) });
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = Date.now();
      }
    }
  } catch (caught) {
    handle.close();
    try {
      target.delete();
    } catch (cleanup) {
      logCaught('lib/offlineMixClient.ts:cleanup', cleanup);
    }
    // menet közben betelt (más app is írt): érthető üzenet a natív hiba helyett
    if (isDiskFullError(caught)) {
      throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(freeDiskBytes()) }));
    }
    throw caught;
  }
  handle.close();
  return { uri: target.uri, unsupported: plan.unsupported };
}
