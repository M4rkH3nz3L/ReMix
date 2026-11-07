import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { loadAudioApi } from '@/lib/audioApiGuard';
import { audioSpeedOf } from '@/lib/audioTrim';
import { logCaught } from '@/lib/logCaught';
import { ANALYSIS_CACHE_LIMIT, LruCache } from '@/lib/lruCache';
import { encodeWav16, OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import { stretchSegment } from '@/lib/offlineMixClient';
import type { AudioClip } from '@/types/project';

/**
 * ⏩⏪ ELŐNÉZETI nyújtott szakasz: a visszafelé vagy 0,5–2×-en kívül szóló hangklip ablakát a
 * telefon egyszer elkészíti (kivágás, fordítás, hangmagasság-tartó nyújtás — ugyanaz a natív út,
 * mint a telefonos exportban), és az előnézet ezt játssza 1×-en a klip elejétől. A kulcs a
 * forrás + az ablak + a sebesség + az irány: vágás után új szakasz készül, a régi a maga kulcsán marad.
 */
type Window = Pick<AudioClip, 'trimIn' | 'duration' | 'speed' | 'reversed'>;

const memory = new LruCache<string | null>(ANALYSIS_CACHE_LIMIT);
const inflight = new Map<string, Promise<string | null>>();

export function stretchProxyKey(uri: string, w: Window): string {
  return `${uri}|${(w.trimIn ?? 0).toFixed(4)}|${w.duration.toFixed(4)}|${audioSpeedOf(w)}|${w.reversed ? 'r' : 'f'}`;
}

/** a kész szakasz (szinkron, render közben hívható); null = még nincs kész */
export function getStretchProxySync(key: string): string | null {
  return memory.get(key) ?? null;
}

function fileName(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `st_${h.toString(36)}.wav`;
}

export function ensureStretchProxy(uri: string, w: Window): Promise<string | null> {
  if (Platform.OS === 'web' || uri.startsWith('http')) {
    return Promise.resolve(null);
  }
  const key = stretchProxyKey(uri, w);
  if (memory.has(key)) {
    return Promise.resolve(memory.get(key) ?? null);
  }
  const running = inflight.get(key);
  if (running) {
    return running;
  }
  const task = (async (): Promise<string | null> => {
    try {
      const dir = new Directory(Paths.cache, 'stretch');
      if (!dir.exists) dir.create();
      const out = new File(dir, fileName(key));
      if (!out.exists) {
        if (!new File(uri).exists) {
          return null;
        }
        const api = await loadAudioApi();
        if (!api) {
          return null;
        }
        const buf = await api.decodeAudioData(uri, OFFLINE_SAMPLE_RATE);
        const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
        const speed = audioSpeedOf(w);
        const seg = await stretchSegment(api, { channels, sampleRate: buf.sampleRate }, {
          key, uri, from: w.trimIn ?? 0, sourceSec: w.duration * speed, duration: w.duration, speed, reversed: !!w.reversed, pitch: 0, denoise: false,
        });
        out.create();
        out.write(encodeWav16(seg.channels, seg.sampleRate));
      }
      memory.set(key, out.uri);
      return out.uri;
    } catch (caught) {
      logCaught('lib/stretchProxy.ts:ensureStretchProxy', caught);
      memory.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}
