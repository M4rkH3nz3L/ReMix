import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';
import { ANALYSIS_CACHE_LIMIT, LruCache } from '@/lib/lruCache';

/**
 * 🎙️ Voice Studio ELŐNÉZETI PROXY.
 *
 * Az Enhance Voice és a de-reverb eddig CSAK a renderben hallatszott — a
 * szerkesztőben a nyers hang szólt, tehát a beállítást csak teljes export után
 * lehetett megítélni. Itt a worker ugyanazzal a lánccal (voicechain.js)
 * feldolgozza a hangot, a kliens lemezre cache-eli, és az előnézet ezt játssza.
 *
 * A cache-kulcs a fájl + a BEÁLLÍTÁSOK: a kapcsolók átbillentése új proxyt
 * kér, a régi marad a maga kulcsán (oda-vissza kapcsolgatás nem renderel újra).
 */

/** rövid, determinisztikus kulcs a cache-fájlnévhez (djb2) */
function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export interface VoiceOpts {
  voiceEnhance?: boolean;
  deReverb?: boolean;
}

/** uri+beállítás → helyi fájl (null = nincs/nem kell proxy) */
// a kiszórás itt biztonságos: a generált fájl a lemezen marad, és a következő
// híváskor a `target.exists` ág azonnal visszatölti — nincs újragenerálás
const memory = new LruCache<string | null>(ANALYSIS_CACHE_LIMIT);

/** 🧹 a hang-proxy memória-térkép ürítése (a fájlokat NEM törli) */
export function clearVoiceProxyMemory(): void {
  memory.clear();
}
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(uri: string, opts: VoiceOpts): string {
  return `${uri}|${opts.voiceEnhance ? 'e' : ''}${opts.deReverb ? 'd' : ''}`;
}

/** kell-e egyáltalán feldolgozás */
export function needsVoiceProxy(opts: VoiceOpts): boolean {
  return Boolean(opts.voiceEnhance || opts.deReverb);
}

/**
 * A már elkészült proxy útvonala — SZINKRON, hogy a render-fázisban hívható
 * legyen. Ha még nincs kész, `null` (az előnézet a nyerssel megy tovább).
 */
export function getVoiceProxySync(uri: string, opts: VoiceOpts): string | null {
  if (!needsVoiceProxy(opts)) {
    return null;
  }
  return memory.get(cacheKey(uri, opts)) ?? null;
}

/** a feldolgozott hang elkészítése (fájlonként+beállításonként egyszer) */
export function ensureVoiceProxy(
  uri: string,
  opts: VoiceOpts
): Promise<string | null> {
  if (Platform.OS === 'web' || uri.startsWith('http') || !needsVoiceProxy(opts)) {
    return Promise.resolve(null);
  }
  const key = cacheKey(uri, opts);
  if (memory.has(key)) {
    return Promise.resolve(memory.get(key) ?? null);
  }
  const running = inflight.get(key);
  if (running) {
    return running;
  }

  const task = (async (): Promise<string | null> => {
    try {
      const source = new File(uri);
      if (!source.exists) {
        return null;
      }
      const dir = new Directory(Paths.cache, 'voice');
      if (!dir.exists) {
        dir.create();
      }
      const name = hashKey(
        `${source.name}_${source.size ?? 0}_${opts.voiceEnhance ? 1 : 0}${opts.deReverb ? 1 : 0}`
      );
      const target = new File(dir, `vp_${name}.m4a`);
      if (target.exists) {
        memory.set(key, target.uri);
        return target.uri;
      }

      const base = renderServerUrl();
      const form = new FormData();
      form.append('media', new File(uri) as unknown as Blob, source.name);
      form.append('voiceEnhance', opts.voiceEnhance ? 'true' : 'false');
      form.append('deReverb', opts.deReverb ? 'true' : 'false');
      const res = await uploadFetch(`${base}/voice/preview`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        // worker nélkül / hibánál a nyers hang marad — nem hiba a felhasználónak
        memory.set(key, null);
        return null;
      }
      const bytes = await res.arrayBuffer();
      target.write(new Uint8Array(bytes));
      memory.set(key, target.uri);
      return target.uri;
    } catch {
      memory.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}
