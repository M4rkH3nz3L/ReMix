import { File, Paths } from 'expo-file-system';

import { logCaught } from '@/lib/logCaught';
import type { OfflineMixPlan } from '@/lib/offlineMix';

/**
 * 🌐→📁 A távoli (http) forrású hangklipek előnézeti másolata: egyszer letöltődik az app cache-ébe
 * (NEM a projekt-mappába), és utána az előre renderelt motor játssza — így a +dB, az effektek és a
 * master is pontosan az exporttal azonosan szól (a klipenkénti tartalék lejátszó 1-nél hangosabbat
 * nem tud). Amíg a letöltés tart, a tartalék út szól.
 */

const local = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function cacheName(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  const ext = (url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? 'audio').toLowerCase();
  return `preview_${h.toString(36)}.${ext}`;
}

/** a letöltött helyi másolat (ha már megvan) */
export function previewLocalUri(url: string): string | null {
  const hit = local.get(url);
  if (hit) return hit;
  const f = new File(Paths.cache, cacheName(url));
  if (f.exists && (f.size ?? 0) > 0) {
    local.set(url, f.uri);
    return f.uri;
  }
  return null;
}

/** letöltés a cache-be (egyszer); hiba → null */
export function fetchPreviewSource(url: string): Promise<string | null> {
  const have = previewLocalUri(url);
  if (have) return Promise.resolve(have);
  const running = pending.get(url);
  if (running) return running;
  const task = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const f = new File(Paths.cache, cacheName(url));
      if (f.exists) f.delete();
      f.create();
      f.write(new Uint8Array(await res.arrayBuffer()));
      local.set(url, f.uri);
      return f.uri;
    } catch (caught) {
      logCaught('lib/previewRemoteCache.ts:fetch', caught);
      return null;
    } finally {
      pending.delete(url);
    }
  })();
  pending.set(url, task);
  return task;
}

/** a terv távoli forrásai */
export function remoteUris(plan: OfflineMixPlan | null): string[] {
  return plan ? [...new Set(plan.clips.map((c) => c.uri).filter((u) => /^https?:\/\//i.test(u)))] : [];
}

/** a terv a helyi másolatokkal (ami még nincs meg, marad távoli → a motor nem veszi át) */
export function withLocalSources(plan: OfflineMixPlan | null, localOf: Record<string, string>): OfflineMixPlan | null {
  if (!plan) return plan;
  let changed = false;
  const clips = plan.clips.map((c) => {
    if (!/^https?:\/\//i.test(c.uri)) return c;
    const l = localOf[c.uri];
    if (!l) return c;
    changed = true;
    return { ...c, uri: l };
  });
  return changed ? { ...plan, clips } : plan;
}
