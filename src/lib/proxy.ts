import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

/**
 * Vágási proxy (full-plan F2): a nagy felbontású videókhoz a worker 720p-s
 * munka-példányt készít — az előnézet ezt játssza (gyors seek/dekódolás),
 * a render viszont mindig az eredeti fájllal fut (a klip uri-ja sosem íródik
 * át proxyra). A proxy eszköz-lokális műtermék: nem kerül a projekt-JSON-ba,
 * a kulcsa determinisztikus (fájlnév+méret), így registry sem kell hozzá.
 */

const POLL_MS = 1500;
const MAX_POLLS = 400; // ~10 perc

/** originalUri → proxyUri (null = nem kell/nem lehet proxy — eredetit használjuk) */
const memory = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Szinkron gyors-út a lejátszó forrás-választásához: csak a már ismert
 * (session közben feloldott) proxykat adja vissza. A feloldást az
 * ensureProxy() végzi a háttérben.
 */
export function getProxyUriSync(uri: string): string | null {
  return memory.get(uri) ?? null;
}

/**
 * Proxy biztosítása egy videóhoz: lemez-cache → worker-transzkód → letöltés.
 * Csendben null-t ad (eredeti fájl marad), ha a worker nem fut, a forrás
 * eleve kicsi, vagy bármi hiba történik — a szerkesztés sosem áll meg rajta.
 */
export function ensureProxy(uri: string): Promise<string | null> {
  if (Platform.OS === 'web' || uri.startsWith('http')) {
    return Promise.resolve(null);
  }
  if (memory.has(uri)) {
    return Promise.resolve(memory.get(uri) ?? null);
  }
  const running = inflight.get(uri);
  if (running) {
    return running;
  }
  const task = (async (): Promise<string | null> => {
    try {
      const source = new File(uri);
      if (!source.exists) {
        return null;
      }
      const key = hashKey(`${source.name}_${source.size ?? 0}`);
      const dir = new Directory(Paths.document, 'proxies');
      if (!dir.exists) {
        dir.create();
      }
      const target = new File(dir, `px_${key}.mp4`);
      if (target.exists) {
        memory.set(uri, target.uri);
        return target.uri;
      }

      const base = renderServerUrl();
      try {
        await fetchWithTimeout(`${base}/health`, 4000);
      } catch {
        return null; // worker nem fut — az eredetivel megyünk tovább
      }

      const form = new FormData();
      form.append('media', new File(uri) as unknown as Blob, source.name);
      const submit = await uploadFetch(`${base}/proxy`, { method: 'POST', body: form });
      const body = await submit.json();
      if (!submit.ok) {
        return null;
      }
      if (body.skip) {
        // a forrás eleve ≤720p — nincs mit nyerni, ezt megjegyezzük
        memory.set(uri, null);
        return null;
      }

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const res = await fetchWithTimeout(`${base}/render/${body.id}`, 5000);
        const status = await res.json();
        if (status.state === 'done') {
          const file = await File.downloadFileAsync(`${base}/render/${body.id}/file`, target);
          memory.set(uri, file.uri);
          return file.uri;
        }
        if (status.state === 'error') {
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  })();
  inflight.set(uri, task);
  task.finally(() => inflight.delete(uri));
  return task;
}

/** A projekt összes videóklipjéhez elindítja a proxy-készítést (fire-and-forget). */
export function prewarmProxies(uris: string[]): void {
  for (const uri of uris) {
    ensureProxy(uri).catch(() => {});
  }
}
