import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

/**
 * 🏔️ 2.5D Photo-to-3D kliens (🧊 3D V1): a worker /depth/parallax végpontja a
 * fotóból mélységbecsléssel fg/mid/bg parallax-rétegeket készít (md5 szerint
 * cache-elve — ugyanarra a képre nem számol újra). A rétegek a workeren
 * maradnak, a klip csak az id-t hordozza; a render helyben olvassa őket.
 */

export interface DepthParallaxResult {
  id: string;
  cached: boolean;
  /** worker-relatív URL-ek (előnézethez: `${renderServerUrl()}${layers.fg}`) */
  layers: { bg: string; mid: string; fg: string };
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

/** Elérhető-e a mélység-motor a workeren? */
export async function depthAvailable(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${renderServerUrl()}/health`, 4000);
    const body = (await res.json()) as { depth?: boolean };
    return Boolean(body.depth);
  } catch {
    return false;
  }
}

/** Fotó → parallax-rétegek a workeren (első hívás ~1-2 mp, utána cache). */
export async function requestDepthParallax(
  uri: string
): Promise<DepthParallaxResult | null> {
  const base = renderServerUrl();
  try {
    const form = new FormData();
    if (Platform.OS === 'web') {
      // weben a natív {uri} FormData-trükk nem megy — blobként töltjük fel
      const blob = await (await fetch(uri)).blob();
      form.append('media', blob, uri.split('/').pop() ?? 'photo');
    } else {
      form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'photo');
    }
    const res = await uploadFetch(`${base}/depth/parallax`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as DepthParallaxResult;
    if (!body.id || !body.layers?.fg) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

export interface DepthFocusResult {
  id: string;
  cached: boolean;
  variants: { near: string; far: string };
  /** a közeli-fókusz változat helyi másolata (weben a távoli URL) */
  previewUri: string;
}

/**
 * 🌫️/🎬 Fókusz-változatok a workeren (portré-blur + rack focus vége-képek),
 * a közeli-fókusz kép helyi másolatával az előnézethez.
 */
export async function requestDepthFocus(uri: string): Promise<DepthFocusResult | null> {
  const base = renderServerUrl();
  try {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('media', blob, uri.split('/').pop() ?? 'photo');
    } else {
      form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'photo');
    }
    const res = await uploadFetch(`${base}/depth/focus`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as Omit<DepthFocusResult, 'previewUri'>;
    if (!body.id || !body.variants?.near) {
      return null;
    }
    const remote = `${base}${body.variants.near}`;
    if (Platform.OS === 'web') {
      return { ...body, previewUri: remote };
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `dfocus_${body.id}.png`);
    if (!target.exists) {
      await File.downloadFileAsync(remote, target);
    }
    return { ...body, previewUri: target.uri };
  } catch {
    return null;
  }
}
